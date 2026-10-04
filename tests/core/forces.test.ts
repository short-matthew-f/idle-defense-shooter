import { describe, it, expect } from 'vitest';
import { createEnemyPool } from '../../src/sim/core/pools';
import { ARENA_RADIUS } from '../../src/sim/core/types';
import { knockbackEnemy, newKnockParams, stackFactor } from '../../src/sim/core/forces';

/** The knockback governor (core/forces.ts): outward pushes are capped, stacked pushes fade, inward pushes are free. */
function pool(x: number, y: number, radius = 8) {
  const e = createEnemyPool(4);
  e.count = 1; e.x[0] = x; e.y[0] = y; e.radius[0] = radius;
  return e;
}
const K = newKnockParams();   // reach 255, decay 0.5, floor 0.1, window 120 ticks

describe('knockback governor', () => {
  it('never pushes an enemy outward past the primary reach, however hard the push', () => {
    const e = pool(200, 0);
    knockbackEnemy(e, 0, 1, 0, 10_000, 100, K, false);
    expect(Math.hypot(e.x[0], e.y[0])).toBeLessThanOrEqual(K.reach + 1e-6);
  });

  it('never pushes past the arena rim when reach is larger than the arena', () => {
    const wide = { ...K, reach: ARENA_RADIUS * 3 };
    const e = pool(ARENA_RADIUS - 20, 0, 8);
    knockbackEnemy(e, 0, 1, 0, 10_000, 100, wide, false);
    expect(Math.hypot(e.x[0], e.y[0])).toBeLessThanOrEqual(ARENA_RADIUS - 8 + 1e-6);
  });

  it('does not push an enemy already beyond the cap any farther out, but lets it be pulled in', () => {
    const e = pool(400, 0);
    knockbackEnemy(e, 0, 1, 0, 50, 100, K, false);
    expect(Math.hypot(e.x[0], e.y[0])).toBeCloseTo(400, 6);
    knockbackEnemy(e, 0, -1, 0, 50, 101, K, false);
    expect(Math.hypot(e.x[0], e.y[0])).toBeCloseTo(350, 6);
  });

  it('stacked outward pushes inside the window fade 1, 0.5, 0.25, … down to the floor', () => {
    expect([0, 1, 2, 3, 9].map((n) => stackFactor(n, K))).toEqual([1, 0.5, 0.25, 0.125, 0.1]);
    const e = pool(10, 0);
    const moved: number[] = [];
    for (let k = 0; k < 3; k++) { const x0 = e.x[0]; knockbackEnemy(e, 0, 1, 0, 8, 100 + k, K, false); moved.push(e.x[0] - x0); }
    expect(moved[1]).toBeCloseTo(moved[0] / 2, 6);
    expect(moved[2]).toBeCloseTo(moved[0] / 4, 6);
  });

  it('pushes after the window has passed start fresh', () => {
    const e = pool(10, 0);
    knockbackEnemy(e, 0, 1, 0, 8, 100, K, false);
    const x0 = e.x[0];
    knockbackEnemy(e, 0, 1, 0, 8, 100 + K.windowTicks + 5, K, false);
    expect(e.x[0] - x0).toBeCloseTo(8, 6);
  });
});
