/**
 * Tick-budget pacing (pure). The main thread tells the worker how many 60 Hz ticks to run each
 * animation frame: real dt × speed × 60, accumulated so fractional ticks carry over, capped at
 * 8 ticks per frame per ×1 of speed (a long frame or a returning tab never floods the worker).
 */
export const TICKS_PER_SECOND = 60;
export const TICKS_CAP_PER_SPEED = 8;
/** Longest single frame we account for (s); longer gaps (tab switch, debugger) are dropped. */
export const MAX_FRAME_DT = 0.25;

export class TickPacer {
  acc = 0;

  /** Ticks to request for a frame of `dt` seconds at `speed`; 0 while paused or hidden. */
  step(dt: number, speed: number, paused = false): number {
    if (paused || !(dt > 0) || !(speed > 0)) return 0;
    const d = dt > MAX_FRAME_DT ? MAX_FRAME_DT : dt;
    this.acc += d * TICKS_PER_SECOND * speed;
    const cap = TICKS_CAP_PER_SPEED * speed;
    let n = Math.floor(this.acc);
    if (n > cap) { n = cap; this.acc = 0; }   // behind: drop the backlog instead of spiralling
    else this.acc -= n;
    return n;
  }

  reset(): void { this.acc = 0; }
}

/** Hidden-tab policy: after this long hidden, returning credits Patrol-rate offline Scrap. */
export const HIDDEN_OFFLINE_AFTER_S = 60;
export function offlineSecondsOnReturn(hiddenAtMs: number, nowMs: number): number {
  const s = (nowMs - hiddenAtMs) / 1000;
  return s >= HIDDEN_OFFLINE_AFTER_S ? s : 0;
}
