import type { Sim } from '../../src/sim/index';
import type { ElementId, TreeId, DoctrineId } from '../../src/sim/core/ids';
import type { SimEvent } from '../../src/sim/core/types';
import { quietSim, combatTick } from '../core/helpers';

export { quietSim, combatTick };

/** Configure a Sim's build directly (no shop): attunements, doctrines, ranks, stat overrides; then rebuild. */
export function setup(sim: Sim, o: { elements?: ElementId[]; doctrines?: Partial<Record<TreeId, DoctrineId>>; ranks?: Record<string, number>; overrides?: Record<string, number> }): Sim {
  const w = sim.world;
  if (o.elements) w.build.attunements = [...o.elements];
  if (o.doctrines) Object.assign(w.build.doctrines, o.doctrines);
  if (o.ranks) Object.assign(w.build.ranks, o.ranks);
  if (o.overrides) for (const [k, v] of Object.entries(o.overrides)) w.stats.override(k, v);
  w.rebuildStats();
  return sim;
}

export function plugin<T>(sim: Sim, id: string): T { return sim.plugins.find((p) => p.id === id) as unknown as T; }

export function events(sim: Sim, pred: (e: SimEvent) => boolean): SimEvent[] { return sim.world.events.recent(0).filter(pred); }

export function ticks(sim: Sim, n: number): void { for (let i = 0; i < n; i++) combatTick(sim); }

/** Spawn a tanky grunt (hpScale default 1000) at (x,y). */
export function grunt(sim: Sim, x: number, y: number, hpScale = 1000): number { return sim.world.spawnEnemy('grunt', x, y, { hpScale }); }
