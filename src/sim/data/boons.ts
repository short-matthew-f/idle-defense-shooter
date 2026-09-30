/**
 * Boons: attempt-scoped rewards (docs/BOONS.md). Three are offered at the start of every attempt except the
 * first of a Prestige, and after each boss the tower clears; the player picks one, rerolls or declines. Up to
 * BOON_CAP are active at once; every boon ends with the attempt.
 *
 * Sizing: about one to three Scrap-upgrade ranks' worth (Caliber is +8% primary damage per rank, Autoloader
 * +5% attack speed per rank, Hull Plating +15 max HP per rank). The Boon cap acceptance row (sim-cli) checks
 * that no single boon raises the idle Generalist's mean deepest wave by more than 10%.
 *
 * Every number lives in BOON_TUNING. Stat boons resolve through `effects` in core/stats.ts (additive-multiplier
 * convention: a `mul` effect adds to the key's multiplier sum, exactly like an upgrade rank). Mechanical boons
 * carry `flag` and live in systems/boons.ts. `desc` and `short` are built from the same numbers, so they always
 * state what is implemented (tests/core/boons.test.ts checks the stat ones against `stats.get`).
 */
import type { AbilityId, BoonId } from '../core/ids';
import type { BoonDef, StatEffect } from './schema';
import { fx } from './builders';

const ABILITY_IDS: readonly AbilityId[] = [
  'hunter_mark', 'repulsor_pulse', 'time_field', 'bombardment', 'emp',
  'overdrive', 'emergency_repair', 'drone_surge', 'missile_storm', 'singularity_bomb',
];
/** The same CE-cost change on every tactical ability (`ability.<id>.cost_mul`). */
function abilityCost(mul: number): StatEffect[] { return ABILITY_IDS.map((id) => fx(`ability.${id}.cost_mul`, 'mul', mul)); }

/** Active boons per attempt; picking at the cap replaces the oldest (or the one the player names). */
export const BOON_CAP = 4;
/** Offers waiting behind the current one (boss clears while an offer is pending); the oldest drops beyond this. */
export const BOON_QUEUE_CAP = 3;

/** Every boon number (stat and mechanical). Descriptions below quote these. */
export const BOON_TUNING = {
  // stat surges
  overcharge: { damage: 0.25 },
  hair_trigger: { attackSpeed: 0.2 },
  long_sight: { range: 0.25 },
  thick_plating: { maxHp: 0.2 },
  ablative_shell: { shieldFrac: 0.12 },
  second_wind: { heal: 0.06 },
  scrap_magnet: { scrap: 0.15 },
  quick_hands: { cost: 0.25 },
  deep_reserves: { ce: 50 },
  lucky_streak: { crit: 0.1 },
  heavy_hits: { critMul: 0.2 },
  iron_skin: { armor: 10 },
  // behavior twists
  encore: { delaySeconds: 0.5, radius: 80, minPrimaryMul: 3 },
  forked_arc: { range: 120, fraction: 0.5, perTick: 8 },
  ricochet_rounds: { range: 100, fraction: 0.5, perTick: 8 },
  volatile_kills: { fraction: 0.15, radius: 60, perTick: 12 },
  static_field: { radius: 40, seconds: 2, dpsFraction: 0.25, everySeconds: 0.5 },
  frostbite: { stacks: 1 },
  wildfire_seed: { stacks: 1, targets: 1, range: 80, seconds: 3 },
  toxic_bloom: { radius: 50, seconds: 3, dpsFraction: 0.08, maxClouds: 16 },
  rally_drones: { rateBonus: 0.4, seconds: 2 },
  sharpened_edge: { bonus: 0.3 },
  focus_beam: { perSecond: 0.1, max: 0.5, graceSeconds: 0.25 },
  anchor_well: { lifeMul: 2 },
  // trades
  glass_hour: { damage: 0.15, heal: 0.5 },
  berserk: { attackSpeed: 0.4, maxHp: 0.25 },
  miser: { scrap: 0.6, damage: 0.15 },
  reckless: { cost: 0.4, cooldown: 0.3 },
  bulwark: { maxHp: 0.5, attackSpeed: 0.15 },
  slow_and_sure: { damage: 0.15, attackSpeed: 0.15 },
  overclocked: { cooldown: 0.15, damageTaken: 0.2 },
  hunters_gambit: { boss: 1.4, other: 0.8 },
  // wild cards
  stopwatch: { slow: 0.1 },
  second_chance: { invulnSeconds: 3 },
  windfall: { cores: 1 },
  trophy_hunter: { perKill: 0.005, max: 0.05 },
};

