import { describe, it, expect } from 'vitest';
import type { ShopEntry } from '../../src/sim/core/types';
import { fmtStat, fmtStatChange } from '../../src/ui/format';
import { BOTTLENECK_ALL, BOTTLENECK_CHEAP, previewRanks, scrapBottleneck, statAfter, statLine } from '../../src/ui/shop';
import { starterWhat } from '../../src/ui/starter';

const entry = (o: Partial<ShopEntry> = {}): ShopEntry => ({
  node: 'ballistics.damage', tree: 'ballistics', name: 'Caliber', desc: '', rank: 2, maxRank: 30, cost: 30, currency: 'scrap', affordable: true,
  kind: 'stat', tier: 0, nextCosts: [30, 36, 43], affordableRanks: 3, affordableTotal: 109, ...o,
});

describe('stat formatting', () => {
  it('formats flat, percent, multiplier and per-second values distinctly', () => {
    expect(fmtStatChange(13.2, 14.8)).toBe('13.2 → 14.8 (+12%)');
    expect(fmtStatChange(0.05, 0.06, '%')).toBe('5% → 6%');
    expect(fmtStatChange(1.5, 1.6, 'x')).toBe('×1.5 → ×1.6 (+6.7%)');
    expect(fmtStatChange(2, 2.2, '/s')).toBe('2/s → 2.2/s (+10%)');
    expect(fmtStat(12345)).toBe('12.3K');
    // decimals grow until the two sides differ
    expect(fmtStatChange(300, 300.04)).toBe('300 → 300.04');
    expect(fmtStatChange(10, 11.6, '', { digits: 0, rel: false })).toBe('10 → 12');
  });
});

describe('row before → after', () => {
  const e = entry({ statKey: 'ballistics.damage', statLabel: 'Damage', statUnit: '', statNow: 13.2, statAfter: [14.8, 16.4, 18], statAfterMax: undefined });
  it('follows the buy quantity', () => {
    expect(statLine(e, 1)).toBe('Damage 13.2 → 14.8 (+12%)');
    expect(previewRanks(e, 10)).toBe(3);
    expect(statLine(e, 10)).toBe('Damage 13.2 → 18 (+36%)');
    expect(statLine(e, 0)).toBe('Damage 13.2 → 18 (+36%)');
    const broke = { ...e, affordable: false, affordableRanks: 0, affordableTotal: 0 };
    expect(previewRanks(broke, 10)).toBe(10);
    expect(statAfter(broke, 10)).toBeNull();   // only 3 previews: no line rather than a wrong one
    expect(statLine(broke, 1)).toBe('Damage 13.2 → 14.8 (+12%)');
  });
  it('uses statAfterMax for Max past the 10-rank preview', () => {
    const big = { ...e, statAfter: Array.from({ length: 10 }, (_, i) => 13.2 + i), affordableRanks: 25, statAfterMax: 99 };
    expect(statAfter(big, 25)).toBe(99);
  });
  it('mechanics keep their text', () => {
    expect(statLine(entry({ kind: 'mechanic' }), 1)).toBeNull();
  });
  it('starter button reads "Damage 10 → 12"', () => {
    expect(starterWhat({ label: 'Damage', entry: { ...e, statNow: 10, statAfter: [11.6] } })).toBe('Damage 10 → 12');
    expect(starterWhat({ label: 'Damage', entry: entry() })).toBe('Damage · Lv 3');
  });
});

describe('late-game bottleneck', () => {
  it('fires when every Scrap row is maxed', () => {
    const maxed = entry({ rank: 30, maxRank: 30, locked: 'Max rank', affordable: false, affordableRanks: 0, affordableTotal: 0, nextCosts: [] });
    expect(scrapBottleneck([maxed, entry({ kind: 'doctrine', currency: 'cores' })], 38.8e6)).toBe(BOTTLENECK_ALL);
    expect(scrapBottleneck([maxed], 0)).toBeNull();
  });
  it('fires when the rest costs ≤10% of Scrap, not otherwise', () => {
    const tail = entry({ rank: 28, maxRank: 30, affordableRanks: 2, affordableTotal: 1000 });
    expect(scrapBottleneck([tail], 10_000)).toBe(BOTTLENECK_CHEAP);
    expect(scrapBottleneck([tail], 9_999)).toBeNull();
    // a row that cannot be bought out keeps the line away
    expect(scrapBottleneck([tail, entry({ rank: 5, affordableRanks: 3 })], 1e9)).toBeNull();
  });
  it('stays quiet early (locked only, or nothing here)', () => {
    expect(scrapBottleneck([entry({ locked: 'Requires Caliber' })], 1e6)).toBeNull();
    expect(scrapBottleneck([], 1e6)).toBeNull();
  });
});
