import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { applyCommand } from '../../src/sim/run/commands';
import { buildShop, purchase } from '../../src/sim/economy/shop';
import { planCheapest, shopTreeTotals, inBulkTree } from '../../src/sim/economy/bulk';
import { treeDef } from '../../src/sim/core/content';
import { Ev, type Command, type ShopEntry } from '../../src/sim/core/types';

const calm = (seed = 3): Sim => { const s = new Sim(null, seed); s.world.clearCombat(); s.world.run.phase = 'wave_clear'; return s; };
const cmd = (sim: Sim, c: Command): string | null => applyCommand(sim.machine, c);
const entry = (sim: Sim, node: string): ShopEntry => buildShop(sim.world).find((e) => e.node === node)!;
const purchases = (sim: Sim, since: number) => sim.world.events.recent(0).filter((e) => e.type === Ev.Purchase && e.id >= since);
const nextId = (sim: Sim): number => sim.events.nextId;

describe('bulk buy: buy with count', () => {
  it('buys N ranks, charges the sum of the previewed prices and emits N Purchase events', () => {
    const sim = calm();
    const w = sim.world;
    w.run.scrap = 1e6;
    const e = entry(sim, 'ballistics.damage');
    expect(e.nextCosts.length).toBe(10);
    expect(e.nextCosts[0]).toBe(e.cost);
    const want = e.nextCosts.slice(0, 5).reduce((a, b) => a + b, 0);
    const id0 = nextId(sim);
    expect(cmd(sim, { type: 'buy', node: 'ballistics.damage', count: 5 })).toBeNull();
    expect(w.build.ranks['ballistics.damage']).toBe(5);
    expect(1e6 - w.run.scrap).toBe(want);
    expect(w.run.spentByTree.ballistics).toBe(want);
    const ev = purchases(sim, id0);
    expect(ev.length).toBe(5);
    expect(ev.map((x) => x.a)).toEqual([1, 2, 3, 4, 5]);
    expect(ev.map((x) => x.b)).toEqual(e.nextCosts.slice(0, 5));
    expect(w.stats.rank('ballistics.damage')).toBe(5);        // stats rebuilt at the end
  });

  it('matches five single buys exactly', () => {
    const a = calm(), b = calm();
    a.world.run.scrap = b.world.run.scrap = 5000;
    cmd(a, { type: 'buy', node: 'ballistics.attack_speed', count: 5 });
    for (let k = 0; k < 5; k++) cmd(b, { type: 'buy', node: 'ballistics.attack_speed' });
    expect(a.world.run.scrap).toBe(b.world.run.scrap);
    expect(a.world.build.ranks).toEqual(b.world.build.ranks);
    expect(a.world.stats.get('ballistics.attack_speed')).toBe(b.world.stats.get('ballistics.attack_speed'));
    expect(a.events.hash()).toBe(b.events.hash());
  });

  it('stops silently at the last affordable rank; 0 bought is "Not enough Scrap"', () => {
    const sim = calm();
    const w = sim.world;
    const e0 = entry(sim, 'ballistics.damage');
    w.run.scrap = e0.nextCosts[0] + e0.nextCosts[1] + e0.nextCosts[2] - 1;   // two ranks and change
    const e = entry(sim, 'ballistics.damage');
    expect(e.affordableRanks).toBe(2);
    expect(e.affordableTotal).toBe(e.nextCosts[0] + e.nextCosts[1]);
    expect(cmd(sim, { type: 'buy', node: 'ballistics.damage', count: 10 })).toBeNull();
    expect(w.build.ranks['ballistics.damage']).toBe(2);
    expect(w.run.scrap).toBe(e.nextCosts[2] - 1);
    expect(cmd(sim, { type: 'buy', node: 'ballistics.damage', count: 10 })).toBe('Not enough Scrap');
    expect(w.build.ranks['ballistics.damage']).toBe(2);
  });

  it('count 0 buys the max affordable (as previewed)', () => {
    const sim = calm();
    const w = sim.world;
    w.run.scrap = 3000;
    const e = entry(sim, 'ballistics.damage');
    expect(e.affordableRanks).toBeGreaterThan(3);
    const id0 = nextId(sim);
    expect(cmd(sim, { type: 'buy', node: 'ballistics.damage', count: 0 })).toBeNull();
    expect(w.build.ranks['ballistics.damage']).toBe(e.affordableRanks);
    expect(3000 - w.run.scrap).toBe(e.affordableTotal);
    expect(purchases(sim, id0).length).toBe(e.affordableRanks);
    expect(entry(sim, 'ballistics.damage').affordable).toBe(false);
  });

  it('respects maxRank', () => {
    const sim = calm();
    const w = sim.world;
    w.run.scrap = 1e12;
    const e = entry(sim, 'ballistics.range');
    expect(e.affordableRanks).toBe(e.maxRank);
    expect(cmd(sim, { type: 'buy', node: 'ballistics.range', count: 1000 })).toBeNull();
    expect(w.build.ranks['ballistics.range']).toBe(e.maxRank);
    expect(1e12 - w.run.scrap).toBe(e.affordableTotal);
    const after = entry(sim, 'ballistics.range');
    expect(after.nextCosts).toEqual([]);
    expect(after.affordableRanks).toBe(0);
    expect(cmd(sim, { type: 'buy', node: 'ballistics.range', count: 0 })).toBe('Max rank');
  });

  it('a Cores-priced node ignores count', () => {
    const sim = calm();
    const w = sim.world;
    w.run.scrap = 1e9;
    const t = treeDef('ballistics')!;
    let bought = 0;
    for (const n of t.shared) { if (bought >= t.forkRequirement) break; if (!n.requires && purchase(w, n.id) === null) bought++; }
    w.run.cores = 10;
    const ex = entry(sim, t.exotic.id);
    expect(ex.currency).toBe('cores');
    expect(ex.nextCosts).toEqual([ex.cost]);
    expect(ex.affordableRanks).toBe(1);
    const id0 = nextId(sim);
    expect(cmd(sim, { type: 'buy', node: t.exotic.id, count: 5 })).toBeNull();
    expect(w.build.ranks[t.exotic.id]).toBe(1);
    expect(w.run.cores).toBe(10 - ex.cost);
    expect(purchases(sim, id0).length).toBe(1);
  });

  it('rejects malformed counts', () => {
    const sim = calm();
    sim.world.run.scrap = 1e6;
    for (const count of [-1, 1.5, 1001, NaN, Infinity]) {
      expect(cmd(sim, { type: 'buy', node: 'ballistics.damage', count })).toMatch(/Malformed command: buy.count/);
      expect(cmd(sim, { type: 'buy_cheapest', tree: 'ballistics', count })).toMatch(/Malformed command: buy_cheapest.count/);
    }
    expect(cmd(sim, { type: 'buy', node: 'ballistics.damage', count: '3' } as unknown as Command)).toMatch(/count/);
    expect(cmd(sim, { type: 'buy_cheapest', tree: 'ballistics' } as unknown as Command)).toMatch(/count/);
    expect(cmd(sim, { type: 'buy_cheapest', tree: '', count: 1 } as unknown as Command)).toMatch(/tree/);
    expect(sim.world.build.ranks['ballistics.damage'] ?? 0).toBe(0);
    expect(cmd(sim, { type: 'buy_cheapest', tree: 'nowhere', count: 1 } as unknown as Command)).toBe('Nothing to buy here');
  });
});

