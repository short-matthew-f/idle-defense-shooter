import { describe, it, expect } from 'vitest';
import type { ShopEntry, SimEvent } from '../../src/sim/core/types';
import { Ev } from '../../src/sim/core/types';
import { buyLabel, buyLabelText, bulkToast, nextQty, parseQty, qtyLabel, rowBuy } from '../../src/ui/bulk';

/** Entry with geometric-ish previews: prices `costs`, and the affordable prefix for `scrap`. */
function entry(node: string, costs: number[], scrap: number, extra: Partial<ShopEntry> = {}): ShopEntry {
  let n = 0, total = 0, left = scrap;
  while (n < costs.length && left >= costs[n]) { left -= costs[n]; total += costs[n]; n++; }
  return {
    node, tree: 'ballistics', name: node, desc: '', rank: 0, maxRank: 30, cost: costs[0] ?? 0, currency: 'scrap',
    affordable: n > 0, kind: 'stat', tier: 0, nextCosts: costs.slice(0, 10), affordableRanks: n, affordableTotal: total, ...extra,
  };
}

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


describe('bulk toast', () => {
  const ev = (src: string, cost: number): SimEvent => ({ id: 0, tick: 0, type: Ev.Purchase, cause: -1, src, a: 1, b: cost, x: 0, y: 0 } as SimEvent);
  it('summarises two or more Purchase events and stays quiet for one', () => {
    expect(bulkToast([ev('a', 100), ev('a', 200), ev('b', 500)], 'in Ballistics')).toBe('Bought 3 ranks in Ballistics for ♦800');
    expect(bulkToast([ev('a', 100)], 'in Ballistics')).toBeNull();
    expect(bulkToast([ev('a', 600), ev('b', 600)], null)).toBe('Bought 2 ranks for ♦1.2K');
  });
});
