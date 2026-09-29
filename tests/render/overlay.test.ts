import { describe, expect, it } from 'vitest';
import { INSTANCE_FLOATS, RETICLE_MARK, Shape } from '../../src/sim/core/types';
import { FieldOverlay, OVERLAY_LAYER, isReticle } from '../../src/app/overlay';
import { nearestEnemy, tapReach, PICK_RADIUS } from '../../src/app/pick';

function inst(list: { x: number; y: number; r: number; layer: number; rgb?: [number, number, number]; shape?: number; aux1?: number }[]): Float32Array {
  const f = new Float32Array(list.length * INSTANCE_FLOATS);
  list.forEach((e, i) => {
    const o = i * INSTANCE_FLOATS; f[o] = e.x; f[o + 1] = e.y; f[o + 2] = e.r; f[o + 4] = e.shape ?? Shape.Circle; f[o + 9] = e.layer;
    const c = e.rgb ?? [1, 1, 1]; f[o + 5] = c[0]; f[o + 6] = c[1]; f[o + 7] = c[2]; f[o + 8] = 1; f[o + 11] = e.aux1 ?? 0;
  });
  return f;
}

describe('tap reach and field overlay', () => {
  it('tap reach is a fingertip in screen space, never below the sim reach', () => {
    expect(tapReach(0.32)).toBeCloseTo(22 / 0.32);   // phone: ~69 world units
    expect(tapReach(2)).toBe(PICK_RADIUS);             // zoomed in: the sim reach wins
    expect(tapReach(0)).toBe(PICK_RADIUS);
    const e = inst([{ x: 50, y: 0, r: 5, layer: 4 }]);
    expect(nearestEnemy(e, 1, 0, 0)).toBeNull();                        // 50 units: missed with the world reach
    expect(nearestEnemy(e, 1, 0, 0, tapReach(0.32))?.x).toBe(50);      // hit with a thumb-sized reach
  });

  it('draws a reticle on designated enemies, a ripple after a tap, and an aim line', () => {
    const o = new FieldOverlay();
    // the sim's reticle marker (layer-7 Ring, aux1 = RETICLE_MARK); outline colours and other layer-7 rings are ignored
    const snap = inst([
      { x: 10, y: 10, r: 9, layer: 4 }, { x: 10, y: 10, r: 11, layer: 5, rgb: [1, 0.3, 0.3] }, { x: 90, y: 0, r: 11, layer: 5, rgb: [1, 0.84, 0.36] },
      { x: 10, y: 10, r: 15, layer: 7, shape: Shape.Ring, aux1: RETICLE_MARK }, { x: 50, y: 0, r: 30, layer: 7, shape: Shape.Ring },
    ]);
    expect(o.build(snap, 5, 0.32, 0, null)).toBe(1);
    expect(o.buf[0]).toBe(10);
    expect(o.buf[9]).toBe(OVERLAY_LAYER);
    expect(o.buf[4]).toBe(Shape.Ring);
    expect(o.buf[2]).toBeGreaterThanOrEqual(12 / 0.32 - 1e-3);   // at least 12 px on screen
    o.tap(0, 0, true, 1);
    expect(o.build(null, 0, 0.32, 1.1, 0.5)).toBe(2);             // ripple + aim line
    expect(o.buf[INSTANCE_FLOATS + 4]).toBe(Shape.Line);
    expect(o.build(null, 0, 0.32, 2, null)).toBe(0);              // ripple expired
    expect(isReticle(snap, 3 * INSTANCE_FLOATS)).toBe(true);
    expect(isReticle(snap, 1 * INSTANCE_FLOATS)).toBe(false);   // the designated outline colour alone is not a mark
    expect(isReticle(snap, 4 * INSTANCE_FLOATS)).toBe(false);
  });
});
