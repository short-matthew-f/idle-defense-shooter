/**
 * Bosses (design §13). Every fifth wave is a boss that tests one system. Ordinary
 * bosses have 2 phases, Sector finales (20/40/60/80/100) have 3 and ~1.3× their neighbours' hpMul.
 * BossHP(w) = 12 * EnemyHP(w) * hpMul. Balance pass: hpMul rises with the wave (≈ with the Threat
 * Budget) so boss fights stay 45–120 s instead of shrinking to 20 s as the build outgrows 12× one enemy
 * (see docs/BALANCE.md).
 *
 * Conventions for WP5 (enemies/bosses/*):
 *  - `phases[i].hpFraction`: phase i begins when hp/maxHp <= hpFraction (phase 0 = 1.0).
 *  - `weakPoint.angle` is radians relative to the boss facing (0 = facing the tower),
 *    `weakPoint.radius` is arena units from the boss center.
 *  - The first attack id of `tell` (TELL_ATTACKS[boss]) is the telegraphed signature
 *    attack; TELL_COUNTERS maps every tell attack id to its Counter.
 *  - `adds[].perPhase` = adds summoned when each phase begins (phase 0 included).
 *
 * ATTACK SCRIPT IDS referenced below (WP5 implements each by id):
 *   Tells (1.0–1.5 s wind-up, Counter-able):
 *     slam, brood_sac, shield_links, ram_charge, maw_open, clone_shuffle, hazard_ring,
 *     halo_charge, feeding_tethers, split_flash, resistance_rotate, dilation_pulse,
 *     gate_open, dash_lane, revive_beam, inhale, wall_blueprint, harmony_sync,
 *     procession_halt, graft_tell
 *   Other attacks:
 *     stomp_wave, charge, spawn_brood, acid_spit, shield_pulse, summon_guards,
 *     siege_volley, deploy_turrets, armor_shed, devour, grind, spawn_clones, mirror_volley,
 *     lightning_strikes, storm_orbit, long_lance, escort_call, sanctify, drain_shield,
 *     spawn_leeches, fragment_burst, reform, null_field, node_beam, time_burst, rewind,
 *     accelerate_adds, spawn_wave, fortify, afterburn_trail, dash, raise_elites,
 *     grave_volley, bend_projectiles, drag_drones, collapse, raise_barrier, corridor_shift,
 *     shield_generators, choir_beam, elite_gauntlet, rally, crown_synthesis,
 *     graft_primary, graft_secondary
 */
import type { AbilityId, BossId } from '../core/ids';
import { Shape, TICK_RATE } from '../core/types';
import { PI } from '../math/lut';
import type { BossDef } from './schema';

type Counter = AbilityId | 'designate';

/** Every tell attack id → the Counter that defeats it (Crown reuses earlier tells). */
export const TELL_COUNTERS: Record<string, Counter> = {
  slam: 'repulsor_pulse',
  brood_sac: 'bombardment',
  shield_links: 'emp',
  ram_charge: 'time_field',
  maw_open: 'designate',
  clone_shuffle: 'hunter_mark',
  hazard_ring: 'repulsor_pulse',
  halo_charge: 'missile_storm',
  feeding_tethers: 'emp',
  split_flash: 'singularity_bomb',
  resistance_rotate: 'designate',
  dilation_pulse: 'time_field',
  gate_open: 'bombardment',
  dash_lane: 'time_field',
  revive_beam: 'emp',
  inhale: 'repulsor_pulse',
  wall_blueprint: 'bombardment',
  harmony_sync: 'designate',
  procession_halt: 'singularity_bomb',
};

const WP = (angle: number, radius: number, exposedSeconds = 4) => ({ angle, radius, exposedSeconds });

