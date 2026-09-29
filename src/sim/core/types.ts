/**
 * Shared runtime contracts for the simulation. Everything in src/sim is pure
 * TypeScript with no DOM access; the same code runs in a Web Worker and in Node.
 *
 * Conventions
 *  - Time: fixed 60 Hz ticks. `tick` is an integer. TICK_DT = 1/60 seconds.
 *  - Space: the arena is a circle of radius ARENA_RADIUS centered on the tower at (0,0).
 *    Units are "arena units"; the tower body has radius TOWER_RADIUS.
 *  - Entities: struct-of-arrays pools; an entity is referenced by its pool index while
 *    alive, and by an EntityRef (index + generation) when it must be remembered across ticks.
 *  - Events: every event has an id and a cause id (the parent event), forming the kill chain.
 */
import type {
  AbilityId, AnomalyId, BossId, DoctrineId, ElementId, EliteModifier, EnemyKind, FormationId,
  FrameId, HardpointId, NodeId, TargetingProfile, TreeId, TrialId, WeaponSystemId,
} from './ids';

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const ARENA_RADIUS = 520;      // enemies spawn on this perimeter
export const TOWER_RADIUS = 22;
export const INNER_RING = 120;        // "inner ring" for Directive conditions and Critical Mass
export const CE_CAP_BASE = 100;

/** Entity budgets (design §20). Past these, swarms merge into Clumps. */
export const MAX_ENEMIES = 1500;
export const MAX_PROJECTILES = 4000;
export const MAX_DRONES = 64;
export const MAX_WELLS = 16;
export const MAX_LASER_NODES = 16;
export const MAX_BLADES = 4;
export const MAX_HAZARDS = 256;

/** index + generation; `gen` mismatch means the slot was recycled. */
export interface EntityRef { index: number; gen: number }
export const NO_ENTITY = -1;

