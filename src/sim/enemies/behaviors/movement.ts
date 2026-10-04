/**
 * Movement behaviors layered around core steering (enemies/steering.ts) (WP5):
 *  - swarm / fragment / brood: loose flocking jitter around the formation target
 *  - runner:   weaves across its path
 *  - brute:    restores 35% of any external displacement (knockback / pull) since its last move
 *  - artillery: holds at ~330 from the tower and lobs hostile blast shells every 2.5 s (Rushing: closes to contact)
 *  - charger:  walks in; inside 320 it winds up for 0.6 s (telegraph) then dashes at 4× speed
 *  - phase:    Phased 1.5 s of every 4 s (untargetable: core targeting/collision skip Phased)
 *  - burrower: Burrowed until within 200 of the tower; delayed-ambush spawns (radiusOffset < -100)
 *              surface after FORMATION_CONST.ambushSurfaceSeconds
 *  - boss_add: escorts orbit the boss; clones hold like the boss; nodes/generators orbit it; turrets stay put
 *  - separation: overlapping enemies push apart a little (capped work per tick, deterministic order;
 *                enemies already at the tower's contact ring are skipped)
 */
import type { World } from '../../core/world';
import { EnemyFlag, ProjFlag, ProjKind, TICK_DT, TICK_RATE, TOWER_RADIUS } from '../../core/types';
import { atan2, cos, sin, growth, TAU } from '../../math/lut';
import { CONTACT_GROWTH } from '../../economy/curves';
import { formationPosition, FORMATION_CONST } from '../formations';
import { steerEnemy } from '../steering';
import { AI_DASH, AI_FORCED, AI_SURFACED, AI_WINDUP, ROLE_CLONE, ROLE_GEN, ROLE_NODE, ROLE_TURRET, TAG_ENEMY, ensureSpatial } from './kinds';

const SCR = new Float32Array(2);
const NB = new Int32Array(12);
const GOLDEN = 2.399963229728653;
export const ARTILLERY_HOLD = FORMATION_CONST.artilleryHold;
const SHELL_SPEED = 150;
const PHASE_CYCLE = 240, PHASE_ON = 90;
const SEP_BUDGET = 300;
const F_NOSEP = EnemyFlag.Dead | EnemyFlag.Burrowed | EnemyFlag.Ally, F_PIN = EnemyFlag.Boss | EnemyFlag.Immovable;
const SMALL_N = 48;

function contactR(w: World, i: number): number { return TOWER_RADIUS + w.enemies.radius[i] + 4; }

/** Step toward (tx,ty) at `speed` without entering radius minR of the tower. */
export function moveTo(w: World, i: number, tx: number, ty: number, speed: number, minR: number): void {
  const e = w.enemies;
  const x = e.x[i], y = e.y[i];
  const dx = tx - x, dy = ty - y, l = Math.sqrt(dx * dx + dy * dy);
  const step = speed * TICK_DT;
  let nx = x, ny = y;
  if (l > 1e-6) { const k = l <= step ? 1 : step / l; nx = x + dx * k; ny = y + dy * k; }
  const r = Math.sqrt(nx * nx + ny * ny);
  if (r < minR && r > 1e-6) { nx *= minR / r; ny *= minR / r; }
  e.vx[i] = (nx - x) / TICK_DT; e.vy[i] = (ny - y) / TICK_DT;
  e.x[i] = nx; e.y[i] = ny;
}

/** Lateral offset along the perpendicular of the current heading (no-op when not moving). */
function sidestep(w: World, i: number, amount: number): void {
  const e = w.enemies;
  const vx = e.vx[i], vy = e.vy[i], v = Math.sqrt(vx * vx + vy * vy);
  if (v < 1e-3) return;
  e.x[i] += (-vy / v) * amount; e.y[i] += (vx / v) * amount;
}

