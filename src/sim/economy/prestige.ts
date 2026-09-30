/**
 * Prestige economy (design §3, §14, §16).
 *
 *  - `prestigeEchoes(w)`: Echoes a Prestige pays right now:
 *      floor(floor(10 · 1.2^(D−20) · (1 + 0.1·T)) · economy.echo_mul · codexMultiplier)
 *    D = run.deepestCleared (0 Echoes below 20), T = lowest Threat Dial level used this Prestige.
 *  - `buyPrestige(w, node)`: Prestige-layer purchase with Echoes (cost base·1.5^rank, layers open at
 *    deepest-ever 20/40/60/80); side effects (Frames unlock, slots, sockets) apply immediately.
 *  - `metaEffects(meta, build)`: stat effects that come from meta state rather than nodes — Trial
 *    rewards and stat-shaped Trial constraints. StatResolver applies them after Anomalies.
 *  - `trialHas(trial, rule)`: the Trial rule table (pure; stats.ts, slots.ts, the machine read it).
 *  - `progressionCostMul`: Branch Discount (−25% on the chosen tree) and the Scatter reward
 *    (Gravitics Exotic costs no Cores); economy/shop.ts multiplies prices by it.
 *  - `socketCount`, `allowedSpeed` / `autoSpeed` (Accelerated Clearing, Speed Controls).
 */
import type { BuildState, MetaState, RunState } from '../core/types';
import type { WorldImpl } from '../core/world-impl';
import type { StatEffect, PrestigeNodeDef } from '../data/schema';
import type { FrameId, TrialId } from '../core/ids';
import type { NodeInfo } from '../core/content';
import { Ev } from '../core/types';
import { nodeInfo } from '../core/content';
import { echoesFor, frontierFor, nodeCost } from './curves';
import { codexMultiplier } from './codex';

/** Deepest-ever wave that opens each Prestige layer (index = layer − 1). */
export const LAYER_WAVES = [20, 40, 60, 80] as const;
export const BASE_SOCKETS = 3;
export const MAX_SOCKETS = 5;

export function prank(meta: MetaState, id: string): number { return meta.prestigeRanks[id] | 0; }

/** Echoes a Prestige would pay this second. */
export function prestigeEchoes(w: WorldImpl): number {
  const run = w.run;
  const T = Math.min(run.threatDial, run.minThreatDial ?? run.threatDial);
  const base = echoesFor(run.deepestCleared, T);
  if (base <= 0) return 0;
  return Math.floor(base * Math.max(0, w.stats.get('economy.echo_mul')) * codexMultiplier(w.meta) + 1e-9);
}

export function layerOpen(meta: MetaState, layer: number): boolean {
  const need = LAYER_WAVES[layer - 1];
  return need !== undefined && meta.deepestEver >= need;
}

/** Price of the next rank of a Prestige node (Echoes), or null if unknown. */
export function prestigeNodePrice(meta: MetaState, id: string): number | null {
  const info = nodeInfo(id);
  if (!info || info.group !== 'prestige') return null;
  return nodeCost(info.def, prank(meta, id)).cost;
}

/** Buy one rank of a Prestige node with Echoes. Returns an error or null. */
export function buyPrestige(w: WorldImpl, id: string): string | null {
  const meta = w.meta;
  const info = nodeInfo(id);
  if (!info || info.group !== 'prestige') return 'Unknown Prestige node';
  const def = info.def as PrestigeNodeDef;
  if (!layerOpen(meta, def.layer)) return `Prestige ${['I', 'II', 'III', 'IV'][def.layer - 1]} opens at wave ${LAYER_WAVES[def.layer - 1]}`;
  const rank = prank(meta, id);
  if (rank >= def.maxRank) return 'Max rank';
  const cost = nodeCost(def, rank).cost;
  if (meta.echoes < cost) return 'Not enough Echoes';
  meta.echoes -= cost;
  meta.prestigeRanks[id] = rank + 1;
  if (id === 'prestige.frames') unlockFrames(meta, ['arsenal', 'conductor']);
  w.emit(Ev.Purchase, id, rank + 1, cost, 0, 0, -1);
  w.build.anomalySockets = Math.max(w.build.anomalySockets, socketCount(meta));
  w.rebuildStats();   // run/prestige.ts reopens slots (Weapon Seed etc.) after this
  return null;
}

