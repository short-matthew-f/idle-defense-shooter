/**
 * Admission control for sound effects (pure, no Web Audio): per-sound rate limiting, a voice cap with
 * priorities and stealing, a token bucket for chain notes, and how sim speed thins everything out.
 * The engine asks `Admission.admit` before it builds a single node, so a dense wave costs nothing
 * beyond what can actually be heard.
 */

/** Minimum spacing between two plays of the same sound (per id). */
export class RateLimiter {
  private last: Float64Array;
  constructor(ids: number) { this.last = new Float64Array(ids).fill(-Infinity); }
  /** True (and records the play) when `id` last played at least `minInterval` seconds ago. */
  allow(id: number, now: number, minInterval: number): boolean {
    if (now - this.last[id] < minInterval) return false;
    this.last[id] = now;
    return true;
  }
  reset(): void { this.last.fill(-Infinity); }
}

/** Refilling budget: `rate` tokens per second up to `burst`. */
export class TokenBucket {
  private tokens: number;
  private at = 0;
  constructor(public rate: number, public burst: number) { this.tokens = burst; }
  available(now: number): number {
    if (now > this.at) { this.tokens += (now - this.at) * this.rate; this.at = now; }
    if (this.tokens > this.burst) this.tokens = this.burst;   // also after the burst shrinks (sim speed)
    return this.tokens;
  }
  take(now: number, n = 1): boolean {
    if (this.available(now) < n) return false;
    this.tokens -= n;
    return true;
  }
}

/**
 * Fixed voice slots. A voice holds its slot until its expected end time (sounds are one-shots with a
 * known length, so no callback is needed to free them). When every slot is busy, a new sound steals
 * the lowest-priority voice (oldest first) only if that voice's priority is strictly lower, or equal
 * and the old voice is past half its life; otherwise the new sound is dropped.
 */
export class VoiceAllocator {
  readonly prio: Float32Array;
  readonly start: Float64Array;
  readonly end: Float64Array;
  /** Peak number of simultaneously busy slots seen (for tests and the load harness). */
  peak = 0;
  stolen = 0;
  dropped = 0;
  constructor(readonly cap: number) {
    this.prio = new Float32Array(cap);
    this.start = new Float64Array(cap);
    this.end = new Float64Array(cap).fill(-Infinity);
  }
  active(now: number): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.end[i] > now) n++;
    return n;
  }
  /** Slot for a voice of `priority` lasting `dur` s from `now`, or -1 (dropped). `wasBusy` tells the caller to fade the old voice. */
  acquire(priority: number, now: number, dur: number): { slot: number; wasBusy: boolean } | null {
    let free = -1, victim = -1;
    for (let i = 0; i < this.cap; i++) {
      if (this.end[i] <= now) { free = i; break; }
      const p = this.prio[i];
      const canSteal = p < priority || (p === priority && now - this.start[i] > (this.end[i] - this.start[i]) * 0.5);
      if (!canSteal) continue;
      if (victim < 0 || p < this.prio[victim] || (p === this.prio[victim] && this.start[i] < this.start[victim])) victim = i;
    }
    const slot = free >= 0 ? free : victim;
    if (slot < 0) { this.dropped++; return null; }
    if (free < 0) this.stolen++;
    this.prio[slot] = priority; this.start[slot] = now; this.end[slot] = now + Math.max(0.01, dur);
    const a = this.active(now);
    if (a > this.peak) this.peak = a;
    return { slot, wasBusy: free < 0 };
  }
  /** Free every slot (after a context suspend / resume, or a hard stop). */
  clear(): void { this.end.fill(-Infinity); }
}

/**
 * How much sim speed thins sound: at ×2/×4/×8 the same number of events arrives 2/4/8× as fast,
 * so rate limits widen and levels drop a little. Returns the interval multiplier (≥ 1), the
 * budget multiplier for chain notes (≤ 1), and a linear gain trim (≤ 1, about −1.5 dB per doubling).
 */
export function speedDensity(speed: number): { interval: number; budget: number; gain: number } {
  const s = Math.max(1, Math.min(64, speed || 1));
  const doublings = Math.log2(s);
  return {
    interval: Math.pow(s, 0.6),
    budget: Math.pow(s, -0.5),
    gain: Math.pow(10, (-1.5 * doublings) / 20),
  };
}

export interface AdmitSpec { id: number; priority: number; minInterval: number; dur: number }

/** Rate limiter + voice allocator with the speed density applied: the single gate for every sfx. */
export class Admission {
  readonly limiter: RateLimiter;
  readonly voices: VoiceAllocator;
  private density = speedDensity(1);
  constructor(ids: number, cap = 24) {
    this.limiter = new RateLimiter(ids);
    this.voices = new VoiceAllocator(cap);
  }
  setSpeed(speed: number): void { this.density = speedDensity(speed); }
  get gainTrim(): number { return this.density.gain; }
  get intervalMul(): number { return this.density.interval; }
  /** Slot to play in, or null when rate-limited or no voice is available. */
  admit(spec: AdmitSpec, now: number): { slot: number; wasBusy: boolean } | null {
    // important sounds (priority ≥ 8: meta events, abilities) are never thinned by speed
    const interval = spec.priority >= 8 ? spec.minInterval : spec.minInterval * this.density.interval;
    if (interval > 0 && !this.limiter.allow(spec.id, now, interval)) return null;
    return this.voices.acquire(spec.priority, now, spec.dur);
  }
}
