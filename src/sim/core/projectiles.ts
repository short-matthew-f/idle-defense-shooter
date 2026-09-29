/**
 * Projectile movement, collision and impact rules (all sources). Runs once per tick after the
 * systems (see Sim.step). Generic per-projectile behavior is data on the projectile:
 *  - homing (ProjFlag.Homing + target/targetGen), swept collision against the spatial hash
 *  - pierce (count, `retention` × (1 + `pierceSpeed`) damage and speed gain per pierce, LastRites ×4 on the final pierce)
 *  - ricochet (bounces within `bounceRange`, damage × `retention`; ReturnFire revisits struck enemies)
 *  - blast > 0: each impact is an explosion instead of a direct hit
 *  - knock (knockback units), Stagger (elites 0.6 s, bosses: interrupt via staggerT)
 *  - execBonus (bonus vs enemies below 30% HP), crit roll at impact (critChance/critMul)
 *  - Hostile: ignores enemies, damages the tower on contact
 * Projectiles leave play when life runs out or they fly past the arena edge.
 */
import type { WorldImpl } from './world-impl';
import type { WeaponSystemId, ElementId } from './ids';
import { EnemyFlag, NO_ENTITY, ProjFlag, TICK_DT, TOWER_RADIUS, ARENA_RADIUS } from './types';
import { SYSTEM_ORDER_IDS, ELEMENT_ORDER } from '../data/index';
import { targetable } from './spatial';

const SCRATCH = new Int32Array(512);
const OUT_R2 = (ARENA_RADIUS + 160) * (ARENA_RADIUS + 160);
const HOMING_TURN = 0.12;   // blend factor per tick toward the target direction

function genBit(gen: number): number { return 1 << (gen & 31); }

export function updateProjectiles(w: WorldImpl): void {
  const p = w.projectiles, e = w.enemies;
  const n = p.count;
  for (let i = 0; i < n; i++) {
    if (p.flags[i] & ProjFlag.Dead) continue;
    if (p.life[i] === 0) { w.freeProjectile(i); continue; }
    p.life[i]--;
    const flags = p.flags[i];
    if (flags & ProjFlag.Homing) {
      let t = p.target[i];
      if (t >= 0 && (t >= e.count || e.gen[t] !== p.targetGen[i] || (e.flags[t] & EnemyFlag.Dead))) { t = NO_ENTITY; p.target[i] = NO_ENTITY; }
      if (t >= 0) {
        const vx = p.vx[i], vy = p.vy[i];
        const sp = Math.sqrt(vx * vx + vy * vy);
        const dx = e.x[t] - p.x[i], dy = e.y[t] - p.y[i];
        const dl = Math.sqrt(dx * dx + dy * dy);
        if (dl > 1e-6 && sp > 1e-6) {
          let nx = vx / sp + (dx / dl - vx / sp) * HOMING_TURN, ny = vy / sp + (dy / dl - vy / sp) * HOMING_TURN;
          const nl = Math.sqrt(nx * nx + ny * ny) || 1;
          nx /= nl; ny /= nl;
          p.vx[i] = nx * sp; p.vy[i] = ny * sp;
        }
      }
    }
    const x0 = p.x[i], y0 = p.y[i];
    const x1 = x0 + p.vx[i] * TICK_DT, y1 = y0 + p.vy[i] * TICK_DT;
    p.x[i] = x1; p.y[i] = y1;
    if (flags & ProjFlag.Hostile) {
      const rr = TOWER_RADIUS + p.radius[i];
      if (x1 * x1 + y1 * y1 <= rr * rr) { w.damageTower(p.damage[i], p.target[i], p.cause[i]); w.freeProjectile(i); }
      else if (x1 * x1 + y1 * y1 > OUT_R2) w.freeProjectile(i);
      continue;
    }
    // swept collision; a piercing round can strike several enemies along one tick's segment
    let guard = 0;
    let sx = x0, sy = y0;
    while (guard++ < 8) {
      const hit = firstHit(w, i, sx, sy, p.x[i], p.y[i]);
      if (hit < 0) break;
      sx = e.x[hit]; sy = e.y[hit];
      if (impact(w, i, hit) !== IMPACT_PIERCED) break;
    }
    if ((p.flags[i] & ProjFlag.Dead) === 0) {
      const px = p.x[i], py = p.y[i];
      if (px * px + py * py > OUT_R2) w.freeProjectile(i);
    }
  }
}

/** First enemy touched along segment (x0,y0)→(x1,y1), skipping already-struck ones. */
function firstHit(w: WorldImpl, i: number, x0: number, y0: number, x1: number, y1: number): number {
  const p = w.projectiles, e = w.enemies;
  const dx = x1 - x0, dy = y1 - y0;
  const L2 = dx * dx + dy * dy;
  const half = Math.sqrt(L2) * 0.5;
  const r = p.radius[i];
  const n = w.spatial.queryRadius((x0 + x1) * 0.5, (y0 + y1) * 0.5, half + r, SCRATCH);
  let best = NO_ENTITY, bestT = Infinity;
  const last = p.lastHit[i], mask = p.hitMask[i];
  for (let k = 0; k < n; k++) {
    const j = SCRATCH[k];
    if (j === last || !targetable(e, j)) continue;
    if (mask !== 0 && (mask & genBit(e.gen[j])) !== 0) continue;
    const cx = e.x[j] - x0, cy = e.y[j] - y0;
    let t = L2 > 0 ? (cx * dx + cy * dy) / L2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const qx = cx - dx * t, qy = cy - dy * t;
    const rr = r + e.radius[j];
    if (qx * qx + qy * qy > rr * rr) continue;
    if (t < bestT || (t === bestT && j < best)) { best = j; bestT = t; }
  }
  return best;
}

