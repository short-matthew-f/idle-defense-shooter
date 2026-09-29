/**
 * String-literal id unions for every content category. Content data (src/sim/data)
 * must use these ids; systems switch on them. Adding content = extend the union
 * and the matching data table; the compiler then points at every switch to update.
 */

export type FrameId =
  | 'standard' | 'arsenal' | 'conductor' | 'monolith' | 'hive' | 'bulwark'
  | 'echo_engine' | 'prism' | 'singularity_core';

/** Hardpoint systems (five compete for at most four slots). */
export type HardpointId = 'ordnance' | 'drones' | 'blade' | 'laser' | 'gravitics';

/** The three chassis trees, always present. */
export type ChassisId = 'ballistics' | 'bastion' | 'reactor';

export type ElementId = 'fire' | 'lightning' | 'poison' | 'frost';

/** Every tree that owns nodes, a Doctrine fork and an Exotic. */
export type TreeId = ChassisId | ElementId | HardpointId;

/** "Weapon systems" for Linkages: the primary counts as always mounted. */
export type WeaponSystemId = 'primary' | HardpointId;

export type FusionId =
  | 'toxic_combustion' | 'superconductivity' | 'thermal_shock'
  | 'electrolysis' | 'plasma' | 'cryotoxin';

export type TriadId = 'catalyst' | 'polar_storm' | 'crucible' | 'cold_circuit';

export type DoctrineId =
  // Ballistics
  | 'multishot' | 'piercing' | 'ricochet' | 'heavy_rounds'
  // Bastion
  | 'fortress' | 'aegis' | 'thorns' | 'phoenix'
  // Reactor
  | 'overclock' | 'salvage' | 'synchronization' | 'command'
  // Elements
  | 'wildfire' | 'inferno' | 'chain' | 'storm' | 'plague' | 'venom' | 'control' | 'shatter'
  // Ordnance
  | 'hunter' | 'swarm' | 'bombard'
  // Drones
  | 'wing' | 'arc' | 'carrier' | 'support'
  // Blade
  | 'twinning' | 'greatblade' | 'tempest'
  // Laser
  | 'expansion' | 'resonance' | 'containment'
  // Gravitics
  | 'collapse' | 'lensing' | 'tidal';

export type AbilityId =
  | 'hunter_mark' | 'repulsor_pulse' | 'time_field' | 'bombardment' | 'emp'
  | 'overdrive' | 'emergency_repair' | 'drone_surge' | 'missile_storm' | 'singularity_bomb';

export type AnomalyRarity = 'common' | 'rare' | 'paradox' | 'cursed';

export type AnomalyId =
  | 'spare_barrel' | 'borrowed_blade' | 'recursive_warhead'
  | 'loaded_dice' | 'seventh_shot' | 'mirror_node' | 'pinball' | 'stormglass'
  | 'clockwork_blade' | 'ghost_protocol' | 'rogue_moon'
  | 'cold_iron' | 'heavy_water' | 'overcharged_capacitor' | 'second_opinion'
  | 'glass_cannon' | 'unstable_isotope' | 'tithe' | 'hungry_core'
  // Echo pool (Ascension I) — WP-DATA additions, not individually named in the design
  | 'afterimage_round' | 'echo_chamber' | 'feedback_loop'
  // Rot pool (Trial: Pacifist Core) — WP-DATA additions, not individually named in the design
  | 'rot_bloom' | 'smolder' | 'martyr_plating';

export type EnemyKind =
  // Outskirts
  | 'grunt' | 'swarm' | 'runner' | 'brute' | 'kamikaze' | 'shielded'
  // The Hive
  | 'splitter' | 'carrier' | 'healer' | 'leech' | 'veteran'
  // The Bastion Line
  | 'armored' | 'warden' | 'artillery' | 'charger' | 'anchor'
  // The Fold
  | 'phase' | 'burrower' | 'nullifier' | 'refractor'
  // The Court
  | 'jammer'
  // Spawned sub-units
  | 'splitter_fragment' | 'brood' | 'clump' | 'boss_add'
  // Bosses use kind 'boss' + bossId
  | 'boss';

export type SectorId = 'outskirts' | 'hive' | 'bastion_line' | 'fold' | 'court';

export type BossId =
  | 'breaker' | 'broodheart' | 'warden' | 'siege_engine' | 'iron_maw'
  | 'mirror_hive' | 'storm_crown' | 'distant_saint' | 'leech_queen' | 'splinter_king'
  | 'null_engine' | 'chronophage' | 'hive_fortress' | 'redline' | 'grave_battery'
  | 'event_horizon' | 'architect' | 'choir' | 'last_procession' | 'crown'
  | 'deep_graft';

export type FormationId =
  | 'radial_ring' | 'tightening_spiral' | 'alternating_spokes' | 'crescent' | 'rotating_wedge'
  | 'twin_columns' | 'expanding_flower' | 'comet_tail' | 'concentric_assault' | 'synchronized_burst'
  | 'serpentine' | 'escort' | 'scattered_rain' | 'pincer' | 'artillery_ring' | 'moving_wall'
  | 'delayed_ambush' | 'annular_rush' | 'brute_column' | 'packed_wedge' | 'flank_pair'
  | 'kamikaze_ring' | 'cluster_drop' | 'staggered_lanes'
  // Ascension III spatial templates (WP4)
  | 'double_helix' | 'figure_eight' | 'orbit_lattice' | 'polygon_siege' | 'gate_weave' | 'tidal_ring'
  | 'spiral_arms' | 'hex_grid' | 'safe_corridor' | 'barrier_maze' | 'mirror_lanes' | 'hazard_bloom';

export type EliteModifier =
  | 'hardened' | 'swift' | 'regenerating' | 'shielded_elite' | 'volatile' | 'phasing'
  | 'splitting' | 'anchored' | 'jamming' | 'refracting' | 'vampiric' | 'commanding';

export type StatusId = 'burn' | 'shock' | 'poison' | 'chill' | 'bleed' | 'brittle' | 'marked' | 'static';

export type TargetingProfile =
  | 'nearest' | 'closest_to_tower' | 'lowest_hp' | 'highest_hp' | 'elites' | 'support' | 'fastest' | 'designated';

export type TrialId =
  | 'bare_metal' | 'hive_mind' | 'siege_mentality' | 'monochrome' | 'blackout'
  | 'commander' | 'scatter' | 'swarmstorm' | 'poverty' | 'pacifist_core';

/** Weapon Linkage ids are the sorted pair "a+b"; see data/linkages.ts. */
export type LinkageId = string;
/** Node ids are `${tree}.${node}` for tree nodes, `link.${a}+${b}`, `infuse.${system}.${element}`, `fusion.${id}`, `ability.${id}`, `prestige.${id}` ... */
export type NodeId = string;
