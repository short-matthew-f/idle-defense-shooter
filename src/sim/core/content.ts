/**
 * Content index for the core: lookups over src/sim/data/index.ts (the ONLY content import),
 * with built-in fallbacks so the sim runs while the data tables are still empty:
 *  - a minimal Ballistics / Bastion / Reactor tree (stat keys = node ids, see data/base-stats.ts)
 *  - a grunt-like EnemyDef for any kind missing from ENEMIES, and a generic boss.
 * The index is built lazily on first use; `invalidateContent()` rebuilds it (tests).
 */
import type { EnemyKind, BossId, TreeId, FrameId, EliteModifier, ElementId, HardpointId } from './ids';
import type { TreeDef, NodeDef, EnemyDef, BossDef, FrameDef, AbilityDef, AnomalyDef, BoonDef } from '../data/schema';
import {
  TREES, FRAMES, FUSIONS, TRIADS, WEAPON_LINKAGES, CHASSIS_LINKAGES, INFUSIONS, ANOMALIES, ABILITIES, BOONS,
  ENEMIES, BOSSES, PRESTIGE_NODES, STAR_NODES,
} from '../data/index';
import { EnemyFlag, Shape } from './types';

/** Stable enemy-kind order stored in EnemyPool.kind (matches data/enemies.ts KINDS; append only). */
export const KIND_LIST: EnemyKind[] = [
  'grunt', 'swarm', 'runner', 'brute', 'kamikaze', 'shielded',
  'splitter', 'carrier', 'healer', 'leech', 'veteran',
  'armored', 'warden', 'artillery', 'charger', 'anchor',
  'phase', 'burrower', 'nullifier', 'refractor',
  'jammer',
  'splitter_fragment', 'brood', 'clump', 'boss_add',
  'boss',
];
export const BOSS_LIST: BossId[] = [
  'breaker', 'broodheart', 'warden', 'siege_engine', 'iron_maw',
  'mirror_hive', 'storm_crown', 'distant_saint', 'leech_queen', 'splinter_king',
  'null_engine', 'chronophage', 'hive_fortress', 'redline', 'grave_battery',
  'event_horizon', 'architect', 'choir', 'last_procession', 'crown', 'deep_graft',
];
export const ELITE_LIST: EliteModifier[] = [
  'hardened', 'swift', 'regenerating', 'shielded_elite', 'volatile', 'phasing',
  'splitting', 'anchored', 'jamming', 'refracting', 'vampiric', 'commanding',
];
export const CHASSIS_TREES: TreeId[] = ['ballistics', 'bastion', 'reactor'];
export const ELEMENT_TREES: ElementId[] = ['fire', 'lightning', 'poison', 'frost'];
export const HARDPOINT_TREES: HardpointId[] = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];

const KIND_INDEX_MAP = new Map<string, number>(KIND_LIST.map((k, i) => [k, i]));
export function kindIndex(kind: string): number { return KIND_INDEX_MAP.get(kind) ?? 0; }
export function bossIndex(id: string | null | undefined): number { return id ? BOSS_LIST.indexOf(id as BossId) : -1; }

/** EnemyDef.flags / behavior names → EnemyFlag bits (case-insensitive). */
const FLAG_BITS: Record<string, number> = {
  elite: EnemyFlag.Elite, boss: EnemyFlag.Boss, immovable: EnemyFlag.Immovable, phased: EnemyFlag.Phased,
  burrowed: EnemyFlag.Burrowed, refracts: EnemyFlag.Refracts, jams: EnemyFlag.Jams, nullifies: EnemyFlag.Nullifies,
  shielder: EnemyFlag.Shielder, healer: EnemyFlag.Healer, kamikaze: EnemyFlag.Kamikaze, ranged: EnemyFlag.Ranged,
  support: EnemyFlag.Support, weakpointopen: EnemyFlag.WeakPointOpen, reviving: EnemyFlag.Reviving,
  clump: EnemyFlag.Clump, ally: EnemyFlag.Ally, anchor: EnemyFlag.Immovable,
};
export function flagBitsFor(def: EnemyDef): number {
  let bits = 0;
  for (const f of def.flags) bits |= FLAG_BITS[f.toLowerCase()] ?? 0;
  if (def.behavior === 'kamikaze') bits |= EnemyFlag.Kamikaze;
  if (def.behavior === 'anchor') bits |= EnemyFlag.Immovable;
  if (def.behavior === 'ranged') bits |= EnemyFlag.Ranged;
  return bits & ~EnemyFlag.Dead;
}

