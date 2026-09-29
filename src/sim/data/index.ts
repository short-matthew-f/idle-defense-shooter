/**
 * Content registry. Data work packages fill these arrays; systems, the shop
 * and the simulator agents read only from here.
 */
import type { TreeDef, FrameDef, FusionDef, TriadDef, LinkageDef, InfusionDef, AnomalyDef, AbilityDef, EnemyDef, BossDef, FormationDef, SectorDef, TrialDef, PrestigeNodeDef, StarNodeDef } from './schema';
import { CHASSIS_TREES } from './chassis';
import { ELEMENT_TREES } from './elements';
import { HARDPOINT_TREES } from './hardpoints';
import { FRAMES as FRAME_TABLE } from './frames';
import { FUSIONS as FUSION_TABLE, TRIADS as TRIAD_TABLE } from './fusions';
import { WEAPON_LINKAGES as WEAPON_LINKAGE_TABLE, CHASSIS_LINKAGES as CHASSIS_LINKAGE_TABLE } from './linkages';
import { INFUSIONS as INFUSION_TABLE } from './infusions';
import { ANOMALIES as ANOMALY_TABLE } from './anomalies';
import { ABILITIES as ABILITY_TABLE } from './abilities';
import { TRIALS as TRIAL_TABLE } from './trials';
import { PRESTIGE_NODES as PRESTIGE_TABLE } from './prestige';
import { STAR_NODES as STAR_TABLE } from './constellation';

export const TREES: TreeDef[] = [...CHASSIS_TREES, ...ELEMENT_TREES, ...HARDPOINT_TREES];
export const FRAMES: FrameDef[] = FRAME_TABLE;
export const FUSIONS: FusionDef[] = FUSION_TABLE;
export const TRIADS: TriadDef[] = TRIAD_TABLE;
export const WEAPON_LINKAGES: LinkageDef[] = WEAPON_LINKAGE_TABLE;
export const CHASSIS_LINKAGES: LinkageDef[] = CHASSIS_LINKAGE_TABLE;
export const INFUSIONS: InfusionDef[] = INFUSION_TABLE;
export const ANOMALIES: AnomalyDef[] = ANOMALY_TABLE;
export const ABILITIES: AbilityDef[] = ABILITY_TABLE;
export { ENEMIES } from './enemies';
export { BOSSES } from './bosses';
export { FORMATIONS } from './formations';
export { SECTORS } from './sectors';
export const TRIALS: TrialDef[] = TRIAL_TABLE;
export const PRESTIGE_NODES: PrestigeNodeDef[] = PRESTIGE_TABLE;
export const STAR_NODES: StarNodeDef[] = STAR_TABLE;

export const SYSTEM_ORDER_IDS = ['primary', 'ordnance', 'drones', 'blade', 'laser', 'gravitics'] as const;
export const ELEMENT_ORDER = ['fire', 'lightning', 'poison', 'frost'] as const;

/** Base stat values (WP1 seeded data/base-stats.ts; WP-DATA owns it). */
export { BASE_STATS } from './base-stats';