// ---------------------------------------------------------------------------
// Enemy pool (struct of arrays)
// ---------------------------------------------------------------------------
export interface EnemyPool {
  count: number;                 // live count (compact; index < count is alive)
  capacity: number;
  gen: Uint32Array;
  kind: Uint8Array;              // EnemyKind index (see data/enemies.ts KIND_INDEX)
  x: Float32Array; y: Float32Array;
  vx: Float32Array; vy: Float32Array;
  hp: Float32Array; maxHp: Float32Array;
  shield: Float32Array; maxShield: Float32Array;
  armor: Float32Array;           // flat armor; damage after armor = dmg * 100/(100+armor)
  radius: Float32Array;
  speed: Float32Array;           // base movement speed (units/s) before statuses
  angle: Float32Array;           // facing / formation angle
  flags: Uint32Array;            // EnemyFlag bitfield
  eliteMods: Uint16Array;        // EliteModifier bitfield
  bossId: Int8Array;             // -1 unless kind === boss
  bossPhase: Uint8Array;
  spawnTick: Int32Array;
  lastHitTick: Int32Array;
  // Status stacks. Stacks are integers; durations in ticks.
  burn: Uint8Array; burnT: Uint16Array; burnDps: Float32Array;
  poison: Uint8Array; poisonT: Uint16Array; poisonDps: Float32Array;
  chill: Uint8Array; chillT: Uint16Array;
  shock: Uint8Array; shockT: Uint16Array;
  bleed: Uint8Array; bleedT: Uint16Array;
  brittle: Uint8Array; brittleT: Uint16Array;
  markedT: Uint16Array;          // designated / Hunter Mark ticks remaining
  frozenT: Uint16Array;          // Deep Freeze; > 0 means frozen solid
  staggerT: Uint16Array;
  /** Per-enemy scratch used by AI (healer targets, leech tethers, formation slot). */
  aiA: Float32Array; aiB: Float32Array; aiI: Int32Array;
  /** Formation slot: target position the formation script wants this enemy at. */
  fx: Float32Array; fy: Float32Array;
  /** Count merged into this entity when kind === clump. */
  clumpCount: Uint16Array;
  // --- WP1 additions ------------------------------------------------------
  /** Index into the current WaveDef.spawns for formation steering; -1 = free-roaming (adds, fragments). */
  spawnIdx: Int32Array;
  /** Formation progress in ticks (advances by speedMul each tick; chill slows the script itself). */
  formT: Float32Array;
  /**
   * Movement multiplier: THE slow channel every mover reads (steering, behaviors, boss controllers; targeting 'fastest').
   * Rule (code-health pass; see ARCHITECTURE.md "Movement speed"): the statuses system RECOMPUTES it every tick, before
   * the AI, as base × (1 − fieldSlow), where base = 0 if frozenT > 0 or staggerT > 0 (non-boss), else
   * 1 − min(slowCap, slowPerStack × chill) (half effect on Immovable), and then clears fieldSlow. Only the AI's speed
   * auras (commanding elites ×1.2, boss haste ×1.5, boss accelerate ×1.6) multiply it afterwards, in the same tick.
   * Never write it from a plugin: to slow enemies, raise `fieldSlow` (area effects) or apply chill/freeze/stagger.
   */
  speedMul: Float32Array;
  /** Ticks until this enemy may attack again (contact / ranged). */
  attackT: Uint16Array;
  /** Event id of this enemy's Spawn event (cause for its own attacks). */
  spawnEv: Int32Array;
  /** Scrap weight k for ScrapPerKill (EnemyDef.scrapMul). */
  scrapMul: Float32Array;
  /** Contact damage at wave 1 (EnemyDef.contactDamage); scaled by 1.06^wave at hit time. */
  contact: Float32Array;
  /** Event id of the StatusApply that last refreshed each DoT (kill-chain parent of the DoT damage). */
  burnCause: Int32Array; poisonCause: Int32Array; bleedCause: Int32Array;
  /** DoT damage accumulated since the last StatusTick event (emitted once per second). */
  burnAcc: Float32Array; poisonAcc: Float32Array; bleedAcc: Float32Array;
  /** Bleed damage per stack per second. */
  bleedDps: Float32Array;
  /** 'static' status stacks (Lightning Chain doctrine). */
  staticStacks: Uint8Array; staticT: Uint16Array;
  /**
   * WP9 addition: fraction of movement removed NEXT tick by area fields: the only slow input plugins write.
   * Writers use max() (Time Field, Containment Field, the boss Deep Freeze window driven by `bossSlowUntil`);
   * statuses folds it into speedMul and clears it (see speedMul).
   */
  fieldSlow: Float32Array;
  // --- WP2 additions (elements, fusions, reactor) ---------------------------
  /** Cryotoxin: poison damage banked while frozen; released ×fusion.cryotoxin on thaw. */
  bankedPoison: Float32Array;
  /**
   * Tick-stamped lockouts: Deep Freeze (5 s), Thermal Shock (1 s), Flashpoint re-eruption, and the boss Deep Freeze
   * slow window (`bossSlowUntil` is a timer, not a slow: while it runs the elements system raises fieldSlow).
   */
  freezeLockUntil: Int32Array; thermalUntil: Int32Array; flashUntil: Int32Array; bossSlowUntil: Int32Array;
  /** Synchronization: start tick of the current combo window and the bitmask of weapon systems (SYSTEM_ORDER_IDS index) that hit in it. */
  comboStart: Int32Array; comboMask: Uint8Array;
  /** Harmonic Lock: tick until which the enemy takes the +50% bonus. */
  harmonicUntil: Int32Array;
  /** WP3 addition: extra weak-point exposure (ticks) banked by Kill Order; when the boss script closes the weak point, systems/ordnance.ts holds it open for this long. */
  weakPointT: Uint16Array;
}

export const enum EnemyFlag {
  Elite         = 1 << 0,
  Boss          = 1 << 1,
  Immovable     = 1 << 2,  // Anchor: immune to pull/knockback/freeze
  Phased        = 1 << 3,  // currently intangible (Phase)
  Burrowed      = 1 << 4,
  Refracts      = 1 << 5,  // Refractor: deflects beams
  Jams          = 1 << 6,  // Jammer aura
  Nullifies     = 1 << 7,  // Nullifier aura: strips statuses
  Shielder      = 1 << 8,  // Warden: projects shields onto others
  Healer        = 1 << 9,
  Kamikaze      = 1 << 10,
  Ranged        = 1 << 11, // Artillery: attacks from range
  Support       = 1 << 12, // targeting profile "support"
  WeakPointOpen = 1 << 13, // boss weak point exposed
  Reviving      = 1 << 14,
  Dead          = 1 << 15,
  Clump         = 1 << 16,
  Ally          = 1 << 17, // Ghost Protocol: fights for the tower
}

