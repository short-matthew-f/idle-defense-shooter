/**
 * Tactical abilities (design §10). Each ability is CE-gated with a short cooldown
 * and has a 3-rank node `ability.<id>` that lives in the Reactor tree's shared list
 * (see chassis.ts), visible only while the ability is slotted.
 *
 * Stat keys read by the abilities system (bases in base-stats.ts):
 *   ability.<id>.cost_mul   CE cost multiplier (base 1)          — every ability
 *   ability.<id>.<param>    the ability's rank-scaled parameter   — see each node
 */
import type { AbilityId } from '../core/ids';
import type { AbilityDef, NodeDef } from './schema';
import { flat, fx, mech } from './builders';

const rank = (id: AbilityId, name: string, desc: string, effects: ReturnType<typeof fx>[]): NodeDef =>
  mech(`ability.${id}`, name, desc, 1, flat(1, 3), effects, { ability: id, tags: ['active'] });

export const ABILITY_RANK_NODES: Record<AbilityId, NodeDef> = {
  hunter_mark: rank('hunter_mark', 'Hunter Mark: Deep Tag',
    'The marked enemy takes +25% more status application per rank (base +50%), and the mark lasts 2 s longer per rank.',
    [fx('ability.hunter_mark.status_bonus', 'add', 0.25), fx('ability.hunter_mark.duration', 'add', 2)]),
  repulsor_pulse: rank('repulsor_pulse', 'Repulsor Pulse: Overpressure',
    'The pulse shoves enemies 40 units farther per rank and reaches 15 units wider per rank.',
    [fx('ability.repulsor_pulse.force', 'add', 40), fx('ability.repulsor_pulse.radius', 'add', 15)]),
  time_field: rank('time_field', 'Time Field: Long Second',
    'The field lasts 1 s longer per rank.',
    [fx('ability.time_field.duration', 'add', 1)]),
  bombardment: rank('bombardment', 'Bombardment: Heavier Charge',
    'The charge deals +30% damage per rank and its blast grows 10 units per rank.',
    [fx('ability.bombardment.damage', 'mul', 0.3), fx('ability.bombardment.radius', 'add', 10)]),
  emp: rank('emp', 'EMP: Efficient Coils',
    'EMP costs 10% less Command Energy per rank and interrupts enemy abilities 0.5 s longer per rank.',
    [fx('ability.emp.cost_mul', 'add', -0.1), fx('ability.emp.duration', 'add', 0.5)]),
  overdrive: rank('overdrive', 'Overdrive: Redline',
    'Overdrive lasts 1 s longer per rank.',
    [fx('ability.overdrive.duration', 'add', 1)]),
  emergency_repair: rank('emergency_repair', 'Emergency Repair: Field Kit',
    'Emergency Repair costs 10% less Command Energy per rank and restores 5% more max HP per rank.',
    [fx('ability.emergency_repair.cost_mul', 'add', -0.1), fx('ability.emergency_repair.heal', 'add', 0.05)]),
  drone_surge: rank('drone_surge', 'Drone Surge: Deep Hangar',
    'Drone Surge launches 2 more expendable drones per rank.',
    [fx('ability.drone_surge.count', 'add', 2)]),
  missile_storm: rank('missile_storm', 'Missile Storm: Saturation',
    'Missile Storm fires 8 more homing missiles per rank.',
    [fx('ability.missile_storm.missiles', 'add', 8)]),
  singularity_bomb: rank('singularity_bomb', 'Singularity Bomb: Dense Core',
    'Singularity Bomb costs 10% less Command Energy per rank and its detonation deals +25% damage per rank.',
    [fx('ability.singularity_bomb.cost_mul', 'add', -0.1), fx('ability.singularity_bomb.damage', 'mul', 0.25)]),
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'hunter_mark', name: 'Hunter Mark', cost: 25, targeted: 'enemy',
    desc: 'Mark one enemy for 8 s: every system prioritizes it, and statuses applied to it gain +50% application.',
    radius: 0, duration: 8, cooldown: 4, rankNode: ABILITY_RANK_NODES.hunter_mark,
  },
  {
    id: 'repulsor_pulse', name: 'Repulsor Pulse', cost: 30, targeted: 'self',
    desc: 'A ring of force from the tower pushes every enemy within 160 units 180 units outward and cancels charges in progress.',
    radius: 160, duration: 0, cooldown: 5, rankNode: ABILITY_RANK_NODES.repulsor_pulse,
  },
  {
    id: 'time_field', name: 'Time Field', cost: 35, targeted: 'point',
    desc: 'Enemies inside a 110-unit field move at 20% speed for 6 s. Dashes and charges that enter it stall.',
    radius: 110, duration: 6, cooldown: 8, rankNode: ABILITY_RANK_NODES.time_field,
  },
  {
    id: 'bombardment', name: 'Bombardment', cost: 40, targeted: 'point',
    desc: 'After a 0.6 s fuse, a 90-unit explosive charge detonates anywhere in the arena for 25× primary damage.',
    radius: 90, duration: 0, cooldown: 6, rankNode: ABILITY_RANK_NODES.bombardment,
  },
  {
    id: 'emp', name: 'EMP', cost: 40, targeted: 'self',
    desc: 'Strips all shields within 220 units and interrupts enemy abilities, tethers and shield links for 3 s.',
    radius: 220, duration: 3, cooldown: 8, rankNode: ABILITY_RANK_NODES.emp,
  },
  {
    id: 'overdrive', name: 'Overdrive', cost: 45, targeted: 'self',
    desc: 'Every weapon system fires at ×2 attack speed for 5 s.',
    radius: 0, duration: 5, cooldown: 10, rankNode: ABILITY_RANK_NODES.overdrive,
  },
  {
    id: 'emergency_repair', name: 'Emergency Repair', cost: 50, targeted: 'self',
    desc: 'Instantly restores 30% of the tower\'s max HP.',
    radius: 0, duration: 0, cooldown: 12, rankNode: ABILITY_RANK_NODES.emergency_repair,
  },
  {
    id: 'drone_surge', name: 'Drone Surge', cost: 50, targeted: 'self',
    desc: 'Launches 6 expendable drones that fight for 10 s, then dive into the nearest enemy and explode.',
    radius: 0, duration: 10, cooldown: 10, rankNode: ABILITY_RANK_NODES.drone_surge,
  },
  {
    id: 'missile_storm', name: 'Missile Storm', cost: 60, targeted: 'point',
    desc: 'A swarm of 24 homing missiles pours over 4 s into enemies within 200 units of the target point.',
    radius: 200, duration: 4, cooldown: 10, rankNode: ABILITY_RANK_NODES.missile_storm,
  },
  {
    id: 'singularity_bomb', name: 'Singularity Bomb', cost: 70, targeted: 'point',
    desc: 'A collapsing point pulls every enemy within 150 units together for 2 s, then explodes for 40× primary damage.',
    radius: 150, duration: 2, cooldown: 12, rankNode: ABILITY_RANK_NODES.singularity_bomb,
  },
];
