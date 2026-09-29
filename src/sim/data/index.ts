/**
 * Content registry. Data work packages fill these arrays; systems, the shop
 * and the simulator agents read only from here.
 */
import type { TreeDef, FrameDef, FusionDef, TriadDef, LinkageDef, InfusionDef, AnomalyDef, AbilityDef, EnemyDef, BossDef, FormationDef, SectorDef, TrialDef, PrestigeNodeDef, StarNodeDef } from './schema';

export const TREES: TreeDef[] = [];
export const FRAMES: FrameDef[] = [];
export const FUSIONS: FusionDef[] = [];
export const TRIADS: TriadDef[] = [];
export const WEAPON_LINKAGES: LinkageDef[] = [];
export const CHASSIS_LINKAGES: LinkageDef[] = [];
export const INFUSIONS: InfusionDef[] = [];
export const ANOMALIES: AnomalyDef[] = [];
export const ABILITIES: AbilityDef[] = [];
export const ENEMIES: EnemyDef[] = [];
export const BOSSES: BossDef[] = [];
export const FORMATIONS: FormationDef[] = [];
export const SECTORS: SectorDef[] = [];
export const TRIALS: TrialDef[] = [];
export const PRESTIGE_NODES: PrestigeNodeDef[] = [];
export const STAR_NODES: StarNodeDef[] = [];

export const SYSTEM_ORDER_IDS = ['primary', 'ordnance', 'drones', 'blade', 'laser', 'gravitics'] as const;
export const ELEMENT_ORDER = ['fire', 'lightning', 'poison', 'frost'] as const;