// ---------------------------------------------------------------------------
// Projectile pool
// ---------------------------------------------------------------------------
export const enum ProjKind { Bullet = 0, Fireball = 1, Missile = 2, Rocket = 3, Shell = 4, Bomb = 5, DroneShot = 6, Microdrone = 7, CuttingArc = 8, EnemyShot = 9, BallLightning = 10, Fragment = 11 }

export interface ProjectilePool {
  count: number; capacity: number;
  gen: Uint32Array;
  kind: Uint8Array;              // ProjKind
  source: Uint8Array;            // WeaponSystem index (see SYSTEM_INDEX)
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array;
  damage: Float32Array;
  radius: Float32Array;
  life: Uint16Array;             // ticks remaining
  pierce: Uint8Array;            // remaining pierce count
  bounces: Uint8Array;           // remaining ricochets
  target: Int32Array;            // enemy index for homing, or NO_ENTITY
  targetGen: Uint32Array;
  flags: Uint32Array;            // ProjFlag
  element: Uint8Array;           // ElementId index +1, 0 = none
  critChance: Float32Array;
  blast: Float32Array;           // explosion radius, 0 = none
  cause: Int32Array;             // event id that launched it (kill-chain parent)
  lastHit: Int32Array;           // last enemy index hit (avoid double hits)
  hitMask: Uint32Array;          // small bloom filter of hit enemy indices for pierce
  // --- WP1 additions ------------------------------------------------------
  tag: Uint16Array;              // interned srcTag id (World.tagId / tagName)
  critMul: Float32Array;         // crit damage multiplier (e.g. ballistics.crit_damage)
  retention: Float32Array;       // fraction of damage kept per pierce
  pierceSpeed: Float32Array;     // fractional velocity gain per pierce
  bounceRange: Float32Array;     // ricochet search radius
  knock: Float32Array;           // knockback units per hit (0 = none)
  execBonus: Float32Array;       // bonus damage fraction vs enemies below 30% HP
  pierced: Uint8Array;           // enemies pierced so far
  /** WP3 addition: hardpoint-private per-projectile bits (seeker steering, retargets, wells passed, linkage marks); see systems/hardpoints/common.ts. */
  hpBits: Uint32Array;
}
export const enum ProjFlag { Crit = 1 << 0, Homing = 1 << 1, Manual = 1 << 2, Marked = 1 << 3, CrossedBeam = 1 << 4, CrossedBlade = 1 << 5, Lensed = 1 << 6, Echo = 1 << 7, FromDrone = 1 << 8, Hostile = 1 << 9, Duplicate = 1 << 10, Cluster = 1 << 11,
  /** WP1 additions */ LastRites = 1 << 12, ReturnFire = 1 << 13, Stagger = 1 << 14, Dead = 1 << 15 }

// ---------------------------------------------------------------------------
// Tower, systems, and status of the run
// ---------------------------------------------------------------------------
export interface TowerState {
  hp: number; maxHp: number;
  shield: number; maxShield: number;   // Bastion shield
  barrier: number; maxBarrier: number; // Aegis Outer Barrier
  tempHp: number;                      // Fortification
  invulnT: number;                     // ticks
  secondCoreUsed: boolean;             // per wave
  ce: number; ceCap: number;           // Command Energy meter
  aimAngle: number;                    // current primary aim
  manualAim: boolean; manualAngle: number;
  designated: number; designatedGen: number;
  designated2: number; designated2Gen: number;   // Second Opinion / Commander
  lowHpTicks: number;
}

export interface Hazard {
  kind: 'fire_zone' | 'toxic_cloud' | 'ice_patch' | 'plasma_line' | 'shell_zone' | 'firestorm' | 'enemy_hazard' | 'time_field' | 'barrier_field';
  x: number; y: number; x2?: number; y2?: number; radius: number; life: number; dps: number; element?: ElementId; cause: number; owner: WeaponSystemId | 'enemy' | 'ability';
  /** WP2 addition: damage srcTag for attribution (e.g. 'fusion.plasma'); default element ?? owner. */
  srcTag?: string;
}

