/**
 * Bulk-buy planning over ShopEntry previews (pure: no World, safe to import from the UI).
 *
 * `planCheapest` approximates what `buy_cheapest` would buy in one tree: it walks the entries'
 * `nextCosts` greedily (cheapest next rank first, ties to the entry listed first), without touching
 * state. It is an estimate, not a promise: it sees only the next NEXT_COSTS (10) prices of each node,
 * does not notice a node that a purchase would unlock (`requires`), and stops after `cap` steps.
 * The sim's `buy_cheapest` re-evaluates the live shop after every rank and is authoritative.
 */
import type { ShopEntry } from '../core/types';

/** Steps `shopTreeTotals` simulates per tree (the Max preview; the command itself allows up to 1000). */
export const TREE_PLAN_STEPS = 200;

/** Does a shop entry belong to bulk-tree `tree`? Ability rank nodes live in Reactor's tree view. */
export function inBulkTree(e: Pick<ShopEntry, 'tree'>, tree: string): boolean {
  return e.tree === tree || (tree === 'reactor' && e.tree === 'ability');
}

/** The bulk-tree key an entry is grouped under (ability rank nodes → 'reactor'). */
export function bulkTreeKey(e: Pick<ShopEntry, 'tree'>): string {
  return e.tree === 'ability' ? 'reactor' : e.tree;
}

/** Entries `buy_cheapest` may pick: Scrap-priced, unlocked, not a doctrine choice, with a next rank. */
export function bulkEligible(e: ShopEntry): boolean {
  return e.currency === 'scrap' && !e.locked && e.kind !== 'doctrine' && e.nextCosts.length > 0;
}

export interface CheapestPlan { affordableRanks: number; affordableTotal: number; picks: string[] }

/** Greedy cheapest-first plan over `entries` (already filtered to one tree) with `scrap`, at most `cap` ranks. */
export function planCheapest(entries: readonly ShopEntry[], scrap: number, cap: number): CheapestPlan {
  const list = entries.filter(bulkEligible);
  const idx = new Array<number>(list.length).fill(0);
  const picks: string[] = [];
  let left = scrap, total = 0;
  while (picks.length < cap) {
    let best = -1, bestCost = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i].nextCosts[idx[i]];
      if (c === undefined || left < c) continue;
      if (c < bestCost) { best = i; bestCost = c; }
    }
    if (best < 0) break;
    left -= bestCost; total += bestCost; idx[best]++;
    picks.push(list[best].node);
  }
  return { affordableRanks: picks.length, affordableTotal: total, picks };
}

/** Per bulk tree: what `buy_cheapest` Max would roughly spend right now (UiState.shopTreeTotals). */
export function shopTreeTotals(shop: readonly ShopEntry[], scrap: number): Record<string, { affordableRanks: number; affordableTotal: number }> {
  const groups = new Map<string, ShopEntry[]>();
  for (const e of shop) {
    if (!bulkEligible(e)) continue;
    const k = bulkTreeKey(e);
    let g = groups.get(k);
    if (!g) groups.set(k, g = []);
    g.push(e);
  }
  const out: Record<string, { affordableRanks: number; affordableTotal: number }> = {};
  for (const [k, g] of groups) {
    const p = planCheapest(g, scrap, TREE_PLAN_STEPS);
    out[k] = { affordableRanks: p.affordableRanks, affordableTotal: p.affordableTotal };
  }
  return out;
}
