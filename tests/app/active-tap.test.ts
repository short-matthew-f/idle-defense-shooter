/**
 * Active edge on the app side (pure): tap routing (crate → collect; enemy → assist + designation, rapid re-taps keep the
 * designation), tower holds, crate picking from the snapshot, the overlay's thumb-sized crates, and the UI helpers.
 */
import { describe, expect, it } from 'vitest';
import { INSTANCE_FLOATS, SALVAGE_MARK, Shape, TOWER_RADIUS } from '../../src/sim/core/types';
import { TapRouter, holdOnTower, REPEAT_MS, SAME_ENEMY_WU, TOWER_HOLD_PX } from '../../src/app/active-tap';
import { CRATE_REACH_PX, nearestCrate, reticleAt, tapReach } from '../../src/app/pick';
import { FieldOverlay, isCrate } from '../../src/app/overlay';
import { ACTIVE } from '../../src/sim/data/active';
import { holdZone, overchargeShown, overchargeUnlocked } from '../../src/ui/active';
import { UNLOCKS } from '../../src/ui/progression';
import { RETICLE_MARK } from '../../src/sim/core/types';

const SCALE = 0.36;   // CSS px per world unit on a 390-wide phone

function inst(list: { x: number; y: number; r: number; layer: number; shape: number; aux1?: number }[]): Float32Array {
  const f = new Float32Array(list.length * INSTANCE_FLOATS);
  list.forEach((e, i) => { const o = i * INSTANCE_FLOATS; f[o] = e.x; f[o + 1] = e.y; f[o + 2] = e.r; f[o + 4] = e.shape; f[o + 8] = 1; f[o + 9] = e.layer; f[o + 11] = e.aux1 ?? 0; });
  return f;
}

describe('tap routing', () => {
  it('a crate under the tap wins: collect, nothing else', () => {
    const r = new TapRouter();
    expect(r.route({ x: 5, y: 6 }, { x: 0, y: 0 }, false, SCALE, 0)).toEqual({ kind: 'collect', x: 5, y: 6 });
  });
  it('an enemy tap is an assist shot and a designation; rapid re-taps on it keep the designation', () => {
    const r = new TapRouter();
    expect(r.route(null, { x: 100, y: 0 }, false, SCALE, 1000)).toEqual({ kind: 'enemy', x: 100, y: 0, assist: true, designate: true });
    expect(r.route(null, { x: 104, y: 2 }, false, SCALE, 1300)).toMatchObject({ assist: true, designate: false });   // hammering
    expect(r.route(null, { x: 106, y: 2 }, false, SCALE, 1600)).toMatchObject({ assist: true, designate: false });
    expect(r.route(null, { x: 106, y: 2 }, false, SCALE, 1600 + REPEAT_MS + 1)).toMatchObject({ designate: true });   // a lone tap: toggles as before
    expect(r.route(null, { x: -200, y: 0 }, false, SCALE, 1700 + REPEAT_MS)).toMatchObject({ designate: true });   // another enemy
  });
  it('two quick taps on two nearby enemies designate both (e2e reach: two designators)', () => {
    const r = new TapRouter();
    // 60 world units apart is ~21 CSS px on a phone: inside REPEAT_PX, but a different enemy
    expect(r.route(null, { x: 0, y: -400 }, false, SCALE, 1000)).toMatchObject({ assist: true, designate: true });
    expect(r.route(null, { x: 60, y: -400 }, false, SCALE, 1250)).toMatchObject({ assist: true, designate: true });
    // the same enemy re-tapped quickly: drawn with its reticle (moved further than SAME_ENEMY_WU), or barely moved
    expect(r.route(null, { x: 60 + SAME_ENEMY_WU + 10, y: -400 }, false, SCALE, 1500, true)).toMatchObject({ designate: false });
    expect(r.route(null, { x: 60 + SAME_ENEMY_WU + 14, y: -400 }, false, SCALE, 1700)).toMatchObject({ designate: false });
  });
  it('a crate loses to an enemy the tap is nearer to (a drifting crate never steals a designation)', () => {
    const r = new TapRouter();
    expect(r.route({ x: 30, y: 0, dist: 30 }, { x: 2, y: 0, dist: 2 }, false, SCALE, 0)).toMatchObject({ kind: 'enemy', designate: true });
    expect(r.route({ x: 3, y: 0, dist: 3 }, { x: 40, y: 0, dist: 40 }, false, SCALE, 5000)).toEqual({ kind: 'collect', x: 3, y: 0 });
  });
  it('the unlock ladder gates the assist (tapAssist) and tap-collecting (salvage)', () => {
    const r = new TapRouter();
    const off = { assist: false, salvage: false };
    expect(r.route({ x: 3, y: 0, dist: 3 }, { x: 40, y: 0, dist: 40 }, false, SCALE, 0, false, off)).toEqual({ kind: 'enemy', x: 40, y: 0, assist: false, designate: true });
    expect(r.route({ x: 3, y: 0, dist: 3 }, null, false, SCALE, 5000, false, off)).toEqual({ kind: 'field' });
  });
  it('with an ability armed the tap is the cast (no assist, no collect); empty ground is a plain field tap', () => {
    const r = new TapRouter();
    expect(r.route({ x: 1, y: 1 }, { x: 0, y: 0 }, true, SCALE, 0)).toMatchObject({ kind: 'enemy', assist: false, designate: true });
    expect(r.route(null, null, false, SCALE, 0)).toEqual({ kind: 'field' });
  });
  it('a hold charges Overcharge only when it starts on the tower', () => {
    expect(holdOnTower(0, 0, TOWER_RADIUS, SCALE)).toBe(true);
    expect(holdOnTower((TOWER_HOLD_PX - 2) / SCALE, 0, TOWER_RADIUS, SCALE)).toBe(true);
    expect(holdOnTower(200, 0, TOWER_RADIUS, SCALE)).toBe(false);
  });
});