export function swarmMove(w: World, i: number): void {
  steerEnemy(w, i);
  const e = w.enemies;
  const ph = (e.gen[i] & 1023) * GOLDEN + w.tick * 0.11;
  sidestep(w, i, sin(ph) * 22 * TICK_DT * e.speedMul[i]);
}

export function runnerMove(w: World, i: number): void {
  steerEnemy(w, i);
  const e = w.enemies;
  const ph = (e.gen[i] & 1023) * GOLDEN + w.tick * 0.07;
  sidestep(w, i, cos(ph) * e.speed[i] * 0.45 * TICK_DT * e.speedMul[i]);
}

/** Brute: undo part of external displacement (knockback, pull) since the AI last placed it. */
export function bruteMove(w: World, i: number): void {
  const e = w.enemies;
  if (!(e.flags[i] & EnemyFlag.Immovable)) { e.x[i] += (e.fx[i] - e.x[i]) * 0.35; e.y[i] += (e.fy[i] - e.y[i]) * 0.35; }
  steerEnemy(w, i);
  e.fx[i] = e.x[i]; e.fy[i] = e.y[i];
}

export function artilleryMove(w: World, i: number): void {
  const e = w.enemies;
  if (e.attackT[i] > 0) e.attackT[i]--;
  const x = e.x[i], y = e.y[i], d = Math.sqrt(x * x + y * y);
  const hold = e.rushT[i] > 0 ? contactR(w, i) : ARTILLERY_HOLD + (e.gen[i] % 3) * 10;   // anti-stall Rush: no standing off
  const m = e.speedMul[i];
  if (d > hold + 1 && m > 0) {
    const wave = w.wave, si = e.spawnIdx[i];
    if (wave && si >= 0 && si < wave.spawns.length) {
      e.formT[i] += m;
      const sp = wave.spawns[si];
      formationPosition(wave, sp, sp.tick + e.formT[i], e.speed[i], SCR);
      moveTo(w, i, SCR[0], SCR[1], e.speed[i] * m * 1.25, hold);
    } else moveTo(w, i, 0, 0, e.speed[i] * m, hold);
  } else { e.vx[i] = 0; e.vy[i] = 0; }
  if (d <= hold + 40 && e.attackT[i] === 0 && e.staggerT[i] === 0 && e.frozenT[i] === 0) {
    e.attackT[i] = 150;
    const dmg = e.contact[i] * growth(CONTACT_GROWTH, w.run.wave);
    const nd = d > 1e-6 ? d : 1;
    w.spawnProjectile({ kind: ProjKind.Shell, flags: ProjFlag.Hostile, x: e.x[i], y: e.y[i], vx: (-e.x[i] / nd) * SHELL_SPEED, vy: (-e.y[i] / nd) * SHELL_SPEED,
      damage: dmg, radius: 6, blast: 28, life: Math.ceil((nd / SHELL_SPEED + 2) * TICK_RATE), target: i, cause: e.spawnEv[i], srcTag: TAG_ENEMY });
  }
}

export function chargerMove(w: World, i: number): void {
  const e = w.enemies;
  const st = e.aiI[i];
  const x = e.x[i], y = e.y[i], d = Math.sqrt(x * x + y * y), cr = contactR(w, i);
  const stopped = e.staggerT[i] > 0 || e.frozenT[i] > 0;
  if (st & AI_WINDUP) {
    if (e.attackT[i] > 0) e.attackT[i]--;
    e.vx[i] = 0; e.vy[i] = 0;
    if (stopped) { e.aiI[i] = st & ~AI_WINDUP; e.aiA[i] = -120; return; }
    if (--e.aiA[i] <= 0) { e.aiI[i] = (st & ~AI_WINDUP) | AI_DASH; e.aiA[i] = 90; }
    return;
  }
  if (st & AI_DASH) {
    if (stopped || d <= cr || --e.aiA[i] <= 0) { e.aiI[i] = st & ~AI_DASH; e.aiA[i] = -180; steerEnemy(w, i); return; }
    if (e.attackT[i] > 0) e.attackT[i]--;
    moveTo(w, i, 0, 0, e.speed[i] * 4 * e.speedMul[i], cr);
    return;
  }
  steerEnemy(w, i);
  if (e.aiA[i] < 0) { e.aiA[i]++; return; }
  if (d < 320 && d > cr + 40 && e.speedMul[i] > 0 && !stopped) { e.aiI[i] |= AI_WINDUP; e.aiA[i] = 36; }
}

