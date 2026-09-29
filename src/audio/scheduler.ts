/**
 * Lookahead scheduler (pure math, the "tale of two clocks" pattern). A coarse timer wakes it; every
 * decision uses the audio clock: each step whose start time falls before now + lookahead is handed
 * to `onStep` with its exact audio time, so timer jitter never becomes rhythmic drift. If the clock
 * jumped past scheduled steps (a suspended context, a stalled main thread) the scheduler skips the
 * missed steps and resynchronizes instead of firing a burst of late notes.
 */
export interface SchedulerOptions {
  /** How far ahead of the audio clock to schedule (s). */
  lookahead: number;
  /** Steps later than this are skipped on resync (s). */
  maxLate?: number;
}

export class LookaheadScheduler {
  /** Audio time of the next unscheduled step. */
  nextTime = 0;
  /** Index of the next unscheduled step (monotonic). */
  step = 0;
  skipped = 0;
  /** Length of the last scheduled step (used to skip missed steps on resync). */
  lastDuration = 0.125;
  constructor(private readonly opts: SchedulerOptions, private readonly onStep: (step: number, time: number) => number) {}

  /** Start the grid at audio time `t` (step 0). */
  start(t: number): void { this.nextTime = t; this.step = 0; }

  /**
   * Schedule every step due before now + lookahead. `onStep` returns the duration of the step it
   * scheduled (tempo can change between steps). Returns how many steps were scheduled.
   */
  advance(now: number): number {
    const maxLate = this.opts.maxLate ?? 0.1;
    if (this.nextTime < now - maxLate) {
      // resync: drop the missed steps but keep the step counter moving so bars stay aligned
      let n = 0;
      while (this.nextTime < now && n < 100000) { this.nextTime += this.lastDuration; this.step++; n++; }
      this.skipped += n;
    }
    let count = 0;
    const horizon = now + this.opts.lookahead;
    while (this.nextTime < horizon && count < 256) {
      const dur = this.onStep(this.step, this.nextTime);
      this.lastDuration = dur > 0 ? dur : 0.125;
      this.nextTime += this.lastDuration;
      this.step++;
      count++;
    }
    return count;
  }
}

/** Steps due in [now, now + lookahead) for a fixed step length, given the next step time (pure helper for tests / docs). */
export function stepsDue(nextTime: number, now: number, lookahead: number, stepDur: number): number {
  if (stepDur <= 0) return 0;
  const horizon = now + lookahead;
  if (nextTime >= horizon) return 0;
  return Math.ceil((horizon - nextTime) / stepDur - 1e-9);
}