export const BOSSES: BossDef[] = [
  {
    id: 'breaker', name: 'The Breaker', wave: 5, tests: 'Basic DPS and survival',
    hpMul: 1.0, radius: 34, speed: 16, armor: 10, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Advance', attacks: ['slam', 'stomp_wave'] },
      { hpFraction: 0.5, name: 'Rampage', attacks: ['slam', 'charge', 'stomp_wave'], weakPoint: WP(PI, 26) },
    ],
    tell: { name: 'Slam wind-up', counter: 'repulsor_pulse', windowSeconds: 1.5, everySeconds: 10, desc: 'Raises both arms; Repulsor Pulse staggers it.' },
    shape: Shape.Square, color: [1.00, 0.55, 0.20],
    desc: 'A walking wrecking ball. Hit it hard and stay alive.',
  },
  {
    id: 'broodheart', name: 'Broodheart', wave: 10, tests: 'Area damage vs spawning swarms',
    hpMul: 0.75, radius: 38, speed: 12, armor: 0, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Gestation', attacks: ['brood_sac', 'spawn_brood'] },
      { hpFraction: 0.5, name: 'Hatching', attacks: ['brood_sac', 'spawn_brood', 'acid_spit'], weakPoint: WP(0, 30) },
    ],
    tell: { name: 'Brood sac swells', counter: 'bombardment', windowSeconds: 1.5, everySeconds: 12, desc: 'A sac bulges on its back; Bombardment on the sac kills the brood inside.' },
    adds: [{ kind: 'brood', perPhase: 9 }, { kind: 'swarm', perPhase: 6 }],
    shape: Shape.Circle, color: [1.00, 0.80, 0.30],
    desc: 'A pulsing mother-sac that never stops birthing.',
  },
  {
    id: 'warden', name: 'The Warden', wave: 15, tests: 'Target priority and shields',
    hpMul: 2.1, radius: 36, speed: 14, armor: 15, shieldMul: 0.5,
    phases: [
      { hpFraction: 1, name: 'Bulwark', attacks: ['shield_links', 'shield_pulse'] },
      { hpFraction: 0.5, name: 'Last Stand', attacks: ['shield_links', 'summon_guards', 'shield_pulse'], weakPoint: WP(PI, 28) },
    ],
    tell: { name: 'Shield links form', counter: 'emp', windowSeconds: 1.2, everySeconds: 11, desc: 'Beams reach toward nearby guards; EMP severs them for 6 s.' },
    adds: [{ kind: 'shielded', perPhase: 4 }],
    shape: Shape.Hex, color: [1.00, 0.90, 0.55],
    desc: 'Shares its shield with guards. Kill the links, then the Warden.',
  },
  {
    id: 'siege_engine', name: 'The Siege Engine', wave: 20, tests: 'Mixed threats; first Prestige gate',
    hpMul: 2.7, radius: 46, speed: 12, armor: 25, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Bombard', attacks: ['siege_volley', 'ram_charge'] },
      { hpFraction: 0.66, name: 'Deploy', attacks: ['ram_charge', 'deploy_turrets', 'siege_volley'], weakPoint: WP(0, 34) },
      { hpFraction: 0.33, name: 'Breach', attacks: ['ram_charge', 'armor_shed', 'siege_volley'], weakPoint: WP(PI, 30, 5) },
    ],
    tell: { name: 'Ram charge', counter: 'time_field', windowSeconds: 1.5, everySeconds: 12, desc: 'Backs up and lowers the ram; Time Field stalls it, exposing its core.' },
    adds: [{ kind: 'brute', perPhase: 2 }, { kind: 'kamikaze', perPhase: 6 }],
    shape: Shape.Capsule, color: [1.00, 0.46, 0.16],
    desc: 'A rolling fortress with guns, rams and escorts. The Outskirts finale.',
  },
  {
    id: 'iron_maw', name: 'Iron Maw', wave: 25, tests: 'Sustained damage vs extreme HP',
    hpMul: 4.2, radius: 44, speed: 10, armor: 40, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Grinding', attacks: ['maw_open', 'grind'] },
      { hpFraction: 0.5, name: 'Starving', attacks: ['maw_open', 'devour', 'grind'], weakPoint: WP(0, 20, 4) },
    ],
    tell: { name: 'Maw opens', counter: 'designate', windowSeconds: 1.5, everySeconds: 10, desc: 'The jaw unhinges; designate the mouth for double damage.' },
    shape: Shape.Crescent, color: [0.80, 0.95, 0.30],
    desc: 'Enormous HP behind thick plate. Only the open mouth is soft.',
  },
  {
    id: 'mirror_hive', name: 'Mirror Hive', wave: 30, tests: 'Clones and crowd control',
    hpMul: 4.9, radius: 32, speed: 18, armor: 5, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Reflection', attacks: ['clone_shuffle', 'spawn_clones'] },
      { hpFraction: 0.5, name: 'Hall of Mirrors', attacks: ['clone_shuffle', 'spawn_clones', 'mirror_volley'], weakPoint: WP(PI, 24) },
    ],
    tell: { name: 'Clone shuffle', counter: 'hunter_mark', windowSeconds: 1.2, everySeconds: 11, desc: 'Clones swap places; the true one shows for 0.5 s. Hunter Mark it.' },
    adds: [{ kind: 'boss_add', perPhase: 4 }, { kind: 'swarm', perPhase: 12 }],
    shape: Shape.Diamond, color: [0.70, 1.00, 0.55],
    desc: 'Surrounded by decoys that share its silhouette.',
  },
  {
    id: 'storm_crown', name: 'Storm Crown', wave: 35, tests: 'Survival through hazards',
    hpMul: 5.6, radius: 36, speed: 14, armor: 10, shieldMul: 0.2,
    phases: [
      { hpFraction: 1, name: 'Gathering', attacks: ['hazard_ring', 'lightning_strikes'] },
      { hpFraction: 0.5, name: 'Tempest', attacks: ['hazard_ring', 'storm_orbit', 'lightning_strikes'], weakPoint: WP(0, 26) },
    ],
    tell: { name: 'Hazard ring forms', counter: 'repulsor_pulse', windowSeconds: 1.3, everySeconds: 12, desc: 'A ring of sparks closes on the tower; Repulsor Pulse clears the inner ring.' },
    adds: [{ kind: 'runner', perPhase: 6 }],
    shape: Shape.Star, color: [0.85, 1.00, 0.40],
    desc: 'Survive the weather, then crack the crown.',
  },
  {
    id: 'distant_saint', name: 'The Distant Saint', wave: 40, tests: 'Ranged artillery and escorts',
    hpMul: 7, radius: 40, speed: 10, armor: 15, shieldMul: 0.3,
    phases: [
      { hpFraction: 1, name: 'Vigil', attacks: ['halo_charge', 'long_lance'] },
      { hpFraction: 0.66, name: 'Procession', attacks: ['halo_charge', 'escort_call', 'long_lance'], weakPoint: WP(PI, 30) },
      { hpFraction: 0.33, name: 'Martyrdom', attacks: ['halo_charge', 'sanctify', 'long_lance'], weakPoint: WP(0, 32, 5) },
    ],
    tell: { name: 'Halo charges', counter: 'missile_storm', windowSeconds: 1.5, everySeconds: 13, desc: 'The halo brightens before a lance volley; Missile Storm interrupts it.' },
    adds: [{ kind: 'healer', perPhase: 2 }, { kind: 'veteran', perPhase: 3 }],
    shape: Shape.Cross, color: [0.90, 1.00, 0.70],
    desc: 'Holds at range behind its escort and shells the tower. The Hive finale.',
  },
  {
    id: 'leech_queen', name: 'Leech Queen', wave: 45, tests: 'Shield drain and healing',
    hpMul: 6.3, radius: 36, speed: 16, armor: 10, shieldMul: 0.3,
    phases: [
      { hpFraction: 1, name: 'Feeding', attacks: ['feeding_tethers', 'drain_shield'] },
      { hpFraction: 0.5, name: 'Gorged', attacks: ['feeding_tethers', 'spawn_leeches', 'drain_shield'], weakPoint: WP(PI, 26) },
    ],
    tell: { name: 'Feeding tethers', counter: 'emp', windowSeconds: 1.2, everySeconds: 10, desc: 'Tethers reach for the tower; EMP breaks them.' },
    adds: [{ kind: 'leech', perPhase: 4 }],
    shape: Shape.Crescent, color: [0.55, 0.85, 1.00],
    desc: 'Drinks the tower\'s shield to heal herself.',
  },
  {
    id: 'splinter_king', name: 'Splinter King', wave: 50, tests: 'Multi-stage fragmentation',
    hpMul: 7, radius: 40, speed: 14, armor: 20, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Whole', attacks: ['split_flash', 'fragment_burst'] },
      { hpFraction: 0.5, name: 'Shattered', attacks: ['split_flash', 'reform', 'fragment_burst'], weakPoint: WP(0, 22) },
    ],
    tell: { name: 'Split flash', counter: 'singularity_bomb', windowSeconds: 1.2, everySeconds: 12, desc: 'Cracks glow before it shatters; Singularity Bomb gathers the fragments.' },
    adds: [{ kind: 'splitter_fragment', perPhase: 8 }],
    shape: Shape.Shard, color: [0.60, 0.80, 1.00],
    desc: 'Breaks into smaller kings, which break again.',
  },
  {
    id: 'null_engine', name: 'Null Engine', wave: 55, tests: 'Damage-type diversity',
    hpMul: 7.7, radius: 40, speed: 12, armor: 30, shieldMul: 0.2,
    phases: [
      { hpFraction: 1, name: 'Calibrating', attacks: ['resistance_rotate', 'null_field'] },
      { hpFraction: 0.5, name: 'Overclocked', attacks: ['resistance_rotate', 'node_beam', 'null_field'], weakPoint: WP(PI, 30) },
    ],
    tell: { name: 'Resistance rotates', counter: 'designate', windowSeconds: 1.2, everySeconds: 9, desc: 'Its resistance nodes spin; designate the node matching its weak type.' },
    shape: Shape.Ring, color: [0.70, 0.80, 0.95],
    desc: 'Resists whatever hurts it most, one damage type at a time.',
  },
  {
    id: 'chronophage', name: 'The Chronophage', wave: 60, tests: 'Speed changes and bursts',
    hpMul: 9.8, radius: 42, speed: 20, armor: 20, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Tick', attacks: ['dilation_pulse', 'time_burst'] },
      { hpFraction: 0.66, name: 'Tock', attacks: ['dilation_pulse', 'accelerate_adds', 'time_burst'], weakPoint: WP(0, 30) },
      { hpFraction: 0.33, name: 'Midnight', attacks: ['dilation_pulse', 'rewind', 'time_burst'], weakPoint: WP(PI, 30, 5) },
    ],
    tell: { name: 'Dilation pulse', counter: 'time_field', windowSeconds: 1.3, everySeconds: 11, desc: 'Clock-hands spin up before it accelerates; Time Field cancels it.' },
    adds: [{ kind: 'runner', perPhase: 6 }, { kind: 'charger', perPhase: 2 }],
    shape: Shape.Hex, color: [0.46, 0.66, 0.92],
    desc: 'Eats time: speeds itself and its escort, rewinds damage. The Bastion Line finale.',
  },
  {
    id: 'hive_fortress', name: 'Hive Fortress', wave: 65, tests: 'Continuous add generation',
    hpMul: 8.4, radius: 50, speed: 8, armor: 35, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Garrison', attacks: ['gate_open', 'spawn_wave'] },
      { hpFraction: 0.5, name: 'Sally Forth', attacks: ['gate_open', 'fortify', 'spawn_wave'], weakPoint: WP(0, 36) },
    ],
    tell: { name: 'Gate opens', counter: 'bombardment', windowSeconds: 1.5, everySeconds: 10, desc: 'The gate grinds open before a wave pours out; Bombardment into the gate.' },
    adds: [{ kind: 'grunt', perPhase: 10 }, { kind: 'carrier', perPhase: 2 }, { kind: 'burrower', perPhase: 3 }],
    shape: Shape.Square, color: [0.80, 0.55, 1.00],
    desc: 'A walking barracks that never runs out of soldiers.',
  },
  {
    id: 'redline', name: 'Redline', wave: 70, tests: 'Extreme movement speed',
    hpMul: 8.4, radius: 28, speed: 110, armor: 10, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Warm-up', attacks: ['dash_lane', 'dash'] },
      { hpFraction: 0.5, name: 'Overdrive', attacks: ['dash_lane', 'afterburn_trail', 'dash'], weakPoint: WP(PI, 20, 3) },
    ],
    tell: { name: 'Dash lane glows', counter: 'time_field', windowSeconds: 1.0, everySeconds: 8, desc: 'A lane lights up before it dashes; Time Field on the lane.' },
    shape: Shape.Triangle, color: [1.00, 0.40, 0.70],
    desc: 'Too fast to track. Predict the lane.',
  },
  {
    id: 'grave_battery', name: 'Grave Battery', wave: 75, tests: 'Reviving elites',
    hpMul: 9.1, radius: 40, speed: 10, armor: 25, shieldMul: 0.2,
    phases: [
      { hpFraction: 1, name: 'Charging', attacks: ['revive_beam', 'grave_volley'] },
      { hpFraction: 0.5, name: 'Discharge', attacks: ['revive_beam', 'raise_elites', 'grave_volley'], weakPoint: WP(0, 28) },
    ],
    tell: { name: 'Revive beam', counter: 'emp', windowSeconds: 1.3, everySeconds: 11, desc: 'A beam reaches a fallen elite; EMP cuts it.' },
    adds: [{ kind: 'veteran', perPhase: 3 }],
    shape: Shape.Capsule, color: [0.60, 0.40, 0.95],
    desc: 'Raises dead elites. Kill the battery or fight the same elites forever.',
  },
  {
    id: 'event_horizon', name: 'Event Horizon', wave: 80, tests: 'Spatial control; bends projectiles and drags drones',
    hpMul: 11.2, radius: 48, speed: 8, armor: 20, shieldMul: 0,
    phases: [
      { hpFraction: 1, name: 'Accretion', attacks: ['inhale', 'bend_projectiles'] },
      { hpFraction: 0.66, name: 'Lensing', attacks: ['inhale', 'drag_drones', 'bend_projectiles'], weakPoint: WP(0, 34) },
      { hpFraction: 0.33, name: 'Collapse', attacks: ['inhale', 'collapse', 'drag_drones'], weakPoint: WP(PI, 34, 5) },
    ],
    tell: { name: 'Inhale begins', counter: 'repulsor_pulse', windowSeconds: 1.5, everySeconds: 12, desc: 'Space darkens and pulls inward; Repulsor Pulse at its peak cancels the pull.' },
    adds: [{ kind: 'phase', perPhase: 4 }],
    shape: Shape.Ring, color: [0.70, 0.40, 1.00],
    desc: 'Gravity well with a mind. The Fold finale.',
  },
  {
    id: 'architect', name: 'The Architect', wave: 85, tests: 'Barriers and corridors',
    hpMul: 9.8, radius: 38, speed: 12, armor: 30, shieldMul: 0.3,
    phases: [
      { hpFraction: 1, name: 'Drafting', attacks: ['wall_blueprint', 'raise_barrier'] },
      { hpFraction: 0.5, name: 'Construction', attacks: ['wall_blueprint', 'corridor_shift', 'raise_barrier'], weakPoint: WP(PI, 28) },
    ],
    tell: { name: 'Wall blueprint', counter: 'bombardment', windowSeconds: 1.5, everySeconds: 12, desc: 'Blueprint lines trace a wall; Bombardment breaks it before it sets.' },
    adds: [{ kind: 'armored', perPhase: 2 }],
    shape: Shape.Square, color: [1.00, 0.90, 0.60],
    desc: 'Builds walls that funnel enemies and block shots.',
  },
  {
    id: 'choir', name: 'The Choir', wave: 90, tests: 'Linked shield generators',
    hpMul: 9.8, radius: 40, speed: 10, armor: 20, shieldMul: 0.6,
    phases: [
      { hpFraction: 1, name: 'Overture', attacks: ['harmony_sync', 'shield_generators'] },
      { hpFraction: 0.5, name: 'Crescendo', attacks: ['harmony_sync', 'choir_beam', 'shield_generators'], weakPoint: WP(0, 30) },
    ],
    tell: { name: 'Harmony sync', counter: 'designate', windowSeconds: 1.5, everySeconds: 13, desc: 'Generators chime in order; designate them in the sung order.' },
    adds: [{ kind: 'warden', perPhase: 2 }],
    shape: Shape.Cross, color: [0.96, 0.96, 1.00],
    desc: 'Shielded by a ring of singing generators.',
  },
  {
    id: 'last_procession', name: 'Last Procession', wave: 95, tests: 'A boss inside an elite gauntlet',
    hpMul: 10.5, radius: 36, speed: 14, armor: 25, shieldMul: 0.2,
    phases: [
      { hpFraction: 1, name: 'March', attacks: ['procession_halt', 'elite_gauntlet'] },
      { hpFraction: 0.5, name: 'Rally', attacks: ['procession_halt', 'rally', 'elite_gauntlet'], weakPoint: WP(PI, 26) },
    ],
    tell: { name: 'Procession halts', counter: 'singularity_bomb', windowSeconds: 1.3, everySeconds: 12, desc: 'The column stops and closes ranks; Singularity Bomb collapses the escort.' },
    adds: [{ kind: 'veteran', perPhase: 6 }, { kind: 'armored', perPhase: 3 }, { kind: 'warden', perPhase: 1 }],
    shape: Shape.Diamond, color: [1.00, 0.84, 0.36],
    desc: 'A boss walking inside a column of elites.',
  },
  {
    id: 'crown', name: 'The Crown', wave: 100, tests: 'Synthesis of the game\'s mechanics',
    hpMul: 12.6, radius: 52, speed: 12, armor: 30, shieldMul: 0.3,
    phases: [
      { hpFraction: 1, name: 'Coronation', attacks: ['slam', 'crown_synthesis', 'siege_volley'] },
      { hpFraction: 0.66, name: 'Regency', attacks: ['shield_links', 'crown_synthesis', 'spawn_clones'], weakPoint: WP(0, 36) },
      { hpFraction: 0.33, name: 'Abdication', attacks: ['inhale', 'crown_synthesis', 'dash'], weakPoint: WP(PI, 36, 5) },
    ],
    tell: { name: 'Borrowed tell', counter: 'repulsor_pulse', windowSeconds: 1.5, everySeconds: 11, desc: 'Each phase reuses an earlier tell: Slam (Repulsor Pulse), Shield links (EMP), Inhale (Repulsor Pulse). See TELL_COUNTERS.' },
    adds: [{ kind: 'veteran', perPhase: 3 }, { kind: 'jammer', perPhase: 1 }, { kind: 'warden', perPhase: 1 }],
    shape: Shape.Star, color: [1.00, 0.84, 0.36],
    desc: 'Everything the tower has faced, at once. The Court finale.',
  },
  {
    id: 'deep_graft', name: 'Deep Graft', wave: 105, tests: 'Two boss mechanics at once (Deep Waves)',
    hpMul: 11.2, radius: 46, speed: 12, armor: 30, shieldMul: 0.2,
    phases: [
      { hpFraction: 1, name: 'Graft', attacks: ['graft_tell', 'graft_primary'] },
      { hpFraction: 0.66, name: 'Rejection', attacks: ['graft_tell', 'graft_secondary'], weakPoint: WP(0, 32) },
      { hpFraction: 0.33, name: 'Fusion', attacks: ['graft_tell', 'graft_primary', 'graft_secondary'], weakPoint: WP(PI, 32, 5) },
    ],
    tell: { name: 'Grafted tell', counter: 'repulsor_pulse', windowSeconds: 1.3, everySeconds: 11, desc: 'Uses the tells of its two source bosses (graftSources(wave)); counter per TELL_COUNTERS.' },
    adds: [{ kind: 'boss_add', perPhase: 4 }],
    shape: Shape.Star, color: [0.96, 0.96, 1.00],
    desc: 'Past wave 100 every boss is grafted from two existing boss mechanics.',
  },
];

