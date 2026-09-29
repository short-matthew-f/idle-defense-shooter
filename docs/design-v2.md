# Project Citadel — Design Document v2

Sep 28, 2026 · @Matthew Short

## Change log from the first pass

v2 keeps the first pass's loop, trees, and bosses, and fixes its three structural gaps: builds never had to commit, Prestige had no defined wall, and formation costs ignored build type. Everything else below follows from those fixes or adds long-term content.

| Area | Change | Type | Why |
| --- | --- | --- | --- |
| Build identity | Frames, Hardpoints, Attunements, Doctrines (§4) | Added | Every system could be bought, so builds converged on generalist |
| Cores | Now the commitment currency: Exotics, Refits, Doctrine changes, rerolls | Replaced | First pass only used them to gate tree sections |
| Prestige | Prestige Wall, Echo rate, Prestige Forecast (§3) | Added | First pass never said when pushing stops beating resetting |
| Checkpoints | Death restarts at the wave after the last cleared boss; cleared bosses are never re-fought | Resolved | First pass was ambiguous |
| Idle loop | Push and Patrol modes | Added | Nothing decided when an idle tower attempts the boss |
| Waves | Wave content fixed per Prestige seed | Added | Failures should be learnable, not luck |
| Fusions | Plasma (Fire + Lightning) and Cryotoxin (Poison + Frost) | Added | First pass defined 4 of the 6 pairs |
| Elements | Each element forks into two Doctrines | Added | Elements were single-path |
| Hardpoints | Gravitics | Added | Area builds had no answer to spread formations |
| Ordnance | Bomb Bay folded into the Bombard Doctrine | Replaced | Two launchers competed inside one system |
| Cross-system | Free list replaced by 15 weapon Linkages, 10 Chassis Linkages, 20 Infusions | Replaced | Needs structure to price, test, and gate by what is mounted |
| Items | Anomalies (§9) | Added | Per-Prestige variety; the sanctioned way to bend commitment rules |
| Automation | Prestige III rules become Directives with reaction delay and efficiency caps | Replaced | Full-strength automation erased active play late |
| Active play | Boss Tells and Counters | Added | A late-game skill niche automation cannot fully match |
| Long tail | Trials, Chain Codex, Threat Dial, Deep Waves (§16) | Added | Something to do at the wall; months of play |
| Readability | Kill-Chain Inspector | Added | "That sentence is the game" needed a tool to trace it |
| Readability | Draw order, density governor, threat halos | Added | Spectacle was eating enemy legibility |
| Enemies | Five Sectors; Anchor, Refractor, Jammer | Added | Pacing variety; every system gets a counter |
| Balance | Formation Difficulty Multiplier is per archetype | Replaced | A spiral is easy for Fire and hard for Lightning |
| Economy | Four currencies plus one combat meter, stated as such | Resolved | First pass said three but had five |
| Singularity | "All systems interact freely" replaced by bounded Singularity nodes and a Frame | Replaced | A blanket rule cannot be tested or balanced |
| Ascension | Each Ascension also unlocks a Frame or content, an Anomaly pool, and a Constellation region | Added | Ascensions needed build rewards, not only harder rules |

## 1. High concept and pillars

Project Citadel is a browser idle tower-defense game where a single tower in an open arena is the player's character, and each Prestige is a new machine they design.

Enemies enter from the perimeter in authored formations. The tower starts with one gun and grows into a weapons platform of drones, missiles, blades, laser geometry, gravity wells, and chained elemental effects. Every fifth wave is a boss and a checkpoint, and failure is the main progression mechanism.

Waves 1–100 form the Prestige macro-cycle. Wave 100 opens Ascension, which changes the rules. Deep Waves continue past that indefinitely.

**Pillars**

1. **Watching the machine is the reward.** Combat must be satisfying with zero input.
2. **Growth changes behavior, not just numbers.** Every tree starts numeric and ends mechanical.
3. **Failure creates progress.** Scrap and upgrades survive death. A failed attempt should reveal three or four exciting purchases.
4. **Commitment creates identity.** Each Prestige locks a Frame, Hardpoints, Attunements, and Doctrines. The next Prestige is a different machine.
5. **Active play is an edge, never a toll.** Idle builds clear everything; attentive players clear it in 15–30% fewer attempts.
6. **Geometry is content.** Where enemies come from matters as much as what they are.
7. **Every chain is traceable.** The player can always find out why something happened.
8. **Absence is never punished.** No dailies, streaks, expiring events, or decaying progress.

The test sentence stays: "The drone shocked the frozen enemy, which caused the lightning to jump through the laser node, which detonated its poison, which killed the elite, which launched the missiles." That sentence is the game.

## 2. Core loop and checkpoint rules

The loop is push, fail, spend, push again; clearing a boss sets a checkpoint the player never falls behind until they Prestige.

Push past the checkpoint → die → spend banked Scrap → push farther → kill the boss → new checkpoint → repeat until the Prestige Wall (§3) → Prestige.

| Rule | Detail |
| --- | --- |
| Checkpoints | Clearing wave 5, 10, 15 … 100 sets a checkpoint for the rest of the Prestige |
| Death | Restart at the first wave after the last cleared boss. Dying on wave 18 with wave 15 cleared restarts at 16. Cleared bosses are never re-fought |
| Persistence | Scrap banks on kill. Upgrades persist through death. Both reset on Prestige |
| Tower health | Full at attempt start; +25% of max between waves |
| Command Energy | Carries between waves within one attempt; empties on death |
| Wave content | Fixed per Prestige seed: every attempt at wave 17 is the same wave 17 |
| First clears | The first clear of a wave in a Prestige pays ×3 Scrap |
| Push mode (default) | Advance through waves; on death, restart from the checkpoint and push again automatically |
| Patrol mode | Loop the four waves after the checkpoint without engaging the boss. Used offline and for deliberate farming |
| Restart | The player can restart the current checkpoint at any time |
| Shopping | Between waves, or during combat from a compact panel over the battlefield |

Ordinary waves last 30–60 seconds and bosses 60–150 seconds, so one attempt runs about 3–6 minutes.

Fixed wave content matters because a failed attempt should fail because the build was short, not because the roll was bad. It also lets active players learn a wave and plan their Counters (§10).

## 3. The Prestige Wall

The player should Prestige when this run's Echoes per hour peaks. The economy guarantees that peak arrives 8–15 waves past the previous best, and the Prestige Forecast shows it.

**Why a wall forms**