export function unlockFrames(meta: MetaState, frames: FrameId[]): void {
  for (const f of frames) if (!meta.unlockedFrames.includes(f)) meta.unlockedFrames.push(f);
}
export function frameUnlocked(meta: MetaState, frame: FrameId): boolean {
  return frame === 'standard' || meta.unlockedFrames.includes(frame);
}

/** Anomaly sockets: 3, +1 Prestige II Anomaly Socket, +1 Ascension I (5 max). */
export function socketCount(meta: MetaState): number {
  return Math.min(MAX_SOCKETS, BASE_SOCKETS + (prank(meta, 'prestige.anomaly_socket') > 0 ? 1 : 0) + (meta.ascension >= 1 ? 1 : 0));
}

/** Highest Threat Dial level: 10, or 20 from Ascension IV. */
export function maxThreatDial(meta: MetaState): number { return meta.ascension >= 4 ? 20 : 10; }

function speedForRank(r: number): 1 | 2 | 4 | 8 { return r >= 3 ? 8 : r === 2 ? 4 : r === 1 ? 2 : 1; }

/**
 * Highest speed the current wave may run at: waves at or below the deepest wave ever cleared
 * ("solved") allow ×2/×4/×8 by rank from Accelerated Clearing (Prestige I, automatic) or Speed
 * Controls (Prestige III, manual) — the larger of `autoSpeed` and `manualSpeedCap`.
 */
export function allowedSpeed(run: RunState, meta: MetaState): 1 | 2 | 4 | 8 {
  const a = autoSpeed(run, meta), m = manualSpeedCap(run, meta);
  return a > m ? a : m;
}
/** Speed Controls' manual cap on the current wave: ×2/×4/×8 by rank on solved waves, else 1. */
export function manualSpeedCap(run: RunState, meta: MetaState): 1 | 2 | 4 | 8 {
  if (run.wave > meta.deepestEver) return 1;
  return speedForRank(prank(meta, 'prestige.speed_controls'));
}
/** Accelerated Clearing's automatic speed for the current wave (1 = none). */
export function autoSpeed(run: RunState, meta: MetaState): 1 | 2 | 4 | 8 {
  if (run.wave > meta.deepestEver) return 1;
  return speedForRank(prank(meta, 'prestige.accelerated_clearing'));
}

// ---------------------------------------------------------------------------
// Trials: rule table (constraints) — pure
// ---------------------------------------------------------------------------
export type TrialRule =
  | 'no_hardpoints' | 'no_primary' | 'drones_only' | 'blade_only' | 'one_attunement' | 'no_fusions'
  | 'no_active' | 'no_auto_primary' | 'scatter' | 'swarm' | 'poverty' | 'pacifist';

const TRIAL_RULES: Record<TrialId, readonly TrialRule[]> = {
  bare_metal: ['no_hardpoints'],
  hive_mind: ['no_primary', 'drones_only'],
  siege_mentality: ['no_primary', 'blade_only'],
  monochrome: ['one_attunement', 'no_fusions'],
  blackout: ['no_active'],
  commander: ['no_auto_primary'],
  scatter: ['scatter'],
  swarmstorm: ['swarm'],
  poverty: ['poverty'],
  pacifist_core: ['pacifist'],
};

export function trialHas(trial: TrialId | null | undefined, rule: TrialRule): boolean {
  return !!trial && (TRIAL_RULES[trial]?.includes(rule) ?? false);   // unknown ids (corrupt saves) have no rules
}

/** Frames granted by Trial rewards (first tier). */
export const TRIAL_FRAMES: Partial<Record<TrialId, FrameId>> = { bare_metal: 'monolith', hive_mind: 'hive', siege_mentality: 'bulwark' };

const fx = (stat: string, op: StatEffect['op'], perRank: number): StatEffect => ({ stat, op, perRank });

/**
 * Meta-level stat effects (applied by StatResolver after Anomalies, rank 1):
 *  Trial rewards (tier 1 completed): Monochrome +1 element stack cap, Blackout +10% Counter
 *  efficiency for Directive and Autocast casts, Swarmstorm Critical Mass threshold −30%, Poverty Strip Mine
 *  ×5 (only while Strip Mine is owned under Salvage). (Commander's second designator is read by the
 *  abilities system from meta.trials; Scatter's reward is a price rule; frames unlock directly.)
 *  Active Trial constraints: Poverty Scrap −75%.
 */