// ---------------------------------------------------------------------------
// Fallback content
// ---------------------------------------------------------------------------
const st = (id: string, name: string, op: 'add' | 'mul', perRank: number, base: number, growth: number, maxRank: number, tier: 0 | 1 | 2 = 0, doctrine?: NodeDef['doctrine']): NodeDef =>
  ({ id, name, desc: name, kind: 'stat', maxRank, cost: { base, growth }, tier, effects: [{ stat: id, op, perRank }], ...(doctrine ? { doctrine } : {}) });
const mech = (id: string, name: string, prices: number[], tier: 1 | 2 | 3, perRank = 1, doctrine?: NodeDef['doctrine']): NodeDef =>
  ({ id, name, desc: name, kind: 'mechanic', maxRank: prices.length, cost: { flat: prices }, tier, effects: [{ stat: id, op: 'add', perRank }], ...(doctrine ? { doctrine } : {}) });
const exo = (id: string, name: string): NodeDef => ({ id, name, desc: name, kind: 'exotic', maxRank: 1, cost: { cores: 2 }, tier: 3, effects: [] });

export const FALLBACK_TREES: Partial<Record<TreeId, TreeDef>> = {
  ballistics: {
    id: 'ballistics', name: 'Ballistics', category: 'chassis', forkRequirement: 3,
    shared: [
      st('ballistics.damage', 'Caliber', 'mul', 0.08, 10, 1.17, 40),
      st('ballistics.attack_speed', 'Autoloader', 'mul', 0.05, 12, 1.17, 40),
      st('ballistics.range', 'Long Barrel', 'add', 10, 15, 1.18, 25),
      st('ballistics.projectile_speed', 'Muzzle Velocity', 'mul', 0.06, 8, 1.16, 25),
      st('ballistics.crit_chance', 'Fire Control', 'add', 0.01, 20, 1.19, 35),
      st('ballistics.crit_damage', 'Hollow Points', 'add', 0.1, 25, 1.19, 35),
      st('ballistics.target_acquisition', 'Target Acquisition', 'add', 0.05, 12, 1.17, 20),
      mech('ballistics.execution', 'Execution', [150, 450, 1350], 1, 0.15),
    ],
    doctrines: [
      { id: 'multishot', tree: 'ballistics', name: 'Multishot', identity: 'More projectiles', capstone: 'ballistics.multishot.split_sight', nodes: [
        mech('ballistics.multishot.count', 'Extra Barrels', [1200, 3600, 10800, 32400], 2, 1, 'multishot'),
        st('ballistics.multishot.penalty', 'Barrel Harmonics', 'add', -0.015, 200, 1.18, 20, 2, 'multishot'),
        mech('ballistics.multishot.split_sight', 'Split Sight', [9600], 3, 1, 'multishot'),
      ] },
      { id: 'piercing', tree: 'ballistics', name: 'Piercing', identity: 'Penetration', capstone: 'ballistics.piercing.last_rites', nodes: [
        mech('ballistics.piercing.count', 'Penetrator Core', [1200, 3600, 10800, 32400], 2, 1, 'piercing'),
        st('ballistics.piercing.retention', 'Sabot Jacket', 'add', 0.02, 200, 1.18, 20, 2, 'piercing'),
        st('ballistics.piercing.velocity', 'Slipstream', 'add', 0.03, 200, 1.18, 20, 2, 'piercing'),
        mech('ballistics.piercing.last_rites', 'Last Rites', [9600], 3, 1, 'piercing'),
      ] },
      { id: 'ricochet', tree: 'ballistics', name: 'Ricochet', identity: 'Bounces', capstone: 'ballistics.ricochet.return_fire', nodes: [
        mech('ballistics.ricochet.bounces', 'Rebound Rounds', [1200, 3600, 10800, 32400], 2, 1, 'ricochet'),
        st('ballistics.ricochet.range', 'Deflector Geometry', 'add', 8, 200, 1.18, 20, 2, 'ricochet'),
        mech('ballistics.ricochet.return_fire', 'Return Fire', [9600], 3, 1, 'ricochet'),
      ] },
      { id: 'heavy_rounds', tree: 'ballistics', name: 'Heavy Rounds', identity: 'Slow, huge rounds', capstone: 'ballistics.heavy.staggerhead', nodes: [
        st('ballistics.heavy.damage', 'Depleted Core', 'mul', 0.06, 200, 1.18, 25, 2, 'heavy_rounds'),
        st('ballistics.heavy.size', 'Wide Bore', 'mul', 0.04, 200, 1.18, 20, 2, 'heavy_rounds'),
        st('ballistics.heavy.knockback', 'Impact Mass', 'add', 4, 200, 1.18, 20, 2, 'heavy_rounds'),
        mech('ballistics.heavy.staggerhead', 'Staggerhead', [9600], 3, 1, 'heavy_rounds'),
      ] },
    ],
    exotic: exo('ballistics.gunstorm', 'Gunstorm'),
  },
  bastion: {
    id: 'bastion', name: 'Bastion', category: 'chassis', forkRequirement: 3,
    shared: [
      st('bastion.max_hp', 'Hull Plating', 'add', 15, 10, 1.16, 40),
      st('bastion.armor', 'Composite Armor', 'add', 2, 15, 1.17, 35),
      st('bastion.shield_capacity', 'Shield Emitter', 'add', 10, 20, 1.17, 35),
      st('bastion.shield_recharge', 'Capacitor Bank', 'add', 1, 20, 1.18, 30),
      st('bastion.regeneration', 'Nanite Weave', 'add', 0.4, 15, 1.17, 35),
      st('bastion.resistance', 'Ablative Coating', 'add', 0.01, 25, 1.19, 35),
    ],
    doctrines: [],
    exotic: exo('bastion.second_core', 'Second Core'),
  },
  reactor: {
    id: 'reactor', name: 'Reactor', category: 'chassis', forkRequirement: 3,
    shared: [
      st('reactor.global_attack_speed', 'Clock Multiplier', 'mul', 0.03, 30, 1.19, 30),
      st('reactor.cooldown_reduction', 'Heat Sinks', 'add', 0.01, 25, 1.18, 30),
      st('reactor.energy_recycling', 'Energy Recycling', 'add', 0.05, 20, 1.18, 25),
    ],
    doctrines: [],
    exotic: exo('reactor.critical_mass', 'Critical Mass'),
  },
};

