import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { buildShop, purchase, statUnit } from '../../src/sim/economy/shop';
import { StatResolver } from '../../src/sim/core/stats';
import { newBuild, newMeta } from '../../src/sim/run/state';

describe('shop before → after (Phase 2)', () => {
  it('previews a mul stat exactly as the resolver will resolve it after buying', () => {
    const sim = new Sim(null, 3);
    const w = sim.world;
    w.run.scrap = 1e6;
    purchase(w, 'ballistics.damage');
    const e = buildShop(w).find((x) => x.node === 'ballistics.damage')!;
    expect(e.statKey).toBe('ballistics.damage');
    expect(e.statLabel).toBe('Damage');
    expect(e.statUnit).toBe('');
    expect(e.statNow).toBeCloseTo(w.stats.get('ballistics.damage'), 9);
    expect(e.statAfter!.length).toBe(Math.min(10, e.maxRank - e.rank));
    const next1 = e.statAfter![0], next3 = e.statAfter![2];
    purchase(w, 'ballistics.damage');
    expect(w.stats.get('ballistics.damage')).toBeCloseTo(next1, 9);
    purchase(w, 'ballistics.damage'); purchase(w, 'ballistics.damage');
    expect(w.stats.get('ballistics.damage')).toBeCloseTo(next3, 9);
  });

  it('previews an add stat (flat and percent) exactly', () => {
    const sim = new Sim(null, 3);
    const w = sim.world;
    w.run.scrap = 1e6;
    for (const node of ['ballistics.range', 'ballistics.crit_chance']) {
      const e = buildShop(w).find((x) => x.node === node)!;
      const after = e.statAfter![0];
      purchase(w, node);
      expect(w.stats.get(e.statKey!)).toBeCloseTo(after, 9);
    }
    const shop = buildShop(w);
    expect(shop.find((x) => x.node === 'ballistics.range')!.statUnit).toBe('');
    expect(shop.find((x) => x.node === 'ballistics.crit_chance')!.statUnit).toBe('%');
    expect(shop.find((x) => x.node === 'ballistics.attack_speed')!.statUnit).toBe('/s');
    expect(shop.find((x) => x.node === 'ballistics.crit_damage')!.statUnit).toBe('x');
  });

  it('applies @final multipliers after the additive sum (Arsenal frame −25% primary damage)', () => {
    const b = newBuild();
    b.frame = 'arsenal' as never;
    b.ranks['ballistics.damage'] = 2;
    const s = new StatResolver(b, newMeta());
    const p = s.previewEffect({ stat: 'ballistics.damage', op: 'mul', perRank: 0.16 }, 2, 1, 1)!;
    expect(p.now).toBeCloseTo(10 * 1.32 * 0.75, 9);
    expect(p.next).toBeCloseTo(10 * 1.48 * 0.75, 9);
    // a final effect of its own: its factor is replaced, not stacked additively
    const f = s.previewEffect({ stat: 'ballistics.damage@final', op: 'mul', perRank: -0.1 }, 0, 1, 2)!;
    expect(f.key).toBe('ballistics.damage');
    expect(f.next).toBeCloseTo(p.now * 0.8, 9);
    b.ranks['ballistics.damage'] = 3;
    s.rebuild();
    expect(s.get('ballistics.damage')).toBeCloseTo(p.next, 9);
  });

  it('gives no preview for set effects, overrides, mechanics and maxed rows', () => {
    const s = new StatResolver(newBuild(), newMeta());
    expect(s.previewEffect({ stat: 'ballistics.damage', op: 'set', perRank: 5 }, 0, 1, 1)).toBeNull();
    s.override('ballistics.range', 999);
    expect(s.previewEffect({ stat: 'ballistics.range', op: 'add', perRank: 10 }, 0, 1, 1)).toBeNull();
    const sim = new Sim(null, 3);
    const exec = buildShop(sim.world).find((x) => x.node === 'ballistics.execution')!;
    expect(exec.statNow).toBeUndefined();
    expect(statUnit('economy.scrap_mul', 'mul', 0.1)).toBe('x');
  });
});
