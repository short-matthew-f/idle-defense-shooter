import { describe, expect, it } from 'vitest';
import type { ShopEntry, SimEvent } from '../../src/sim/core/types';
import { chartGeometry } from '../../src/ui/chart';
import { cheapestAffordable } from '../../src/ui/shop';
import { KillRing, EV_KILL, victimLabel } from '../../src/ui/inspector';
import { cooldownFraction } from '../../src/ui/abilities';
import { RateMeter } from '../../src/ui/hud';
import { codexGroups } from '../../src/ui/codex';
import { layoutStars } from '../../src/ui/constellation';
import { STAR_NODES } from '../../src/sim/data/index';

const entry = (node: string, cost: number, extra: Partial<ShopEntry> = {}): ShopEntry => ({
  node, tree: 'ballistics', name: node, desc: '', rank: 0, maxRank: 10, cost, currency: 'scrap', affordable: true, kind: 'stat', tier: 0, nextCosts: [cost], affordableRanks: 0, affordableTotal: 0, ...extra,
});

describe('UI widgets (pure parts)', () => {
  it('draws the forecast curve with its peak', () => {
    const g = chartGeometry([{ seconds: 0, rate: 0 }, { seconds: 100, rate: 50 }, { seconds: 200, rate: 30 }], 320, 120);
    expect(g.peak?.rate).toBe(50);
    expect(g.peak?.seconds).toBe(100);
    expect(g.d.startsWith('M')).toBe(true);
    expect(g.d.split('L').length).toBe(3);
    expect(g.maxSeconds).toBe(200);
    expect(chartGeometry([], 320, 120).peak).toBeNull();
    expect(chartGeometry([{ seconds: 5, rate: 1 }], 320, 120).peak?.x).toBe(160);
  });
  it('picks the 3 cheapest affordable Scrap buys', () => {
    const shop = [entry('a', 50), entry('b', 10), entry('c', 5, { affordable: false }), entry('d', 20, { locked: 'x' }), entry('e', 15), entry('f', 30), entry('g', 1, { currency: 'cores' }), entry('h', 2, { kind: 'doctrine' })];
    expect(cheapestAffordable(shop).map((e) => e.node)).toEqual(['b', 'e', 'f']);
  });
  it('keeps ~15 s of kills', () => {
    const r = new KillRing();
    const ev = (id: number, tick: number, type = EV_KILL): SimEvent => ({ id, tick, type, cause: -1, src: 'ballistics', a: id, b: 0, x: 0, y: 0 });
    r.push([ev(1, 0), ev(2, 100, 7), ev(3, 500)]);
    expect(r.kills.map((k) => k.id)).toEqual([1, 3]);
    r.push([ev(4, 1000)]);
    expect(r.kills.map((k) => k.id)).toEqual([3, 4]);
    expect(victimLabel(1 | 32)).toBe('frozen elite');
    expect(victimLabel(64)).toBe('Boss');
  });
  it('reads cooldowns in seconds or ticks', () => {
    expect(cooldownFraction(0, 5)).toBe(0);
    expect(cooldownFraction(2.5, 5)).toBe(0.5);
    expect(cooldownFraction(150, 5)).toBe(0.5);   // ticks
  });
  it('measures income, ignoring spending and resets', () => {
    const m = new RateMeter(10);
    m.push(0, 0);
    m.push(5, 50);
    m.push(6, 10);            // spent 40: not income
    expect(m.push(10, 60)).toBeCloseTo(10, 5);
    expect(m.push(1, 0)).toBe(0);   // time went backwards (Prestige)
  });
  it('has unique codex ids and lays out every star', () => {
    const ids = codexGroups().flatMap((g) => g.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    const pos = layoutStars(STAR_NODES);
    for (const n of STAR_NODES) expect(pos.has(n.id)).toBe(true);
  });
});
