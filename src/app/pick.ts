/**
 * Tap gate / aim assist on the render snapshot's instance stream (pure). The sim decides which
 * enemy a tap designates (`designate_at` resolves by position in the worker), so this never maps
 * instances to pool indices. It answers "was a live enemy under the tap?" with the same reach the
 * sim uses (center within max(PICK_RADIUS, radius + 8)) and returns that enemy's drawn position,
 * which armed ability casts snap to.
 */
import { INSTANCE_FLOATS, PICK_RANK_SCALE, RETICLE_MARK, SALVAGE_MARK, Shape } from '@sim/core/types';

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

/** Phase 3 tap intent: a designated enemy within this many CSS px of the best candidate keeps the tap (no flicker). */
export const STICKY_PX = 6;

/** An enemy body's pick rank (0 other, 1 elite, 2 boss, 3 boss with its weak point open; core/types.ts PickRank). */
export function pickRank(aux1: number): number {
  return Math.floor(aux1 / PICK_RANK_SCALE) & 3;
}

export interface WeightedPick extends PickResult {
  /** The picked enemy's rank (pickRank). */
  rank: number;
  /** The picked enemy is drawn with a designation reticle. */
  marked: boolean;
}

/**
 * Phase 3 weighted, sticky enemy pick (fixes A-05, A-06, C-14). Among the enemies within reach of (x, y) (the same reach
 * as nearestEnemy), the highest rank wins (boss, weak point open first, then elite, then the rest), the nearest within
 * a rank. Then stickiness: an enemy already designated (reticle drawn on it) keeps the tap when it is no more than
 * `stickyWu` world units farther than that best candidate, so taps in a formation do not flick the designation around.
 * Pure (tests/app/pick.test.ts); the sim still resolves `designate_at` by the position this returns.
 */
export function pickEnemy(instances: Float32Array, count: number, x: number, y: number, minReach = PICK_RADIUS, stickyWu = 0): WeightedPick | null {
  const n = Math.min(count, Math.floor(instances.length / INSTANCE_FLOATS));
  let best: WeightedPick | null = null;
  let sticky: PickResult | null = null;
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_FLOATS;
    if (instances[o + 9] !== ENEMY_LAYER) continue;
    const ex = instances[o], ey = instances[o + 1], r = instances[o + 2];
    const d = Math.hypot(ex - x, ey - y);
    if (d > Math.max(minReach, r + PICK_PAD)) continue;
    const rank = pickRank(instances[o + 11]);
    if (!best || rank > best.rank || (rank === best.rank && d < best.dist)) best = { x: ex, y: ey, dist: d, rank, marked: false };
    if ((!sticky || d < sticky.dist) && reticleAt(instances, count, ex, ey)) sticky = { x: ex, y: ey, dist: d };
  }
  if (!best) return null;
  if (sticky && sticky.dist <= best.dist + stickyWu) {
    const so = findBody(instances, n, sticky.x, sticky.y);
    return { ...sticky, rank: so >= 0 ? pickRank(instances[so + 11]) : 0, marked: true };
  }
  best.marked = reticleAt(instances, count, best.x, best.y);
  return best;
}

function findBody(instances: Float32Array, n: number, x: number, y: number): number {
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_FLOATS;
    if (instances[o + 9] === ENEMY_LAYER && instances[o] === x && instances[o + 1] === y) return o;
  }
  return -1;
}

/** Active edge: minimum tap reach around a salvage crate in CSS px (forgiving: a crate drifts while the thumb moves). */
export const CRATE_REACH_PX = 44;
/** Layer-7 salvage crate instances carry aux1 = SALVAGE_MARK (systems/active.ts). */
export const CRATE_LAYER = 7;

/**
 * The drawn salvage crate nearest (x, y) within max(minReach, crate radius), or null. The sim collects the crate
 * nearest the point it is sent (collect_salvage), so the tap snaps onto the crate's drawn position.
 */
export function nearestCrate(instances: Float32Array, count: number, x: number, y: number, minReach: number): PickResult | null {
  let best: PickResult | null = null;
  const n = Math.min(count, Math.floor(instances.length / INSTANCE_FLOATS));
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_FLOATS;
    if (instances[o + 9] !== CRATE_LAYER || instances[o + 11] !== SALVAGE_MARK || instances[o + 4] !== Shape.Diamond) continue;
    const d = Math.hypot(instances[o] - x, instances[o + 1] - y);
    if (d <= Math.max(minReach, instances[o + 2]) && (!best || d < best.dist)) best = { x: instances[o], y: instances[o + 1], dist: d };
  }
  return best;
}

/**
 * Is the enemy drawn at (x, y) designated (or Hunter-marked)? The sim draws its reticle as a layer-7 Ring tagged
 * RETICLE_MARK centred on the enemy (core/snapshot.ts); `tol` absorbs the frame between the pick and the ring.
 */
export function reticleAt(instances: Float32Array, count: number, x: number, y: number, tol = 2): boolean {
  const n = Math.min(count, Math.floor(instances.length / INSTANCE_FLOATS));
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_FLOATS;
    if (instances[o + 9] !== CRATE_LAYER || instances[o + 4] !== Shape.Ring || instances[o + 11] !== RETICLE_MARK) continue;
    if (Math.hypot(instances[o] - x, instances[o + 1] - y) <= tol) return true;
  }
  return false;
}
