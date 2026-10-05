/**
 * Content schema. All trees, doctrines, nodes, fusions, linkages, infusions,
 * anomalies, abilities, frames, enemies, bosses and formations are DATA in
 * src/sim/data/*.ts conforming to these types. Systems read the data; the shop
 * UI and the simulator agents read the same data, so content is defined once.
 *
 * Pricing conventions (design §17):
 *  - stat nodes: cost(rank) = base * growth^rank, growth in [1.15, 1.22]
 *  - mechanic nodes: flat cost per tier; tiers rise ×8 within a tree (tier 0..3)
 *  - exotic nodes: 2 Cores (Core-priced, one per tree)
 *  - linkages / infusions / fusions: 3 ranks, stat-style pricing
 */
import type {
  AbilityId, AnomalyId, AnomalyRarity, BoonCategory, BoonId, BoonRarity, BossId, DoctrineId, ElementId, EnemyKind,
  FormationId, FrameId, FusionId, HardpointId, NodeId, SectorId, TreeId, TriadId, TrialId, WeaponSystemId,
} from '../core/ids';

/** Stat keys the resolver produces. Systems read derived stats by key. Add freely; keep names `${tree}.${stat}`. */
export type StatKey = string;

export type StatOp = 'add' | 'mul' | 'set';
export interface StatEffect { stat: StatKey; op: StatOp; perRank: number }

export type NodeKind = 'stat' | 'mechanic' | 'exotic';

export interface NodeDef {
  id: NodeId;                    // `${tree}.${name}`
  name: string;
  desc: string;                  // player-facing; may use {v} for the per-rank value
  kind: NodeKind;
  maxRank: number;               // stat nodes: 20–50; mechanics: 1–5; exotics: 1
  /** Stat pricing: base * growth^rank. Mechanic pricing: flat cost array by rank (or tier). */
  cost: { base: number; growth: number } | { flat: number[] } | { cores: number };
  tier: 0 | 1 | 2 | 3;           // 0 = base, 1 = below fork, 2 = doctrine, 3 = capstone/exotic
  effects: StatEffect[];         // may be empty for pure mechanics (systems check ranks by id)
  /** Nodes required (any rank) before this shows in the shop. */
  requires?: NodeId[];
  /** If set, only visible when this doctrine is chosen in its tree. */
  doctrine?: DoctrineId;
  /** If set, only visible with this ability slotted (ability rank nodes). */
  ability?: AbilityId;
  /** Tags used by agents and the Codex ("mechanical", "economy", "defense", "speed"). */
  tags?: string[];
}

export interface DoctrineDef {
  id: DoctrineId;
  tree: TreeId;
  name: string;
  identity: string;
  capstone: NodeId;              // the capstone node id (kind mechanic, tier 3)
  nodes: NodeDef[];              // doctrine-specific nodes incl. capstone
}

export interface TreeDef {
  id: TreeId;
  name: string;
  category: 'chassis' | 'element' | 'hardpoint';
  shared: NodeDef[];             // base + shared late nodes (tiers 0–1)
  doctrines: DoctrineDef[];      // 2–4 mutually exclusive
  exotic: NodeDef;               // costs 2 Cores
  /** Number of shared nodes with rank ≥ 1 needed before the fork opens. */
  forkRequirement: number;
}

export interface FrameDef {
  id: FrameId; name: string; unlock: string;
  hardpointCap: number; attunementCap: number;
  freeMount?: HardpointId;       // Hive: drones; Prism: laser (counts toward the 4 hard cap)
  trait: string;
  effects: StatEffect[];         // e.g. arsenal: {stat:'ballistics.damage', op:'mul', perRank:-0.25}
  flags: string[];               // 'statuses_plus_one', 'fusions_start_rank1', 'two_barrel_doctrines', ...
}

export interface FusionDef { id: FusionId; name: string; elements: [ElementId, ElementId]; desc: string; node: NodeDef }
export interface TriadDef { id: TriadId; name: string; elements: [ElementId, ElementId, ElementId]; desc: string; node: NodeDef }

export interface LinkageDef {
  id: NodeId;                    // `link.${a}+${b}` with a<b in SYSTEM_ORDER, or `chassis.${bastion|reactor}+${hp}`
  name: string; desc: string;
  pair: [WeaponSystemId | 'bastion' | 'reactor', WeaponSystemId];
  node: NodeDef;                 // 3 ranks
}

export interface InfusionDef { id: NodeId; system: HardpointId; element: ElementId; name: string; desc: string; node: NodeDef }

/**
 * What an offer (boon, Anomaly) names that the unlock ladder reveals later: 'abilities' (tactical abilities, Command
 * Energy, designators: best wave ≥ ABILITIES_REVEAL_WAVE or a Prestige) or an element / hardpoint (in the content pool
 * at the current Prestige count, or owned). Offers give weight 0 to anything unrevealed. `needs` entries that are
 * elements / hardpoints are pool-gated the same way.
 */
export type OfferReveal = 'abilities' | HardpointId | ElementId;

