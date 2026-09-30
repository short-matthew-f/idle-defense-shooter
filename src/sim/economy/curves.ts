/**
 * Economy curves (design §17, ARCHITECTURE "Economy constants"). Every power goes through
 * `growth(g, n)` so results are bit-identical across engines.
 *
 *   EnemyHP(w)      = 6 · 1.14^w · k · 1.6^A · (1 + 0.12·T)   (design start: 10 · 1.13^w; balance + onboarding passes, docs/BALANCE.md)
 *                     × FRONTIER_GROWTH^(w − Frontier) past the Frontier (applied by the wave generator, see below)
 *   BossHP(w)       = 12 · EnemyHP(w) · boss.hpMul         (hpMul now rises with the wave, data/bosses.ts)
 *   ScrapPerKill(w) = 1.10^w · k                       (design start 1.11^w; first clear ×3; Strip Mine ×4; Poverty reward ×5)
 *   StatCost(r)     = base · g^r
 *   Mechanic cost   = flat per rank; tiers ×8 within a tree
 *   Echoes(D,T)     = floor(10 · 1.2^(D−20) · (1 + 0.1·T)), 0 when D < 20
 *   Stars(D,A)      = floor(4 · (1+A) · 1.1^(D−100))
 */
import { growth, log } from '../math/lut';
import type { NodeDef } from '../data/schema';

export const ENEMY_HP_BASE = 6;
export const ENEMY_HP_GROWTH = 1.14;
export const ASCENSION_HP_GROWTH = 1.6;
export const THREAT_HP_PER_LEVEL = 0.12;
export const THREAT_SPEED_PER_LEVEL = 0.03;
export const THREAT_SCRAP_PER_LEVEL = 0.05;
export const BOSS_HP_MUL = 12;
export const SCRAP_GROWTH = 1.10;
export const CONTACT_GROWTH = 1.06;
export const MECHANIC_TIER_GROWTH = 8;
export const BETWEEN_WAVE_HEAL = 0.25;
export const CORE_COSTS = { exotic: 2, refit: 3, doctrine: 1, reroll: 1 } as const;
export const REFIT_REFUND = 0.6;
export const HARDPOINT_SLOT_WAVES = [10, 30, 55, 75] as const;
export const ATTUNEMENT_SLOT_WAVES = [5, 25, 45] as const;
export const OFFLINE = { capSeconds: 8 * 3600, longCapSeconds: 24 * 3600, efficiency: 0.4, longEfficiency: 0.7 } as const;

/** HP of an ordinary enemy of weight k at wave w, Ascension A, Threat Dial T. */
export function enemyHp(wave: number, k: number, ascension = 0, dial = 0): number {
  return ENEMY_HP_BASE * growth(ENEMY_HP_GROWTH, wave) * k * growth(ASCENSION_HP_GROWTH, ascension) * (1 + THREAT_HP_PER_LEVEL * dial);
}

/** HP of the boss at wave w with BossDef.hpMul. */
export function bossHp(wave: number, hpMul: number, ascension = 0, dial = 0): number {
  return BOSS_HP_MUL * enemyHp(wave, 1, ascension, dial) * hpMul;
}

/** Base Scrap for one kill of weight k at wave w (before first-clear and economy multipliers). */
export function scrapPerKill(wave: number, k: number, dial = 0): number {
  return growth(SCRAP_GROWTH, wave) * k * (1 + THREAT_SCRAP_PER_LEVEL * dial);
}

/**
 * First-clear multiplier: ×3, Strip Mine ×4, Strip Mine with the Poverty Trial reward ×5.
 * (The Sim reads `economy.first_clear_mul`, which Strip Mine sets to 4; this helper is the reference.)
 */
export function firstClearMultiplier(stripMine = false, povertyReward = false): number {
  if (stripMine) return povertyReward ? 5 : 4;
  return 3;
}

/** Contact damage of an enemy at wave w. */
export function contactDamage(base: number, wave: number): number { return base * growth(CONTACT_GROWTH, wave); }

/** Stat node price for buying the next rank when `rank` ranks are owned. */
export function statCost(base: number, g: number, rank: number): number { return Math.ceil(base * growth(g, rank)); }

