/**
 * Fusions (design §6): unlock when both elements are attuned; 3 ranks each.
 * Triads (design §15, Ascension II): need three attuned elements; 3 ranks each.
 * Each node's rank-scaled magnitude is the stat key equal to its node id.
 */
import type { FusionDef, TriadDef } from './schema';
import { fx, mech } from './builders';

/** Fusion ranks: [600, 2400, 9600] Scrap. */
const FUSION_COST = [600, 2400, 9600];
/** Triad ranks (Ascension II content, priced for deep runs). */
const TRIAD_COST = [9600, 38400, 153600];

const fusionNode = (id: string, name: string, desc: string, perRank: number) =>
  mech(`fusion.${id}`, name, desc, 1, FUSION_COST, [fx(`fusion.${id}`, 'add', perRank)], { tags: ['fusion'] });
const triadNode = (id: string, name: string, desc: string, perRank: number) =>
  mech(`triad.${id}`, name, desc, 3, TRIAD_COST, [fx(`triad.${id}`, 'add', perRank)], { tags: ['triad'] });

export const FUSIONS: FusionDef[] = [
  {
    id: 'toxic_combustion', name: 'Toxic Combustion', elements: ['fire', 'poison'],
    desc: 'Burning a heavily poisoned enemy consumes its poison in an explosion.',
    node: fusionNode('toxic_combustion', 'Toxic Combustion',
      'Applying Burn to an enemy with 5+ Poison stacks consumes them: an 80-unit explosion deals their remaining poison damage ×1.5, +0.5 per rank after the first.', 0.5),
  },
  {
    id: 'superconductivity', name: 'Superconductivity', elements: ['lightning', 'frost'],
    desc: 'Arcs prefer chilled enemies and gain damage per chilled link.',
    node: fusionNode('superconductivity', 'Superconductivity',
      'Arcs jump to chilled enemies first and gain +15% damage per rank for each chilled enemy already in the chain.', 0.15),
  },
  {
    id: 'thermal_shock', name: 'Thermal Shock', elements: ['fire', 'frost'],
    desc: 'Fire on a heavily chilled enemy, or Frost on a burning one, bursts physical damage.',
    node: fusionNode('thermal_shock', 'Thermal Shock',
      'Burning an enemy with 4+ Chill stacks, or Chilling an enemy with 3+ Burn stacks, bursts for 100% per rank of the triggering hit as physical damage in 50 units. Once per enemy per second.', 1),
  },
  {
    id: 'electrolysis', name: 'Electrolysis', elements: ['lightning', 'poison'],
    desc: 'Arcs instantly deal a share of the target\'s pending poison.',
    node: fusionNode('electrolysis', 'Electrolysis',
      'Each arc that strikes a poisoned enemy instantly deals 15% per rank of its pending poison damage, without removing stacks.', 0.15),
  },
  {
    id: 'plasma', name: 'Plasma', elements: ['fire', 'lightning'],
    desc: 'Arcs through burning enemies leave a 1 s plasma line along their path.',
    node: fusionNode('plasma', 'Plasma',
      'An arc jumping from or to a burning enemy leaves a plasma line along its path for 1 s, dealing 20% per rank of arc damage per second to anything touching it.', 0.2),
  },
  {
    id: 'cryotoxin', name: 'Cryotoxin', elements: ['poison', 'frost'],
    desc: 'Poison on a frozen enemy is banked, then released at ×1.5 on thaw.',
    node: fusionNode('cryotoxin', 'Cryotoxin',
      'Poison damage dealt to a frozen enemy is banked instead; when it thaws, the bank releases at once at ×1.5, +0.25 per rank after the first.', 0.25),
  },
];

export const TRIADS: TriadDef[] = [
  {
    id: 'catalyst', name: 'Catalyst', elements: ['fire', 'lightning', 'poison'],
    desc: 'Any elemental proc may trigger the other two.',
    node: triadNode('catalyst', 'Catalyst',
      'Whenever a Burn, arc or Poison proc lands, there is a 10% chance per rank that the other two elements proc on the same enemy.', 0.1),
  },
  {
    id: 'polar_storm', name: 'Polar Storm', elements: ['fire', 'lightning', 'frost'],
    desc: 'Thermal Shock bursts arc as lightning.',
    node: triadNode('polar_storm', 'Polar Storm',
      'Thermal Shock bursts also arc as lightning to 1 enemy per rank, at full arc damage.', 1),
  },
  {
    id: 'crucible', name: 'Crucible', elements: ['fire', 'poison', 'frost'],
    desc: 'Thermal Shock bursts spread poison stacks.',
    node: triadNode('crucible', 'Crucible',
      'Thermal Shock bursts copy 2 Poison stacks per rank from the victim onto every enemy they hit.', 2),
  },
  {
    id: 'cold_circuit', name: 'Cold Circuit', elements: ['lightning', 'poison', 'frost'],
    desc: 'Arcs between chilled, poisoned enemies never decay.',
    node: triadNode('cold_circuit', 'Cold Circuit',
      'Arcs jumping between enemies that are both chilled and poisoned never lose damage per jump, and deal +10% damage per rank.', 0.1),
  },
];