1. **Income tracks depth.** Scrap per kill grows ×1.11 per wave, and first clears pay ×3. Patrolling a fixed checkpoint earns a flat rate.
2. **Enemies outgrow income.** Enemy HP grows ×1.13 per wave, so each wave pushed costs proportionally more power than it pays.
3. **Stat ranks decay in value.** Stat ranks give linear gains at geometric prices (×1.15–1.22 per rank).
4. **Mechanics run out.** Behavior-changing unlocks are the only step changes, and commitment (§4) limits how many exist in one build.

The build runs out of new behavior before the enemies run out of HP. That is the wall. Once the build's Hardpoints, Attunements, Doctrines, and Exotics are bought through their mechanical tiers, only stat ranks remain.

**Why Prestige beats the wall**

Echoes grow ×1.2 per wave of depth, about ×2.5 per checkpoint, so every push pays more than the last. Echo upgrades multiply Scrap and damage and speed up cleared content, so a fresh run reclimbs fast. A new Prestige also means a new build, which reopens every mechanical step change.

**How the player sees it: the Prestige Forecast**

Available from wave 20, always one tap away.

| Readout | What it shows |
| --- | --- |
| Echoes now | Echoes if the player Prestiges this second |
| Echo rate | Echoes now ÷ hours since this Prestige began, with its peak marked |
| Next boss | Projected Echoes and Echo rate after the next checkpoint |
| Reclimb estimate | Time a new Prestige would need to reach this depth, with Echoes spent sensibly |
| Wall gauge | Time until the next affordable behavior-changing unlock at current income |

Total Echoes over a lifetime are maximized by resetting when the marginal Echo rate drops below the average rate. That is exactly when the running average peaks, so the meter only has to show one curve. When the rate sits 15% below its peak for one full checkpoint cycle, the panel says "Prestige recommended."

The game never Prestiges on its own unless an Auto-Prestige Directive (§11) says so. The wall is soft: players can stay, nothing decays, and from Prestige II on they have Trials, Codex hunting, and the Threat Dial to work on (§16).

**Tuning targets** (asserted by the simulator, §19)

- First Prestige recommended between waves 22 and 28.
- Each new Prestige reclimbs to the previous best in 25–40% of the previous run's time.
- Each new Prestige pushes 8–15 waves past the previous best.
- The recommendation lands within 10% of the true Echo-rate peak.

## 4. Build identity

A build is five commitments: a Frame, Hardpoints, Attunements, Doctrines, and Anomalies. The first four lock for the Prestige; Anomalies are drafted as it goes (§9).

**Frames** are chosen at Prestige start. Each sets caps and one trait.

| Frame | Unlock | Hardpoints | Attunements | Trait |
| --- | --- | --- | --- | --- |
| Standard | Start | 3 | 2 | No modifiers; the baseline |
| Arsenal | Prestige II | 4 | 1 | Hardpoint trees cost 15% less; primary damage −25% |
| Conductor | Prestige II | 2 | 3 | Statuses apply +1 stack; Fusions start at rank 1 |
| Monolith | Trial: Bare Metal | 1 | 2 | Primary runs two Barrel Doctrines at full strength |
| Hive | Trial: Hive Mind | 2 + Drones | 2 | Drones mounted free; drone cap +50%; primary fires at half rate |
| Bulwark | Trial: Siege Mentality | 3 | 2 | Bastion runs two Doctrines; Retaliation scales with armor |
| Echo Engine | Ascension I | 3 | 2 | Every 8th attack of each system repeats |
| Prism | Ascension III | 3 + Laser | 2 | Laser Polygon mounted free; beams carry every attuned element |
| Singularity Core | Ascension V | 4 | 4 | Dual Doctrine in every tree; enemies +50% HP |

Hard rule: no build ever mounts more than four hardpoint systems, free mounts included. One of the five always sits out.

**Hardpoints.** Slots open at waves 10, 30, 55, and 75, up to the Frame's cap. When a slot opens, the player picks a system (§7) and its tree opens. Mounted systems lock for the Prestige. A Refit swaps one out for 3 Cores and refunds 60% of the Scrap spent in the removed system.

**Attunements.** Element slots open at waves 5, 25, and 45, up to the Frame's cap. An attuned element opens its tree, its Infusions (§8), and any Fusion with another attuned element. Attunements lock for the Prestige.

**Doctrines.** Every tree forks once at its middle tier into 2–4 mutually exclusive Doctrines, each with its own capstone. Nodes below the fork are shared. Changing a Doctrine costs 1 Core and is allowed only at a checkpoint.

**Cores** are the commitment currency. Each boss drops one on its first kill per Prestige, 20 per full run; elites rarely drop one.

| Core use | Cost |
| --- | --- |
| Exotic node (one per tree, §5–§7) | 2 |
| Refit a hardpoint | 3 |
| Change a Doctrine | 1 |
| Reroll an Anomaly draft | 1 |

A Standard build has eight trees with Exotics, so buying every Exotic takes 16 of 20 Cores and leaves almost nothing for Refits. That scarcity is the point.

## 5. The Chassis: Ballistics, Bastion, Reactor

Three trees are always available regardless of Frame: Ballistics is the primary weapon, Bastion is survival, and Reactor is system-wide behavior and economy.

**Ballistics.** Base nodes: damage, attack speed, range, projectile speed, crit chance, crit damage, target acquisition. Shared late node: Execution (bonus damage to injured enemies; executions refund Command Energy). Exotic: Gunstorm (every Nth attack fires a burst from every barrel).

| Barrel Doctrine | Identity | Capstone |
| --- | --- | --- |
| Multishot | 2 → 5 projectiles; the damage penalty shrinks with ranks | Split Sight: extra projectiles pick independent targets |
| Piercing | More penetration, less loss per target, speed gain per pierce | Last Rites: the final enemy pierced takes ×4 damage |
| Ricochet | Bounce count and range | Return Fire: bounces revisit struck enemies after new targets run out |
| Heavy Rounds | Slower fire; bigger size, knockback, and damage | Staggerhead: impacts stagger elites and interrupt boss casts |

**Bastion.** Base nodes: max HP, armor, shield capacity, shield recharge, regeneration, resistance. Exotic: Second Core (once per wave, lethal damage leaves the tower at 1 HP with 3 s of invulnerability).