// ---------------------------------------------------------------------------
// Build and progression state
// ---------------------------------------------------------------------------
export interface BuildState {
  frame: FrameId;
  hardpoints: (HardpointId | null)[];         // slot order; null = slot open but unfilled
  attunements: (ElementId | null)[];
  doctrines: Partial<Record<TreeId, DoctrineId>>;
  /** Second doctrine from Dual Doctrine / Spare Barrel / Monolith / Bulwark, keyed by tree. */
  secondDoctrines: Partial<Record<TreeId, DoctrineId>>;
  ranks: Record<NodeId, number>;               // purchased ranks per node id
  anomalies: AnomalyId[];                      // socketed
  anomalySockets: number;
  targeting: Partial<Record<WeaponSystemId, TargetingProfile>>;
  abilities: (AbilityId | null)[];             // tactical slots
}

export type RunMode = 'push' | 'patrol';
export type RunPhase = 'between' | 'combat' | 'dead' | 'wave_clear' | 'draft';

export interface RunState {
  prestigeSeed: number;
  wave: number;                 // current wave (1-based)
  checkpoint: number;           // last cleared boss wave (0, 5, 10 ...)
  deepestCleared: number;       // deepest wave cleared this Prestige
  clearedWaves: number;         // bitset-ish: waves cleared this prestige (for first-clear ×3), stored as array of 0/1
  firstClears: Uint8Array;      // index = wave
  mode: RunMode;
  phase: RunPhase;
  phaseTicks: number;           // ticks spent in the current phase
  tick: number;                 // sim tick since Prestige start
  attemptTick: number;          // tick since this attempt started
  waveTick: number;             // tick since this wave started
  scrap: number;
  cores: number;
  coresDroppedByBoss: Uint8Array;  // per boss wave, first-kill Core paid
  threatDial: number;
  attempts: number;             // attempts this Prestige
  attemptsPerCheckpoint: number[]; // index checkpoint/5
  prestigeStartedAt: number;    // real seconds (save-side wall clock, only for Forecast; never read by sim math)
  playSeconds: number;          // accumulated simulated seconds (ticks / 60)
  echoRateHistory: { seconds: number; echoes: number; /** WP8: deepest wave cleared at the sample */ wave?: number }[];
  pendingDraft: AnomalyId[] | null;
  /** Wave whose draft is pending (rerolls stay reproducible), and further draft waves waiting behind it. */
  draftWave: number; draftQueue: number[];
  anomaliesOfferedAt: Uint8Array; // per wave/10
  hardpointSlotsOpen: number;
  attunementSlotsOpen: number;
  speedMultiplier: 1 | 2 | 4 | 8;
  patrolScrapPerSecond: number; // measured, for offline estimate
  longestChain: number;
  /** Scrap spent per tree/system this Prestige (Refit refunds 60% of the removed system's spend). */
  spentByTree: Record<string, number>;
  // --- WP8 additions (progression; all optional, saved by save/serialize.ts) ---
  /** Blueprint plan: systems/elements mounted automatically as slots open (in order). */
  plannedHardpoints?: HardpointId[];
  plannedAttunements?: ElementId[];
  /** Blueprint plan: doctrines chosen automatically when each tree's fork opens. */
  plannedDoctrines?: Partial<Record<TreeId, DoctrineId>>;
  /** Lowest Threat Dial level used this Prestige (Echoes pay at this level). */
  minThreatDial?: number;
  /** Branch Discount: the tree chosen at Prestige start (−25%). */
  discountTree?: TreeId | null;
  /** playSeconds at the first reach of each checkpoint (index = checkpoint / 5), for the Reclimb estimate. */
  checkpointSeconds?: number[];
  // --- UX-review additions ---
  /**
   * Tower damage taken this attempt by source (after armor/resistance, before shield/barrier): an enemy kind,
   * 'boss' (the boss and its clones/adds scripted by it), 'hazard', 'self' (own Anomalies) or 'enemy' (unknown
   * shooter). Reset at every attempt start; never saved (live combat is never saved).
   */
  attemptDamageTaken: Record<string, number>;
  /** True once patrolScrapPerSecond was measured in Patrol (until then Push clears estimate it). Saved. */
  patrolMeasured?: boolean;
  /** The last few non-boss Push clears (Scrap without the first-clear bonus, seconds incl. phase overhead) for the Patrol estimate. Not saved. */
  recentClears?: { wave: number; scrap: number; seconds: number }[];
}