export interface AnomalyDef {
  id: AnomalyId; name: string; rarity: AnomalyRarity; desc: string;
  /** Systems/elements this Anomaly needs to matter; drafts weight toward the current build. */
  needs?: (HardpointId | ElementId | 'primary')[];
  /** Reveal gate (data/content-pool.ts): offered only once these were shown on the unlock ladder (see OfferReveal). */
  reveal?: OfferReveal[];
  effects: StatEffect[];
  pool: 'base' | 'echo' | 'rot' | 'paradox_extra' | 'mythic';
}

/**
 * Boon (data/boons.ts): an attempt-scoped reward. Stat boons resolve through `effects` (rank 1, next to
 * Anomalies in core/stats.ts); mechanical boons carry a `flag` that systems/boons.ts switches on (their
 * tunables are BOON_TUNING in data/boons.ts). `desc` and `short` state the numbers exactly as implemented.
 */
export interface BoonDef {
  id: BoonId; name: string; desc: string;
  /** One line for the offer's mini-card (≤ about 34 characters, with the numbers). */
  short: string;
  category: BoonCategory; rarity: BoonRarity;
  /** Systems / elements this boon needs to matter ('fusion' = any Fusion active); offers weight toward the build. */
  needs?: (HardpointId | ElementId | 'fusion')[];
  /** Reveal gate (data/content-pool.ts): offered only once these were shown on the unlock ladder (see OfferReveal). */
  reveal?: OfferReveal[];
  effects: StatEffect[];
  /** Mechanic key read by systems/boons.ts (mechanical boons only). */
  flag?: BoonId;
  /** Declared value 1..5 (the headless agents' pick heuristic; not used by the sim). */
  value: number;
}

export interface AbilityDef {
  id: AbilityId; name: string; cost: number; desc: string;
  radius: number; duration: number;      // seconds; 0 if instant
  cooldown: number;                       // seconds; abilities are CE-gated but have a short cooldown
  targeted: 'point' | 'enemy' | 'self';
  rankNode: NodeDef;                      // 3-rank node in the Reactor tree
}

export interface EnemyDef {
  kind: EnemyKind; name: string; sector: SectorId | 'sub';
  hpMul: number;                 // k in EnemyHP(w) = 10 * 1.13^w * k
  speed: number;                 // units/s
  radius: number;
  armor: number;
  shieldMul: number;             // fraction of hp as shield (0 = none)
  scrapMul: number;              // k in ScrapPerKill(w)
  threat: number;                // Threat Budget cost
  contactDamage: number;         // damage to tower per hit at wave 1 (scaled ×1.06^w)
  behavior: 'advance' | 'swarm' | 'runner' | 'kamikaze' | 'ranged' | 'support' | 'charger' | 'phase' | 'burrower' | 'anchor' | 'aura';
  auraRadius?: number;
  flags: string[];               // maps to EnemyFlag bits at spawn
  shape: number;                 // Shape enum for the renderer
  color: [number, number, number];
  desc: string;
}

export interface BossPhaseDef {
  hpFraction: number;            // phase begins when hp <= fraction
  name: string;
  attacks: string[];             // attack script ids implemented in enemies/bosses/*.ts
  weakPoint?: { angle: number; radius: number; exposedSeconds: number };
}
export interface BossDef {
  id: BossId; name: string; wave: number; tests: string;
  hpMul: number;                 // multiplier on BossHP(w) = 12 * EnemyHP(w)
  radius: number; speed: number; armor: number; shieldMul: number;
  phases: BossPhaseDef[];        // finales have 3
  tell: { name: string; counter: AbilityId | 'designate'; windowSeconds: number; everySeconds: number; desc: string };
  adds?: { kind: EnemyKind; perPhase: number }[];
  shape: number; color: [number, number, number];
  desc: string;
}

export interface FormationParams { lanes: number; spread: number; tempo: number; radialSpeed: number; rotation: number; escortRatio: number }
export interface FormationDef {
  id: FormationId; name: string; desc: string;
  /** Shape class used by the counter map and Difficulty Multiplier tables. */
  shapeClass: 'ring' | 'spiral' | 'spokes' | 'crescent' | 'wedge' | 'column' | 'flower' | 'comet' | 'concentric' | 'burst' | 'serpentine' | 'escort' | 'scatter' | 'pincer' | 'artillery' | 'wall' | 'ambush' | 'rush' | 'cluster' | 'lanes';
  minWave: number;
  flatness: number;              // 0..1; waves before a boss draw from the flattest templates
  spatial?: boolean;             // Ascension III additions
  defaults: FormationParams;
  /** Difficulty Multiplier per archetype (median across bands), seeded from design and refined by the simulator. */
  difficulty: Record<string, number>;
}

export interface SectorDef { id: SectorId; name: string; waves: [number, number]; introduces: EnemyKind[]; palette: { bg: [number, number, number]; fg: [number, number, number]; accent: [number, number, number] } }

export interface TrialDef { id: TrialId; name: string; constraint: string; reward: string; tiers: [number, number, number] }

export interface PrestigeNodeDef extends NodeDef { layer: 1 | 2 | 3 | 4 }
export interface StarNodeDef extends NodeDef { region: number; kind2: 'major' | 'bridge' | 'minor'; bridgeOf?: [TreeId, TreeId] }