const AMBER: [number, number, number] = [1, 0.72, 0.22];
function fallbackEnemy(kind: EnemyKind): EnemyDef {
  const base: EnemyDef = {
    kind, name: kind, sector: 'outskirts', hpMul: 1, speed: 40, radius: 9, armor: 0, shieldMul: 0, scrapMul: 1, threat: 1,
    contactDamage: 8, behavior: 'advance', flags: [], shape: Shape.Triangle, color: AMBER, desc: 'Fallback enemy.',
  };
  switch (kind) {
    case 'swarm': return { ...base, hpMul: 0.3, speed: 55, radius: 5, scrapMul: 0.3, contactDamage: 3, behavior: 'swarm', shape: Shape.Circle };
    case 'runner': return { ...base, hpMul: 0.7, speed: 90, radius: 7, scrapMul: 0.7, contactDamage: 5, behavior: 'runner', shape: Shape.Shard };
    case 'brute': return { ...base, hpMul: 4, speed: 25, radius: 16, armor: 10, scrapMul: 4, contactDamage: 20, shape: Shape.Square };
    case 'kamikaze': return { ...base, hpMul: 0.8, speed: 70, radius: 8, scrapMul: 0.8, contactDamage: 30, behavior: 'kamikaze', flags: ['Kamikaze'], shape: Shape.Star };
    case 'clump': return { ...base, radius: 18, shape: Shape.Hex, color: [1, 0.86, 0.46], sector: 'sub' };
    case 'boss': return { ...base, hpMul: 12, speed: 18, radius: 40, armor: 20, scrapMul: 20, contactDamage: 40, flags: ['Boss'], shape: Shape.Star, color: [1, 0.24, 0.24], sector: 'sub' };
    default: return base;
  }
}
export function fallbackBoss(id: BossId, wave: number): BossDef {
  return {
    id, name: id, wave, tests: 'basic', hpMul: 1, radius: 34, speed: 20, armor: 0, shieldMul: 0,
    phases: [{ hpFraction: 1, name: 'Phase 1', attacks: [] }],
    tell: { name: 'none', counter: 'repulsor_pulse', windowSeconds: 1.2, everySeconds: 12, desc: '' },
    shape: Shape.Hex, color: [1, 0.3, 0.25], desc: 'Fallback boss.',
  };
}
const FALLBACK_FRAME: FrameDef = { id: 'standard', name: 'Standard', unlock: 'Start', hardpointCap: 3, attunementCap: 2, trait: 'Baseline', effects: [], flags: [] };

