/**
 * Infusions (design §8): one node per attuned element in each mounted hardpoint
 * tree, 3 ranks each. The primary weapon takes elements natively.
 * Node ids `infuse.${system}.${element}`; each node's rank-scaled magnitude is the
 * stat key equal to its node id.
 */
import type { ElementId, HardpointId } from '../core/ids';
import type { InfusionDef } from './schema';
import { fx, mech } from './builders';

/** Infusions live in hardpoint trees: [600, 2400, 9600] × 1.5. */
const INFUSION_COST = [900, 3600, 14400];

function infuse(system: HardpointId, element: ElementId, name: string, desc: string, nodeDesc: string, perRank: number): InfusionDef {
  const id = `infuse.${system}.${element}`;
  return { id, system, element, name, desc, node: mech(id, name, nodeDesc, 1, INFUSION_COST, [fx(id, 'add', perRank)], { tags: ['infusion', element] }) };
}

export const INFUSIONS: InfusionDef[] = [
  // Ordnance
  infuse('ordnance', 'fire', 'Napalm Craters', 'Craters burn.',
    'Missile explosions leave a burning crater for 2 s that applies 1 Burn stack per second per rank to enemies inside.', 1),
  infuse('ordnance', 'lightning', 'Arc Warheads', 'Blasts arc to 3 enemies.',
    'Missile explosions arc to 3 enemies outside the blast, each arc dealing 25% per rank of the explosion\'s damage.', 0.25),
  infuse('ordnance', 'poison', 'Toxic Payload', 'Blasts leave toxic clouds.',
    'Missile explosions leave a toxic cloud for 3 s that applies 1 Poison stack per second per rank to enemies inside.', 1),
  infuse('ordnance', 'frost', 'Cryo Shells', 'Blasts leave ice patches.',
    'Missile explosions leave an ice patch for 3 s that applies 1 Chill stack per second per rank to enemies crossing it.', 1),
  // Drones
  infuse('drones', 'fire', 'Incendiary Rounds', 'Incendiary rounds.',
    'Drone shots have a 10% chance per rank to apply Burn.', 0.1),
  infuse('drones', 'lightning', 'Relay Shock', 'Hits arc to the nearest drone\'s target.',
    'Drone hits have a 15% chance per rank to arc to the target of the nearest other drone.', 0.15),
  infuse('drones', 'poison', 'Stingers', 'Stingers apply stacks.',
    'Drone shots apply 0.25 Poison stacks per rank on average.', 0.25),
  infuse('drones', 'frost', 'Frostbite Rounds', 'Hits Chill.',
    'Drone shots have a 15% chance per rank to apply Chill.', 0.15),
  // Blade
  infuse('blade', 'fire', 'Burning Edge', 'The blade leaves fire trails.',
    'The blade leaves a fire trail along its tip for 0.6 s that applies 1 Burn stack per rank to enemies it touches (once per enemy per pass).', 1),
  infuse('blade', 'lightning', 'Arc Edge', 'The blade arcs on contact.',
    'Blade hits have a 20% chance per rank to arc lightning to nearby enemies.', 0.2),
  infuse('blade', 'poison', 'Venom Edge', 'Hits apply stacks; kills contaminate the blade.',
    'Blade hits apply 1 Poison stack per rank. A kill contaminates the blade for 2 s, doubling the stacks it applies.', 1),
  infuse('blade', 'frost', 'Rime Edge', 'Hits Chill; frozen hits shatter.',
    'Blade hits apply 1 Chill stack per rank. Hitting a frozen enemy shatters the ice for 50% bonus damage.', 1),
  // Laser
  infuse('laser', 'fire', 'Ignition Beam', 'Beams ignite.',
    'Enemies touching a beam gain 1 Burn stack per rank each second.', 1),
  infuse('laser', 'lightning', 'Arc Vertices', 'Vertices arc outward.',
    'Every second, each laser node arcs to the nearest enemy within 100 units for 30% per rank of beam damage.', 0.3),
  infuse('laser', 'poison', 'Toxic Beam', 'Beams apply stacks each second.',
    'Enemies touching a beam gain 1 Poison stack per rank each second.', 1),
  infuse('laser', 'frost', 'Frost Beam', 'Beams slow; the interior frosts over time.',
    'Enemies touching a beam gain 1 Chill stack per rank each second, and enemies inside the polygon gain 1 Chill stack every 2 s.', 1),
  // Gravitics
  infuse('gravitics', 'fire', 'Firestorm Well', 'Wells become firestorms.',
    'Wells burn their captives: 1 Burn stack per rank each second while held.', 1),
  infuse('gravitics', 'lightning', 'Storm Well', 'Wells arc between captives.',
    'Every 0.5 s each well arcs between 1 pair of captives per rank for full arc damage.', 1),
  infuse('gravitics', 'poison', 'Toxic Vortex', 'Wells become toxic vortices.',
    'Wells poison their captives: 1 Poison stack per rank each second while held.', 1),
  infuse('gravitics', 'frost', 'Cryo Collapse', 'Wells freeze captives on collapse.',
    'Collapsing wells apply 2 Chill stacks per rank to their captives; at rank 3 they freeze solid for 1 s (bosses excluded).', 2),
];
