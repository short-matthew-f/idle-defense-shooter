/**
 * Support / aura / reaction behaviors (WP5):
 *  - Carrier   releases 3 brood every 4 s (Ev.Spawn caused by the carrier's own Spawn event)
 *  - Healer    heals enemies within its aura for 4% max HP per second (0.5 s pulses, one Ev.Heal per pulse)
 *  - Warden    projects shields onto enemies inside its ring (+6% max HP per 0.5 s, cap 30% max HP)
 *  - Nullifier strips every status stack inside its field every 0.5 s
 *  - Leech     tethers to the tower inside 130: drains (barrier → shield → HP) every 0.5 s and heals itself
 *  - Shielded (and shielded_elite) shields regenerate after 3 s without damage
 *  - Veteran   takes 2% less damage per second alive (max 50%), via World.damageModifier
 * Reaction hooks: Splitter → 3 fragments on death; elite `splitting` → 2; elite `volatile` → a
 * hostile blast; elite `vampiric` heals on tower hits; Phase enemies shrug off statuses while phased.
 */
import type { World } from '../../core/world';
import type { InstanceWriter } from '../../core/system';
import type { StatusId } from '../../core/ids';
import { EnemyFlag, Ev, Shape, TICK_RATE, TOWER_RADIUS } from '../../core/types';
import { cos, sin, TAU, growth } from '../../math/lut';
import { CONTACT_GROWTH } from '../../economy/curves';
import { enemyDef } from '../../core/content';
import { K, AI_TETHER, AI_WINDUP, TAG_ENEMY, ensureSpatial } from './kinds';
import { hasMod, MOD } from '../elites';
import { addShield, canSpawn, healEnemy, stripStatuses } from '../bosses/common';

const SCR = new Int32Array(256);
const PULSE = 30;                      // 0.5 s aura pulses
const LEECH_RANGE = 130;

const WARDEN_R = enemyDef('warden').auraRadius ?? 110;
const HEALER_R = enemyDef('healer').auraRadius ?? 90;
const NULL_R = enemyDef('nullifier').auraRadius ?? 100;

function pulseNow(w: World, i: number): boolean { return (w.tick + w.enemies.gen[i]) % PULSE === 0; }

export function carrierTick(w: World, i: number): void {
  const e = w.enemies;
  e.aiA[i] += 1;
  if (e.aiA[i] < 4 * TICK_RATE) return;
  e.aiA[i] = 0;
  for (let k = 0; k < 3 && canSpawn(w); k++) {
    const a = e.angle[i] + (k - 1) * 0.8;
    w.spawnEnemy('brood', e.x[i] + cos(a) * (e.radius[i] + 6), e.y[i] + sin(a) * (e.radius[i] + 6), { cause: e.spawnEv[i] });
  }
}

export function healerTick(w: World, i: number): void {
  if (!pulseNow(w, i)) return;
  ensureSpatial(w);
  const e = w.enemies;
  const n = w.queryRadius(e.x[i], e.y[i], HEALER_R, SCR);
  let total = 0;
  for (let k = 0; k < n; k++) {
    const j = SCR[k];
    if (j === i || (e.flags[j] & (EnemyFlag.Dead | EnemyFlag.Boss | EnemyFlag.Ally))) continue;
    const room = e.maxHp[j] - e.hp[j];
    if (room <= 0) continue;
    const amt = Math.min(room, e.maxHp[j] * 0.02);
    e.hp[j] += amt; total += amt;
  }
  if (total > 0) w.emit(Ev.Heal, 'healer', i, total, e.x[i], e.y[i], e.spawnEv[i]);
}

export function wardenTick(w: World, i: number): void {
  if (!pulseNow(w, i)) return;
  ensureSpatial(w);
  const e = w.enemies;
  const n = w.queryRadius(e.x[i], e.y[i], WARDEN_R, SCR);
  for (let k = 0; k < n; k++) {
    const j = SCR[k];
    if (j === i || (e.flags[j] & (EnemyFlag.Dead | EnemyFlag.Boss | EnemyFlag.Ally))) continue;
    addShield(w, j, e.maxHp[j] * 0.06, 0.3);
  }
}

export function nullifierTick(w: World, i: number): void {
  if (!pulseNow(w, i)) return;
  ensureSpatial(w);
  const e = w.enemies;
  const n = w.queryRadius(e.x[i], e.y[i], NULL_R, SCR);
  for (let k = 0; k < n; k++) { const j = SCR[k]; if (!(e.flags[j] & EnemyFlag.Dead)) stripStatuses(w, j); }
}

/** Leech: returns true when tethered (it holds position and drains instead of walking in). */
export function leechTick(w: World, i: number): boolean {
  const e = w.enemies;
  const x = e.x[i], y = e.y[i];
  if (x * x + y * y > LEECH_RANGE * LEECH_RANGE) { e.aiI[i] &= ~AI_TETHER; return false; }
  e.aiI[i] |= AI_TETHER;
  e.vx[i] = 0; e.vy[i] = 0;
  if (e.attackT[i] > 0) e.attackT[i]--;
  if (e.staggerT[i] === 0 && e.frozenT[i] === 0 && pulseNow(w, i)) {
    const dmg = e.contact[i] * growth(CONTACT_GROWTH, w.run.wave) * 0.5;
    w.damageTower(dmg, i, e.spawnEv[i]);
    healEnemy(w, i, e.maxHp[i] * 0.03, 'leech', e.spawnEv[i]);
  }
  return true;
}

