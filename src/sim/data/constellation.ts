/**
 * The Constellation (design §15). Stars (earned by Ascending) buy nodes in a
 * glowing graph that survives everything. Major nodes are systems, Bridges
 * between majors are cross-system rules (the Singularity nodes), and minor nodes
 * are numbers. Each Ascension reveals a new region; respec is free at the moment
 * of Ascending.
 *
 * Region 0 (Ascension I) ships here. Later regions append to STAR_NODES with
 * region 1, 2, …; bridge ids are `star.bridge.${a}+${b}` with a before b in
 * SYSTEM_ORDER_IDS (primary, ordnance, drones, blade, laser, gravitics).
 *
 * Stars income for reference: floor(4 × (1 + A) × 1.1^(D − 100)) → 8 on the first
 * Ascension at D = 100, so region 0 costs ~60 Stars to fill.
 */
import type { TreeId } from '../core/ids';
import type { StarNodeDef, StatEffect } from './schema';

const e = (stat: string, op: StatEffect['op'], perRank: number): StatEffect => ({ stat, op, perRank });

function major(system: string, tree: TreeId, name: string, desc: string, effects: StatEffect[]): StarNodeDef {
  return {
    id: `star.major.${system}`, name, desc, kind: 'mechanic', maxRank: 3, cost: { flat: [2, 4, 8] }, tier: 2,
    effects, region: 0, kind2: 'major', tags: ['constellation', tree],
  };
}
function bridge(a: string, b: string, of: [TreeId, TreeId], name: string, desc: string): StarNodeDef {
  return {
    id: `star.bridge.${a}+${b}`, name, desc, kind: 'mechanic', maxRank: 1, cost: { flat: [10] }, tier: 3,
    effects: [e(`star.bridge.${a}+${b}`, 'add', 1)], requires: [`star.major.${a}`, `star.major.${b}`],
    region: 0, kind2: 'bridge', bridgeOf: of, tags: ['constellation', 'singularity'],
  };
}
function minor(id: string, name: string, desc: string, effects: StatEffect[]): StarNodeDef {
  return {
    id: `star.minor.${id}`, name, desc, kind: 'stat', maxRank: 10, cost: { base: 1, growth: 1.3 }, tier: 0,
    effects, region: 0, kind2: 'minor', tags: ['constellation'],
  };
}

export const STAR_NODES: StarNodeDef[] = [
  // Region 0 — Ascension I ------------------------------------------------
  // Majors: one per weapon system.
  major('primary', 'ballistics', 'The Gunner', '+10% primary damage and +2% crit chance per rank.',
    [e('ballistics.damage', 'mul', 0.1), e('ballistics.crit_chance', 'add', 0.02)]),
  major('ordnance', 'ordnance', 'The Rack', '+10% missile damage and +5% blast radius per rank.',
    [e('ordnance.damage', 'mul', 0.1), e('ordnance.blast_radius', 'mul', 0.05)]),
  major('drones', 'drones', 'The Swarm', '+10% drone damage and +5% drone attack speed per rank.',
    [e('drones.damage', 'mul', 0.1), e('drones.attack_speed', 'mul', 0.05)]),
  major('blade', 'blade', 'The Scythe', '+10% blade damage and +5 blade length per rank.',
    [e('blade.damage', 'mul', 0.1), e('blade.length', 'add', 5)]),
  major('laser', 'laser', 'The Polygon', '+10% beam damage and +0.5 beam width per rank.',
    [e('laser.damage', 'mul', 0.1), e('laser.beam_width', 'add', 0.5)]),
  major('gravitics', 'gravitics', 'The Well', '+10% pull strength and +5 well radius per rank.',
    [e('gravitics.pull', 'mul', 0.1), e('gravitics.radius', 'add', 5)]),

  // Bridges: Singularity nodes (design §15), each between two majors.
  bridge('primary', 'laser', ['ballistics', 'laser'], 'Focal Reactor',
    'Enemies dying inside the polygon charge a central beam; at 20 charges the primary fires it through its target for 10× primary damage.'),
  bridge('ordnance', 'drones', ['ordnance', 'drones'], 'Deployment Charge',
    'Missile explosions spawn a temporary drone for 4 s (up to 6 at once).'),
  bridge('ordnance', 'laser', ['ordnance', 'laser'], 'Prism Battery',
    'Laser intersections spawn missiles: where two beams cross, a missile launches at the nearest enemy every 1.5 s.'),

  // Minors: numbers.
  minor('firepower', 'Firepower', '+2% damage from every source per rank.', [e('combat.power_mul', 'mul', 0.02)]),
  minor('salvage', 'Starlit Salvage', '+3% Scrap from every source per rank.', [e('economy.scrap_mul', 'add', 0.03)]),
  minor('hull', 'Star-Forged Hull', '+3% max HP per rank.', [e('bastion.max_hp', 'mul', 0.03)]),
  minor('command', 'Wide Command', '+5 Command Energy cap per rank.', [e('economy.ce_cap', 'add', 5)]),
];
