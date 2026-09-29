import { Sim } from '../../src/sim/index';

/** A Sim whose tower one-shots anything and cannot die (for run-machine tests). */
export function strongSim(seed = 1): Sim {
  const sim = new Sim(null, seed);
  const s = sim.world.stats;
  s.override('ballistics.damage', 5000);
  s.override('ballistics.attack_speed', 8);
  s.override('ballistics.range', 700);
  s.override('ballistics.projectile_speed', 900);
  s.override('bastion.max_hp', 1e7);
  sim.world.rebuildStats();
  sim.world.tower.hp = sim.world.tower.maxHp;
  return sim;
}

/** Step until pred() or maxTicks; returns ticks stepped. */
export function runUntil(sim: Sim, pred: () => boolean, maxTicks: number): number {
  let n = 0;
  while (!pred() && n < maxTicks) { sim.step(); n++; }
  return n;
}

/** Advance one tick of combat systems only (no run machine, no enemy AI): for isolated system tests. */
export function combatTick(sim: Sim): void {
  const w = sim.world;
  sim.statuses.update(w);
  w.rebuildSpatial();
  for (const p of sim.plugins) p.update(w);
  updateProjectiles(w);
  updateHazards(w);
  sim.towerSystem.update(w);
  w.endTick();
  w.run.tick++;
}
import { updateProjectiles } from '../../src/sim/core/projectiles';
import { updateHazards } from '../../src/sim/core/hazards';

/** Fresh Sim with an empty field, frozen in a phase that never spawns. */
export function quietSim(seed = 1): Sim {
  const sim = new Sim(null, seed);
  sim.world.clearCombat();
  sim.world.run.phase = 'wave_clear';
  return sim;
}
