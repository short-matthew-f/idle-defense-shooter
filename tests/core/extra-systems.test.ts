import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';

/** Systems that run without a hardpoint slot must be reported so the Upgrades and Build screens can show their trees. */
describe('UiState.extraSystems', () => {
  it('is empty for a plain build with a slotted system', () => {
    const sim = new Sim(null, 5);
    expect(sim.uiState().extraSystems).toEqual([]);
    sim.world.build.hardpoints[0] = 'ordnance';
    sim.world.rebuildStats();
    expect(sim.uiState().extraSystems).toEqual([]);   // slotted systems are already in build.hardpoints
  });
  it('lists a Borrowed Blade as borrowed, and drops it once the blade is slotted', () => {
    const sim = new Sim(null, 6);
    sim.world.build.anomalies.push('borrowed_blade');
    sim.world.rebuildStats();
    expect(sim.uiState().extraSystems).toEqual([{ system: 'blade', via: 'borrowed' }]);
    sim.world.build.hardpoints[0] = 'blade';
    sim.world.rebuildStats();
    expect(sim.uiState().extraSystems).toEqual([]);
  });
  it('lists a Frame free mount as frame', () => {
    const hive = new Sim(null, 7);
    hive.world.build.frame = 'hive';
    hive.world.rebuildStats();
    expect(hive.uiState().extraSystems).toEqual([{ system: 'drones', via: 'frame' }]);
    const prism = new Sim(null, 8);
    prism.world.build.frame = 'prism';
    prism.world.rebuildStats();
    expect(prism.uiState().extraSystems).toEqual([{ system: 'laser', via: 'frame' }]);
  });
  it('the shop sells the borrowed blade base nodes but no Doctrine nodes', () => {
    const sim = new Sim(null, 9);
    sim.world.build.anomalies.push('borrowed_blade');
    sim.world.rebuildStats();
    const blade = sim.uiState().shop.filter((e) => e.node.startsWith('blade.'));
    expect(blade.length).toBeGreaterThan(0);
    expect(blade.some((e) => e.kind === 'doctrine' && !e.locked)).toBe(false);
  });
});
