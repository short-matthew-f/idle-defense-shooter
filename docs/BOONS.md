# Boons

Attempt-scoped rewards. Anomalies last the whole Prestige and Scrap upgrades survive death, so nothing
used to change between two attempts at the same wall. Boons fill that gap: small, sharp, temporary
rewards the player picks, sized at about one to three Scrap-upgrade ranks, that last only until the
attempt ends. Waves are fixed per Prestige seed, so a boon is a way to answer what you know is coming.

The game never picks a boon for you.

| Where | What |
| --- | --- |
| `src/sim/data/boons.ts` | the 36 boons, `BOON_TUNING` (every number), `BOON_CAP` (4), `BOON_QUEUE_CAP` (3) |
| `src/sim/run/boons.ts` | offers (roll, open, queue), pick / reroll / decline, lifetime (`clearBoons`) |
| `src/sim/systems/boons.ts` | the mechanical boons (registered after Anomalies in `systems/index.ts`) |
| `src/sim/core/stats.ts` | stat boons: `build.boons` resolve at rank 1, next to the Anomalies |
| `src/ui/boons.ts`, `src/styles/boons.css` | offer card, "Boon ready" chip, active row, Build section |
| `tests/core/boons.test.ts`, `tests/ui/boons.test.ts` | sim and UI tests |
| `sim-cli/acceptance.ts` (`testBoonCap`) | the Boon cap acceptance row |

## When offers happen

- **Start of an attempt**, except the very first attempt of a Prestige: after a death, after
  `restart_checkpoint` and after the end of a Trial. A retry never starts weaker than the run before it.
  Loading a save is **not** a new attempt for boons (see Lifetime): it opens no offer.