| Bastion Doctrine | Identity | Capstone |
| --- | --- | --- |
| Fortress | HP and armor; Fortification builds temporary HP at full health | Keep: overflow healing becomes a barrier |
| Aegis | Outer Barrier; Shockwave Shield pushes enemies when it breaks | Mirror Aegis: the barrier reflects enemy projectiles |
| Thorns | Retaliation and Reactive Armor | Spite: reflected damage chains to a second enemy |
| Phoenix | Last Stand: damage rises as HP falls | Ember Heart: below 25% HP, every system gains 30% speed |

Defensive builds must be real progression builds; §19 tests this.

**Reactor.** Base nodes: global attack speed, cooldown reduction, targeting logic, Energy Recycling. Exotic: Critical Mass (every system speeds up while many enemies are alive).

| Reactor Doctrine | Identity | Capstone |
| --- | --- | --- |
| Overclock | Global speed and cooldowns | Overdrive Core: every 30 s, 5 s of +50% speed |
| Salvage | Scrap income, Boss Scavenging, Checkpoint Dividend; about −15% combat power for +35% income | Strip Mine: first clears pay ×4 instead of ×3 |
| Synchronization | Combo bonus when 2+ systems hit one target within 0.5 s | Harmonic Lock: at 4+ systems, the combo target takes +50% from all sources |
| Command | Command Energy cap and regeneration; tactical cooldowns | Fourth Slot: a fourth tactical ability |

Salvage is the idle, fast-Prestige Doctrine. Command is the active-play Doctrine.

## 6. Elements and fusions

Four elements attach to the primary weapon natively and to hardpoints through Infusions (§8). Each forks into two Doctrines, and any two attuned elements unlock their Fusion.

| Element | Base | Doctrine A | Doctrine B | Exotic |
| --- | --- | --- | --- | --- |
| Fire | Burn chance, stacks, duration; spread on death | Wildfire: Flashpoint explosions spread Burn stacks | Inferno: Fireball replaces every Nth shot; crits always ignite | Meteor Round: every 5th Fireball leaves a burning zone |
| Lightning | Arcs to 2 → 5 targets | Chain: Forked Current, Static Charge, Discharge | Storm: Ball Lightning; bosses become arc anchors | Supercell: enough arcs in 2 s start a storm around the tower |
| Poison | Stack application and cap | Plague: Contagion, Plague Carrier | Venom: Virulence, Corrosion, Toxic Burst | Pandemic: elite and boss poison seeds copies into the wave |
| Frost | Chill stacks slow movement | Control: Deep Freeze, Permafrost, Glacial Shot | Shatter: Brittle, Iceburst | Absolute Zero: max Chill also slows attacks and ability cooldowns |

Fusions have 3 ranks each and unlock when both elements are attuned.

| Fusion | Elements | Effect |
| --- | --- | --- |
| Toxic Combustion | Fire + Poison | Burning a heavily poisoned enemy consumes poison to explode |
| Superconductivity | Lightning + Frost | Arcs prefer chilled enemies and gain damage per chilled link |
| Thermal Shock | Fire + Frost | Fire on a heavily chilled enemy, or Frost on a burning one, bursts physical damage |
| Electrolysis | Lightning + Poison | Arcs instantly deal a share of the target's pending poison |
| Plasma | Fire + Lightning | Arcs through burning enemies leave a 1 s plasma line along their path |
| Cryotoxin | Poison + Frost | Poison on a frozen enemy is banked, then released at ×1.5 on thaw |

Ascension II adds four Triads for builds with three attuned elements (§15).

## 7. Hardpoint systems

Five systems compete for at most four hardpoint slots. Each has base nodes, a Doctrine fork, an Exotic, and a counter-enemy (§12).

**Ordnance** is a missile rack. Base: launchers, tracking, reload, range, blast radius, Overkill Guidance (retarget if the target dies). Exotic: Cluster Warheads (split before impact).

| Ordnance Doctrine | Identity | Capstone |
| --- | --- | --- |
| Hunter | Prioritizes elites and bosses; Siegebreaker boss damage | Kill Order: missile hits on a weak point extend its exposure 1 s |
| Swarm | Many small rockets; Afterburner acceleration | Cascade: each explosion may launch a smaller missile |
| Bombard | Converts the rack into a Bomb Bay lobbing shells into dense groups | Carpet: shells leave hazard zones that merge when they overlap |

**Drones** orbit and attack independently. Base: count, orbit radius, speed, attack speed, targeting. Exotic: Payload (each drone periodically drops a bomb).

| Drone Doctrine | Identity | Capstone |
| --- | --- | --- |
| Wing | Interceptors hunt fast enemies and kamikazes; gunships sustain fire | Sortie: drones detach, pursue, and return |
| Arc | Lightning links between drones | Faraday Web: links form a mesh that damages anything crossing it |
| Carrier | Carriers release temporary microdrones | Brood: microdrones inherit on-hit effects |
| Support | Medic and shield drones | Aegis Wing: drones intercept enemy projectiles |

**Orbital Blade** sweeps around the tower. Base: damage, length, rotation speed, knockback, Serration (Bleed). Exotic: Deflection (the blade destroys enemy projectiles).

| Blade Doctrine | Identity | Capstone |
| --- | --- | --- |
| Twinning | 2 → 4 blades at distinct radii | Gyre: alternate blades counter-rotate |
| Greatblade | One huge blade; Cleaver vs high-HP enemies | Sunder: hits permanently strip armor and shield capacity |
| Tempest | Speed, Momentum, Afterimage trails | Cyclone: at max speed, the blade throws cutting arcs outward |

**Laser Polygon** joins orbital nodes with beams. Base: node count (2 → 5), radius, rotation, beam width, damage, node durability, Pulse. Exotic: Vertex Blast (nodes fire outward).

| Laser Doctrine | Identity | Capstone |
| --- | --- | --- |
| Expansion | Nodes up to 8; Star Configuration | Mandala: an inner star plus an outer ring |
| Resonance | Bonus damage to enemies touching several beams | Standing Wave: multi-beam damage compounds each second it holds |
| Containment | The interior slows enemies; Dynamic Geometry | Crush: the polygon contracts periodically, dragging enemies inward |

**Gravitics** (new) places gravity wells. A well spawns where its pull radius catches the most enemies, drags them into a knot for a few seconds, then collapses. It exists so area builds can answer spread formations. Base: well count, pull strength, radius, duration, cooldown. Exotic: Mass Driver (enemies flung out of wells collide for damage).

