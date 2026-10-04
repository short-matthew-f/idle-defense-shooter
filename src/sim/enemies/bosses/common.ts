/**
 * Helpers shared by boss attack scripts (WP5). Every hostile effect goes through World methods
 * with a cause event and the boss srcTag ('boss.<id>'); damage to the tower is bounded:
 * base × 1.06^wave (the contact-damage curve), so every boss is clearable by DPS alone.
 */
import type { World } from '../../core/world';
import type { BossCtrl } from './state';
import type { Hazard } from '../../core/types';
import { EnemyFlag, Ev, MAX_ENEMIES, NO_ENTITY, ProjFlag, ProjKind, TICK_RATE, TOWER_RADIUS, ARENA_RADIUS } from '../../core/types';
import { atan2, cos, sin, growth, TAU } from '../../math/lut';
import { CONTACT_GROWTH } from '../../economy/curves';
import { K } from '../behaviors/kinds';

/** Boss scripts stop summoning past this many live enemies (performance + fairness). */
export const ADD_CAP = 420;

export function bossDmg(w: World, base: number): number { return base * growth(CONTACT_GROWTH, w.run.wave); }

/** One event per attack firing: Ev.Fx, src 'boss.<id>', a = attack code, b = phase. Cause of everything the attack does. */
export function attackEvent(w: World, b: number, c: BossCtrl, code: number): number {
  const e = w.enemies;
  return w.emit(Ev.Fx, c.src, code, c.phase, e.x[b], e.y[b], e.spawnEv[b]);
}

export function angleToTower(w: World, b: number): number { const e = w.enemies; return atan2(-e.y[b], -e.x[b]); }
export function distToTower(w: World, b: number): number { const e = w.enemies; return Math.sqrt(e.x[b] * e.x[b] + e.y[b] * e.y[b]); }

/** A hostile shot from (x,y) at `angle`. Hostile projectiles only collide with the tower. */
export function shot(w: World, x: number, y: number, angle: number, speed: number, dmg: number, radius: number, cause: number, src: string, shooter: number, kind: number = ProjKind.EnemyShot, blast = 0): number {
  const d = Math.sqrt(x * x + y * y);
  const life = Math.min(60000, Math.ceil(((d + 200) / Math.max(20, speed)) * TICK_RATE));
  return w.spawnProjectile({ kind, flags: ProjFlag.Hostile, x, y, vx: cos(angle) * speed, vy: sin(angle) * speed, damage: dmg, radius, life, target: shooter, cause, srcTag: src, blast });
}

/** n shots fanned over `spread` radians centered on the tower direction. */
export function fanAtTower(w: World, b: number, c: BossCtrl, n: number, spread: number, speed: number, dmg: number, cause: number, kind: number = ProjKind.EnemyShot, radius = 6, blast = 0): void {
  const e = w.enemies, a0 = angleToTower(w, b);
  for (let k = 0; k < n; k++) {
    const a = n === 1 ? a0 : a0 - spread * 0.5 + (spread * k) / (n - 1);
    shot(w, e.x[b], e.y[b], a, speed, dmg, radius, cause, c.src, b, kind, blast);
  }
}

/** A ring of n shots around the boss (only the ones headed at the tower can land). */
export function ringShots(w: World, b: number, c: BossCtrl, n: number, speed: number, dmg: number, cause: number, kind: number = ProjKind.EnemyShot): void {
  const e = w.enemies, a0 = angleToTower(w, b);
  for (let k = 0; k < n; k++) shot(w, e.x[b], e.y[b], a0 + (TAU * k) / n, speed, dmg, 5, cause, c.src, b, kind);
}

export function canSpawn(w: World): boolean { return w.enemies.count < Math.min(ADD_CAP, MAX_ENEMIES - 40); }

/** Spawn n enemies of `kind` on a ring of radius `dist` around the boss (toward the arena, clamped inside). */
export function spawnAround(w: World, b: number, kind: string, n: number, dist: number, cause: number, hpScale = 1, elite?: readonly string[]): number {
  const e = w.enemies;
  const bx = e.x[b], by = e.y[b];
  const a0 = atan2(by, bx);
  let made = 0;
  for (let k = 0; k < n; k++) {
    if (!canSpawn(w)) break;
    const a = a0 + (TAU * (k + 0.5)) / Math.max(1, n);
    let x = bx + cos(a) * dist, y = by + sin(a) * dist;
    const r = Math.sqrt(x * x + y * y), lim = ARENA_RADIUS + 40;
    if (r > lim) { x *= lim / r; y *= lim / r; }
    const j = w.spawnEnemy(kind, x, y, { hpScale, cause, elite });
    if (j >= 0) made++;
  }
  return made;
}

