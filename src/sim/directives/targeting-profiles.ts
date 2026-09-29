/**
 * Targeting Profiles (design §11) and the enemy pickers Directives use. WP9.
 *
 * The per-system profile lives in `build.targeting[system]` (core `set_targeting` command) and is
 * applied by core/targeting.ts `selectTarget`, which already implements all eight profiles:
 *   nearest           spatial nearest to the shooter
 *   closest_to_tower  smallest distance to (0,0) among enemies in range
 *   lowest_hp / highest_hp   current HP (ties: nearest to the shooter)
 *   elites            elites and bosses first, then nearest
 *   support           support / healer / warden (Shielder) enemies first, then nearest
 *   fastest           highest speed × speedMul first
 *   designated        the designated enemy (any profile prefers a live designated enemy in range);
 *                     falls back to nearest
 * Ties always break on distance, then the lower pool index (deterministic).
 *
 * Pickers here are allocation-free and deterministic (ascending pool index, lower index wins ties).
 */
import type { World } from '../core/world';
import type { TargetingProfile } from '../core/ids';
import { EnemyFlag, NO_ENTITY } from '../core/types';
import { targetable } from '../core/spatial';

export const TARGETING_PROFILES: readonly TargetingProfile[] = [
  'nearest', 'closest_to_tower', 'lowest_hp', 'highest_hp', 'elites', 'support', 'fastest', 'designated',
];
export function isTargetingProfile(p: unknown): p is TargetingProfile { return TARGETING_PROFILES.includes(p as TargetingProfile); }

/** Live, targetable, hostile (not an Ally) enemy? */
export function hostile(w: World, i: number): boolean {
  const e = w.enemies;
  return i >= 0 && i < e.count && (e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally)) === 0 && targetable(e, i);
}

/** First live boss by pool index, or NO_ENTITY. */
export function findBoss(w: World): number {
  const e = w.enemies;
  for (let i = 0; i < e.count; i++) if ((e.flags[i] & EnemyFlag.Boss) && hostile(w, i)) return i;
  return NO_ENTITY;
}

/** Nearest hostile enemy to (x,y) carrying any of `mask` flags (mask 0 = any). */
export function nearestWith(w: World, x: number, y: number, mask: number): number {
  const e = w.enemies;
  let best = NO_ENTITY, bestD = Infinity;
  for (let i = 0; i < e.count; i++) {
    if (!hostile(w, i) || (mask !== 0 && (e.flags[i] & mask) === 0)) continue;
    const dx = e.x[i] - x, dy = e.y[i] - y, d = dx * dx + dy * dy;
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/**
 * Threat score: how badly an enemy wants to be dealt with now. Bosses ≫ elites > kamikazes > support >
 * others, scaled up the closer it is to the tower.
 */
export function threatScore(w: World, i: number): number {
  const e = w.enemies, f = e.flags[i];
  let weight = 1;
  if (f & EnemyFlag.Boss) weight = 100;
  else if (f & EnemyFlag.Elite) weight = 12;
  else if (f & EnemyFlag.Kamikaze) weight = 6;
  else if (f & (EnemyFlag.Healer | EnemyFlag.Shielder | EnemyFlag.Support)) weight = 4;
  const d = Math.sqrt(e.x[i] * e.x[i] + e.y[i] * e.y[i]);
  return weight / (d + 60);
}

export function highestThreat(w: World): number {
  const e = w.enemies;
  let best = NO_ENTITY, bestS = -1;
  for (let i = 0; i < e.count; i++) {
    if (!hostile(w, i)) continue;
    const s = threatScore(w, i);
    if (s > bestS) { best = i; bestS = s; }
  }
  return best;
}

/** Enemy to designate for a Directive `designate` action, or NO_ENTITY when there is none. */
export function pickDesignation(w: World, what: 'highest_threat' | 'healer' | 'warden' | 'weak_point' | 'nearest_kamikaze'): number {
  switch (what) {
    case 'highest_threat': return highestThreat(w);
    case 'healer': return nearestWith(w, 0, 0, EnemyFlag.Healer);
    case 'warden': return nearestWith(w, 0, 0, EnemyFlag.Shielder);
    case 'weak_point': return nearestWith(w, 0, 0, EnemyFlag.WeakPointOpen);
    case 'nearest_kamikaze': return nearestWith(w, 0, 0, EnemyFlag.Kamikaze);
  }
}

const MAX_SAMPLES = 64;
const CACHE = 4;

/**
 * Densest cluster finder: samples up to 64 hostile enemies at a fixed stride (deterministic), counts
 * hostiles within `radius` of each sample, keeps the best (lower index on ties) and returns its size;
 * `out[0], out[1]` receive the centroid of that neighborhood. Results are cached per (tick, radius).
 */
export class GroupFinder {
  private buf = new Int32Array(2048);
  private cTick = new Int32Array(CACHE).fill(-1);
  private cR = new Float32Array(CACHE);
  private cN = new Int32Array(CACHE);
  private cX = new Float32Array(CACHE); private cY = new Float32Array(CACHE);
  private next = 0;

  largest(w: World, radius: number, out: Float32Array): number {
    const tick = w.tick;
    for (let k = 0; k < CACHE; k++) {
      if (this.cTick[k] === tick && this.cR[k] === radius) { out[0] = this.cX[k]; out[1] = this.cY[k]; return this.cN[k]; }
    }
    const e = w.enemies, n = e.count;
    const stride = Math.max(1, Math.ceil(n / MAX_SAMPLES));
    let bestN = 0, bestI = NO_ENTITY;
    for (let i = 0; i < n; i += stride) {
      const s = this.firstHostileFrom(w, i, Math.min(n, i + stride));
      if (s < 0) continue;
      const c = this.countNear(w, e.x[s], e.y[s], radius);
      if (c > bestN) { bestN = c; bestI = s; }
    }
    let cx = 0, cy = 0;
    if (bestI >= 0) {
      const m = w.queryRadius(e.x[bestI], e.y[bestI], radius, this.buf);
      let k2 = 0;
      for (let j = 0; j < m; j++) { const i = this.buf[j]; if (hostile(w, i)) { cx += e.x[i]; cy += e.y[i]; k2++; } }
      if (k2 > 0) { cx /= k2; cy /= k2; }
    }
    const slot = this.next; this.next = (this.next + 1) % CACHE;
    this.cTick[slot] = tick; this.cR[slot] = radius; this.cN[slot] = bestN; this.cX[slot] = cx; this.cY[slot] = cy;
    out[0] = cx; out[1] = cy;
    return bestN;
  }

  /** Hostile enemies within `r` of (x,y). */
  countNear(w: World, x: number, y: number, r: number): number {
    const m = w.queryRadius(x, y, r, this.buf);
    let c = 0;
    for (let j = 0; j < m; j++) if (hostile(w, this.buf[j])) c++;
    return c;
  }

  invalidate(): void { this.cTick.fill(-1); }

  private firstHostileFrom(w: World, lo: number, hi: number): number {
    for (let i = lo; i < hi; i++) if (hostile(w, i)) return i;
    return NO_ENTITY;
  }
}