| Gravitics Doctrine | Identity | Capstone |
| --- | --- | --- |
| Collapse | Wells implode for damage scaled by enemies captured | Chain Collapse: implosions spawn smaller wells |
| Lensing | Projectiles and beams near wells bend toward them and gain damage | Focal Point: projectiles passing a well converge on one target |
| Tidal | Wells drift toward the tower, dragging enemies into blade and beam range | Orbit Lock: captured enemies are flung into orbit through the blade's path |

Tidal carries real risk: it drags kamikazes inward too.

## 8. Linkages and Infusions

Cross-system rules are purchasable nodes that appear only when both halves are present. That keeps them priceable, testable, and tied to the build the player committed to.

**Weapon Linkages** join two weapon systems; the primary weapon counts as always mounted. A three-hardpoint build sees 6 of these, and a four-hardpoint build sees 10. Each has 3 ranks.

| Pair | Linkage | Effect |
| --- | --- | --- |
| Primary + Ordnance | Shell Casing | Crits mark targets; missiles at marked targets gain crit chance |
| Primary + Drones | Wingman | Drones copy the primary's on-hit effects at 30% strength |
| Primary + Blade | Whetstone | Shots crossing the blade's arc gain +1 pierce; crits briefly speed the blade |
| Primary + Laser | Energized Rounds | Shots crossing a beam gain damage and the beam's Infusion |
| Primary + Gravitics | Slingshot | Shots curve toward wells and gain damage per well passed |
| Ordnance + Drones | Spotter | Drone hits designate missile targets; missile kills spawn a microdrone |
| Ordnance + Blade | Shrapnel Sweep | Blade hits on enemies caught in explosions deal bonus damage |
| Ordnance + Laser | Charged Warheads | Missiles crossing an edge split on impact |
| Ordnance + Gravitics | Payload Well | Explosions inside a well gain radius per captured enemy |
| Drones + Blade | Escort Blades | Drones carry miniature orbital blades |
| Drones + Laser | Mobile Vertex | Drones act as temporary laser nodes |
| Drones + Gravitics | Gravity Assist | Drones slingshot around wells, gaining speed and damage |
| Blade + Laser | Vertex Strike | The blade passing a node triggers a Vertex Blast |
| Blade + Gravitics | Undertow | Blade damage rises against enemies inside wells |
| Laser + Gravitics | Bent Light | Beams curve through wells, extending coverage |

**Chassis Linkages** connect Bastion and Reactor to each mounted hardpoint (3 ranks each).

| Pair | Effect |
| --- | --- |
| Bastion + Ordnance | Barrier breaks launch a missile volley |
| Bastion + Drones | Drone kills restore shield |
| Bastion + Blade | Shield hits briefly speed the blade |
| Bastion + Laser | Beams thicken while the barrier holds |
| Bastion + Gravitics | A defensive well spawns when the inner ring gets crowded |
| Reactor + Ordnance | Kills during Critical Mass reload a launcher |
| Reactor + Drones | Synchronization combos give drones a speed burst |
| Reactor + Blade | Blade rotation counts as attack speed for Overclock |
| Reactor + Laser | Pulse cadence scales with global attack speed |
| Reactor + Gravitics | Well cooldown drops per enemy captured |

**Infusions** put attuned elements into hardpoints: one node per attuned element in each mounted tree, 3 ranks each. The primary weapon takes elements natively.

| System | Fire | Lightning | Poison | Frost |
| --- | --- | --- | --- | --- |
| Ordnance | Craters burn | Blasts arc to 3 enemies | Blasts leave toxic clouds | Blasts leave ice patches |
| Drones | Incendiary rounds | Hits arc to the nearest drone's target | Stingers apply stacks | Hits Chill |
| Blade | The blade leaves fire trails | The blade arcs on contact | Hits apply stacks; kills contaminate the blade | Hits Chill; frozen hits shatter |
| Laser | Beams ignite | Vertices arc outward | Beams apply stacks each second | Beams slow; the interior frosts over time |
| Gravitics | Wells become firestorms | Wells arc between captives | Wells become toxic vortices | Wells freeze captives on collapse |

## 9. Anomalies

Anomalies are drafted rule-breakers that make each Prestige play differently, and they are the only sanctioned way to bend Doctrine and Hardpoint limits.

- **Draft:** the first clear of waves 10, 20 … 100 in each Prestige offers three Anomalies. Pick one, or skip for 1 Core. Rerolling costs 1 Core.
- **Sockets:** 3, +1 at Prestige II, +1 at Ascension I (5 max). A pick beyond capacity replaces a socketed Anomaly.
- **Lifetime:** lost on Prestige, except one Keepsake (Prestige II node).
- **Rarities:** Common (a stat twist), Rare (a rule change), Paradox (breaks a commitment rule), Cursed (large upside, real downside).
- **Relevance:** drafts weight toward the current build; at most one of three offers needs a system the build lacks.
- **Growth:** pools expand through Trials, Codex milestones, and Ascensions.

| Anomaly | Rarity | Effect |
| --- | --- | --- |
| Spare Barrel | Paradox | A second Barrel Doctrine at 50% strength |
| Borrowed Blade | Paradox | A tier-1 Orbital Blade runs without a hardpoint |
| Recursive Warhead | Paradox | Cluster Warheads without buying the Exotic |
| Loaded Dice | Rare | Crits roll twice and keep the higher |
| Seventh Shot | Rare | Every 7th primary shot is a Fireball, even without Fire |
| Mirror Node | Rare | Laser nodes mirror across the tower: double nodes, −40% beam damage |
| Pinball | Rare | Ricochets bounce off the arena edge |
| Stormglass | Rare | Frozen enemies conduct lightning at double range |
| Clockwork Blade | Rare | The blade reverses every 6 s, emitting a shockwave |
| Ghost Protocol | Rare | Enemies killed by drones fight for the tower for 3 s |
| Rogue Moon | Rare | A small mass orbits at long range, dealing contact damage with a weak pull |
| Cold Iron | Common | Each Chill stack also removes 1% armor |
| Heavy Water | Common | Poison ticks 25% slower and hits 50% harder |
| Overcharged Capacitor | Common | Command Energy cap +50% |
| Second Opinion | Common | Two Target Designators |
| Glass Cannon | Cursed | +80% damage, −50% max HP |
| Unstable Isotope | Cursed | Explosions +50% radius; 5% detonate on the tower |
| Tithe | Cursed | Bosses drop 2 Cores; no healing between waves |
| Hungry Core | Cursed | Kills heal 1% HP; no other regeneration |

Balance cap: no single Anomaly raises the Optimizer's deepest wave by more than 15%, or 25% for Paradox (§19).