// ---------------------------------------------------------------------------
// Node index
// ---------------------------------------------------------------------------
export type NodeGroup = 'tree' | 'fusion' | 'triad' | 'link' | 'chassis_link' | 'infuse' | 'ability' | 'prestige' | 'star';
export interface NodeInfo {
  def: NodeDef;
  group: NodeGroup;
  tree?: TreeId;                // tree nodes
  shared?: boolean;             // below-fork shared node
  exotic?: boolean;
  doctrine?: string;            // doctrine node
  elements?: ElementId[];       // fusions / triads / infusions
  pair?: [string, string];      // linkages
  system?: HardpointId;         // infusions
  ability?: string;             // ability rank nodes
}

interface Index {
  trees: TreeDef[];
  treeById: Map<string, TreeDef>;
  nodes: Map<string, NodeInfo>;
  nodeOrder: NodeInfo[];
  enemyByIndex: EnemyDef[];
  bossById: Map<string, BossDef>;
  frameById: Map<string, FrameDef>;
  abilityById: Map<string, AbilityDef>;
  anomalyById: Map<string, AnomalyDef>;
}
let index: Index | null = null;

export function invalidateContent(): void { index = null; }

function build(): Index {
  const treeById = new Map<string, TreeDef>();
  for (const t of TREES) treeById.set(t.id, t);
  for (const id of CHASSIS_TREES) if (!treeById.has(id) && FALLBACK_TREES[id]) treeById.set(id, FALLBACK_TREES[id]!);
  const order: TreeId[] = [...CHASSIS_TREES, ...ELEMENT_TREES, ...HARDPOINT_TREES];
  const trees: TreeDef[] = [];
  for (const id of order) { const t = treeById.get(id); if (t) trees.push(t); }
  for (const t of TREES) if (!trees.includes(t)) trees.push(t);

  const nodes = new Map<string, NodeInfo>();
  const nodeOrder: NodeInfo[] = [];
  const add = (info: NodeInfo): void => {
    const prev = nodes.get(info.def.id);
    if (prev) return;       // first definition wins (ability rank nodes appear in Reactor and ABILITIES)
    nodes.set(info.def.id, info); nodeOrder.push(info);
  };
  for (const t of trees) {
    for (const n of t.shared) add(n.ability ? { def: n, group: 'ability', tree: t.id, shared: true, ability: n.ability } : { def: n, group: 'tree', tree: t.id, shared: true });
    for (const d of t.doctrines) for (const n of d.nodes) add({ def: n, group: 'tree', tree: t.id, doctrine: d.id });
    add({ def: t.exotic, group: 'tree', tree: t.id, exotic: true });
  }
  for (const f of FUSIONS) add({ def: f.node, group: 'fusion', elements: [...f.elements] });
  for (const f of TRIADS) add({ def: f.node, group: 'triad', elements: [...f.elements] });
  for (const l of WEAPON_LINKAGES) add({ def: l.node, group: 'link', pair: [l.pair[0], l.pair[1]] });
  for (const l of CHASSIS_LINKAGES) add({ def: l.node, group: 'chassis_link', pair: [l.pair[0], l.pair[1]] });
  for (const inf of INFUSIONS) add({ def: inf.node, group: 'infuse', system: inf.system, elements: [inf.element] });
  for (const a of ABILITIES) add({ def: a.rankNode, group: 'ability', ability: a.id, tree: 'reactor' });
  for (const p of PRESTIGE_NODES) add({ def: p, group: 'prestige' });
  for (const s of STAR_NODES) add({ def: s, group: 'star' });

  const byKind = new Map<string, EnemyDef>();
  for (const e of ENEMIES) byKind.set(e.kind, e);
  const enemyByIndex = KIND_LIST.map((k) => byKind.get(k) ?? fallbackEnemy(k));
  const bossById = new Map<string, BossDef>();
  for (const b of BOSSES) bossById.set(b.id, b);
  const frameById = new Map<string, FrameDef>();
  for (const f of FRAMES) frameById.set(f.id, f);
  const abilityById = new Map<string, AbilityDef>();
  for (const a of ABILITIES) abilityById.set(a.id, a);
  const anomalyById = new Map<string, AnomalyDef>();
  for (const a of ANOMALIES) anomalyById.set(a.id, a);
  return { trees, treeById, nodes, nodeOrder, enemyByIndex, bossById, frameById, abilityById, anomalyById };
}
function idx(): Index { return index ?? (index = build()); }

