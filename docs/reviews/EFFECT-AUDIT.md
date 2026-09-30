# Effect fidelity audit: does every effect do what its text promises?

Scope: every player-facing effect a player can buy (Scrap, Cores, Echoes, Stars), draft or pick — tree nodes,
Doctrine capstones, Exotics, Fusions, Triads, Linkages, Infusions, ability rank nodes, Frames, Anomalies, Boons,
Trial constraints and rewards, Prestige nodes and Constellation nodes — checked against the simulation, plus the
Tell → Counter loop of all 21 bosses. Base commit `4d929c9` (master). UI reachability (whether a player can reach an
effect) is the parallel review's (`docs/reviews/REACHABILITY.md`); this audit asks whether the effect, once
reached, does what it says.

## Result in one paragraph

A mechanical scan found **17 dead entries** in the data tables: things a player could pay for or draft that no sim
code ever read. The worst were three Constellation bridges (10 Stars each, no code at all), Reactor **Targeting
Logic** (3 Scrap ranks), ranks 2–4 of **Long Patrol** (10,688 Echoes for nothing), **Cold Iron**, and the
**Hunter Mark** status bonus that its own ability, rank node and code comment promised. Reading every
description against its implementation, **34 of the 254 items** in the required groups were not what their text said
(4 number mismatches, 7 not implemented, 23 approximated) — a Frame "−25% primary damage" that was really −10% late in a run, a
"half rate" Hive primary that fired at 75%, Mirror Node's "−40% beam damage" that was nearly free, Kill Order and
Held Open weak-point extensions that granted no weak-point damage, Feedback Loop that never recast a utility
ability. A table-driven test of all 21 bosses found one **Counter bug**: a cast the abilities system rejected (not
slotted, on cooldown, Blackout, too little CE after discounts) still scored the Counter, because the boss system
scored the bare command. Everything found is fixed — faithful implementations where the code stayed small, honest
text where it did not — except the Codex milestone palettes, which are recorded but never rendered (cosmetic, no
in-game text promises them; Open, §9). After the fixes the dead scan is empty (`tests/audit/dead-nodes.test.ts` keeps it that way)
and every row of the claim table reads Verified. No acceptance row that passed before fails now.

| Check | Before | After |
| --- | --- | --- |
| Dead entries (`npm run audit:nodes`) | **17** (5 nodes / Anomalies, 12 effect keys) | **0** (7 documented display aliases) |
| Claim table, 254 items: Verified / Number mismatch / Not implemented / Approximated | 220 / 4 / 7 / 23 | 254 / 0 / 0 / 0 |
| Other nodes with wrong text or numbers (tree nodes outside the required groups) | 10 | 0 |
| Boss Counter table (25 tells incl. Crown per phase, Deep Graft per source) | right action scores 25/25; wrong action 0/25; **rejected cast scored 21/21** | 25/25; 0/25; **0/21** |
| New tests | — | `tests/audit/dead-nodes`, `effects`, `boss-counters` (53 tests); `npx vitest run` 997 / 997 |

## Method

1. **Dead-node scan** (`scripts/audit-dead-nodes.mjs`, `npm run audit:nodes`, test `tests/audit/dead-nodes.test.ts`).
   For every node id (trees, Doctrines, Exotics, Fusions, Triads, Linkages, Infusions, ability rank nodes, Prestige,
   Constellation), every `effects[].stat` key (nodes, Frames, Anomalies, Boons and the Trial `metaEffects`), every
   Anomaly id, Boon flag, Frame flag and Trial rule / reward, it looks for a reader in `src/sim` outside
   `src/sim/data`: string literals (`stats.get('..')`, `.has`, `.rank`, `hasAnomaly`, `frameFlag`, `trialHas`,
   `trialActive`, `w.trial === ..`, `trials.<id>`) and template-literal keys (`ability.${id}.cost_mul`,
   `infuse.${s}.${e}`, `link.${a}+${b}`). Comments do not count; generic index / price / record / render files
   (content, ids, codex, bulk, forecast, serialize, snapshot*) do not count; `fx('key', ..)` in sim code is a write,
   not a read; `core/stats.ts`'s `CORE_DEFAULTS` table is a base, not a read. `key@final` counts as read when `key`
   is. A key that only a node's own id names, while the same node writes a consumed canonical key, is an alias. The
   test fails on any dead entry outside `ALLOWLIST` (empty) and on a stale allowlist entry.
2. **Claim table.** Every description in the required groups was read against its implementing code; where no
   existing test pins the claim's specifics, a scenario in `tests/audit/effects.test.ts` builds the situation and
   asserts the outcome (a stat value, damage, an event with its `src`, a stack count, a timer). Existing coverage is
   named per row (file names under `tests/`).
3. **Boss table** (`tests/audit/boss-counters.test.ts`): per boss and tell, three identical Sims — the mapped Counter
   (from `counterHint`) must emit exactly one `Ev.CounterScored` with the Counter as `src`; another ability aimed at the
   tell (and, for designate tells, designating a wrong enemy) must emit none; the right ability rejected by the
   abilities system (not slotted, then slotted but on cooldown) must emit none.
4. **Numbers in text.** Where text and code disagreed, `docs/design-v2.md` decided when it states a number
   (Multishot "2 → 5 projectiles", Arsenal "primary damage −25%", Hive "primary fires at half rate", Long Patrol
   "8 → 24 h; 40 → 70%", Stormglass "double range", Heavy Water "25% slower and 50% harder"); otherwise the code won
   and the text was corrected.

## 1. Dead-node scan

Before (base commit), 17 entries with no reader:

| kind | id | written by | fix |
| --- | --- | --- | --- |
| tree node + key | `reactor.targeting_logic` | Targeting Logic (Reactor, 3 ranks, 150/450/1,350 Scrap) | implemented (§4) |
| star node + key | `star.bridge.primary+laser` | Focal Reactor (10 Stars) | implemented in `systems/constellation.ts` |
| star node + key | `star.bridge.ordnance+drones` | Deployment Charge (10 Stars) | implemented |
| star node + key | `star.bridge.ordnance+laser` | Prism Battery (10 Stars) | implemented |
| Anomaly + key | `cold_iron` / `frost.chill_armor_shred` | Cold Iron | implemented (elements damageMul) |
| effect key | `ability.hunter_mark.status_bonus` | Hunter Mark base +50% and its rank node +25%/rank | implemented (`World.applyStatus`) |
| effect keys | `offline.cap_hours`, `offline.efficiency` | Long Patrol ranks | read by `offline_return` |
| effect key | `poison.tick_interval` | Heavy Water | read by the statuses system |
| effect key | `economy.boss_cores` | Tithe (behaviour was hard-coded by anomaly id) | read by `finishKill` |
| effect key | `bastion.kill_heal` | Hungry Core (hard-coded 1%) | read by `finishKill` |
| effect key | `directives.autocast_efficiency` | Blackout Trial reward | removed; reward text states what is real |

After: none. The seven display-only aliases the data notes describe are exactly the ones found, each feeding a
consumed key: `bastion.fortress.hp` → `bastion.max_hp`, `bastion.fortress.armor` → `bastion.armor`,
`reactor.overclock.speed` → `reactor.global_attack_speed`, `reactor.overclock.cooldowns` →
`reactor.cooldown_reduction`, `reactor.salvage.reclamation` → `economy.scrap_mul`, `reactor.salvage.boss_scavenging`
→ `economy.boss_scrap_mul`, `reactor.command.ce_cap` → `economy.ce_cap`.

