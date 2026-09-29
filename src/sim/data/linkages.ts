/**
 * Linkages (design §8). Cross-system rules that appear only when both halves are
 * present; 3 ranks each. The primary weapon counts as always mounted.
 *  - Weapon Linkages:  `link.${a}+${b}` with a before b in SYSTEM_ORDER_IDS
 *                      (primary, ordnance, drones, blade, laser, gravitics)
 *  - Chassis Linkages: `chassis.${bastion|reactor}+${hardpoint}`
 * Each node's rank-scaled magnitude is the stat key equal to its node id.
 */
import type { HardpointId, WeaponSystemId } from '../core/ids';
import type { LinkageDef } from './schema';
import { fx, mech } from './builders';

/** Weapon linkages involve a hardpoint, so they carry the ×1.5 hardpoint scale on [600, 2400, 9600]. */
const WEAPON_LINK_COST = [900, 3600, 14400];
/** Chassis linkages: one hardpoint and a chassis tree, ×1.25. */
const CHASSIS_LINK_COST = [750, 3000, 12000];

function weapon(a: WeaponSystemId, b: WeaponSystemId, name: string, desc: string, nodeDesc: string, perRank: number): LinkageDef {
  const id = `link.${a}+${b}`;
  return { id, name, desc, pair: [a, b], node: mech(id, name, nodeDesc, 1, WEAPON_LINK_COST, [fx(id, 'add', perRank)], { tags: ['linkage'] }) };
}
function chassis(c: 'bastion' | 'reactor', hp: HardpointId, name: string, desc: string, nodeDesc: string, perRank: number): LinkageDef {
  const id = `chassis.${c}+${hp}`;
  return { id, name, desc, pair: [c, hp], node: mech(id, name, nodeDesc, 1, CHASSIS_LINK_COST, [fx(id, 'add', perRank)], { tags: ['linkage'] }) };
}

export const WEAPON_LINKAGES: LinkageDef[] = [
  weapon('primary', 'ordnance', 'Shell Casing',
    'Crits mark targets; missiles at marked targets gain crit chance.',
    'Primary crits Mark their target for 3 s. Missiles striking a Marked enemy gain +10% crit chance per rank and use the primary\'s crit damage.', 0.1),
  weapon('primary', 'drones', 'Wingman',
    'Drones copy the primary\'s on-hit effects at 30% strength.',
    'Drone hits copy the primary\'s on-hit effects (element procs, Execution, Static) at 30% strength, +10% per rank after the first.', 0.1),
  weapon('primary', 'blade', 'Whetstone',
    'Shots crossing the blade\'s arc gain +1 pierce; crits briefly speed the blade.',
    'Shots crossing the blade\'s arc gain +1 pierce. Primary crits speed the blade by 5% per rank for 1 s (stacking up to 5 times).', 0.05),
  weapon('primary', 'laser', 'Energized Rounds',
    'Shots crossing a beam gain damage and the beam\'s Infusion.',
    'Shots crossing a laser beam gain +10% damage per rank and carry every Infusion on the Laser Polygon.', 0.1),
  weapon('primary', 'gravitics', 'Slingshot',
    'Shots curve toward wells and gain damage per well passed.',
    'Shots curve toward gravity wells within 80 units and gain +8% damage per rank for each well they pass.', 0.08),
  weapon('ordnance', 'drones', 'Spotter',
    'Drone hits designate missile targets; missile kills spawn a microdrone.',
    'Drone hits Spot their target for 2 s, and missiles prefer Spotted enemies. Missile kills have a 10% chance per rank to spawn a microdrone for 5 s.', 0.1),
  weapon('ordnance', 'blade', 'Shrapnel Sweep',
    'Blade hits on enemies caught in explosions deal bonus damage.',
    'Blade hits on enemies caught in an explosion within the last 1 s deal +15% damage per rank.', 0.15),
  weapon('ordnance', 'laser', 'Charged Warheads',
    'Missiles crossing an edge split on impact.',
    'Missiles that cross a laser beam split on impact into 2 extra warheads, each dealing 30% per rank of the missile\'s damage.', 0.3),
  weapon('ordnance', 'gravitics', 'Payload Well',
    'Explosions inside a well gain radius per captured enemy.',
    'Explosions inside a gravity well gain +5% radius per rank for each enemy the well holds (up to +100%).', 0.05),
  weapon('drones', 'blade', 'Escort Blades',
    'Drones carry miniature orbital blades.',
    'Each drone carries a miniature orbital blade (16-unit radius) that deals 15% per rank of blade damage and applies blade on-hit effects.', 0.15),
  weapon('drones', 'laser', 'Mobile Vertex',
    'Drones act as temporary laser nodes.',
    'Every 6 s, 1 drone per rank becomes a laser node for 3 s, joining the polygon with beams to its two nearest nodes.', 1),
  weapon('drones', 'gravitics', 'Gravity Assist',
    'Drones slingshot around wells, gaining speed and damage.',
    'Drones passing within a gravity well slingshot around it, gaining +10% speed and damage per rank for 2 s.', 0.1),
  weapon('blade', 'laser', 'Vertex Strike',
    'The blade passing a node triggers a Vertex Blast.',
    'When the blade sweeps past a laser node, that node fires a Vertex Blast at 40% per rank strength (once per node every 2 s). Works without the Vertex Blast Exotic.', 0.4),
  weapon('blade', 'gravitics', 'Undertow',
    'Blade damage rises against enemies inside wells.',
    'Blade hits deal +12% damage per rank to enemies held in a gravity well.', 0.12),
  weapon('laser', 'gravitics', 'Bent Light',
    'Beams curve through wells, extending coverage.',
    'Beams passing within a gravity well bend through its center, sweeping an arc up to 10% per rank of the well\'s radius wider, and deal +5% damage per rank while bent.', 0.1),
];