/** Shield regeneration after 3 s without damage (Shielded, shielded_elite). */
export function shieldRegen(w: World, i: number): void {
  const e = w.enemies;
  if (e.maxShield[i] <= 0 || e.shield[i] >= e.maxShield[i]) return;
  if (e.lastHitTick[i] >= 0 && w.tick - e.lastHitTick[i] < 3 * TICK_RATE) return;
  e.shield[i] = Math.min(e.maxShield[i], e.shield[i] + e.maxShield[i] * 0.25 / TICK_RATE);
}

export function veteranMul(w: World, i: number): number {
  const secs = (w.tick - w.enemies.spawnTick[i]) / TICK_RATE;
  const r = 0.02 * secs;
  return 1 - (r > 0.5 ? 0.5 : r < 0 ? 0 : r);
}

// ---------------------------------------------------------------------------
// Reaction hooks (called from BossSystem)
// ---------------------------------------------------------------------------
function spawnFragments(w: World, i: number, n: number, cause: number): void {
  const e = w.enemies;
  const a0 = e.angle[i];
  for (let k = 0; k < n && canSpawn(w); k++) {
    const a = a0 + (TAU * k) / n;
    const j = w.spawnEnemy('splitter_fragment', e.x[i] + cos(a) * (e.radius[i] + 4), e.y[i] + sin(a) * (e.radius[i] + 4), { cause });
    if (j >= 0) e.formT[j] = 0;
  }
}

export function onEnemyKilled(w: World, i: number, killEv: number): void {
  const e = w.enemies;
  if (e.kind[i] === K.splitter) spawnFragments(w, i, 3, killEv);
  const mods = e.eliteMods[i];
  if (mods === 0) return;
  if (hasMod(mods, MOD.splitting)) spawnFragments(w, i, 2, killEv);
  if (hasMod(mods, MOD.volatile)) {
    const x = e.x[i], y = e.y[i];
    const dmg = e.contact[i] * growth(CONTACT_GROWTH, w.run.wave) * 1.5;
    const id = w.emit(Ev.Explosion, TAG_ENEMY, 60, dmg, x, y, killEv);
    const rr = 60 + TOWER_RADIUS;
    if (x * x + y * y <= rr * rr) w.damageTower(dmg, i, id);
  }
}

export function onEnemyTowerHit(w: World, damage: number, enemy: number, cause: number): void {
  const e = w.enemies;
  if (enemy < 0 || enemy >= e.count || !hasMod(e.eliteMods[enemy], MOD.vampiric) || !w.alive(enemy)) return;
  healEnemy(w, enemy, damage * 2 + e.maxHp[enemy] * 0.03, 'vampiric', cause);
}

/** Phased enemies are intangible: statuses pass through them. */
export function onEnemyStatus(w: World, enemy: number, status: StatusId): void {
  const e = w.enemies;
  if (!(e.flags[enemy] & EnemyFlag.Phased)) return;
  switch (status) {
    case 'burn': e.burn[enemy] = 0; e.burnT[enemy] = 0; break;
    case 'poison': e.poison[enemy] = 0; e.poisonT[enemy] = 0; break;
    case 'chill': e.chill[enemy] = 0; e.chillT[enemy] = 0; break;
    case 'shock': e.shock[enemy] = 0; e.shockT[enemy] = 0; break;
    case 'bleed': e.bleed[enemy] = 0; e.bleedT[enemy] = 0; break;
    case 'brittle': e.brittle[enemy] = 0; e.brittleT[enemy] = 0; break;
    case 'static': e.staticStacks[enemy] = 0; e.staticT[enemy] = 0; break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Render: leech tethers (layer 3 hostile beams), warden shield links, charger telegraphs
// ---------------------------------------------------------------------------
export function renderBehaviors(w: World, out: InstanceWriter): void {
  const e = w.enemies, n = e.count;
  for (let i = 0; i < n; i++) {
    const f = e.flags[i];
    if (f & EnemyFlag.Dead) continue;
    const k = e.kind[i];
    if (k === K.leech && (e.aiI[i] & AI_TETHER) && e.aiI[i] !== -1) out.push(e.x[i], e.y[i], 1.8, 0, Shape.Line, 0.9, 1, 0.2, 0.85, 3, 0, 0);
    else if (k === K.charger && e.aiI[i] !== -1 && (e.aiI[i] & AI_WINDUP)) out.push(e.x[i], e.y[i], 3, 0, Shape.Line, 1, 0.4, 0.3, 0.7, 7, e.x[i] * 0.2, e.y[i] * 0.2);
    else if (k === K.warden) {
      const r2 = WARDEN_R * WARDEN_R;
      let links = 0;
      for (let j = 0; j < n && links < 8; j++) {
        if (j === i || (e.flags[j] & (EnemyFlag.Dead | EnemyFlag.Boss)) || e.shield[j] <= 0) continue;
        const dx = e.x[j] - e.x[i], dy = e.y[j] - e.y[i];
        if (dx * dx + dy * dy > r2) continue;
        out.push(e.x[i], e.y[i], 1.2, 0, Shape.Line, 0.5, 0.8, 1, 0.55, 5, e.x[j], e.y[j]);
        links++;
      }
    }
  }
}
