import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { Ev } from '../../src/sim/core/types';
import type { Directive } from '../../src/sim/core/types';

const DIRECTIVES: Directive[] = [
  { enabled: true, conditions: [{ kind: 'inner_ring_at_least', n: 3 }], action: { kind: 'cast', ability: 'repulsor_pulse', at: 'tower' } },
  { enabled: true, conditions: [{ kind: 'group_at_least', n: 4, radius: 90 }], action: { kind: 'cast', ability: 'bombardment', at: 'largest_group' } },
  { enabled: true, conditions: [{ kind: 'enemy_present', enemy: 'elite' }], action: { kind: 'designate', what: 'highest_threat' } },
];

function play(seed: number, ticks: number): Sim {
  const sim = new Sim(null, seed);
  const w = sim.world;
  w.meta.prestigeRanks['prestige.directives'] = 1;
  w.meta.prestigeRanks['prestige.autocast'] = 1;
  w.meta.prestigeRanks['prestige.third_tactical_slot'] = 1;
  w.rebuildStats();
  sim.command({ type: 'set_ability_slot', slot: 0, ability: 'repulsor_pulse' });
  sim.command({ type: 'set_ability_slot', slot: 1, ability: 'bombardment' });
  sim.command({ type: 'set_ability_slot', slot: 2, ability: 'missile_storm' });
  sim.command({ type: 'set_directives', directives: DIRECTIVES });
  sim.command({ type: 'set_upgrade_queue', rules: [{ node: 'ballistics.damage', maxRank: 5 }, { node: 'bastion.max_hp', keepWithin: { of: 'ballistics.damage', ranks: 2 } }] });
  for (let t = 0; t < ticks; t++) {
    if (t % 600 === 0) w.tower.ce = Math.min(w.tower.ceCap, w.tower.ce + 60);   // keep the abilities busy
    sim.step();
  }
  return sim;
}

describe('WP9 determinism', () => {
  it('same seed + same Directives → identical hashes over 3000 ticks', () => {
    const a = play(7, 3000), b = play(7, 3000);
    expect(a.events.nextId).toBeGreaterThan(100);
    expect(a.events.hash()).toBe(b.events.hash());
    expect(a.world.tower.ce).toBe(b.world.tower.ce);
    expect(a.world.run.scrap).toBe(b.world.run.scrap);
    const castsA = a.world.events.recent(0).filter((e) => e.type === Ev.Cast).length;
    const purchases = a.world.events.recent(0).filter((e) => e.type === Ev.Purchase).length;
    expect(castsA + purchases).toBeGreaterThan(0);
  });
});
