import { Sim } from '../../src/sim/index';
import type { Command, SimEvent } from '../../src/sim/core/types';
import { Ev } from '../../src/sim/core/types';
import type { AbilityId } from '../../src/sim/core/ids';
import { applyCommand } from '../../src/sim/run/commands';
import { findAbilities } from '../../src/sim/systems/abilities';
import { quietSim, combatTick } from '../core/helpers';

/** Empty arena in the combat phase (no waves), silent primary, sturdy tower, full CE. */
export function arena(seed = 1, opts: { primary?: boolean } = {}): Sim {
  const sim = quietSim(seed);
  const w = sim.world;
  if (!opts.primary) w.stats.override('ballistics.attack_speed', 0);
  w.stats.override('bastion.max_hp', 1e6);
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  w.run.phase = 'combat';
  w.tower.ce = w.tower.ceCap;
  return sim;
}

export function slot(sim: Sim, ...ids: AbilityId[]): void {
  const b = sim.world.build;
  b.abilities = [...ids];
  while (b.abilities.length < 2) b.abilities.push(null);
  sim.world.rebuildStats();
}

/** Stationary enemy (speed 0) with lots of HP. */
export function dummy(sim: Sim, x: number, y: number, kind = 'grunt', hpScale = 1000, elite?: string[]): number {
  const w = sim.world;
  const i = w.spawnEnemy(kind, x, y, { hpScale, ...(elite ? { elite } : {}) });
  w.enemies.speed[i] = 0;
  return i;
}

/**
 * Dispatch a command now (as Sim.step does at the start of a tick). Returns the error, including the
 * abilities system's rejection reason for `cast` (casts are observe-only in run/commands.ts).
 */
export function cmd(sim: Sim, c: Command): string | null {
  const err = applyCommand(sim.machine, c);
  if (c.type === 'cast') return findAbilities(sim.world)!.lastError;
  return err;
}

/** Start/stop a Trial for tests: WP8 derives world.trial from meta.activeTrial; older cores read a plain field. */
export function setTrial(sim: Sim, id: string | null): void {
  const w = sim.world as unknown as Record<string, unknown>;
  (sim.world.meta as unknown as Record<string, unknown>).activeTrial = id;
  let proto: object | null = Object.getPrototypeOf(w);
  let getter = false;
  while (proto && !getter) { getter = !!Object.getOwnPropertyDescriptor(proto, 'trial')?.get; proto = Object.getPrototypeOf(proto); }
  if (!getter) w.trial = id;
}

/** One tick of combat systems (no run machine / enemy AI), after dispatching sim-queued Directive commands. */
export function tick(sim: Sim, n = 1): void {
  const w = sim.world;
  for (let k = 0; k < n; k++) {
    const q = w.pendingCommands;
    w.pendingCommands = [];
    for (const c of q) applyCommand(sim.machine, c);
    combatTick(sim);
  }
}

export function events(sim: Sim, type: Ev, src?: string): SimEvent[] {
  return sim.world.events.recent(0).filter((e) => e.type === type && (src === undefined || e.src === src));
}
export function casts(sim: Sim, ability?: AbilityId): SimEvent[] { return events(sim, Ev.Cast, ability ? `ability.${ability}` : undefined).filter((e) => e.src.startsWith('ability.')); }

export function unlock(sim: Sim, ...nodes: string[]): void {
  for (const n of nodes) sim.world.meta.prestigeRanks[n] = 1;
  sim.world.rebuildStats();
}
