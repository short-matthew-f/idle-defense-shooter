/**
 * BossController (WP5): runs one live boss per tick — phases, the tell → counter loop, attacks on
 * cadence, stagger interrupts, movement overrides and continuous effects (tethers, inhale, projectile
 * bending, generator shields, Architect walls).
 *
 * Phases: phase k begins when hp/maxHp <= phases[k].hpFraction → Ev.BossPhase (a = boss, b = k), the
 * phase's adds (adds[].perPhase, cause = the phase event), 1 s invulnerability (World.damageModifier
 * returns 0), +10 CE. Tells: every tell.everySeconds (first after min(half, 5 s)) → Ev.BossTell once
 * (a = boss, b = attack code), window = tell.windowSeconds; uncountered → the attack fires and, in
 * phases with a weakPoint, the boss is exposed for half its exposedSeconds while it recovers.
 * Stagger (Heavy Rounds Staggerhead sets enemies.staggerT on bosses): interrupts the current tell or
 * dash, at most once per 4 s.
 */
import type { World } from '../../core/world';
import type { BossCtrl, BossState } from './state';
import { MOVE_DASH, MOVE_HOLD, MOVE_NONE, MOVE_RETREAT, MAX_PHASE_ATTACKS, bossSrc } from './state';
import { EnemyFlag, Ev, NO_ENTITY, ProjFlag, ProjKind, TICK_DT, TOWER_RADIUS } from '../../core/types';
import { BOSS_LIST, bossDef } from '../../core/content';
import { graftSources, tellAttack, TELL_COUNTERS } from '../../data/bosses';
import { atan2 } from '../../math/lut';
import { ROLE_CLONE, ROLE_GEN, ROLE_NODE, ROLE_TURRET, K } from '../behaviors/kinds';
import { ATTACKS, CADENCE, TELLS, attackCode, isTell } from './registry';
import { ensureClones, ensureGenerators, ensureNodes } from './tells';
import { addShield, attackEvent, bossDmg, canSpawn, healEnemy, segDist, segmentsCross, spawnAround, towerBlast } from './common';

const SCR = new Int32Array(512);
const DEFAULT_HOLD = 160;

function resetCooldowns(c: BossCtrl): void {
  const atk = c.def.phases[c.phase].attacks;
  for (let k = 0; k < MAX_PHASE_ATTACKS; k++) {
    const id = k < atk.length ? atk[k] : '';
    c.cd[k] = id && !isTell(id) ? Math.round(((CADENCE[id] ?? 6) * 0.5 + k) * 60) : 0;
  }
}

function spawnPhaseAdds(w: World, b: number, c: BossCtrl, cause: number): void {
  const adds = c.def.adds;
  if (!adds) return;
  for (const a of adds) if (canSpawn(w)) spawnAround(w, b, a.kind, a.perPhase, w.enemies.radius[b] + 40, cause);
}

/** Take control of a newly seen boss at pool index i. */
export function initCtrl(w: World, c: BossCtrl, i: number): void {
  const e = w.enemies;
  const id = BOSS_LIST[e.bossId[i]] ?? 'breaker';
  const def = bossDef(id, w.run.wave);
  c.active = true; c.index = i; c.gen = e.gen[i]; c.id = id; c.def = def; c.src = bossSrc(id);
  c.phase = 0; e.bossPhase[i] = 0;
  c.tellT = Math.round(Math.min(def.tell.everySeconds * 0.5, 5) * 60);
  c.tellActive = false; c.tellTicks = 0; c.tellEv = -1; c.tellId = '';
  c.weakT = 0; c.invulnT = 0; c.staggerCd = 0; c.stunT = 0; c.revealT = 0; c.linkCutT = 0; c.tetherT = 0;
  c.inhaleT = 0; c.bendT = 0; c.dragT = 0; c.accelT = 0; c.move = MOVE_NONE; c.moveT = 0;
  c.holdR = id === 'distant_saint' ? 300 : 0;
  c.resisted = id === 'null_engine' ? 1 : -1; c.nextResist = 0;
  c.hpMark = e.hp[i]; c.cycle = 0; c.orderN = 0; c.orderPos = 0; c.wantIndex = NO_ENTITY;
  if (id === 'deep_graft') { const g = graftSources(w.run.wave); c.graftA = g[0]; c.graftB = g[1]; }
  c.graftTellK = 0; c.graftKA = 0; c.graftKB = 0;
  resetCooldowns(c);
  const cause = e.spawnEv[i];
  c.lastPhaseEv = cause;
  spawnPhaseAdds(w, i, c, cause);
  if (id === 'null_engine') ensureNodes(w, i, cause);
  if (id === 'choir') ensureGenerators(w, i, cause);
  if (id === 'mirror_hive') ensureClones(w, i, 2, cause);
}

