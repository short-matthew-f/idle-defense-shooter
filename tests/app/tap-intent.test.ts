/** Phase 3 tap intent and timing assists (pure parts): weighted sticky picks, tap/hold classification, auto-release. */
import { describe, expect, it } from 'vitest';
import { INSTANCE_FLOATS, PICK_RANK_SCALE, PickRank, RETICLE_MARK, Shape } from '../../src/sim/core/types';
import { pickEnemy, pickRank, STICKY_PX } from '../../src/app/pick';
import { AIM_TAP_MS, classifyPress, HOLD_DELAYS, HOLD_MS, holdMsFor, SLOP_PX } from '../../src/app/input';
import { autoReleaseDue, bandEntered, HapticCues } from '../../src/ui/assist-cues';
import { holdDelayStep } from '../../src/ui/assist-settings';
import { ACTIVE } from '../../src/sim/data/active';

const O = ACTIVE.overcharge;

type I = { x: number; y: number; r: number; layer: number; shape: number; aux1?: number };
function inst(list: I[]): Float32Array {
  const f = new Float32Array(list.length * INSTANCE_FLOATS);
  list.forEach((e, i) => { const o = i * INSTANCE_FLOATS; f[o] = e.x; f[o + 1] = e.y; f[o + 2] = e.r; f[o + 4] = e.shape; f[o + 8] = 1; f[o + 9] = e.layer; f[o + 11] = e.aux1 ?? 0; });
  return f;
}
const enemy = (x: number, y: number, r: number, rank: number, anim = 0): I => ({ x, y, r, layer: 4, shape: Shape.Circle, aux1: anim + rank * PICK_RANK_SCALE });
const reticle = (x: number, y: number): I => ({ x, y, r: 14, layer: 7, shape: Shape.Ring, aux1: RETICLE_MARK });

describe('weighted, sticky enemy picks', () => {
  it('reads the rank above the packed animation bits', () => {
    expect(pickRank(0x3ffff + PickRank.Boss * PICK_RANK_SCALE)).toBe(PickRank.Boss);
    expect(pickRank(0xfffff)).toBe(PickRank.Other);
  });

  it('within the assist reach a boss beats a nearer grunt; an elite beats a nearer grunt; the nearest wins within a rank', () => {
    const f = inst([enemy(12, 0, 8, PickRank.Other), enemy(45, 0, 40, PickRank.Boss)]);
    expect(pickEnemy(f, 2, 0, 0, 24)).toMatchObject({ x: 45, y: 0, rank: PickRank.Boss });
    const g = inst([enemy(10, 0, 8, PickRank.Other), enemy(-15, 0, 8, PickRank.Elite)]);
    expect(pickEnemy(g, 2, 0, 0, 24)).toMatchObject({ x: -15, rank: PickRank.Elite });
    const h = inst([enemy(10, 0, 8, PickRank.Other), enemy(-5, 0, 8, PickRank.Other)]);
    expect(pickEnemy(h, 2, 0, 0, 24)).toMatchObject({ x: -5 });
    const wp = inst([enemy(10, 0, 8, PickRank.Boss), enemy(-12, 0, 8, PickRank.WeakPoint)]);
    expect(pickEnemy(wp, 2, 0, 0, 24)).toMatchObject({ x: -12, rank: PickRank.WeakPoint });
  });

  it('a finger on an add beside a boss picks the add (direct hits beat the assist reach)', () => {
    const f = inst([enemy(3, 0, 8, PickRank.Other), enemy(30, 0, 40, PickRank.Boss)]);
    expect(pickEnemy(f, 2, 0, 0, 24)).toMatchObject({ x: 3, rank: PickRank.Other });
    const g = inst([enemy(3, 0, 8, PickRank.Other), enemy(-15, 0, 8, PickRank.Elite)]);
    expect(pickEnemy(g, 2, 0, 0, 24)).toMatchObject({ x: 3 });
  });

  it('an enemy out of reach is never picked, whatever its rank', () => {
    const f = inst([enemy(100, 0, 20, PickRank.Boss)]);
    expect(pickEnemy(f, 1, 0, 0, 24)).toBeNull();
  });

  it('keeps the current designation within STICKY_PX of the best candidate, not beyond', () => {
    const scale = 2;   // CSS px per world unit
    const sticky = STICKY_PX / scale;   // 3 world units
    // designated enemy 2 wu farther than the nearest grunt: kept
    const near = inst([enemy(5, 0, 6, PickRank.Other), enemy(-7, 0, 6, PickRank.Other), reticle(-7, 0)]);
    expect(pickEnemy(near, 3, 0, 0, 24, sticky)).toMatchObject({ x: -7, marked: true });
    // 6 wu farther (12 px): the nearer one wins
    const far = inst([enemy(5, 0, 6, PickRank.Other), enemy(-11, 0, 6, PickRank.Other), reticle(-11, 0)]);
    expect(pickEnemy(far, 3, 0, 0, 24, sticky)).toMatchObject({ x: 5, marked: false });
    // no stickiness requested: plain weighting
    expect(pickEnemy(near, 3, 0, 0, 24, 0)).toMatchObject({ x: 5 });
  });
});

