/**
 * Node constructors shared by the WP-DATA content tables. Pure data helpers:
 * they only assemble NodeDef / DoctrineDef literals so the tables stay compact
 * and consistently priced. No gameplay logic lives here.
 *
 * Pricing (design §17, ARCHITECTURE "Economy constants"):
 *  - stat nodes:     cost(rank) = base * growth^rank, growth in [1.15, 1.22]
 *  - mechanic nodes: flat per rank; the first-rank price rises ×8 per tier
 *                    (tier 1: 150, tier 2: 1200, tier 3: 9600) and each further
 *                    rank of the same node costs ×3 the previous one
 *  - exotics:        2 Cores
 * Hardpoint trees pass scale 1.5.
 */
import type { AbilityId, DoctrineId, TreeId } from '../core/ids';
import type { DoctrineDef, NodeDef, StatEffect, StatOp } from './schema';

/** First-rank flat price of a mechanic node by tier (×8 per tier). */
export const TIER_PRICE = { 1: 150, 2: 1200, 3: 9600 } as const;
/** Price multiplier between consecutive ranks of one mechanic node. */
export const RANK_STEP = 3;
/** Hardpoint trees start pricier (design §17 guidance). */
export const HARDPOINT_SCALE = 1.5;
/**
 * Balance pass: every stat node's per-rank price growth is raised by STAT_GROWTH_ADD and capped at
 * STAT_GROWTH_MAX (the top of the design's 1.15–1.22 range), so late ranks keep costing real Scrap
 * as income grows ×1.10 per wave. The tables keep their authored (relative) growth values.
 */
export const STAT_GROWTH_ADD = 0.03;
export const STAT_GROWTH_MAX = 1.22;
/**
 * Balance pass: every stat node's authored maxRank is scaled by STAT_RANK_SCALE (rounded up). With
 * the authored depths (20–60 ranks at ×1.19–1.22) a build never ran out of stat ranks before wave
 * ~60–70, so the Echo rate never peaked and the Forecast never recommended; at half depth the shop
 * of a first-Prestige build runs out around wave 45–55 and the §3 wall forms there. Nodes whose
 * text promises a maximum (Ablative Coating, Matched Edges, Containment Field) doubled their
 * per-rank value instead of losing half the maximum.
 */
export const STAT_RANK_SCALE = 0.5;
export const STAT_BASE_MUL = 3;

export interface NodeOpts {
  requires?: string[];
  tags?: string[];
  ability?: AbilityId;
  /** Extra effects appended after the node's own stat effect. */
  effects?: StatEffect[];
}

/** Flat cost ladder: `ranks` prices starting at the tier price × scale, ×3 per rank. */
export function flat(tier: 1 | 2 | 3, ranks: number, scale = 1): number[] {
  const out: number[] = [];
  let c = TIER_PRICE[tier] * scale;
  for (let i = 0; i < ranks; i++) { out.push(Math.round(c)); c *= RANK_STEP; }
  return out;
}

function withOpts(n: NodeDef, o: NodeOpts): NodeDef {
  if (o.requires && o.requires.length) n.requires = o.requires;
  if (o.tags && o.tags.length) n.tags = o.tags;
  if (o.ability) n.ability = o.ability;
  return n;
}

/**
 * Stat node. Its StatKey equals its node id (rule shared with the stat resolver):
 * the first effect is always `{ stat: id, op, perRank }`.
 */
export function stat(
  id: string, name: string, desc: string,
  op: StatOp, perRank: number,
  base: number, growth: number, maxRank: number,
  tier: 0 | 1 | 2 = 0, o: NodeOpts = {},
): NodeDef {
  const effects: StatEffect[] = [{ stat: id, op, perRank }, ...(o.effects ?? [])];
  const g = Math.min(STAT_GROWTH_MAX, Math.max(growth, growth + STAT_GROWTH_ADD));
  return withOpts({ id, name, desc, kind: 'stat', maxRank: Math.max(1, Math.ceil(maxRank * STAT_RANK_SCALE)), cost: { base: base * STAT_BASE_MUL, growth: g }, tier, effects }, o);
}

/** Mechanic node: flat price per rank; maxRank = prices.length. */
export function mech(
  id: string, name: string, desc: string,
  tier: 1 | 2 | 3, prices: number[], effects: StatEffect[] = [], o: NodeOpts = {},
): NodeDef {
  const tags = ['mechanical', ...(o.tags ?? [])];
  return withOpts({ id, name, desc, kind: 'mechanic', maxRank: prices.length, cost: { flat: prices }, tier, effects: [...effects, ...(o.effects ?? [])] }, { ...o, tags });
}

/** Exotic node: one rank for 2 Cores. */
export function exotic(id: string, name: string, desc: string, effects: StatEffect[] = [], o: NodeOpts = {}): NodeDef {
  const tags = ['exotic', ...(o.tags ?? [])];
  return withOpts({ id, name, desc, kind: 'exotic', maxRank: 1, cost: { cores: 2 }, tier: 3, effects }, { ...o, tags });
}

/** Shorthand for a StatEffect. */
export function fx(stat: string, op: StatOp, perRank: number): StatEffect {
  return { stat, op, perRank };
}

/**
 * Doctrine: stamps `doctrine` on every node and picks the single tier-3 node as
 * the capstone. The capstone requires the doctrine's first node unless it says otherwise.
 */
export function doctrine(tree: TreeId, id: DoctrineId, name: string, identity: string, nodes: NodeDef[]): DoctrineDef {
  const caps = nodes.filter((n) => n.tier === 3);
  if (caps.length !== 1) throw new Error(`doctrine ${tree}/${id} must have exactly one capstone`);
  const capstone = caps[0];
  for (const n of nodes) n.doctrine = id;
  if (!capstone.requires && nodes[0] !== capstone) capstone.requires = [nodes[0].id];
  return { id, tree, name, identity, capstone: capstone.id, nodes };
}
