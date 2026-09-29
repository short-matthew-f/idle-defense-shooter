/**
 * Tap → enemy lookup on the render snapshot's instance stream (pure). Enemies are layer-4
 * instances, emitted in ascending pool index order skipping dead slots, so the ordinal of a
 * layer-4 instance is its live-enemy index (the pool is compact: index < count is alive).
 */
import { INSTANCE_FLOATS } from '@sim/core/types';

export const ENEMY_LAYER = 4;
export const PICK_RADIUS = 24;

export interface PickResult { index: number; x: number; y: number; dist: number }

export function nearestEnemy(instances: Float32Array, count: number, x: number, y: number, maxDist = PICK_RADIUS): PickResult | null {
  let best: PickResult | null = null;
  let ordinal = 0;
  const n = Math.min(count, Math.floor(instances.length / INSTANCE_FLOATS));
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_FLOATS;
    if (instances[o + 9] !== ENEMY_LAYER) continue;
    const ex = instances[o], ey = instances[o + 1], r = instances[o + 2];
    const d = Math.max(0, Math.hypot(ex - x, ey - y) - r);
    if (d <= maxDist && (!best || d < best.dist)) best = { index: ordinal, x: ex, y: ey, dist: d };
    ordinal++;
  }
  return best;
}
