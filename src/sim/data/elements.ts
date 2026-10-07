/**
 * Element trees (design §6). An attuned element attaches to the primary weapon
 * natively, opens its tree, its Infusions (infusions.ts) and any Fusion with
 * another attuned element (fusions.ts). Each element forks into two Doctrines.
 */
import type { TreeDef } from './schema';
import { doctrine, exotic, flat, fx, mech, stat } from './builders';

const DOC_BASE = 200;
const DOC_G = 1.18;

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------
export const FIRE: TreeDef = {
  id: 'fire', name: 'Fire', category: 'element', forkRequirement: 3,
  shared: [
    stat('fire.burn_chance', 'Incendiary Mix', 'Primary hits Burn their target with 15% chance; +2% per rank.', 'add', 0.02, 20, 1.18, 25, 0, { tags: ['status'] }),
    stat('fire.burn_stacks', 'Accelerant', 'Burn stacks up to 3 times on one enemy; +1 stack cap per rank.', 'add', 1, 40, 1.22, 7, 0, { tags: ['status'] }),
    stat('fire.burn_duration', 'Slow Fuse', 'Burn lasts 3 s; +0.2 s per rank. Reapplying refreshes the duration.', 'add', 0.2, 20, 1.17, 25, 0, { tags: ['status'] }),
    stat('fire.burn_damage', 'Thermite', 'Each Burn stack deals 20% of the igniting hit\'s damage per second; +6% per rank.', 'mul', 0.06, 25, 1.18, 35, 0, { tags: ['damage'] }),
    mech('fire.spread_on_death', 'Spread on Death',
      'Burning enemies that die pass 1 Burn stack per rank to up to 2 enemies within 60 units.',
      1, flat(1, 3), [fx('fire.spread_on_death', 'add', 1)], { requires: ['fire.burn_chance'] }),
  ],
  doctrines: [
    doctrine('fire', 'wildfire', 'Wildfire', 'Flashpoint explosions spread Burn stacks through the wave.', [
      mech('fire.wildfire.flashpoint', 'Flashpoint',
        'An enemy reaching max Burn stacks erupts in a 60-unit Flashpoint dealing 15% per rank of its remaining Burn damage (falling off with distance; at most 12% of each target\'s max HP and 35% of its own) and giving 1 Burn stack at half its Burn strength to everything caught.',
        2, flat(2, 3), [fx('fire.wildfire.flashpoint', 'add', 0.15)]),
      stat('fire.wildfire.tinder', 'Tinderbox', 'Flashpoints are 5% wider per rank.', 'mul', 0.05, DOC_BASE, DOC_G, 25, 2),
      mech('fire.wildfire.spread', 'Conflagration',
        'Flashpoints pass on every Burn stack the victim carried instead of one, and an enemy pushed to max stacks by a Flashpoint erupts in turn.',
        3, flat(3, 1)),
    ]),
    doctrine('fire', 'inferno', 'Inferno', 'Fireballs replace every Nth shot; critical hits always ignite.', [
      mech('fire.inferno.fireball_every', 'Fireball',
        'Every 6th primary shot is a Fireball: a 60-unit blast that applies 2 Burn stacks to everything it hits. Ranks 2 and 3 each fire it one shot sooner (every 4th at rank 3).',
        2, flat(2, 3), [fx('fire.inferno.fireball_every', 'add', -1)]),
      mech('fire.inferno.crits_ignite', 'Crits Ignite',
        'Critical hits always apply Burn, adding 1 extra stack per rank.',
        2, flat(2, 3), [fx('fire.inferno.crits_ignite', 'add', 1)]),
      stat('fire.inferno.fireball_damage', 'Pyroclast', '+6% Fireball damage and blast radius per rank.', 'mul', 0.06, DOC_BASE, DOC_G, 25, 2, { tags: ['damage'] }),
      mech('fire.inferno.sunburst', 'Sunburst',
        'Every Fireball bursts into a ring of 8 embers on impact; each ember flies 90 units and applies 1 Burn stack to what it touches.',
        3, flat(3, 1)),
    ]),
  ],
  exotic: exotic('fire.meteor_round', 'Meteor Round',
    'Every 5th Fireball, from any source (Inferno or Seventh Shot), becomes a Meteor Round that leaves an 80-unit burning zone for 4 s.'),
};