describe('bulk buy: buy_cheapest', () => {
  it('buys the cheapest affordable node each rank and stops when nothing is affordable', () => {
    const sim = calm();
    const w = sim.world;
    w.run.scrap = 400;
    const id0 = nextId(sim);
    // expected: replay the greedy choice over live shop entries
    const ref = calm();
    ref.world.run.scrap = 400;
    const expected: string[] = [];
    for (;;) {
      const c = buildShop(ref.world).filter((e) => inBulkTree(e, 'ballistics') && e.currency === 'scrap' && e.kind !== 'doctrine' && e.affordable);
      if (!c.length) break;
      let best = c[0];
      for (const e of c) if (e.cost < best.cost) best = e;
      expected.push(best.node);
      expect(purchase(ref.world, best.node)).toBeNull();
    }
    expect(expected.length).toBeGreaterThan(3);
    expect(cmd(sim, { type: 'buy_cheapest', tree: 'ballistics', count: 0 })).toBeNull();
    const ev = purchases(sim, id0);
    expect(ev.map((e) => e.src)).toEqual(expected);
    expect(w.run.scrap).toBe(ref.world.run.scrap);
    expect(buildShop(w).some((e) => inBulkTree(e, 'ballistics') && e.currency === 'scrap' && e.affordable)).toBe(false);
    expect(cmd(sim, { type: 'buy_cheapest', tree: 'ballistics', count: 0 })).toBe('Not enough Scrap');
  });

  it('count limits the ranks and only touches the named tree', () => {
    const sim = calm();
    const w = sim.world;
    w.run.scrap = 1e6;
    const first = buildShop(w).filter((e) => e.tree === 'bastion' && e.currency === 'scrap' && e.affordable).sort((a, b) => a.cost - b.cost)[0];
    expect(cmd(sim, { type: 'buy_cheapest', tree: 'bastion', count: 1 })).toBeNull();
    expect(w.build.ranks[first.node]).toBe(1);
    const id0 = nextId(sim);
    expect(cmd(sim, { type: 'buy_cheapest', tree: 'bastion', count: 10 })).toBeNull();
    const ev = purchases(sim, id0);
    expect(ev.length).toBe(10);
    expect(ev.every((e) => e.src.startsWith('bastion.'))).toBe(true);
    expect(Object.keys(w.build.ranks).every((k) => k.startsWith('bastion.'))).toBe(true);
  });

  it('shopTreeTotals approximates buy_cheapest Max (exact while no node unlocks mid-way)', () => {
    const sim = calm();
    const w = sim.world;
    w.run.scrap = 250;
    const shop = buildShop(w);
    const totals = shopTreeTotals(shop, w.run.scrap);
    const plan = planCheapest(shop.filter((e) => inBulkTree(e, 'ballistics')), w.run.scrap, 1000);
    expect(totals.ballistics.affordableRanks).toBe(plan.affordableRanks);
    const id0 = nextId(sim);
    cmd(sim, { type: 'buy_cheapest', tree: 'ballistics', count: 0 });
    expect(purchases(sim, id0).map((e) => e.src)).toEqual(plan.picks);
    expect(250 - w.run.scrap).toBe(totals.ballistics.affordableTotal);
    expect(sim.uiState().shopTreeTotals?.ballistics).toEqual(shopTreeTotals(buildShop(w), w.run.scrap).ballistics);
  });
});