## 10. Active play

The active player commands the tower rather than aiming it, and earns a 15–30% edge measured in attempts saved. Idle builds can still clear everything.

**Target Designator.** Tap an enemy; every weapon that can reach it strongly prefers it. A designated boss weak point takes double damage from all systems.

**Manual aim.** Hold to steer the primary weapon. Manual shots gain +10% crit chance, not raw damage, and automatic fire resumes on release.

**Command Energy** is an in-combat meter, not a currency. Kills, elite kills, boss phase changes, and surviving at low HP fill it (cap 100 at start). It carries between waves within an attempt and empties on death.

**Tactical abilities.** Two slots at start, a third at Prestige III, and a fourth from the Command Doctrine capstone. Each ability has a 3-rank node in the Reactor tree.

| Ability | Cost (CE) | Effect |
| --- | --- | --- |
| Hunter Mark | 25 | All systems prioritize one enemy; +50% status application on it |
| Repulsor Pulse | 30 | Pushes nearby enemies away |
| Time Field | 35 | Enemies in an area move at 20% speed for 6 s |
| Bombardment | 40 | Large explosive charge anywhere |
| EMP | 40 | Strips shields; interrupts enemy abilities for 3 s |
| Overdrive | 45 | ×2 attack speed for 5 s |
| Emergency Repair | 50 | Restores 30% HP |
| Drone Surge | 50 | Temporary expendable drones |
| Missile Storm | 60 | Temporary homing swarm |
| Singularity Bomb | 70 | Pulls enemies together, then explodes |

**Boss Tells and Counters.** Every boss telegraphs its signature attacks with a 1.0–1.5 s visual tell. The right ability during the tell scores a Counter: the attack fails, a weak point opens for 4 s, and half the ability's cost is refunded. Each boss's Counter is listed in §13.

Rules that keep Counters fair:

- Every boss is clearable without Counters at about 1.3× the power needed with them.
- Directives can attempt Counters but earn 50% of the reward, rising to 75% with upgrades. A human always earns 100%.
- Tells read by shape and motion, never by color alone.

## 11. Directives

Directives are the player's automation program: they make idle play smarter without matching an attentive player. Target: Directive play closes 40–70% of the gap between idle and active.

| Stage | Unlocks |
| --- | --- |
| Prestige II | Autocast: each ability fires whenever affordable; Blueprints |
| Prestige III | Directives (3 slots, up to 12), Targeting Profiles, Upgrade Queue |
| Prestige IV | Auto-Prestige action; Adept conditions that read boss tells |

A Directive reads WHEN condition AND condition → DO action, checked in priority order.

- **Conditions:** enemies in the inner ring ≥ N; a group of ≥ N within radius R; tower HP < X%; barrier broken; boss phase = k; boss tell active (Adept); elite or enemy type present; CE ≥ X; boss or ordinary wave; Forecast recommends Prestige.
- **Actions:** cast an ability at the largest group, nearest threat, boss, or tower; designate the highest threat, a healer, a warden, a weak point, or the nearest kamikaze; switch Targeting Profile; switch Push or Patrol; Prestige.
- **Examples:** "WHEN 5 enemies in inner ring → Repulsor Pulse." "WHEN group ≥ 12 → Bombardment at largest group." "WHEN Forecast recommends AND wave is ordinary → Prestige."

**Targeting Profiles** set a priority order per system: nearest, closest to tower, lowest HP, highest HP, elites, support enemies, fastest, designated.

**Upgrade Queue** is an ordered buy list with keep-pace rules, such as "keep Barrier within 3 ranks of Armor."

**Blueprints** save a Frame, Hardpoints, Attunements, Doctrines, Targeting Profiles, and Upgrade Queue, loadable at Prestige start.

**Limits.** Directives act after a 0.6 s reaction delay (0.3 s with upgrades). They cannot pre-place abilities where a formation is about to arrive. Prediction and Counter timing stay human skills.

## 12. Enemies, Sectors, and formations

Waves 1–100 are five Sectors of 20 waves, each introducing enemies, a palette, and a finale boss. Enemies read by silhouette and motion first, color second.

| Sector | Waves | Introduces | Palette |
| --- | --- | --- | --- |
| Outskirts | 1–20 | Grunt, Swarm, Runner, Brute, Kamikaze, Shielded | Amber on charcoal |
| The Hive | 21–40 | Splitter, Carrier, Healer, Leech, Veteran | Acid green on dark olive |
| The Bastion Line | 41–60 | Armored, Warden, Artillery, Charger, Anchor | Steel blue on slate |
| The Fold | 61–80 | Phase, Burrower, Nullifier, Refractor | Violet on black |
| The Court | 81–100 | Jammer, full Elites, mixed rosters | Gold and white on navy |

The 19 enemy families from v1 remain. Three are new, each a counter to specific systems:

| Enemy | Behavior |
| --- | --- |
| Anchor | Immune to pull, knockback, and freeze; Chill slows it at half effect |
| Refractor | Deflects laser beams and takes 70% less beam damage |
| Jammer | Inside its radius, drones lose targeting and missiles fly straight |

**Counter map.** Every system has formations it loves and an enemy that punishes it. Counter enemies are capped at 20% of a wave's Threat Budget, 35% in Ascension.

| System | Favored formations | Countered by |
| --- | --- | --- |
| Ballistics | Columns, packed wedges | Phase, Shielded |
| Fire | Dense spirals, comet tails | Nullifier, Runners |
| Lightning | Spokes, scattered rain | Lone Brutes |
| Poison | Brute columns, bosses | Swarm (dies before ticks matter) |
| Frost | Annular rushes, Runners, Chargers | Anchor |
| Ordnance | Clusters | Jammer |
| Drones | Scattered rain, flanks | Jammer |
| Blade | Rushes, Kamikaze rings | Artillery |
| Laser | Ring assaults, moving walls | Refractor |
| Gravitics | Spokes, pincers, scatter | Anchor |

**Formations.** Each wave combines a Threat Budget, the Sector roster, and a Formation Script. Scripts include radial rings, tightening spirals, alternating spokes, crescents, rotating wedges, twin columns, expanding flowers, comet tails, concentric assaults, synchronized bursts, serpentine lines, escorts, scattered rain, pincers, artillery rings, moving walls, and delayed ambushes. Parameters vary lane count, angular spread, tempo, radial speed, rotation, and escort ratio. 24 templates ship at launch; Ascension III adds 12 spatial ones.

