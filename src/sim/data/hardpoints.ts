/**
 * Hardpoint trees (design §7). Five systems compete for at most four slots
 * (slots open at waves 10/30/55/75 up to the Frame's cap). Hardpoint trees are
 * priced ×1.5 relative to the chassis (HARDPOINT_SCALE).
 *
 * Note: `ordnance.damage` and `drones.damage` are not named in §7's base lists;
 * they are added so missile and drone damage scale with Scrap like every other
 * weapon (Blade and Laser list damage explicitly).
 */
import type { TreeDef } from './schema';
import { HARDPOINT_SCALE as K, doctrine, exotic, flat, fx, mech, stat } from './builders';

const DOC_BASE = 300;   // 200 × 1.5
const DOC_G = 1.18;

// ---------------------------------------------------------------------------
// Ordnance
// ---------------------------------------------------------------------------
export const ORDNANCE: TreeDef = {
  id: 'ordnance', name: 'Ordnance', category: 'hardpoint', forkRequirement: 3,
  shared: [
    stat('ordnance.damage', 'Warhead Yield', '+8% missile damage per rank (base 25 per missile).', 'mul', 0.08, 15 * K, 1.17, 40, 0, { tags: ['damage'] }),
    mech('ordnance.launchers', 'Launchers', 'The rack starts with 1 launcher; +1 launcher per rank (up to 5). Each launcher fires its own missile.',
      1, flat(1, 4, K), [fx('ordnance.launchers', 'add', 1)]),
    stat('ordnance.tracking', 'Seeker Heads', 'Missiles turn 2.5 radians per second toward their target; +0.15 per rank.', 'add', 0.15, 10 * K, 1.16, 25),
    stat('ordnance.reload', 'Reload', 'Each launcher fires 0.4 missiles per second; +5% per rank.', 'mul', 0.05, 15 * K, 1.17, 35, 0, { tags: ['speed'] }),
    stat('ordnance.range', 'Rack Range', 'Missiles acquire targets within 380 units; +12 per rank.', 'add', 12, 12 * K, 1.17, 25, 0, { tags: ['range'] }),
    stat('ordnance.blast_radius', 'Blast Radius', 'Missile explosions are 40 units wide; +3% per rank.', 'mul', 0.03, 18 * K, 1.18, 30),
    mech('ordnance.overkill_guidance', 'Overkill Guidance',
      'Missiles whose target dies in flight retarget the nearest enemy; +1 retarget per rank. Retargeted missiles deal +10% damage.',
      1, flat(1, 3, K), [fx('ordnance.overkill_guidance', 'add', 1)]),
  ],
  doctrines: [
    doctrine('ordnance', 'hunter', 'Hunter', 'Missiles hunt elites and bosses; Siegebreaker adds boss damage.', [
      mech('ordnance.hunter.priority', 'Priority Targeting',
        'Missiles always prefer elites and bosses in range and deal +15% damage per rank to them.',
        2, flat(2, 3, K), [fx('ordnance.hunter.priority', 'add', 0.15)]),
      stat('ordnance.hunter.siegebreaker', 'Siegebreaker', 'Missiles deal +5% damage per rank to bosses.', 'add', 0.05, DOC_BASE, DOC_G, 30, 2, { tags: ['damage'] }),
      mech('ordnance.hunter.kill_order', 'Kill Order',
        'Missile hits on an exposed boss weak point extend its exposure by 1 s (up to +4 s per opening).',
        3, flat(3, 1, K)),
    ]),
    doctrine('ordnance', 'swarm', 'Swarm', 'Many small rockets; Afterburner acceleration.', [
      mech('ordnance.swarm.rockets', 'Rocket Pods',
        'Each launcher fires a pod of 3 small rockets (35% damage, 50% blast radius) instead of one missile; ranks 2 and 3 add 2 rockets per pod each.',
        2, flat(2, 3, K), [fx('ordnance.swarm.rockets', 'add', 2)]),
      stat('ordnance.swarm.afterburner', 'Afterburner', 'Rockets accelerate in flight, gaining up to +5% top speed and damage per rank.', 'add', 0.05, DOC_BASE, DOC_G, 25, 2, { tags: ['damage', 'speed'] }),
      mech('ordnance.swarm.cascade', 'Cascade',
        'Each rocket explosion has a 25% chance to launch a smaller rocket (60% damage) at a new target. Cascade rockets can cascade.',
        3, flat(3, 1, K)),
    ]),
    doctrine('ordnance', 'bombard', 'Bombard', 'The rack becomes a Bomb Bay lobbing shells into the densest groups.', [
      mech('ordnance.bombard.bomb_bay', 'Bomb Bay',
        'Launchers lob shells in a slow arc at the densest cluster in range: ×2 blast radius and +50% damage. +1 shell per volley per rank.',
        2, flat(2, 3, K), [fx('ordnance.bombard.bomb_bay', 'add', 1)]),
      stat('ordnance.bombard.shell_weight', 'Shell Weight', '+6% shell damage and +2% shell blast radius per rank.', 'mul', 0.06, DOC_BASE, DOC_G, 25, 2, { tags: ['damage'] }),
      mech('ordnance.bombard.carpet', 'Carpet',
        'Shells leave hazard zones for 3 s dealing 20% of shell damage per second; overlapping zones merge into one larger zone with their damage combined.',
        3, flat(3, 1, K), [], { requires: ['ordnance.bombard.bomb_bay'] }),
    ]),
  ],
  exotic: exotic('ordnance.cluster_warheads', 'Cluster Warheads',
    'Missiles split into 4 bomblets just before impact; each deals 40% damage in a 60% blast.'),
};

