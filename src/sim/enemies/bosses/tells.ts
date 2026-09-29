/**
 * Boss tells (design §10, §13): the telegraphed signature attacks. Each tell has
 *  - start:     sets the Counter focus (a point, a lane/wall segment, or the enemy to designate) and
 *               the wind-up (movement, helpers such as clones/nodes/generators)
 *  - fire:      the window ended uncountered — the attack happens (bounded damage)
 *  - countered: the right ability/designation landed in the window — the attack fails (plus its
 *               specific consequence: stagger, stall, severed links ...). The controller opens the
 *               weak point and refunds CE.
 * TELL_COUNTERS (data/bosses.ts) maps every tell id to its Counter.
 */
import type { World } from '../../core/world';
import type { BossCtrl } from './state';
import { MOVE_DASH, MOVE_HOLD, MOVE_NONE, MOVE_RETREAT, bossState } from './state';
import { EnemyFlag, ProjKind, TOWER_RADIUS } from '../../core/types';
import { cos, sin, PI, TAU } from '../../math/lut';
import { K, ROLE_CLONE, ROLE_GEN, ROLE_NODE } from '../behaviors/kinds';
import {
  addShield, angleToTower, bossDmg, canSpawn, distToTower, enemyHazard, fanAtTower, findRole, ringShots, shot,
  spawnAround, spawnRole, towerBlast,
} from './common';

export interface TellScript {
  start(w: World, b: number, c: BossCtrl): void;
  fire(w: World, b: number, c: BossCtrl, cause: number): void;
  countered?(w: World, b: number, c: BossCtrl, cause: number): void;
}

const SCR = new Int32Array(256);

function focusBoss(w: World, b: number, c: BossCtrl): void {
  const e = w.enemies;
  c.fx = e.x[b]; c.fy = e.y[b]; c.fr = e.radius[b]; c.seg = false;
  c.wantIndex = b; c.wantGen = e.gen[b];
}

/** Keep at least n Mirror Hive clones around the boss. */
export function ensureClones(w: World, b: number, n: number, cause: number): void {
  const e = w.enemies;
  let have = 0;
  for (let j = 0; j < e.count; j++) if (e.kind[j] === K.bossAdd && !(e.flags[j] & EnemyFlag.Dead) && e.aiB[j] === ROLE_CLONE) have++;
  const d = distToTower(w, b), a0 = angleToTower(w, b) + PI;
  for (let k = have; k < n; k++) {
    const a = a0 + (k % 2 === 0 ? 1 : -1) * (0.35 + 0.3 * (k >> 1));
    spawnRole(w, b, ROLE_CLONE, k, cos(a) * d, sin(a) * d, cause, 4);
  }
}

/** Keep the four Null Engine element nodes (aiA = element 0..3). */
export function ensureNodes(w: World, b: number, cause: number): void {
  const e = w.enemies;
  for (let el = 0; el < 4; el++) {
    if (findRole(w, ROLE_NODE, el) >= 0) continue;
    const a = (el * TAU) / 4;
    spawnRole(w, b, ROLE_NODE, el, e.x[b] + cos(a) * (e.radius[b] + 30), e.y[b] + sin(a) * (e.radius[b] + 30), cause, 3);
  }
}

/** Keep the three Choir generators (aiA = generator number 0..2). */
export function ensureGenerators(w: World, b: number, cause: number): void {
  const e = w.enemies;
  for (let g = 0; g < 3; g++) {
    if (findRole(w, ROLE_GEN, g) >= 0) continue;
    const a = (g * TAU) / 3;
    spawnRole(w, b, ROLE_GEN, g, e.x[b] + cos(a) * (e.radius[b] + 70), e.y[b] + sin(a) * (e.radius[b] + 70), cause, 5);
  }
}