export function metaEffects(meta: MetaState, build: BuildState): StatEffect[] {
  const out: StatEffect[] = [];
  const t = meta.trials;
  if ((t.monochrome ?? 0) >= 1) out.push(fx('status.stack_cap_bonus', 'add', 1));
  if ((t.blackout ?? 0) >= 1) out.push(fx('directives.counter_efficiency', 'add', 0.1));   // Directive and Autocast casts both score at it
  if ((t.swarmstorm ?? 0) >= 1) out.push(fx('reactor.critical_mass.threshold', 'mul', -0.3));
  if ((t.poverty ?? 0) >= 1 && (build.ranks['reactor.salvage.strip_mine'] | 0) > 0
    && (build.doctrines.reactor === 'salvage' || build.secondDoctrines.reactor === 'salvage')) out.push(fx('economy.first_clear_mul', 'set', 5));
  if (trialHas(meta.activeTrial, 'poverty')) out.push(fx('economy.scrap_mul', 'mul', -0.75));
  return out;
}

/** Tree a node's price belongs to for Branch Discount (tree nodes and that hardpoint's Infusions). */
function discountKey(info: NodeInfo): string | null {
  if (info.group === 'tree') return info.tree ?? null;
  if (info.group === 'infuse') return info.system ?? null;
  return null;
}

/** Progression price multiplier on top of the shop's own (Arsenal) multiplier. */
export function progressionCostMul(w: WorldImpl, info: NodeInfo, currency: 'scrap' | 'cores'): number {
  if (currency === 'cores') {
    if (info.exotic && info.tree === 'gravitics' && (w.meta.trials.scatter ?? 0) >= 1) return 0;
    return 1;
  }
  const tree = w.run.discountTree;
  if (tree && prank(w.meta, 'prestige.branch_discount') > 0 && discountKey(info) === tree) {
    return Math.max(0, 1 - w.stats.get('prestige.branch_discount.amount'));
  }
  return 1;
}

/** Echoes ever earned: the bank plus everything spent on Prestige nodes (spending never lowers it). */
export function lifetimeEchoes(meta: MetaState): number {
  let total = Math.max(0, meta.echoes);
  const ranks = meta.prestigeRanks;
  for (const id in ranks) {
    const info = nodeInfo(id);
    if (!info || info.group !== 'prestige') continue;
    const r = ranks[id] | 0;
    for (let k = 0; k < r; k++) total += nodeCost(info.def, k).cost;
  }
  return total;
}

// Memo for frontierWave (the machine reads it at every wave start, the UI at ≤ 10 Hz). Keyed by the MetaState
// object and checked against the only inputs that can change lifetime Echoes, so it is a pure cache (never iterated).
interface FrontierMemo { echoes: number; count: number; rankSum: number; frontier: number }
const frontierMemo = new WeakMap<MetaState, FrontierMemo>();

/**
 * The Frontier (economy/curves.ts frontierFor): waves past it are hardened. Wave 28 until the first Prestige pays
 * Echoes, then ~10 waves past the depth of the player's lifetime Echoes.
 */
export function frontierWave(meta: MetaState): number {
  let rankSum = 0;
  for (const id in meta.prestigeRanks) rankSum += meta.prestigeRanks[id] | 0;
  const m = frontierMemo.get(meta);
  if (m && m.echoes === meta.echoes && m.count === meta.prestigeCount && m.rankSum === rankSum) return m.frontier;
  const frontier = frontierFor(lifetimeEchoes(meta));
  frontierMemo.set(meta, { echoes: meta.echoes, count: meta.prestigeCount, rankSum, frontier });
  return frontier;
}

/** Rank cap including Fusion Apex (+1 on Fusions from Ascension II). */
export function effectiveMaxRank(w: WorldImpl, info: NodeInfo): number {
  return info.def.maxRank + (info.group === 'fusion' && w.meta.ascension >= 2 ? 1 : 0);
}

/** Triads are sold only from Ascension II. */
export function triadsUnlocked(w: WorldImpl): boolean { return w.meta.ascension >= 2; }
