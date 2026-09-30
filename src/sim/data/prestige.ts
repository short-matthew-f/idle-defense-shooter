/**
 * Prestige layers (design §14). Four layers open at deepest-ever waves 20, 40,
 * 60 and 80. Nodes are bought with Echoes; costs rise ×1.5 per rank within a
 * node (`cost: { base, growth: 1.5 }`). Effects apply for the whole Prestige.
 *
 * Keys owned here (bases in base-stats.ts): prestige.* counters that the
 * run/economy code reads, plus shared keys (economy.*, bastion.max_hp,
 * directives.*, offline.*).
 */
import type { PrestigeNodeDef, StatEffect } from './schema';

const ECHO_GROWTH = 1.5;
/** Accelerated Clearing's Echo prices by rank (see the node). */
export const AC_PRICES = [10, 1500, 60000];

function node(
  layer: 1 | 2 | 3 | 4, id: string, name: string, desc: string,
  base: number | number[], maxRank: number, effects: StatEffect[] = [],
): PrestigeNodeDef {
  const full = `prestige.${id}`;
  return {
    id: full, name, desc, layer,
    kind: maxRank > 5 ? 'stat' : 'mechanic',
    maxRank, cost: typeof base === 'number' ? { base, growth: ECHO_GROWTH } : { flat: base },
    tier: (layer - 1) as 0 | 1 | 2 | 3,
    effects: effects.length ? effects : [{ stat: full, op: 'add', perRank: 1 }],
    tags: ['prestige', `layer${layer}`],
  };
}
const e = (stat: string, op: StatEffect['op'], perRank: number): StatEffect => ({ stat, op, perRank });

// Echo income for reference: 10 × 1.2^(D−20) → ~15–40 at the first wall (D 22–28),
// ~380 at D 40, ~14,700 at D 60, ~565,000 at D 80. Layer prices follow that curve.