**Generator rules**

1. Budget spending uses each template's median Difficulty Multiplier across build archetypes at that wave (§19).
2. A template is excluded at a wave if any archetype's multiplier exceeds 1.5× that median.
3. Waves just before a boss (4, 9, 14 …) draw from the flattest templates.
4. The generator never reads the player's build, and waves are fixed per Prestige seed.

## 13. Bosses

Every fifth wave is a boss that tests one system, not just a health bar. Health bars show phase markers, and phases expose weak points or vulnerable parts. Sector finales (20, 40, 60, 80, 100) have three phases and gate the Prestige layers.

| Wave | Boss | Tests | Tell → Counter |
| --- | --- | --- | --- |
| 5 | The Breaker | Basic DPS and survival | Slam wind-up → Repulsor Pulse staggers it |
| 10 | Broodheart | Area damage vs spawning swarms | Brood sac swells → Bombardment on the sac kills the brood inside |
| 15 | The Warden | Target priority and shields | Shield links form → EMP severs them for 6 s |
| 20 | The Siege Engine | Mixed threats; first Prestige gate | Ram charge → Time Field stalls the ram, exposing its core |
| 25 | Iron Maw | Sustained damage vs extreme HP | Maw opens → designate the mouth |
| 30 | Mirror Hive | Clones and crowd control | Clone shuffle → Hunter Mark on the true one, shown for 0.5 s |
| 35 | Storm Crown | Survival through hazards | Hazard ring forms → Repulsor Pulse clears the inner ring |
| 40 | The Distant Saint | Ranged artillery and escorts | Halo charges → Missile Storm interrupts it |
| 45 | Leech Queen | Shield drain and healing | Feeding tethers → EMP breaks them |
| 50 | Splinter King | Multi-stage fragmentation | Split flash → Singularity Bomb gathers the fragments |
| 55 | Null Engine | Damage-type diversity | Resistance rotates → designate the node matching its weak type |
| 60 | The Chronophage | Speed changes and bursts | Dilation pulse → Time Field cancels its acceleration |
| 65 | Hive Fortress | Continuous add generation | Gate opens → Bombardment into the gate |
| 70 | Redline | Extreme movement speed | Dash lane glows → Time Field on the lane |
| 75 | Grave Battery | Reviving elites | Revive beam → EMP cuts it |
| 80 | Event Horizon | Spatial control; bends projectiles and drags drones | Inhale begins → Repulsor Pulse at its peak cancels the pull |
| 85 | The Architect | Barriers and corridors | Wall blueprint lines → Bombardment breaks the wall before it sets |
| 90 | The Choir | Linked shield generators | Harmony sync → designate generators in the sung order |
| 95 | Last Procession | A boss inside an elite gauntlet | Procession halts → Singularity Bomb collapses the escort |
| 100 | The Crown | Synthesis of the game's mechanics | Each phase reuses one earlier tell |

After Ascension V, Deep Waves bosses are grafted from two existing boss mechanics (§16).

## 14. Prestige layers

Prestige resets to wave 1, clears Scrap, upgrades, Cores, and Anomalies, and pays Echoes. Four layers open at deepest-ever waves 20, 40, 60, and 80. Echo costs rise about ×1.5 per rank within a node.

**Prestige I — Inheritance (wave 20).** Compress content the player has mastered.

| Node | Effect |
| --- | --- |
| Seed Capital | Start with Scrap |
| Memory of Steel / Memory of Motion | Start with damage / attack-speed ranks |
| Accelerated Clearing | Waves below the previous best run at ×2, then ×4, then ×8 |
| Boss Bounty | Bosses pay extra Scrap |
| Checkpoint Dividend | The first reach of each checkpoint in a Prestige pays a bonus |
| Scrap Resonance | +Scrap % per rank |
| Hardened Core | +max HP % per rank |

**Prestige II — Arsenal Memory (wave 40).** Plan builds instead of rebuilding them.

| Node | Effect |
| --- | --- |
| Frames | Unlocks Arsenal and Conductor |
| Blueprint Slots | Save and load full builds (§11) |
| Weapon Seed | First hardpoint slot opens at wave 1 |
| Elemental Memory | First attunement opens at wave 1 |
| Early Hardpoints | Later slot waves −5 per rank (floor: 15, 35, 55) |
| Third Attunement | +1 attunement cap, to 3 |
| Keepsake | Keep one Anomaly through Prestige |
| Anomaly Socket | +1 socket |
| Branch Discount | One chosen tree costs 25% less this Prestige |
| Autocast | Abilities fire when affordable |
| Trials | Unlocks Trials (§16) |

**Prestige III — Command Network (wave 60).** Program the machine.

| Node | Effect |
| --- | --- |
| Directives | Rule slots, Targeting Profiles, Upgrade Queue (§11) |
| Third Tactical Slot | +1 ability slot |
| Threat Dial | Unlocks the Threat Dial (§16) |
| Directive Tuning | Shorter reaction delay; higher Counter efficiency |
| Long Patrol | Offline cap 8 → 24 h; efficiency 40 → 70% |
| Speed Controls | Manual ×2 to ×8 on solved waves |

**Prestige IV — Evolution (wave 80).** Build strange engines.

| Node | Effect |
| --- | --- |
| Expanded Frame | +1 hardpoint cap on every Frame except Monolith (never above 4) |
| Dual Doctrine | One chosen tree runs a second Doctrine at 60% |
| Duplication | Primary shots occasionally duplicate |
| Double Launch | Every fifth missile launches twice |
| Conscription | Defeated elites become drones for 10 s |
| Overflow | Status effects can exceed their caps |
| Reversal | The blade periodically reverses direction |
| Ghost Edges | Laser nodes form temporary extra connections |
| Critical Relay | Crits reduce tactical cooldowns |
| Held Open | Weak points stay exposed longer |
| Relay Fire | Every tenth drone attack fires the primary |
| Autonomy | Auto-Prestige action and Adept conditions for Directives |
| Paradox Pool | More Paradox Anomalies in drafts |

## 15. Ascension and the Constellation

Beating The Crown at wave 100 opens Ascension: a reset above Prestige that pays Stars, raises base difficulty, and adds one rule layer for the player and one for enemies.

Ascension resets waves, Scrap, Cores, upgrades, and Anomalies. It keeps Echoes, Prestige upgrades, Codex entries, Trial rewards, unlocked Frames, and Stars.