// ---------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------
export const LIGHTNING: TreeDef = {
  id: 'lightning', name: 'Lightning', category: 'element', forkRequirement: 3,
  shared: [
    stat('lightning.arc_chance', 'Charged Rounds', 'Primary hits arc lightning with 20% chance; +1.5% per rank.', 'add', 0.015, 20, 1.18, 30, 0, { tags: ['status'] }),
    mech('lightning.arc_targets', 'Branching', 'Arcs jump to 2 enemies; +1 per rank (up to 5).',
      1, flat(1, 3), [fx('lightning.arc_targets', 'add', 1)]),
    stat('lightning.arc_damage', 'High Voltage', 'Each arc deals 50% of the triggering hit\'s damage; +8% per rank.', 'mul', 0.08, 25, 1.18, 35, 0, { tags: ['damage'] }),
    stat('lightning.arc_range', 'Ionized Air', 'Arcs jump up to 110 units; +5 units per rank.', 'add', 5, 20, 1.17, 25, 0, { tags: ['range'] }),
  ],
  doctrines: [
    doctrine('lightning', 'chain', 'Chain', 'Longer, forking chains that charge their victims.', [
      mech('lightning.chain.forked_current', 'Forked Current',
        'Each arc jump has a 15% chance per rank to fork, striking one extra enemy from the same link.',
        2, flat(2, 3), [fx('lightning.chain.forked_current', 'add', 0.15)]),
      stat('lightning.chain.static_charge', 'Static Charge',
        'Enemies struck by an arc gain Static for 4 s: the next hit on them deals +4% damage per rank and consumes it.',
        'add', 0.04, DOC_BASE, DOC_G, 25, 2, { tags: ['damage'] }),
      mech('lightning.chain.discharge', 'Discharge',
        'An enemy that dies carrying Static releases it as a 5-target arc at 100% arc damage.',
        3, flat(3, 1), [], { requires: ['lightning.chain.static_charge'] }),
    ]),
    doctrine('lightning', 'storm', 'Storm', 'Ball Lightning drifts through the wave; bosses become arc anchors.', [
      mech('lightning.storm.ball_lightning', 'Ball Lightning',
        'Every 4 s the tower releases 1 slow Ball Lightning per rank; each zaps up to 3 enemies within 60 units every 0.25 s as it drifts outward.',
        2, flat(2, 3), [fx('lightning.storm.ball_lightning', 'add', 1)]),
      stat('lightning.storm.voltage', 'Thunderhead', '+6% Ball Lightning damage and +3% its zap radius per rank.', 'mul', 0.06, DOC_BASE, DOC_G, 25, 2, { tags: ['damage'] }),
      mech('lightning.storm.arc_anchor', 'Arc Anchor',
        'Bosses and elites become arc anchors: every arc within range bends through them, and anchors take +50% arc damage.',
        3, flat(3, 1)),
    ]),
  ],
  exotic: exotic('lightning.supercell', 'Supercell',
    'When 40 arcs fire within 2 s, a storm rings the tower for 6 s, striking a random enemy within 250 units every 0.2 s.'),
};

// ---------------------------------------------------------------------------
// Poison
// ---------------------------------------------------------------------------
export const POISON: TreeDef = {
  id: 'poison', name: 'Poison', category: 'element', forkRequirement: 3,
  shared: [
    stat('poison.application', 'Toxin Glands', 'Primary hits apply 0.3 Poison stacks on average (the fraction is a chance for one more); +0.03 per rank.', 'add', 0.03, 20, 1.18, 30, 0, { tags: ['status'] }),
    stat('poison.stack_cap', 'Saturation', 'Poison stacks up to 10 times per enemy; +1 per rank.', 'add', 1, 30, 1.2, 15, 0, { tags: ['status'] }),
    stat('poison.damage', 'Neurotoxin', 'Each Poison stack deals 16% of primary damage per second; +6% per rank.', 'mul', 0.06, 25, 1.18, 35, 0, { tags: ['damage'] }),
    stat('poison.duration', 'Lingering Dose', 'Poison stacks last 5 s; +0.25 s per rank.', 'add', 0.25, 20, 1.17, 25, 0, { tags: ['status'] }),
  ],
  doctrines: [
    doctrine('poison', 'plague', 'Plague', 'Poison spreads between enemies on its own.', [
      mech('poison.plague.contagion', 'Contagion',
        'When a poisoned enemy dies, 30% per rank of its stacks jump to the nearest enemy within 80 units.',
        2, flat(2, 3), [fx('poison.plague.contagion', 'add', 0.3)]),
      stat('poison.plague.incubation', 'Incubation', 'Stacks spread by Contagion or a Plague Carrier deal +5% damage per rank.', 'mul', 0.05, DOC_BASE, DOC_G, 25, 2, { tags: ['damage'] }),
      mech('poison.plague.plague_carrier', 'Plague Carrier',
        'The most-poisoned enemy becomes a Plague Carrier: every second it gives 1 stack to each enemy within 70 units. When it dies, the role passes to the next most-poisoned enemy.',
        3, flat(3, 1)),
    ]),
    doctrine('poison', 'venom', 'Venom', 'Deep stacks that eat armor and burst.', [
      stat('poison.venom.virulence', 'Virulence', 'Under Venom, Poison deals +3% damage for every stack past the 5th on the target; +2% per rank.', 'add', 0.02, DOC_BASE, DOC_G, 25, 2, { tags: ['damage'] }),
      mech('poison.venom.corrosion', 'Corrosion',
        'Each Poison stack strips 1% of the enemy\'s armor per rank (up to 60%).',
        2, flat(2, 3), [fx('poison.venom.corrosion', 'add', 0.01)]),
      mech('poison.venom.toxic_burst', 'Toxic Burst',
        'An enemy reaching its Poison stack cap bursts: all stacks deal their remaining damage at once, then half the stacks are reapplied.',
        3, flat(3, 1)),
    ]),
  ],
  exotic: exotic('poison.pandemic', 'Pandemic',
    'Every 2 s, each poisoned elite or boss seeds half its stacks into the 2 nearest enemies.'),
};

