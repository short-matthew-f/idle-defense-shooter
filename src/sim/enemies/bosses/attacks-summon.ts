/**
 * Boss attacks, part 2: summons, shields, heals, walls and escort buffs (WP5).
 * Summons respect ADD_CAP (common.ts); every spawn carries the attack event as its cause.
 */
import type { AttackFn } from './attacks-fire';
import type { World } from '../../core/world';
import { bossState } from './state';
import { EnemyFlag } from '../../core/types';
import { cos, sin, atan2 } from '../../math/lut';
import { K, ROLE_TURRET } from '../behaviors/kinds';
import { ensureClones, ensureGenerators } from './tells';
import {
  addShield, angleToTower, canSpawn, countRole, distToTower, enemyHazard, healEnemy, spawnAround, spawnRole, stripStatuses,
} from './common';
import { ELITE_LIST } from '../../core/content';

const SCR = new Int32Array(256);
const ELITE_PICK: string[] = ['', ''];

/** Two elite modifiers drawn from the World prng (reused array: spawnEnemy copies bits immediately). */
function twoMods(w: World): readonly string[] {
  const a = w.prng.int(0, ELITE_LIST.length - 1);
  let b = w.prng.int(0, ELITE_LIST.length - 2);
  if (b >= a) b++;
  ELITE_PICK[0] = ELITE_LIST[a]; ELITE_PICK[1] = ELITE_LIST[b];
  return ELITE_PICK;
}

/** Nearby non-boss enemies within r of the boss → SCR; returns count. */
function nearbyAdds(w: World, b: number, r: number): number {
  const e = w.enemies;
  const n = w.queryRadius(e.x[b], e.y[b], r, SCR);
  let k2 = 0;
  for (let k = 0; k < n; k++) { const j = SCR[k]; if (j !== b && w.alive(j) && !(e.flags[j] & EnemyFlag.Boss)) SCR[k2++] = j; }
  return k2;
}

