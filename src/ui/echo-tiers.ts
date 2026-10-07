/**
 * The four Echo tiers (the layers of the Echo shop under Prestige → Echo tiers) and the REAL gate of everything behind
 * them. Pure, no DOM. The tiers were called "Prestige I–IV", which read like the Prestige count; a lock that said
 * "Prestige II" looked wrong because the real gate is a deepest-ever wave plus buying one Echo node. Every player-facing
 * lock text is built here from the data (src/sim/data/prestige.ts), so the wave and the price cannot drift from the game.
 */
import { PRESTIGE_NODES } from '@sim/data/index';
import { fmtAmount, nextRankCost } from './format';

export interface EchoTier { layer: 1 | 2 | 3 | 4; roman: 'I' | 'II' | 'III' | 'IV'; name: string; wave: number; blurb: string }

export const ECHO_TIERS: readonly EchoTier[] = [
  { layer: 1, roman: 'I', name: 'Inheritance', wave: 20, blurb: 'Compress content you have mastered.' },
  { layer: 2, roman: 'II', name: 'Arsenal Memory', wave: 40, blurb: 'Plan builds instead of rebuilding them.' },
  { layer: 3, roman: 'III', name: 'Command Network', wave: 60, blurb: 'Program the machine.' },
  { layer: 4, roman: 'IV', name: 'Evolution', wave: 80, blurb: 'Build strange engines.' },
];

/** "Echo tier II" (short) or "Echo tier II: Arsenal Memory" (full). */
export function tierLabel(layer: number, full = false): string {
  const t = ECHO_TIERS[layer - 1];
  return t ? `Echo tier ${t.roman}${full ? `: ${t.name}` : ''}` : `Echo tier ${layer}`;
}

/** The Echo tier a prestige node (id with or without the `prestige.` prefix) lives in, or 0. */
export function tierOfNode(node: string): number {
  const id = node.startsWith('prestige.') ? node : `prestige.${node}`;
  return PRESTIGE_NODES.find((n) => n.id === id)?.layer ?? 0;
}

/** "Echo tier III" for a node: for sentences like "a third slot (Echo tier III)". */
export function nodeTier(node: string): string { return tierLabel(tierOfNode(node)); }

export interface Gate {
  node: string; name: string; wave: number; cost: number;
  /** The tier's wave is reached (deepest ever), only the Echo purchase is left. */
  waveMet: boolean;
  /** "Reach wave 40 · buy Trials (120 Echoes)", or "Buy Trials in Prestige → Echo tiers (120 Echoes)" once the wave is met. */
  text: string;
  /** Same without the verb frame, for a fold line: "wave 40 + Trials (120 Echoes)". */
  short: string;
}

/** The gate of a prestige node for a player whose deepest wave ever is `deepestEver`. null: no such node. */
export function nodeGate(node: string, deepestEver: number): Gate | null {
  const id = node.startsWith('prestige.') ? node : `prestige.${node}`;
  const def = PRESTIGE_NODES.find((n) => n.id === id);
  if (!def) return null;
  const wave = ECHO_TIERS[def.layer - 1]?.wave ?? 0;
  const cost = nextRankCost(def.cost, 0);
  const price = `${fmtAmount(cost)} Echoes`;
  const waveMet = deepestEver >= wave;
  return {
    node: id, name: def.name, wave, cost, waveMet,
    text: waveMet ? `Buy ${def.name} in Prestige → Echo tiers (${price})` : `Reach wave ${wave} · buy ${def.name} (${price})`,
    short: `wave ${wave} + ${def.name} (${price})`,
  };
}

/** Lock text of a feature that is bought with one Echo node (null when owned: `rank > 0`). */
export function gateText(node: string, deepestEver: number, rank = 0): string | null {
  if (rank > 0) return null;
  return nodeGate(node, deepestEver)?.text ?? null;
}

/** The earliest-gated node of a list (for a feature that either of several nodes opens). */
export function earliestGate(nodes: readonly string[], deepestEver: number): Gate | null {
  const gs = nodes.map((n) => nodeGate(n, deepestEver)).filter((g): g is Gate => !!g);
  gs.sort((a, b) => a.wave - b.wave || a.cost - b.cost);
  return gs[0] ?? null;
}
