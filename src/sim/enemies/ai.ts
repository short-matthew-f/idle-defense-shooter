/**
 * Enemy AI entry point (called once per tick by Sim.step, after statuses, before the spatial hash
 * rebuild). WP1 ships basic steering (enemies/steering.ts); WP5 layers behaviors around it:
 *
 *  0. initialize new enemies (elite modifiers), apply speed auras
 *     (commanding elites, boss accelerate/dilation), and the wave-end guarantee
 *  1. per enemy, by kind (behaviors/*.ts): movement + attacks + auras; bosses use their
 *     controller's movement override (bosses/controller.ts) or core steering
 *  2. separation (behaviors/movement.ts)
 *
 * Spatial queries in this phase go through behaviors/kinds.ts ensureSpatial(): the hash still holds
 * last tick's pre-compaction indices, so it is rebuilt once, lazily, when a behavior first needs it.
 * Chill attack-slow: an enemy slowed to speedMul m < 1 recovers its attack timer at rate m
 * (steering decrements attackT by one per tick; we give back the difference deterministically).
 * Wave-end guarantee: if live enemies remain but none is targetable (all Phased/Burrowed) for 20 s,
 * every one of them is forced tangible for good (AI_FORCED). The anti-stall Rush (run/stall.ts) is the general
 * guarantee; its enemy side (Rush speed ramp, no regeneration) and the knockback Rally live in enemies/recovery.ts.
 */
import type { World } from '../core/world';
import { EnemyFlag, TICK_RATE } from '../core/types';
import { steerEnemy } from './steering';
import { atan2 } from '../math/lut';
import { K, AI_FORCED, AI_INIT, AI_SURFACED, ensureSpatial, spatialStale } from './behaviors/kinds';
import {
  artilleryMove, bossAddMove, bruteMove, burrowerMove, chargerMove, phaseToggle, runnerMove, separate, swarmMove,
} from './behaviors/movement';
import { carrierTick, healerTick, leechTick, nullifierTick, shieldRegen, wardenTick } from './behaviors/support';
import { commandAuras, eliteTick, initElite, MOD } from './elites';
import { newRecoveryParams, readRecoveryParams, recoverySpeed, regenAllowed, type RecoveryParams } from './recovery';
import { bossMovement, bossState } from './bosses';

const SCR = new Int32Array(1024);
const FORCE_TICKS = 20 * TICK_RATE;
// Hoisted constants: const enums / cross-module objects are property reads under some transpilers.
const F_SKIP = EnemyFlag.Dead | EnemyFlag.Ally, F_BOSS = EnemyFlag.Boss, F_HIDDEN = EnemyFlag.Phased | EnemyFlag.Burrowed;
const M_COMMAND = MOD.commanding, M_PHASING = MOD.phasing, M_SHIELDED = MOD.shielded_elite;
const K_SWARM = K.swarm, K_FRAGMENT = K.fragment, K_BROOD = K.brood, K_RUNNER = K.runner, K_BRUTE = K.brute,
  K_CARRIER = K.carrier, K_HEALER = K.healer, K_LEECH = K.leech, K_WARDEN = K.warden, K_ARTILLERY = K.artillery,
  K_CHARGER = K.charger, K_PHASE = K.phase, K_BURROWER = K.burrower, K_NULLIFIER = K.nullifier,
  K_REFRACTOR = K.refractor, K_BOSS_ADD = K.bossAdd, K_SHIELDED = K.shielded;

interface AiState { noTargetTicks: number; sepCursor: number; boss: number; rec: RecoveryParams }
const STATES = new WeakMap<World, AiState>();
function aiState(w: World): AiState {
  let s = STATES.get(w);
  if (!s) { s = { noTargetTicks: 0, sepCursor: 0, boss: -1, rec: newRecoveryParams() }; STATES.set(w, s); }
  return s;
}