// ---------------------------------------------------------------------------
// Drones
// ---------------------------------------------------------------------------
export const DRONES: TreeDef = {
  id: 'drones', name: 'Drones', category: 'hardpoint', forkRequirement: 3,
  shared: [
    mech('drones.count', 'Drone Bay', 'Start with 1 drone; +1 drone per rank (up to 6, drone cap 8).',
      1, flat(1, 5, K), [fx('drones.count', 'add', 1)]),
    stat('drones.damage', 'Drone Guns', '+8% drone damage per rank (base 6 per shot).', 'mul', 0.08, 15 * K, 1.17, 40, 0, { tags: ['damage'] }),
    stat('drones.orbit_radius', 'Orbit Radius', 'Drones orbit 90 units from the tower; +4 per rank.', 'add', 4, 8 * K, 1.16, 25, 0, { tags: ['range'] }),
    stat('drones.speed', 'Thrusters', 'Drones fly at 160 units per second; +4% per rank.', 'mul', 0.04, 10 * K, 1.16, 25, 0, { tags: ['speed'] }),
    stat('drones.attack_speed', 'Drone Cyclers', 'Each drone fires 1.2 shots per second; +5% per rank.', 'mul', 0.05, 15 * K, 1.17, 35, 0, { tags: ['speed'] }),
    stat('drones.targeting', 'Drone Sensors', 'Drones engage enemies within 180 units of themselves; +8 per rank.', 'add', 8, 10 * K, 1.16, 25, 0, { tags: ['range'] }),
  ],
  doctrines: [
    doctrine('drones', 'wing', 'Wing', 'Interceptors hunt fast enemies and kamikazes; gunships sustain fire.', [
      mech('drones.wing.interceptors', 'Interceptors',
        'Half your drones become Interceptors: +50% flight speed, they hunt runners and kamikazes first, and deal +20% damage per rank to fast enemies.',
        2, flat(2, 3, K), [fx('drones.wing.interceptors', 'add', 0.2)]),
      stat('drones.wing.gunships', 'Gunships', 'The other half become Gunships: +4% attack speed per rank.', 'mul', 0.04, DOC_BASE, DOC_G, 30, 2, { tags: ['speed'] }),
      mech('drones.wing.sortie', 'Sortie',
        'Drones detach from orbit to pursue targets anywhere in the arena, returning to rearm every 4 s.',
        3, flat(3, 1, K)),
    ]),
    doctrine('drones', 'arc', 'Arc', 'Lightning links between drones.', [
      mech('drones.arc.link', 'Arc Link',
        'Neighbouring drones are joined by a lightning link that deals 50% per rank of drone damage per second to enemies crossing it.',
        2, flat(2, 3, K), [fx('drones.arc.link', 'add', 0.5)]),
      stat('drones.arc.capacitance', 'Capacitance', '+5% link damage per rank; links reach 4 units farther per rank.', 'mul', 0.05, DOC_BASE, DOC_G, 25, 2, { tags: ['damage'] }),
      mech('drones.arc.faraday_web', 'Faraday Web',
        'Links join every drone to every other drone, forming a mesh that damages anything crossing it.',
        3, flat(3, 1, K)),
    ]),
    doctrine('drones', 'carrier', 'Carrier', 'Carriers release temporary microdrones.', [
      mech('drones.carrier.launch_bay', 'Launch Bay',
        'Drones become Carriers that release microdrones every 3 s (40% damage, 6 s lifespan); +1 microdrone per launch per rank.',
        2, flat(2, 3, K), [fx('drones.carrier.launch_bay', 'add', 1)]),
      stat('drones.carrier.microdrone_life', 'Longer Sorties', 'Microdrones live 6 s; +0.3 s per rank.', 'add', 0.3, DOC_BASE, DOC_G, 25, 2),
      mech('drones.carrier.brood', 'Brood',
        'Microdrones inherit every on-hit effect of their carrier: Infusions, Wingman, and element procs.',
        3, flat(3, 1, K)),
    ]),
    doctrine('drones', 'support', 'Support', 'Medic and shield drones keep the tower standing.', [
      mech('drones.support.medic', 'Medic Drones',
        'One drone in two becomes a Medic, repairing 0.5% of max HP per second per rank (Medics still fire at half rate).',
        2, flat(2, 3, K), [fx('drones.support.medic', 'add', 0.005)], { tags: ['defense'] }),
      mech('drones.support.shield_drone', 'Shield Drones',
        'The rest project a shield: +8% of max HP as shield capacity per rank.',
        2, flat(2, 3, K), [fx('drones.support.shield_drone', 'add', 0.08)], { tags: ['defense'] }),
      mech('drones.support.aegis_wing', 'Aegis Wing',
        'Drones intercept enemy projectiles that cross their orbit, destroying them.',
        3, flat(3, 1, K), [], { tags: ['defense'] }),
    ]),
  ],
  exotic: exotic('drones.payload', 'Payload',
    'Every 5 s each drone drops a bomb on the densest spot beneath its path: 60-unit blast for 300% drone damage.'),
};

