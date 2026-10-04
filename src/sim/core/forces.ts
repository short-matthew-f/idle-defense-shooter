/**
 * Knockback governor (WorldImpl.knockback is the single entry point every push goes through: Heavy Rounds, Impact
 * Mass, the Orbital Blade, Repulsor Pulse, Shockwave Shield, Clockwork Blade, the Mass Driver fling, Safe Harbor).
 *
 * Why: uncapped pushes stacked (a volley of Heavy Rounds in flight, Repulsor every 5 s, blade hits) and carried enemies
 * to the arena rim and beyond the weapons' reach, where Shielded / shielded_elite shields and Regenerating elites
 * recovered before they walked back: a wave could last forever (docs/BALANCE.md "Stalls and knockback").
 *
 * Rules (knobs: data/base-stats.ts `knockback.*`, cached per rebuild in WorldImpl.knock):
 *  - class scale: bosses ×0.15, Clumps ×0.3, elites ×0.5 (unchanged); Immovable ignores pushes; Rushing enemies take
 *    at most `wave.rush_knockback` (25%).
 *  - an OUTWARD push (away from the tower) never carries the enemy past `reach` = knockback.reach (0.85) × the
 *    primary's range, nor past the arena rim (ARENA_RADIUS − its radius); an enemy already farther out is not pushed
 *    farther (only sideways). One push and any number of pushes are bounded the same way: that is the total cap.
 *  - diminishing returns: the n-th outward push inside `knockback.stack_window` (2 s, restarting on every push) is
 *    ×max(stack_floor, stack_decay^n) = 1, 0.5, 0.25, 0.125, then 0.1 (floor).
 *  - pushes toward the tower (or sideways-in) are unaffected.
 *  - `field` pushes (continuous zone forces such as Safe Harbor, applied every tick) skip the stacking and the rally
 *    bookkeeping but keep the reach / rim cap.
 * Bookkeeping for the enemy side (enemies/recovery.ts): knockT (last push), knockN (stack), rallyR (where it was
 * first pushed from: it walks back at knockback.rally_speed until it is there again).
 */
import type { EnemyPool } from './types';
import { ARENA_RADIUS, EnemyFlag } from './types';

export interface KnockParams {
  /** Outward pushes stop at this distance from the tower (knockback.reach × ballistics.range). */
  reach: number;
  decay: number; floor: number; windowTicks: number;
  /** Rushing enemies' knockback multiplier (wave.rush_knockback). */
  rushMul: number;
  /** Ticks a weapon keeps a just-pushed target (knockback.focus_seconds); read by core/targeting.ts. */
  focusTicks: number;
}

export function newKnockParams(): KnockParams {
  return { reach: 255, decay: 0.5, floor: 0.1, windowTicks: 120, rushMul: 0.25, focusTicks: 60 };
}

const F_BOSS = EnemyFlag.Boss, F_CLUMP = EnemyFlag.Clump, F_ELITE = EnemyFlag.Elite, F_IMMOVABLE = EnemyFlag.Immovable;

/** Strength of the n-th stacked outward push (n = 0 for the first in a window). */
export function stackFactor(n: number, k: KnockParams): number {
  let f = 1;
  for (let j = 0; j < n && f > k.floor; j++) f *= k.decay;
  return f > k.floor ? f : k.floor;
}

/** Push enemy `i` by `force` units along (dx, dy) under the governor's rules. Returns the distance actually moved. */
export function knockbackEnemy(e: EnemyPool, i: number, dx: number, dy: number, force: number, tick: number, k: KnockParams, field: boolean): number {
  const f = e.flags[i];
  if (f & F_IMMOVABLE) return 0;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (l <= 1e-6 || !(force > 0)) return 0;
  let amt = force * ((f & F_BOSS) ? 0.15 : (f & F_CLUMP) ? 0.3 : (f & F_ELITE) ? 0.5 : 1);
  if (e.rushT[i] > 0) amt *= k.rushMul;
  const x0 = e.x[i], y0 = e.y[i];
  const outward = dx * x0 + dy * y0 > 0;
  if (outward && !field) {
    const n = e.knockT[i] > 0 && tick - (e.knockT[i] - 1) < k.windowTicks ? e.knockN[i] : 0;
    amt *= stackFactor(n, k);
    e.knockN[i] = n < 255 ? n + 1 : 255;
    e.knockT[i] = tick + 1;
  }
  let nx = x0 + (dx / l) * amt, ny = y0 + (dy / l) * amt;
  const r0 = Math.sqrt(x0 * x0 + y0 * y0), r1 = Math.sqrt(nx * nx + ny * ny);
  if (r1 > r0) {
    const rim = ARENA_RADIUS - e.radius[i];
    const lim = k.reach < rim ? k.reach : rim;
    const cap = r0 > lim ? r0 : lim;
    if (r1 > cap) { const s = cap / r1; nx *= s; ny *= s; }
  }
  const mx = nx - x0, my = ny - y0;
  e.x[i] = nx; e.y[i] = ny;
  if (outward && !field && Math.sqrt(nx * nx + ny * ny) > r0 + 0.5) {
    const rr = e.rallyR[i];
    e.rallyR[i] = rr > 0 && rr < r0 ? rr : r0;
  }
  return Math.sqrt(mx * mx + my * my);
}
