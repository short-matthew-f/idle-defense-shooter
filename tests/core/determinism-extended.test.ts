/**
 * Determinism gaps found in the code-health review (docs/reviews/CODE-HEALTH.md):
 *  - module-level state shared between Sim instances (scratch buffers, caches keyed by world/tick)
 *    must not leak: two Sims stepped interleaved in one process equal the same Sims stepped alone
 *    (sim-cli runs several Sims per process; tests do too);
 *  - save → load mid-run: every load of the same save (direct, JSON round-trip, load→save→load)
 *    produces the same event stream across a wave boundary, with a build that exercises hardpoints,
 *    elements, anomalies, abilities, directives and the upgrade queue.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { allNodes } from '../../src/sim/core/content';
import type { SaveState } from '../../src/sim/core/types';

/** A mid-game build touching most systems (not saved: stat overrides; everything here is saved state). */
function richSim(seed: number): Sim {
  const sim = new Sim(null, seed);
  const w = sim.world, b = w.build;
  b.hardpoints = ['ordnance', 'drones', 'laser', 'gravitics'];
  b.attunements = ['fire', 'lightning', 'frost'];
  b.anomalies = ['loaded_dice', 'seventh_shot'];
  b.abilities = ['repulsor_pulse', 'bombardment'];
  b.targeting = { primary: 'lowest_hp', ordnance: 'elites' };
  w.run.hardpointSlotsOpen = 4; w.run.attunementSlotsOpen = 3; w.run.scrap = 5e5;
  for (const info of allNodes()) {
    if (info.group !== 'tree' && info.group !== 'link' && info.group !== 'infuse' && info.group !== 'fusion') continue;
    if (info.doctrine || info.exotic) continue;
    b.ranks[info.def.id] = Math.min(info.def.maxRank, 2);
  }
  w.meta.prestigeRanks['prestige.directives'] = 1;
  w.meta.directives = [
    { enabled: true, conditions: [{ kind: 'inner_ring_at_least', n: 3 }], action: { kind: 'cast', ability: 'repulsor_pulse', at: 'tower' } },
    { enabled: true, conditions: [{ kind: 'enemy_present', enemy: 'elite' }], action: { kind: 'designate', what: 'highest_threat' } },
  ];
  w.meta.upgradeQueue = [{ node: 'ballistics.damage', maxRank: 12 }, { node: 'bastion.max_hp', keepWithin: { of: 'ballistics.damage', ranks: 2 } }];
  w.run.checkpoint = 15; w.run.deepestCleared = 15;   // denser waves: more systems fire
  w.rebuildStats();
  sim.machine.startAttempt(false);
  return sim;
}

describe('determinism: no state shared between Sim instances', () => {
  it('two Sims stepped interleaved equal the same Sims stepped alone', () => {
    const N = 2400;
    const a = richSim(3), b = richSim(4);
    for (let t = 0; t < N; t++) { a.step(); b.step(); if (t % 7 === 0) b.step(); }
    const aAlone = richSim(3);
    for (let t = 0; t < N; t++) aAlone.step();
    const bAlone = richSim(4);
    for (let t = 0; t < N + Math.ceil(N / 7); t++) bAlone.step();
    expect(a.events.nextId).toBeGreaterThan(500);
    expect(a.events.hash()).toBe(aAlone.events.hash());
    expect(b.events.hash()).toBe(bAlone.events.hash());
    expect(a.world.run.scrap).toBe(aAlone.world.run.scrap);
  });
});

describe('determinism: save → load mid-run', () => {
  it('every load of one save plays the same events across a wave boundary', () => {
    const src = richSim(9);
    src.run(2700);   // mid-run: several waves in, enemies alive
    const save = src.save();
    const viaJson = JSON.parse(JSON.stringify(save)) as SaveState;
    const loads = [Sim.load(save), Sim.load(viaJson), Sim.load(Sim.load(save).save())];
    const startWave = loads[0].world.run.wave;
    for (const s of loads) s.run(3600);
    expect(loads[0].world.run.wave).toBeGreaterThan(startWave);   // crossed at least one wave boundary
    const h = loads[0].events.hash();
    for (const s of loads) {
      expect(s.events.hash()).toBe(h);
      expect(s.events.nextId).toBe(loads[0].events.nextId);
    }
    expect(JSON.stringify(loads[1].save())).toBe(JSON.stringify(loads[0].save()));
  });

  it('load → save is idempotent (a second round trip changes nothing)', () => {
    const src = richSim(5);
    src.run(1800);
    const once = Sim.load(src.save()).save();
    const twice = Sim.load(once).save();
    expect(twice).toEqual(once);
  });
});