// ---------------------------------------------------------------------------
// Orbital Blade
// ---------------------------------------------------------------------------
export const BLADE: TreeDef = {
  id: 'blade', name: 'Orbital Blade', category: 'hardpoint', forkRequirement: 3,
  shared: [
    stat('blade.damage', 'Edge', '+8% blade damage per rank (base 8 per hit, each enemy hit once per pass).', 'mul', 0.08, 15 * K, 1.17, 40, 0, { tags: ['damage'] }),
    stat('blade.length', 'Length', 'The blade sweeps from the tower out to 60 units; +3 per rank.', 'add', 3, 12 * K, 1.17, 30, 0, { tags: ['range'] }),
    stat('blade.rotation_speed', 'Rotation Speed', 'The blade turns 3 radians per second; +4% per rank.', 'mul', 0.04, 15 * K, 1.17, 35, 0, { tags: ['speed'] }),
    stat('blade.knockback', 'Knockback', 'Blade hits shove enemies 20 units outward; +2 per rank.', 'add', 2, 8 * K, 1.16, 25, 0, { tags: ['control'] }),
    stat('blade.serration', 'Serration', 'Blade hits apply Bleed (30% of hit damage per second for 3 s) with 3% chance per rank.', 'add', 0.03, 15 * K, 1.18, 30, 0, { tags: ['status'] }),
  ],
  doctrines: [
    doctrine('blade', 'twinning', 'Twinning', 'Two to four blades at distinct radii.', [
      mech('blade.twinning.blades', 'Twin Blades',
        '+1 blade per rank (2 → 4), each on its own radius. Extra blades deal 70% damage.',
        2, flat(2, 3, K), [fx('blade.twinning.blades', 'add', 1)]),
      stat('blade.twinning.edge', 'Matched Edges', 'Extra blades deal +1.5% of full damage per rank (70% → 100%).', 'add', 0.015, DOC_BASE, DOC_G, 20, 2, { tags: ['damage'] }),
      mech('blade.twinning.gyre', 'Gyre',
        'Alternate blades counter-rotate, so enemies between two radii are struck twice per crossing.',
        3, flat(3, 1, K)),
    ]),
    doctrine('blade', 'greatblade', 'Greatblade', 'One huge blade; Cleaver punishes high-HP enemies.', [
      mech('blade.greatblade.mass', 'Great Mass',
        'The blade is 50% longer and deals +40% damage per rank, turning 5% slower per rank.',
        2, flat(2, 3, K), [fx('blade.greatblade.mass', 'add', 0.4)]),
      stat('blade.greatblade.cleaver', 'Cleaver', '+3% blade damage per rank against enemies above 50% HP.', 'add', 0.03, DOC_BASE, DOC_G, 30, 2, { tags: ['damage'] }),
      mech('blade.greatblade.sunder', 'Sunder',
        'Every blade hit permanently strips 2% of the enemy\'s armor and shield capacity (up to 60%).',
        3, flat(3, 1, K)),
    ]),
    doctrine('blade', 'tempest', 'Tempest', 'Speed, Momentum and Afterimage trails.', [
      stat('blade.tempest.momentum', 'Momentum', 'Each hit within 1 s of the last adds +2% rotation speed per rank, stacking 10 times.', 'add', 0.02, DOC_BASE, DOC_G, 25, 2, { tags: ['speed'] }),
      mech('blade.tempest.afterimage', 'Afterimage',
        'The blade leaves an Afterimage trail for 0.5 s that deals 20% per rank of blade damage to enemies it crosses.',
        2, flat(2, 3, K), [fx('blade.tempest.afterimage', 'add', 0.2)]),
      mech('blade.tempest.cyclone', 'Cyclone',
        'At max Momentum, the blade throws a cutting arc outward every half turn, travelling 250 units for 60% blade damage.',
        3, flat(3, 1, K), [], { requires: ['blade.tempest.momentum'] }),
    ]),
  ],
  exotic: exotic('blade.deflection', 'Deflection',
    'The blade destroys enemy projectiles it sweeps through.', [], { tags: ['defense'] }),
};