export const SUMMON_ATTACKS: Record<string, AttackFn> = {
  spawn_brood(w, b, _c, cause) { spawnAround(w, b, 'brood', 6, w.enemies.radius[b] + 10, cause); },
  shield_pulse(w, b, c) { if (c.linkCutT <= 0) addShield(w, b, w.enemies.maxHp[b] * 0.08, 0.4); },
  summon_guards(w, b, _c, cause) { spawnAround(w, b, 'shielded', 3, w.enemies.radius[b] + 30, cause); },
  deploy_turrets(w, b, _c, cause) {
    if (countRole(w, ROLE_TURRET) >= 4) return;
    const e = w.enemies, d = distToTower(w, b) || 1;
    const px = -e.y[b] / d, py = e.x[b] / d;
    spawnRole(w, b, ROLE_TURRET, 0, e.x[b] + px * 70, e.y[b] + py * 70, cause, 2);
    spawnRole(w, b, ROLE_TURRET, 1, e.x[b] - px * 70, e.y[b] - py * 70, cause, 2);
  },
  spawn_clones(w, b, _c, cause) { ensureClones(w, b, 4, cause); },
  escort_call(w, b, _c, cause) { spawnAround(w, b, 'veteran', 3, w.enemies.radius[b] + 60, cause); },
  sanctify(w, b, c, cause) {
    const e = w.enemies;
    const n = nearbyAdds(w, b, 220);
    for (let k = 0; k < n; k++) healEnemy(w, SCR[k], e.maxHp[SCR[k]] * 0.3, c.src, cause);
    if (c.linkCutT <= 0) addShield(w, b, e.maxHp[b] * 0.08, 0.4);
  },
  spawn_leeches(w, b, _c, cause) { spawnAround(w, b, 'leech', 3, w.enemies.radius[b] + 20, cause); },
  reform(w, b, c, cause) {
    const e = w.enemies;
    const n = w.queryRadius(e.x[b], e.y[b], 260, SCR);
    let healed = 0;
    for (let k = 0; k < n; k++) {
      const j = SCR[k];
      if (!w.alive(j) || e.kind[j] !== K.fragment) continue;
      const dx = e.x[j] - e.x[b], dy = e.y[j] - e.y[b];
      if (dx * dx + dy * dy <= (e.radius[b] + 40) * (e.radius[b] + 40) && healed < 5) { w.despawnEnemy(j); healed++; }
      else w.pull(j, e.x[b], e.y[b], 300);
    }
    if (healed > 0) healEnemy(w, b, e.maxHp[b] * 0.01 * healed, c.src, cause);
  },
  null_field(w, b) {
    const n = nearbyAdds(w, b, 200);
    for (let k = 0; k < n; k++) stripStatuses(w, SCR[k]);
    stripStatuses(w, b);
  },
  rewind(w, b, c, cause) {
    const e = w.enemies;
    const lost = c.hpMark - e.hp[b];
    if (lost > 0) healEnemy(w, b, Math.min(lost * 0.3, e.maxHp[b] * 0.05), c.src, cause);
    c.hpMark = e.hp[b];
  },
  accelerate_adds(_w, _b, c) { c.accelT = Math.max(c.accelT, 240); },
  spawn_wave(w, b, _c, cause) {
    const e = w.enemies;
    const a0 = angleToTower(w, b);
    for (let k = 0; k < 8 && canSpawn(w); k++) {
      const a = a0 + (k - 3.5) * 0.18;
      w.spawnEnemy(k % 4 === 3 ? 'runner' : 'grunt', e.x[b] + cos(a) * (e.radius[b] + 10), e.y[b] + sin(a) * (e.radius[b] + 10), { cause });
    }
  },
  fortify(w, b, c) {
    const e = w.enemies;
    if (e.armor[b] < c.def.armor + 60) e.armor[b] += 20;
    addShield(w, b, e.maxHp[b] * 0.1, 0.3);
  },
  raise_elites(w, b, _c, cause) {
    const s = bossState(w), e = w.enemies;
    for (let k = 0; k < 2 && canSpawn(w); k++) {
      let x: number, y: number;
      if (s.graveN > 0) { const g = (s.graveN - 1) & 7; x = s.graveX[g]; y = s.graveY[g]; s.graveN--; }
      else { const a = atan2(e.y[b], e.x[b]) + (k === 0 ? 0.4 : -0.4); x = cos(a) * distToTower(w, b); y = sin(a) * distToTower(w, b); }
      w.spawnEnemy(k === 0 ? 'veteran' : 'armored', x, y, { cause, elite: twoMods(w) });
    }
  },
  raise_barrier(w, b, _c, cause) {
    const e = w.enemies, d = distToTower(w, b) || 1;
    const ux = e.x[b] / d, uy = e.y[b] / d;
    const r = Math.max(60, d - e.radius[b] - 30);
    for (let k = -1; k <= 1; k += 2) {
      const cx = ux * r + -uy * 55 * k, cy = uy * r + ux * 55 * k;
      enemyHazard(w, cx - uy * 40, cy + ux * 40, 6, 6, 0, cause, 'barrier_field', cx + uy * 40, cy - ux * 40);
      bossState(w).walls++;
    }
  },
  corridor_shift(w, _b, _c) {
    const hz = w.hazards;
    const ca = cos(0.35), sa = sin(0.35);
    for (let k = 0; k < hz.length; k++) {
      const h = hz[k];
      if (h.kind !== 'barrier_field' || h.owner !== 'enemy') continue;
      const x = h.x, y = h.y; h.x = x * ca - y * sa; h.y = x * sa + y * ca;
      if (h.x2 !== undefined && h.y2 !== undefined) { const x2 = h.x2, y2 = h.y2; h.x2 = x2 * ca - y2 * sa; h.y2 = x2 * sa + y2 * ca; }
    }
  },
  shield_generators(w, b, _c, cause) { ensureGenerators(w, b, cause); },
  elite_gauntlet(w, b, _c, cause) {
    const e = w.enemies;
    for (let k = 0; k < 3 && canSpawn(w); k++) {
      const a = atan2(e.y[b], e.x[b]) + (k - 1) * 0.5;
      const r = Math.min(520, distToTower(w, b) + 80);
      w.spawnEnemy(k === 1 ? 'armored' : 'veteran', cos(a) * r, sin(a) * r, { cause, elite: twoMods(w) });
    }
  },
  rally(w, b, c, cause) {
    const n = nearbyAdds(w, b, 250);
    const e = w.enemies;
    for (let k = 0; k < n; k++) healEnemy(w, SCR[k], e.maxHp[SCR[k]] * 0.2, c.src, cause);
    c.accelT = Math.max(c.accelT, 180);
  },
};