export interface MetaState {
  echoes: number;
  stars: number;
  prestigeCount: number;
  ascension: number;
  deepestEver: number;
  totalPlaySeconds: number;
  prestigeRanks: Record<NodeId, number>;      // Prestige layer nodes (prestige.*)
  constellation: Record<NodeId, number>;      // Constellation nodes (star.*)
  unlockedFrames: FrameId[];
  codex: Record<string, number>;               // entry id -> first discovery count (>0 = discovered)
  trials: Partial<Record<TrialId, number>>;    // tiers completed 0..3
  blueprints: Blueprint[];
  directives: Directive[];
  upgradeQueue: UpgradeRule[];
  keepsake: AnomalyId | null;
  records: { deepestWave: number; longestChain: number; fastestWave100Seconds: number | null };
  settings: { clarity: number; autoPrestige: boolean };
  // --- WP8 additions (optional) ---
  /** The main run, parked while a Trial runs (run/trials.ts). */
  parkedRun?: RunSave;
  /** The Trial being played (World.trial reads this), or null. */
  activeTrial?: TrialId | null;
  /** checkpointSeconds of the previous Prestige (Forecast reclimb estimate). */
  lastRunCheckpointSeconds?: number[];
  /** Palettes unlocked by Codex milestones (e.g. 'palette.10'). */
  palettes?: string[];
}

export interface Blueprint {
  name: string; frame: FrameId; hardpoints: HardpointId[]; attunements: ElementId[];
  doctrines: Partial<Record<TreeId, DoctrineId>>; targeting: Partial<Record<WeaponSystemId, TargetingProfile>>; upgradeQueue: UpgradeRule[];
}

export interface UpgradeRule { node: NodeId; keepWithin?: { of: NodeId; ranks: number }; maxRank?: number }

/** Directive: WHEN conditions AND ... → DO action. Checked in priority order. */
export interface Directive {
  enabled: boolean;
  conditions: DirectiveCondition[];
  action: DirectiveAction;
}
export type DirectiveCondition =
  | { kind: 'inner_ring_at_least'; n: number }
  | { kind: 'group_at_least'; n: number; radius: number }
  | { kind: 'tower_hp_below'; pct: number }
  | { kind: 'barrier_broken' }
  | { kind: 'boss_phase'; phase: number }
  | { kind: 'boss_tell_active' }                 // Adept
  | { kind: 'enemy_present'; enemy: EnemyKind | 'elite' }
  | { kind: 'ce_at_least'; ce: number }
  | { kind: 'wave_is'; which: 'boss' | 'ordinary' }
  | { kind: 'forecast_recommends' };
export type DirectiveAction =
  | { kind: 'cast'; ability: AbilityId; at: 'largest_group' | 'nearest_threat' | 'boss' | 'tower' }
  | { kind: 'designate'; what: 'highest_threat' | 'healer' | 'warden' | 'weak_point' | 'nearest_kamikaze' }
  | { kind: 'targeting'; system: WeaponSystemId; profile: TargetingProfile }
  | { kind: 'mode'; mode: RunMode }
  | { kind: 'prestige' };