const IMPACT_ENDED = 0, IMPACT_PIERCED = 1, IMPACT_BOUNCED = 2;

function impact(w: WorldImpl, i: number, enemy: number): number {
  const p = w.projectiles, e = w.enemies;
  const flags = p.flags[i];
  const source = (SYSTEM_ORDER_IDS[p.source[i]] ?? 'primary') as WeaponSystemId;
  const srcTag = w.tagName(p.tag[i]);
  const element = p.element[i] > 0 ? (ELEMENT_ORDER[p.element[i] - 1] as ElementId) : null;
  const hx = e.x[enemy], hy = e.y[enemy];
  let dmg = p.damage[i];
  let crit = (flags & ProjFlag.Crit) !== 0;
  if (!crit && p.critChance[i] > 0) {
    crit = w.prng.chance(p.critChance[i]);
    if (!crit && w.stats.hasAnomaly('loaded_dice')) crit = w.prng.chance(p.critChance[i]);
  }
  if (crit) dmg *= p.critMul[i];
  if (p.execBonus[i] > 0 && e.hp[enemy] < 0.3 * e.maxHp[enemy]) dmg *= 1 + p.execBonus[i];
  if ((flags & ProjFlag.LastRites) && p.pierce[i] === 0 && p.pierced[i] > 0) dmg *= 4;
  const gen = e.gen[enemy];
  if (p.blast[i] > 0) {
    w.explode(p.x[i], p.y[i], p.blast[i], dmg, { source, srcTag, element, cause: p.cause[i] });
  } else {
    const hit = w.damage(enemy, dmg, { source, srcTag, crit, element, projectile: i, cause: p.cause[i], x: p.x[i], y: p.y[i] });
    if (!hit.killed) {
      if (p.knock[i] > 0) w.knockback(enemy, p.vx[i], p.vy[i], p.knock[i]);
      if (flags & ProjFlag.Stagger) {
        const f = e.flags[enemy];
        if (f & EnemyFlag.Boss) { if (e.staggerT[enemy] < 20) e.staggerT[enemy] = 20; }
        else if (f & EnemyFlag.Elite) { if (e.staggerT[enemy] < 36) e.staggerT[enemy] = 36; }
      }
    }
  }
  if (p.flags[i] & ProjFlag.Dead) return IMPACT_ENDED;   // a hook may have consumed it
  p.lastHit[i] = enemy;
  p.hitMask[i] |= genBit(gen);
  if (p.pierce[i] > 0) {
    p.pierce[i]--;
    if (p.pierced[i] < 255) p.pierced[i]++;
    const gain = 1 + p.pierceSpeed[i];
    p.damage[i] *= p.retention[i] * gain;
    p.vx[i] *= gain; p.vy[i] *= gain;
    return IMPACT_PIERCED;
  }
  if (p.bounces[i] > 0) {
    const next = bounceTarget(w, i, hx, hy, enemy);
    if (next >= 0) {
      p.bounces[i]--;
      const sp = Math.sqrt(p.vx[i] * p.vx[i] + p.vy[i] * p.vy[i]);
      const dx = e.x[next] - hx, dy = e.y[next] - hy;
      const dl = Math.sqrt(dx * dx + dy * dy) || 1;
      p.vx[i] = (dx / dl) * sp; p.vy[i] = (dy / dl) * sp;
      p.x[i] = hx; p.y[i] = hy;
      p.damage[i] *= p.retention[i];
      // give the bounce enough life to reach its new target
      const needed = Math.ceil(dl / Math.max(1, sp * TICK_DT)) + 4;
      if (p.life[i] < needed) p.life[i] = Math.min(65535, needed);
      return IMPACT_BOUNCED;
    }
  }
  w.freeProjectile(i);
  return IMPACT_ENDED;
}

function bounceTarget(w: WorldImpl, i: number, x: number, y: number, exclude: number): number {
  const p = w.projectiles, e = w.enemies;
  const range = p.bounceRange[i] > 0 ? p.bounceRange[i] : 120;
  const n = w.spatial.queryRadius(x, y, range, SCRATCH);
  const mask = p.hitMask[i];
  let best = NO_ENTITY, bestD = Infinity, revisit = NO_ENTITY, revisitD = Infinity;
  for (let k = 0; k < n; k++) {
    const j = SCRATCH[k];
    if (j === exclude || !targetable(e, j)) continue;
    const dx = e.x[j] - x, dy = e.y[j] - y, d = dx * dx + dy * dy;
    if ((mask & genBit(e.gen[j])) !== 0) { if (d < revisitD || (d === revisitD && j < revisit)) { revisit = j; revisitD = d; } continue; }
    if (d < bestD || (d === bestD && j < best)) { best = j; bestD = d; }
  }
  if (best >= 0) return best;
  if (p.flags[i] & ProjFlag.ReturnFire) {
    if (revisit >= 0) p.hitMask[i] = 0;   // allow the revisit to connect
    return revisit;
  }
  return NO_ENTITY;
}