const T = BOON_TUNING;
/** 0.25 → "25%". */
export const pct = (f: number): string => `${Math.round(f * 1000) / 10}%`;

export const BOONS: BoonDef[] = [
  // ---------------------------------------------------------------- stat surges (the first offer of a Prestige draws only these)
  { id: 'overcharge', name: 'Overcharge', category: 'surge', rarity: 'common', value: 3,
    short: `+${pct(T.overcharge.damage)} primary damage`,
    desc: `+${pct(T.overcharge.damage)} primary damage (adds to the Caliber bonus, like about three ranks).`,
    effects: [fx('ballistics.damage', 'mul', T.overcharge.damage)] },
  { id: 'hair_trigger', name: 'Hair Trigger', category: 'surge', rarity: 'common', value: 3,
    short: `+${pct(T.hair_trigger.attackSpeed)} primary attack speed`,
    desc: `+${pct(T.hair_trigger.attackSpeed)} primary attack speed.`, effects: [fx('ballistics.attack_speed', 'mul', T.hair_trigger.attackSpeed)] },
  { id: 'long_sight', name: 'Long Sight', category: 'surge', rarity: 'common', value: 2,
    short: `+${pct(T.long_sight.range)} primary range`,
    desc: `+${pct(T.long_sight.range)} primary range.`, effects: [fx('ballistics.range', 'mul', T.long_sight.range)] },
  { id: 'thick_plating', name: 'Thick Plating', category: 'surge', rarity: 'common', value: 3,
    short: `+${pct(T.thick_plating.maxHp)} max HP`,
    desc: `+${pct(T.thick_plating.maxHp)} max HP.`, effects: [fx('bastion.max_hp', 'mul', T.thick_plating.maxHp)] },
  { id: 'ablative_shell', name: 'Ablative Shell', category: 'surge', rarity: 'rare', value: 3,
    short: `Shield: ${pct(T.ablative_shell.shieldFrac)} of max HP`,
    desc: `A shield worth ${pct(T.ablative_shell.shieldFrac)} of max HP. It refills between waves and recharges after 3 s without damage.`,
    effects: [fx('bastion.shield_hp_frac', 'add', T.ablative_shell.shieldFrac)] },
  { id: 'second_wind', name: 'Second Wind', category: 'surge', rarity: 'common', value: 2,
    short: `+${pct(T.second_wind.heal)} HP healed between waves`,
    desc: `Heal ${pct(T.second_wind.heal)} more of max HP between waves (25% becomes ${pct(0.25 + T.second_wind.heal)}).`, effects: [fx('bastion.between_wave_heal', 'add', T.second_wind.heal)] },
  { id: 'scrap_magnet', name: 'Scrap Magnet', category: 'surge', rarity: 'common', value: 2,
    short: `+${pct(T.scrap_magnet.scrap)} Scrap`,
    desc: `+${pct(T.scrap_magnet.scrap)} Scrap from every source.`, effects: [fx('economy.scrap_mul', 'mul', T.scrap_magnet.scrap)] },
  { id: 'quick_hands', name: 'Quick Hands', category: 'surge', rarity: 'common', value: 2,
    short: `Abilities cost ${pct(T.quick_hands.cost)} less CE`,
    desc: `Tactical abilities cost ${pct(T.quick_hands.cost)} less Command Energy.`, effects: abilityCost(-T.quick_hands.cost) },
  { id: 'deep_reserves', name: 'Deep Reserves', category: 'surge', rarity: 'common', value: 2,
    short: `+${T.deep_reserves.ce} Command Energy cap`,
    desc: `+${T.deep_reserves.ce} Command Energy cap.`, effects: [fx('economy.ce_cap', 'add', T.deep_reserves.ce)] },
  { id: 'lucky_streak', name: 'Lucky Streak', category: 'surge', rarity: 'rare', value: 3,
    short: `+${pct(T.lucky_streak.crit)} primary crit chance`,
    desc: `+${pct(T.lucky_streak.crit)} primary crit chance (5% base).`, effects: [fx('ballistics.crit_chance', 'add', T.lucky_streak.crit)] },
  { id: 'heavy_hits', name: 'Heavy Hits', category: 'surge', rarity: 'common', value: 2,
    short: `Crit multiplier +${T.heavy_hits.critMul}`,
    desc: `Primary crit multiplier +${T.heavy_hits.critMul} (×1.5 becomes ×${1.5 + T.heavy_hits.critMul}).`, effects: [fx('ballistics.crit_damage', 'add', T.heavy_hits.critMul)] },
  { id: 'iron_skin', name: 'Iron Skin', category: 'surge', rarity: 'common', value: 2,
    short: `+${T.iron_skin.armor} armor`,
    desc: `+${T.iron_skin.armor} armor: every hit is cut by armor ÷ (100 + armor) (${pct(T.iron_skin.armor / (100 + T.iron_skin.armor))} with no other armor).`,
    effects: [fx('bastion.armor', 'add', T.iron_skin.armor)] },

  // ---------------------------------------------------------------- behavior twists
  { id: 'encore', name: 'Encore', category: 'twist', rarity: 'rare', value: 3, needs: ['fusion'], flag: 'encore', effects: [],
    short: 'First Fusion a wave echoes',
    desc: `Your first Fusion reaction each wave fires again ${T.encore.delaySeconds} s later as a ${T.encore.radius}-unit blast of the same damage (at least ${T.encore.minPrimaryMul}× primary damage).` },
  { id: 'forked_arc', name: 'Forked Arc', category: 'twist', rarity: 'common', value: 3, flag: 'forked_arc', effects: [],
    short: `Crits arc on for ${pct(T.forked_arc.fraction)}`,
    desc: `Primary crits arc to one more enemy within ${T.forked_arc.range} units for ${pct(T.forked_arc.fraction)} of the hit.` },
  { id: 'ricochet_rounds', name: 'Ricochet Rounds', category: 'twist', rarity: 'common', value: 3, flag: 'ricochet_rounds', effects: [],
    short: `Kill shots fly on for ${pct(T.ricochet_rounds.fraction)}`,
    desc: `A primary shot that kills flies on to the nearest enemy within ${T.ricochet_rounds.range} units for ${pct(T.ricochet_rounds.fraction)} of its damage.` },
  { id: 'volatile_kills', name: 'Volatile Kills', category: 'twist', rarity: 'rare', value: 4, flag: 'volatile_kills', effects: [],
    short: `Kills explode: ${pct(T.volatile_kills.fraction)} max HP`,
    desc: `Enemies explode when they die: ${pct(T.volatile_kills.fraction)} of their max HP in a ${T.volatile_kills.radius}-unit blast.` },
  { id: 'static_field', name: 'Static Field', category: 'twist', rarity: 'common', value: 3, needs: ['lightning'], flag: 'static_field', effects: [],
    short: `Lightning: ${T.static_field.seconds} s shock field`,
    desc: `Lightning hits leave a ${T.static_field.radius}-unit field for ${T.static_field.seconds} s that deals ${pct(T.static_field.dpsFraction)} of the hit per second (one every ${T.static_field.everySeconds} s).` },
  { id: 'frostbite', name: 'Frostbite', category: 'twist', rarity: 'common', value: 3, needs: ['frost'], flag: 'frostbite', effects: [],
    short: `+${T.frostbite.stacks} Chill stack per Chill`,
    desc: `Every Chill you apply adds ${T.frostbite.stacks} extra stack.` },
  { id: 'wildfire_seed', name: 'Wildfire Seed', category: 'twist', rarity: 'common', value: 3, needs: ['fire'], flag: 'wildfire_seed', effects: [],
    short: 'Burn spreads on death',
    desc: `Burning enemies that die pass ${T.wildfire_seed.stacks} Burn stack${T.wildfire_seed.stacks === 1 ? '' : 's'} (${T.wildfire_seed.seconds} s) to ${T.wildfire_seed.targets === 1 ? 'one enemy' : `up to ${T.wildfire_seed.targets} enemies`} within ${T.wildfire_seed.range} units.` },
  { id: 'toxic_bloom', name: 'Toxic Bloom', category: 'twist', rarity: 'common', value: 3, needs: ['poison'], flag: 'toxic_bloom', effects: [],
    short: `Poison deaths leave ${T.toxic_bloom.seconds} s clouds`,
    desc: `Poisoned enemies that die leave a ${T.toxic_bloom.radius}-unit cloud for ${T.toxic_bloom.seconds} s that deals ${pct(T.toxic_bloom.dpsFraction)} of their max HP per second.` },
  { id: 'rally_drones', name: 'Rally Drones', category: 'twist', rarity: 'common', value: 3, needs: ['drones'], flag: 'rally_drones', effects: [],
    short: `Kills: drones +${pct(T.rally_drones.rateBonus)} for ${T.rally_drones.seconds} s`,
    desc: `After any kill, drones fire ${pct(T.rally_drones.rateBonus)} faster for ${T.rally_drones.seconds} s.` },
  { id: 'sharpened_edge', name: 'Sharpened Edge', category: 'twist', rarity: 'common', value: 3, needs: ['blade'], flag: 'sharpened_edge', effects: [],
    short: `Blade +${pct(T.sharpened_edge.bonus)} vs elites, bosses`,
    desc: `The Orbital Blade deals ${pct(T.sharpened_edge.bonus)} more damage to elites and bosses.` },
  { id: 'focus_beam', name: 'Focus Beam', category: 'twist', rarity: 'common', value: 3, needs: ['laser'], flag: 'focus_beam', effects: [],
    short: `Laser ramps up to +${pct(T.focus_beam.max)}`,
    desc: `Laser damage on an enemy grows ${pct(T.focus_beam.perSecond)} per second of contact, up to +${pct(T.focus_beam.max)}.` },
  { id: 'anchor_well', name: 'Anchor Well', category: 'twist', rarity: 'common', value: 2, needs: ['gravitics'], flag: 'anchor_well', effects: [],
    short: `First well a wave lasts ${T.anchor_well.lifeMul}×`,
    desc: `The first gravity well each wave lasts ${T.anchor_well.lifeMul}× as long.` },

  // ---------------------------------------------------------------- trades
  { id: 'glass_hour', name: 'Glass Hour', category: 'trade', rarity: 'rare', value: 4,
    short: `+${pct(T.glass_hour.damage)} damage, half healing`,
    desc: `+${pct(T.glass_hour.damage)} damage from every source; healing between waves is cut by ${pct(T.glass_hour.heal)}.`,
    effects: [fx('combat.power_mul', 'mul', T.glass_hour.damage), fx('bastion.between_wave_heal', 'mul', -T.glass_hour.heal)] },
  { id: 'berserk', name: 'Berserk', category: 'trade', rarity: 'common', value: 4,
    short: `+${pct(T.berserk.attackSpeed)} attack speed, −${pct(T.berserk.maxHp)} HP`,
    desc: `+${pct(T.berserk.attackSpeed)} attack speed for every weapon; −${pct(T.berserk.maxHp)} max HP.`,
    effects: [fx('reactor.global_attack_speed', 'mul', T.berserk.attackSpeed), fx('bastion.max_hp_final', 'mul', -T.berserk.maxHp)] },
  { id: 'miser', name: 'Miser', category: 'trade', rarity: 'common', value: 2,
    short: `+${pct(T.miser.scrap)} Scrap, −${pct(T.miser.damage)} damage`,
    desc: `+${pct(T.miser.scrap)} Scrap from every source; −${pct(T.miser.damage)} damage.`,
    effects: [fx('economy.scrap_mul', 'mul', T.miser.scrap), fx('combat.power_mul', 'mul', -T.miser.damage)] },
  { id: 'reckless', name: 'Reckless', category: 'trade', rarity: 'common', value: 2,
    short: `−${pct(T.reckless.cost)} CE cost, +${pct(T.reckless.cooldown)} cooldowns`,
    desc: `Tactical abilities cost ${pct(T.reckless.cost)} less Command Energy but take ${pct(T.reckless.cooldown)} longer to cool down.`,
    effects: [...abilityCost(-T.reckless.cost), fx('reactor.command.cooldowns', 'add', -T.reckless.cooldown)] },
  { id: 'bulwark', name: 'Bulwark', category: 'trade', rarity: 'common', value: 3,
    short: `+${pct(T.bulwark.maxHp)} HP, −${pct(T.bulwark.attackSpeed)} attack speed`,
    desc: `+${pct(T.bulwark.maxHp)} max HP; −${pct(T.bulwark.attackSpeed)} attack speed for every weapon.`,
    effects: [fx('bastion.max_hp', 'mul', T.bulwark.maxHp), fx('reactor.global_attack_speed', 'mul', -T.bulwark.attackSpeed)] },
  { id: 'slow_and_sure', name: 'Slow and Sure', category: 'trade', rarity: 'common', value: 3,
    short: `+${pct(T.slow_and_sure.damage)} damage, −${pct(T.slow_and_sure.attackSpeed)} attack speed`,
    desc: `+${pct(T.slow_and_sure.damage)} damage from every source; −${pct(T.slow_and_sure.attackSpeed)} attack speed for every weapon.`,
    effects: [fx('combat.power_mul', 'mul', T.slow_and_sure.damage), fx('reactor.global_attack_speed', 'mul', -T.slow_and_sure.attackSpeed)] },
  { id: 'overclocked', name: 'Overclocked', category: 'trade', rarity: 'rare', value: 3,
    short: `Cooldowns −${pct(T.overclocked.cooldown)}, damage taken +${pct(T.overclocked.damageTaken)}`,
    desc: `Hardpoint and ability cooldowns −${pct(T.overclocked.cooldown)}; the tower takes ${pct(T.overclocked.damageTaken)} more damage.`,
    effects: [fx('reactor.cooldown_reduction', 'add', T.overclocked.cooldown), fx('bastion.damage_taken_mul', 'add', T.overclocked.damageTaken)] },
  { id: 'hunters_gambit', name: "Hunter's Gambit", category: 'trade', rarity: 'rare', value: 3, flag: 'hunters_gambit', effects: [],
    short: `+${pct(T.hunters_gambit.boss - 1)} vs bosses, −${pct(1 - T.hunters_gambit.other)} others`,
    desc: `+${pct(T.hunters_gambit.boss - 1)} damage to bosses; −${pct(1 - T.hunters_gambit.other)} damage to every other enemy.` },

  // ---------------------------------------------------------------- wild cards
  { id: 'stopwatch', name: 'Stopwatch', category: 'wild', rarity: 'common', value: 3, flag: 'stopwatch', effects: [],
    short: `Enemies move ${pct(T.stopwatch.slow)} slower`,
    desc: `Enemies move ${pct(T.stopwatch.slow)} slower. It stacks with Chill; a stronger field slow (Time Field) replaces it.` },
  { id: 'second_chance', name: 'Second Chance', category: 'wild', rarity: 'rare', value: 4, flag: 'second_chance', effects: [],
    short: 'Survive one lethal blow',
    desc: `Once per attempt: a blow that would destroy the tower leaves it at 1 HP with ${T.second_chance.invulnSeconds} s of invulnerability. Then it is used up and frees its slot.` },
  { id: 'windfall', name: 'Windfall', category: 'wild', rarity: 'common', value: 2, flag: 'windfall', effects: [],
    short: `Next boss kill: +${T.windfall.cores} Core`,
    desc: `The next boss you kill drops ${T.windfall.cores} extra Core. Then it is used up and frees its slot.` },
  { id: 'trophy_hunter', name: 'Trophy Hunter', category: 'wild', rarity: 'rare', value: 3, flag: 'trophy_hunter', effects: [],
    short: `Elite kills: +${pct(T.trophy_hunter.perKill)} damage each`,
    desc: `Every elite or boss you kill adds +${pct(T.trophy_hunter.perKill)} damage for the rest of the attempt, up to +${pct(T.trophy_hunter.max)}.` },
];

/** Category display names (UI, docs). */
export const BOON_CATEGORY_NAME: Record<BoonDef['category'], string> = { surge: 'Surge', twist: 'Twist', trade: 'Trade', wild: 'Wild card' };

export const BOON_IDS: readonly BoonId[] = BOONS.map((b) => b.id);
