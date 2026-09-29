import { describe, it, expect } from 'vitest';
import { Ev } from '../../src/sim/core/types';
import { runUpgradeQueue } from '../../src/sim/directives/upgrade-queue';
import { shopEntryFor } from '../../src/sim/economy/shop';
import { arena, cmd, tick, events, unlock } from './helpers';

function between(sim: ReturnType<typeof arena>): void { sim.machine.setPhase('between'); }

describe('Upgrade Queue', () => {
  it('set_upgrade_queue stores rules; nothing is bought without prestige.directives', () => {
    const sim = arena();
    const w = sim.world;
    w.run.scrap = 1e6;
    expect(cmd(sim, { type: 'set_upgrade_queue', rules: [{ node: 'ballistics.damage', maxRank: 2 }] })).toBeNull();
    expect(w.meta.upgradeQueue).toEqual([{ node: 'ballistics.damage', maxRank: 2 }]);
    between(sim);
    tick(sim, 30);
    expect(w.build.ranks['ballistics.damage'] ?? 0).toBe(0);
  });

  it('buys in order between waves, honoring maxRank', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    w.run.scrap = 1e6;
    cmd(sim, { type: 'set_upgrade_queue', rules: [{ node: 'ballistics.damage', maxRank: 2 }, { node: 'bastion.max_hp', maxRank: 1 }, { node: 'ballistics.attack_speed', maxRank: 1 }] });
    between(sim);
    tick(sim);
    const bought = events(sim, Ev.Purchase).map((e) => e.src);
    expect(bought).toEqual(['ballistics.damage', 'ballistics.damage', 'bastion.max_hp', 'ballistics.attack_speed']);
  });

  it('keepWithin keeps a node within N ranks of another', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    w.run.scrap = 1e7;
    cmd(sim, { type: 'set_upgrade_queue', rules: [
      { node: 'bastion.max_hp', keepWithin: { of: 'ballistics.damage', ranks: 1 } },
      { node: 'ballistics.damage', maxRank: 4 },
    ] });
    between(sim);
    tick(sim);
    expect(w.build.ranks['ballistics.damage']).toBe(4);
    expect(w.build.ranks['bastion.max_hp']).toBe(3);
  });

  it('waits (saves up) for an unaffordable head of the queue; skips unavailable nodes', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    const ca = shopEntryFor(w, 'ballistics.damage')!.cost, cb = shopEntryFor(w, 'bastion.max_hp')!.cost;
    const [head, next] = ca >= cb ? ['ballistics.damage', 'bastion.max_hp'] : ['bastion.max_hp', 'ballistics.damage'];
    w.meta.upgradeQueue = [{ node: 'laser.unknown_node' }, { node: head, maxRank: 1 }, { node: next, maxRank: 1 }];
    w.run.scrap = Math.min(ca, cb) + (ca === cb ? -1 : 0);
    expect(runUpgradeQueue(w)).toBe(0);
    w.run.scrap = ca + cb;
    expect(runUpgradeQueue(w)).toBe(2);
    expect(events(sim, Ev.Purchase).map((e) => e.src)).toEqual([head, next]);
  });

  it('runs every 2 s during combat', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    w.run.scrap = 1e6;
    cmd(sim, { type: 'set_upgrade_queue', rules: [{ node: 'ballistics.damage', maxRank: 1 }] });
    w.run.waveTick = 0;
    for (let k = 0; k < 100; k++) { tick(sim); w.run.waveTick++; }
    expect(w.build.ranks['ballistics.damage'] ?? 0).toBe(0);
    for (let k = 0; k < 30; k++) { tick(sim); w.run.waveTick++; }
    expect(w.build.ranks['ballistics.damage']).toBe(1);
  });
});