export const CHASSIS_LINKAGES: LinkageDef[] = [
  chassis('bastion', 'ordnance', 'Counterbattery',
    'Barrier breaks launch a missile volley.',
    'When the shield or Outer Barrier breaks, the rack launches a volley of 4 missiles per rank at the nearest enemies.', 4),
  chassis('bastion', 'drones', 'Recharge Circuit',
    'Drone kills restore shield.',
    'Each drone kill restores 1% per rank of shield capacity.', 0.01),
  chassis('bastion', 'blade', 'Kinetic Loop',
    'Shield hits briefly speed the blade.',
    'Each hit the shield or barrier absorbs speeds the blade by 8% per rank for 1 s (stacking up to 5 times).', 0.08),
  chassis('bastion', 'laser', 'Refraction Lens',
    'Beams thicken while the barrier holds.',
    'While the shield or Outer Barrier holds any charge, beams are 10% per rank wider.', 0.1),
  chassis('bastion', 'gravitics', 'Safe Harbor',
    'A defensive well spawns when the inner ring gets crowded.',
    'When 6 or more enemies are inside the inner ring, a defensive well forms around the tower, pushing outward. Cooldown 16 s, −2 s per rank.', 2),
  chassis('reactor', 'ordnance', 'Hot Loading',
    'Kills during Critical Mass reload a launcher.',
    'While Critical Mass is active, each kill has a 10% chance per rank to instantly reload a launcher.', 0.1),
  chassis('reactor', 'drones', 'Sync Burst',
    'Synchronization combos give drones a speed burst.',
    'Combos that include a drone hit give every drone +10% per rank speed and attack speed for 2 s.', 0.1),
  chassis('reactor', 'blade', 'Flywheel',
    'Blade rotation counts as attack speed for Overclock.',
    'Global attack speed and Overclock bonuses apply to blade rotation at 40% strength per rank (120% at rank 3).', 0.4),
  chassis('reactor', 'laser', 'Pulse Clock',
    'Pulse cadence scales with global attack speed.',
    'Laser Pulse cadence scales with global attack speed at 33% strength per rank (99% at rank 3).', 0.33),
  chassis('reactor', 'gravitics', 'Event Loop',
    'Well cooldown drops per enemy captured.',
    'Each enemy a well captures cuts that well\'s next cooldown by 0.1 s per rank (up to 50%).', 0.1),
];
