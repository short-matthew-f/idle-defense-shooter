/**
 * Target selection by Targeting Profile (design §11). Deterministic: candidates come from the
 * spatial hash in its fixed scan order and ties break on the lower pool index.
 * A live designated enemy in range always wins ("every weapon that can reach it strongly prefers it").
 * Targeting Logic (reactor.targeting_logic, WorldImpl.nearestEnemy passes a TargetFilter): rank 1 ranks enemies already
 * doomed by damage in flight last, rank 3 ranks enemies another hardpoint claimed this tick after unclaimed ones
 * (rank 2, leading, lives in the aiming systems). Both only reorder candidates: with nothing better, the weapon still fires.
 */
import type { EnemyPool, ProjectilePool, TowerState } from './types';
import { EnemyFlag, MAX_ENEMIES, NO_ENTITY, ProjFlag } from './types';
import type { TargetingProfile } from './ids';
import type { SpatialHash } from './spatial';
import { targetable } from './spatial';

const SCRATCH = new Int32Array(4096);
const SUPPORT = EnemyFlag.Support | EnemyFlag.Healer | EnemyFlag.Shielder;
const PRIORITY = EnemyFlag.Elite | EnemyFlag.Boss;

function inRange(p: EnemyPool, i: number, x: number, y: number, maxR: number): boolean {
  const dx = p.x[i] - x, dy = p.y[i] - y, rr = maxR + p.radius[i];
  return dx * dx + dy * dy <= rr * rr;
}

export function designatedInRange(p: EnemyPool, tower: TowerState, x: number, y: number, maxR: number): number {
  const d = tower.designated;
  if (d >= 0 && d < p.count && p.gen[d] === tower.designatedGen && targetable(p, d) && inRange(p, d, x, y, maxR)) return d;
  const d2 = tower.designated2;
  if (d2 >= 0 && d2 < p.count && p.gen[d2] === tower.designated2Gen && targetable(p, d2) && inRange(p, d2, x, y, maxR)) return d2;
  return NO_ENTITY;
}

/**
 * Targeting Logic filter. `doomed`: damage in flight per enemy index (projectiles aimed at it); an enemy whose incoming
 * damage (after armor) covers its HP + shield is doomed. `claimed`: per enemy index, the `stamp` of the tick a hardpoint
 * last picked it (null for the primary, which never avoids).
 */
export interface TargetFilter { doomed: Float32Array | null; claimed: Int32Array | null; stamp: number }

/** Avoidance class: 0 free, 1 claimed by another hardpoint this tick, 2 doomed. */
export function avoidClass(p: EnemyPool, i: number, f: TargetFilter): number {
  if (f.doomed !== null) {
    const inc = f.doomed[i];
    if (inc > 0) { const ar = p.armor[i]; if ((ar > 0 ? (inc * 100) / (100 + ar) : inc) >= p.hp[i] + p.shield[i]) return 2; }
  }
  return f.claimed !== null && f.claimed[i] === f.stamp ? 1 : 0;
}

/**
 * Pick a target, with stickiness: when `prev` (the caller's current target) is still live, targetable and in
 * range, it is kept unless the new best is materially better for the profile (20% closer, 20% lower/higher HP,
 * a strictly better priority class). Equidistant enemies therefore never cause the turret to flip-flop.
 * Knockback focus: for the distance profiles, a `prev` pushed by knockback within the last `focusTicks` (at tick `now`;
 * EnemyPool.knockT) is kept outright, so a push never makes the weapon drop its target for the next enemy in line
 * (spreading fire across a crowd let shields regenerate between hits: docs/BALANCE.md "Stalls and knockback").
 */