export const BOSS_BY_ID: Record<BossId, BossDef> = (() => {
  const r = {} as Record<BossId, BossDef>;
  for (const b of BOSSES) r[b.id] = b;
  return r;
})();

/** Stable boss order (pool stores bossId as this index in an Int8). */
export const BOSS_IDS: BossId[] = BOSSES.map((b) => b.id);
export const BOSS_INDEX: Record<BossId, number> = (() => {
  const r = {} as Record<BossId, number>;
  for (let i = 0; i < BOSS_IDS.length; i++) r[BOSS_IDS[i]] = i;
  return r;
})();

/** The tell attack id of each boss (the first attack of phase 0 that is a known tell). */
export function tellAttack(boss: BossDef, phase = 0): string | null {
  const ph = boss.phases[Math.min(phase, boss.phases.length - 1)];
  for (const a of ph.attacks) if (TELL_COUNTERS[a] !== undefined) return a;
  return null;
}

/** Boss for a boss wave (w % 5 === 0), or null. Waves past 100 are Deep Grafts. */
export function bossForWave(w: number): BossId | null {
  if (w < 5 || w % 5 !== 0) return null;
  if (w > 100) return 'deep_graft';
  return BOSSES[w / 5 - 1].id;
}

/**
 * The two ordinary bosses a Deep Graft at wave w borrows mechanics from.
 * Deterministic in w; the pair never repeats a boss with itself.
 */
export function graftSources(w: number): [BossId, BossId] {
  const n = 20;
  const k = Math.floor(w / 5);
  const a = k % n;
  const step = 1 + (Math.floor(k / n) % (n - 1));
  const b = (a + step) % n;
  return [BOSSES[a].id, BOSSES[b].id];
}

/** Seconds → ticks helper for boss scripts. */
export const bossTicks = (s: number): number => Math.round(s * TICK_RATE);
