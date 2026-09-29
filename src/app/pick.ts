/**
 * Tap gate / aim assist on the render snapshot's instance stream (pure). The sim decides which
 * enemy a tap designates (`designate_at` resolves by position in the worker), so this never maps
 * instances to pool indices. It answers "was a live enemy under the tap?" with the same reach the
 * sim uses (center within max(PICK_RADIUS, radius + 8)) and returns that enemy's drawn position,
 * which armed ability casts snap to.
 */
import { INSTANCE_FLOATS } from '@sim/core/types';

export const ENEMY_LAYER = 4;
export const PICK_RADIUS = 24;
/** Extra reach beyond an enemy's radius (matches run/commands.ts enemyAt). */
export const PICK_PAD = 8;

/** Minimum tap reach in CSS pixels (a fingertip), whatever the zoom. */
export const TAP_REACH_PX = 22;

/** World-unit reach for a tap at `scale` CSS px per world unit: never below PICK_RADIUS. */
export function tapReach(scale: number, px = TAP_REACH_PX): number {
  return scale > 0 ? Math.max(PICK_RADIUS, px / scale) : PICK_RADIUS;
}

export interface PickResult { x: number; y: number; dist: number }

export function nearestEnemy(instances: Float32Array, count: number, x: number, y: number, minReach = PICK_RADIUS): PickResult | null {
  let best: PickResult | null = null;
  const n = Math.min(count, Math.floor(instances.length / INSTANCE_FLOATS));
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_FLOATS;
    if (instances[o + 9] !== ENEMY_LAYER) continue;
    const ex = instances[o], ey = instances[o + 1], r = instances[o + 2];
    const d = Math.hypot(ex - x, ey - y);
    if (d <= Math.max(minReach, r + PICK_PAD) && (!best || d < best.dist)) best = { x: ex, y: ey, dist: d };
  }
  return best;
}