function enterPhase(w: World, b: number, c: BossCtrl, k: number): void {
  const e = w.enemies;
  c.phase = k; e.bossPhase[b] = k;
  const id = w.emit(Ev.BossPhase, c.src, b, k, e.x[b], e.y[b], e.spawnEv[b]);
  c.lastPhaseEv = id;
  c.invulnT = 60; c.hpMark = e.hp[b];
  resetCooldowns(c);
  w.gainCE(10);
  spawnPhaseAdds(w, b, c, id);
}

/** The tell attack for this boss/phase (Crown: per phase; Deep Graft: alternating sources). */
function pickTell(w: World, c: BossCtrl): string | null {
  if (c.id === 'deep_graft') {
    const src = (c.graftTellK++ & 1) === 0 ? c.graftA : c.graftB;
    return tellAttack(bossDef(src, w.run.wave), 0);
  }
  return tellAttack(c.def, c.phase);
}

function startTell(w: World, b: number, c: BossCtrl): void {
  const e = w.enemies;
  c.tellT = Math.round(c.def.tell.everySeconds * 60);
  const t = pickTell(w, c);
  if (!t || !TELLS[t]) return;
  c.tellId = t;
  c.tellCounter = TELL_COUNTERS[t];
  c.tellEv = w.emit(Ev.BossTell, c.src, b, attackCode(t), e.x[b], e.y[b], c.lastPhaseEv);
  c.tellActive = true;
  c.tellTicks = Math.max(1, Math.round(c.def.tell.windowSeconds * 60));
  c.tellSeq++;
  c.seg = false; c.wantIndex = NO_ENTITY; c.orderN = 0;
  TELLS[t].start(w, b, c);
}

function fireTell(w: World, b: number, c: BossCtrl): void {
  c.tellActive = false;
  const cause = attackEvent(w, b, c, attackCode(c.tellId));
  TELLS[c.tellId].fire(w, b, c, cause);
  const wp = c.def.phases[c.phase].weakPoint;
  if (wp) openWeakPoint(w, b, c, wp.exposedSeconds * 0.5);
}

export function openWeakPoint(w: World, b: number, c: BossCtrl, seconds: number): void {
  const t = Math.round(seconds * 60);
  if (t > c.weakT) c.weakT = t;
  w.enemies.flags[b] |= EnemyFlag.WeakPointOpen;
}

/** Keep the point focus on the boss (or its gate) while a tell is up. */
function refocus(w: World, b: number, c: BossCtrl): void {
  if (c.seg) return;
  const e = w.enemies;
  if (c.tellId === 'gate_open') {
    const d = Math.sqrt(e.x[b] * e.x[b] + e.y[b] * e.y[b]) || 1;
    c.fx = e.x[b] - (e.x[b] / d) * e.radius[b]; c.fy = e.y[b] - (e.y[b] / d) * e.radius[b];
  } else { c.fx = e.x[b]; c.fy = e.y[b]; }
}

