/**
 * Trials (design §16, unlocked at Prestige II). A Trial is a separate run slot;
 * the main run pauses. Three tiers: reach wave 30, 60 and 90 under the constraint.
 * Echo upgrades apply. (Which tier grants the reward is WP8's call; the design
 * lists one reward per Trial.)
 */
import type { TrialDef } from './schema';

const TIERS: [number, number, number] = [30, 60, 90];

export const TRIALS: TrialDef[] = [
  { id: 'bare_metal', name: 'Bare Metal', constraint: 'No hardpoints.', reward: 'Monolith frame', tiers: TIERS },
  { id: 'hive_mind', name: 'Hive Mind', constraint: 'Primary disabled; Drones is the only hardpoint.', reward: 'Hive frame', tiers: TIERS },
  { id: 'siege_mentality', name: 'Siege Mentality', constraint: 'Primary disabled; only the Orbital Blade and Bastion.', reward: 'Bulwark frame', tiers: TIERS },
  { id: 'monochrome', name: 'Monochrome', constraint: 'One attunement; no Fusions.', reward: '+1 stack cap for every element', tiers: TIERS },
  { id: 'blackout', name: 'Blackout', constraint: 'No abilities, designator, or manual aim.', reward: 'Autocast and Directive efficiency +10%', tiers: TIERS },
  { id: 'commander', name: 'Commander', constraint: 'No automatic primary fire; abilities cost 50% less.', reward: 'A permanent second designator', tiers: TIERS },
  { id: 'scatter', name: 'Scatter', constraint: 'Every wave uses spread formations.', reward: 'Gravitics Exotic costs no Cores', tiers: TIERS },
  { id: 'swarmstorm', name: 'Swarmstorm', constraint: 'Enemy count ×5, enemy HP ×0.2.', reward: 'Critical Mass threshold −30%', tiers: TIERS },
  { id: 'poverty', name: 'Poverty', constraint: 'Scrap income −75%.', reward: 'Strip Mine pays ×5 instead of ×4', tiers: TIERS },
  { id: 'pacifist_core', name: 'Pacifist Core', constraint: 'Only statuses, hazards, and Retaliation deal damage.', reward: 'Rot Anomaly pool', tiers: TIERS },
];