describe('bulk buy: previews and determinism', () => {
  it('nextCosts / affordableRanks agree with what buy charges, rank by rank', () => {
    const sim = calm();
    const w = sim.world;
    w.run.scrap = 1e7;
    for (const node of ['ballistics.damage', 'bastion.max_hp', 'reactor.global_attack_speed']) {
      const e = buildShop(w).find((x) => x.node === node);
      if (!e) continue;
      const id0 = nextId(sim);
      const n = Math.min(e.nextCosts.length, 10);
      cmd(sim, { type: 'buy', node, count: n });
      expect(purchases(sim, id0).map((x) => x.b)).toEqual(e.nextCosts.slice(0, n));
    }
  });

  it('two Sims fed the same bulk commands hash the same', () => {
    const script = (t: number): Command[] => {
      if (t === 200) return [{ type: 'buy', node: 'ballistics.damage', count: 0 }];
      if (t === 600) return [{ type: 'buy_cheapest', tree: 'bastion', count: 10 }, { type: 'buy', node: 'ballistics.attack_speed', count: 3 }];
      if (t === 1200) return [{ type: 'buy_cheapest', tree: 'ballistics', count: 0 }];
      return [];
    };
    const play = (): Sim => {
      const sim = new Sim(null, 11);
      sim.world.run.scrap = 600;
      for (let t = 0; t < 1800; t++) { for (const c of script(t)) sim.command(c); sim.step(); }
      return sim;
    };
    const a = play(), b = play();
    expect(Object.values(a.world.build.ranks).reduce((x, y) => x + y, 0)).toBeGreaterThan(3);
    expect(a.events.hash()).toBe(b.events.hash());
    expect(a.world.run.scrap).toBe(b.world.run.scrap);
    expect(a.world.build.ranks).toEqual(b.world.build.ranks);
  });
});