/** One tick of one boss (World.update phase). Returns false when the boss is gone. */
export function updateCtrl(w: World, s: BossState, c: BossCtrl): boolean {
  const b = w.resolveEnemy(c.index, c.gen);
  if (b < 0) return false;
  c.index = b;
  const e = w.enemies;
  e.angle[b] = atan2(-e.y[b], -e.x[b]);
  // phases
  const phases = c.def.phases;
  const frac = e.maxHp[b] > 0 ? e.hp[b] / e.maxHp[b] : 0;
  while (c.phase + 1 < phases.length && frac <= phases[c.phase + 1].hpFraction) enterPhase(w, b, c, c.phase + 1);
  // timers
  if (c.invulnT > 0) c.invulnT--;
  if (c.weakT > 0 && --c.weakT === 0) e.flags[b] &= ~EnemyFlag.WeakPointOpen;
  if (c.staggerCd > 0) c.staggerCd--;
  if (c.revealT > 0) c.revealT--;
  if (c.linkCutT > 0) { c.linkCutT--; c.tetherT = 0; }
  if (c.accelT > 0) c.accelT--;
  if (c.move === MOVE_HOLD && --c.moveT <= 0) c.move = MOVE_NONE;
  // stagger interrupt (Heavy Rounds Staggerhead)
  if (e.staggerT[b] > 0 && c.staggerCd === 0 && (c.tellActive || c.move === MOVE_DASH)) {
    c.tellActive = false; c.move = MOVE_NONE; c.staggerCd = 240;
    w.emit(Ev.Fx, c.src, -1, c.phase, e.x[b], e.y[b], c.tellEv >= 0 ? c.tellEv : e.spawnEv[b]);
  }
  continuous(w, s, b, c);
  if (c.stunT > 0) { c.stunT--; return true; }
  // tell loop
  if (c.tellActive) {
    refocus(w, b, c);
    if (--c.tellTicks <= 0) fireTell(w, b, c);
  } else if (--c.tellT <= 0) startTell(w, b, c);
  // attacks on cadence
  const atk = phases[c.phase].attacks;
  const rate = c.accelT > 0 ? 1.5 : 1;
  for (let k = 0; k < atk.length && k < MAX_PHASE_ATTACKS; k++) {
    const id = atk[k];
    if (isTell(id)) continue;
    c.cd[k] -= rate;
    if (c.cd[k] > 0) continue;
    c.cd[k] = Math.round((CADENCE[id] ?? 6) * 60);
    const fn = ATTACKS[id];
    if (fn) fn(w, b, c, attackEvent(w, b, c, attackCode(id)));
    if (!w.alive(b)) return false;
  }
  return true;
}

function continuous(w: World, s: BossState, b: number, c: BossCtrl): void {
  const e = w.enemies, tick = w.tick;
  if (c.tetherT > 0) {
    c.tetherT--;
    if (tick % 30 === 0) { w.damageTower(bossDmg(w, 3), b, c.tellEv); healEnemy(w, b, e.maxHp[b] * 0.004, c.src, c.tellEv); }
  }
  if (c.inhaleT > 0) {
    c.inhaleT--;
    const n = w.queryRadius(e.x[b], e.y[b], 360, SCR);
    for (let k = 0; k < n; k++) { const j = SCR[k]; if (j !== b && w.alive(j)) w.pull(j, e.x[b], e.y[b], 50); }
    bend(w, b, 320, 0.05, false);
    if (c.inhaleT === 0) towerBlast(w, 0, 0, 10, bossDmg(w, 18), c.src, b, c.mCause);
  }
  if (c.bendT > 0) { c.bendT--; bend(w, b, 260, 0.025, false); }
  if (c.dragT > 0) { c.dragT--; bend(w, b, 420, 0.06, true); }
  if (tick % 30 === 0 && c.linkCutT <= 0 && (c.id === 'choir' || c.id === 'crown' || c.id === 'deep_graft')) {
    let gens = 0;
    for (let j = 0; j < e.count; j++) if (e.kind[j] === K.bossAdd && e.aiB[j] === ROLE_GEN && !(e.flags[j] & EnemyFlag.Dead)) gens++;
    if (gens > 0) addShield(w, b, e.maxHp[b] * 0.002 * gens, 0.6);
  }
  if (s.walls > 0) blockProjectiles(w, s);
}

/**
 * Event Horizon: swirl player projectiles near the boss (tangential, so they miss), or with `drag`
 * pull drone projectiles into it (drones themselves live in the Drones system, which WP5 cannot reach).
 */
function bend(w: World, b: number, radius: number, k: number, drag: boolean): void {
  const p = w.projectiles, e = w.enemies;
  const bx = e.x[b], by = e.y[b], r2 = radius * radius;
  for (let j = 0; j < p.count; j++) {
    const f = p.flags[j];
    if (f & (ProjFlag.Dead | ProjFlag.Hostile)) continue;
    if (drag && !(f & ProjFlag.FromDrone) && p.kind[j] !== ProjKind.DroneShot && p.kind[j] !== ProjKind.Microdrone) continue;
    const dx = bx - p.x[j], dy = by - p.y[j], d2 = dx * dx + dy * dy;
    if (d2 > r2 || d2 < 1) continue;
    const vx = p.vx[j], vy = p.vy[j], sp = Math.sqrt(vx * vx + vy * vy);
    if (sp < 1e-6) continue;
    const d = Math.sqrt(d2);
    const ux = drag ? dx / d : -dy / d, uy = drag ? dy / d : dx / d;
    let nx = vx / sp + ux * k, ny = vy / sp + uy * k;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nl; ny /= nl;
    p.vx[j] = nx * sp; p.vy[j] = ny * sp;
  }
}