export function allTrees(): readonly TreeDef[] { return idx().trees; }
export function treeDef(id: string): TreeDef | undefined { return idx().treeById.get(id); }
export function nodeInfo(id: string): NodeInfo | undefined { return idx().nodes.get(id); }
export function allNodes(): readonly NodeInfo[] { return idx().nodeOrder; }
export function enemyDefByIndex(i: number): EnemyDef { return idx().enemyByIndex[i] ?? idx().enemyByIndex[0]; }
export function enemyDef(kind: string): EnemyDef { return enemyDefByIndex(kindIndex(kind)); }
export function bossDef(id: string | null | undefined, wave = 5): BossDef {
  const b = id ? idx().bossById.get(id) : undefined;
  return b ?? fallbackBoss((id ?? 'breaker') as BossId, wave);
}
export function bossDefByIndex(i: number, wave = 5): BossDef { return bossDef(i >= 0 ? BOSS_LIST[i] : null, wave); }
export function frameDef(id: FrameId | string): FrameDef { return idx().frameById.get(id) ?? (id === 'standard' ? FALLBACK_FRAME : { ...FALLBACK_FRAME, id: id as FrameId, name: id }); }
export function abilityDef(id: string): AbilityDef | undefined { return idx().abilityById.get(id); }
export function anomalyDef(id: string): AnomalyDef | undefined { return idx().anomalyById.get(id); }
export function allAnomalies(): readonly AnomalyDef[] { return ANOMALIES; }
export function allAbilities(): readonly AbilityDef[] { return ABILITIES; }
const BOON_BY_ID = new Map<string, BoonDef>(BOONS.map((b) => [b.id, b]));
export function boonDef(id: string): BoonDef | undefined { return BOON_BY_ID.get(id); }
export function allBoons(): readonly BoonDef[] { return BOONS; }
