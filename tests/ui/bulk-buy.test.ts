import { describe, it, expect } from 'vitest';
import type { ShopEntry, SimEvent } from '../../src/sim/core/types';
import { Ev } from '../../src/sim/core/types';
import { buyLabel, buyLabelText, bulkToast, nextQty, parseQty, planBuyAll, qtyLabel, rowBuy, spendLabel, treeSpend } from '../../src/ui/bulk';

/** Entry with geometric-ish previews: prices `costs`, and the affordable prefix for `scrap`. */
function entry(node: string, costs: number[], scrap: number, extra: Partial<ShopEntry> = {}): ShopEntry {
  let n = 0, total = 0, left = scrap;
  while (n < costs.length && left >= costs[n]) { left -= costs[n]; total += costs[n]; n++; }
  return {
    node, tree: 'ballistics', name: node, desc: '', rank: 0, maxRank: 30, cost: costs[0] ?? 0, currency: 'scrap',
    affordable: n > 0, kind: 'stat', tier: 0, nextCosts: costs.slice(0, 10), affordableRanks: n, affordableTotal: total, ...extra,
  };
}
const geo = (base: number, g: number, k = 10): number[] => Array.from({ length: k }, (_, i) => Math.ceil(base * g ** i));

describe('quantity selector', () => {
  it('cycles ×1 → ×10 → Max → ×1 and parses stored values', () => {
    expect(nextQty(1)).toBe(10);
    expect(nextQty(10)).toBe(0);
    expect(nextQty(0)).toBe(1);
    expect([1, 10, 0].map((q) => qtyLabel(q as 1 | 10 | 0))).toEqual(['×1', '×10', 'Max']);
    expect(parseQty(10)).toBe(10);
    expect(parseQty(0)).toBe(0);
    expect(parseQty('junk')).toBe(1);
    expect(parseQty(undefined)).toBe(1);
  });
});

describe('buy button label', () => {
  const costs = [100, 120, 144, 173, 207, 249, 299, 358, 430, 516];
  const sum = (n: number): number => costs.slice(0, n).reduce((a, b) => a + b, 0);

  it('×1 shows the next price and sends one rank', () => {
    const l = buyLabel(entry('a', costs, 150), 1);
    expect(l).toEqual({ count: null, price: 100, disabled: false, send: 1 });
    expect(buyLabelText(l)).toBe('100');
  });

  it('×10 shows the ranks the Scrap buys (all ten, or fewer)', () => {
    expect(buyLabel(entry('a', costs, 1e6), 10)).toEqual({ count: '×10', price: sum(10), disabled: false, send: 10 });
    const few = buyLabel(entry('a', costs, sum(7) + 5), 10);
    expect(few).toEqual({ count: '×7', price: sum(7), disabled: false, send: 10 });
    expect(buyLabelText(few)).toBe("×7 · 1.2K");
  });

  it('×10 near maxRank shows the ranks left', () => {
    const e = entry('a', costs.slice(0, 3), 1e6, { rank: 27, maxRank: 30 });
    expect(buyLabel(e, 10).count).toBe('×3');
    expect(rowBuy(e, 10)).toEqual({ count: 3, total: sum(3) });
  });

  it('Max uses the sim preview (affordableRanks / affordableTotal) and sends count 0', () => {
    const e = entry('a', costs, 1e6, { affordableRanks: 14, affordableTotal: 9000 });
    expect(buyLabel(e, 0)).toEqual({ count: 'Max ×14', price: 9000, disabled: false, send: 0 });
    expect(buyLabelText(buyLabel(e, 0))).toBe('Max ×14 · 9K');
  });

  it('is disabled when nothing is affordable, and shows what the quantity would cost', () => {
    const e = entry('a', costs, 50);
    expect(buyLabel(e, 1)).toMatchObject({ disabled: true, price: 100, send: null });
    expect(buyLabel(e, 10)).toMatchObject({ disabled: true, count: '×10', price: sum(10), send: null });
    expect(buyLabel(e, 0)).toMatchObject({ disabled: true, count: 'Max', price: 100, send: null });
    expect(rowBuy(entry('a', costs, 1e6, { locked: 'Requires X' }), 0).count).toBe(0);
  });

  it('Cores nodes always buy one', () => {
    const e = entry('x', [2], 0, { currency: 'cores', affordable: true, affordableRanks: 1, affordableTotal: 2, kind: 'exotic' });
    expect(buyLabel(e, 10)).toEqual({ count: null, price: 2, disabled: false, send: 1 });
    expect(buyLabel(e, 0)).toEqual({ count: null, price: 2, disabled: false, send: 1 });
  });
});

