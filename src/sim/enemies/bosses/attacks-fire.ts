/**
 * Boss attacks, part 1: shots, blasts, hazards, body moves and field effects (WP5).
 * Signature: (world, bossIndex, ctrl, cause) — `cause` is the attack's Ev.Fx event.
 * Damage is bounded (base × 1.06^wave) so every boss is clearable without Counters.
 */
import type { World } from '../../core/world';
import type { BossCtrl } from './state';
import { MOVE_DASH } from './state';
import { EnemyFlag, ProjKind, TOWER_RADIUS } from '../../core/types';
import { cos, sin, PI, TAU } from '../../math/lut';
import { K, ROLE_CLONE, ROLE_GEN, ROLE_NODE } from '../behaviors/kinds';
import {
  angleToTower, bossDmg, distToTower, enemyHazard, fanAtTower, healEnemy, ringShots, shot, towerBlast,
} from './common';

export type AttackFn = (w: World, b: number, c: BossCtrl, cause: number) => void;

const SCR = new Int32Array(256);

/** Every live role add fires one shot at the tower. */
function rolesFire(w: World, c: BossCtrl, role: number, dmg: number, cause: number): number {
  const e = w.enemies;
  let n = 0;
  for (let j = 0; j < e.count; j++) {
    if (e.kind[j] !== K.bossAdd || (e.flags[j] & EnemyFlag.Dead) || e.aiB[j] !== role) continue;
    shot(w, e.x[j], e.y[j], angleToTower(w, j), 190, dmg, 5, cause, c.src, j);
    n++;
  }
  return n;
}