export const TELLS: Record<string, TellScript> = {
  slam: {
    start: focusBoss,
    fire(w, b, c, cause) {
      const e = w.enemies;
      towerBlast(w, e.x[b], e.y[b], 240, bossDmg(w, 30), c.src, b, cause);
      ringShots(w, b, c, 8, 150, bossDmg(w, 5), cause);
    },
    countered(_w, _b, c) { c.stunT = 90; },
  },
  brood_sac: {
    start: focusBoss,
    fire(w, b, _c, cause) { spawnAround(w, b, 'brood', 10, w.enemies.radius[b] + 12, cause); },
  },
  shield_links: {
    start: focusBoss,
    fire(w, b, c) {
      if (c.linkCutT > 0) return;
      const e = w.enemies;
      addShield(w, b, e.maxHp[b] * 0.15, 0.5);
      const n = w.queryRadius(e.x[b], e.y[b], 220, SCR);
      for (let k = 0; k < n; k++) { const j = SCR[k]; if (j !== b && w.alive(j) && !(e.flags[j] & EnemyFlag.Boss)) addShield(w, j, e.maxHp[j] * 0.3, 0.5); }
    },
    countered(w, b, c) { c.linkCutT = 360; w.enemies.shield[b] = 0; },
  },
  ram_charge: {
    start(w, b, c) {
      focusBoss(w, b, c);
      const e = w.enemies, d = distToTower(w, b) || 1;
      c.move = MOVE_RETREAT; c.mx = (e.x[b] / d) * (d + 40); c.my = (e.y[b] / d) * (d + 40); c.mSpeed = 30; c.mDmg = 0; c.mPass = 0;
    },
    fire(w, b, c, cause) {
      const e = w.enemies, d = distToTower(w, b) || 1, stop = TOWER_RADIUS + e.radius[b] + 4;
      c.move = MOVE_DASH; c.mx = (e.x[b] / d) * stop; c.my = (e.y[b] / d) * stop;
      c.mSpeed = Math.max(220, e.speed[b] * 8); c.mDmg = bossDmg(w, 40); c.mPass = 0; c.mCause = cause; c.moveT = 240;
    },
    countered(_w, _b, c) { c.move = MOVE_NONE; c.stunT = 150; },
  },
  maw_open: {
    start: focusBoss,
    fire(w, b, c, cause) {
      if (distToTower(w, b) <= 260) w.damageTower(bossDmg(w, 22), b, cause);
      fanAtTower(w, b, c, 3, 0.4, 180, bossDmg(w, 5), cause);
    },
  },
  clone_shuffle: {
    start(w, b, c) {
      focusBoss(w, b, c);
      ensureClones(w, b, 3, c.tellEv);
      c.revealT = 30;     // the true one is shown for 0.5 s
    },
    fire(w, b, c, cause) {
      const e = w.enemies;
      let n = 0;
      for (let j = 0; j < e.count; j++) if (e.kind[j] === K.bossAdd && !(e.flags[j] & EnemyFlag.Dead) && e.aiB[j] === ROLE_CLONE) SCR[n++] = j;
      if (n > 0) {
        const j = SCR[w.prng.int(0, n - 1)];
        const x = e.x[b], y = e.y[b];
        e.x[b] = e.x[j]; e.y[b] = e.y[j]; e.x[j] = x; e.y[j] = y;
      }
      c.revealT = 30;     // ... and again for 0.5 s after the shuffle lands
      for (let k = 0; k < n; k++) { const j = SCR[k]; shot(w, e.x[j], e.y[j], angleToTower(w, j), 170, bossDmg(w, 4), 5, cause, c.src, j); }
    },
  },
  hazard_ring: {
    start: focusBoss,
    fire(w, _b, _c, cause) {
      for (let k = 0; k < 8; k++) { const a = (k * TAU) / 8; enemyHazard(w, cos(a) * 40, sin(a) * 40, 26, 3, bossDmg(w, 4), cause); }
    },
  },
  halo_charge: {
    start: focusBoss,
    fire(w, b, c, cause) { fanAtTower(w, b, c, 5, 0.25, 300, bossDmg(w, 9), cause, ProjKind.EnemyShot, 7); },
  },
  feeding_tethers: {
    start: focusBoss,
    fire(_w, _b, c) { if (c.linkCutT <= 0) c.tetherT = 240; },
  },
  split_flash: {
    start: focusBoss,
    fire(w, b, _c, cause) { spawnAround(w, b, 'splitter_fragment', 6, w.enemies.radius[b] + 14, cause, 3); },
  },
  resistance_rotate: {
    start(w, b, c) {
      focusBoss(w, b, c);
      ensureNodes(w, b, c.tellEv);
      c.nextResist = ((c.resisted < 0 ? 0 : c.resisted) + 1) % 5;
      const weak = (c.nextResist + 1) % 4;          // the element it is weak to next: designate that node
      const j = findRole(w, ROLE_NODE, weak);
      if (j >= 0) { c.wantIndex = j; c.wantGen = w.enemies.gen[j]; }
    },
    fire(_w, _b, c) { c.resisted = c.nextResist; },
    countered(_w, _b, c) { c.resisted = -1; },
  },
  dilation_pulse: {
    start: focusBoss,
    fire(_w, _b, c) { c.accelT = 240; },
    countered(_w, _b, c) { c.accelT = 0; },
  },
  gate_open: {
    start(w, b, c) {
      focusBoss(w, b, c);
      const e = w.enemies, d = distToTower(w, b) || 1;
      c.fx = e.x[b] - (e.x[b] / d) * e.radius[b]; c.fy = e.y[b] - (e.y[b] / d) * e.radius[b]; c.fr = 40;
    },
    fire(w, b, c, cause) {
      for (let k = 0; k < 8 && canSpawn(w); k++) {
        const a = angleToTower(w, b) + (k - 3.5) * 0.12;
        w.spawnEnemy(k < 6 ? 'grunt' : 'runner', c.fx + cos(a) * 8, c.fy + sin(a) * 8, { cause });
      }
    },
  },
  dash_lane: {
    start(w, b, c) {
      focusBoss(w, b, c);
      const e = w.enemies, d = distToTower(w, b) || 1;
      const ux = -e.x[b] / d, uy = -e.y[b] / d;        // toward the tower
      const px = -uy, py = ux;                            // lane offset side
      c.seg = true; c.fx = e.x[b]; c.fy = e.y[b];
      c.fx2 = ux * 170 + px * 30; c.fy2 = uy * 170 + py * 30; c.fr = e.radius[b];
      c.move = MOVE_HOLD; c.moveT = 90;
    },
    fire(w, b, c, cause) {
      const e = w.enemies;
      c.move = MOVE_DASH; c.mx = c.fx2; c.my = c.fy2; c.mSpeed = Math.max(400, e.speed[b] * 6);
      c.mDmg = 0; c.mPass = bossDmg(w, 30); c.mCause = cause; c.moveT = 240;
    },
    countered(_w, _b, c) { c.move = MOVE_NONE; c.stunT = 120; },
  },
  revive_beam: {
    start(w, b, c) {
      focusBoss(w, b, c);
      const s = bossState(w);
      if (s.graveN > 0) { const k = (s.graveN - 1) & 7; c.fx2 = s.graveX[k]; c.fy2 = s.graveY[k]; }
      else { const e = w.enemies; c.fx2 = e.x[b] * 0.8; c.fy2 = e.y[b] * 0.8; }
    },
    fire(w, _b, c, cause) {
      if (!canSpawn(w)) return;
      const j = w.spawnEnemy('veteran', c.fx2, c.fy2, { cause, elite: ['hardened', 'regenerating'] });
      if (j >= 0) { const s = bossState(w); if (s.graveN > 0) s.graveN--; }
    },
  },
  inhale: {
    start(w, b, c) { focusBoss(w, b, c); c.bendT = Math.max(c.bendT, 60); },
    fire(_w, _b, c, cause) { c.inhaleT = 180; c.mCause = cause; },
    countered(_w, _b, c) { c.inhaleT = 0; c.bendT = 0; },
  },
  wall_blueprint: {
    start(w, b, c) {
      focusBoss(w, b, c);
      const e = w.enemies, d = distToTower(w, b) || 1;
      const ux = e.x[b] / d, uy = e.y[b] / d;
      const r = Math.max(70, Math.min(120, d - e.radius[b] - 30));
      const cx = ux * r, cy = uy * r;
      c.seg = true; c.fx = cx - uy * 80; c.fy = cy + ux * 80; c.fx2 = cx + uy * 80; c.fy2 = cy - ux * 80; c.fr = 6;
    },
    fire(w, _b, c, cause) {
      enemyHazard(w, c.fx, c.fy, 6, 8, 0, cause, 'barrier_field', c.fx2, c.fy2);
      bossState(w).walls++;
    },
  },
  harmony_sync: {
    start(w, b, c) {
      focusBoss(w, b, c);
      ensureGenerators(w, b, c.tellEv);
      const e = w.enemies;
      let n = 0;
      for (let g = 0; g < 3; g++) { const j = findRole(w, ROLE_GEN, g); if (j >= 0) c.order[n++] = e.gen[j]; }
      for (let k = n - 1; k > 0; k--) { const r = w.prng.int(0, k); const t = c.order[k]; c.order[k] = c.order[r]; c.order[r] = t; }
      c.orderN = n; c.orderPos = 0;
    },
    fire(w, b, c, cause) {
      const e = w.enemies;
      if (c.linkCutT <= 0) addShield(w, b, e.maxHp[b], 0.6);
      for (let g = 0; g < 3; g++) { const j = findRole(w, ROLE_GEN, g); if (j >= 0) shot(w, e.x[j], e.y[j], angleToTower(w, j), 200, bossDmg(w, 6), 6, cause, c.src, j); }
    },
    countered(w, b, c) {
      const e = w.enemies;
      e.shield[b] = 0; c.linkCutT = 240;
      for (let g = 0; g < 3; g++) { const j = findRole(w, ROLE_GEN, g); if (j >= 0) e.shield[j] = 0; }
    },
  },
  procession_halt: {
    start(w, b, c) { focusBoss(w, b, c); c.move = MOVE_HOLD; c.moveT = 90; },
    fire(w, b, c) {
      const e = w.enemies;
      c.move = MOVE_NONE;
      addShield(w, b, e.maxHp[b] * 0.1, 0.4);
      const n = w.queryRadius(e.x[b], e.y[b], 220, SCR);
      for (let k = 0; k < n; k++) { const j = SCR[k]; if (j !== b && w.alive(j) && !(e.flags[j] & EnemyFlag.Boss)) addShield(w, j, e.maxHp[j] * 0.3, 0.5); }
    },
    countered(w, b, c) {
      const e = w.enemies;
      c.move = MOVE_NONE;
      const n = w.queryRadius(e.x[b], e.y[b], 220, SCR);
      for (let k = 0; k < n; k++) { const j = SCR[k]; if (j !== b && w.alive(j) && !(e.flags[j] & EnemyFlag.Boss)) { e.shield[j] = 0; if (e.staggerT[j] < 120) e.staggerT[j] = 120; } }
    },
  },
};