| Ascension | Player rules | Enemy rules | Also unlocks |
| --- | --- | --- | --- |
| I — Echo | Projectile echoes, repeated explosions, abilities that partially recast | Echo modifier repeats charges, attacks, and spawns | Echo Engine frame; 5th Anomaly socket; Echo Anomaly pool |
| II — Synthesis | Triads; Fusion Apex nodes; drones inherit tower statuses | Groups share coordinated traits | Triad Codex entries |
| III — Geometry | Extra orbit paths, persistent zones, orbiting mines, distance- and angle-scaled weapons | Barriers, safe regions, teleport gates, hazard fields | Prism frame; 12 spatial formations |
| IV — Chronology | Slow fields, projectile acceleration, drone-fire replay, Overtime (faster game for more Scrap) | Acceleration, damage rewind, afterimages, early arrivals | Threat Dial levels 11–20 |
| V — Singularity | Singularity nodes | Elites with 3+ coordinated traits | Singularity Core frame; Deep Waves |

**Triads** need three attuned elements.

| Triad | Elements | Effect |
| --- | --- | --- |
| Catalyst | Fire + Lightning + Poison | Any elemental proc may trigger the other two |
| Polar Storm | Fire + Lightning + Frost | Thermal Shock bursts arc as lightning |
| Crucible | Fire + Poison + Frost | Thermal Shock bursts spread poison stacks |
| Cold Circuit | Lightning + Poison + Frost | Arcs between chilled, poisoned enemies never decay |

**Singularity nodes** each sit on a Constellation Bridge: projectiles inherit one random attuned element; laser intersections spawn missiles; missile explosions spawn temporary drones; enemies dying inside the polygon charge a central beam; max poison stacks trigger lightning; Fireballs split into frozen fragments; the barrier becomes a damaging field; the blade severs boss shield segments.

After V, Ascensions continue indefinitely, adding enemy HP, Star income, elite complexity, and Mythic Anomalies.

**The Constellation.** Stars buy nodes in a glowing graph. Major nodes are systems, Bridges between majors are cross-system rules, and minor nodes are numbers. Each Ascension reveals a new region. Respec is free at the moment of Ascending, so every Ascension is a chance to rethink the universe the tower operates in.

## 16. Long-tail systems

These give players goals at the wall and months of play without obligation mechanics.

**Trials** (Prestige II). A Trial is a separate run slot; the main run pauses and is preserved. Each Trial has three tiers: reach wave 30, 60, and 90 under its constraint. Echo upgrades apply.

| Trial | Constraint | Reward |
| --- | --- | --- |
| Bare Metal | No hardpoints | Monolith frame |
| Hive Mind | Primary disabled; Drones only | Hive frame |
| Siege Mentality | Primary disabled; Blade and Bastion only | Bulwark frame |
| Monochrome | One attunement; no Fusions | +1 stack cap for every element |
| Blackout | No abilities, designator, or manual aim | Autocast and Directive efficiency +10% |
| Commander | No automatic primary fire; abilities cost 50% less | A permanent second designator |
| Scatter | Every wave uses spread formations | Gravitics Exotic costs no Cores |
| Swarmstorm | Enemy count ×5, HP ×0.2 | Critical Mass threshold −30% |
| Poverty | Scrap income −75% | Strip Mine pays ×5 instead of ×4 |
| Pacifist Core | Only statuses, hazards, and Retaliation deal damage | Rot Anomaly pool |

**Chain Codex.** Every distinct interaction the simulation logs is an entry: each Fusion, Linkage, Infusion, Anomaly, and Counter firing, plus chains of 3, 5, 8, and 12 links. Each entry gives +0.25% damage and Scrap. Milestones unlock palettes, Anomalies, and Trials. Undiscovered entries show hints, such as "Something happens when lightning meets a frozen enemy inside the polygon."

**Kill-Chain Inspector.** Pause, rewind the last 15 s, tap any death, and read its cause chain as a sentence and a small diagram. The longest chain of each run is recorded. This is how the player traces the test sentence from §1.

**Threat Dial** (Prestige III). Levels 0–10, extended to 20 at Ascension IV, set at Prestige start. Each level adds enemy HP +12%, speed +3%, and more elite modifiers, and pays Echoes +10% and Scrap +5%. It can be lowered mid-run but not raised; lowering pays Echoes at the lowest level used.

**Deep Waves** (Ascension V). Waves past 100 continue forever with bosses grafted from two existing boss mechanics. Records are local.

## 17. Economy and starting curves

The game has four currencies and one combat meter. Every number below is a starting calibration for the simulator, not a final value.

| Currency | Earned by | Spent on | Survives |
| --- | --- | --- | --- |
| Scrap | Kills; ×3 on first clears; boss bounty | Chassis, element, hardpoint, Linkage, and Infusion ranks | Death |
| Cores | Boss first kill (1 each); rare elite drops | Exotics, Refits, Doctrine changes, rerolls | Death |
| Echoes | Prestige | Prestige layers | Prestige and Ascension |
| Stars | Ascension | Constellation | Everything |
| Command Energy (meter) | Kills, phase changes, close calls | Tactical abilities | Waves within one attempt |

Starting curves, where w is wave, r is rank, k is enemy type weight, D is deepest wave cleared this run, T is Threat Dial level, and A is Ascension count:

```latex
\begin{aligned}
\mathrm{EnemyHP}(w) &= 10 \cdot 1.13^{w} \cdot k \cdot 1.6^{A} \\
\mathrm{BossHP}(w) &= 12 \cdot \mathrm{EnemyHP}(w) \\
\mathrm{ScrapPerKill}(w) &= 1.11^{w} \cdot k \\
\mathrm{StatCost}(r) &= c_0 \cdot g^{r}, \quad g \in [1.15,\ 1.22] \\
\mathrm{Echoes} &= \lfloor 10 \cdot 1.2^{D-20} \cdot (1 + 0.1\,T) \rfloor \\
\mathrm{Stars} &= \lfloor 4 \cdot (1 + A) \cdot 1.1^{D-100} \rfloor
\end{aligned}
```

Mechanical unlocks use flat costs that rise ×8 per tier within a tree, so each one reads as a clear "one more attempt" goal.

Early pacing: about 30 purchases in the first 10 minutes, and a purchase every 20–40 s through wave 10.

## 18. Pacing targets

One full Prestige macro-cycle should take about six weeks, and Ascension should carry the game for months after that.

&#91;embedded content: pacing targets · 8 stages from first session to Deep Waves\]

