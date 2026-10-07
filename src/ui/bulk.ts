/**
 * Bulk buying (pure, no DOM): the Upgrades quantity selector (×1 · ×10 · Max), what a Buy button
 * does at each quantity, and the summary toast after a bulk buy. Prices come from the sim's ShopEntry previews
 * (`nextCosts`, `affordableRanks`, `affordableTotal`) and UiState.shopTreeTotals.
 */
import type { ShopEntry, SimEvent } from '@sim/core/types';
import { Ev } from '@sim/core/types';
import { fmtAmount } from './format';

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
export function buyLabelText(l: BuyLabel): string { return l.count ? `${l.count} · ${fmtAmount(l.price)}` : fmtAmount(l.price); }

/** Toast after a bulk buy, from the Purchase events it produced; null for 0–1 ranks (single buys stay quiet). Quartermaster buys (data.via) never count. */
export function bulkToast(events: readonly SimEvent[], where: string | null): string | null {
  let n = 0, total = 0;
  for (const e of events) if (e.type === Ev.Purchase && e.data?.via !== 'quartermaster') { n++; total += e.b; }
  if (n < 2) return null;
  return `Bought ${n} ranks${where ? ` ${where}` : ''} for ♦${fmtAmount(total)}`;
}