// ---------------------------------------------------------------------------
// Commands (UI/agents → sim). All player intent goes through here.
// ---------------------------------------------------------------------------
export type Command =
  | { type: 'buy'; node: NodeId }                         // one rank of a Scrap node (or Core node)
  | { type: 'choose_doctrine'; tree: TreeId; doctrine: DoctrineId;
      /** WP8 addition: explicitly choose the tree's SECOND doctrine (Dual Doctrine, Spare Barrel, Monolith, Bulwark, Singularity Core). */ second?: boolean }
  | { type: 'mount_hardpoint'; slot: number; system: HardpointId }
  | { type: 'refit_hardpoint'; slot: number; system: HardpointId }
  | { type: 'attune'; slot: number; element: ElementId }
  | { type: 'pick_anomaly'; anomaly: AnomalyId | null; replace?: number }  // null = skip (1 Core)
  | { type: 'reroll_anomaly' }
  | { type: 'set_mode'; mode: RunMode }
  | { type: 'restart_checkpoint' }
  | { type: 'set_speed'; speed: 1 | 2 | 4 | 8 }
  | { type: 'designate'; enemy: number | null; slot?: 0 | 1;
      /** WP9 addition: issued by a Directive (not a human). */ viaDirective?: boolean }
  /** Integration addition: designate the live enemy nearest (x, y) within max(24, radius + 8) units (UI taps). */
  | { type: 'designate_at'; x: number; y: number; slot?: 0 | 1 }
  | { type: 'manual_aim'; active: boolean; angle: number }
  | { type: 'cast'; ability: AbilityId; x: number; y: number; target?: number;
      /** WP9/WP5 addition: issued by a Directive or Autocast (Counters earn directives.counter_efficiency). */ viaDirective?: boolean;
      /** WP9 addition: index of the issuing Directive in meta.directives (-1 = Autocast). */ directive?: number }
  | { type: 'set_ability_slot'; slot: number; ability: AbilityId | null }
  | { type: 'set_targeting'; system: WeaponSystemId; profile: TargetingProfile }
  | { type: 'prestige'; frame: FrameId; blueprint?: number; threatDial?: number;
      /** WP8 additions: Keepsake Anomaly to keep (must be socketed), Branch Discount tree. */ keepsake?: AnomalyId; discountTree?: TreeId }
  | { type: 'ascend' }
  | { type: 'buy_prestige'; node: NodeId }
  | { type: 'buy_star'; node: NodeId }
  | { type: 'set_directives'; directives: Directive[] }
  | { type: 'set_upgrade_queue'; rules: UpgradeRule[] }
  | { type: 'save_blueprint'; blueprint: Blueprint }
  | { type: 'start_trial'; trial: TrialId }
  | { type: 'end_trial' }
  | { type: 'set_threat_dial'; level: number }
  | { type: 'offline_return'; elapsedSeconds: number }
  | { type: 'set_setting'; key: keyof MetaState['settings']; value: number | boolean };

// ---------------------------------------------------------------------------
// Events (sim → everyone). Every event carries a cause for the kill chain.
// ---------------------------------------------------------------------------
export const enum Ev {
  WaveStart, WaveClear, BossPhase, BossTell, BossCounter, BossKilled,
  Spawn, Hit, Kill, Explosion, StatusApply, StatusTick, Fusion, Triad, Linkage, Infusion, Anomaly,
  TowerHit, TowerDeath, BarrierBreak, SecondCore, Cast, CounterScored, Heal,
  Purchase, DoctrineChosen, Mounted, Attuned, AnomalyPicked, CoreDrop, ScrapGain,
  Checkpoint, AttemptStart, Prestige, Ascend, Fx, Codex, Chain,
}

export interface SimEvent {
  id: number;            // monotonically increasing within a Prestige
  tick: number;
  type: Ev;
  cause: number;         // parent event id, or -1
  /** Source system / element / fusion / linkage / ability tag, e.g. 'ballistics', 'fire', 'fusion.plasma', 'link.blade+laser'. */
  src: string;
  a: number; b: number;  // event-specific numerics (enemy index, damage, stacks, wave, phase...)
  x: number; y: number;  // position for FX and the Inspector
  /** Optional structured payload; keep small. */
  data?: Record<string, number | string | boolean>;
  /** Extra numeric (not hashed): Hit/Kill = enemy state bits (see core/events.ts StateBit); StatusApply = status index | stateBits<<8. */
  c?: number;
}

/** Ring buffer of recent events plus a hash of the whole stream (determinism test). */
export interface EventLog {
  push(e: Omit<SimEvent, 'id'>): number;   // returns new event id
  recent(sinceTick: number): SimEvent[];
  byId(id: number): SimEvent | undefined;
  hash(): number;                          // rolling FNV over (type, tick, a|0, b|0, src)
  nextId: number;
}

// ---------------------------------------------------------------------------
// Snapshots for the renderer and UI (sim → main thread)
// ---------------------------------------------------------------------------
/**
 * aux1 of the layer-7 Ring the snapshot draws around each live designated (gen-checked) or Hunter-marked
 * enemy (core/snapshot.ts). The field overlay (app/overlay.ts) enlarges exactly these to a thumb-sized reticle.
 */
export const RETICLE_MARK = 1;

export const enum Shape { Circle = 0, Ring = 1, Triangle = 2, Square = 3, Diamond = 4, Hex = 5, Star = 6, Capsule = 7, Line = 8, Shard = 9, Cross = 10, Crescent = 11 }