/** Flat mechanic price for tier t given the tier-1 price (×8 per tier). */
export function mechanicTierCost(tier1Price: number, tier: number): number { return tier1Price * growth(MECHANIC_TIER_GROWTH, Math.max(0, tier - 1)); }

/** Price of the next rank of a node: Scrap for stat/flat nodes, Cores for Core nodes. */
export function nodeCost(def: NodeDef, rank: number): { cost: number; currency: 'scrap' | 'cores' } {
  const c = def.cost;
  if ('cores' in c) return { cost: c.cores, currency: 'cores' };
  if ('flat' in c) return { cost: c.flat[Math.min(rank, c.flat.length - 1)] ?? 0, currency: 'scrap' };
  return { cost: statCost(c.base, c.growth, rank), currency: 'scrap' };
}

/**
 * The Frontier (onboarding pass, docs/BALANCE.md): the first Prestige's wall. Enemies on waves past the Frontier get
 * FRONTIER_GROWTH× more HP per wave beyond it (bosses and escorts included), so a run hits a real wall a wave or two
 * past it. The Frontier sits at FRONTIER_FIRST until the player has earned Echoes, then at STEP waves past the depth
 * those lifetime Echoes are worth (`echoDepthWave`): Prestiging from wave 28 moves it to 38, from 38 to ~49, and so
 * on, so every Prestige pushes ~10–13 waves (design §3: 8–15). Waves at or before it are the tuned game, unchanged;
 * lifetime Echoes (bank + spent) only grow at a Prestige, so the Frontier is fixed within a run.
 */
export const FRONTIER_FIRST = 28;
export const FRONTIER_STEP = 10;
export const FRONTIER_GROWTH = 3.5;

/** The wave whose Prestige pays `echoes` (inverse of echoesFor at T = 0); 0 below one wave-20 payout. */
export function echoDepthWave(echoes: number): number {
  if (!(echoes >= 10)) return 0;
  return 20 + log(echoes / 10) / log(1.2);
}

/** Frontier wave for a player who has earned `lifetimeEchoes` Echoes in total. */
export function frontierFor(lifetimeEchoes: number): number {
  const d = echoDepthWave(lifetimeEchoes);
  return d > 0 ? Math.max(FRONTIER_FIRST, Math.round(d) + FRONTIER_STEP) : FRONTIER_FIRST;
}

/** Enemy HP multiplier on `wave` for a Frontier at `frontier` (1 at or before it). */
export function frontierHpMul(wave: number, frontier: number): number {
  return wave > frontier ? growth(FRONTIER_GROWTH, wave - frontier) : 1;
}

/** Echoes paid by a Prestige with deepest cleared wave D and Threat Dial T. */
export function echoesFor(D: number, T = 0): number {
  if (D < 20) return 0;
  return Math.floor(10 * growth(1.2, D - 20) * (1 + 0.1 * T));
}

/** Stars paid by an Ascension from depth D at Ascension count A. */
export function starsFor(D: number, A = 0): number {
  return Math.floor(4 * (1 + A) * growth(1.1, D - 100));
}

/**
 * Offline Scrap: measured Patrol rate × capped elapsed time × efficiency. `longPatrol` is either the resolved Long Patrol
 * stats (offline.cap_hours / offline.efficiency: +4 h and +7.5 points per rank, 8 h / 40% → 24 h / 70% at rank 4) or a
 * boolean (legacy callers: true = the full rank-4 values).
 */
export function offlineScrap(patrolScrapPerSecond: number, elapsedSeconds: number, longPatrol: boolean | { capHours: number; efficiency: number }): number {
  const cap = typeof longPatrol === 'object' ? Math.max(0, longPatrol.capHours) * 3600 : longPatrol ? OFFLINE.longCapSeconds : OFFLINE.capSeconds;
  const eff = typeof longPatrol === 'object' ? Math.max(0, longPatrol.efficiency) : longPatrol ? OFFLINE.longEfficiency : OFFLINE.efficiency;
  return Math.floor(Math.max(0, patrolScrapPerSecond) * Math.min(Math.max(0, elapsedSeconds), cap) * eff);
}
