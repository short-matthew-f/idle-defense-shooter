/**
 * Shared constants for enemy behaviors (WP5): pool kind indices, per-enemy AI state bits and
 * boss_add roles. Per-enemy AI state lives in the pool's scratch columns (moved by compaction):
 *  - aiI  bitfield (AI_*); -1 (the pool default) means "not initialized yet"
 *  - aiA  behavior timer (carrier release, charger wind-up/dash/cooldown) or boss_add slot (orbit angle, element, order)
 *  - aiB  boss_add role (ROLE_*)
 *  - fx/fy last position written by the AI (Brute knockback resistance)
 */
import { kindIndex } from '../../core/content';

export const K = {
  grunt: kindIndex('grunt'), swarm: kindIndex('swarm'), runner: kindIndex('runner'), brute: kindIndex('brute'),
  kamikaze: kindIndex('kamikaze'), shielded: kindIndex('shielded'),
  splitter: kindIndex('splitter'), carrier: kindIndex('carrier'), healer: kindIndex('healer'), leech: kindIndex('leech'),
  veteran: kindIndex('veteran'),
  armored: kindIndex('armored'), warden: kindIndex('warden'), artillery: kindIndex('artillery'), charger: kindIndex('charger'),
  anchor: kindIndex('anchor'),
  phase: kindIndex('phase'), burrower: kindIndex('burrower'), nullifier: kindIndex('nullifier'), refractor: kindIndex('refractor'),
  jammer: kindIndex('jammer'),
  fragment: kindIndex('splitter_fragment'), brood: kindIndex('brood'), clump: kindIndex('clump'), bossAdd: kindIndex('boss_add'),
  boss: kindIndex('boss'),
} as const;

/** aiI bits. */
export const AI_INIT = 1 << 0;        // spawn-time setup done (elite modifiers applied)
export const AI_FORCED = 1 << 1;      // wave-end guarantee: never phase/burrow again
export const AI_SURFACED = 1 << 2;    // burrower has surfaced
export const AI_TETHER = 1 << 3;      // leech tethered to the tower (render)
export const AI_WINDUP = 1 << 4;      // charger telegraph
export const AI_DASH = 1 << 5;        // charger dash

/** boss_add roles (aiB). 0 = escort (default for boss_add). */
export const ROLE_ESCORT = 0;
export const ROLE_CLONE = 2;          // Mirror Hive decoy (bossId set so it shares the boss look)
export const ROLE_NODE = 3;           // Null Engine resistance node (aiA = element index 0..3)
export const ROLE_GEN = 4;            // Choir shield generator (aiA = generator number 0..2)
export const ROLE_TURRET = 5;         // Siege Engine turret (stationary, shoots)

/** Enemy-side src tags. */
export const TAG_ENEMY = 'enemy';

/**
 * The AI runs before the core rebuilds the spatial hash, when the hash still holds last tick's
 * (pre-compaction) indices. Every AI-phase spatial query calls this first: it rebuilds the hash at
 * most once per tick and only when some behavior actually needs it (idle ticks stay cheap).
 */
let spatialWorld: object | null = null;
let spatialTick = -1;
export function ensureSpatial(w: { tick: number }): void {
  if (spatialWorld === w && spatialTick === w.tick) return;
  const impl = w as { rebuildSpatial?: () => void };
  if (typeof impl.rebuildSpatial === 'function') impl.rebuildSpatial();
  spatialWorld = w; spatialTick = w.tick;
}
/** Forget the per-tick rebuild marker (the core rebuilds after the AI; the next AI tick must rebuild again). */
export function spatialStale(): void { spatialWorld = null; spatialTick = -1; }