- **Every boss the tower clears** during an attempt, in Push. (Attempts start after the last cleared
  boss, so in practice this is always a boss's first clear.)
- **Not in Patrol.** No offers open there, but boons already active keep working.
- The **first offer of a Prestige** draws only stat surges (and so do its rerolls).
- A boss cleared while an offer is still pending **merges** into it (UX Phase 1: never two offers in a
  row). The pending cards stand for that boss too; nothing is queued and nothing is picked
  (`Ev.BoonOffer` src `merged`, c = the boss wave). A queue an older save carried still drains, oldest
  first, as each offer resolves.
- An offer **waits indefinitely**. Nothing times it out and nothing auto-picks it.
- **Boss-clear hold.** After a boss clear opens a decision (a boon offer and/or an Anomaly draft), the run
  stays in `between` while one is pending, at most 15 s of sim time from the clear (`BOSS_HOLD_TICKS`,
  `run/machine.ts`). `release_hold` (the UI's "Later") ends it early and leaves the decision pending;
  resolving every pending decision ends it too. Patrol never holds. `UiState.run.holdTicksLeft` is the
  ticks left (0 = none). Not saved: a reload resumes in `between` without it. Headless agents decide on the
  next tick, so they spend at most the clear tick itself held.

## The offer

Three cards, a pure function of (Prestige seed, wave, attempt index, reroll count, build) plus the
offer kind (start or boss), so the simulator and the tests reproduce every offer:

- weighted by rarity (common 3, rare 1.5) and toward the build: a boon whose `needs` the build has
  weighs 4, a boon with no needs 2, a boon that needs something the build lacks 0.5;
- at most one of the three needs something the build lacks;
- never a boon that is already active, never a Second Chance already used this attempt;
- never three of one category while another category is still available;
- never a boon the unlock ladder has not revealed (below).

`needs` are a hardpoint or an element (mounted or attuned), or `fusion` (any Fusion active).

### Ladder (UX Phase 1)

Offers, rerolls and Anomaly drafts never name something the player has not been shown
(`run/reveal.ts`). An item is withheld (weight 0) when

- its `reveal` lists `abilities` and abilities are not revealed yet: best wave cleared
  (`max(meta.deepestEver, run.deepestCleared)`) below `ABILITIES_REVEAL_WAVE` (12) and no Prestige. This is
  the unlock ladder's `abilities` rung; `src/sim/data/content-pool.ts` holds the number and
  `src/ui/progression.ts` reads it from there. Gated boons: Quick Hands, Deep Reserves, Reckless,
  Overclocked. Gated Anomalies: Overcharged Capacitor, Second Opinion, Feedback Loop.
- its `needs` or `reveal` lists an element or hardpoint outside the content pool at the current Prestige
  count that the build does not own (`CONTENT_POOL`, now in `src/sim/data/content-pool.ts` and re-exported
  by `src/ui/progression.ts`). Example: Frostbite and Cold Iron before the first Prestige; Borrowed Blade
  (`reveal: ['blade']`) before Prestige 2.

The sim cannot see the UI's "Unlock everything" preference, so that switch does not open these gates.

## Actions

Only three commands exist, and only the player may send them:

| Command | Effect |
| --- | --- |
| `pick_boon { boon, replace? }` | activates the boon. At the cap of 4, `replace` (an active boon) or else the oldest is dropped. The first pick of each boon records a Codex entry `boon.<id>`. |
| `reroll_boon` | three new cards for 1 Core, then 2 for a second reroll of the same offer, and so on. |
| `decline_boon` | free, gives nothing. |

Directives, Autocast and the Upgrade Queue can never pick, reroll or decline:
`World.enqueueCommand` drops the three commands, `Sim.step` filters them out of the in-sim queue, and
`run/validate.ts` rejects any carrying `viaDirective` or `directive` ("Boons are picked by the player only").
Other rejections: "No boon offer pending", "That boon is not on offer", "That boon is already active",
"The boon to replace is not active", "Not enough Cores (reroll costs N)", "Second Chance is used up for
this attempt".

## Lifetime

- Active boons, any pending offer and the queue are **cleared when a new attempt starts** (then that
  attempt's start offer opens), on **Prestige**, on **Ascension**, and on **Trial start and end** (the
  parked run comes back without its old offer and gets a fresh start offer).
- **A reload is not a death** (UX Phase 1). A save stores the active list, the used-up one-use boons
  (`boonSpent`) and a pending offer (with its queue and paid rerolls). Loading keeps all of them and
  opens no new offer, so a reload neither costs the attempt's boons nor grants or rerolls an offer. A save
  taken while the tower was dead (`RunSave.attemptEnded`) loads as that death: boons cleared, start offer.
- **One-use boons.** Second Chance and Windfall leave the active list (freeing the slot) once they
  fire. Second Chance is then gone for the rest of the attempt (`run.boonSpent`); Windfall may be
  offered and picked again.

## The boons

Numbers are `BOON_TUNING` after the balance pass below; "brief" marks where the first design numbers
were cut because the Boon cap measured them over +10%.

### Stat surges (12) · shape ▲

| Boon | Rarity | Effect |
| --- | --- | --- |
| Hot Barrel (id `overcharge`) | common | +25% primary damage |
| Hair Trigger | common | +20% primary attack speed |
| Long Sight | common | +25% primary range |
| Thick Plating | common | +20% max HP (brief +30%) |
| Ablative Shell | rare | a shield worth 12% of max HP; refills between waves, recharges after 3 s without damage |
| Second Wind | common | +6% of max HP healed between waves, 25% → 31% (brief +25%) |
| Scrap Magnet | common | +15% Scrap (brief +25%) |
| Quick Hands | common | tactical abilities cost 25% less CE |
| Deep Reserves | common | +50 CE cap |
| Lucky Streak | rare | +10% primary crit chance |
| Heavy Hits | common | primary crit multiplier +0.2, ×1.5 → ×1.7 (brief +0.3) |
| Iron Skin | common | +10 armor (9.1% less damage with no other armor) |

### Behavior twists (12) · shape: loop

| Boon | Rarity | Needs | Effect |
| --- | --- | --- | --- |
| Encore | rare | a Fusion | the first Fusion reaction each wave fires again 0.5 s later: an 80-unit blast of the same damage (at least 3× primary damage) |
| Forked Arc | common | — | primary crits arc to one more enemy within 120 units for 50% of the hit |
| Ricochet Rounds | common | — | a primary shot that kills flies on to the nearest enemy within 100 units for 50% of its damage |
| Volatile Kills | rare | — | enemies explode on death for 15% of their max HP in a 60-unit blast |
| Static Field | common | Lightning | lightning hits leave a 40-unit field for 2 s at 25% of the hit per second (one per 0.5 s) |
| Frostbite | common | Frost | every Chill applied adds 1 extra stack |
| Wildfire Seed | common | Fire | a burning enemy that dies passes 1 Burn stack (3 s) to one enemy within 80 units (brief: 2 enemies, 4 s) |
| Toxic Bloom | common | Poison | a poisoned enemy that dies leaves a 50-unit cloud for 3 s at 8% of its max HP per second |
| Rally Drones | common | Drones | after any kill, drones fire 40% faster for 2 s |
| Sharpened Edge | common | Orbital Blade | +30% blade damage to elites and bosses |
| Focus Beam | common | Laser | laser damage on an enemy grows 10% per second of contact, up to +50% |
| Anchor Well | common | Gravitics | the first gravity well each wave lasts 2× as long |

### Trades (8) · shape: balance

| Boon | Rarity | Effect |
| --- | --- | --- |
| Glass Hour | rare | +15% damage from every source; between-wave healing halved (brief +50%) |
| Berserk | common | +40% attack speed for every weapon; −25% max HP |
| Miser | common | +60% Scrap; −15% damage |
| Reckless | common | abilities cost 40% less CE; cooldowns 30% longer |
| Bulwark | common | +50% max HP; −15% attack speed |
| Slow and Sure | common | +15% damage; −15% attack speed (first draft +20% / −20%) |
| Overclocked | rare | hardpoint and ability cooldowns −15%; the tower takes 20% more damage |
| Hunter's Gambit | rare | +40% damage to bosses; −20% to every other enemy |

### Wild cards (4) · shape: spark

| Boon | Rarity | Effect |
| --- | --- | --- |
| Stopwatch | common | enemies move 10% slower (stacks with Chill; a stronger field slow such as Time Field replaces it) |
| Second Chance | rare | once per attempt, a lethal blow leaves the tower at 1 HP with 3 s of invulnerability |
| Windfall | common | the next boss kill drops 1 extra Core |
| Trophy Hunter | rare | each elite or boss kill adds +0.5% damage for the rest of the attempt, up to +5% (first draft +1% / +10%) |

Encore is the brief's "Echo Chamber", renamed so it does not read as Echoes, the Prestige currency.
Trophy Hunter is the fourth wild card.

## How it works in the sim

- `build.boons: BoonId[]` (oldest first) is additive on `BuildState` and saved in `RunSave.build`;
  the offer bookkeeping (`boonOffer`, `boonOfferWave`, `boonOfferKind`, `boonOfferSeq`, `boonRerolls`,
  `boonQueue`, `boonsSeenFirst`, `boonSpent`, `attemptEnded`) is optional in `RunSave` and sanitized on load (unknown ids and
  duplicates dropped, at most 4 active and 3 queued, numbers made finite).
- Stat boons carry `effects` and resolve in `StatResolver` at rank 1 (a `mul` effect adds to the key's
  multiplier sum, exactly like an upgrade rank). Two keys exist only for boons:
  `bastion.shield_hp_frac` (Ablative Shell) and `bastion.damage_taken_mul` (Overclocked).
- Mechanical boons carry `flag` and live in `systems/boons.ts`. They use World methods with causes,
  no randomness and no wall clock, and every firing emits `Ev.Anomaly` with src `boon.<id>` (the
  Inspector reads it as "the Volatile Kills boon", the Codex records `boon.<id>`). Channels they use:
  `World.deathGuard` (Second Chance, read by `damageTower`), `signals.droneRateMul` (Rally Drones,
  read by drones.ts), `signals.wellLifeMul` (Anchor Well, read by gravitics.ts), `World.dynamicPowerMul`
  (Trophy Hunter, composed), `fieldSlow` (Stopwatch).
- Events: `Ev.BoonOffer` (src `start` / `boss` / `reroll` / `merged`, a = offer sequence, b = rerolls) and
  `Ev.BoonPicked` (src = boon id or `decline`, a = active count, b = dropped index or −1).
- UiState: `run.boonOffer`, `run.boonOfferKind`, `run.boonOfferSeq`, `run.boons`, `run.boonQueueLength`,
  `run.boonCap`, `run.boonRerollCost`, `run.holdTicksLeft`.
- Presentation only (no effect on the sim hash): a soft two-note chime when a new offer appears and a
  pluck on a pick (`audio/sfx/meta.ts`, `boon_offer` / `boon_pick`); while boons are active the tower
  shows a faint gold halo and one orbiting pip per boon (`core/snapshot-tower.ts`).

## The UI

- **Offer card** on Battle: non-blocking, over the arena above the ability buttons and clear of the tab
  bar. Three mini-cards (category shape and label, name, one line with the numbers, a rarity tag for
  rares and a "needs" tag). The first tap selects a card and shows its full description; **Take**
  confirms, so a tap meant for the arena never picks by accident. At the cap the card says which boon
  goes ("Replace the oldest: Iron Skin") and **Change** chooses another. Reroll (Cores) and Decline sit
  beside Take; the chevron sets the offer aside as a pulsing **Boon ready** chip under the top bar.
  Resting height is about a third of the arena (measured 28% at 390×844, 33% at 360×740, 35% at
  844×390 landscape, 22% on desktop 1280×800); a selected card adds its full description while you
  decide (up to about 42%). Landscape phones place it bottom-right with icon buttons.
- **Active row**: one category icon per boon and "n/4" under the top bar (the top bar stays two rows);
  tap for the list with descriptions.
- **Build tab**: an "Active boons" section (and the waiting offer), and a "!" badge while an offer is
  pending.
- **Codex**: a "Boons" group, one entry per boon.

## Adding a boon

1. Add the id to `BoonId` in `src/sim/core/ids.ts`.
2. Add its numbers to `BOON_TUNING` and its `BoonDef` to `BOONS` in `src/sim/data/boons.ts`: category,
   rarity, `value` (1–5, the headless agents' pick heuristic), optional `needs`, and a `desc` and a
   `short` (≤ 34 characters) built from the tuning numbers.
3. A stat boon needs only `effects` (existing stat keys; add a base to `data/base-stats.ts` if the key is
   new, with a default that changes nothing, and read it where it matters). A mechanical boon sets
   `flag: '<id>'` and gets a branch in `systems/boons.ts`: read the flag in `rebuild`, act through World
   methods with a cause, and `fire()` an `Ev.Anomaly` with its `boon.<id>` tag.
4. Tests: a stat row in "stat boons change stats.get as described" or a scenario in "every mechanical
   boon fires its event" (`tests/core/boons.test.ts`); the content test counts the categories.
5. Run `npm run sim -- --boon-cap` (about 3 minutes on 4 cores) and keep the new boon under +10%.

## Measured effect (the Boon cap)

`npm run sim -- --boon-cap` (or the row in `npm run sim:accept`): the idle Generalist for 2 sim-hours
on seeds 1 and 2, once declining every offer (baseline) and once per boon with that boon injected into
every offer and picked; while it is active further offers are declined, so it is measured alone.
Pass when no boon raises the mean deepest wave by more than 10%. Quick mode (`--quick`, 1 sim-hour)
forces the six boons that read highest here (`QUICK_BOONS`). `--force-boon <id>` and `--no-boons` do
the same for any run; without them every agent picks by `boonScore` (a boon whose needs the build meets
first, then the highest declared `value`).

How to read it: the deepest wave at a fixed horizon moves in whole walls. Seed 1 sits at a wall at
wave 53–55, seed 2 between 58 and 64, and almost any perturbation lifts seed 2 from 58 to 64. The
**noise floor** is the raise of boons that do nothing for the Generalist's build (Anchor Well, Focus
Beam, Static Field, Toxic Bloom: +5.4%). So a boon at +5.4% is indistinguishable from none; the cap
effectively asks that no single boon breaks seed 1's wave-55 wall inside 2 hours.

Final measurement (after tuning), baseline depth 55.5 (53 and 58). **PASS: max +8.1% (Rally Drones).**

| Boon | Seed 1 | Seed 2 | Mean | Raise |
| --- | --- | --- | --- | --- |
| Rally Drones | 56 | 64 | 60.0 | +8.1% |
| Glass Hour | 54 | 65 | 59.5 | +7.2% |
| Slow and Sure | 55 | 64 | 59.5 | +7.2% |
| Forked Arc | 54 | 64 | 59.0 | +6.3% |
| Hair Trigger | 54 | 64 | 59.0 | +6.3% |
| Heavy Hits | 54 | 64 | 59.0 | +6.3% |
| Iron Skin | 54 | 64 | 59.0 | +6.3% |
| Ricochet Rounds | 54 | 64 | 59.0 | +6.3% |
| Scrap Magnet | 54 | 64 | 59.0 | +6.3% |
| Second Wind | 54 | 64 | 59.0 | +6.3% |
| Stopwatch | 54 | 64 | 59.0 | +6.3% |
| Thick Plating | 54 | 64 | 59.0 | +6.3% |
| Trophy Hunter | 54 | 64 | 59.0 | +6.3% |
| Volatile Kills | 54 | 64 | 59.0 | +6.3% |
| Anchor Well | 53 | 64 | 58.5 | +5.4% |
| Berserk | 53 | 64 | 58.5 | +5.4% |
| Deep Reserves | 53 | 64 | 58.5 | +5.4% |
| Focus Beam | 53 | 64 | 58.5 | +5.4% |
| Frostbite | 53 | 64 | 58.5 | +5.4% |
| Hot Barrel | 53 | 64 | 58.5 | +5.4% |
| Overclocked | 53 | 64 | 58.5 | +5.4% |
| Quick Hands | 53 | 64 | 58.5 | +5.4% |
| Reckless | 53 | 64 | 58.5 | +5.4% |
| Second Chance | 53 | 64 | 58.5 | +5.4% |
| Sharpened Edge | 53 | 64 | 58.5 | +5.4% |
| Static Field | 53 | 64 | 58.5 | +5.4% |
| Toxic Bloom | 53 | 64 | 58.5 | +5.4% |
| Windfall | 53 | 64 | 58.5 | +5.4% |
| Wildfire Seed | 53 | 61 | 57.0 | +2.7% |
| Bulwark | 52 | 59 | 55.5 | +0.0% |
| Lucky Streak | 53 | 58 | 55.5 | +0.0% |
| Ablative Shell | 53 | 56 | 54.5 | −1.8% |
| Encore | 53 | 54 | 53.5 | −3.6% |
| Long Sight | 53 | 53 | 53.0 | −4.5% |
| Miser | 52 | 50 | 51.0 | −8.1% |
| Hunter's Gambit | 49 | 47 | 48.0 | −13.5% |

The balance pass, with the brief's numbers as the starting point (each row is the mean raise over the
two seeds):

| Boon | Brief | Measured | Tried | Measured | Final | Measured |
| --- | --- | --- | --- | --- | --- | --- |
| Glass Hour | +50% damage | +32.4% | +15% | +7.2% (+20%: +19.8%) | +15% | +7.2% |
| Trophy Hunter | +1% / kill, max +10% | +18.0% | +0.5%, max +5% | +6.3% | same | +6.3% |
| Second Wind | +25% heal | +15.3% | +10% | +12.6% | +6% | +6.3% |
| Slow and Sure | +20% / −20% | +15.3% | +12% / −20% | −83.8% (stuck at wave 9) | +15% / −15% | +7.2% |
| Wildfire Seed | 1 stack → 2 enemies, 4 s | +15.3% | → 1 enemy, 3 s | +2.7% | same | +2.7% |
| Thick Plating | +30% max HP | +13.5% | +15% | +6.3% | +20% | +6.3% |
| Scrap Magnet | +25% Scrap | +12.6% | +12% | +5.4% | +15% | +6.3% |
| Heavy Hits | +0.3 crit multiplier | +11.7% | +0.15 | +5.4% | +0.2 | +6.3% |

Slow and Sure at +12% / −20% is a net loss of primary DPS before the first upgrades: forced at every
offer, the idle Generalist never got past wave 9. A trade must never be a trap at the start of a run,
hence the even +15% / −15%.

Hunter's Gambit and Miser read negative for the idle Generalist by design: the Gambit costs damage
on every non-boss wave, and Miser trades damage for Scrap the fixed horizon cannot spend in time.

## Effect on the other acceptance rows

Full `npm run sim:accept` (seeds 1–3, 4 sim-h), three ways: HEAD without the feature, this code with
every agent declining every offer (`--no-boons`, a diagnostic), and this code with the agents picking
by `boonScore`. The definitions of the other rows are unchanged.

| Row | HEAD (no boons) | Boons declined | Boons picked |
| --- | --- | --- | --- |
| Checkpoint odds | FAIL 32 / 47 / 59% | same | FAIL 42 / 50 / 63% |
| Checkpoint time | FAIL 6.6 min | same | FAIL 7.6 min |
| First wall | FAIL 53, 64, 64 | same | FAIL 64, 69, 69 |
| Reclimb | FAIL 33%, 5% | same | FAIL 12%, 11% |
| Push | FAIL +26, +0 | same | FAIL +15, +0 |
| Forecast | PASS 0% off | same | PASS 0% off |
| Build health | FAIL worst 65% | same | FAIL worst 42.5% (hp_laser) |
| Doctrine health | FAIL worst 48.7% | same | FAIL worst 68.6% |
| Spend efficiency | FAIL 11 offenders | 12 | FAIL 11 |
| Defense | PASS 126% | same | PASS 117% |
| Active edge | FAIL 21.5% fewer attempts | same | FAIL 29.6% |
| Directive gap | **PASS** closes 64.7% | same | **FAIL** closes 30% |
| Formation fairness | FAIL 29/144 (×2.4) | 50/168 (×3.1)* | FAIL 50/168 (×3.1) |
| Anomaly cap | **PASS** max +14% | PASS +17.5% | **FAIL** +26.4% (Glass Cannon) |
| Offline | PASS | same | PASS |
| Determinism | PASS | PASS | PASS |

\* The Difficulty grid's climbs pick boons even under `--no-boons` (they bypass the acceptance plan).

Declined, the feature is neutral: every row the plan controls reproduces HEAD exactly. Picked, boons
make every agent reach deeper sooner (first wall 64 → 69) and two rows flip. Directive gap: boons
help the active policy most (attempts idle 158 → 133, directive 136 → 121, active 124 → 93), so the
directive policy now closes 30% of a larger gap. Anomaly cap: its baseline rose from depth 19 to 24 in
the 40-minute window, and Glass Cannon (+50% damage) now stacks with damage boons (+26%). Neither
definition was changed.
