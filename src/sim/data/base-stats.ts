/**
 * Base values for every StatKey before node/frame/anomaly/prestige effects.
 * WP-DATA owns this file; WP1 seeded it with the keys the core, Ballistics, Bastion basics and
 * the economy read. Merge freely (add keys, retune values); keep existing keys.
 *
 * Resolver rule (core/stats.ts): value = (BASE + Σ add) × (1 + Σ mul), then `set` overrides.
 */
export const BASE_STATS: Record<string, number> = {
  // Ballistics (primary weapon)
  'ballistics.damage': 10,
  'ballistics.attack_speed': 2,            // shots per second
  'ballistics.range': 300,
  'ballistics.projectile_speed': 420,
  'ballistics.crit_chance': 0.05,
  'ballistics.crit_damage': 1.5,           // crit multiplier
  'ballistics.target_acquisition': 0,      // retarget speed bonus
  'ballistics.multishot.count': 1,         // projectiles = min(5, 1 + count) while Multishot is active
  'ballistics.multishot.penalty': 0.35,    // per extra projectile: each deals dmg / (1 + penalty·(n-1))
  'ballistics.piercing.count': 0,          // pierces = 1 + count while Piercing is active
  'ballistics.piercing.retention': 0.5,    // damage kept per pierce
  'ballistics.piercing.velocity': 0,       // fractional speed gain per pierce
  'ballistics.ricochet.bounces': 0,        // bounces = 1 + bounces while Ricochet is active
  'ballistics.ricochet.range': 120,
  'ballistics.heavy.size': 1,              // radius multiplier on top of Heavy's inherent ×1.75 (nodes are 'mul')
  'ballistics.heavy.knockback': 0,         // extra knockback units on top of Heavy's inherent 18
  'ballistics.heavy.damage': 1,            // damage multiplier on top of Heavy's inherent ×1.9 (nodes are 'mul')
  'ballistics.execution': 0,               // bonus damage fraction vs enemies below 30% HP
  'ballistics.execution.ce_refund': 0,     // CE refunded per primary kill on an injured enemy
  // Bastion
  'bastion.max_hp': 150,
  'bastion.armor': 0,
  'bastion.shield_capacity': 0,
  'bastion.shield_recharge': 0,            // shield/s after 3 s without damage (plus 10% capacity/s baseline)
  'bastion.regeneration': 0,               // HP/s
  'bastion.resistance': 0,                 // fraction of damage ignored (capped 0.9)
  // Reactor
  'reactor.global_attack_speed': 1,        // multiplier on every system's attack rate
  'reactor.cooldown_reduction': 0,
  'reactor.energy_recycling': 0,
  // Economy
  'economy.scrap_mul': 1,
  'economy.ce_cap': 100,
  'economy.core_drop_chance': 0.02,        // per elite kill
  'economy.first_clear_mul': 3,            // Strip Mine sets 4
  'combat.power_mul': 1,                   // global outgoing damage multiplier (Salvage −15%)

  // =========================================================================
  // WP-DATA additions. Mechanic nodes whose magnitude scales per rank use their
  // node id as the StatKey; `<node>.<param>` keys are tunable constants that no
  // node modifies (systems read them instead of hardcoding numbers).
  // =========================================================================

  // --- Ballistics: mechanics and doctrine constants ------------------------
  'ballistics.execution.threshold': 0.3,          // HP fraction counted as "injured"
  'ballistics.multishot.spread': 0.35,            // radians across the fan (≈20°)
  'ballistics.piercing.last_rites.mult': 4,       // damage ×4 on the final enemy pierced
  'ballistics.ricochet.retention': 0.8,           // damage kept per bounce
  'ballistics.heavy.fire_rate': 0.85,             // Heavy Rounds attack-speed multiplier
  'ballistics.heavy.base_damage': 1.9,            // inherent Heavy damage multiplier
  'ballistics.heavy.base_size': 2.5,              // inherent Heavy size multiplier
  'ballistics.heavy.base_knockback': 18,          // inherent Heavy knockback units
  'ballistics.heavy.staggerhead.seconds': 0.6,    // elite stagger duration
  'ballistics.heavy.staggerhead.boss_lockout': 4, // s between boss interrupts
  'ballistics.gunstorm.every': 8,                 // every Nth primary attack
  'ballistics.gunstorm.rounds': 6,                // rounds per barrel in the burst

  // --- Bastion --------------------------------------------------------------
  'bastion.max_hp_final': 1,                      // applied after all max-HP bonuses (Glass Cannon ×0.5)
  'bastion.shield_delay': 3,                      // s without damage before recharge
  'bastion.resistance_cap': 0.9,
  'bastion.between_wave_heal': 0.25,              // fraction of max HP healed between waves (Tithe sets 0)
  'bastion.kill_heal': 0,                         // fraction of max HP healed per kill (Hungry Core)
  'bastion.second_core.invuln': 3,                // s of invulnerability
  'bastion.fortress.hp': 1,                       // informational: node also writes bastion.max_hp mul
  'bastion.fortress.armor': 1,                    // informational: node also writes bastion.armor mul
  'bastion.fortress.fortification': 0,            // temp HP cap as fraction of max HP
  'bastion.fortress.fortification.rate': 0.02,    // temp HP built per second, fraction of max HP
  'bastion.fortress.keep.cap': 0.25,              // overflow-heal barrier cap, fraction of max HP
  'bastion.aegis.barrier': 0,                     // Outer Barrier HP
  'bastion.aegis.barrier_radius': 70,
  'bastion.aegis.barrier_regen': 0.1,             // fraction of barrier restored per second
  'bastion.aegis.barrier_delay': 5,               // s untouched before barrier regen
  'bastion.aegis.shockwave_shield': 0,            // knockback units on barrier break
  'bastion.aegis.shockwave_damage': 0.5,          // × barrier max HP dealt on break
  'bastion.aegis.mirror_aegis.reflect': 1,        // reflected projectile damage multiplier
  'bastion.thorns.retaliation': 0,                // fraction of damage taken returned to attacker
  'bastion.thorns.retaliation_per_armor': 1,      // flat retaliation per armor point
  'bastion.thorns.retaliation_mul': 1,            // Martyr Plating ×3
  'bastion.thorns.reactive_armor': 0,             // armor fraction gained per hit-stack
  'bastion.thorns.reactive_armor.duration': 3,
  'bastion.thorns.reactive_armor.max_stacks': 5,
  'bastion.thorns.spite.chain': 0.6,              // chained retaliation strength
  'bastion.thorns.spite.range': 120,
  'bastion.phoenix.last_stand': 0,                // damage bonus per 10% HP missing
  'bastion.phoenix.rekindle': 0,                  // fraction of max HP healed over 4 s
  'bastion.phoenix.rekindle.threshold': 0.5,
  'bastion.phoenix.ember_heart.threshold': 0.25,
  'bastion.phoenix.ember_heart.speed': 0.3,

  // --- Reactor --------------------------------------------------------------
  'reactor.targeting_logic': 0,                   // 1: skip doomed, 2: lead targets, 3: spread targets
  'reactor.critical_mass.threshold': 25,          // enemies alive (Swarmstorm reward −30%)
  'reactor.critical_mass.per_enemy': 0.02,
  'reactor.critical_mass.cap': 0.4,
  'reactor.overclock.speed': 1,                   // informational: node also writes reactor.global_attack_speed mul
  'reactor.overclock.cooldowns': 0,               // informational: node also writes reactor.cooldown_reduction add
  'reactor.overclock.overdrive_core.every': 30,
  'reactor.overclock.overdrive_core.duration': 5,
  'reactor.overclock.overdrive_core.bonus': 0.5,
  'reactor.salvage.reclamation': 1,               // informational: node also writes economy.scrap_mul add
  'reactor.salvage.boss_scavenging': 1,           // informational: node also writes economy.boss_scrap_mul add
  'reactor.salvage.checkpoint_dividend': 0,       // × boss wave kill Scrap on first checkpoint reach
  'reactor.sync.combo': 0,                        // damage bonus per extra system in a combo
  'reactor.sync.window': 0.5,                     // s
  'reactor.sync.harmonic_lock.systems': 4,
  'reactor.sync.harmonic_lock.bonus': 0.5,
  'reactor.sync.harmonic_lock.duration': 3,
  'reactor.command.ce_cap': 0,                    // informational: node also writes economy.ce_cap add
  'reactor.command.ce_regen': 0,                  // CE per second in combat
  'reactor.command.cooldowns': 0,                 // ability cooldown reduction

  // --- Economy / global -----------------------------------------------------
  'economy.start_scrap': 0,                       // Seed Capital
  'economy.boss_scrap_mul': 1,                    // boss (and elite) kill Scrap multiplier: Boss Bounty, Boss Scavenging
  'economy.boss_cores': 1,                        // Cores per boss first kill (Tithe +1)
  'economy.echo_mul': 1,
  'combat.blast_radius_mul': 1,                   // every explosion radius (Unstable Isotope)
  'anomaly.spare_barrel.strength': 0.5,
  'anomaly.seventh_shot.every': 7,
  'anomaly.mirror_node.count_mul': 2,
  'anomaly.clockwork_blade.period': 6,
  'anomaly.clockwork_blade.shockwave_radius': 120,
  'anomaly.ghost_protocol.seconds': 3,
  'anomaly.rogue_moon.orbit': 380,
  'anomaly.unstable_isotope.self_chance': 0.05,
  'anomaly.unstable_isotope.self_damage': 0.1,
  'anomaly.unstable_isotope.self_cap': 0.02,       // each self-detonation deals ≤ this × tower max HP
  'anomaly.afterimage_round.delay': 0.4,
  'anomaly.afterimage_round.damage': 0.3,
  'anomaly.echo_chamber.delay': 0.5,
  'anomaly.echo_chamber.damage': 0.4,
  'anomaly.echo_chamber.radius': 0.7,
  'anomaly.feedback_loop.delay': 1,
  'anomaly.feedback_loop.power': 0.5,

  // --- Abilities (design §10) -----------------------------------------------
  'ability.hunter_mark.cost_mul': 1,
  'ability.hunter_mark.status_bonus': 0.5,
  'ability.hunter_mark.duration': 8,
  'ability.repulsor_pulse.cost_mul': 1,
  'ability.repulsor_pulse.force': 180,
  'ability.repulsor_pulse.radius': 160,
  'ability.time_field.cost_mul': 1,
  'ability.time_field.duration': 6,
  'ability.time_field.slow': 0.2,                 // enemies move at 20% speed
  'ability.bombardment.cost_mul': 1,
  'ability.bombardment.damage': 25,               // × primary damage
  'ability.bombardment.radius': 90,
  'ability.bombardment.fuse': 0.6,
  'ability.emp.cost_mul': 1,
  'ability.emp.duration': 3,
  'ability.overdrive.cost_mul': 1,
  'ability.overdrive.duration': 5,
  'ability.overdrive.speed': 2,
  'ability.emergency_repair.cost_mul': 1,
  'ability.emergency_repair.heal': 0.3,
  'ability.drone_surge.cost_mul': 1,
  'ability.drone_surge.count': 6,
  'ability.missile_storm.cost_mul': 1,
  'ability.missile_storm.missiles': 24,
  'ability.singularity_bomb.cost_mul': 1,
  'ability.singularity_bomb.damage': 40,          // × primary damage
  'ability.singularity_bomb.pull_seconds': 2,

  // --- Fire -------------------------------------------------------------------
  'fire.burn_chance': 0.15,
  'fire.burn_stacks': 3,                          // stack cap
  'fire.burn_duration': 3,                        // s
  'fire.burn_damage': 0.2,                        // × igniting hit damage per stack per second
  'fire.spread_on_death': 0,                      // stacks passed on death
  'fire.spread_on_death.targets': 2,
  'fire.spread_on_death.radius': 60,
  'fire.wildfire.flashpoint': 0,                  // × remaining burn damage dealt by a Flashpoint
  'fire.wildfire.flashpoint.radius': 60,
  'fire.wildfire.flashpoint.source_cap': 0.35,     // Flashpoint damage ≤ this × the erupting enemy's max HP
  'fire.wildfire.flashpoint.target_cap': 0.12,    // one Flashpoint deals ≤ this × each target's max HP
  'fire.wildfire.flashpoint.inherit': 0.5,        // Burn a Flashpoint passes on burns at this × the victim's Burn DPS (chains fade)
  'fire.wildfire.tinder': 1,                      // Flashpoint radius multiplier
  'fire.inferno.fireball_every': 7,               // every Nth primary shot (rank 1 → 6)
  'fire.inferno.crits_ignite': 0,                 // extra Burn stacks on crit
  'fire.inferno.fireball_damage': 1,              // Fireball damage/radius multiplier
  'fire.inferno.fireball.radius': 60,
  'fire.inferno.fireball.stacks': 2,
  'fire.inferno.sunburst.embers': 8,
  'fire.inferno.sunburst.range': 90,
  'fire.meteor_round.every': 5,
  'fire.meteor_round.radius': 80,
  'fire.meteor_round.duration': 4,

  // --- Lightning --------------------------------------------------------------
  'lightning.arc_chance': 0.2,
  'lightning.arc_targets': 2,
  'lightning.arc_damage': 0.5,                    // × triggering hit damage
  'lightning.arc_range': 110,
  'lightning.chain.forked_current': 0,            // fork chance per jump
  'lightning.chain.static_charge': 0,             // bonus damage consumed by the next hit
  'lightning.chain.static_charge.duration': 4,
  'lightning.chain.discharge.targets': 5,
  'lightning.storm.ball_lightning': 0,            // balls per release
  'lightning.storm.ball_lightning.interval': 4,
  'lightning.storm.ball_lightning.zap_radius': 60,
  'lightning.storm.voltage': 1,                   // Ball Lightning damage multiplier
  'lightning.storm.arc_anchor.bonus': 0.5,
  'lightning.supercell.arcs': 40,
  'lightning.supercell.window': 2,
  'lightning.supercell.duration': 6,
  'lightning.supercell.radius': 250,

  // --- Poison -----------------------------------------------------------------
  'poison.application': 0.3,                      // stacks per hit (fraction = chance of one more)
  'poison.stack_cap': 10,
  'poison.damage': 0.16,                          // × primary damage per stack per second
  'poison.duration': 5,
  'poison.tick_interval': 1,                      // s (Heavy Water ×1.25)
  'poison.plague.contagion': 0,                   // fraction of stacks passed on death
  'poison.plague.contagion.radius': 80,
  'poison.plague.incubation': 1,                  // damage multiplier for spread stacks
  'poison.plague.plague_carrier.radius': 70,
  'poison.venom.virulence': 0.03,                 // damage bonus per stack past the 5th (Venom's base; nodes add 0.02)
  'poison.venom.corrosion': 0,                    // armor fraction stripped per stack
  'poison.venom.corrosion.cap': 0.6,
  'poison.pandemic.interval': 2,
  'poison.pandemic.targets': 2,

  // --- Frost ------------------------------------------------------------------
  'frost.chill_chance': 0.25,
  'frost.chill_stacks': 5,                        // stack cap
  'frost.chill_duration': 2,
  'frost.slow_per_stack': 0.06,
  'frost.slow_cap': 0.85,
  'frost.chill_armor_shred': 0,                   // armor fraction removed per Chill stack (Cold Iron)
  'frost.control.deep_freeze': 0,                 // freeze seconds
  'frost.control.deep_freeze.lockout': 5,
  'frost.control.permafrost': 0,                  // s each stack lingers
  'frost.control.glacial_shot.every': 5,
  'frost.shatter.brittle': 0,                     // damage-taken bonus
  'frost.shatter.fracture': 0,                    // crit damage bonus vs Brittle
  'frost.shatter.iceburst.radius': 70,
  'frost.shatter.iceburst.fraction': 0.2,         // × victim max HP
  'frost.absolute_zero.slow': 0.5,

  // --- Ordnance ---------------------------------------------------------------
  'ordnance.damage': 25,
  'ordnance.launchers': 1,
  'ordnance.tracking': 2.5,                       // rad/s turn rate
  'ordnance.reload': 0.4,                         // missiles per launcher per second
  'ordnance.range': 380,
  'ordnance.blast_radius': 40,
  'ordnance.missile_speed': 300,
  'ordnance.overkill_guidance': 0,                // retargets per missile
  'ordnance.overkill_guidance.bonus': 0.1,
  'ordnance.cluster_warheads.count': 4,
  'ordnance.cluster_warheads.damage': 0.4,
  'ordnance.cluster_warheads.radius': 0.6,
  'ordnance.hunter.priority': 0,                  // damage bonus vs elites/bosses
  'ordnance.hunter.siegebreaker': 0,              // damage bonus vs bosses
  'ordnance.hunter.kill_order.extend': 1,
  'ordnance.hunter.kill_order.max': 4,
  'ordnance.swarm.rockets': 1,                    // rockets per pod (rank 1 → 3)
  'ordnance.swarm.rocket_damage': 0.35,
  'ordnance.swarm.rocket_blast': 0.5,
  'ordnance.swarm.afterburner': 0,
  'ordnance.swarm.cascade.chance': 0.25,
  'ordnance.swarm.cascade.damage': 0.6,
  'ordnance.bombard.bomb_bay': 0,                 // shells per launcher per volley
  'ordnance.bombard.shell_blast': 2,
  'ordnance.bombard.shell_damage': 1.5,
  'ordnance.bombard.shell_weight': 1,
  'ordnance.bombard.carpet.duration': 3,
  'ordnance.bombard.carpet.dps': 0.2,             // × shell damage per second

  // --- Drones -----------------------------------------------------------------
  'drones.count': 1,
  'drones.cap': 8,                                // Hive ×1.5
  'drones.damage': 16,
  'drones.orbit_radius': 90,
  'drones.speed': 160,
  'drones.attack_speed': 1.2,
  'drones.targeting': 180,                        // engage range from the drone
  'drones.payload.interval': 5,
  'drones.payload.radius': 60,
  'drones.payload.damage': 3,
  'drones.wing.interceptors': 0,                  // damage bonus vs fast enemies
  'drones.wing.interceptor_speed': 0.5,
  'drones.wing.gunships': 1,                      // gunship attack speed multiplier
  'drones.wing.sortie.rearm': 4,
  'drones.arc.link': 0,                           // × drone damage per second along links
  'drones.arc.capacitance': 1,
  'drones.carrier.launch_bay': 0,                 // microdrones per launch
  'drones.carrier.interval': 3,
  'drones.carrier.microdrone_damage': 0.4,
  'drones.carrier.microdrone_life': 6,
  'drones.support.medic': 0,                      // fraction of max HP per second
  'drones.support.shield_drone': 0,               // shield capacity as fraction of max HP

  // --- Blade ------------------------------------------------------------------
  'blade.damage': 20,
  'blade.length': 140,
  'blade.rotation_speed': 3,                      // rad/s
  'blade.knockback': 20,
  'blade.serration': 0,                           // Bleed chance
  'blade.bleed.dps': 0.3,                         // × hit damage per second
  'blade.bleed.duration': 3,
  'blade.twinning.blades': 1,                     // blade count (rank 1 → 2)
  'blade.twinning.edge': 0.7,                     // extra-blade damage fraction
  'blade.greatblade.mass': 0,                     // damage bonus
  'blade.greatblade.length_mul': 1.5,
  'blade.greatblade.rotation_penalty': 0.05,      // per rank of Great Mass
  'blade.greatblade.cleaver': 0,
  'blade.greatblade.sunder.per_hit': 0.02,
  'blade.greatblade.sunder.cap': 0.6,
  'blade.tempest.momentum': 0,                    // rotation bonus per stack
  'blade.tempest.momentum.max_stacks': 10,
  'blade.tempest.afterimage': 0,                  // × blade damage
  'blade.tempest.cyclone.range': 250,
  'blade.tempest.cyclone.damage': 0.6,

  // --- Laser ------------------------------------------------------------------
  'laser.nodes': 2,
  'laser.max_nodes': 8,
  'laser.radius': 170,
  'laser.rotation': 0.6,                          // rad/s
  'laser.beam_width': 6,
  'laser.damage': 60,                             // DPS per beam
  'laser.node_durability': 50,                    // node HP
  'laser.node_rebuild': 4,                        // s
  'laser.pulse.interval': 3.4,                    // rank 1 → 3.0 s
  'laser.pulse.duration': 0.3,
  'laser.pulse.width_mul': 3,
  'laser.pulse.damage_mul': 2,
  'laser.vertex_blast.interval': 2,
  'laser.vertex_blast.length': 200,
  'laser.vertex_blast.damage': 1.5,
  'laser.expansion.nodes': 0,                     // extra nodes beyond laser.nodes
  'laser.expansion.star.intersection_mul': 2,
  'laser.resonance.overlap': 0,
  'laser.resonance.feedback': 0,                  // damage-taken bonus while in 2+ beams
  'laser.resonance.standing_wave.per_second': 0.2,
  'laser.resonance.standing_wave.cap': 2,
  'laser.containment.field': 0,                   // slow inside the polygon
  'laser.containment.field_cap': 0.5,
  'laser.containment.dynamic_geometry': 0,        // max radius stretch fraction
  'laser.containment.crush.every': 8,

  // --- Gravitics --------------------------------------------------------------
  'gravitics.wells': 1,
  'gravitics.pull': 120,                          // units/s
  'gravitics.radius': 90,
  'gravitics.duration': 3,
  'gravitics.cooldown': 8,                        // s
  'gravitics.mass_driver.fraction': 0.1,          // × thrown enemy max HP
  'gravitics.mass_driver.boss_fraction': 0.05,
  'gravitics.damage': 60,                         // crush damage of every well collapse (× (1 + per_captive × captives))
  'gravitics.collapse.implosion': 1,              // Collapse multiplier on well damage (rank 1 → 1.5, +0.5 per rank)
  'gravitics.collapse.base_damage': 30,
  'gravitics.collapse.per_captive': 0.15,
  'gravitics.collapse.yield': 1,
  'gravitics.collapse.chain_collapse.count': 2,
  'gravitics.lensing.bend': 0,                    // damage bonus for lensed shots/beams
  'gravitics.lensing.focus': 0,
  'gravitics.tidal.drift': 0,                     // units/s toward the tower
  'gravitics.tidal.drift_stop': 50,
  'gravitics.tidal.riptide': 1,
  'gravitics.tidal.orbit_lock.seconds': 2,

  // --- Fusions and Triads (node id = magnitude key) ---------------------------
  'fusion.toxic_combustion': 1.75,                // × remaining poison (rank 1 → 2.0, +0.25 per rank)
  'fusion.toxic_combustion.target_cap': 0.15,     // one explosion deals ≤ this × each target's max HP
  'fusion.toxic_combustion.min_stacks': 5,
  'fusion.toxic_combustion.radius': 60,
  'fusion.superconductivity': 0,
  'fusion.thermal_shock': 0,                      // × triggering hit damage
  'fusion.thermal_shock.chill_threshold': 4,
  'fusion.thermal_shock.burn_threshold': 3,
  'fusion.thermal_shock.radius': 50,
  'fusion.electrolysis': 0,
  'fusion.plasma': 0,
  'fusion.plasma.duration': 1,
  'fusion.cryotoxin': 1.25,                       // release multiplier (rank 1 → 1.5)
  'triad.catalyst': 0,
  'triad.polar_storm': 0,
  'triad.crucible': 0,
  'triad.cold_circuit': 0,

  // --- Weapon Linkages (node id = magnitude key) ------------------------------
  'link.primary+ordnance': 0,
  'link.primary+drones': 0.2,                     // rank 1 → 30%
  'link.primary+blade': 0,
  'link.primary+laser': 0,
  'link.primary+gravitics': 0,
  'link.ordnance+drones': 0,
  'link.ordnance+blade': 0,
  'link.ordnance+laser': 0,
  'link.ordnance+gravitics': 0,
  'link.drones+blade': 0,
  'link.drones+laser': 0,
  'link.drones+gravitics': 0,
  'link.blade+laser': 0,
  'link.blade+gravitics': 0,
  'link.laser+gravitics': 0,

  // --- Chassis Linkages -------------------------------------------------------
  'chassis.bastion+ordnance': 0,                  // missiles per barrier break
  'chassis.bastion+drones': 0,
  'chassis.bastion+blade': 0,
  'chassis.bastion+laser': 0,
  'chassis.bastion+gravitics': 0,                 // cooldown reduction (s)
  'chassis.bastion+gravitics.cooldown': 16,
  'chassis.bastion+gravitics.crowd': 6,
  'chassis.reactor+ordnance': 0,
  'chassis.reactor+drones': 0,
  'chassis.reactor+blade': 0,
  'chassis.reactor+laser': 0,
  'chassis.reactor+gravitics': 0,

  // --- Infusions (node id = magnitude key) ------------------------------------
  'infuse.ordnance.fire': 0, 'infuse.ordnance.lightning': 0, 'infuse.ordnance.poison': 0, 'infuse.ordnance.frost': 0,
  'infuse.drones.fire': 0, 'infuse.drones.lightning': 0, 'infuse.drones.poison': 0, 'infuse.drones.frost': 0,
  'infuse.blade.fire': 0, 'infuse.blade.lightning': 0, 'infuse.blade.poison': 0, 'infuse.blade.frost': 0,
  'infuse.laser.fire': 0, 'infuse.laser.lightning': 0, 'infuse.laser.poison': 0, 'infuse.laser.frost': 0,
  'infuse.gravitics.fire': 0, 'infuse.gravitics.lightning': 0, 'infuse.gravitics.poison': 0, 'infuse.gravitics.frost': 0,

  // --- Prestige (meta) --------------------------------------------------------
  'prestige.memory_of_steel': 0,                  // free Caliber ranks at Prestige start
  'prestige.memory_of_motion': 0,                 // free Autoloader ranks at Prestige start
  'prestige.accelerated_clearing': 0,             // speed = 2^rank below previous best
  'prestige.checkpoint_dividend': 0,
  'prestige.frames': 0,
  'prestige.blueprint_slots': 0,
  'prestige.weapon_seed': 0,
  'prestige.elemental_memory': 0,
  'prestige.early_hardpoints': 0,                 // waves earlier
  'prestige.third_attunement': 0,
  'prestige.keepsake': 0,
  'prestige.anomaly_socket': 0,
  'prestige.branch_discount': 0,
  'prestige.branch_discount.amount': 0.25,
  'prestige.autocast': 0,
  'prestige.trials': 0,
  'prestige.third_tactical_slot': 0,
  'prestige.threat_dial': 0,
  'prestige.speed_controls': 0,
  'prestige.expanded_frame': 0,
  'prestige.dual_doctrine': 0,
  'prestige.dual_doctrine.strength': 0.6,
  'prestige.duplication': 0,
  'prestige.double_launch': 0,
  'prestige.conscription': 0,
  'prestige.overflow': 0,
  'prestige.reversal': 0,
  'prestige.ghost_edges': 0,
  'prestige.critical_relay': 0,
  'prestige.held_open': 0,
  'prestige.relay_fire': 0,
  'prestige.autonomy': 0,
  'prestige.paradox_pool': 0,
  'directives.slots': 2,                          // Directives rank 1 → 3 slots
  'directives.reaction_delay': 0.6,
  'directives.counter_efficiency': 0.5,
  'offline.cap_hours': 8,
  'offline.efficiency': 0.4,

  // --- Constellation bridges --------------------------------------------------
  'star.bridge.primary+laser': 0,
  'star.bridge.ordnance+drones': 0,
  'star.bridge.ordnance+laser': 0,

  // --- Knockback governor and anti-stall (docs/BALANCE.md "Stalls and knockback"; core/forces.ts, enemies/recovery.ts,
  //     run/stall.ts). No node writes these yet: they are tunables, resolved like every other stat. ---
  'knockback.reach': 0.85,                        // outward pushes stop at this fraction of the primary's range (and at the arena rim)
  'knockback.stack_decay': 0.5,                   // each further outward push inside the window is ×0.5 as strong…
  'knockback.stack_floor': 0.1,                   // …but never below 10% of its force
  'knockback.stack_window': 2,                    // seconds: pushes this close together stack (the window restarts on each push)
  'knockback.focus_seconds': 1,                   // a weapon keeps its target for this long after the target was pushed
  'knockback.rally_speed': 2,                     // movement ×2 while a pushed enemy walks back to where it was pushed from
  'knockback.regen_grace': 3,                     // seconds after a push with no shield / HP regeneration
  'wave.stall_seconds': 10,                       // no kill and no net HP/shield removed for this long → Rush
  'wave.rush_speed': 3,                           // Rush movement multiplier, reached after…
  'wave.rush_ramp': 8,                            // …this many seconds (linear ramp from ×1)
  'wave.rush_knockback': 0.25,                    // Rushing enemies take at most 25% of any knockback

  // --- Boons (data/boons.ts): keys only boons write; the defaults leave behaviour unchanged ---
  'bastion.shield_hp_frac': 0,                    // extra shield capacity as a fraction of max HP (Ablative Shell)
  'bastion.damage_taken_mul': 1,                  // multiplier on damage the tower takes, after armor (Overclocked)
};
