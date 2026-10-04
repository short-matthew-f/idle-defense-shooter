/**
 * Elite modifiers (design §12, WP5). The generator gives each elite spawn `elite: EliteModifier[]`;
 * World.spawnEnemy sets EnemyFlag.Elite, the ×2.5 HP and the `eliteMods` bitfield (bit = index in
 * ELITE_LIST). The AI applies the spawn-time effects once, before the elite first moves:
 *
 *  every elite     radius ×1.2 (the snapshot draws elites with a gold layer-5 outline)
 *  hardened        armor + 40 (and +50% of its own)       swift           speed ×1.4
 *  regenerating    regains 1.5% max HP/s when not hit for 1 s (inside the primary's range, not just pushed: recovery.ts)
 *  shielded_elite  shield = 60% max HP, regenerates after 3 s without damage (same gate)
 *  volatile        explodes on death (hostile blast, 60 radius; hurts the tower when close)
 *  phasing         blinks intangible like a Phase enemy (1.5 s on / 2.5 s off)
 *  splitting       splits into 2 fragments on death
 *  anchored        Immovable (no pull/knockback/freeze, half Chill)
 *  jamming         Jams aura (+Support)              refracting      Refracts beams
 *  vampiric        heals 2× the damage it deals to the tower (+3% max HP)
 *  commanding      enemies within 120 move 20% faster
 * Elite kills pay 12 CE and roll economy.core_drop_chance for a Core (core/world-impl.ts).
 */
import type { World } from '../core/world';
import { EnemyFlag, TICK_RATE } from '../core/types';
import { ELITE_LIST } from '../core/content';
import { ensureSpatial } from './behaviors/kinds';

export const MOD = {
  hardened: 1 << ELITE_LIST.indexOf('hardened'),
  swift: 1 << ELITE_LIST.indexOf('swift'),
  regenerating: 1 << ELITE_LIST.indexOf('regenerating'),
  shielded_elite: 1 << ELITE_LIST.indexOf('shielded_elite'),
  volatile: 1 << ELITE_LIST.indexOf('volatile'),
  phasing: 1 << ELITE_LIST.indexOf('phasing'),
  splitting: 1 << ELITE_LIST.indexOf('splitting'),
  anchored: 1 << ELITE_LIST.indexOf('anchored'),
  jamming: 1 << ELITE_LIST.indexOf('jamming'),
  refracting: 1 << ELITE_LIST.indexOf('refracting'),
  vampiric: 1 << ELITE_LIST.indexOf('vampiric'),
  commanding: 1 << ELITE_LIST.indexOf('commanding'),
} as const;

export function hasMod(bits: number, m: number): boolean { return (bits & m) !== 0; }

const COMMAND_R = 120;
const SCR = new Int32Array(256);

/** Spawn-time elite effects (once per enemy). */
export function initElite(w: World, i: number): void {
  const e = w.enemies;
  const m = e.eliteMods[i];
  if (!(e.flags[i] & EnemyFlag.Elite)) return;
  e.radius[i] *= 1.2;
  if (m === 0) return;
  if (m & MOD.hardened) e.armor[i] = e.armor[i] * 1.5 + 40;
  if (m & MOD.swift) e.speed[i] *= 1.4;
  if (m & MOD.shielded_elite) { const s = e.maxHp[i] * 0.6; if (e.maxShield[i] < s) e.maxShield[i] = s; e.shield[i] = e.maxShield[i]; }
  if (m & MOD.anchored) e.flags[i] |= EnemyFlag.Immovable;
  if (m & MOD.jamming) e.flags[i] |= EnemyFlag.Jams | EnemyFlag.Support;
  if (m & MOD.refracting) e.flags[i] |= EnemyFlag.Refracts;
}

/**
 * Per-tick elite upkeep (regeneration). Shield regen for shielded_elite is shared with Shielded (ai.ts).
 * `canRegen`: the knockback / range / Rush gate (enemies/recovery.ts regenAllowed).
 */
export function eliteTick(w: World, i: number, canRegen = true): void {
  const e = w.enemies;
  const m = e.eliteMods[i];
  if (canRegen && (m & MOD.regenerating) && e.hp[i] < e.maxHp[i] && (e.lastHitTick[i] < 0 || w.tick - e.lastHitTick[i] >= TICK_RATE)) {
    w.healEnemy(i, e.maxHp[i] * 0.015 / TICK_RATE, 'elite.regenerating', e.spawnEv[i], true);   // per-tick regen: silent
  }
}

/** Commanding elites: +20% movement for enemies within 120 (applied before anyone moves this tick). */
export function commandAuras(w: World): void {
  const e = w.enemies, n = e.count;
  for (let i = 0; i < n; i++) {
    if (!(e.eliteMods[i] & MOD.commanding) || (e.flags[i] & EnemyFlag.Dead)) continue;
    ensureSpatial(w);
    const q = w.queryRadius(e.x[i], e.y[i], COMMAND_R, SCR);
    for (let k = 0; k < q; k++) { const j = SCR[k]; if (j !== i && !(e.flags[j] & (EnemyFlag.Boss | EnemyFlag.Dead))) e.speedMul[j] *= 1.2; }
  }
}