export const PRESTIGE_NODES: PrestigeNodeDef[] = [
  // --- Prestige I — Inheritance (wave 20): compress mastered content -------
  node(1, 'seed_capital', 'Seed Capital', 'Start each Prestige with 400 Scrap per rank.', 10, 20, [e('economy.start_scrap', 'add', 400)]),
  node(1, 'memory_of_steel', 'Memory of Steel', 'Start each Prestige with 1 free rank of Caliber (primary damage) per rank.', 16, 10, [e('prestige.memory_of_steel', 'add', 1)]),
  node(1, 'memory_of_motion', 'Memory of Motion', 'Start each Prestige with 1 free rank of Autoloader (primary attack speed) per rank.', 16, 10, [e('prestige.memory_of_motion', 'add', 1)]),
  // Onboarding pass: a flat ladder, not ×1.5. Rank 1 (×2) is a first-Prestige pick; ×4 / ×8 on solved waves would make
  // every reclimb take a few % of the previous run (§3 wants 25–40%), so they cost what Prestiges 3–4 and 5–6 pay.
  node(1, 'accelerated_clearing', 'Accelerated Clearing', 'Waves below your previous best run at ×2 speed; ×4 at rank 2, ×8 at rank 3.', AC_PRICES, 3),
  node(1, 'boss_bounty', 'Boss Bounty', 'Bosses pay +25% Scrap per rank.', 12, 20, [e('economy.boss_scrap_mul', 'add', 0.25)]),
  node(1, 'checkpoint_dividend', 'Checkpoint Dividend', 'The first reach of each checkpoint in a Prestige pays a bonus of 25% per rank of that boss wave\'s kill Scrap.', 20, 10, [e('prestige.checkpoint_dividend', 'add', 0.25)]),
  node(1, 'scrap_resonance', 'Scrap Resonance', '+5% Scrap from every source per rank.', 10, 50, [e('economy.scrap_mul', 'add', 0.05)]),
  node(1, 'hardened_core', 'Hardened Core', '+5% max HP per rank.', 10, 30, [e('bastion.max_hp', 'mul', 0.05)]),

  // --- Prestige II — Arsenal Memory (wave 40): plan builds -----------------
  node(2, 'frames', 'Frames', 'Unlocks the Arsenal and Conductor frames.', 60, 1),
  node(2, 'blueprint_slots', 'Blueprint Slots', 'Save and load full builds: Frame, Hardpoints, Attunements, Doctrines, Targeting Profiles and Upgrade Queue. +1 slot per rank.', 50, 5),
  node(2, 'weapon_seed', 'Weapon Seed', 'Your first hardpoint slot opens at wave 1.', 120, 1),
  node(2, 'elemental_memory', 'Elemental Memory', 'Your first attunement opens at wave 1.', 100, 1),
  node(2, 'early_hardpoints', 'Early Hardpoints', 'Later hardpoint slots open 5 waves earlier per rank (floor: waves 15, 35, 55).', 150, 4, [e('prestige.early_hardpoints', 'add', 5)]),
  node(2, 'third_attunement', 'Third Attunement', '+1 attunement cap, to 3.', 250, 1),
  node(2, 'keepsake', 'Keepsake', 'Keep one socketed Anomaly through Prestige.', 200, 1),
  node(2, 'anomaly_socket', 'Anomaly Socket', '+1 Anomaly socket.', 180, 1, [e('prestige.anomaly_socket', 'add', 1)]),
  node(2, 'branch_discount', 'Branch Discount', 'At Prestige start, choose one tree: it costs 25% less this Prestige.', 150, 1),
  node(2, 'autocast', 'Autocast', 'Each tactical ability can be set to fire whenever it is affordable.', 80, 1),
  node(2, 'trials', 'Trials', 'Unlocks Trials: separate run slots with constraints and permanent rewards.', 120, 1),

  // --- Prestige III — Command Network (wave 60): program the machine -------
  node(3, 'directives', 'Directives', 'Unlocks Directives with 3 rule slots, Targeting Profiles and the Upgrade Queue. Each further rank adds 1 rule slot (up to 12).', 1500, 10, [e('directives.slots', 'add', 1)]),
  node(3, 'third_tactical_slot', 'Third Tactical Slot', '+1 tactical ability slot.', 2500, 1),
  node(3, 'threat_dial', 'Threat Dial', 'Unlocks the Threat Dial: each level adds enemy HP +12% and speed +3% and pays Echoes +10% and Scrap +5%.', 2000, 1),
  node(3, 'directive_tuning', 'Directive Tuning', 'Directive reaction delay −0.06 s per rank (0.6 → 0.3 s) and Counter efficiency +5% per rank (50% → 75%).', 2000, 5,
    [e('directives.reaction_delay', 'add', -0.06), e('directives.counter_efficiency', 'add', 0.05)]),
  node(3, 'long_patrol', 'Long Patrol', 'Offline cap +4 h per rank (8 → 24 h) and offline efficiency +7.5% per rank (40% → 70%).', 1500, 4,
    [e('offline.cap_hours', 'add', 4), e('offline.efficiency', 'add', 0.075)]),
  node(3, 'speed_controls', 'Speed Controls', 'Manual speed on solved waves: ×2 at rank 1, ×4 at rank 2, ×8 at rank 3.', 1200, 3),

  // --- Prestige IV — Evolution (wave 80): build strange engines ------------
  node(4, 'expanded_frame', 'Expanded Frame', '+1 hardpoint cap on every Frame except Monolith (never above 4).', 60000, 1),
  node(4, 'dual_doctrine', 'Dual Doctrine', 'One tree may run a second Doctrine at 60% strength: the first tree you give one claims it (clearing that second Doctrine frees the choice).', 80000, 1),
  node(4, 'duplication', 'Duplication', 'Primary shots have a 2% chance per rank to duplicate.', 20000, 10, [e('prestige.duplication', 'add', 0.02)]),
  node(4, 'double_launch', 'Double Launch', 'Every fifth missile launches twice.', 30000, 1),
  node(4, 'conscription', 'Conscription', 'Defeated elites fight for the tower as drones for 10 s.', 40000, 1),
  node(4, 'overflow', 'Overflow', 'Status effects can exceed their stack caps by 20% per rank.', 30000, 5, [e('prestige.overflow', 'add', 0.2)]),
  node(4, 'reversal', 'Reversal', 'The blade reverses direction every 8 s.', 25000, 1),
  node(4, 'ghost_edges', 'Ghost Edges', 'Every 5 s, laser nodes form 1 temporary extra connection per rank for 2 s.', 30000, 3),
  node(4, 'critical_relay', 'Critical Relay', 'Each crit cuts tactical ability cooldowns by 0.02 s per rank.', 25000, 5, [e('prestige.critical_relay', 'add', 0.02)]),
  node(4, 'held_open', 'Held Open', 'Boss weak points stay exposed 0.5 s longer per rank.', 25000, 5, [e('prestige.held_open', 'add', 0.5)]),
  node(4, 'relay_fire', 'Relay Fire', 'Every tenth drone attack also fires the primary at that drone\'s target.', 30000, 1),
  node(4, 'autonomy', 'Autonomy', 'Unlocks the Auto-Prestige Directive action and Adept conditions that read boss tells.', 50000, 1),
  node(4, 'paradox_pool', 'Paradox Pool', 'Paradox Anomalies appear 50% more often per rank in drafts.', 40000, 3, [e('prestige.paradox_pool', 'add', 0.5)]),
];
