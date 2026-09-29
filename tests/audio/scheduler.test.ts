import { describe, expect, it } from 'vitest';
import { LookaheadScheduler, stepsDue } from '../../src/audio/scheduler';
import { AudioRng } from '../../src/audio/rng';

describe('audio scheduler: lookahead math', () => {
  it('stepsDue counts the steps starting before now + lookahead', () => {
    expect(stepsDue(0, 0, 0.1, 0.125)).toBe(1);
    expect(stepsDue(0.125, 0.05, 0.1, 0.125)).toBe(1);
    expect(stepsDue(0.125, 0, 0.1, 0.125)).toBe(0);
    expect(stepsDue(1, 0.5, 1, 0.1)).toBe(5);
  });

  it('schedules each step exactly once, on the audio clock, whatever the timer jitter', () => {
    const times: number[] = [];
    const sd = 60 / 90 / 4;
    const s = new LookaheadScheduler({ lookahead: 0.3 }, (_step, t) => { times.push(t); return sd; });
    s.start(0.05);
    const rng = new AudioRng(7);
    let now = 0;
    while (now < 30) {
      s.advance(now);
      now += 0.02 + rng.next() * 0.08;   // a jittery 20–100 ms timer
    }
    // every step time is exactly on the grid (no drift) and none is missing or repeated
    for (let i = 0; i < times.length; i++) expect(times[i]).toBeCloseTo(0.05 + i * sd, 9);
    // it kept up with the clock: the last step lies within one lookahead of the last wake
    expect(times[times.length - 1]).toBeGreaterThan(30 - 0.1);
    expect(times[times.length - 1]).toBeLessThan(30 + 0.3);
    // and it always stayed ahead of the clock: nothing was scheduled in the past beyond one wake
    expect(s.skipped).toBe(0);
  });

  it('never schedules more than the lookahead ahead of the clock', () => {
    let last = 0;
    const s = new LookaheadScheduler({ lookahead: 0.2 }, (_st, t) => { last = t; return 0.1; });
    s.start(0);
    s.advance(0);
    expect(last).toBeLessThan(0.2);
    s.advance(1);
    expect(last).toBeLessThan(1.2);
    expect(last).toBeGreaterThanOrEqual(1);
  });

  it('after a stall it skips the missed steps (no burst of late notes) and keeps the bar count', () => {
    const played: number[] = [];
    const s = new LookaheadScheduler({ lookahead: 0.1, maxLate: 0.1 }, (step, t) => { played.push(t); return 0.125 + 0 * step; });
    s.start(0);
    s.advance(0);
    const before = played.length;
    s.advance(5);   // the main thread stalled for 5 s
    const after = played.slice(before);
    expect(after.every((t) => t >= 5)).toBe(true);
    expect(after.length).toBeLessThanOrEqual(2);
    expect(s.skipped).toBeGreaterThan(30);
    expect(s.step).toBe(Math.round(s.nextTime / 0.125));
  });
});