// ---------------------------------------------------------------------------
// Laser Polygon
// ---------------------------------------------------------------------------
export const LASER: TreeDef = {
  id: 'laser', name: 'Laser Polygon', category: 'hardpoint', forkRequirement: 3,
  shared: [
    mech('laser.nodes', 'Nodes', 'The polygon starts with 2 orbital nodes joined by a beam; +1 node per rank (up to 5).',
      1, flat(1, 3, K), [fx('laser.nodes', 'add', 1)]),
    stat('laser.radius', 'Radius', 'Nodes orbit 110 units from the tower; +4 per rank.', 'add', 4, 10 * K, 1.16, 25, 0, { tags: ['range'] }),
    stat('laser.rotation', 'Rotation', 'The polygon turns 0.6 radians per second; +4% per rank.', 'mul', 0.04, 10 * K, 1.16, 25, 0, { tags: ['speed'] }),
    stat('laser.beam_width', 'Beam Width', 'Beams are 6 units wide; +0.3 per rank.', 'add', 0.3, 12 * K, 1.17, 30),
    stat('laser.damage', 'Beam Intensity', '+8% beam damage per rank (base 12 damage per second per beam).', 'mul', 0.08, 15 * K, 1.17, 40, 0, { tags: ['damage'] }),
    stat('laser.node_durability', 'Node Durability', 'Nodes have 50 HP and rebuild 4 s after being destroyed; +10 HP per rank.', 'add', 10, 8 * K, 1.16, 25, 0, { tags: ['defense'] }),
    mech('laser.pulse', 'Pulse',
      'Every 3 s the beams Pulse for 0.3 s at ×3 width and ×2 damage. Ranks 2 and 3 shorten the interval by 0.4 s each.',
      1, flat(1, 3, K), [fx('laser.pulse.interval', 'add', -0.4)]),
  ],
  doctrines: [
    doctrine('laser', 'expansion', 'Expansion', 'Up to 8 nodes; Star Configuration.', [
      mech('laser.expansion.nodes', 'Expansion Nodes', '+1 node per rank beyond the base cap (up to 8).',
        2, flat(2, 3, K), [fx('laser.expansion.nodes', 'add', 1)]),
      mech('laser.expansion.star', 'Star Configuration',
        'Beams also join every second node, forming a star whose inner intersections deal double damage.',
        2, flat(2, 1, K)),
      mech('laser.expansion.mandala', 'Mandala',
        'An inner star at half radius plus an outer ring at full radius, both firing at full strength.',
        3, flat(3, 1, K)),
    ]),
    doctrine('laser', 'resonance', 'Resonance', 'Bonus damage to enemies touching several beams.', [
      stat('laser.resonance.overlap', 'Overlap', 'Enemies touching 2+ beams take +8% beam damage per rank for each extra beam.', 'add', 0.08, DOC_BASE, DOC_G, 30, 2, { tags: ['damage'] }),
      mech('laser.resonance.feedback', 'Feedback',
        'Enemies touching 2+ beams are Shocked for 1 s: +5% damage taken per rank from every source.',
        2, flat(2, 3, K), [fx('laser.resonance.feedback', 'add', 0.05)]),
      mech('laser.resonance.standing_wave', 'Standing Wave',
        'Multi-beam damage compounds: +20% for each second an enemy stays in 2+ beams, up to +200%.',
        3, flat(3, 1, K), [], { requires: ['laser.resonance.overlap'] }),
    ]),
    doctrine('laser', 'containment', 'Containment', 'The interior slows enemies; Dynamic Geometry reshapes the polygon.', [
      stat('laser.containment.field', 'Containment Field', 'Enemies inside the polygon move 2% slower per rank (max 50%).', 'add', 0.02, DOC_BASE, DOC_G, 25, 2, { tags: ['control'] }),
      mech('laser.containment.dynamic_geometry', 'Dynamic Geometry',
        'The polygon stretches toward the densest ring of enemies, moving nodes up to 15% per rank closer or farther.',
        2, flat(2, 3, K), [fx('laser.containment.dynamic_geometry', 'add', 0.15)]),
      mech('laser.containment.crush', 'Crush',
        'Every 8 s the polygon contracts to half radius over 1 s, dragging enemies inside it inward, then springs back.',
        3, flat(3, 1, K), [], { requires: ['laser.containment.field'] }),
    ]),
  ],
  exotic: exotic('laser.vertex_blast', 'Vertex Blast',
    'Every 2 s each node fires an outward beam 200 units long for 150% beam damage.'),
};

