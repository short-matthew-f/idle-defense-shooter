/**
 * Chassis trees (design §5): Ballistics (primary weapon), Bastion (survival),
 * Reactor (system-wide behavior, economy, and the ten ability rank nodes).
 * Always available regardless of Frame.
 */
import type { TreeDef } from './schema';
import { doctrine, exotic, flat, fx, mech, stat } from './builders';
import { ABILITY_RANK_NODES } from './abilities';

const DOC_BASE = 200;   // doctrine stat nodes: stat-priced from 200 Scrap
const DOC_G = 1.18;
// Some doctrine stat nodes also write a canonical key the core already reads
// (bastion.max_hp, bastion.armor, reactor.global_attack_speed, reactor.cooldown_reduction,
// economy.scrap_mul, economy.boss_scrap_mul, economy.ce_cap). Their own key is then
// informational (Codex / UI); systems must NOT apply it a second time.

// ---------------------------------------------------------------------------
// Ballistics
// ---------------------------------------------------------------------------
export const BALLISTICS: TreeDef = {
  id: 'ballistics', name: 'Ballistics', category: 'chassis', forkRequirement: 4,
  shared: [
    stat('ballistics.damage', 'Caliber', '+8% primary damage per rank (base 10 per shot).', 'mul', 0.08, 10, 1.17, 60, 0, { tags: ['damage'] }),
    stat('ballistics.attack_speed', 'Autoloader', '+5% primary attack speed per rank (base 2 shots/s).', 'mul', 0.05, 12, 1.17, 60, 0, { tags: ['speed'] }),
    stat('ballistics.range', 'Long Barrel', '+10 primary range per rank (base 300).', 'add', 10, 15, 1.18, 25, 0, { tags: ['range'] }),
    stat('ballistics.projectile_speed', 'Muzzle Velocity', '+6% projectile speed per rank, so shots land before fast targets slip away.', 'mul', 0.06, 8, 1.16, 25),
    stat('ballistics.crit_chance', 'Fire Control', '+1% critical hit chance per rank (base 5%).', 'add', 0.01, 20, 1.19, 35, 0, { tags: ['damage'] }),
    stat('ballistics.crit_damage', 'Hollow Points', '+10% critical damage per rank (base ×1.5).', 'add', 0.1, 25, 1.19, 35, 0, { tags: ['damage'] }),
    stat('ballistics.target_acquisition', 'Target Acquisition', 'The turret swings to its next target 5% faster per rank and leads moving enemies more accurately.', 'add', 0.05, 12, 1.17, 20, 0, { tags: ['speed'] }),
    mech('ballistics.execution', 'Execution',
      '+15% primary damage per rank against enemies below 30% HP. Every primary kill refunds 1 Command Energy per rank.',
      1, flat(1, 3), [fx('ballistics.execution', 'add', 0.15), fx('ballistics.execution.ce_refund', 'add', 1)],
      { requires: ['ballistics.damage'], tags: ['damage', 'active'] }),
  ],
  doctrines: [
    doctrine('ballistics', 'multishot', 'Multishot', 'Two to five projectiles per shot; the damage penalty shrinks with ranks.', [
      mech('ballistics.multishot.count', 'Extra Barrels',
        'Multishot fires 2 projectiles per shot; +1 per rank (up to 5). Projectiles fan out in a 20° spread.',
        2, flat(2, 4), [fx('ballistics.multishot.count', 'add', 1)]),
      stat('ballistics.multishot.penalty', 'Barrel Harmonics',
        'With 2 or more projectiles, each deals 35% less damage. Each rank lowers the penalty by 1.5 points (to 20% at max rank).',
        'add', -0.015, DOC_BASE, DOC_G, 20, 2),
      mech('ballistics.multishot.split_sight', 'Split Sight',
        'Extra projectiles stop fanning out: each one picks its own target in range, nearest first.',
        3, flat(3, 1)),
    ]),
    doctrine('ballistics', 'piercing', 'Piercing', 'More penetration, less damage lost per target, and speed gained per pierce.', [
      mech('ballistics.piercing.count', 'Penetrator Core',
        'Piercing shots pass through 1 enemy; +1 per rank (up to 4).',
        2, flat(2, 4), [fx('ballistics.piercing.count', 'add', 1)]),
      stat('ballistics.piercing.retention', 'Sabot Jacket',
        'Shots keep 50% of their damage after each enemy pierced; +2 points per rank.',
        'add', 0.02, DOC_BASE, DOC_G, 20, 2),
      stat('ballistics.piercing.velocity', 'Slipstream',
        'Each enemy pierced speeds the shot up by 3% per rank and adds the same bonus to its damage.',
        'add', 0.03, DOC_BASE, DOC_G, 20, 2),
      mech('ballistics.piercing.last_rites', 'Last Rites',
        'The final enemy a shot pierces takes ×4 damage.',
        3, flat(3, 1)),
    ]),
    doctrine('ballistics', 'ricochet', 'Ricochet', 'Shots bounce between enemies; bounce count and range scale.', [
      mech('ballistics.ricochet.bounces', 'Rebound Rounds',
        'Ricochet shots bounce once to a new enemy after impact; +1 bounce per rank (up to 4). Each bounce keeps 80% damage.',
        2, flat(2, 4), [fx('ballistics.ricochet.bounces', 'add', 1)]),
      stat('ballistics.ricochet.range', 'Deflector Geometry',
        'Bounces seek a new enemy up to 120 units away; +8 units per rank.',
        'add', 8, DOC_BASE, DOC_G, 20, 2),
      mech('ballistics.ricochet.return_fire', 'Return Fire',
        'When no new target is in reach, bounces revisit enemies they already struck instead of ending.',
        3, flat(3, 1)),
    ]),
    doctrine('ballistics', 'heavy_rounds', 'Heavy Rounds', 'Fires 15% slower for +90% damage; rounds grow larger (×2.5), hit harder and knock enemies back.', [
      stat('ballistics.heavy.damage', 'Depleted Core',
        '+6% Heavy Round damage per rank, on top of the doctrine\'s inherent ×1.9.',
        'mul', 0.06, DOC_BASE, DOC_G, 25, 2),
      stat('ballistics.heavy.size', 'Wide Bore',
        'Heavy Rounds are 4% larger per rank (on top of the inherent ×2.5), clipping enemies beside the target.',
        'mul', 0.04, DOC_BASE, DOC_G, 20, 2),
      stat('ballistics.heavy.knockback', 'Impact Mass',
        'Heavy Round impacts shove enemies back 4 more units per rank (inherent 18).',
        'add', 4, DOC_BASE, DOC_G, 20, 2),
      mech('ballistics.heavy.staggerhead', 'Staggerhead',
        'Heavy Round impacts stagger elites for 0.6 s and interrupt boss casts (each boss can be interrupted once per 4 s).',
        3, flat(3, 1), [], { requires: ['ballistics.heavy.damage'] }),
    ]),
  ],
  exotic: exotic('ballistics.gunstorm', 'Gunstorm',
    'Every 8th primary attack fires a 6-round burst from every barrel at once; each round rolls its own crit.'),
};

