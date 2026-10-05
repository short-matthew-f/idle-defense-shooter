/**
 * Anomalies (design §9): drafted rule-breakers, three offered on the first clear
 * of waves 10, 20 … 100. Common = a stat twist, Rare = a rule change,
 * Paradox = breaks a commitment rule, Cursed = large upside with a real downside.
 *
 * Effects apply as rank 1 while socketed. Anomalies whose behavior is a rule
 * change carry no effects; their system checks `stats.hasAnomaly(id)` and reads
 * the tunables named in base-stats.ts under `anomaly.<id>.*`.
 */
import type { AnomalyDef } from './schema';
import { fx } from './builders';

export const ANOMALIES: AnomalyDef[] = [
  // --- Paradox ------------------------------------------------------------
  {
    id: 'spare_barrel', name: 'Spare Barrel', rarity: 'paradox', pool: 'base', needs: ['primary'],
    desc: 'Choose a second Barrel Doctrine; it runs at 50% strength alongside your first.',
    effects: [],
  },
  {
    id: 'borrowed_blade', name: 'Borrowed Blade', rarity: 'paradox', pool: 'base', reveal: ['blade'],
    desc: 'A tier-1 Orbital Blade spins without a hardpoint slot. Its base nodes can be bought; its Doctrines cannot.',
    effects: [],
  },
  {
    id: 'recursive_warhead', name: 'Recursive Warhead', rarity: 'paradox', pool: 'base', needs: ['ordnance'],
    desc: 'Missiles split into Cluster Warheads without buying the Exotic.',
    effects: [],
  },
  // --- Rare ---------------------------------------------------------------
  {
    id: 'loaded_dice', name: 'Loaded Dice', rarity: 'rare', pool: 'base', needs: ['primary'],
    desc: 'Every crit chance roll, from any system, is rolled twice and keeps the better result.',
    effects: [],
  },
  {
    id: 'seventh_shot', name: 'Seventh Shot', rarity: 'rare', pool: 'base', needs: ['primary'],
    desc: 'Every 7th primary shot is a Fireball (60-unit blast, 2 Burn stacks), even without Fire attuned.',
    effects: [],
  },
  {
    id: 'mirror_node', name: 'Mirror Node', rarity: 'rare', pool: 'base', needs: ['laser'],
    desc: 'Laser nodes mirror across the tower: twice the nodes and beams, but beams deal 40% less damage.',
    effects: [fx('laser.damage@final', 'mul', -0.4)],
  },
  {
    id: 'pinball', name: 'Pinball', rarity: 'rare', pool: 'base', needs: ['primary'],
    desc: 'Ricochets and bouncing shots rebound off the arena edge instead of expiring, keeping their bounces.',
    effects: [],
  },
  {
    id: 'stormglass', name: 'Stormglass', rarity: 'rare', pool: 'base', needs: ['lightning', 'frost'],
    desc: 'Frozen and max-Chill enemies conduct lightning: arcs from or to them reach double range.',
    effects: [],
  },
  {
    id: 'clockwork_blade', name: 'Clockwork Blade', rarity: 'rare', pool: 'base', needs: ['blade'],
    desc: 'The blade reverses direction every 6 s, releasing a 120-unit shockwave that knocks enemies back.',
    effects: [],
  },
  {
    id: 'ghost_protocol', name: 'Ghost Protocol', rarity: 'rare', pool: 'base', needs: ['drones'],
    desc: 'Enemies killed by drones rise as ghosts that fight for the tower for 3 s.',
    effects: [],
  },
  {
    id: 'rogue_moon', name: 'Rogue Moon', rarity: 'rare', pool: 'base',
    desc: 'A small mass orbits the tower at long range (380 units), dealing contact damage and pulling nearby enemies weakly toward itself.',
    effects: [],
  },
  // --- Common -------------------------------------------------------------
  {
    id: 'cold_iron', name: 'Cold Iron', rarity: 'common', pool: 'base', needs: ['frost'],
    desc: 'Each Chill stack also removes 1% of the enemy\'s armor.',
    effects: [fx('frost.chill_armor_shred', 'add', 0.01)],
  },
  {
    id: 'heavy_water', name: 'Heavy Water', rarity: 'common', pool: 'base', needs: ['poison'],
    desc: 'Poison ticks 25% slower but each tick hits 50% harder (+20% Poison damage per second).',
    effects: [fx('poison.tick_interval', 'mul', 0.25), fx('poison.damage@final', 'mul', 0.2)],
  },
  {
    id: 'overcharged_capacitor', name: 'Overcharged Capacitor', rarity: 'common', pool: 'base', reveal: ['abilities'],
    desc: 'Command Energy cap +50%.',
    effects: [fx('economy.ce_cap@final', 'mul', 0.5)],
  },
  {
    id: 'second_opinion', name: 'Second Opinion', rarity: 'common', pool: 'base', reveal: ['abilities'],
    desc: 'You get two Target Designators; both targets are preferred by every weapon.',
    effects: [],
  },
  // --- Cursed -------------------------------------------------------------
  {
    id: 'glass_cannon', name: 'Glass Cannon', rarity: 'cursed', pool: 'base',
    desc: '+50% damage from every source, but −50% max HP.',
    effects: [fx('combat.power_mul@final', 'mul', 0.5), fx('bastion.max_hp_final', 'mul', -0.5)],
  },
  {
    id: 'unstable_isotope', name: 'Unstable Isotope', rarity: 'cursed', pool: 'base', needs: ['ordnance'],
    desc: 'Explosions are 50% larger, but 5% of them also detonate on the tower for 10% of their damage (at most 2% of max HP each).',
    effects: [fx('combat.blast_radius_mul', 'add', 0.5)],
  },
  {
    id: 'tithe', name: 'Tithe', rarity: 'cursed', pool: 'base',
    desc: 'Bosses drop 2 Cores on their first kill, but the tower no longer heals between waves.',
    effects: [fx('economy.boss_cores', 'add', 1), fx('bastion.between_wave_heal', 'set', 0)],
  },
  {
    id: 'hungry_core', name: 'Hungry Core', rarity: 'cursed', pool: 'base',
    desc: 'Every kill heals 1% of max HP, but all other regeneration and healing stops.',
    effects: [fx('bastion.kill_heal', 'add', 0.01), fx('bastion.regeneration', 'set', 0)],
  },

  // ======================================================================
  // NEW (WP-DATA): not in the design's table. Invented in its voice for the
  // Echo pool (Ascension I) and the Rot pool (Trial: Pacifist Core reward).
  // ======================================================================
  {
    id: 'afterimage_round', name: 'Afterimage Round', rarity: 'rare', pool: 'echo', needs: ['primary'],
    desc: 'NEW. Every primary shot leaves an echo that fires again from the tower 0.4 s later at 30% damage.',
    effects: [],
  },
  {
    id: 'echo_chamber', name: 'Echo Chamber', rarity: 'common', pool: 'echo',
    desc: 'NEW. Explosions repeat once 0.5 s later at 40% damage and 70% radius.',
    effects: [],
  },
  {
    id: 'feedback_loop', name: 'Feedback Loop', rarity: 'cursed', pool: 'echo', reveal: ['abilities'],
    desc: 'NEW. Every tactical ability recasts itself 1 s later at 50% power, but Command Energy cap is 40% lower.',
    effects: [fx('economy.ce_cap@final', 'mul', -0.4)],
  },
  {
    id: 'rot_bloom', name: 'Rot Bloom', rarity: 'rare', pool: 'rot', needs: ['poison'],
    desc: 'NEW. Poisoned enemies that die leave a toxic cloud for 3 s that applies 1 Poison stack per second.',
    effects: [],
  },
  {
    id: 'smolder', name: 'Smolder', rarity: 'common', pool: 'rot', needs: ['fire', 'poison'],
    desc: 'NEW. Burn and Poison last 40% longer.',
    effects: [fx('fire.burn_duration', 'mul', 0.4), fx('poison.duration', 'mul', 0.4)],
  },
  {
    id: 'martyr_plating', name: 'Martyr Plating', rarity: 'cursed', pool: 'rot',
    desc: 'NEW. The tower retaliates for 20% of damage taken even without Thorns, and all Retaliation deals ×3 damage, but the tower has no armor.',
    effects: [fx('bastion.thorns.retaliation', 'add', 0.2), fx('bastion.thorns.retaliation_mul', 'add', 2), fx('bastion.armor', 'set', 0)],
  },
];
