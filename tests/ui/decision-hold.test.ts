import { describe, it, expect } from 'vitest';
import { ARM_WINDOW_MS, DecisionHold, HOLD_CAP_MS, LowHpAlert, VIBRATE_GAP_MS, buzz } from '../../src/ui/decision-hold';

describe('hold for decision', () => {
  it('starts only for an armed (decision-sourced) navigation; the player\'s own tabs stay live', () => {
    const h = new DecisionHold();
    expect(h.navigatedAway(1000)).toBe(false);          // player opened a tab: live
    h.arm(2000);
    expect(h.navigatedAway(2000 + ARM_WINDOW_MS + 1)).toBe(false);   // stale tap
    h.arm(5000);
    expect(h.navigatedAway(5100)).toBe(true);
    expect(h.active).toBe(true);
    expect(h.navigatedAway(5200)).toBe(false);           // already holding
    expect(h.release()).toBe(true);
    expect(h.navigatedAway(9000)).toBe(false);           // a pointer ring alone never holds (rings are hints)
    h.arm(9500);
    expect(h.navigatedAway(9600)).toBe(true);
  });

  it('is capped at 30 s', () => {
    const h = new DecisionHold();
    h.arm(0);
    h.navigatedAway(0);
    expect(HOLD_CAP_MS).toBe(30_000);
    expect(h.expired(29_999)).toBe(false);
    expect(h.left(10_000)).toBe(20_000);
    expect(h.expired(30_000)).toBe(true);
    expect(h.release()).toBe(true);
    expect(h.release()).toBe(false);
    expect(h.left(31_000)).toBe(0);
  });
});

describe('low-HP Battle tab alert', () => {
  it('flashes below 30% while off Battle in combat; vibrates on entering, at most once per gap', () => {
    const a = new LowHpAlert();
    expect(a.update(0, 0.5, true, true)).toBe(false); expect(a.low).toBe(false);
    expect(a.update(100, 0.29, true, true)).toBe(true); expect(a.low).toBe(true);
    expect(a.update(200, 0.2, true, true)).toBe(false);          // still low: no repeat
    expect(a.update(300, 0.2, false, true)).toBe(false); expect(a.low).toBe(false);   // back on Battle
    expect(a.update(400, 0.2, true, true)).toBe(false);          // re-entered within the gap: flash, no buzz
    expect(a.low).toBe(true);
    a.update(500, 0.9, true, true);
    expect(a.update(100 + VIBRATE_GAP_MS, 0.1, true, true)).toBe(true);
    expect(a.update(0, 0.1, true, false)).toBe(false);           // between waves: no alert
  });
  it('buzz never throws without navigator.vibrate', () => { expect(() => buzz()).not.toThrow(); });
});