// ---------------------------------------------------------------------------
// Bastion
// ---------------------------------------------------------------------------
export const BASTION: TreeDef = {
  id: 'bastion', name: 'Bastion', category: 'chassis', forkRequirement: 3,
  shared: [
    stat('bastion.max_hp', 'Hull Plating', '+15 max HP per rank (base 100).', 'add', 15, 10, 1.16, 60, 0, { tags: ['defense'] }),
    stat('bastion.armor', 'Composite Armor', '+2 armor per rank. Each hit is reduced by armor / (100 + armor).', 'add', 2, 15, 1.17, 35, 0, { tags: ['defense'] }),
    stat('bastion.shield_capacity', 'Shield Emitter', '+10 shield capacity per rank. Shields absorb damage before HP.', 'add', 10, 20, 1.17, 35, 0, { tags: ['defense'] }),
    stat('bastion.shield_recharge', 'Capacitor Bank', 'Shields recharge 1 point per second per rank after 3 s without taking damage.', 'add', 1, 20, 1.18, 30, 0, { tags: ['defense'] }),
    stat('bastion.regeneration', 'Nanite Weave', 'The tower regenerates 0.4 HP per second per rank.', 'add', 0.4, 15, 1.17, 35, 0, { tags: ['defense'] }),
    stat('bastion.resistance', 'Ablative Coating', 'All incoming damage −2% per rank, applied after armor (max 36%).', 'add', 0.02, 25, 1.19, 35, 0, { tags: ['defense'] }),
  ],
  doctrines: [
    doctrine('bastion', 'fortress', 'Fortress', 'HP and armor; Fortification builds temporary HP while the tower is at full health.', [
      stat('bastion.fortress.hp', 'Bulkheads', '+5% max HP per rank.', 'mul', 0.05, DOC_BASE, DOC_G, 30, 2, { tags: ['defense'], effects: [fx('bastion.max_hp', 'mul', 0.05)] }),
      stat('bastion.fortress.armor', 'Reinforced Frame', '+5% armor per rank.', 'mul', 0.05, DOC_BASE, DOC_G, 30, 2, { tags: ['defense'], effects: [fx('bastion.armor', 'mul', 0.05)] }),
      mech('bastion.fortress.fortification', 'Fortification',
        'While at full HP, the tower builds temporary HP at 2% of max HP per second, up to 10% of max HP per rank.',
        2, flat(2, 3), [fx('bastion.fortress.fortification', 'add', 0.1)], { tags: ['defense'] }),
      mech('bastion.fortress.keep', 'Keep',
        'Healing beyond max HP becomes a barrier, up to 25% of max HP. The barrier does not decay.',
        3, flat(3, 1), [], { requires: ['bastion.fortress.fortification'] }),
    ]),
    doctrine('bastion', 'aegis', 'Aegis', 'An Outer Barrier holds enemies at range; Shockwave Shield pushes them back when it breaks.', [
      stat('bastion.aegis.barrier', 'Outer Barrier',
        'Projects a barrier 70 units out that absorbs contact hits and enemy shots; +20 barrier HP per rank. It restores 10% per second after 5 s untouched.',
        'add', 20, DOC_BASE, DOC_G, 30, 2, { tags: ['defense'] }),
      mech('bastion.aegis.shockwave_shield', 'Shockwave Shield',
        'When the barrier breaks, it releases a shockwave that pushes enemies 60 units per rank and deals 50% of the barrier\'s max HP as damage.',
        2, flat(2, 3), [fx('bastion.aegis.shockwave_shield', 'add', 60)], { requires: ['bastion.aegis.barrier'] }),
      mech('bastion.aegis.mirror_aegis', 'Mirror Aegis',
        'Enemy projectiles striking the barrier are reflected back at their shooter for 100% of their damage.',
        3, flat(3, 1)),
    ]),
    doctrine('bastion', 'thorns', 'Thorns', 'Retaliation punishes every hit; Reactive Armor hardens under fire.', [
      stat('bastion.thorns.retaliation', 'Retaliation',
        'Enemies that damage the tower take 15% per rank of the damage it took (after armor), plus 1 per point of armor.',
        'add', 0.15, DOC_BASE, DOC_G, 30, 2, { tags: ['defense', 'damage'] }),
      mech('bastion.thorns.reactive_armor', 'Reactive Armor',
        'Each hit taken grants +10% armor per rank for 3 s, stacking up to 5 times.',
        2, flat(2, 3), [fx('bastion.thorns.reactive_armor', 'add', 0.1)], { tags: ['defense'] }),
      mech('bastion.thorns.spite', 'Spite',
        'Retaliation damage chains to a second enemy within 120 units at 60% strength.',
        3, flat(3, 1)),
    ]),
    doctrine('bastion', 'phoenix', 'Phoenix', 'Last Stand: the tower hits harder the closer it is to death.', [
      stat('bastion.phoenix.last_stand', 'Last Stand',
        'All damage +2% per rank for every 10% of HP missing.',
        'add', 0.02, DOC_BASE, DOC_G, 30, 2, { tags: ['damage'] }),
      mech('bastion.phoenix.rekindle', 'Rekindle',
        'The first time each wave HP drops below 50%, the tower heals 8% of max HP per rank over 4 s.',
        2, flat(2, 3), [fx('bastion.phoenix.rekindle', 'add', 0.08)], { tags: ['defense'] }),
      mech('bastion.phoenix.ember_heart', 'Ember Heart',
        'Below 25% HP, every weapon system gains +30% speed.',
        3, flat(3, 1)),
    ]),
  ],
  exotic: exotic('bastion.second_core', 'Second Core',
    'Once per wave, damage that would destroy the tower leaves it at 1 HP with 3 s of invulnerability.', [], { tags: ['defense'] }),
};