Each stage is a simulator target (§19), not a promise; the checkpoint and Prestige tests are what hold the timeline in place.

## 19. Balance simulator and acceptance tests

The simulator is built alongside the game: the same deterministic combat code runs headless in Node thousands of times per build, and the acceptance tests below gate every balance change.

**Inputs per run:** a build, a wave definition, a seed, Targeting Profiles, and a player policy (idle, Directive, or active).

**Determinism:** fixed 60 Hz tick; seeded PRNG per Prestige and wave; lookup-table trig instead of Math.sin, since engines disagree in the last bits; no wall-clock reads; stable entity ordering. Every event carries a cause ID pointing to its parent event, which feeds the Inspector and the Codex.

**Agents:** Greedy DPS, Survival, Elemental, Generalist, Random Legal, one agent per hardpoint system, and an Optimizer that beam-searches purchase orders, Doctrines, and Anomaly picks to hunt overpowered combinations.

**Metrics:** everything from v1, plus damage share by system and Linkage, attempts and minutes per checkpoint, the Echo-rate curve, Counter success, and the Directive-to-human gap.

**Difficulty Multiplier:** measured per template, per archetype, per 10-wave band, as clear time and damage taken relative to the baseline radial ring at equal budget. The generator uses it as described in §12.

**Acceptance tests** (each asserts behavior)

| Test | Passes when |
| --- | --- |
| Checkpoint odds | The Generalist clears a new boss 15–30% on attempt 1, 40–60% on attempt 2, 70–90% on attempt 3 |
| Checkpoint time | New checkpoints take 8–20 min median in the first Prestige |
| First wall | Prestige is recommended between waves 22 and 28 on the first run |
| Reclimb | Each Prestige reaches the previous best in 25–40% of the previous run's time |
| Push | Prestiges 2–8 push 8–15 waves past the previous best |
| Forecast | The recommendation lands within 10% of the true Echo-rate peak |
| Build health | Every hardpoint agent reaches ≥ 85% of the best agent's depth at each Sector finale |
| Doctrine health | Every Doctrine's best build reaches ≥ 80% of its tree's best Doctrine |
| Spend efficiency | No system taking ≥ 20% of spend contributes < 10% of effectiveness |
| Defense | The Survival agent reaches ≥ 90% of the Greedy DPS agent's depth |
| Active edge | Active policy needs 15–30% fewer attempts than idle; idle clears every boss |
| Directive gap | Directive policy closes 40–70% of the idle-to-active gap |
| Formation fairness | No live template exceeds 1.5× the median multiplier for any archetype |
| Anomaly cap | No Anomaly raises Optimizer depth by > 15% (> 25% for Paradox) |
| Offline | Patrol never clears a boss; offline Scrap per hour stays ≤ 40% of online Patrol at base |
| Determinism | Same seed and build give identical event-log hashes in Node and every supported browser |

## 20. Presentation, readability, and browser tech

The battlefield stays on screen at all times, spectacle scales with progress, and enemies stay legible no matter how loud the build gets.

**Readability rules**

1. Draw order: arena → hazards → player effects → projectiles → enemies → enemy outlines → threat halos → UI.
2. Density governor: past the particle budget, player effects fade toward 40% opacity. Enemies never dim.
3. Threat halos pulse around kamikazes, healers, wardens, carriers, and exposed weak points.
4. A Clarity slider runs from Spectacle to Clarity.
5. Statuses show as icon shapes (flame, bolt, droplet, flake), never hue alone; each Sector has colorblind-safe palettes.

**Visual escalation.** Wave 1 looks lonely. Wave 20 shows visible complexity, 40 looks busy, 60 turns spectacular, 80 looks slightly ridiculous, and 100 looks like a geometry textbook turned into a weapons system.

**Interface.** Upgrades live in a bottom sheet on phones and a side panel on desktop, both over the battlefield. The Forecast is one tap away, and the Inspector overlays the paused field.

| Layer | Choice |
| --- | --- |
| Language | TypeScript |
| Simulation | Web Worker, fixed 60 Hz, struct-of-arrays typed arrays, spatial hash, object pools |
| Rendering | WebGL2 instanced draws; glow from additive blending and one bloom pass; never Canvas shadowBlur |
| Entity budgets | ≤ 1,500 enemies, ≤ 4,000 projectiles, ≤ 10,000 particles; past that, swarms merge into Clumps and HP scales instead of count |
| Hidden tabs | Browsers throttle hidden tabs, so after 60 s hidden the game switches to Patrol-rate estimation |
| Offline | Measured Patrol Scrap per second × elapsed time × efficiency, capped at 8 h (24 h with upgrades); no full simulation |
| Saves | IndexedDB autosave every 30 s and at checkpoints; export and import string; versioned migrations |
| Distribution | Installable PWA that runs offline |
| Speed | ×2 / ×4 / ×8 simulation for waves below the previous best |

Open question: which phone sets the performance floor for 60 fps at wave-100 density.

## Rejected ideas

These were considered for v2 and cut. Each is recorded so it isn't re-proposed without new reasons.

| Idea | Why it was rejected |
| --- | --- |
| Free hardpoint swapping between attempts | Recreates the generalist problem; Refits exist for real mistakes |
| 100% Scrap refund on Refit | Turns Frames and Hardpoints into non-commitments |
| All five hardpoints mounted at endgame | Removes the last build choice; the cap stays at four even at Singularity |
| Adaptive waves that read the player's build | Feels like the game cheats and breaks learnable waves |
| Rerolling wave content each attempt | Failures would feel like luck |
| Daily or weekly contracts, login streaks, limited-time events | Obligation mechanics; they violate "absence is never punished" |
| Unspent-Echo bonus (hold vs. spend) | A second Prestige optimization on top of the Forecast; revisit only if Prestige feels too solved |
| Forced Prestige or a hard wave cap | The soft wall and Forecast do the same job without taking control |
| Directives at full efficiency | Would erase active play in the late game |
| Per-element or per-system currencies | Violates "few enough currencies that players always know what each is for" |
| Online leaderboards | Needs servers and anti-cheat; local records and the Inspector cover the pride |
| "All systems interact freely" at Singularity | Untestable; replaced by bounded Singularity nodes on Constellation Bridges |
| Ascension resetting Prestige upgrades | Too punishing after 100 waves |
| Full offline simulation | Expensive and unnecessary; measured Patrol rate is accurate enough and can't clear bosses |
| A fifth base element | Gravitics already covers pull and control; four elements with six Fusions and four Triads is enough mileage |
