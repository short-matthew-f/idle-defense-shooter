/**
 * Chains as melodies (pure). The main thread keeps a small ring map of recent event id → chain depth:
 * an event's depth is its cause's depth + 1 when the cause is known, else 0. A Hit or Kill that only
 * continues its cause (a Kill caused by the Hit of the same damage call, or a Hit whose cause has the
 * same src, e.g. a piercing bullet) keeps the cause's depth, matching how the Inspector counts links:
 * "the gun hit, which killed" is one link, "the drone shocked, which caused the lightning to jump" two.
 *
 * Each chain event plays a pentatonic note in the music's key; pitch climbs with depth (up to about two
 * octaves), timbre comes from the src, and a notes-per-second budget keeps the deepest chains when a
 * batch holds more candidates than can be heard.
 */
import type { Key } from './theory';
import { pentatonicFor, scaleNote } from './theory';
import { TokenBucket } from './mixer';

export const RING = 4096;

export class ChainTracker {
  private ids = new Int32Array(RING).fill(-1);
  private depth = new Uint8Array(RING);
  private hit = new Uint8Array(RING);

  /** Depth of a recorded event, or -1 if unknown (never seen, or overwritten by the ring). */
  depthOf(id: number): number {
    if (id < 0) return -1;
    const k = id % RING;
    return this.ids[k] === id ? this.depth[k] : -1;
  }
  /** Was the recorded event a Hit? */
  isHit(id: number): boolean { const k = id % RING; return id >= 0 && this.ids[k] === id && this.hit[k] === 1; }

  /**
   * Record an event and return its depth. `continues`: this link only continues its cause (same
   * src Hit, or a Kill whose cause is a Hit), so it adds no depth.
   */
  record(id: number, cause: number, isHit: boolean, continues: boolean): number {
    const pd = this.depthOf(cause);
    const d = pd < 0 ? 0 : Math.min(255, pd + (continues ? 0 : 1));
    const k = id % RING;
    this.ids[k] = id; this.depth[k] = d; this.hit[k] = isHit ? 1 : 0;
    return d;
  }
  reset(): void { this.ids.fill(-1); }
}

/** Highest pentatonic step a chain note reaches: 10 steps = two octaves of a 5-note scale. */
export const MAX_CHAIN_STEP = 10;

/** Register of chain notes: the key's root one octave up (the music's pad sits around the root octave). */
export function chainPitch(depth: number, key: Key): number {
  const step = Math.max(0, Math.min(MAX_CHAIN_STEP, depth - 1));
  return scaleNote(key.root + 12, pentatonicFor(key.mode), step);
}

export type Timbre = 'pluck' | 'ember' | 'spark' | 'drop' | 'glass' | 'blip' | 'mallet' | 'air' | 'beam' | 'deep' | 'shimmer' | 'bell';

const HEAD_TIMBRE: Record<string, Timbre> = {
  ballistics: 'pluck', primary: 'pluck', fire: 'ember', burn: 'ember', lightning: 'spark', static: 'spark', shock: 'spark',
  poison: 'drop', frost: 'glass', chill: 'glass', frozen: 'glass', drones: 'blip', ordnance: 'mallet', blade: 'air', bleed: 'air',
  laser: 'beam', gravitics: 'deep', fusion: 'shimmer', triad: 'shimmer', anomaly: 'shimmer', ability: 'shimmer',
  link: 'bell', chassis: 'bell', bastion: 'mallet', reactor: 'beam',
};

/** Instrument for a chain note from the event's src tag ('fire', 'fusion.plasma', 'infuse.laser.frost', 'link.blade+laser'). */
export function timbreFor(src: string): Timbre {
  const direct = HEAD_TIMBRE[src];
  if (direct) return direct;
  const parts = src.split('.');
  if (parts[0] === 'infuse' && parts[2]) return HEAD_TIMBRE[parts[2]] ?? 'shimmer';
  return HEAD_TIMBRE[parts[0]] ?? 'pluck';
}

export interface NoteCandidate { depth: number; id: number; src: string; x: number; weight: number }

/**
 * Notes-per-second budget. `select` keeps at most the available tokens (and `perBatch`) of the
 * candidates, deepest first (ties: stronger weight, then earlier id), and returns them in playing
 * order: ascending depth, so a chain inside one batch plays as a rising figure.
 */
export class ChainBudget {
  readonly bucket: TokenBucket;
  private scratch: NoteCandidate[] = [];
  constructor(readonly rate = 7, readonly burst = 5, public perBatch = 4) { this.bucket = new TokenBucket(rate, burst); }
  /** Scale the notes-per-second budget (sim speed thins chain notes: see mixer.speedDensity). */
  setBudget(mul: number): void {
    this.bucket.rate = this.rate * mul;
    this.bucket.burst = Math.max(1, this.burst * mul);
  }
  select(cands: readonly NoteCandidate[], now: number, out: NoteCandidate[] = []): NoteCandidate[] {
    out.length = 0;
    if (cands.length === 0) return out;
    const n = Math.min(this.perBatch, Math.floor(this.bucket.available(now) + 1e-9), cands.length);
    if (n <= 0) return out;
    const s = this.scratch;
    s.length = 0;
    for (const c of cands) s.push(c);
    s.sort((a, b) => b.depth - a.depth || b.weight - a.weight || a.id - b.id);
    for (let i = 0; i < n; i++) out.push(s[i]);
    this.bucket.take(now, n);
    out.sort((a, b) => a.depth - b.depth || a.id - b.id);
    return out;
  }
}
