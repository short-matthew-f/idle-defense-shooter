import { describe, expect, it } from 'vitest';
import { INSTANCE_FLOATS, Shape } from '../../src/sim/core/types';
import { FieldOverlay, OVERLAY_LAYER, isDesignatedOutline } from '../../src/app/overlay';
import { nearestEnemy, tapReach, PICK_RADIUS } from '../../src/app/pick';

function inst(list: { x: number; y: number; r: number; layer: number; rgb?: [number, number, number] }[]): Float32Array {
  const f = new Float32Array(list.length * INSTANCE_FLOATS);
  list.forEach((e, i) => { const o = i * INSTANCE_FLOATS; f[o] = e.x; f[o + 1] = e.y; f[o + 2] = e.r; f[o + 9] = e.layer; const c = e.rgb ?? [1, 1, 1]; f[o + 5] = c[0]; f[o + 6] = c[1]; f[o + 7] = c[2]; f[o + 8] = 1; });
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
    const snap = inst([{ x: 10, y: 10, r: 9, layer: 4 }, { x: 10, y: 10, r: 11, layer: 5, rgb: [1, 0.3, 0.3] }, { x: 90, y: 0, r: 11, layer: 5 }]);
    expect(o.build(snap, 3, 0.32, 0, null)).toBe(1);
    expect(o.buf[9]).toBe(OVERLAY_LAYER);
    expect(o.buf[4]).toBe(Shape.Ring);
    expect(o.buf[2]).toBeGreaterThanOrEqual(12 / 0.32 - 1e-3);   // at least 12 px on screen
    o.tap(0, 0, true, 1);
    expect(o.build(null, 0, 0.32, 1.1, 0.5)).toBe(2);             // ripple + aim line
    expect(o.buf[INSTANCE_FLOATS + 4]).toBe(Shape.Line);
    expect(o.build(null, 0, 0.32, 2, null)).toBe(0);              // ripple expired
    expect(isDesignatedOutline(1, 0.3, 0.3)).toBe(true);
    expect(isDesignatedOutline(1, 0.84, 0.36)).toBe(false);
  });
});