describe('crates on the field', () => {
  const snap = inst([
    { x: 0, y: 0, r: 9, layer: 4, shape: Shape.Diamond },                               // an enemy body (not a crate)
    { x: 120, y: 40, r: 7.5, layer: 7, shape: Shape.Diamond, aux1: SALVAGE_MARK },
    { x: 124, y: 40, r: 11, layer: 7, shape: Shape.Ring },                               // its fuse ring (not the pick target)
  ]);
  it('a forgiving reach (≥ 44 CSS px) picks the crate, snapped to its drawn position', () => {
    const reach = tapReach(SCALE, CRATE_REACH_PX);
    expect(reach * SCALE).toBeGreaterThanOrEqual(40);
    expect(nearestCrate(snap, 3, 120 + 35 / SCALE, 40, reach)).toMatchObject({ x: 120, y: 40 });   // 35 px off: still collected
    expect(nearestCrate(snap, 3, 120 + 60 / SCALE, 40, reach)).toBeNull();
    expect(nearestCrate(snap, 3, 0, 0, reach)).toBeNull();                                          // enemies are never crates
  });
  it('the overlay redraws crates at thumb size', () => {
    expect(isCrate(snap, INSTANCE_FLOATS)).toBe(true);
    expect(isCrate(snap, 0)).toBe(false);
    const o = new FieldOverlay();
    expect(o.build(snap, 3, SCALE, 0, null)).toBe(2);   // ring + diamond
    expect(o.buf[INSTANCE_FLOATS + 4]).toBe(Shape.Diamond);
    expect(o.buf[INSTANCE_FLOATS + 2] * SCALE).toBeGreaterThanOrEqual(7 - 1e-6);
  });
});

describe('UI helpers', () => {
  it('Overcharge unlocks at the ladder wave (deepest ever or this run)', () => {
    const ui = (deepestEver: number, deepestCleared: number) => ({ meta: { deepestEver }, run: { deepestCleared } }) as never;
    expect(overchargeUnlocked(ui(0, 11))).toBe(false);
    expect(overchargeUnlocked(ui(ACTIVE.overcharge.unlockWave, 0))).toBe(true);
    expect(overchargeUnlocked(ui(0, ACTIVE.overcharge.unlockWave))).toBe(true);
  });
  it('the Overcharge button follows the sim unlock AND the ladder feature; both unlock at the same wave', () => {
    expect(UNLOCKS.overcharge.wave).toBe(ACTIVE.overcharge.unlockWave);
    const a = (unlocked: boolean) => ({ overcharge: { unlocked } }) as never;
    expect(overchargeShown(a(true), true)).toBe(true);
    expect(overchargeShown(a(true), false)).toBe(false);
    expect(overchargeShown(a(false), true)).toBe(false);   // Unlock everything before wave 12: the sim would ignore it
    expect(overchargeShown(undefined, true)).toBe(false);
  });
  it('reticleAt finds a designated enemy by its reticle ring', () => {
    const f = inst([{ x: 50, y: 60, r: 14, layer: 7, shape: Shape.Ring, aux1: RETICLE_MARK }, { x: 0, y: 0, r: 9, layer: 4, shape: Shape.Diamond }]);
    expect(reticleAt(f, 2, 50, 60)).toBe(true);
    expect(reticleAt(f, 2, 0, 0)).toBe(false);
  });
  it('hold zones follow the window', () => {
    expect(holdZone(0.2)).toBe('early');
    expect(holdZone((ACTIVE.overcharge.perfectFrom + ACTIVE.overcharge.perfectTo) / 2)).toBe('perfect');
    expect(holdZone(ACTIVE.overcharge.perfectTo + 0.1)).toBe('late');
  });
});