describe('Buy all planning', () => {
  const a = [10, 12, 14, 17, 20, 24, 29, 35, 42, 50];
  const b = [15, 18, 22, 26, 31, 37, 45, 54, 65, 78];
  const c = [20, 24, 29, 35, 42, 50, 60, 72, 86, 100];

  it('×1 buys one rank of each suggestion in order while the Scrap lasts', () => {
    const p = planBuyAll([entry('a', a, 50), entry('b', b, 50), entry('c', c, 50)], 50, 1);
    expect(p.cmds).toEqual([{ node: 'a', count: 1 }, { node: 'b', count: 1 }, { node: 'c', count: 1 }]);
    expect(p.total).toBe(45);
    const q = planBuyAll([entry('a', a, 30), entry('b', b, 30), entry('c', c, 30)], 30, 1);
    expect(q.cmds).toEqual([{ node: 'a', count: 1 }, { node: 'b', count: 1 }]);
    expect(q.total).toBe(25);
  });

  it('×10 buys up to ten of each, in order, from one budget', () => {
    const scrap = 300;
    const p = planBuyAll([entry('a', a, scrap), entry('b', b, scrap), entry('c', c, scrap)], scrap, 10);
    expect(p.cmds[0]).toEqual({ node: 'a', count: 10 });       // 253
    expect(p.cmds[1]).toEqual({ node: 'b', count: 2 });        // 15 + 18 = 33 → 286
    expect(p.cmds.length).toBe(2);                             // 14 left < 20
    expect(p.total).toBe(286);
    expect(p.ranks).toBe(12);
  });

  it('Max takes the first entry\'s exact preview, then the rest', () => {
    const first = entry('a', a, 100, { affordableRanks: 6, affordableTotal: 97 });
    const p = planBuyAll([first, entry('b', b, 100), entry('c', c, 100)], 100, 0);
    expect(p.cmds).toEqual([{ node: 'a', count: 6 }]);
    expect(p.total).toBe(97);
    // a later entry whose 10-price preview runs out is sent as Max (count 0) and ends the plan
    const big = planBuyAll([entry('a', a, 1e6, { affordableRanks: 30, affordableTotal: 5000 }), entry('b', b, 1e6)], 1e6, 0);
    expect(big.cmds).toEqual([{ node: 'a', count: 30 }, { node: 'b', count: 0 }]);
    expect(big.open).toBe(true);
    expect(p.open).toBe(false);
  });

  it('skips locked, maxed and Cores entries', () => {
    const p = planBuyAll([entry('a', a, 100, { locked: 'Requires X' }), entry('b', [], 100, { rank: 30 }), entry('c', c, 100, { currency: 'cores' }), entry('d', b, 100)], 100, 1);
    expect(p.cmds).toEqual([{ node: 'd', count: 1 }]);
  });
});

describe('Spend here', () => {
  it('plans cheapest-first at ×1 / ×10 and uses shopTreeTotals for Max', () => {
    const list = [entry('a', geo(10, 1.5), 100), entry('b', geo(12, 1.2), 100)];
    expect(treeSpend(list, 100, 1)).toEqual({ ranks: 1, total: 10 });
    const ten = treeSpend(list, 100, 10);
    expect(ten.ranks).toBeGreaterThan(3);
    expect(ten.total).toBeLessThanOrEqual(100);
    expect(treeSpend(list, 100, 0, { affordableRanks: 7, affordableTotal: 99 })).toEqual({ ranks: 7, total: 99 });
    expect(spendLabel({ ranks: 7, total: 99 }, 0)).toBe('Max ×7 · ♦99');
    expect(spendLabel({ ranks: 10, total: 1234 }, 10)).toBe('×10 · ♦1.2K');
    expect(spendLabel({ ranks: 1, total: 12 }, 1)).toBe('♦12');
    expect(spendLabel({ ranks: 0, total: 0 }, 0)).toBe('Nothing affordable');
  });
});

describe('bulk toast', () => {
  const ev = (src: string, cost: number): SimEvent => ({ id: 0, tick: 0, type: Ev.Purchase, cause: -1, src, a: 1, b: cost, x: 0, y: 0 } as SimEvent);
  it('summarises two or more Purchase events and stays quiet for one', () => {
    expect(bulkToast([ev('a', 100), ev('a', 200), ev('b', 500)], 'in Ballistics')).toBe('Bought 3 ranks in Ballistics for ♦800');
    expect(bulkToast([ev('a', 100)], 'in Ballistics')).toBeNull();
    expect(bulkToast([ev('a', 600), ev('b', 600)], null)).toBe('Bought 2 ranks for ♦1.2K');
  });
});