export const FIRE_ATTACKS: Record<string, AttackFn> = {
  stomp_wave(w, b, c, cause) { ringShots(w, b, c, 12, 140, bossDmg(w, 5), cause); },
  charge(w, b, c, cause) {
    const e = w.enemies, d = distToTower(w, b) || 1, stop = TOWER_RADIUS + e.radius[b] + 4;
    c.move = MOVE_DASH; c.mx = (e.x[b] / d) * stop; c.my = (e.y[b] / d) * stop;
    c.mSpeed = Math.max(120, e.speed[b] * 3.5); c.mDmg = bossDmg(w, 18); c.mPass = 0; c.mCause = cause; c.moveT = 150;
  },
  acid_spit(w, b, c, cause) {
    fanAtTower(w, b, c, 3, 0.5, 160, bossDmg(w, 5), cause);
    const a = angleToTower(w, b) + 1.2;
    enemyHazard(w, cos(a) * 36, sin(a) * 36, 22, 3, bossDmg(w, 3), cause, 'enemy_hazard');
  },
  siege_volley(w, b, c, cause) { fanAtTower(w, b, c, 6, 0.6, 150, bossDmg(w, 5), cause, ProjKind.Shell, 7, 26); },
  armor_shed(w, b, c, cause) {
    const e = w.enemies;
    if (e.armor[b] > c.def.armor * 0.5) { e.armor[b] = c.def.armor * 0.5; e.speed[b] = c.def.speed * 1.5; }
    ringShots(w, b, c, 10, 170, bossDmg(w, 4), cause, ProjKind.Fragment);
  },
  devour(w, b, c, cause) {
    const e = w.enemies;
    const n = w.queryRadius(e.x[b], e.y[b], 160, SCR);
    let best = -1, bd = Infinity;
    for (let k = 0; k < n; k++) {
      const j = SCR[k];
      if (j === b || !w.alive(j) || (e.flags[j] & EnemyFlag.Boss) || (e.kind[j] === K.bossAdd && e.aiB[j] !== 0)) continue;
      const dx = e.x[j] - e.x[b], dy = e.y[j] - e.y[b], d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0) {
      const gain = Math.min(e.hp[best] * 0.5, e.maxHp[b] * 0.02);
      w.despawnEnemy(best);
      healEnemy(w, b, gain, c.src, cause);
    } else fanAtTower(w, b, c, 2, 0.3, 170, bossDmg(w, 6), cause);
  },
  grind(w, b, c, cause) {
    if (distToTower(w, b) <= 200) w.damageTower(bossDmg(w, 8), b, cause);
    else fanAtTower(w, b, c, 1, 0, 170, bossDmg(w, 8), cause);
  },
  mirror_volley(w, b, c, cause) {
    rolesFire(w, c, ROLE_CLONE, bossDmg(w, 4), cause);
    fanAtTower(w, b, c, 1, 0, 190, bossDmg(w, 4), cause);
  },
  lightning_strikes(w, _b, c, cause) {
    for (let k = 0; k < 4; k++) {
      const a = w.prng.next() * TAU, r = 20 + w.prng.next() * 90;
      const x = cos(a) * r, y = sin(a) * r;
      towerBlast(w, x, y, 24, bossDmg(w, 5), c.src, -1, cause);
    }
  },
  storm_orbit(w, _b, _c, cause) {
    const a0 = w.prng.next() * TAU;
    for (let k = 0; k < 6; k++) { const a = a0 + (k * TAU) / 6; enemyHazard(w, cos(a) * 50, sin(a) * 50, 30, 3, bossDmg(w, 2), cause); }
  },
  long_lance(w, b, c, cause) { fanAtTower(w, b, c, 1, 0, 320, bossDmg(w, 16), cause, ProjKind.EnemyShot, 8); },
  drain_shield(w, b, c, cause) {
    const t = w.tower;
    const amt = Math.min(bossDmg(w, 10), Math.max(t.shield + t.barrier, bossDmg(w, 3)));
    w.damageTower(amt, b, cause);
    healEnemy(w, b, w.enemies.maxHp[b] * 0.005, c.src, cause);
  },
  fragment_burst(w, b, c, cause) { ringShots(w, b, c, 8, 160, bossDmg(w, 4), cause, ProjKind.Fragment); },
  node_beam(w, b, c, cause) {
    if (rolesFire(w, c, ROLE_NODE, bossDmg(w, 5), cause) === 0) fanAtTower(w, b, c, 2, 0.3, 190, bossDmg(w, 5), cause);
  },
  time_burst(w, b, c, cause) { fanAtTower(w, b, c, 5, 0.35, 220, bossDmg(w, 4), cause); },
  grave_volley(w, b, c, cause) { fanAtTower(w, b, c, 5, 0.7, 170, bossDmg(w, 4), cause); },
  choir_beam(w, b, c, cause) {
    rolesFire(w, c, ROLE_GEN, bossDmg(w, 5), cause);
    fanAtTower(w, b, c, 1, 0, 300, bossDmg(w, 10), cause, ProjKind.EnemyShot, 7);
  },
  dash(w, b, c, cause) {
    const e = w.enemies;
    const a = angleToTower(w, b) + PI + (w.prng.chance(0.5) ? 1.2 : -1.2);
    const r = Math.max(170, Math.min(300, distToTower(w, b)));
    c.move = MOVE_DASH; c.mx = cos(a) * r; c.my = sin(a) * r; c.mSpeed = Math.max(300, e.speed[b] * 4); c.mDmg = 0; c.mPass = 0; c.mCause = cause; c.moveT = 120;
    fanAtTower(w, b, c, 3, 0.3, 200, bossDmg(w, 4), cause);
  },
  afterburn_trail(w, b, _c, cause) {
    const e = w.enemies, d = distToTower(w, b) || 1;
    const px = -e.y[b] / d, py = e.x[b] / d;
    enemyHazard(w, e.x[b] - px * 60, e.y[b] - py * 60, 14, 4, bossDmg(w, 4), cause, 'enemy_hazard', e.x[b] + px * 60, e.y[b] + py * 60);
  },
  bend_projectiles(_w, _b, c) { c.bendT = Math.max(c.bendT, 240); },
  drag_drones(_w, _b, c) { c.dragT = Math.max(c.dragT, 240); },
  collapse(w, b, c, cause) {
    const e = w.enemies;
    const n = w.queryRadius(e.x[b], e.y[b], 300, SCR);
    for (let k = 0; k < n; k++) { const j = SCR[k]; if (j !== b && w.alive(j)) w.pull(j, e.x[b], e.y[b], 240); }
    towerBlast(w, 0, 0, 10, bossDmg(w, 14), c.src, b, cause);
  },
};