export function selectTarget(p: EnemyPool, hash: SpatialHash, tower: TowerState, x: number, y: number, maxR: number, profile: TargetingProfile, prev: number = NO_ENTITY, filter: TargetFilter | null = null, now = 0, focusTicks = 0): number {
  const des = designatedInRange(p, tower, x, y, maxR);
  if (des !== NO_ENTITY) return des;
  const prevOk = prev >= 0 && prev < p.count && targetable(p, prev) && inRange(p, prev, x, y, maxR);
  const pushed = prevOk && focusTicks > 0 && p.knockT[prev] > 0 && now - (p.knockT[prev] - 1) < focusTicks;
  if (filter === null && (profile === 'nearest' || profile === 'designated')) {
    if (pushed) return prev;
    const best = hash.nearest(x, y, maxR);
    if (!prevOk || best === NO_ENTITY || best === prev) return best;
    return dist2(p, best, x, y) < dist2(p, prev, x, y) * STICKY_DIST2 ? best : prev;
  }
  const n = hash.queryRadius(x, y, maxR, SCRATCH);
  let best = NO_ENTITY, bestK0 = Infinity, bestK1 = Infinity, bestK2 = Infinity;
  for (let k = 0; k < n; k++) {
    const i = SCRATCH[k];
    if (!targetable(p, i)) continue;
    const k0 = filter !== null ? avoidClass(p, i, filter) : 0;
    const dx = p.x[i] - x, dy = p.y[i] - y;
    const d = dx * dx + dy * dy;
    let k1 = 0, k2 = d;
    switch (profile) {
      case 'closest_to_tower': k2 = p.x[i] * p.x[i] + p.y[i] * p.y[i]; break;
      case 'lowest_hp': k1 = p.hp[i]; break;
      case 'highest_hp': k1 = -p.hp[i]; break;
      case 'elites': k1 = (p.flags[i] & PRIORITY) !== 0 ? 0 : 1; break;
      case 'support': k1 = (p.flags[i] & SUPPORT) !== 0 ? 0 : 1; break;
      case 'fastest': k1 = -(p.speed[i] * p.speedMul[i]); break;
      default: break;
    }
    if (k0 < bestK0 || (k0 === bestK0 && (k1 < bestK1 || (k1 === bestK1 && (k2 < bestK2 || (k2 === bestK2 && i < best)))))) { best = i; bestK0 = k0; bestK1 = k1; bestK2 = k2; }
  }
  if (!prevOk || best === NO_ENTITY || best === prev) return best;
  if (filter !== null) {
    const pk = avoidClass(p, prev, filter);
    if (pk > bestK0) return best;          // the current target became doomed / was claimed: move on
    if (pk < bestK0) return prev;
  }
  switch (profile) {
    case 'nearest': case 'designated': return pushed || dist2(p, best, x, y) >= dist2(p, prev, x, y) * STICKY_DIST2 ? prev : best;
    case 'closest_to_tower': return pushed || dist2(p, best, 0, 0) >= dist2(p, prev, 0, 0) * STICKY_DIST2 ? prev : best;
    case 'lowest_hp': return p.hp[best] < p.hp[prev] * 0.8 ? best : prev;
    case 'highest_hp': return p.hp[best] > p.hp[prev] * 1.25 ? best : prev;
    case 'fastest': return p.speed[best] * p.speedMul[best] > p.speed[prev] * p.speedMul[prev] * 1.25 ? best : prev;
    case 'elites': return (p.flags[best] & PRIORITY) !== 0 && (p.flags[prev] & PRIORITY) === 0 ? best : prev;
    case 'support': return (p.flags[best] & SUPPORT) !== 0 && (p.flags[prev] & SUPPORT) === 0 ? best : prev;
    default: return best;
  }
}

/** A new target must be at least 20% closer (0.8² on squared distance) to displace the current one. */
const STICKY_DIST2 = 0.64;
function dist2(p: EnemyPool, i: number, x: number, y: number): number { const dx = p.x[i] - x, dy = p.y[i] - y; return dx * dx + dy * dy; }

/**
 * Reactor Targeting Logic bookkeeping owned by WorldImpl (nearestEnemy / spawnProjectile call in). `rank` 0 = off.
 * Damage in flight per enemy index is built lazily once per tick from the projectile pool (player projectiles with a
 * target) and kept current by `launched`; pool indices do not move within a tick (compaction runs at endTick).
 * Hardpoint picks claim their target for the rest of the tick (rank 3).
 */
export class TargetingLogic {
  rank = 0;
  private readonly f: TargetFilter = { doomed: null, claimed: null, stamp: 0 };
  private readonly claimed = new Int32Array(MAX_ENEMIES);
  private readonly incoming = new Float32Array(MAX_ENEMIES);
  private incomingTick = -1;

  setRank(v: number): void { this.rank = Math.max(0, Math.min(3, Math.floor(v + 1e-9))); this.incomingTick = -1; }
  reset(): void { this.incomingTick = -1; }

  /** The filter for one pick this tick; `hardpoint` picks avoid other hardpoints' claims at rank 3. */
  filter(e: EnemyPool, p: ProjectilePool, tick: number, hardpoint: boolean): TargetFilter {
    const f = this.f;
    f.doomed = this.damageInFlight(e, p, tick);
    f.claimed = this.rank >= 3 && hardpoint ? this.claimed : null;
    f.stamp = tick + 1;
    return f;
  }
  /** Record a hardpoint's pick (rank 3). */
  claim(f: TargetFilter, target: number): void { if (f.claimed !== null && target >= 0) this.claimed[target] = f.stamp; }

  /** A projectile launched this tick at `target` adds its damage to the target's damage in flight. */
  launched(tick: number, target: number, enemyCount: number, flags: number, damage: number): void {
    if (this.incomingTick === tick && target >= 0 && target < enemyCount && (flags & ProjFlag.Hostile) === 0) this.incoming[target] += damage;
  }

  private damageInFlight(e: EnemyPool, p: ProjectilePool, tick: number): Float32Array {
    const inc = this.incoming;
    if (this.incomingTick === tick) return inc;
    this.incomingTick = tick;
    inc.fill(0, 0, e.count);
    for (let j = 0; j < p.count; j++) {
      const t = p.target[j];
      if (t < 0 || t >= e.count || (p.flags[j] & (ProjFlag.Dead | ProjFlag.Hostile)) || e.gen[t] !== p.targetGen[j]) continue;
      inc[t] += p.damage[j];
    }
    return inc;
  }
}
