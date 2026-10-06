import { describe, expect, it } from 'vitest';
import type { ShopEntry } from '../../src/sim/core/types';
import { SUGGEST_MAX, navStops, stepStop, suggestedNodes, swipeDir } from '../../src/ui/shop';
import { popoverBox } from '../../src/ui/modal';

const entry = (node: string, cost: number, extra: Partial<ShopEntry> = {}): ShopEntry => ({
  node, tree: 'ballistics', name: node, desc: '', rank: 0, maxRank: 10, cost, currency: 'scrap', affordable: true, kind: 'stat', tier: 0, nextCosts: [cost], affordableRanks: 1, affordableTotal: cost, ...extra,
});

describe('★ Suggested selection', () => {
  it('marks at most 3 rows: the cheapest affordable, unlocked, unmaxed Scrap buys', () => {
    const shop = [entry('a', 50), entry('b', 10), entry('c', 5, { affordable: false }), entry('d', 1, { locked: 'Requires X' }), entry('e', 15),
      entry('f', 30), entry('g', 1, { currency: 'cores' }), entry('h', 2, { kind: 'doctrine' }), entry('i', 3, { rank: 10 })];
    const s = suggestedNodes(shop);
    expect([...s]).toEqual(['b', 'e', 'f']);
    expect(s.size).toBeLessThanOrEqual(SUGGEST_MAX);
    for (const id of s) { const e = shop.find((x) => x.node === id)!; expect(e.affordable && !e.locked && e.rank < e.maxRank).toBe(true); }
  });
  it('marks nothing when nothing is affordable, and fewer than 3 when fewer are', () => {
    expect(suggestedNodes([entry('a', 5, { affordable: false })]).size).toBe(0);
    expect([...suggestedNodes([entry('a', 5), entry('b', 9, { affordable: false })])]).toEqual(['a']);
  });
});

describe('swipe and ← / → order', () => {
  const stops = navStops([
    { cat: 'chassis', trees: ['ballistics', 'bastion', 'reactor'] },
    { cat: 'elements', trees: ['fire'] },
    { cat: 'hardpoints', trees: [] },
    { cat: 'cross', trees: [] },
    { cat: 'cores', trees: [] },
  ]);
  it('flattens every revealed tree, then the stacked pages', () => {
    expect(stops.map((s) => `${s.cat}:${s.tree}`)).toEqual(['chassis:ballistics', 'chassis:bastion', 'chassis:reactor', 'elements:fire', 'hardpoints:', 'cross:', 'cores:']);
  });
  it('steps across pages and stops at either end', () => {
    expect(stepStop(stops, 'chassis', 'reactor', 1)).toEqual({ cat: 'elements', tree: 'fire' });
    expect(stepStop(stops, 'elements', 'fire', -1)).toEqual({ cat: 'chassis', tree: 'reactor' });
    expect(stepStop(stops, 'cross', 'link', 1)).toEqual({ cat: 'cores', tree: '' });
    expect(stepStop(stops, 'chassis', 'ballistics', -1)).toBeNull();
    expect(stepStop(stops, 'cores', 'exotic', 1)).toBeNull();
    // an empty slot of a page counts as that page
    expect(stepStop(stops, 'hardpoints', 'slot:0', 1)).toEqual({ cat: 'cross', tree: '' });
  });
  it('a swipe is ≥ 50 px, mostly horizontal, and never from the left edge', () => {
    expect(swipeDir(200, 300, 100, 310)).toBe(1);
    expect(swipeDir(100, 300, 200, 300)).toBe(-1);
    expect(swipeDir(200, 300, 160, 300)).toBe(0);      // too short
    expect(swipeDir(200, 300, 120, 360)).toBe(0);      // too steep (80 ≤ 1.5 × 60)
    expect(swipeDir(200, 100, 205, 400)).toBe(0);      // a vertical scroll
    expect(swipeDir(10, 300, 200, 300)).toBe(0);       // the edge swipe back to Battle
  });
});

describe('popover placement', () => {
  it('stays on screen at 320 px', () => {
    const b = popoverBox({ left: 250, bottom: 100 }, 300, 320, 568);
    expect(b.left).toBe(12);
    expect(b.left + Math.min(300, 320 - 16)).toBeLessThanOrEqual(320 - 8);
    expect(b.top).toBe(104);
    expect(b.maxHeight).toBe(568 - 104 - 8);
  });
});