export function aiStep(world: World): void {
  const w = world;
  const st = aiState(w);
  const e = w.enemies;
  const n = e.count;

  // --- pass 0: init, auras, wave-end guarantee --------------------------------
  let targetable = 0, hidden = 0, boss = -1, commanders = 0;
  for (let i = 0; i < n; i++) {
    const f = e.flags[i];
    if (f & F_SKIP) continue;
    if (e.aiI[i] === -1) initEnemy(w, i);
    if ((f & F_BOSS) && boss < 0) boss = i;
    if (e.eliteMods[i] & M_COMMAND) commanders++;
    if (e.flags[i] & F_HIDDEN) hidden++; else targetable++;
  }
  st.boss = boss;
  if (hidden > 0 && targetable === 0) {
    if (++st.noTargetTicks >= FORCE_TICKS) { forceTangible(w); st.noTargetTicks = 0; }
  } else st.noTargetTicks = 0;
  if (commanders > 0) commandAuras(w);
  if (boss >= 0) bossAuras(w);

  // --- pass 1: behaviors ------------------------------------------------------
  const tick = w.tick;
  const rec = st.rec;
  readRecoveryParams(w, rec);
  for (let i = 0; i < n; i++) {
    const f = e.flags[i];
    if (f & F_SKIP) continue;
    // chill attack-slow: give back part of steering's attackT decrement
    const m = e.speedMul[i];
    if (m < 1 && m > 0 && e.attackT[i] > 0 && e.attackT[i] < 65535 && ((tick * 7 + i) % 8) < Math.round((1 - m) * 8)) e.attackT[i]++;
    if (e.rallyR[i] > 0 || e.rushT[i] > 0) recoverySpeed(w, i, rec);   // knockback Rally / anti-stall Rush
    if (f & F_BOSS) { if (e.rushT[i] > 0 || !bossMovement(w, i)) steerEnemy(w, i); continue; }   // a stepping-in boss (run/stall.ts) walks straight in
    const mods = e.eliteMods[i];
    if (mods !== 0) { eliteTick(w, i, regenAllowed(w, i, rec)); if (mods & M_PHASING) phaseToggle(w, i); }
    if (e.maxShield[i] > 0 && (e.kind[i] === K_SHIELDED || (mods & M_SHIELDED)) && regenAllowed(w, i, rec)) shieldRegen(w, i);
    behave(w, i, st.boss);
  }

  // --- pass 2: separation -----------------------------------------------------
  if ((tick & 1) === 0) st.sepCursor = separate(w, st.sepCursor);
  spatialStale();
}

function behave(w: World, i: number, boss: number): void {
  const e = w.enemies;
  switch (e.kind[i]) {
    case K_SWARM: case K_FRAGMENT: case K_BROOD: swarmMove(w, i); break;
    case K_RUNNER: runnerMove(w, i); break;
    case K_BRUTE: bruteMove(w, i); break;
    case K_CARRIER: steerEnemy(w, i); carrierTick(w, i); break;
    case K_HEALER: steerEnemy(w, i); healerTick(w, i); break;
    case K_LEECH: if (!leechTick(w, i)) steerEnemy(w, i); break;
    case K_WARDEN: steerEnemy(w, i); wardenTick(w, i); break;
    case K_ARTILLERY: artilleryMove(w, i); break;
    case K_CHARGER: chargerMove(w, i); break;
    case K_PHASE: phaseToggle(w, i); steerEnemy(w, i); break;
    case K_BURROWER: burrowerMove(w, i); break;
    case K_NULLIFIER: steerEnemy(w, i); nullifierTick(w, i); break;
    case K_REFRACTOR: steerEnemy(w, i); e.angle[i] = faceTower(e.x[i], e.y[i]); break;
    case K_BOSS_ADD: bossAddMove(w, i, boss); break;
    // grunt, kamikaze (core steering detonates it: Ev.Explosion → explosion fx), shielded, splitter
    // (splits on death), veteran (resistance in damageModifier), armored, anchor (Immovable; statuses
    // halve Chill), jammer (Jams flag is read by hardpoints), clump
    default: steerEnemy(w, i); break;
  }
}

function faceTower(x: number, y: number): number { return atan2(-y, -x); }

function initEnemy(w: World, i: number): void {
  const e = w.enemies;
  e.aiI[i] = AI_INIT;   // aiA/aiB start at 0 from the pool (boss scripts may already have set a role slot)
  e.fx[i] = e.x[i]; e.fy[i] = e.y[i];
  if (e.flags[i] & EnemyFlag.Elite) initElite(w, i);
  if (e.kind[i] === K.burrower) e.flags[i] |= EnemyFlag.Burrowed;
}

function forceTangible(w: World): void {
  const e = w.enemies;
  for (let i = 0; i < e.count; i++) {
    if (e.flags[i] & EnemyFlag.Dead) continue;
    if (e.aiI[i] === -1) e.aiI[i] = AI_INIT;
    e.aiI[i] |= AI_FORCED | AI_SURFACED;
    e.flags[i] &= ~(EnemyFlag.Phased | EnemyFlag.Burrowed);
  }
}

/** Boss accelerate_adds / dilation_pulse / rally: enemies within 300 of the boss move 50% faster. */
function bossAuras(w: World): void {
  const s = bossState(w), e = w.enemies;
  for (const c of s.ctrls) {
    if (!c.active || c.accelT <= 0) continue;
    const b = w.resolveEnemy(c.index, c.gen);
    if (b < 0) continue;
    ensureSpatial(w);
    const q = w.queryRadius(e.x[b], e.y[b], 300, SCR);
    for (let k = 0; k < q; k++) { const j = SCR[k]; if (j !== b && !(e.flags[j] & EnemyFlag.Dead)) e.speedMul[j] *= 1.5; }
  }
}