// ---------------------------------------------------------------------------
// Reactor
// ---------------------------------------------------------------------------
export const REACTOR: TreeDef = {
  id: 'reactor', name: 'Reactor', category: 'chassis', forkRequirement: 3,
  shared: [
    stat('reactor.global_attack_speed', 'Clock Multiplier', '+3% attack speed per rank for the primary, the missile rack and drones (the blade and laser Pulse gain it through Flywheel and Pulse Clock).', 'mul', 0.03, 30, 1.19, 30, 0, { tags: ['speed'] }),
    stat('reactor.cooldown_reduction', 'Heat Sinks', 'Hardpoint cooldowns (reloads, well cooldowns, pulses) and tactical ability cooldowns −1% per rank.', 'add', 0.01, 25, 1.18, 30, 0, { tags: ['speed'] }),
    stat('reactor.energy_recycling', 'Energy Recycling', '+5% Command Energy gained from every source per rank.', 'add', 0.05, 20, 1.18, 25, 0, { tags: ['active'] }),
    mech('reactor.targeting_logic', 'Targeting Logic',
      'Rank 1: weapons skip enemies already doomed by damage in flight. Rank 2: every system leads moving targets. Rank 3: hardpoints spread across distinct targets instead of stacking on one.',
      1, flat(1, 3), [fx('reactor.targeting_logic', 'add', 1)]),
    ...Object.values(ABILITY_RANK_NODES),
  ],
  doctrines: [
    doctrine('reactor', 'overclock', 'Overclock', 'Global speed and cooldowns.', [
      stat('reactor.overclock.speed', 'Overclock', '+3% attack speed per rank for the primary, the missile rack and drones (stacks with Clock Multiplier).', 'mul', 0.03, DOC_BASE, DOC_G, 30, 2, { tags: ['speed'], effects: [fx('reactor.global_attack_speed', 'mul', 0.03)] }),
      stat('reactor.overclock.cooldowns', 'Coolant Loop', 'Hardpoint and ability cooldowns −1.5% per rank.', 'add', 0.015, DOC_BASE, DOC_G, 25, 2, { tags: ['speed'], effects: [fx('reactor.cooldown_reduction', 'add', 0.015)] }),
      mech('reactor.overclock.overdrive_core', 'Overdrive Core',
        'Every 30 s, the reactor overdrives for 5 s: +50% speed for every weapon system.',
        3, flat(3, 1)),
    ]),
    doctrine('reactor', 'salvage', 'Salvage', 'The idle, fast-Prestige doctrine: about −15% combat power for +35% Scrap income.', [
      mech('reactor.salvage.income', 'Salvage Protocol',
        'Reroute power to reclamation: +35% Scrap from every source, −15% damage from every system.',
        2, flat(2, 1), [fx('economy.scrap_mul', 'add', 0.35), fx('combat.power_mul', 'mul', -0.15)], { tags: ['economy'] }),
      stat('reactor.salvage.reclamation', 'Reclamation', '+3% Scrap from every source per rank.', 'mul', 0.03, DOC_BASE, DOC_G, 30, 2, { requires: ['reactor.salvage.income'], tags: ['economy'], effects: [fx('economy.scrap_mul', 'add', 0.03)] }),
      stat('reactor.salvage.boss_scavenging', 'Boss Scavenging', 'Bosses and elites drop +10% Scrap per rank.', 'add', 0.1, DOC_BASE, DOC_G, 25, 2, { requires: ['reactor.salvage.income'], tags: ['economy'], effects: [fx('economy.boss_scrap_mul', 'add', 0.1)] }),
      mech('reactor.salvage.checkpoint_dividend', 'Checkpoint Dividend',
        'The first reach of each checkpoint in a Prestige pays a dividend of 50% per rank of that boss wave\'s kill Scrap.',
        2, flat(2, 3), [fx('reactor.salvage.checkpoint_dividend', 'add', 0.5)], { requires: ['reactor.salvage.income'], tags: ['economy'] }),
      mech('reactor.salvage.strip_mine', 'Strip Mine',
        'First clears of a wave pay ×4 Scrap instead of ×3.',
        3, flat(3, 1), [fx('economy.first_clear_mul', 'set', 4)], { requires: ['reactor.salvage.income'], tags: ['economy'] }),
    ]),
    doctrine('reactor', 'synchronization', 'Synchronization', 'Combo bonus when two or more systems hit the same target within a short window.', [
      stat('reactor.sync.combo', 'Combo Matrix',
        'When 2+ systems hit the same enemy within the combo window, it takes +4% damage per rank for each extra system.',
        'add', 0.04, DOC_BASE, DOC_G, 30, 2, { tags: ['damage'] }),
      stat('reactor.sync.window', 'Phase Lock', 'The combo window lasts 0.5 s; +0.05 s per rank.', 'add', 0.05, DOC_BASE, DOC_G, 20, 2),
      mech('reactor.sync.harmonic_lock', 'Harmonic Lock',
        'When 4+ systems land a combo on one enemy, it takes +50% damage from all sources for 3 s.',
        3, flat(3, 1)),
    ]),
    doctrine('reactor', 'command', 'Command', 'The active-play doctrine: Command Energy cap and regeneration, faster tactical cooldowns.', [
      stat('reactor.command.ce_cap', 'Capacitor Array', '+10 Command Energy cap per rank.', 'add', 10, DOC_BASE, DOC_G, 25, 2, { tags: ['active'], effects: [fx('economy.ce_cap', 'add', 10)] }),
      stat('reactor.command.ce_regen', 'Trickle Charge', 'Regenerate 0.25 Command Energy per second per rank during combat.', 'add', 0.25, DOC_BASE, DOC_G, 25, 2, { tags: ['active'] }),
      stat('reactor.command.cooldowns', 'Tactical Drill', 'Tactical ability cooldowns −2% per rank.', 'add', 0.02, DOC_BASE, DOC_G, 20, 2, { tags: ['active'] }),
      mech('reactor.command.fourth_slot', 'Fourth Slot',
        'Unlocks a fourth tactical ability slot.',
        3, flat(3, 1), [], { tags: ['active'] }),
    ]),
  ],
  exotic: exotic('reactor.critical_mass', 'Critical Mass',
    'While more than 25 enemies are alive, every weapon system gains +2% speed per enemy above 25, up to +40%.', [], { tags: ['speed'] }),
};

export const CHASSIS_TREES: TreeDef[] = [BALLISTICS, BASTION, REACTOR];