/** Phase rhythm (Phase enemies and `phasing` elites): stateless in (tick, spawnTick, gen). */
export function phaseToggle(w: World, i: number): void {
  const e = w.enemies;
  if (e.aiI[i] & AI_FORCED) { e.flags[i] &= ~EnemyFlag.Phased; return; }
  const t = (w.tick - e.spawnTick[i] + ((e.gen[i] * 53) % PHASE_CYCLE)) % PHASE_CYCLE;
  if (t < PHASE_ON) e.flags[i] |= EnemyFlag.Phased; else e.flags[i] &= ~EnemyFlag.Phased;
}

export function burrowerMove(w: World, i: number): void {
  const e = w.enemies;
  if (!(e.aiI[i] & AI_SURFACED)) {
    const x = e.x[i], y = e.y[i];
    const wave = w.wave, si = e.spawnIdx[i];
    const ambush = !!wave && si >= 0 && si < wave.spawns.length && wave.spawns[si].radiusOffset < -100;
    const surface = (e.aiI[i] & AI_FORCED) !== 0
      || (ambush ? w.tick - e.spawnTick[i] >= FORMATION_CONST.ambushSurfaceSeconds * TICK_RATE : x * x + y * y <= FORMATION_CONST.ambushRadius * FORMATION_CONST.ambushRadius);
    if (surface) { e.aiI[i] |= AI_SURFACED; e.flags[i] &= ~EnemyFlag.Burrowed; }
    else e.flags[i] |= EnemyFlag.Burrowed;
  }
  steerEnemy(w, i);
}

/** boss_add movement by role. `boss` = live boss index or -1. */
export function bossAddMove(w: World, i: number, boss: number): void {
  const e = w.enemies;
  const role = e.aiB[i];
  if (boss < 0 || role === ROLE_TURRET) {
    if (role === ROLE_TURRET) {
      e.vx[i] = 0; e.vy[i] = 0;
      if (e.attackT[i] > 0) e.attackT[i]--;
      else if (e.staggerT[i] === 0 && e.frozenT[i] === 0) {
        e.attackT[i] = 3 * TICK_RATE;
        const x = e.x[i], y = e.y[i], d = Math.sqrt(x * x + y * y) || 1, sp = 180;
        w.spawnProjectile({ kind: ProjKind.EnemyShot, flags: ProjFlag.Hostile, x, y, vx: (-x / d) * sp, vy: (-y / d) * sp,
          damage: 6 * growth(CONTACT_GROWTH, w.run.wave), radius: 5, life: Math.ceil((d / sp + 2) * TICK_RATE), target: i, cause: e.spawnEv[i], srcTag: TAG_ENEMY });
      }
      return;
    }
    steerEnemy(w, i);
    return;
  }
  const bx = e.x[boss], by = e.y[boss], br = e.radius[boss];
  const m = e.speedMul[i];
  if (e.attackT[i] > 0) e.attackT[i]--;
  if (role === ROLE_CLONE) {
    const x = e.x[i], y = e.y[i], d = Math.sqrt(x * x + y * y);
    if (d > 165 && m > 0) moveTo(w, i, 0, 0, e.speed[i] * m, 165); else { e.vx[i] = 0; e.vy[i] = 0; }
    e.angle[i] = atan2(-y, -x);
    return;
  }
  let a: number, r: number;
  if (role === ROLE_NODE) { a = (e.aiA[i] * TAU) / 4 + w.tick * 0.012; r = br + 30; }
  else if (role === ROLE_GEN) { a = (e.aiA[i] * TAU) / 3 + w.tick * 0.006; r = br + 70; }
  else { a = (e.gen[i] & 1023) * GOLDEN + w.tick * 0.01; r = br + 34 + (e.gen[i] % 3) * 14; }
  moveTo(w, i, bx + cos(a) * r, by + sin(a) * r, Math.max(e.speed[i], 60) * (m > 0 ? m : 0) * 1.5, contactR(w, i));
}

