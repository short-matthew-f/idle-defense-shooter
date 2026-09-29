/** WP3 test helpers: mount hardpoints, rank whole trees, spawn enemies, run isolated combat ticks. */
import type { Sim } from '../../src/sim/index';
import type { WorldImpl } from '../../src/sim/core/world-impl';
import type { DoctrineId, ElementId, HardpointId, TreeId } from '../../src/sim/core/ids';
import type { SimEvent } from '../../src/sim/core/types';
import { Ev } from '../../src/sim/core/types';
import { treeDef } from '../../src/sim/core/content';
import { quietSim, combatTick } from '../core/helpers';
import { cos, sin } from '../../src/sim/math/lut';

export { combatTick };

/** Quiet Sim with an unkillable tower, the given hardpoints mounted (Arsenal frame when > 3) and elements attuned. */
export function hpSim(systems: HardpointId[], elements: ElementId[] = [], seed = 1): Sim {
  const sim = quietSim(seed);
  const w = sim.world;
  w.build.frame = systems.length > 3 ? 'arsenal' : 'standard';
  w.build.hardpoints = [...systems];
  w.build.attunements = [...elements];
  w.stats.override('bastion.max_hp', 1e9);
  w.stats.override('ballistics.damage', 0.001);   // keep the primary out of the way unless a test wants it
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  return sim;
}

/** Set every node of a tree (shared + the doctrine's nodes + exotic) to max rank and choose the doctrine. */
export function rankTree(sim: Sim, tree: TreeId, doctrine?: DoctrineId, withExotic = true): void {
  const w = sim.world, def = treeDef(tree)!;
  for (const n of def.shared) w.build.ranks[n.id] = n.maxRank;
  if (doctrine) {
    w.build.doctrines[tree] = doctrine;
    const d = def.doctrines.find((x) => x.id === doctrine)!;
    for (const n of d.nodes) w.build.ranks[n.id] = n.maxRank;
  }
  if (withExotic && def.exotic) w.build.ranks[def.exotic.id] = 1;
  w.rebuildStats();
}

export function setRanks(sim: Sim, ranks: Record<string, number>): void {
  Object.assign(sim.world.build.ranks, ranks);
  sim.world.rebuildStats();
}

/** Tough enemies on a ring (hpScale large so they survive unless a test wants kills). */
export function ring(sim: Sim, n: number, r: number, kind = 'grunt', hpScale = 1000, phase = 0): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * 6.283185307179586;
    out.push(sim.world.spawnEnemy(kind, cos(a) * r, sin(a) * r, { hpScale }));
  }
  return out;
}

export function ticks(sim: Sim, n: number): void { for (let k = 0; k < n; k++) combatTick(sim); }

export function share(sim: Sim, tag: string): number { return (sim.world as WorldImpl).damageShare().bySource[tag] ?? 0; }

export function evs(sim: Sim, type: Ev, src?: string): SimEvent[] {
  return sim.world.events.recent(0, Infinity, (e) => e.type === type && (src === undefined || e.src === src));
}
export function fxCount(sim: Sim, src: string): number { return evs(sim, Ev.Fx, src).length; }

/** Total damage recorded on Hit events with this src (whole buffered log). */
export function hitDamage(sim: Sim, src: string, enemy?: number): number {
  let d = 0;
  for (const e of evs(sim, Ev.Hit, src)) if (enemy === undefined || e.a === enemy) d += e.b;
  return d;
}
