/**
 * World: owned by WP1 (core). This file declares the public surface other
 * systems rely on; WP1 fills in the implementation (keep these members, add more).
 */
import type { Prng } from '../math/prng';
import type { EnemyPool, ProjectilePool, TowerState, RunState, BuildState, MetaState, EventLog, Hazard, WaveDef, SimEvent } from './types';
import type { ElementId, StatusId, WeaponSystemId, TargetingProfile } from './ids';
import type { HitInfo } from './system';

export interface DerivedStats {
  /** Resolved stat values by StatKey after all node effects, frame, anomalies, prestige nodes and constellation. */
  get(key: string): number;
  has(nodeId: string): boolean;         // rank >= 1
  rank(nodeId: string): number;
  doctrine(tree: string): string | null;
  hasDoctrine(tree: string, doctrine: string): boolean;   // primary or second doctrine
  doctrineStrength(tree: string, doctrine: string): number;  // 1 for primary, 0.6/0.5 for second
  hasAnomaly(id: string): boolean;
  mounted(system: WeaponSystemId): boolean;
  attuned(element: ElementId): boolean;
}

export interface World {
  readonly tick: number;
  readonly dt: number;                  // TICK_DT
  prng: Prng;                           // per-attempt combat stream
  enemies: EnemyPool;
  projectiles: ProjectilePool;
  hazards: Hazard[];
  tower: TowerState;
  run: RunState;
  build: BuildState;
  meta: MetaState;
  stats: DerivedStats;
  events: EventLog;
  wave: WaveDef | null;
  /** Spatial hash over live enemies, rebuilt each tick before systems run. */
  queryRadius(x: number, y: number, r: number, out: Int32Array): number;   // returns count written
  nearestEnemy(x: number, y: number, maxR: number, profile: TargetingProfile, system: WeaponSystemId): number;
  /** Apply damage through armor/shields; emits Hit (and Kill) events; fires hooks. Returns HitInfo. */
  damage(enemy: number, amount: number, opts: { source: HitInfo['source']; srcTag: string; crit?: boolean; element?: ElementId | null; projectile?: number; cause: number; x?: number; y?: number; ignoreArmor?: boolean; trueDamage?: boolean;
    /** WP1 addition: no Hit event (DoT pulses); hooks still run with eventId = cause; a kill still emits Kill. */ silent?: boolean }): HitInfo;
  applyStatus(enemy: number, status: StatusId, stacks: number, durationTicks: number, srcTag: string, cause: number, magnitude?: number): void;
  knockback(enemy: number, dx: number, dy: number, force: number): void;
  pull(enemy: number, towardX: number, towardY: number, force: number): void;
  spawnProjectile(init: Partial<{ kind: number; source: number; x: number; y: number; vx: number; vy: number; damage: number; radius: number; life: number; pierce: number; bounces: number; target: number; flags: number; element: ElementId | null; critChance: number; blast: number; cause: number;
    /* WP1 additions */ srcTag: string; critMul: number; retention: number; pierceSpeed: number; bounceRange: number; knock: number; execBonus: number }>): number;
  spawnEnemy(kind: string, x: number, y: number, opts?: { hpScale?: number; elite?: readonly string[]; bossId?: string | null; cause?: number;
    /** WP1 addition: hpScale already includes the elite HP multiplier (generator spawns); skip the ×2.5. */ eliteHpIncluded?: boolean }): number;
  explode(x: number, y: number, radius: number, damage: number, opts: { source: HitInfo['source']; srcTag: string; element?: ElementId | null; cause: number; falloff?: boolean }): void;
  addHazard(h: Hazard): void;
  damageTower(amount: number, enemy: number, cause: number): void;
  healTower(amount: number, cause: number): void;
  gainCE(amount: number): void;
  emit(type: number, src: string, a: number, b: number, x: number, y: number, cause: number, data?: SimEvent['data']): number;
  /** Convenience: is the enemy index live and matching the generation. */
  alive(enemy: number): boolean;
  killEnemy(enemy: number, cause: number, srcTag: string): void;
  /** Elapsed seconds this attempt / wave, for cadence systems. */
  attemptSeconds(): number;

  // --- WP1 additions (see core/world-impl.ts for semantics) ------------------
  /** Freeze solid for `ticks` (Deep Freeze). Immovable enemies are immune. Emits StatusApply (status 'frozen'). */
  freeze(enemy: number, ticks: number, srcTag: string, cause: number): void;
  /** Remove an enemy without rewards or Kill event (kamikaze detonation, merges, restarts). */
  despawnEnemy(enemy: number): void;
  /** Resolve a remembered EntityRef to its current pool index (pools compact), or NO_ENTITY if dead. */
  resolveEnemy(index: number, gen: number): number;
  /** Re-resolve DerivedStats and call every System.rebuild (after purchases etc.). */
  rebuildStats(): void;
  /** Intern a srcTag string for projectiles (ProjectilePool.tag). */
  tagId(tag: string): number;
  tagName(id: number): string;
  /** Free a projectile (deferred to end of tick). */
  freeProjectile(p: number): void;
  /** Seconds since the current wave started. */
  waveSeconds(): number;
  /** Nearest targetable enemy within maxR, skipping the first `excludeCount` indices of `exclude` (Split Sight, spreading hardpoints). */
  nearestExcluding(x: number, y: number, maxR: number, exclude: Int32Array, excludeCount: number): number;
}
