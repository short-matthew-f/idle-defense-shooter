/**
 * Bulk buying (pure, no DOM): the Upgrades quantity selector (×1 · ×10 · Max), what a Buy button
 * does at each quantity, the Suggested card's "Buy all" plan, the per-tree "Spend here" preview
 * and the summary toast after a bulk buy. Prices come from the sim's ShopEntry previews
 * (`nextCosts`, `affordableRanks`, `affordableTotal`) and UiState.shopTreeTotals.
 */
import type { ShopEntry, SimEvent } from '@sim/core/types';
import { Ev } from '@sim/core/types';
import { planCheapest } from '@sim/economy/bulk';
import { fmtNum } from './format';

/** Ranks per tap: 1, 10, or 0 = Max (the sim's `count: 0`). */
export type BuyQty = 1 | 10 | 0;
export const BUY_QTYS: readonly BuyQty[] = [1, 10, 0];

export function qtyLabel(q: BuyQty): string { return q === 0 ? 'Max' : `×${q}`; }
/** Q cycles ×1 → ×10 → Max → ×1. */
export function nextQty(q: BuyQty): BuyQty { return BUY_QTYS[(BUY_QTYS.indexOf(q) + 1) % BUY_QTYS.length] ?? 1; }
/** A stored preference back to a quantity (anything unknown → ×1). */
export function parseQty(v: unknown): BuyQty { return v === 10 ? 10 : v === 0 ? 0 : 1; }

/** Ranks a tap on `e`'s Buy button buys at quantity `q`, and their total price (0 ranks = disabled). */
export function rowBuy(e: ShopEntry, q: BuyQty): { count: number; total: number } {
  if (e.locked || e.rank >= e.maxRank) return { count: 0, total: 0 };
  if (e.currency === 'cores' || q === 1) return e.affordable ? { count: 1, total: e.cost } : { count: 0, total: 0 };
  if (q === 0) return { count: e.affordableRanks, total: e.affordableTotal };
  const n = Math.min(10, e.affordableRanks);
  let total = 0;
  for (let k = 0; k < n; k++) total += e.nextCosts[k] ?? 0;
  return { count: n, total };
}

export interface BuyLabel {
  /** Small first line ("×10", "Max ×7"), or null for a plain one-rank price. */
  count: string | null;
  /** The price shown next to the currency icon. */
  price: number;
  disabled: boolean;
  /** `count` for the `buy` command (1, 10, or 0 = Max); null when the button does nothing. */
  send: number | null;
}

/**
 * Buy button content for `e` at `q`: ×1 → "♦15"; ×10 → "×10 · ♦1.2K" (fewer when maxRank or Scrap
 * limit it: "×7 · ♦800"); Max → "Max ×7 · ♦800". When nothing is affordable the button is disabled
 * and shows what the quantity would cost (×10: the next ≤10 ranks; Max: the next rank).
 */
export function buyLabel(e: ShopEntry, q: BuyQty): BuyLabel {
  const r = rowBuy(e, q);
  const one = e.currency === 'cores' || q === 1;
  if (r.count > 0) {
    if (one) return { count: null, price: r.total, disabled: false, send: 1 };
    // send the quantity itself: the sim stops silently at the last affordable rank, and buys a little
    // more if Scrap arrived between this frame and the command
    return { count: q === 0 ? `Max ×${r.count}` : `×${r.count}`, price: r.total, disabled: false, send: q };
  }
  if (one || q === 0) return { count: one ? null : 'Max', price: e.cost, disabled: true, send: null };
  const n = Math.min(10, e.nextCosts.length);
  let total = 0;
  for (let k = 0; k < n; k++) total += e.nextCosts[k];
  return { count: `×${Math.max(1, n)}`, price: n > 0 ? total : e.cost, disabled: true, send: null };
}

/** Accessible / plain-text form of a label: "Max ×7 · 800". */
export function buyLabelText(l: BuyLabel): string { return l.count ? `${l.count} · ${fmtNum(l.price)}` : fmtNum(l.price); }

export interface BuyAllPlan {
  /** `buy` commands in order (count 1 → one rank; 0 → Max). */
  cmds: { node: string; count: number }[];
  ranks: number;
  total: number;
  /** A later entry was sent as Max past its 10-price preview: ranks / total are lower bounds ("23+"). */
  open: boolean;
}

/**
 * "Buy all" over the suggested entries, in order, spending one shared Scrap budget: ×1 buys one
 * rank of each, ×10 up to 10 of each, Max as many as possible of each. Only buys the plan expects
 * to succeed are sent (no "Not enough Scrap" toasts). Max on a later entry whose 10-price preview
 * runs out is sent as `count: 0` (the sim buys the rest) and ends the plan; its total is a lower bound.
 */
export function planBuyAll(entries: readonly ShopEntry[], scrap: number, q: BuyQty): BuyAllPlan {
  const out: BuyAllPlan = { cmds: [], ranks: 0, total: 0, open: false };
  let left = scrap;
  for (const e of entries) {
    if (e.locked || e.currency !== 'scrap' || e.rank >= e.maxRank) continue;
    if (q === 0 && left === scrap && e.affordableRanks > 0) {
      // first buy: the sim's own preview is exact
      out.cmds.push({ node: e.node, count: e.affordableRanks });
      out.ranks += e.affordableRanks; out.total += e.affordableTotal; left -= e.affordableTotal;
      continue;
    }
    const cap = q === 0 ? Infinity : q;
    let n = 0, spent = 0;
    while (n < cap && n < e.nextCosts.length && left - spent >= e.nextCosts[n]) { spent += e.nextCosts[n]; n++; }
    if (n === 0) continue;
    const more = q === 0 && n === e.nextCosts.length && e.rank + n < e.maxRank;
    out.cmds.push({ node: e.node, count: more ? 0 : n });
    out.ranks += n; out.total += spent; left -= spent;
    if (more) { out.open = true; break; }
  }
  return out;
}

/**
 * "Spend here" preview for one tree at quantity `q`: ×1 / ×10 plan over the entries (cheapest
 * first); Max uses the sim's UiState.shopTreeTotals entry when present (approximate, ≤ 200 ranks).
 */
export function treeSpend(entries: readonly ShopEntry[], scrap: number, q: BuyQty, maxTotal?: { affordableRanks: number; affordableTotal: number }): { ranks: number; total: number } {
  if (q === 0 && maxTotal) return { ranks: maxTotal.affordableRanks, total: maxTotal.affordableTotal };
  const p = planCheapest(entries, scrap, q === 0 ? 200 : q);
  return { ranks: p.affordableRanks, total: p.affordableTotal };
}

/** Second line of the Spend here button: "♦12" (×1), "×10 · ♦1.2K", "Max ×23 · ♦4.5K". */
export function spendLabel(s: { ranks: number; total: number }, q: BuyQty): string {
  if (s.ranks === 0) return 'Nothing affordable';
  if (q === 1) return `♦${fmtNum(s.total)}`;
  return `${q === 0 ? `Max ×${s.ranks}` : `×${s.ranks}`} · ♦${fmtNum(s.total)}`;
}

/** Toast after a bulk buy, from the Purchase events it produced; null for 0–1 ranks (single buys stay quiet). Quartermaster buys (data.via) never count. */
export function bulkToast(events: readonly SimEvent[], where: string | null): string | null {
  let n = 0, total = 0;
  for (const e of events) if (e.type === Ev.Purchase && e.data?.via !== 'quartermaster') { n++; total += e.b; }
  if (n < 2) return null;
  return `Bought ${n} ranks${where ? ` ${where}` : ''} for ♦${fmtNum(total)}`;
}