/**
 * Instance stream, 12 floats per instance:
 *  [x, y, radius, rotation, shape, r, g, b, alpha, layer, aux0, aux1]
 * layer follows the draw order in design §20: 0 arena, 1 hazards, 2 player fx, 3 projectiles,
 * 4 enemies, 5 enemy outlines, 6 threat halos, 7 ui-in-world. aux carries e.g. hp fraction,
 * beam end x/y for Line shapes (aux0=x2, aux1=y2 with radius = thickness).
 */
export const INSTANCE_FLOATS = 12;

export interface RenderSnapshot {
  tick: number;
  instances: Float32Array;   // INSTANCE_FLOATS * instanceCount
  instanceCount: number;
  /** FX spawn requests since the last snapshot: [kind, x, y, r, g, b, size, count] repeated. */
  fx: Float32Array; fxCount: number;
  cameraShake: number;
  clarity: number;
}
export const FX_FLOATS = 8;
export const enum FxKind { Hit = 0, Kill = 1, Explosion = 2, Spark = 3, Ember = 4, Frost = 5, Toxic = 6, Arc = 7, Shockwave = 8, Muzzle = 9, Trail = 10, Text = 11, Counter = 12, Tell = 13 }

/** Everything the UI draws from, sent ~10 Hz. Plain JSON, no typed arrays. */
export interface UiState {
  tick: number;
  run: Pick<RunState, 'wave' | 'checkpoint' | 'deepestCleared' | 'mode' | 'phase' | 'scrap' | 'cores' | 'attempts' | 'threatDial' | 'speedMultiplier' | 'playSeconds' | 'pendingDraft' | 'hardpointSlotsOpen' | 'attunementSlotsOpen' | 'longestChain'
    /* integration additions */ | 'patrolScrapPerSecond' | 'minThreatDial' /* UX-review additions */ | 'attemptDamageTaken'> & {
  };
  /** Integration additions: the Trial being played (meta.activeTrial), or null. */
  activeTrial: TrialId | null;
  /** Wave whose clear opens the next hardpoint / attunement slot (run/slots.ts), or null when no more can open. */
  nextHardpointWave: number | null;
  nextAttunementWave: number | null;
  /** Highest speed multiplier allowed on the current wave (Accelerated Clearing / Speed Controls; 1 = none). */
  speedAllowed: 1 | 2 | 4 | 8;
  tower: Pick<TowerState, 'hp' | 'maxHp' | 'shield' | 'maxShield' | 'barrier' | 'maxBarrier' | 'tempHp' | 'ce' | 'ceCap'>;
  build: BuildState;
  meta: MetaState;
  wave: { sector: string; isBoss: boolean; bossId: BossId | null; bossPhase: number; bossHp: number; bossMaxHp: number; bossPhaseMarks: number[]; tellActive: AbilityId | 'designate' | null; tellTicksLeft: number; enemiesAlive: number; enemiesTotal: number; spawned: number; formation: FormationId | null; progress: number; weakPointOpen: boolean };
  shop: ShopEntry[];             // every currently visible node with price and affordability
  abilities: { id: AbilityId; cost: number; cooldown: number; ready: boolean }[];
  forecast: Forecast | null;
  stats: DamageShare;
  hints: string[];               // Codex hints for undiscovered nearby entries
  wallGaugeSeconds: number | null;
  recentEvents: SimEvent[];      // for the event feed / Inspector (last ~2 s)
}

export interface ShopEntry {
  node: NodeId; tree: TreeId | 'link' | 'infuse' | 'fusion' | 'ability' | 'exotic' | 'frame' | 'slot';
  name: string; desc: string; rank: number; maxRank: number;
  cost: number; currency: 'scrap' | 'cores'; affordable: boolean;
  kind: 'stat' | 'mechanic' | 'exotic' | 'doctrine' | 'linkage' | 'infusion' | 'fusion' | 'ability';
  locked?: string;               // reason it can't be bought yet (doctrine not chosen, checkpoint only...)
  tier: number;
}

export interface Forecast {
  echoesNow: number;
  echoRate: number;          // per hour
  peakRate: number;
  nextBossEchoes: number; nextBossRate: number;
  reclimbSeconds: number;
  wallGaugeSeconds: number | null;
  recommended: boolean;
  curve: { seconds: number; rate: number }[];
}

export interface DamageShare { bySource: Record<string, number>; total: number; windowSeconds: number }