// ---------------------------------------------------------------------------
// Frost
// ---------------------------------------------------------------------------
export const FROST: TreeDef = {
  id: 'frost', name: 'Frost', category: 'element', forkRequirement: 3,
  shared: [
    stat('frost.chill_chance', 'Cryo Rounds', 'Primary hits Chill with 25% chance; +2% per rank.', 'add', 0.02, 20, 1.18, 30, 0, { tags: ['status'] }),
    stat('frost.chill_stacks', 'Deep Cold', 'Chill stacks up to 5 times per enemy; +1 per rank.', 'add', 1, 40, 1.22, 12, 0, { tags: ['status'] }),
    stat('frost.chill_duration', 'Hoarfrost', 'Chill lasts 2 s; +0.1 s per rank.', 'add', 0.1, 20, 1.17, 25, 0, { tags: ['status'] }),
    stat('frost.slow_per_stack', 'Numbing Frost', 'Each Chill stack slows movement 6%; +0.4 points per rank (total slow capped at 85%).', 'add', 0.004, 25, 1.18, 25, 0, { tags: ['control'] }),
  ],
  doctrines: [
    doctrine('frost', 'control', 'Control', 'Freeze enemies solid and keep them cold.', [
      mech('frost.control.deep_freeze', 'Deep Freeze',
        'Enemies at max Chill freeze solid for 0.6 s per rank (bosses are slowed 80% instead). Each enemy can freeze once every 5 s.',
        2, flat(2, 3), [fx('frost.control.deep_freeze', 'add', 0.6)]),
      mech('frost.control.permafrost', 'Permafrost',
        'Chill no longer expires all at once: stacks fall off one at a time, each lingering 0.5 s longer per rank.',
        2, flat(2, 3), [fx('frost.control.permafrost', 'add', 0.5)]),
      mech('frost.control.glacial_shot', 'Glacial Shot',
        'Every 5th primary shot is a Glacial Shot that pierces everything in its line and applies max Chill.',
        3, flat(3, 1)),
    ]),
    doctrine('frost', 'shatter', 'Shatter', 'Frozen enemies turn Brittle and break apart.', [
      stat('frost.shatter.brittle', 'Brittle', 'Enemies at max Chill or frozen become Brittle (up to 3 stacks): +4% damage taken per rank, and critical hits on them deal +15% more per Brittle stack.', 'add', 0.04, DOC_BASE, DOC_G, 25, 2, { tags: ['damage'] }),
      mech('frost.shatter.fracture', 'Fracture',
        'Critical hits on Brittle enemies deal +25% crit damage per rank.',
        2, flat(2, 3), [fx('frost.shatter.fracture', 'add', 0.25)]),
      mech('frost.shatter.iceburst', 'Iceburst',
        'Brittle enemies that die shatter in a 70-unit Iceburst dealing 20% of their max HP and applying 3 Chill stacks.',
        3, flat(3, 1), [], { requires: ['frost.shatter.brittle'] }),
    ]),
  ],
  exotic: exotic('frost.absolute_zero', 'Absolute Zero',
    'Enemies at max Chill also attack 50% slower, and their ability cooldowns run 50% slower.'),
};

export const ELEMENT_TREES: TreeDef[] = [FIRE, LIGHTNING, POISON, FROST];