// ---------------------------------------------------------------------------
// Gravitics
// ---------------------------------------------------------------------------
export const GRAVITICS: TreeDef = {
  id: 'gravitics', name: 'Gravitics', category: 'hardpoint', forkRequirement: 3,
  shared: [
    mech('gravitics.wells', 'Wells', 'Place 1 gravity well where its pull catches the most enemies; +1 well per rank (up to 4).',
      1, flat(1, 3, K), [fx('gravitics.wells', 'add', 1)]),
    stat('gravitics.pull', 'Pull Strength', 'Wells drag enemies inward at 120 units per second; +5% per rank.', 'mul', 0.05, 12 * K, 1.17, 30, 0, { tags: ['control'] }),
    stat('gravitics.radius', 'Event Radius', 'Wells catch enemies within 90 units; +3 per rank.', 'add', 3, 12 * K, 1.17, 30, 0, { tags: ['range'] }),
    stat('gravitics.duration', 'Duration', 'Wells hold for 3 s before collapsing; +0.1 s per rank.', 'add', 0.1, 10 * K, 1.16, 25, 0, { tags: ['control'] }),
    stat('gravitics.cooldown', 'Recharge', 'A well re-forms 8 s after it collapses; −2% per rank.', 'mul', -0.02, 15 * K, 1.17, 25, 0, { tags: ['speed'] }),
  ],
  doctrines: [
    doctrine('gravitics', 'collapse', 'Collapse', 'Wells implode for damage scaled by enemies captured.', [
      mech('gravitics.collapse.implosion', 'Implosion',
        'Collapsing wells implode for 30 damage × (1 + 15% per captured enemy); ranks 2 and 3 add +50% implosion damage each.',
        2, flat(2, 3, K), [fx('gravitics.collapse.implosion', 'add', 0.5)]),
      stat('gravitics.collapse.yield', 'Yield', '+8% implosion damage per rank.', 'mul', 0.08, DOC_BASE, DOC_G, 35, 2, { tags: ['damage'] }),
      mech('gravitics.collapse.chain_collapse', 'Chain Collapse',
        'Each implosion spawns 2 smaller wells (half radius, 1.5 s) that implode in turn at 50% damage.',
        3, flat(3, 1, K)),
    ]),
    doctrine('gravitics', 'lensing', 'Lensing', 'Projectiles and beams near wells bend toward them and gain damage.', [
      mech('gravitics.lensing.bend', 'Lens',
        'Projectiles and beams passing within a well\'s radius bend toward its center and deal +10% damage per rank.',
        2, flat(2, 3, K), [fx('gravitics.lensing.bend', 'add', 0.1)]),
      stat('gravitics.lensing.focus', 'Gravitational Focus', 'Lensed projectiles and beams deal +2% damage per rank.', 'add', 0.02, DOC_BASE, DOC_G, 30, 2, { tags: ['damage'] }),
      mech('gravitics.lensing.focal_point', 'Focal Point',
        'Projectiles passing a well converge on the single highest-HP enemy it holds.',
        3, flat(3, 1, K), [], { requires: ['gravitics.lensing.bend'] }),
    ]),
    doctrine('gravitics', 'tidal', 'Tidal', 'Wells drift toward the tower, dragging enemies into blade and beam range. Kamikazes come with them.', [
      mech('gravitics.tidal.drift', 'Drift',
        'Wells drift toward the tower at 20 units per second per rank, stopping 50 units out.',
        2, flat(2, 3, K), [fx('gravitics.tidal.drift', 'add', 20)]),
      stat('gravitics.tidal.riptide', 'Riptide', 'Drifting wells pull 4% harder per rank.', 'mul', 0.04, DOC_BASE, DOC_G, 25, 2, { tags: ['control'] }),
      mech('gravitics.tidal.orbit_lock', 'Orbit Lock',
        'When a well collapses, its captives are flung into orbit around the tower at blade radius for 2 s.',
        3, flat(3, 1, K), [], { requires: ['gravitics.tidal.drift'] }),
    ]),
  ],
  exotic: exotic('gravitics.mass_driver', 'Mass Driver',
    'Enemies flung out of a collapsing well collide with others for 10% of their max HP (5% for bosses).'),
};

export const HARDPOINT_TREES: TreeDef[] = [ORDNANCE, DRONES, BLADE, LASER, GRAVITICS];
