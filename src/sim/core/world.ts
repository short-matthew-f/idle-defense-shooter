/**
 * World: owned by WP1 (core). This file declares the public surface other
 * systems rely on; WP1 fills in the implementation (keep these members, add more).
 */
import type { Prng } from '../math/prng';
import type { EnemyPool, ProjectilePool, TowerState, RunState, BuildState, MetaState, EventLog, Hazard, WaveDef, SimEvent, Command } from './types';
import type { AbilityId, ElementId, StatusId, WeaponSystemId, TargetingProfile, TrialId } from './ids';
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

/**
 * WP3 addition: hardpoint geometry published every tick by the hardpoint systems (they never import
 * each other). Each system rewrites its section in its own update() (counts are 0 when unmounted);
 * linkages/infusions (later in SYSTEM_ORDER) read the same tick's values. The "channel" fields are
 * written by systems/linkages.ts and read by the owning hardpoint on the NEXT tick (1 = no effect).
 */
export interface SharedGeometry {
  /** Orbital Blade: blade k is the segment from radius bladeInner[k] to bladeInner[k] + bladeLens[k] at bladeAngles[k]. */
  bladeCount: number; bladeAngles: Float32Array; bladeInner: Float32Array; bladeLens: Float32Array;
  /** Channel: blade rotation multiplier (Whetstone, Kinetic Loop, Flywheel). */
  bladeSpeedMul: number;
  /** Laser: live node positions (x,y pairs), active beam segments (x0,y0,x1,y1) after refractor/bend, full beam width, beam element (index+1, 0 none), inscribed-interior radius (0 = no interior). */
  laserNodeCount: number; laserNodes: Float32Array; laserBeamCount: number; laserBeams: Float32Array;
  laserBeamWidth: number; laserElement: number; laserInterior: number;
  /** Channels: beam width multiplier (Refraction Lens), pulse cadence multiplier (Pulse Clock). */
  laserWidthMul: number; laserPulseRateMul: number;
  /** Gravitics: active wells (x, y, radius, captives) and wells that collapsed this tick (x, y, radius, captives). */
  wellCount: number; wells: Float32Array; collapseCount: number; collapses: Float32Array;
  /** Drones: (x, y, target enemy index or -1) per drone. */
  droneCount: number; drones: Float32Array;
  /** Channel: per-drone damage/speed bonus fraction (Gravity Assist, Sync Burst). */
  droneBoost: Float32Array;
  /** Jammer auras (x, y, radius), cached lazily once per tick (jammerTick) by whichever hardpoint asks first. */
  jammerTick: number; jammerCount: number; jammers: Float32Array;
}

export interface World {
  /** WP3 addition: shared hardpoint geometry (see SharedGeometry). */
  shared: SharedGeometry;
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
  explode(x: number, y: number, radius: number, damage: number, opts: { source: HitInfo['source']; srcTag: string; element?: ElementId | null; cause: number; falloff?: boolean; /** cap each target's damage at this × its max HP */ maxHpCap?: number }): void;
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

  // --- WP9 additions ---------------------------------------------------------
  /**
   * Multiplier on every weapon's attack speed this tick (Overdrive ×2). Contributors compose it
   * multiplicatively: divide out their previous factor, multiply in the new one. Default 1.
   */
  dynamicSpeedMul: number;
  /**
   * Queue a Command from inside the sim (Directives, Autocast). It is dispatched at the start of the
   * next tick through the same path as player commands (run/commands.ts → System.onCommand), so
   * onCommand observers (boss Counters) see Directive casts/designations too.
   */
  enqueueCommand(cmd: Command): void;
  // --- WP2 additions --------------------------------------------------------
  /**
   * Multiplier on all outgoing (non-true) damage, on top of combat.power_mul (Phoenix Last Stand).
   * Same composition rule as dynamicSpeedMul: divide out your previous factor, multiply in the new one. Default 1.
   */
  dynamicPowerMul: number;
  /** Multiplier on the tower's armor in damageTower (Thorns Reactive Armor). Same composition rule. Default 1. */
  towerArmorMul: number;
  /** Healing that overflowed max HP via healTower since the last reader drained it (Fortress Keep). */
  healOverflow: number;
  // --- WP5 additions (enemies/bosses.ts owns the values) ------------------------
  /** The live boss tell: the Counter that defeats it, ticks left in its window, the boss pool index (-1 = none). */
  bossTell: { ability: AbilityId | 'designate' | null; ticksLeft: number; bossIndex: number };
  /**
   * Pre-armor damage multiplier hook read by World.damage for every hit on an enemy (boss weak points ×1.5/×2 designated,
   * phase-change invulnerability ×0, Null Engine resisted element ×0.3, Veteran resistance). null = none.
   */
  damageModifier: ((enemy: number, element: ElementId | null, srcTag: string, source: HitInfo['source']) => number) | null;
  // --- WP8 additions -----------------------------------------------------------
  /** The Trial being played (meta.activeTrial), or null. Systems enforce Trial rules through it. */
  readonly trial: TrialId | null;
  /** Progression signals written by systems/anomalies.ts each tick for the systems that own the mechanic. */
  signals: ProgressionSignals;
}

/**
 * WP8: signals for Anomaly / Prestige IV effects that live inside another system's mechanics.
 * systems/anomalies.ts writes them every tick; the owning system may read them (none is required to).
 */
export interface ProgressionSignals {
  /** Orbital Blade spin direction (±1): flipped by Clockwork Blade (6 s) and Reversal (8 s). */
  bladeDir: number;
  /** Temporary extra laser connections active right now (Ghost Edges). */
  ghostEdges: number;
  /** Laser node count multiplier (Mirror Node ×2, else 1). */
  laserNodeMul: number;
}