/**
 * Separation: overlapping enemies are pushed apart by 20% of the overlap (split between the two).
 * Deterministic: every other tick, a rotating window of SEP_BUDGET enemies, neighbors in spatial-hash order.
 * Bosses and Immovable enemies are never pushed; nobody is pushed inside the tower's contact ring.
 */
export function separate(w: World, cursor: number): number {
  const e = w.enemies, n = e.count;
  if (n < 2) return 0;
  if (n <= SMALL_N) { separateSmall(w); return 0; }
  ensureSpatial(w);
  const budget = n < SEP_BUDGET ? n : SEP_BUDGET;
  let i = cursor % n;
  for (let done = 0; done < budget; done++, i = i + 1 >= n ? 0 : i + 1) {
    const fi = e.flags[i];
    if (fi & F_NOSEP) continue;
    const ri = e.radius[i];
    const cr = TOWER_RADIUS + ri + 10, xi = e.x[i], yi = e.y[i];
    if (xi * xi + yi * yi <= cr * cr) continue;      // already at the tower: the contact ring is a pile-up by design
    const q = w.queryRadius(xi, yi, ri, NB);
    for (let k = 0; k < q; k++) {
      const j = NB[k];
      if (j <= i || (e.flags[j] & F_NOSEP)) continue;
      pushPair(w, i, j, fi);
    }
  }
  return i;
}

/** Few enemies: plain pair loop (no spatial hash needed). */
function separateSmall(w: World): void {
  const e = w.enemies, n = e.count;
  for (let i = 0; i < n; i++) {
    const fi = e.flags[i];
    if (fi & F_NOSEP) continue;
    const ri = e.radius[i], cr = TOWER_RADIUS + ri + 10;
    if (e.x[i] * e.x[i] + e.y[i] * e.y[i] <= cr * cr) continue;
    for (let j = i + 1; j < n; j++) {
      if (e.flags[j] & F_NOSEP) continue;
      pushPair(w, i, j, fi);
    }
  }
}

function pushPair(w: World, i: number, j: number, fi: number): void {
  const e = w.enemies;
  const dx = e.x[j] - e.x[i], dy = e.y[j] - e.y[i];
  const rr = e.radius[i] + e.radius[j], d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return;
  const d = Math.sqrt(d2);
  const push = (rr - d) * 0.2;
  let ux: number, uy: number;
  if (d > 1e-4) { ux = dx / d; uy = dy / d; } else { const a = ((i * 7 + j * 13) & 63) * 0.0997; ux = cos(a); uy = sin(a); }
  const pinI = (fi & F_PIN) !== 0, pinJ = (e.flags[j] & F_PIN) !== 0;
  if (pinI && pinJ) return;
  const si = pinI ? 0 : pinJ ? push : push * 0.5, sj = pinJ ? 0 : pinI ? push : push * 0.5;
  if (si > 0) nudge(w, i, -ux * si, -uy * si);
  if (sj > 0) nudge(w, j, ux * sj, uy * sj);
}

function nudge(w: World, i: number, dx: number, dy: number): void {
  const e = w.enemies;
  let nx = e.x[i] + dx, ny = e.y[i] + dy;
  const minR = contactR(w, i) - 2, r = Math.sqrt(nx * nx + ny * ny);
  if (r < minR && r > 1e-6) { nx *= minR / r; ny *= minR / r; }
  e.x[i] = nx; e.y[i] = ny;
}