describe('tap vs hold', () => {
  it('slop is 16 px and the base hold 260 ms; hold delays 0 / 150 / 300', () => {
    expect(SLOP_PX).toBe(16);
    expect(HOLD_MS).toBe(260);
    expect([...HOLD_DELAYS]).toEqual([0, 150, 300]);
    expect(HOLD_DELAYS.map(holdMsFor)).toEqual([260, 410, 560]);
    expect(holdMsFor(9999)).toBe(560);
    expect(holdMsFor(Number.NaN)).toBe(260);
    expect(holdDelayStep(150)).toBe(1);
    expect(holdDelayStep(1000)).toBe(2);
  });

  it('classifies presses for each hold delay', () => {
    for (const d of HOLD_DELAYS) {
      const hold = holdMsFor(d);
      // quick press, rolled 15 px: still a tap (was a drag at the old 10 px slop)
      expect(classifyPress(15, hold - 1, hold, SLOP_PX, false, false)).toBe('tap');
      expect(classifyPress(17, hold - 1, hold, SLOP_PX, false, false)).toBe('drag');
      // past the hold over empty ground: steer
      expect(classifyPress(0, hold + 50, hold, SLOP_PX, false, false)).toBe('aim');
      // a short unmoved aim over an enemy / crate: a tap
      expect(classifyPress(0, hold + AIM_TAP_MS, hold, SLOP_PX, false, true)).toBe('tap');
      expect(classifyPress(0, hold + AIM_TAP_MS + 1, hold, SLOP_PX, false, true)).toBe('aim');
      expect(classifyPress(20, hold + 50, hold, SLOP_PX, false, true)).toBe('aim');
      // a claimed hold (Overcharge on the tower) stays a hold
      expect(classifyPress(0, hold + 50, hold, SLOP_PX, true, true)).toBe('hold');
    }
    // the delay moves the line: 300 ms is a hold at the default and a tap at Longer
    expect(classifyPress(0, 300, holdMsFor(0), SLOP_PX, false, false)).toBe('aim');
    expect(classifyPress(0, 300, holdMsFor(150), SLOP_PX, false, false)).toBe('tap');
  });
});

describe('Overcharge cues and auto-release', () => {
  it('the band-entry cue fires once, on the crossing', () => {
    expect(bandEntered(O.perfectFrom - 0.02, O.perfectFrom + 0.01)).toBe(true);
    expect(bandEntered(O.perfectFrom + 0.01, O.perfectFrom + 0.03)).toBe(false);
    expect(bandEntered(0.1, 0.2)).toBe(false);
  });

  it('auto-release: only with the assist on, at the top of the perfect band (inside it)', () => {
    expect(autoReleaseDue(O.perfectTo, false)).toBe(false);
    expect(autoReleaseDue(O.perfectFrom, true)).toBe(false);
    expect(autoReleaseDue(O.perfectTo - 0.1, true)).toBe(false);
    expect(autoReleaseDue(O.perfectTo - 0.05, true)).toBe(true);
    // the first frame it fires is still inside the band
    let s = 0;
    while (!autoReleaseDue(s, true)) s += 1 / 60;
    expect(s).toBeGreaterThanOrEqual(O.perfectFrom);
    expect(s).toBeLessThanOrEqual(O.perfectTo);
  });

  it('haptic cues fire on the tell opening and on entering low HP, once each', () => {
    const h = new HapticCues();
    expect(h.update(false, 1, true)).toBeNull();
    expect(h.update(true, 1, true)).toBe('tell');
    expect(h.update(true, 1, true)).toBeNull();
    expect(h.update(false, 0.2, true)).toBe('low');
    expect(h.update(false, 0.1, true)).toBeNull();
    expect(h.update(false, 0.1, false)).toBeNull();
  });
});