/** Spawn a role boss_add (clone, node, generator, turret) at (x,y); returns its index or NO_ENTITY. */
export function spawnRole(w: World, b: number, role: number, slot: number, x: number, y: number, cause: number, hpScale: number): number {
  if (w.enemies.count >= MAX_ENEMIES - 8) return NO_ENTITY;
  const j = w.spawnEnemy('boss_add', x, y, { hpScale, cause });
  if (j < 0) return NO_ENTITY;
  const e = w.enemies;
  e.aiB[j] = role; e.aiA[j] = slot;
  e.contact[j] = 0;
  if (role === 2) { e.bossId[j] = e.bossId[b]; e.radius[j] = e.radius[b]; e.speed[j] = e.speed[b]; }
  return j;
}

/** Live boss_adds with this role (optionally with slot === aiA). */
export function findRole(w: World, role: number, slot = -1): number {
  const e = w.enemies;
  for (let j = 0; j < e.count; j++) {
    if (e.kind[j] !== K.bossAdd || (e.flags[j] & EnemyFlag.Dead) || e.aiB[j] !== role) continue;
    if (slot < 0 || e.aiA[j] === slot) return j;
  }
  return NO_ENTITY;
}
export function countRole(w: World, role: number): number {
  const e = w.enemies;
  let n = 0;
  for (let j = 0; j < e.count; j++) if (e.kind[j] === K.bossAdd && !(e.flags[j] & EnemyFlag.Dead) && e.aiB[j] === role) n++;
  return n;
}

/** Hostile hazard (owner 'enemy': damages the tower while the tower is inside; `life` in seconds). */
export function enemyHazard(w: World, x: number, y: number, radius: number, lifeS: number, dps: number, cause: number, kind: Hazard['kind'] = 'enemy_hazard', x2?: number, y2?: number): void {
  const h: Hazard = { kind, x, y, radius, life: lifeS, dps, cause, owner: 'enemy' };
  if (x2 !== undefined && y2 !== undefined) { h.x2 = x2; h.y2 = y2; }
  w.addHazard(h);
}

/** A hostile blast: Explosion event (fx) and tower damage if the tower is inside. */
export function towerBlast(w: World, x: number, y: number, radius: number, dmg: number, src: string, shooter: number, cause: number): void {
  const id = w.emit(Ev.Explosion, src, radius, dmg, x, y, cause);
  const rr = radius + TOWER_RADIUS;
  if (x * x + y * y <= rr * rr) w.damageTower(dmg, shooter, id);
}

/** Heal an enemy through World.healEnemy (emits Ev.Heal: a = enemy, b = amount). Kept as the bosses' import point. */
export function healEnemy(w: World, j: number, amount: number, src: string, cause: number): number {
  return w.healEnemy(j, amount, src, cause);
}

/** Add shield to an enemy, raising its cap to at least `capFrac` of max HP. */
export function addShield(w: World, j: number, amount: number, capFrac: number): void {
  const e = w.enemies;
  if (e.rushT[j] > 0) return;   // Rushing enemies (run/stall.ts) gain no shields: the escalation must end the wave
  const cap = e.maxHp[j] * capFrac;
  if (e.maxShield[j] < cap) e.maxShield[j] = cap;
  e.shield[j] = Math.min(e.maxShield[j], e.shield[j] + amount);
}

/** Zero every status stack and duration (Nullifier / Null Field). */
export function stripStatuses(w: World, j: number): void {
  const e = w.enemies;
  e.burn[j] = 0; e.burnT[j] = 0; e.poison[j] = 0; e.poisonT[j] = 0; e.chill[j] = 0; e.chillT[j] = 0;
  e.shock[j] = 0; e.shockT[j] = 0; e.bleed[j] = 0; e.bleedT[j] = 0; e.brittle[j] = 0; e.brittleT[j] = 0;
  e.staticStacks[j] = 0; e.staticT[j] = 0;
}

/** Segment helpers live in math/geom.ts (shared with hardpoints and hazards). */
export { segDist, segmentsCross } from '../../math/geom';
