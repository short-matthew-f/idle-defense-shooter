import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { buildShop, purchase } from '../../src/sim/economy/shop';
import { nodeInfo, treeDef } from '../../src/sim/core/content';
import { nodeCost } from '../../src/sim/economy/curves';
import { Ev } from '../../src/sim/core/types';

describe('shop', () => {
  it('lists chassis nodes and charges Scrap on purchase', () => {
    const sim = new Sim(null, 3);
    const w = sim.world;
    const shop = buildShop(w);
    const dmg = shop.find((e) => e.node === 'ballistics.damage')!;
    expect(dmg).toBeTruthy();
    expect(dmg.currency).toBe('scrap');
    expect(dmg.affordable).toBe(false);
    expect(shop.some((e) => e.node === 'bastion.max_hp')).toBe(true);
    expect(shop.some((e) => e.tree === 'drones')).toBe(false);          // not mounted
    expect(purchase(w, 'ballistics.damage')).toBe('Not enough Scrap');
    w.run.scrap = 1000;
    const cost = nodeCost(nodeInfo('ballistics.damage')!.def, 0).cost;
    const before = w.stats.get('ballistics.damage');
    expect(purchase(w, 'ballistics.damage')).toBeNull();
    expect(w.run.scrap).toBe(1000 - cost);
    expect(w.build.ranks['ballistics.damage']).toBe(1);
    expect(w.run.spentByTree.ballistics).toBe(cost);
    expect(w.stats.get('ballistics.damage')).toBeGreaterThan(before);
    expect(w.events.recent(0).some((e) => e.type === Ev.Purchase && e.src === 'ballistics.damage')).toBe(true);
  });

  it('opens the doctrine fork, chooses the first doctrine free, and gates changes to checkpoints', () => {
    const sim = new Sim(null, 3);
    const w = sim.world;
    w.run.scrap = 1e9;
    const tree = treeDef('ballistics')!;
    expect(buildShop(w).find((e) => e.node === 'ballistics.piercing')!.locked).toMatch(/more/);
    let bought = 0;
    for (const n of tree.shared) { if (bought >= tree.forkRequirement) break; if (!n.requires && purchase(w, n.id) === null) bought++; }
    const entry = buildShop(w).find((e) => e.node === 'ballistics.piercing')!;
    expect(entry.locked).toBeUndefined();
    expect(entry.cost).toBe(0);
    expect(purchase(w, 'ballistics.piercing')).toBeNull();
    expect(w.build.doctrines.ballistics).toBe('piercing');
    expect(buildShop(w).some((e) => e.node === 'ballistics.piercing.count')).toBe(true);
    // changing: 1 Core, only in `between` right after a checkpoint (wave − 1 === checkpoint)
    w.run.cores = 2;
    w.run.phase = 'combat';
    expect(purchase(w, 'ballistics.ricochet')).toMatch(/checkpoint/);
    w.run.phase = 'between';
    expect(purchase(w, 'ballistics.ricochet')).toBeNull();
    expect(w.run.cores).toBe(1);
    expect(w.build.doctrines.ballistics).toBe('ricochet');
    expect(w.stats.rank('ballistics.piercing.count')).toBe(0);
  });
});