/**
 * Architect walls: enemy `barrier_field` hazards (x,y → x2,y2) block player projectiles. This runs in
 * the boss system's update, i.e. before projectiles move this tick, so we test each projectile's
 * NEXT step (position → position + v·dt) against every wall and free it on contact.
 */
function blockProjectiles(w: World, s: BossState): void {
  const hz = w.hazards, p = w.projectiles;
  let walls = 0;
  for (let h = 0; h < hz.length; h++) {
    const z = hz[h];
    if (z.kind !== 'barrier_field' || z.owner !== 'enemy' || z.x2 === undefined || z.y2 === undefined) continue;
    walls++;
    for (let j = 0; j < p.count; j++) {
      if (p.flags[j] & (ProjFlag.Dead | ProjFlag.Hostile)) continue;
      const x = p.x[j], y = p.y[j], nx = x + p.vx[j] * TICK_DT, ny = y + p.vy[j] * TICK_DT;
      if (segmentsCross(x, y, nx, ny, z.x, z.y, z.x2, z.y2) || segDist(nx, ny, z.x, z.y, z.x2, z.y2) <= z.radius + p.radius[j]) w.freeProjectile(j);
    }
  }
  s.walls = walls;
}

/**
 * Movement override for bosses (called by aiStep before core steering). Returns true when the
 * controller moved the boss itself (dash, retreat, hold, stun, long-range hold).
 */
export function moveBoss(w: World, c: BossCtrl, i: number): boolean {
  const e = w.enemies;
  const x = e.x[i], y = e.y[i];
  const d = Math.sqrt(x * x + y * y);
  if (c.stunT > 0 || c.move === MOVE_HOLD || (c.move === MOVE_NONE && c.holdR > 0 && d <= c.holdR)) {
    e.vx[i] = 0; e.vy[i] = 0;
    if (e.attackT[i] > 0) e.attackT[i]--;
    return true;
  }
  if (c.move === MOVE_DASH || c.move === MOVE_RETREAT) {
    if (e.attackT[i] > 0) e.attackT[i]--;
    const dx = c.mx - x, dy = c.my - y, l = Math.sqrt(dx * dx + dy * dy);
    const step = c.mSpeed * Math.max(0, e.speedMul[i]) * TICK_DT;
    let nx = c.mx, ny = c.my;
    if (l > step && l > 1e-6) { nx = x + (dx / l) * step; ny = y + (dy / l) * step; }
    const minR = TOWER_RADIUS + e.radius[i] + 2, r = Math.sqrt(nx * nx + ny * ny);
    if (r < minR && r > 1e-6) { nx *= minR / r; ny *= minR / r; }
    e.vx[i] = (nx - x) / TICK_DT; e.vy[i] = (ny - y) / TICK_DT;
    e.x[i] = nx; e.y[i] = ny;
    const reach = TOWER_RADIUS + e.radius[i] + 12;
    if (c.mPass > 0 && nx * nx + ny * ny <= reach * reach) { w.damageTower(c.mPass, i, c.mCause); c.mPass = 0; }
    c.moveT--;
    if (l <= step || c.moveT <= 0) {
      if (c.move === MOVE_DASH) {
        if (c.mDmg > 0 && nx * nx + ny * ny <= reach * reach) w.damageTower(c.mDmg, i, c.mCause);
        c.mDmg = 0; c.mPass = 0;
        const rr = Math.sqrt(nx * nx + ny * ny) || 1, hold = c.holdR > 0 ? c.holdR : DEFAULT_HOLD;
        c.move = MOVE_RETREAT; c.mx = (nx / rr) * hold; c.my = (ny / rr) * hold; c.mSpeed = Math.max(40, e.speed[i] * 1.5); c.moveT = 600;
      } else c.move = MOVE_NONE;
    }
    return true;
  }
  if (c.accelT > 0) e.speedMul[i] *= 1.6;
  return false;
}

/** Remove the boss's structural adds (clones, nodes, generators, turrets) when it dies. */
export function releaseCtrl(w: World, c: BossCtrl): void {
  c.active = false; c.tellActive = false;
  const e = w.enemies;
  for (let j = 0; j < e.count; j++) {
    if (e.kind[j] !== K.bossAdd || (e.flags[j] & EnemyFlag.Dead)) continue;
    const r = e.aiB[j];
    if (r === ROLE_CLONE || r === ROLE_NODE || r === ROLE_GEN || r === ROLE_TURRET) w.despawnEnemy(j);
  }
  if (c.move !== MOVE_NONE) c.move = MOVE_NONE;
}
