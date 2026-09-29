/**
 * Plugin interface for combat systems (weapons, defenses, elements, hardpoints,
 * fusions, linkages, anomalies). The World owns pools and calls systems in a
 * fixed order every tick; systems never call each other directly. Cross-system
 * behavior is expressed through hooks (onHit, onKill, onStatus) and through
 * the event log, so every interaction has a cause id.
 *
 * WP1 (core) implements World; later work packages implement systems and
 * register them in src/sim/systems/index.ts (SYSTEM_ORDER).
 */
import type { World } from './world';
import type { ElementId, StatusId, WeaponSystemId } from './ids';

export interface HitInfo {
  enemy: number;                // enemy pool index
  damage: number;               // final damage after armor, before status procs
  source: WeaponSystemId | 'status' | 'ability' | 'hazard' | 'fusion' | 'linkage' | 'retaliation';
  srcTag: string;               // e.g. 'ballistics', 'fusion.plasma', 'link.blade+laser', 'burn'
  crit: boolean;
  element: ElementId | null;    // element carried by the hit (primary native, infusion, fusion)
  projectile: number;           // projectile index or NO_ENTITY
  x: number; y: number;
  cause: number;                // parent event id
  eventId: number;              // the Hit event id (children chain from this)
  killed: boolean;
}

export interface System {
  readonly id: string;
  /** Called once when the World is (re)built for an attempt; cache stat keys here. */
  init(world: World): void;
  /** Called when ranks/doctrines/anomalies change; re-read derived stats. */
  rebuild(world: World): void;
  /** Called every tick after enemies move, in SYSTEM_ORDER. */
  update(world: World): void;
  /** Called at wave start / wave end / attempt start for per-wave state. */
  onWaveStart?(world: World): void;
  onWaveEnd?(world: World): void;
  onAttemptStart?(world: World): void;
  /** Reaction hooks; called for every hit/kill/status on any enemy, from any source. */
  onHit?(world: World, hit: HitInfo): void;
  onKill?(world: World, hit: HitInfo): void;
  onStatusApply?(world: World, enemy: number, status: StatusId, stacks: number, srcTag: string, cause: number): void;
  onTowerHit?(world: World, damage: number, enemy: number, cause: number): void;
  /** Push render instances for this system's visible parts (blades, beams, wells, drones). */
  render?(world: World, out: InstanceWriter): void;
}

/** Allocation-free writer for RenderSnapshot instances (12 floats each). */
export interface InstanceWriter {
  push(x: number, y: number, radius: number, rot: number, shape: number, r: number, g: number, b: number, a: number, layer: number, aux0?: number, aux1?: number): void;
  fx(kind: number, x: number, y: number, r: number, g: number, b: number, size: number, count: number): void;
}
