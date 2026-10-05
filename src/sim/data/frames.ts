/**
 * Frames (design §4): chosen at Prestige start; each sets hardpoint and
 * attunement caps and one trait. Hard rule: no build mounts more than four
 * hardpoint systems, free mounts included. Effects apply as rank 1; trait penalties use `@final`
 * keys (core/stats.ts) so "primary damage −25%" and "half rate" hold however many upgrade ranks are bought.
 *
 * Flags the build/run code must honor:
 *   hardpoint_discount_15     hardpoint-tree Scrap costs ×0.85 (Arsenal)
 *   statuses_plus_one         every status application adds +1 stack (Conductor)
 *   fusions_start_rank1       every unlocked Fusion starts at rank 1 for free (Conductor)
 *   two_barrel_doctrines      Ballistics runs two Barrel Doctrines, both at full strength (Monolith)
 *   drones_free               Drones occupy no slot; mounted at Prestige start (Hive)
 *   drone_cap_plus_50         drone cap ×1.5 (Hive)
 *   two_bastion_doctrines     Bastion runs two Doctrines at full strength (Bulwark)
 *   retaliation_scales_armor  Retaliation damage × (1 + armor / 100) (Bulwark)
 *   every_8th_repeats         every 8th primary shot, missile salvo and drone shot repeats (Echo Engine;
 *                             the blade, beams and wells attack continuously and have no "8th attack")
 *   laser_free                Laser Polygon occupies no slot; mounted at Prestige start (Prism)
 *   beams_all_elements        beams carry every attuned element's Infusion (Prism)
 *   dual_doctrine_all         every tree may run a second Doctrine (Singularity Core)
 *   enemy_hp_plus_50          enemy HP ×1.5 (Singularity Core)
 */
import type { FrameDef } from './schema';
import { fx } from './builders';

export const FRAMES: FrameDef[] = [
  {
    id: 'standard', name: 'Standard', unlock: 'Available from the start',
    hardpointCap: 3, attunementCap: 2,
    trait: 'No modifiers; the baseline.',
    effects: [], flags: [],
  },
  {
    id: 'arsenal', name: 'Arsenal', unlock: 'Echo tier II: Frames',
    hardpointCap: 4, attunementCap: 1,
    trait: 'Hardpoint trees cost 15% less; primary damage −25%.',
    effects: [fx('ballistics.damage@final', 'mul', -0.25)], flags: ['hardpoint_discount_15'],
  },
  {
    id: 'conductor', name: 'Conductor', unlock: 'Echo tier II: Frames',
    hardpointCap: 2, attunementCap: 3,
    trait: 'Statuses apply +1 stack; Fusions start at rank 1.',
    effects: [], flags: ['statuses_plus_one', 'fusions_start_rank1'],
  },
  {
    id: 'monolith', name: 'Monolith', unlock: 'Trial: Bare Metal',
    hardpointCap: 1, attunementCap: 2,
    trait: 'The primary runs two Barrel Doctrines at full strength.',
    effects: [], flags: ['two_barrel_doctrines'],
  },
  {
    id: 'hive', name: 'Hive', unlock: 'Trial: Hive Mind',
    hardpointCap: 2, attunementCap: 2, freeMount: 'drones',
    trait: 'Drones mounted free; drone cap +50%; the primary fires at half rate.',
    effects: [fx('ballistics.attack_speed@final', 'mul', -0.5)], flags: ['drones_free', 'drone_cap_plus_50'],
  },
  {
    id: 'bulwark', name: 'Bulwark', unlock: 'Trial: Siege Mentality',
    hardpointCap: 3, attunementCap: 2,
    trait: 'Bastion runs two Doctrines; Retaliation scales with armor.',
    effects: [], flags: ['two_bastion_doctrines', 'retaliation_scales_armor'],
  },
  {
    id: 'echo_engine', name: 'Echo Engine', unlock: 'Ascension I',
    hardpointCap: 3, attunementCap: 2,
    trait: 'Every 8th shot of the primary, the missile rack and each drone repeats.',
    effects: [], flags: ['every_8th_repeats'],
  },
  {
    id: 'prism', name: 'Prism', unlock: 'Ascension III',
    hardpointCap: 3, attunementCap: 2, freeMount: 'laser',
    trait: 'Laser Polygon mounted free; beams carry every attuned element.',
    effects: [], flags: ['laser_free', 'beams_all_elements'],
  },
  {
    id: 'singularity_core', name: 'Singularity Core', unlock: 'Ascension V',
    hardpointCap: 4, attunementCap: 4,
    trait: 'Dual Doctrine in every tree; enemies +50% HP.',
    effects: [], flags: ['dual_doctrine_all', 'enemy_hp_plus_50'],
  },
];