The build reports' hint that **`economy.echo_mul` "has a base value but nothing uses it"** is inverted:
`prestigeEchoes` reads it, but no node, Anomaly or reward writes it, and no text promises an Echo multiplier (the
Threat Dial's +10% Echoes lives in `echoesFor`). Not a dead purchase; left as a tunable.

Informational (not failing): 15 base-stats constants that no code reads because the code hard-codes the same
number — `ballistics.execution.threshold` (0.3), `ballistics.multishot.spread`, `ballistics.piercing.last_rites.mult`
(4), `ballistics.ricochet.retention` (0.8), `ballistics.heavy.staggerhead.seconds` / `.boss_lockout` (0.6 / 4),
`ballistics.gunstorm.every` / `.rounds` (8 / 6), `bastion.shield_delay` (3), `bastion.resistance_cap` (0.9),
`bastion.second_core.invuln` (3), `anomaly.spare_barrel.strength` (0.5), `frost.absolute_zero.slow` (0.5),
`gravitics.collapse.base_damage`, `prestige.dual_doctrine.strength` (0.6). Every one matches its text today; retuning
the data value would silently do nothing (listed under Open).

## 2. Claim vs behavior

Status legend: **Verified** — the behaviour matches the concrete claim (numbers, timings, targets, conditions);
**Number mismatch** — implemented with different numbers; **Not implemented** — no effect; **Approximated** — a
different mechanism or a partial one. "before → after" appears where this audit changed it. The claim column quotes
the text as it reads now (§6 lists every text change with its old wording). Evidence names the test files that
assert the claim (`tests/…`), or the fix and its test.

Counts over the 254 items (Anomalies 25, Boons 36, Frames 9, Trial constraints 10 + rewards 10, Prestige 38,
Constellation 13, Exotics 12, Linkages 25, Infusions 20, Fusions 6 + Triads 4, abilities 10, capstones 36):

| | Verified | Number mismatch | Not implemented | Approximated | total |
| --- | --- | --- | --- | --- | --- |
| before | 220 | 4 | 7 | 23 | 254 |
| after | 254 | 0 | 0 | 0 | 254 |

### Anomalies (25)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `spare_barrel` | Spare Barrel | Choose a second Barrel Doctrine; it runs at 50% strength alongside your first. | Approximated → **Verified** | A 50% second Multishot got 1 + ranks×0.25 barrels: the resolver already halves doctrine ranks and ballistics.ts halved them again | fix ballistics.ts:72 (no second scaling); audit/effects "Extra Barrels … half" |
| `borrowed_blade` | Borrowed Blade | A tier-1 Orbital Blade spins without a hardpoint slot. Its base nodes can be bought; its Doctrines cannot. | Verified | effect verified (mounted without a slot, tier 1 only); upgrade reachability is the UI agent's | progression/anomalies "Borrowed Blade" |
| `recursive_warhead` | Recursive Warhead | Missiles split into Cluster Warheads without buying the Exotic. | Verified | tests: progression/anomalies | — |
| `loaded_dice` | Loaded Dice | Every crit chance roll, from any system, is rolled twice and keeps the better result. | Verified | tests: core/determinism-extended, core/robustness, progression/anomalies | — |
| `seventh_shot` | Seventh Shot | Every 7th primary shot is a Fireball (60-unit blast, 2 Burn stacks), even without Fire attuned. | Verified | tests: core/determinism-extended, core/robustness, progression/anomalies | — |
| `mirror_node` | Mirror Node | Laser nodes mirror across the tower: twice the nodes and beams, but beams deal 40% less damage. | Number mismatch → **Verified** | −40% was additive with Beam Intensity (+15%/rank): at 20 ranks beams lost ~10%, not 40% | `laser.damage@final` (anomalies.ts:44, stats.ts:100); audit/effects "Arsenal … Mirror Node" |
| `pinball` | Pinball | Ricochets and bouncing shots rebound off the arena edge instead of expiring, keeping their bounces. | Verified | tests: progression/anomalies, progression/prestige | — |
| `stormglass` | Stormglass | Frozen and max-Chill enemies conduct lightning: arcs from or to them reach double range. | Approximated → **Verified** | fired one extra 50% arc from the struck enemy instead of extending the arc itself | arc links from/to a frozen or max-Chill enemy reach 2× range (elements-shared.ts:86, :182); old side-arc removed; progression/anomalies "Stormglass" |
| `clockwork_blade` | Clockwork Blade | The blade reverses direction every 6 s, releasing a 120-unit shockwave that knocks enemies back. | Approximated → **Verified** | shockwave hit everything within blade length + 120 of the TOWER and pushed it away from the tower | a 120-unit shockwave at each blade tip, pushing away from the tip (anomalies.ts:342); progression/anomalies "Clockwork Blade" |
| `ghost_protocol` | Ghost Protocol | Enemies killed by drones rise as ghosts that fight for the tower for 3 s. | Verified | tests: progression/anomalies | — |
| `rogue_moon` | Rogue Moon | A small mass orbits the tower at long range (380 units), dealing contact damage and pulling nearby enemies weakly toward itself. | Verified | tests: progression/anomalies, progression/prestige | — |
| `cold_iron` | Cold Iron | Each Chill stack also removes 1% of the enemy's armor. | Not implemented → **Verified** | frost.chill_armor_shred had no reader | Chill stacks strip armor in the elements damageMul, combined with Corrosion (elements.ts:531); audit/effects "Cold Iron" |
| `heavy_water` | Heavy Water | Poison ticks 25% slower but each tick hits 50% harder (+20% Poison damage per second). | Approximated → **Verified** | poison.tick_interval had no reader (ticks never slowed) and +50% was additive with Neurotoxin | poison pulses every 15 × interval ticks (statuses.ts:32, :87); damage `poison.damage@final` ×1.2 so each slower tick is ~×1.5; text states the net +20%/s; audit/effects "Heavy Water" |
| `overcharged_capacitor` | Overcharged Capacitor | Command Energy cap +50%. | Verified | +50% was additive with Feedback Loop's −40% when both were socketed (+10% instead of ×0.9) | `economy.ce_cap@final` (anomalies.ts:85) |
| `second_opinion` | Second Opinion | You get two Target Designators; both targets are preferred by every weapon. | Verified | tests: active/ce-designator, progression/anomalies | — |
| `glass_cannon` | Glass Cannon | +50% damage from every source, but −50% max HP. | Approximated → **Verified** | +50% damage was additive with other combat.power_mul sources (Salvage −15%, Star Firepower) | `combat.power_mul@final` (anomalies.ts:96) |
| `unstable_isotope` | Unstable Isotope | Explosions are 50% larger, but 5% of them also detonate on the tower for 10% of their damage (at most 2% of max HP each). | Approximated → **Verified** | the +50% radius reached element/Fusion/boon blasts but not missiles, shells, drone bombs or ability blasts — not the Ordnance it needs; the 2% max-HP cap on self-hits was undisclosed | blast_radius_mul applied in ordnance.ts:75, hardpoints/common.ts:200, drones.ts:113, abilities.ts:254/417/447; text states the cap; audit/effects "Unstable Isotope" |
| `tithe` | Tithe | Bosses drop 2 Cores on their first kill, but the tower no longer heals between waves. | Verified | behaviour hard-coded by anomaly id; its economy.boss_cores key was never read | world-impl reads economy.boss_cores (world-impl.ts:312); audit/effects "Tithe … Hungry Core" |
| `hungry_core` | Hungry Core | Every kill heals 1% of max HP, but all other regeneration and healing stops. | Verified | kill heal hard-coded 1%; bastion.kill_heal never read | world-impl reads bastion.kill_heal (world-impl.ts:306); audit/effects "Tithe … Hungry Core" |
| `afterimage_round` | Afterimage Round | NEW. Every primary shot leaves an echo that fires again from the tower 0.4 s later at 30% damage. | Verified | tests: progression/anomalies | — |
| `echo_chamber` | Echo Chamber | NEW. Explosions repeat once 0.5 s later at 40% damage and 70% radius. | Verified | tests: progression/anomalies | — |
| `feedback_loop` | Feedback Loop | NEW. Every tactical ability recasts itself 1 s later at 50% power, but Command Energy cap is 40% lower. | Approximated → **Verified** | only enemies a cast damaged took 50% again; Repulsor, Time Field, EMP, Overdrive, Repair, Hunter Mark never recast | every cast that goes off recasts itself 1 s later at 50% power, free, no Ev.Cast/Counter (abilities.ts:223, :307); old anomalies.ts copy removed; progression/anomalies "Feedback Loop" |
| `rot_bloom` | Rot Bloom | NEW. Poisoned enemies that die leave a toxic cloud for 3 s that applies 1 Poison stack per second. | Verified | tests: progression/anomalies | — |
| `smolder` | Smolder | NEW. Burn and Poison last 40% longer. | Verified | tests: progression/anomalies | — |
| `martyr_plating` | Martyr Plating | NEW. The tower retaliates for 20% of damage taken even without Thorns, and all Retaliation deals ×3 damage, but the tower has no armor. | Verified | tests: progression/anomalies | — |

### Boons (36)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `overcharge` | Overcharge | +25% primary damage (adds to the Caliber bonus, like about three ranks). | Verified | tests: core/boons, ui/boons | — |
| `hair_trigger` | Hair Trigger | +20% primary attack speed. | Verified | tests: core/boons | — |
| `long_sight` | Long Sight | +25% primary range. | Verified | tests: core/boons | — |
| `thick_plating` | Thick Plating | +20% max HP. | Verified | tests: core/boons | — |
| `ablative_shell` | Ablative Shell | A shield worth 12% of max HP. It refills between waves and recharges after 3 s without damage. | Verified | tests: core/boons | — |
| `second_wind` | Second Wind | Heal 6% more of max HP between waves (25% becomes 31%). | Verified | tests: core/boons | — |
| `scrap_magnet` | Scrap Magnet | +15% Scrap from every source. | Verified | tests: core/boons | — |
| `quick_hands` | Quick Hands | Tactical abilities cost 25% less Command Energy. | Verified | tests: core/boons | — |
| `deep_reserves` | Deep Reserves | +50 Command Energy cap. | Verified | tests: core/boons | — |
| `lucky_streak` | Lucky Streak | +10% primary crit chance (5% base). | Verified | tests: core/boons | — |
| `heavy_hits` | Heavy Hits | Primary crit multiplier +0.2 (×1.5 becomes ×1.7). | Verified | tests: core/boons | — |
| `iron_skin` | Iron Skin | +10 armor: every hit is cut by armor ÷ (100 + armor) (9.1% with no other armor). | Verified | tests: core/boons | — |
| `encore` | Encore | Your first Fusion reaction each wave fires again 0.5 s later as a 80-unit blast of the same damage (at least 3× primary damage). | Verified | tests: core/boons, ui/boons | — |
| `forked_arc` | Forked Arc | Primary crits arc to one more enemy within 120 units for 50% of the hit. | Verified | tests: core/boons | — |
| `ricochet_rounds` | Ricochet Rounds | A primary shot that kills flies on to the nearest enemy within 100 units for 50% of its damage. | Verified | tests: core/boons | — |
| `volatile_kills` | Volatile Kills | Enemies explode when they die: 15% of their max HP in a 60-unit blast. | Verified | tests: core/boons | — |
| `static_field` | Static Field | Lightning hits leave a 40-unit field for 2 s that deals 25% of the hit per second (one every 0.5 s). | Verified | tests: core/boons, ui/boons | — |
| `frostbite` | Frostbite | Every Chill you apply adds 1 extra stack. | Verified | tests: core/boons | — |
| `wildfire_seed` | Wildfire Seed | Burning enemies that die pass 1 Burn stack (3 s) to one enemy within 80 units. | Verified | tests: core/boons | — |
| `toxic_bloom` | Toxic Bloom | Poisoned enemies that die leave a 50-unit cloud for 3 s that deals 8% of their max HP per second. | Verified | tests: core/boons | — |
| `rally_drones` | Rally Drones | After any kill, drones fire 40% faster for 2 s. | Verified | tests: core/boons, ui/boons | — |
| `sharpened_edge` | Sharpened Edge | The Orbital Blade deals 30% more damage to elites and bosses. | Verified | tests: core/boons | — |
| `focus_beam` | Focus Beam | Laser damage on an enemy grows 10% per second of contact, up to +50%. | Verified | tests: core/boons | — |
| `anchor_well` | Anchor Well | The first gravity well each wave lasts 2× as long. | Approximated → **Verified** | two wells opening in the same tick both read the ×2 signal | gravitics consumes wellLifeMul when a well opens (gravitics.ts:159); audit/effects "Anchor Well" |
| `glass_hour` | Glass Hour | +15% damage from every source; healing between waves is cut by 50%. | Verified | tests: core/boons | — |
| `berserk` | Berserk | +40% attack speed for the primary, missiles and drones; −25% max HP. | Approximated → **Verified** | "attack speed for every weapon" — reactor.global_attack_speed only reaches the primary, missiles and drones | text: "for the primary, missiles and drones" (boons.ts:166) |
| `miser` | Miser | +60% Scrap from every source; −15% damage. | Verified | tests: core/boons, ui/boons | — |
| `reckless` | Reckless | Tactical abilities cost 40% less Command Energy but take 30% longer to cool down. | Verified | tests: core/boons | — |
| `bulwark` | Bulwark | +50% max HP; −15% attack speed for the primary, missiles and drones. | Approximated → **Verified** | same as Berserk | text (boons.ts:178) |
| `slow_and_sure` | Slow and Sure | +15% damage from every source; −15% attack speed for the primary, missiles and drones. | Approximated → **Verified** | same as Berserk | text (boons.ts:182) |
| `overclocked` | Overclocked | Hardpoint and ability cooldowns −15%; the tower takes 20% more damage. | Verified | tests: core/boons | — |
| `hunters_gambit` | Hunter's Gambit | +40% damage to bosses; −20% damage to every other enemy. | Verified | tests: core/boons, ui/boons | — |
| `stopwatch` | Stopwatch | Enemies move 10% slower. It stacks with Chill; a stronger field slow (Time Field) replaces it. | Verified | tests: core/boons, ui/boons | — |
| `second_chance` | Second Chance | Once per attempt: a blow that would destroy the tower leaves it at 1 HP with 3 s of invulnerability. Then it is used up and frees its slot. | Verified | tests: core/boons | — |
| `windfall` | Windfall | The next boss you kill drops 1 extra Core. Then it is used up and frees its slot. | Verified | tests: core/boons, ui/boons | — |
| `trophy_hunter` | Trophy Hunter | Every elite or boss you kill adds +0.5% damage for the rest of the attempt, up to +5%. | Verified | tests: core/boons | — |

### Frames (9 traits)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `standard` | Standard | No modifiers; the baseline. | Verified | tests: active/directives, core/boons, core/robustness | — |
| `arsenal` | Arsenal | Hardpoint trees cost 15% less; primary damage −25%. | Number mismatch → **Verified** | "primary damage −25%" was additive with Caliber (+8%/rank): at 20 ranks −9.6% | `ballistics.damage@final` (frames.ts:37); audit/effects "Arsenal …" |
| `conductor` | Conductor | Statuses apply +1 stack; Fusions start at rank 1. | Verified | tests: systems/fusions | — |
| `monolith` | Monolith | The primary runs two Barrel Doctrines at full strength. | Verified | tests: core/stats, progression/trials-ascension | — |
| `hive` | Hive | Drones mounted free; drone cap +50%; the primary fires at half rate. | Number mismatch → **Verified** | "primary fires at half rate" was additive with Autoloader: at 20 ranks −25%, not −50% | `ballistics.attack_speed@final` (frames.ts:55); audit/effects |
| `bulwark` | Bulwark | Bastion runs two Doctrines; Retaliation scales with armor. | Verified | tests: core/boons, systems/bastion | — |
| `echo_engine` | Echo Engine | Every 8th shot of the primary, the missile rack and each drone repeats. | Approximated → **Verified** | "every 8th attack of each system" — only the primary, missile salvos and drone shots repeat (blade, beams, wells attack continuously) | trait text (frames.ts:66) |
| `prism` | Prism | Laser Polygon mounted free; beams carry every attuned element. | Verified | tests: core/extra-systems, data/content, systems/infusions | — |
| `singularity_core` | Singularity Core | Dual Doctrine in every tree; enemies +50% HP. | Verified | tests: render/composite | — |

### Trials (10 constraints + 10 rewards)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `trial:bare_metal:constraint` | Bare Metal (constraint) | No hardpoints. | Verified | tests: progression/trials-ascension | — |
| `trial:bare_metal:reward` | Bare Metal (reward) | Monolith frame | Verified | tests: progression/trials-ascension | — |
| `trial:hive_mind:constraint` | Hive Mind (constraint) | Primary disabled; Drones is the only hardpoint. | Verified | tests: progression/trials-ascension | — |
| `trial:hive_mind:reward` | Hive Mind (reward) | Hive frame | Verified | tests: progression/trials-ascension | — |
| `trial:siege_mentality:constraint` | Siege Mentality (constraint) | Primary disabled; only the Orbital Blade and Bastion. | Verified | tests: code | — |
| `trial:siege_mentality:reward` | Siege Mentality (reward) | Bulwark frame | Verified | tests: code | — |
| `trial:monochrome:constraint` | Monochrome (constraint) | One attunement; no Fusions. | Verified | tests: progression/trials-ascension | — |
| `trial:monochrome:reward` | Monochrome (reward) | +1 stack cap for every element | Verified | tests: progression/trials-ascension | — |
| `trial:blackout:constraint` | Blackout (constraint) | No abilities, designator, or manual aim. | Verified | tests: active/abilities | — |
| `trial:blackout:reward` | Blackout (reward) | Directive and Autocast Counter efficiency +10% | Approximated → **Verified** | directives.autocast_efficiency was never read (Autocast Counters already score at counter_efficiency) | dead key removed; text "Directive and Autocast Counter efficiency +10%" (trials.ts:16, economy/prestige.ts) |
| `trial:commander:constraint` | Commander (constraint) | No automatic primary fire; abilities cost 50% less. | Verified | tests: active/abilities | — |
| `trial:commander:reward` | Commander (reward) | A permanent second designator | Verified | tests: active/abilities | — |
| `trial:scatter:constraint` | Scatter (constraint) | Every wave uses spread formations. | Verified | tests: code | — |
| `trial:scatter:reward` | Scatter (reward) | Gravitics Exotic costs no Cores | Verified | tests: code | — |
| `trial:swarmstorm:constraint` | Swarmstorm (constraint) | Enemy count ×5, enemy HP ×0.2. | Verified | tests: progression/trials-ascension | — |
| `trial:swarmstorm:reward` | Swarmstorm (reward) | Critical Mass threshold −30% | Verified | tests: progression/trials-ascension | — |
| `trial:poverty:constraint` | Poverty (constraint) | Scrap income −75%. | Verified | tests: core/boons, progression/trials-ascension | — |
| `trial:poverty:reward` | Poverty (reward) | Strip Mine pays ×5 instead of ×4 | Verified | tests: core/boons, progression/trials-ascension | — |
| `trial:pacifist_core:constraint` | Pacifist Core (constraint) | Only statuses, hazards, and Retaliation deal damage. | Approximated → **Verified** | World.damage with trueDamage skipped the damageMul hook that enforces it (no caller today; latent) | enforced in the trueDamage branch too (world-impl.ts:248); audit/effects "Pacifist Core" |
| `trial:pacifist_core:reward` | Pacifist Core (reward) | Rot Anomaly pool | Verified | tests: progression/trials-ascension | — |

### Prestige nodes (38)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `prestige.seed_capital` | Seed Capital | Start each Prestige with 150 Scrap per rank. | Verified | tests: progression/prestige, progression/trials-ascension, ui/format | — |
| `prestige.memory_of_steel` | Memory of Steel | Start each Prestige with 2 free ranks of Caliber (primary damage) per rank. | Verified | tests: progression/prestige | — |
| `prestige.memory_of_motion` | Memory of Motion | Start each Prestige with 2 free ranks of Autoloader (primary attack speed) per rank. | Verified | tests: progression/prestige | — |
| `prestige.accelerated_clearing` | Accelerated Clearing | Waves below your previous best run at ×2 speed; ×4 at rank 2, ×8 at rank 3. | Verified | tests: core/integration, progression/prestige | — |
| `prestige.boss_bounty` | Boss Bounty | Bosses pay +25% Scrap per rank. | Verified | tests: progression/prestige | — |
| `prestige.checkpoint_dividend` | Checkpoint Dividend | The first reach of each checkpoint in a Prestige pays a bonus of 25% per rank of that boss wave's kill Scrap. | Verified | tests: progression/prestige | — |
| `prestige.scrap_resonance` | Scrap Resonance | +5% Scrap from every source per rank. | Verified | tests: progression/prestige | — |
| `prestige.hardened_core` | Hardened Core | +5% max HP per rank. | Verified | tests: progression/prestige | — |
| `prestige.frames` | Frames | Unlocks the Arsenal and Conductor frames. | Verified | tests: progression/prestige | — |
| `prestige.blueprint_slots` | Blueprint Slots | Save and load full builds: Frame, Hardpoints, Attunements, Doctrines, Targeting Profiles and Upgrade Queue. +1 slot per rank. | Verified | tests: progression/prestige | — |
| `prestige.weapon_seed` | Weapon Seed | Your first hardpoint slot opens at wave 1. | Verified | tests: progression/prestige | — |
| `prestige.elemental_memory` | Elemental Memory | Your first attunement opens at wave 1. | Verified | tests: core/integration, progression/prestige | — |
| `prestige.early_hardpoints` | Early Hardpoints | Later hardpoint slots open 5 waves earlier per rank (floor: waves 15, 35, 55). | Verified | tests: core/integration | — |
| `prestige.third_attunement` | Third Attunement | +1 attunement cap, to 3. | Verified | tests: progression/prestige | — |
| `prestige.keepsake` | Keepsake | Keep one socketed Anomaly through Prestige. | Verified | tests: progression/prestige | — |
| `prestige.anomaly_socket` | Anomaly Socket | +1 Anomaly socket. | Verified | tests: progression/prestige | — |
| `prestige.branch_discount` | Branch Discount | At Prestige start, choose one tree: it costs 25% less this Prestige. | Verified | tests: progression/prestige | — |
| `prestige.autocast` | Autocast | Each tactical ability can be set to fire whenever it is affordable. | Verified | tests: active/determinism, active/directives | — |
| `prestige.trials` | Trials | Unlocks Trials: separate run slots with constraints and permanent rewards. | Verified | tests: core/boons, progression/trials-ascension | — |
| `prestige.directives` | Directives | Unlocks Directives with 3 rule slots, Targeting Profiles and the Upgrade Queue. Each further rank adds 1 rule slot (up to 12). | Verified | tests: active/determinism, active/directives, active/upgrade-queue | — |
| `prestige.third_tactical_slot` | Third Tactical Slot | +1 tactical ability slot. | Verified | tests: active/abilities, active/determinism | — |
| `prestige.threat_dial` | Threat Dial | Unlocks the Threat Dial: each level adds enemy HP +12% and speed +3% and pays Echoes +10% and Scrap +5%. | Verified | tests: progression/prestige | — |
| `prestige.directive_tuning` | Directive Tuning | Directive reaction delay −0.06 s per rank (0.6 → 0.3 s) and Counter efficiency +5% per rank (50% → 75%). | Verified | tests: active/directives | — |
| `prestige.long_patrol` | Long Patrol | Offline cap +4 h per rank (8 → 24 h) and offline efficiency +7.5% per rank (40% → 70%). | Number mismatch → **Verified** | any rank gave the full 24 h / 70%: ranks 2–4 (2,250 + 3,375 + 5,063 Echoes) bought nothing; offline.cap_hours / offline.efficiency unread | offline_return uses the resolved keys: +4 h and +7.5 pts per rank (commands.ts:134, curves.ts:90); audit/effects "Long Patrol" |
| `prestige.speed_controls` | Speed Controls | Manual speed on solved waves: ×2 at rank 1, ×4 at rank 2, ×8 at rank 3. | Verified | tests: core/integration | — |
| `prestige.expanded_frame` | Expanded Frame | +1 hardpoint cap on every Frame except Monolith (never above 4). | Verified | tests: progression/prestige | — |
| `prestige.dual_doctrine` | Dual Doctrine | One tree may run a second Doctrine at 60% strength: the first tree you give one claims it (clearing that second Doctrine frees the choice). | Approximated → **Verified** | no choice happens at Prestige start: the first tree that takes a second Doctrine claims it (StatResolver.secondDoctrineAllowed); reported by the reachability review | text: "the first tree you give one claims it (clearing that second Doctrine frees the choice)" (prestige.ts:69) |
| `prestige.duplication` | Duplication | Primary shots have a 2% chance per rank to duplicate. | Verified | tests: progression/anomalies | — |
| `prestige.double_launch` | Double Launch | Every fifth missile launches twice. | Verified | tests: progression/prestige | — |
| `prestige.conscription` | Conscription | Defeated elites fight for the tower as drones for 10 s. | Verified | tests: progression/prestige | — |
| `prestige.overflow` | Overflow | Status effects can exceed their stack caps by 20% per rank. | Verified | tests: core/world | — |
| `prestige.reversal` | Reversal | The blade reverses direction every 8 s. | Verified | tests: progression/prestige | — |
| `prestige.ghost_edges` | Ghost Edges | Every 5 s, laser nodes form 1 temporary extra connection per rank for 2 s. | Verified | tests: progression/prestige | — |
| `prestige.critical_relay` | Critical Relay | Each crit cuts tactical ability cooldowns by 0.02 s per rank. | Verified | tests: progression/prestige | — |
| `prestige.held_open` | Held Open | Boss weak points stay exposed 0.5 s longer per rank. | Not implemented → **Verified** | kept the WeakPointOpen flag set after the script closed it, but the ×1.5 / ×2 weak-point damage read the controller's own timer: no extra damage | the damage modifier and marker honour the flag (enemies/bosses.ts:191); audit/effects "Held Open" |
| `prestige.relay_fire` | Relay Fire | Every tenth drone attack also fires the primary at that drone's target. | Verified | tests: progression/prestige | — |
| `prestige.autonomy` | Autonomy | Unlocks the Auto-Prestige Directive action and Adept conditions that read boss tells. | Verified | tests: active/directives | — |
| `prestige.paradox_pool` | Paradox Pool | Paradox Anomalies appear 50% more often per rank in drafts. | Verified | tests: progression/prestige | — |

### Constellation nodes (13)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `star.major.primary` | The Gunner | +10% primary damage and +2% crit chance per rank. | Verified | tests: progression/trials-ascension | — |
| `star.major.ordnance` | The Rack | +10% missile damage and +5% blast radius per rank. | Verified | tests: progression/trials-ascension | — |
| `star.major.drones` | The Swarm | +10% drone damage and +5% drone attack speed per rank. | Verified | tests: progression/trials-ascension | — |
| `star.major.blade` | The Scythe | +10% blade damage and +5 blade length per rank. | Verified | tests: progression/trials-ascension | — |
| `star.major.laser` | The Polygon | +10% beam damage and +0.5 beam width per rank. | Verified | tests: progression/trials-ascension | — |
| `star.major.gravitics` | The Well | +10% pull strength and +5 well radius per rank. | Verified | tests: progression/trials-ascension | — |
| `star.bridge.primary+laser` | Focal Reactor | Enemies dying inside the polygon charge a central beam; at 20 charges the primary fires it through its target for 10× primary damage. | Not implemented → **Verified** | no code read it (10 Stars for nothing) | systems/constellation.ts (Focal Reactor); audit/effects "Focal Reactor" |
| `star.bridge.ordnance+drones` | Deployment Charge | Missile explosions spawn a temporary drone for 4 s (up to 6 at once). | Not implemented → **Verified** | no code read it | systems/constellation.ts (Deployment Charge); audit/effects "Deployment Charge" |
| `star.bridge.ordnance+laser` | Prism Battery | Laser intersections spawn missiles: where two beams cross, a missile launches at the nearest enemy every 1.5 s. | Not implemented → **Verified** | no code read it | systems/constellation.ts (Prism Battery); audit/effects "Prism Battery" |
| `star.minor.firepower` | Firepower | +2% damage from every source per rank. | Verified | tests: progression/trials-ascension | — |
| `star.minor.salvage` | Starlit Salvage | +3% Scrap from every source per rank. | Verified | tests: progression/trials-ascension | — |
| `star.minor.hull` | Star-Forged Hull | +3% max HP per rank. | Verified | tests: progression/trials-ascension | — |
| `star.minor.command` | Wide Command | +5 Command Energy cap per rank. | Verified | tests: progression/trials-ascension | — |

### Exotics (12)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `ballistics.gunstorm` | Gunstorm | Every 8th primary attack fires a 6-round burst from every barrel at once; each round rolls its own crit. | Verified | tests: data/content | — |
| `bastion.second_core` | Second Core | Once per wave, damage that would destroy the tower leaves it at 1 HP with 3 s of invulnerability. | Verified | tests: core/world, data/content, systems/bastion | — |
| `reactor.critical_mass` | Critical Mass | While more than 25 enemies are alive, every weapon system gains +2% speed per enemy above 25, up to +40%. | Verified | tests: data/content, systems/linkages, systems/reactor | — |
| `fire.meteor_round` | Meteor Round | Every 5th Fireball, from any source (Inferno or Seventh Shot), becomes a Meteor Round that leaves an 80-unit burning zone for 4 s. | Approximated → **Verified** | "from any source" — only Inferno's Fireballs counted; with Wildfire it did nothing even with Seventh Shot | Seventh Shot Fireballs count (elements.ts:422); text names the sources; audit/effects "Meteor Round" |
| `lightning.supercell` | Supercell | When 40 arcs fire within 2 s, a storm rings the tower for 6 s, striking a random enemy within 250 units every 0.2 s. | Verified | tests: data/content, systems/elements | — |
| `poison.pandemic` | Pandemic | Every 2 s, each poisoned elite or boss seeds half its stacks into the 2 nearest enemies. | Verified | tests: data/content, systems/elements | — |
| `frost.absolute_zero` | Absolute Zero | Enemies at max Chill also attack 50% slower, and their ability cooldowns run 50% slower. | Approximated → **Verified** | attack timers slowed; boss ability cooldowns (tell timer, attack cadence) did not | controller runs a max-Chill boss's clocks at ×0.5 (controller.ts:155); audit/effects "Absolute Zero" |
| `ordnance.cluster_warheads` | Cluster Warheads | Missiles split into 4 bomblets just before impact; each deals 40% damage in a 60% blast. | Verified | tests: data/content, progression/anomalies, systems/ordnance | — |
| `drones.payload` | Payload | Every 5 s each drone drops a bomb on the densest spot beneath its path: 60-unit blast for 300% drone damage. | Verified | tests: data/content, systems/drones | — |
| `blade.deflection` | Deflection | The blade destroys enemy projectiles it sweeps through. | Verified | tests: data/content, systems/blade | — |
| `laser.vertex_blast` | Vertex Blast | Every 2 s each node fires an outward beam 200 units long for 150% beam damage. | Verified | tests: data/content, systems/laser | — |
| `gravitics.mass_driver` | Mass Driver | Enemies flung out of a collapsing well collide with others for 10% of their max HP (5% for bosses). | Verified | tests: data/content, systems/gravitics | — |

### Linkages (25)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `link.primary+ordnance` | Shell Casing | Primary crits Mark their target for 3 s. Missiles striking a Marked enemy gain +10% crit chance per rank and use the primary's crit damage. | Verified | tests: systems/linkages | — |
| `link.primary+drones` | Wingman | Drone hits have a 30% chance (+10% per rank after the first) to strike again for 30% (+10% per rank) of the hit, carrying your first attuned element and the primary's Ex… | Approximated → **Verified** | "copy the primary's on-hit effects (element procs, Execution, Static) at 30%" — it is a 30% chance of an extra 30% hit tagged with your first element (linkage hits do not proc elements) | text (linkages.ts:32–33) |
| `link.primary+blade` | Whetstone | Shots crossing the blade's arc gain +1 pierce. Primary crits speed the blade by 5% per rank for 1 s (stacking up to 5 times). | Verified | tests: accept/harness, systems/linkages | — |
| `link.primary+laser` | Energized Rounds | Shots crossing a laser beam gain +10% damage per rank and take on the beam's element Infusion (if they carry none). | Approximated → **Verified** | "carry every Infusion" — a shot takes the beam's one element | text (linkages.ts:39) |
| `link.primary+gravitics` | Slingshot | Shots curve toward gravity wells within 80 units and gain +8% damage per rank for each well they pass. | Verified | tests: systems/linkages | — |
| `link.ordnance+drones` | Spotter | Drone hits Spot their target for 2 s, and missiles prefer Spotted enemies. Missile kills have a 10% chance per rank to spawn a microdrone for 5 s. | Verified | tests: progression/forecast-codex, systems/linkages | — |
| `link.ordnance+blade` | Shrapnel Sweep | Blade hits on enemies caught in an explosion within the last 1 s deal +15% damage per rank. | Verified | tests: systems/linkages | — |
| `link.ordnance+laser` | Charged Warheads | Missiles that cross a laser beam split on impact into 2 extra warheads, each dealing 30% per rank of the missile's damage. | Verified | tests: systems/linkages | — |
| `link.ordnance+gravitics` | Payload Well | Explosions inside a gravity well gain +5% radius per rank for each enemy the well holds (up to +100%). | Verified | tests: systems/linkages | — |
| `link.drones+blade` | Escort Blades | Each drone carries a miniature orbital blade (16-unit radius) that deals 15% per rank of blade damage and applies blade on-hit effects. | Verified | tests: systems/linkages | — |
| `link.drones+laser` | Mobile Vertex | Every 6 s, 1 drone per rank becomes a laser node for 3 s, joining the polygon with beams to its two nearest nodes. | Verified | tests: systems/linkages | — |
| `link.drones+gravitics` | Gravity Assist | Drones passing within a gravity well slingshot around it, gaining +10% speed and damage per rank for 2 s. | Verified | tests: systems/linkages | — |
| `link.blade+laser` | Vertex Strike | When the blade sweeps past a laser node, that node fires a Vertex Blast at 40% per rank strength (once per node every 2 s). Works without the Vertex Blast Exotic. | Verified | tests: accept/harness, audio/chain, audio/director | — |
| `link.blade+gravitics` | Undertow | Blade hits deal +12% damage per rank to enemies held in a gravity well. | Verified | tests: systems/linkages | — |
| `link.laser+gravitics` | Bent Light | Beams passing within a gravity well bend through its center, sweeping an arc up to 10% per rank of the well's radius wider, and deal +5% damage per rank while bent. | Verified | tests: systems/linkages | — |
| `chassis.bastion+ordnance` | Counterbattery | When the shield or Outer Barrier breaks, the rack launches a volley of 4 missiles per rank at the nearest enemies. | Verified | tests: systems/linkages | — |
| `chassis.bastion+drones` | Recharge Circuit | Each drone kill restores 1% per rank of shield capacity. | Verified | tests: systems/linkages | — |
| `chassis.bastion+blade` | Kinetic Loop | Each hit the shield or barrier absorbs speeds the blade by 8% per rank for 1 s (stacking up to 5 times). | Verified | tests: systems/linkages | — |
| `chassis.bastion+laser` | Refraction Lens | While the shield or Outer Barrier holds any charge, beams are 10% per rank wider. | Verified | tests: progression/forecast-codex, systems/linkages | — |
| `chassis.bastion+gravitics` | Safe Harbor | When 6 or more enemies are inside the inner ring, a defensive well forms around the tower, pushing outward. Cooldown 16 s, −2 s per rank. | Verified | tests: systems/linkages | — |
| `chassis.reactor+ordnance` | Hot Loading | While Critical Mass is active, each kill has a 10% chance per rank to instantly reload a launcher. | Verified | tests: systems/linkages | — |
| `chassis.reactor+drones` | Sync Burst | Combos that include a drone hit give every drone +10% per rank speed and attack speed for 2 s. | Verified | tests: systems/linkages | — |
| `chassis.reactor+blade` | Flywheel | Global attack speed and Overclock bonuses apply to blade rotation at 40% strength per rank (120% at rank 3). | Verified | tests: systems/linkages | — |
| `chassis.reactor+laser` | Pulse Clock | Laser Pulse cadence scales with global attack speed at 33% strength per rank (99% at rank 3). | Verified | tests: systems/linkages | — |
| `chassis.reactor+gravitics` | Event Loop | Each enemy a well captures cuts that well's next cooldown by 0.1 s per rank (up to 50%). | Verified | tests: systems/linkages | — |

### Infusions (20)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `infuse.ordnance.fire` | Napalm Craters | Missile explosions leave a burning crater for 2 s that applies 1 Burn stack per second per rank to enemies inside. | Verified | tests: progression/forecast-codex | — |
| `infuse.ordnance.lightning` | Arc Warheads | Missile explosions arc to 3 enemies outside the blast, each arc dealing 25% per rank of the explosion's damage. | Verified | tests: systems/infusions + code | — |
| `infuse.ordnance.poison` | Toxic Payload | Missile explosions leave a toxic cloud for 3 s that applies 1 Poison stack per second per rank to enemies inside. | Verified | tests: systems/infusions + code | — |
| `infuse.ordnance.frost` | Cryo Shells | Missile explosions leave an ice patch for 3 s that applies 1 Chill stack per second per rank to enemies crossing it. | Verified | tests: systems/infusions + code | — |
| `infuse.drones.fire` | Incendiary Rounds | Drone shots have a 10% chance per rank to apply Burn. | Verified | tests: systems/drones | — |
| `infuse.drones.lightning` | Relay Shock | Drone hits have a 15% chance per rank to arc to the target of the nearest other drone. | Verified | tests: systems/infusions + code | — |
| `infuse.drones.poison` | Stingers | Drone shots apply 0.25 Poison stacks per rank on average. | Verified | tests: systems/infusions | — |
| `infuse.drones.frost` | Frostbite Rounds | Drone shots have a 15% chance per rank to apply Chill. | Verified | tests: systems/infusions + code | — |
| `infuse.blade.fire` | Burning Edge | The blade leaves a fire trail along its tip for 0.6 s that applies 1 Burn stack per rank to enemies it touches (once per enemy per pass). | Verified | tests: progression/forecast-codex, render/chain-lines, systems/elements | — |
| `infuse.blade.lightning` | Arc Edge | Blade hits have a 20% chance per rank to arc lightning to nearby enemies. | Verified | tests: systems/infusions + code | — |
| `infuse.blade.poison` | Venom Edge | Blade hits apply 1 Poison stack per rank. A kill contaminates the blade for 2 s, doubling the stacks it applies. | Verified | tests: systems/infusions | — |
| `infuse.blade.frost` | Rime Edge | Blade hits apply 1 Chill stack per rank. Hitting a frozen enemy shatters the ice for 50% bonus damage. | Verified | tests: systems/infusions | — |
| `infuse.laser.fire` | Ignition Beam | Enemies touching a beam gain 1 Burn stack per rank each second. | Verified | tests: accept/harness, systems/infusions | — |
| `infuse.laser.lightning` | Arc Vertices | Every second, each laser node arcs to the nearest enemy within 100 units for 30% per rank of beam damage. | Verified | tests: systems/infusions + code | — |
| `infuse.laser.poison` | Toxic Beam | Enemies touching a beam gain 1 Poison stack per rank each second. | Verified | tests: systems/infusions + code | — |
| `infuse.laser.frost` | Frost Beam | Enemies touching a beam gain 1 Chill stack per rank each second, and enemies inside the polygon gain 1 Chill stack every 2 s. | Verified | tests: audio/chain, audio/director, audio/harness-entry.ts | — |
| `infuse.gravitics.fire` | Firestorm Well | Wells burn their captives: 1 Burn stack per rank each second while held. | Verified | tests: systems/infusions + code | — |
| `infuse.gravitics.lightning` | Storm Well | Every 0.5 s each well arcs between 1 pair of captives per rank for full arc damage. | Verified | tests: systems/infusions + code | — |
| `infuse.gravitics.poison` | Toxic Vortex | Wells poison their captives: 1 Poison stack per rank each second while held. | Verified | tests: systems/infusions + code | — |
| `infuse.gravitics.frost` | Cryo Collapse | Collapsing wells apply 2 Chill stacks per rank to their captives; at rank 3 they freeze solid for 1 s (bosses excluded). | Verified | tests: systems/infusions + code | — |

### Fusions (6) and Triads (4)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `fusion.toxic_combustion` | Toxic Combustion | Applying Burn to an enemy with 5+ Poison stacks consumes them: a 60-unit explosion deals their remaining poison damage ×0.5, +0.25 per rank after the first (falling off … | Verified | tests: systems/fusions | — |
| `fusion.superconductivity` | Superconductivity | Arcs jump to chilled enemies first and gain +15% damage per rank for each chilled enemy already in the chain. | Verified | tests: systems/fusions | — |
| `fusion.thermal_shock` | Thermal Shock | Burning an enemy with 4+ Chill stacks, or Chilling an enemy with 3+ Burn stacks, bursts for 100% per rank of the triggering hit as physical damage in 50 units. Once per … | Verified | tests: progression/forecast-codex, systems/fusions | — |
| `fusion.electrolysis` | Electrolysis | Each arc that strikes a poisoned enemy instantly deals 15% per rank of its pending poison damage, without removing stacks. | Verified | tests: systems/fusions | — |
| `fusion.plasma` | Plasma | An arc jumping from or to a burning enemy leaves a plasma line along its path for 1 s, dealing 20% per rank of arc damage per second to anything touching it. | Verified | tests: accept/harness, audio/chain, audio/director | — |
| `fusion.cryotoxin` | Cryotoxin | Poison damage dealt to a frozen enemy is banked instead; when it thaws, the bank releases at once at ×1.5, +0.25 per rank after the first. | Verified | tests: systems/fusions | — |
| `triad.catalyst` | Catalyst | Whenever a Burn, arc or Poison proc lands, there is a 10% chance per rank that the other two elements proc on the same enemy. | Verified | tests: systems/elements | — |
| `triad.polar_storm` | Polar Storm | Thermal Shock bursts also arc as lightning to 1 enemy per rank, at full arc damage. | Verified | tests: systems/fusions | — |
| `triad.crucible` | Crucible | Thermal Shock bursts copy 2 Poison stacks per rank from the victim onto every enemy they hit. | Verified | tests: systems/fusions | — |
| `triad.cold_circuit` | Cold Circuit | Arcs jumping between enemies that are both chilled and poisoned never lose damage per jump, and deal +10% damage per rank. | Verified | tests: systems/fusions | — |

### Abilities (10, with their rank nodes)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `hunter_mark` | Hunter Mark | Mark one enemy for 8 s: every system prioritizes it, and statuses applied to it gain +50% application. Rank node: The marked enemy takes +25% more status application per… | Not implemented → **Verified** | "+50% status application" (and its rank node's +25%/rank) had no reader — the documented contract was never implemented | applyStatus adds the bonus on the Hunter-Marked enemy (world-impl.ts:391); audit/effects "Hunter Mark" |
| `repulsor_pulse` | Repulsor Pulse | A ring of force from the tower pushes every enemy within 160 units 180 units outward and cancels charges in progress. Rank node: The pulse shoves enemies 40 units farthe… | Approximated → **Verified** | no charge cancel | stallCharge on everything in the pulse (abilities.ts:242, enemies/bosses.ts:141); audit/effects |
| `time_field` | Time Field | Enemies inside a 110-unit field move at 20% speed for 6 s. Dashes and charges that enter it stall. Rank node: The field lasts 1 s longer per rank. | Approximated → **Verified** | dashes and charges only slowed to 20% (a charger dash still ran at 0.8× normal) | stallCharge inside the field (abilities.ts:405); audit/effects |
| `bombardment` | Bombardment | After a 0.6 s fuse, a 90-unit explosive charge detonates anywhere in the arena for 25× primary damage. Rank node: The charge deals +30% damage per rank and its blast gro… | Verified | tests: active/abilities, active/determinism, active/directives | — |
| `emp` | EMP | Strips all shields within 220 units and interrupts enemy abilities, tethers and shield links for 3 s. Rank node: EMP costs 10% less Command Energy per rank and interrupt… | Approximated → **Verified** | boss tethers (Leech Queen) and generator / pulse shield links kept running | empLinkCut for bosses in range (abilities.ts:266, enemies/bosses.ts:163); audit/effects "EMP" |
| `overdrive` | Overdrive | Every weapon system fires at ×2 attack speed for 5 s. Rank node: Overdrive lasts 1 s longer per rank. | Verified | tests: active/abilities, audio/director, enemies/data | — |
| `emergency_repair` | Emergency Repair | Instantly restores 30% of the tower's max HP. Rank node: Emergency Repair costs 10% less Command Energy per rank and restores 5% more max HP per rank. | Verified | tests: active/abilities, active/directives, audio/director | — |
| `drone_surge` | Drone Surge | Launches 6 expendable drones that fight for 10 s, then dive into the nearest enemy and explode. Rank node: Drone Surge launches 2 more expendable drones per rank. | Not implemented → **Verified** | no dive or explosion at the end | last 0.75 s: each drone dives at the nearest enemy, impact = 40-unit blast ×2 damage (abilities.ts:455); audit/effects "Drone Surge" |
| `missile_storm` | Missile Storm | A swarm of 24 homing missiles pours over 4 s into enemies within 200 units of the target point. Rank node: Missile Storm fires 8 more homing missiles per rank. | Verified | tests: active/abilities, active/determinism, audio/director | — |
| `singularity_bomb` | Singularity Bomb | A collapsing point pulls every enemy within 150 units together for 2 s, then explodes for 40× primary damage. Rank node: Singularity Bomb costs 10% less Command Energy p… | Verified | tests: active/abilities, audio/director, enemies/data | — |

### Doctrine capstones (36)

| id | name | claim (player text) | status (before → after) | evidence | action |
| --- | --- | --- | --- | --- | --- |
| `ballistics.multishot.split_sight` | Split Sight | Extra projectiles stop fanning out: each one picks its own target in range, nearest first. | Verified | tests: data/content | — |
| `ballistics.piercing.last_rites` | Last Rites | The final enemy a shot pierces takes ×4 damage. | Verified | tests: data/content | — |
| `ballistics.ricochet.return_fire` | Return Fire | When no new target is in reach, bounces revisit enemies they already struck instead of ending. | Verified | tests: data/content | — |
| `ballistics.heavy.staggerhead` | Staggerhead | Heavy Round impacts stagger elites for 0.6 s and interrupt boss casts (each boss can be interrupted once per 4 s). | Verified | tests: data/content | — |
| `bastion.fortress.keep` | Keep | Healing beyond max HP becomes a barrier, up to 25% of max HP. The barrier does not decay. | Verified | tests: data/content, systems/bastion | — |
| `bastion.aegis.mirror_aegis` | Mirror Aegis | Enemy projectiles striking the barrier are reflected back at their shooter for 100% of their damage. | Verified | tests: data/content, systems/bastion | — |
| `bastion.thorns.spite` | Spite | Retaliation damage chains to a second enemy within 120 units at 60% strength. | Verified | tests: data/content, systems/bastion | — |
| `bastion.phoenix.ember_heart` | Ember Heart | Below 25% HP, every weapon system gains +30% speed. | Verified | tests: data/content, systems/bastion | — |
| `reactor.overclock.overdrive_core` | Overdrive Core | Every 30 s, the reactor overdrives for 5 s: +50% speed for every weapon system. | Verified | tests: data/content, systems/reactor | — |
| `reactor.salvage.strip_mine` | Strip Mine | First clears of a wave pay ×4 Scrap instead of ×3. | Verified | tests: data/content, systems/reactor | — |
| `reactor.sync.harmonic_lock` | Harmonic Lock | When 4+ systems land a combo on one enemy, it takes +50% damage from all sources for 3 s. | Verified | tests: data/content, systems/reactor | — |
| `reactor.command.fourth_slot` | Fourth Slot | Unlocks a fourth tactical ability slot. | Verified | tests: active/abilities, data/content | — |
| `fire.wildfire.spread` | Conflagration | Flashpoints pass on every Burn stack the victim carried instead of one, and an enemy pushed to max stacks by a Flashpoint erupts in turn. | Verified | tests: data/content, systems/elements | — |
| `fire.inferno.sunburst` | Sunburst | Every Fireball bursts into a ring of 8 embers on impact; each ember flies 90 units and applies 1 Burn stack to what it touches. | Verified | tests: systems/elements | — |
| `lightning.chain.discharge` | Discharge | An enemy that dies carrying Static releases it as a 5-target arc at 100% arc damage. | Verified | tests: data/content, systems/elements | — |
| `lightning.storm.arc_anchor` | Arc Anchor | Bosses and elites become arc anchors: every arc within range bends through them, and anchors take +50% arc damage. | Verified | tests: data/content, systems/elements | — |
| `poison.plague.plague_carrier` | Plague Carrier | The most-poisoned enemy becomes a Plague Carrier: every second it gives 1 stack to each enemy within 70 units. When it dies, the role passes to the next most-poisoned en… | Verified | tests: data/content, systems/elements | — |
| `poison.venom.toxic_burst` | Toxic Burst | An enemy reaching its Poison stack cap bursts: all stacks deal their remaining damage at once, then half the stacks are reapplied. | Verified | tests: data/content, systems/elements | — |
| `frost.control.glacial_shot` | Glacial Shot | Every 5th primary shot is a Glacial Shot that pierces everything in its line and applies max Chill. | Verified | tests: data/content, systems/elements | — |
| `frost.shatter.iceburst` | Iceburst | Brittle enemies that die shatter in a 70-unit Iceburst dealing 20% of their max HP and applying 3 Chill stacks. | Verified | tests: data/content, systems/elements | — |
| `ordnance.hunter.kill_order` | Kill Order | Missile hits on an exposed boss weak point extend its exposure by 1 s (up to +4 s per opening). | Approximated → **Verified** | held the flag open but the weak-point ×1.5 / ×2 damage read the controller timer, so the extension gave no damage | same modifier fix as Held Open (enemies/bosses.ts:191); systems/ordnance "Kill Order" |
| `ordnance.swarm.cascade` | Cascade | Each rocket explosion has a 25% chance to launch a smaller rocket (60% damage) at a new target. Cascade rockets can cascade. | Verified | tests: data/content, systems/ordnance | — |
| `ordnance.bombard.carpet` | Carpet | Shells leave hazard zones for 3 s dealing 20% of shell damage per second; overlapping zones merge into one larger zone with their damage combined. | Verified | tests: data/content, systems/ordnance | — |
| `drones.wing.sortie` | Sortie | Drones detach from orbit to pursue targets anywhere in the arena, returning to rearm every 4 s. | Verified | tests: data/content, systems/drones | — |
| `drones.arc.faraday_web` | Faraday Web | Links join every drone to every other drone, forming a mesh that damages anything crossing it. | Verified | tests: data/content, systems/drones | — |
| `drones.carrier.brood` | Brood | Microdrones inherit every on-hit effect of their carrier: Infusions, Wingman, and element procs. | Verified | tests: data/content, systems/drones | — |
| `drones.support.aegis_wing` | Aegis Wing | Drones intercept enemy projectiles that cross their orbit, destroying them. | Verified | tests: data/content, systems/drones | — |
| `blade.twinning.gyre` | Gyre | Alternate blades counter-rotate, so enemies between two radii are struck twice per crossing. | Verified | tests: data/content | — |
| `blade.greatblade.sunder` | Sunder | Every blade hit permanently strips 2% of the enemy's armor and shield capacity (up to 60%). | Verified | tests: data/content, systems/blade | — |
| `blade.tempest.cyclone` | Cyclone | At max Momentum, the blade throws a cutting arc outward every half turn, travelling 250 units for 60% blade damage. | Verified | tests: data/content, systems/blade | — |
| `laser.expansion.mandala` | Mandala | An inner star at half radius plus an outer ring at full radius, both firing at full strength. | Verified | tests: data/content | — |
| `laser.resonance.standing_wave` | Standing Wave | Multi-beam damage compounds: +20% for each second an enemy stays in 2+ beams, up to +200%. | Verified | tests: data/content, systems/laser | — |
| `laser.containment.crush` | Crush | Every 8 s the polygon contracts to half radius over 1 s, dragging enemies inside it inward, then springs back. | Verified | tests: data/content, systems/laser | — |
| `gravitics.collapse.chain_collapse` | Chain Collapse | Each implosion spawns 2 smaller wells (half radius, 1.5 s) that implode in turn at 50% damage. | Verified | tests: data/content, systems/gravitics | — |
| `gravitics.lensing.focal_point` | Focal Point | Projectiles passing a well converge on the single highest-HP enemy it holds. | Verified | tests: data/content, systems/gravitics | — |
| `gravitics.tidal.orbit_lock` | Orbit Lock | When a well collapses, its captives are flung into orbit around the tower at blade radius for 2 s. | Verified | tests: data/content, systems/gravitics | — |

## 3. Other nodes whose text or numbers were wrong

Tree nodes outside the required groups, found while tracing the claims above:

| node | before | after | evidence |
| --- | --- | --- | --- |
| `reactor.targeting_logic` Targeting Logic | **Not implemented** (dead) | Verified: rank 1 ranks enemies already doomed by damage in flight last; rank 2 makes the primary and drones lead exactly; rank 3 spreads hardpoint picks over distinct targets each tick (the primary never avoids). Sticky targeting kept: the current target is kept unless it became doomed/claimed or the profile's 20% rule says switch. | `core/targeting.ts:40,110`, `world-impl.ts:173`, `ballistics.ts:132,150`, `drones.ts:228`; `tests/audit/effects` "Targeting Logic" (4 cases), `tests/core/sticky-targeting` still green |
| `ballistics.multishot.count` Extra Barrels | **Mismatch**: "up to 5" but 3 ranks (max 4 projectiles) | 4 ranks (design §5 "2 → 5 projectiles"); rank 4 costs 32,400 Scrap | `chassis.ts:39`; `tests/audit/effects` "Extra Barrels" |
| `ballistics.multishot.penalty` Barrel Harmonics | **Mismatch**: text "damage ÷ (1 + 0.35 × extra)", "to 0.05"; code ×(1 − 0.35) and 10 ranks → 0.20 | text: "each deals 35% less … to 20% at max rank" (code kept) | `chassis.ts:41` |
| `ballistics.piercing.count` / `ricochet.bounces` | **Mismatch**: "up to 5", 4 ranks | text "up to 4" (no design number) | `chassis.ts:49,63` |
| `ballistics.execution` Execution | **Approximated**: CE refund on every primary kill, not only "injured" enemies | text: "Every primary kill refunds …" | `chassis.ts:31` |
| `bastion.thorns.retaliation` Retaliation | **Mismatch**: "damage they dealt (before armor)" — hook receives damage after armor | text "(after armor)" | `chassis.ts:128` |
| `reactor.global_attack_speed` Clock Multiplier, `reactor.overclock.speed` Overclock | **Approximated**: "every weapon system" — only primary, missiles, drones read it (blade / Pulse via Flywheel / Pulse Clock) | text names the systems | `chassis.ts:159,169` |
| `reactor.cooldown_reduction` Heat Sinks | **Approximated** (under-promised): also cuts tactical ability cooldowns | text says so | `chassis.ts:160` |
| `poison.venom.virulence` Virulence | **Mismatch** (under-promised): Venom's base is +3% per stack past the 5th, ranks +2% | text states both | `elements.ts:113` |
| Codex milestones (10 / 25 / 50 entries) | **Not implemented** (palettes); draft weight Verified | palettes recorded in `meta.palettes`, nothing renders them; comment made honest, Open (§9) | `economy/codex.ts:12` |
| `frost.shatter.brittle` Brittle | **Approximated** (under-promised): Brittle stacks (up to 3) also give crits +15% per stack (core rule) | text states it | `elements.ts:150` |

## 4. Boss Tell → Counter table

`tests/audit/boss-counters.test.ts`, one row per tell a boss can show (The Crown per phase, Deep Graft per borrowed
source, wave 105 → Broodheart and Siege Engine). "Right" = the mapped Counter from `counterHint` in the window;
"wrong" = another ability aimed at the tell focus (for designate tells also designating a non-wanted enemy);
"rejected" = the right ability while not slotted, then slotted but on cooldown.

| boss | tell | Counter | right scores | wrong scores | rejected scores (before → after) |
| --- | --- | --- | --- | --- | --- |
| The Breaker | slam | Repulsor Pulse | yes | no | **yes → no** |
| Broodheart | brood_sac | Bombardment | yes | no | **yes → no** |
| The Warden | shield_links | EMP | yes | no | **yes → no** |
| The Siege Engine | ram_charge | Time Field | yes | no | **yes → no** |
| Iron Maw | maw_open | designate | yes | no | n/a |
| Mirror Hive | clone_shuffle | Hunter Mark | yes | no | **yes → no** |
| Storm Crown | hazard_ring | Repulsor Pulse | yes | no | **yes → no** |
| The Distant Saint | halo_charge | Missile Storm | yes | no | **yes → no** |
| Leech Queen | feeding_tethers | EMP | yes | no | **yes → no** |
| Splinter King | split_flash | Singularity Bomb | yes | no | **yes → no** |
| Null Engine | resistance_rotate | designate (the weak-type node) | yes | no | n/a |
| The Chronophage | dilation_pulse | Time Field | yes | no | **yes → no** |
| Hive Fortress | gate_open | Bombardment | yes | no | **yes → no** |
| Redline | dash_lane | Time Field | yes | no | **yes → no** |
| Grave Battery | revive_beam | EMP | yes | no | **yes → no** |
| Event Horizon | inhale | Repulsor Pulse | yes | no | **yes → no** |
| The Architect | wall_blueprint | Bombardment | yes | no | **yes → no** |
| The Choir | harmony_sync | designate in the sung order | yes | no (wrong order: existing test) | n/a |
| The Last Procession | procession_halt | Singularity Bomb | yes | no | **yes → no** |
| The Crown, phase 1 / 2 / 3 | slam / shield_links / inhale | Repulsor / EMP / Repulsor | yes / yes / yes | no | **yes → no** (all three) |
| Deep Graft (w105), source A / B | brood_sac / ram_charge | Bombardment / Time Field | yes / yes | no | **yes → no** |

Every boss's Counter can be scored. The bug: `BossSystem.onCommand` scored any `cast` command whose CE covered the
cost, before the abilities system decided whether the cast went off, so an unslotted ability, one on cooldown, or a
cast under Blackout still scored the Counter, refunded half its cost and opened the weak point. Casts now score
through `notifyAbilityCast`, which `AbilitiesSystem.cast` calls after the cast goes off (`systems/abilities.ts:211`,
`enemies/bosses.ts:244`); designations still score from the command (they are validated before observers see them).
`tests/enemies/bosses.test.ts` now slots the abilities it casts.

## 5. Fixes (file:line) with before / after numbers

| effect | before | after | where |
| --- | --- | --- | --- |
| Final multipliers | a `mul` penalty added to the key's multiplier sum, so upgrade ranks diluted it | `key@final` effects multiply after the sum, each source separately | `core/stats.ts:60,100` |
| Arsenal primary damage | ×(1 + 0.08·ranks − 0.25)/(1 + 0.08·ranks): −9.6% at 20 Caliber ranks | ×0.75 at any rank | `data/frames.ts:37` |
| Hive primary rate | ×(1 + 0.05·r − 0.5)/(1 + 0.05·r): −25% at 20 Autoloader ranks | ×0.5 | `data/frames.ts:55` |
| Mirror Node beams | −10% at 20 Beam Intensity ranks | ×0.6 | `data/anomalies.ts:44` |
| Glass Cannon / Overcharged Capacitor / Feedback Loop CE | additive with other sources (e.g. Glass Cannon + Salvage 1.35 instead of 1.275) | exact ×1.5 / ×1.5 / ×0.6 | `data/anomalies.ts:85,96,131` |
| Heavy Water | Poison 4 Hz, +50% additive DPS | pulses every 19 ticks (×1.27 per tick) with ×1.2 DPS: each tick ≈ ×1.52, net +20%/s | `data/anomalies.ts:80`, `systems/statuses.ts:32,87` |
| Cold Iron | nothing | armor −1% per Chill stack (with Corrosion, cap 90%) | `systems/elements.ts:531` |
| Stormglass | extra 50% arc from the struck enemy, 2× range | the arc link itself reaches 2 × `lightning.arc_range` from or to a frozen / max-Chill enemy | `systems/elements-shared.ts:86,182` |
| Clockwork Blade | knockback 40 for everything within blade length + 120 (260 u) of the tower, away from the tower | 120 u around each blade tip, away from the tip | `systems/anomalies.ts:342` |
| Unstable Isotope | +50% radius on element / Fusion / boon blasts only | also missiles and rockets (40 → 60), rack volleys, shells, drone bombs, Bombardment, Missile Storm, Singularity Bomb | `ordnance.ts:75`, `hardpoints/common.ts:200`, `drones.ts:113`, `abilities.ts:254,417,447` |
| Feedback Loop | 1 s after a cast, enemies it damaged took 50% again; utility casts nothing | the cast repeats at 50% power 1 s later (same point / target; no CE, cooldown or Counter) | `systems/abilities.ts:223,307` |
| Tithe / Hungry Core | hard-coded 2 Cores / 1% | read `economy.boss_cores` / `bastion.kill_heal` (same numbers) | `core/world-impl.ts:306,312` |
| Pacifist Core | true damage skipped the rule | enforced for true damage too | `core/world-impl.ts:248` |
| Hunter Mark | +0% status application | +50% (+25% per rank; the fraction is a chance of one more stack) on the Hunter-Marked enemy | `core/world-impl.ts:391`, `abilities.ts` (sets `huntedGen`) |
| Repulsor Pulse | knockback only | also cancels charger wind-ups / dashes and boss dashes in its radius | `abilities.ts:242`, `enemies/bosses.ts:141` |
| Time Field | dash at 20% speed (a charger dash ran at 0.8× walking speed) | a dash or charge in the field stalls (charger waits 3 s; boss dash ends, no dash damage) | `abilities.ts:405` |
| EMP | bosses: tell interrupt only | also cuts a boss's tether and shield links for 3 s (+0.5 s/rank) | `abilities.ts:266`, `enemies/bosses.ts:163` |
| Drone Surge | drones expired | in their last 0.75 s they dive at the nearest enemy; impact = 40 u blast at 2× (3× primary damage) | `abilities.ts:455` |
| Absolute Zero | boss clocks unaffected | a max-Chill boss's tell timer and attack cadence run at ×0.5 | `enemies/bosses/controller.ts:155` |
| Kill Order / Held Open | weak point flagged open, ×1 damage | ×1.5 (×2 designated) while held | `enemies/bosses.ts:191` |
| Anchor Well | two wells in one tick: both ×2 life | only the first | `systems/gravitics.ts:159` |
| Meteor Round | Inferno Fireballs only | Seventh Shot Fireballs count too | `systems/elements.ts:422` |
| Spare Barrel / Dual Doctrine Multishot | 1 + ranks × strength² barrels (4 ranks at 50% → 2 projectiles) | 1 + ranks × strength (→ 3) | `systems/ballistics.ts:72` |
| Extra Barrels | 3 ranks, max 4 projectiles | 4 ranks, max 5 | `data/chassis.ts:39` |
| Long Patrol | any rank → 24 h / 70% | 12 / 16 / 20 / 24 h and 47.5 / 55 / 62.5 / 70% | `run/commands.ts:134`, `economy/curves.ts:90` |
| Targeting Logic | nothing | see §3 | `core/targeting.ts`, `core/world-impl.ts:173` |
| Focal Reactor / Deployment Charge / Prism Battery | nothing | 20 interior kills → 10× primary piercing beam; ordnance explosion → 4 s drone (≤ 6); every 1.5 s a missile from each beam crossing (≤ 8) | `systems/constellation.ts`, registered `systems/index.ts:40` |
| Boss Counters | rejected casts scored | only casts that go off | `abilities.ts:211`, `enemies/bosses.ts:244` |

## 6. Text changes (old → new)

| item | old text | new text |
| --- | --- | --- |
| Extra Barrels | (text unchanged, "up to 5") | 4th rank added so the text is true (design §5) |
| Barrel Harmonics | "Extra projectiles dilute damage: each deals damage ÷ (1 + 0.35 × extra projectiles). Each rank lowers the 0.35 penalty by 0.015 (to 0.05)." | "With 2 or more projectiles, each deals 35% less damage. Each rank lowers the penalty by 1.5 points (to 20% at max rank)." |
| Penetrator Core | "… +1 per rank (up to 5)." | "… (up to 4)." |
| Rebound Rounds | "… +1 bounce per rank (up to 5) …" | "… (up to 4) …" |
| Execution | "Primary kills on injured enemies refund 1 Command Energy per rank." | "Every primary kill refunds 1 Command Energy per rank." |
| Retaliation | "… of the damage they dealt (before armor) …" | "… of the damage it took (after armor) …" |
| Clock Multiplier | "+3% attack speed for every weapon system per rank." | "+3% attack speed per rank for the primary, the missile rack and drones (the blade and laser Pulse gain it through Flywheel and Pulse Clock)." |
| Heat Sinks | "Hardpoint cooldowns (reloads, well cooldowns, pulses) −1% per rank." | "… and tactical ability cooldowns −1% per rank." |
| Overclock | "+3% speed for every weapon system per rank …" | "+3% attack speed per rank for the primary, the missile rack and drones …" |
| Virulence | "Poison deals +2% damage per rank for every stack past the 5th on the target." | "Under Venom, Poison deals +3% damage for every stack past the 5th on the target; +2% per rank." |
| Brittle | "… become Brittle: +4% damage taken per rank." | "… become Brittle (up to 3 stacks): +4% damage taken per rank, and critical hits on them deal +15% more per Brittle stack." |
| Meteor Round | "Every 5th Fireball, from any source, …" | "Every 5th Fireball, from any source (Inferno or Seventh Shot), …" (and now true) |
| Heavy Water | "Poison ticks 25% slower but each tick hits 50% harder." | "… (+20% Poison damage per second)." (and now true) |
| Unstable Isotope | "… for 10% of their damage." | "… for 10% of their damage (at most 2% of max HP each)." |
| Echo Engine (Frame trait) | "Every 8th attack of each system repeats." | "Every 8th shot of the primary, the missile rack and each drone repeats." |
| Wingman | "Drone hits copy the primary's on-hit effects (element procs, Execution, Static) at 30% strength, +10% per rank after the first." | "Drone hits have a 30% chance (+10% per rank after the first) to strike again for 30% (+10% per rank) of the hit, carrying your first attuned element and the primary's Execution bonus." (short: "Drone hits can strike again with your element.") |
| Energized Rounds | "… and carry every Infusion on the Laser Polygon." | "… and take on the beam's element Infusion (if they carry none)." |
| Berserk / Bulwark / Slow and Sure (boons) | "… attack speed for every weapon" | "… attack speed for the primary, missiles and drones" |
| Blackout (Trial reward) | "Autocast and Directive efficiency +10%" | "Directive and Autocast Counter efficiency +10%" |
| Dual Doctrine (Prestige IV) | "At Prestige start, choose one tree: it runs a second Doctrine at 60% strength." | "One tree may run a second Doctrine at 60% strength: the first tree you give one claims it (clearing that second Doctrine frees the choice)." |

## 7. Balance safety

Both runs on isolated snapshots (`git archive HEAD` for before; HEAD plus only this audit's changes for after, so the
parallel reachability work is excluded). `npm run sim:accept -- --quick` (seed 1, 0.5 sim-h per climb):

| row | before | after | moved |
| --- | --- | --- | --- |
| Checkpoint odds | FAIL 33.3 / 33.3 / 33.3% | FAIL 33.3 / 33.3 / 33.3% | — |
| Checkpoint time | FAIL 7.3 min | FAIL 7.3 min | — |
| First wall | FAIL never | FAIL never | — |
| Reclimb | FAIL 95.3% | FAIL 89.4% | −5.9 pts (toward the 25–40% target) |
| Push | FAIL +1 | FAIL +5 | +4 waves (toward +8–15) |
| Forecast | FAIL no recommendation | FAIL no recommendation | — |
| Build health | PASS worst 100% | PASS worst 100% | — |
| Doctrine health | PASS worst 100% (multishot 14 = piercing 14) | PASS worst 100% (14 = 14) | — |
| Spend efficiency | FAIL 1 offender (greedy fire 23.2% spend / 8.0% dmg) | FAIL 1 offender (22.7% / 6.7%) | offender's damage share −1.3 pts |
| Defense | FAIL survival 14 vs greedy 16 (87.5%) | **PASS** 17 vs 18 (94.4%) | FAIL → PASS |
| Active edge | FAIL 33.3% fewer attempts (6 vs 9); counters 19/19 | FAIL 33.3% (6 vs 9); counters 16/16 | — (the active agent slots its abilities, so no Counter was lost) |
| Directive gap | FAIL closes 0% | FAIL closes 0% | — |
| Formation fairness | PASS worst ×1.369 | PASS worst ×1.369 | — |
| Anomaly cap | PASS max +0% | PASS max +10.5% (glass_cannon; cap 15%) | +10.5 pts, still under the cap (1 seed: 21 vs 19 waves) |
| Boon cap (quick row) | FAIL +11.3% glass_hour | FAIL +11.3% glass_hour | — (the quick row is 1 sim-h, 6 boons; it failed before) |
| Offline | PASS 40.2% | PASS 40.2% | — |
| Determinism | PASS 2730b9d = 2730b9d | PASS 257886e9 = 257886e9 | hash changed (expected), still identical twice |

**Boon cap, full row** (`npm run sim -- --boon-cap`: idle Generalist, 2 sim-h, seeds 1–2, 36 boons): before **PASS**
max +8.1% (rally_drones), baseline depth 55.5; after **PASS** max +9.2% (scrap_magnet), baseline depth 65; noise floor
5.4% → 0.8%. No boon over the 10% cap either way.

**Why the idle depth rose.** Two effects that were purchasable but inert now work for builds that already bought
them. Bisected on the idle Generalist (2 sim-h, 6 seeds): before 64, 64, 64, 73, 77, 69 (mean 68.5); after 69, 78, 69,
74, 74, 74 (mean 73.0, +6.6%). Without Targeting Logic: mean 70.7; without Absolute Zero's boss clocks, seed 1 returns
to 64. The fourth Extra Barrels rank and the Unstable Isotope / Meteor Round fixes changed nothing measurable for this
agent. About one boon's worth, and no row that passed before fails, so neither was softened.

## 8. Gates

| gate | result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npm run lint` | 0 errors, 11 warnings (10 enemy-shield writes, pre-existing; `core/types.ts` 733 lines, owned by the reachability work) |
| `npx vitest run` | 87 files, 997 tests, all pass (new: `tests/audit/dead-nodes`, `effects`, `boss-counters`, 53 tests) |
| `npm run build` | ok |
| `npm run e2e` | all PASS, zero console errors (first try) |
| `npm run audio:check` | not run for this audit (known 1 ms timing failure on this container) |

## 9. Open

| item | status | why / plan |
| --- | --- | --- |
| Codex milestone palettes (`meta.palettes`) | **Not implemented** | Unlocked at 10 / 25 / 50 entries but nothing renders them. No in-game text promises them (design §16 and the codex.ts comment did; the comment now says so). A real swap needs a renderer theme and a Settings picker (render + UI, a design call on the palettes); out of this audit's files. Milestones' real effect, +25% draft weight per milestone for Rare / Paradox / Cursed Anomalies, is Verified. |
| Offline estimate in the UI | follow-up | `src/ui/format.ts offlineEstimate` mirrors the old boolean Long Patrol rule, so the "welcome back" estimate shows the rank-4 figure for ranks 1–3 (the Scrap credited is right). It should take `offline.cap_hours` / `offline.efficiency` from UiState stats; `src/ui/offline.ts` says "(24 with Long Patrol)", true at rank 4. UI files belong to the reachability work. |
| 15 unread base-stats constants | informational | Listed in §1; each matches its text today, but retuning the data would do nothing. Wire them when those numbers are next tuned. |
| Boons' `mul` convention | by design | Boon stat surges and trades are additive with upgrade ranks ("adds to the Caliber bonus, like about three ranks", `docs/BOONS.md`); the Boon cap row is tuned on that. Only Frame and Anomaly penalties moved to `@final`. |
| Claims verified by reading only | noted | Rows whose evidence is "code" (some Linkages and Infusions) have no test asserting their exact numbers; `tests/systems/linkages` checks all 25 are inert without rank and need both halves. |
| Borrowed Blade upgrades | not this audit | Effect verified; reachability fixed by the parallel review (`REACHABILITY.md`). |