// ---------------------------------------------------------------------------
// Save state
// ---------------------------------------------------------------------------
export const SAVE_VERSION = 1;
export interface SaveState {
  version: number;
  savedAtMs: number;             // wall clock, main-thread only
  meta: MetaState;
  run: RunSave;                  // current run, restorable to the start of the current checkpoint
  trial: { id: TrialId; run: RunSave } | null;
}
/** Persisted subset of a run: enough to rebuild at the checkpoint. Live combat is never saved. */
export interface RunSave {
  prestigeSeed: number; wave: number; checkpoint: number; deepestCleared: number; firstClears: number[];
  mode: RunMode; scrap: number; cores: number; coresDroppedByBoss: number[]; threatDial: number; attempts: number;
  attemptsPerCheckpoint: number[]; prestigeStartedAt: number; playSeconds: number; echoRateHistory: { seconds: number; echoes: number; wave?: number }[];
  anomaliesOfferedAt: number[]; hardpointSlotsOpen: number; attunementSlotsOpen: number; patrolScrapPerSecond: number; longestChain: number;
  build: BuildState;
  prngState: [number, number, number, number];
  /** WP1 addition: Scrap spent per tree (Refit refunds). Optional for old saves. */
  spentByTree?: Record<string, number>;
  /** WP8 additions (see RunState). */
  plannedHardpoints?: HardpointId[]; plannedAttunements?: ElementId[]; plannedDoctrines?: Partial<Record<TreeId, DoctrineId>>;
  minThreatDial?: number; discountTree?: TreeId | null; checkpointSeconds?: number[];
  /** UX-review addition (see RunState.patrolMeasured). */
  patrolMeasured?: boolean;
  /** Code-health addition: an Anomaly draft offered but not yet picked (restored on load; it was lost before). */
  pendingDraft?: AnomalyId[];
  draftWave?: number; draftQueue?: number[];
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------
export type ToWorker =
  | { t: 'init'; save: SaveState | null; seedOverride?: number }
  | { t: 'cmd'; cmd: Command }
  | { t: 'run'; running: boolean }
  | { t: 'tick_budget'; ticks: number }     // main thread paces the sim: run up to N ticks now
  | { t: 'want_snapshot' }
  | { t: 'want_save' }
  | { t: 'inspector'; enemyIndex: number; gen: number }
  | { t: 'set_clarity'; value: number }
  /** WP1 addition: hand transferred snapshot buffers back to the worker for reuse (double buffering). */
  | { t: 'return_buffer'; instances: Float32Array; fx: Float32Array };
export type FromWorker =
  | { t: 'ready'; ui: UiState }
  | { t: 'snapshot'; snap: RenderSnapshot }
  | { t: 'ui'; ui: UiState }
  | { t: 'events'; events: SimEvent[] }
  | { t: 'save'; save: SaveState }
  | { t: 'inspector'; chain: SimEvent[]; sentence: string }
  | { t: 'error'; message: string; /** integration addition */ stack?: string }
  /** Integration addition: a player command was rejected (message from the sim). */
  | { t: 'cmd_error'; message: string; cmd: Command['type'] };

// ---------------------------------------------------------------------------
// Waves (generator → run). Fixed per Prestige seed: generateWave(seed, wave, dial, ascension).
// ---------------------------------------------------------------------------
export interface SpawnEntry {
  tick: number;                 // ticks after wave start
  kind: EnemyKind;
  angle: number;                // spawn angle on the perimeter (radians)
  radiusOffset: number;         // 0 = on the perimeter; >0 spawns farther out (delayed ambush uses <0 for burrowers)
  elite: EliteModifier[];       // empty for ordinary enemies
  hpScale: number;              // multiplier from Threat Dial / elite / clump merging (1 = none)
  formationSlot: number;        // index into the formation's path for this enemy
  lane: number;
}
export interface WaveDef {
  wave: number;
  sector: string;
  isBoss: boolean;
  bossId: BossId | null;
  formation: FormationId | null;   // bosses: escort formation for adds, or null
  threatBudget: number;
  spawns: SpawnEntry[];            // sorted by tick
  /** Formation motion parameters the AI reads to steer enemies along the script. */
  params: { lanes: number; spread: number; tempo: number; radialSpeed: number; rotation: number; escortRatio: number };
  durationTicks: number;           // spawn window; the wave ends when spawns are done and enemies are dead
}
