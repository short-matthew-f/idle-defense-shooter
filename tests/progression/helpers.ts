import { Sim } from '../../src/sim/index';
import type { Command } from '../../src/sim/core/types';
import type { AnomalyId } from '../../src/sim/core/ids';
import { applyCommand } from '../../src/sim/run/commands';
import { Ev } from '../../src/sim/core/types';

/** Apply a command immediately (outside Sim.step) and return its error or null. */
export function cmd(sim: Sim, c: Command): string | null { return applyCommand(sim.machine, c); }

/** Fresh Sim with an empty field, frozen in a phase that never spawns (combat systems via combatTick). */
export function calmSim(seed = 1): Sim {
  const sim = new Sim(null, seed);
  sim.world.clearCombat();
  sim.world.run.phase = 'wave_clear';
  sim.world.meta.codex = {};
  return sim;
}

export function socket(sim: Sim, ...ids: AnomalyId[]): void {
  const b = sim.world.build;
  b.anomalySockets = Math.max(b.anomalySockets, b.anomalies.length + ids.length);
  b.anomalies.push(...ids);
  sim.world.rebuildStats();
}

/** Ev.Anomaly events with this src. */
export function eventsSrc(sim: Sim, src: string): number {
  return sim.events.recent(0).filter((e) => e.type === Ev.Anomaly && e.src === src).length;
}
