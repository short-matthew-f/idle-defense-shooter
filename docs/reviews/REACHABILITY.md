# Project Citadel: UI reachability

Sep 30, 2026 · build `4d929c9` + this pass (uncommitted)

**The bug class.** The sim grants a capability or a decision and the phone UI has no control that reaches it (the
first instance: Borrowed Blade promised base blade upgrades that the Upgrades tab could not show). This review walks
every `Command`, every content item that grants a capability or a decision, and every `UiState` field, from the sim
to a control a player can reach on a phone (tabs Battle · Upgrades · Build · Prestige · More), and fixes each gap.

Checked in Chromium (Playwright, SwiftShader) with touch at 390×844, 360×740 and landscape 844×390, from saves built
with the headless sim (Spare Barrel, Dual Doctrine, Third Tactical Slot + Command capstone, Second Opinion, Hive with
Recursive Warhead, Automation with a full Blueprint slot). Screenshots: session scratchpad `reach/`.

**Status:** **Verified** (a control exists and works), **Fixed** (was a gap; fixed in this pass), **Internal** (no
player control by design), **Open** (left, with the reason).

## Summary

| Area | Items | Verified | Fixed | Internal | Open |
| --- | ---: | ---: | ---: | ---: | ---: |
| Commands (§1) | 34 | 26 | 6 | 2 | – |
| Frames | 9 | 4 | 5 | – | – |
| Anomalies | 25 | 21 | 4 | – | – |
| Boons (6 actions + needs tags) | 7 | 6 | 1 | – | – |
| Trial rewards | 10 | 9 | 1 | – | – |
| Prestige nodes | 38 | 30 | 8 | – | – |
| Constellation and Ascension | 5 | 3 | 2 | – | – |
| Other systems and run controls | 19 | 10 | 9 | – | – |
| UiState fields (top level 24, `run.*` 25, `wave.*` 15) | 64 | 58 | – | 6 | – |
| Cross-cutting (§6) | 4 | – | – | – | 4 |
| **Total** | **215** | **167** | **36** | **8** | **4** |

The seven dead ends in §4 are counted in the rows above. Every Fixed item has a test (§ Regression guard).

## 1. Commands

Every `Command['type']` (core/types.ts) and who sends it. `tests/ui/coverage.test.ts` parses the union and fails
when a type has no sender in `src/ui` / `src/app` (INTERNAL allowlist) or `validate.ts` does not know it.

| Command | Sender | How the player triggers it | Status |
| --- | --- | --- | --- |
| `buy` | ui/shop.ts (Buy buttons, quick chips, Buy all), ui/death.ts | Upgrades: tap a price (hold repeats); death card rows | Verified |
| `buy_cheapest` | ui/shop.ts | Upgrades: a tree's "Spend here" (×1 / ×10 / Max) | Verified |
| `choose_doctrine` | ui/doctrine.ts | Upgrades tree view, Cores → Doctrines, Build → Doctrines row → fork. `second: true` for "Choose as 2nd" / "Replace 2nd" | **Fixed** (never sent `second`) |
| `clear_second_doctrine` | ui/doctrine.ts | Fork: "Clear 2nd" on the second card (1 Core, checkpoint) | **Fixed** (new) |
| `mount_hardpoint` / `attune` | ui/shop.ts `slotPicker` | Upgrades slot chip; Build → Mount / Attune | Verified; picker **Fixed** (Frame free mount / Trial rules) |
| `refit_hardpoint` | ui/shop.ts `refitPicker` | Cores → Refit; hardpoint tree; Build | Verified; picker **Fixed** |
| `pick_anomaly` / `reroll_anomaly` | ui/draft.ts | Draft modal (Pick, Skip +1 Core, Reroll 1 Core; Later → Build) | Verified |
| `pick_boon` / `reroll_boon` / `decline_boon` | ui/boons.ts | Boon card on Battle (Take, Replace at the cap, Reroll, Decline) | Verified |
| `set_mode` | ui/hud.ts, ui/index.ts | Battle "Push / Patrol" chip; key P | Verified |
| `restart_checkpoint` | ui/hud.ts | Battle restart chip (confirm) | Verified |
| `set_speed` | ui/hud.ts | Battle speed chip (shown when `speedAllowed` > 1) | Verified |
| `designate_at` | ui/arming.ts | Tap an enemy (idle). Without a slot the sim now picks it: fill 0, then 1, replace the older; a tap on a designated enemy clears it | **Fixed** (second designator + clear) |
| `designate` | directives/engine.ts, run/commands.ts | – | Internal: Directives (`viaDirective`); the sim routes `designate_at` through it |
| `manual_aim` | app/game.ts | Hold on the field | Verified |
| `cast` | ui/arming.ts | Tap an ability (self casts; point / enemy arms, then tap the field); keys 1–4 | Verified (slots 3–4 **Fixed**) |
| `set_ability_slot` | ui/abilities.ts | Tap an empty slot, hold a slot, Build → Choose / Change, boss-tell "equip" | Verified |
| `set_targeting` | ui/directives.ts | More → Automation → Targeting | Verified; list **Fixed** (Frame / borrowed systems) |
| `prestige` | ui/prestige.ts | Prestige → Forecast → Prestige… (Frame, Blueprint, Threat Dial, Keepsake, Branch Discount) | Verified; modal **Fixed** (locked Frames, caps, Trial guard) |
| `ascend` | ui/constellation.ts | Prestige → Ascension → Ascend… (after wave 100) | Verified |
| `buy_prestige` | ui/prestige-shop.ts | Prestige → Upgrades | Verified |
| `buy_star` | ui/constellation.ts | Prestige → Ascension: tap a star, Buy | Verified; region lock **Fixed** |
| `set_directives` | ui/directives.ts | More → Automation → Directives (Save) | Verified |
| `set_upgrade_queue` | ui/directives.ts | More → Automation → Upgrade Queue (Save queue) | Verified |
| `save_blueprint` | ui/directives.ts | More → Automation → Blueprints (Save, Overwrite) | Verified; full-slot dead end **Fixed** |
| `delete_blueprint` | ui/directives.ts | Blueprints: trash button (confirm) | **Fixed** (new) |
| `start_trial` / `end_trial` | ui/trials.ts, ui/hud.ts | More → Trials; Battle trial banner "End" | Verified |
| `set_threat_dial` | ui/build.ts | Build → Threat Dial → Lower… (slider, lower only) | **Fixed** (no sender) |
| `offline_return` | app/game.ts | Automatic on return (cold start and tab visible again) | Internal (automatic) |
| `set_setting` | ui/settings.ts, ui/build.ts | Settings: Clarity, Auto-Prestige; Build → Abilities: Auto on/off (`autocastOff`) | Verified; `autocastOff` **Fixed** (new key) |

## 2. Capabilities and decisions

### Frames (9)

Chosen in the Prestige modal (Prestige → Forecast → Prestige…). Locked Frames were invisible, so their unlock paths
could not be seen: they are now listed, disabled, with `Unlock: …` (ui/prestige.ts `locked.map`).

| Frame | Unlock → where it shows | Its capability → control | Status |
| --- | --- | --- | --- |
| Standard | always | – | Verified |
| Arsenal, Conductor | Prestige II "Frames" | traits automatic (prices, statuses, Fusion rank) | Verified |
| Monolith | Trial Bare Metal (tier 1) | second Barrel Doctrine, full strength → fork "Choose as 2nd · full strength" | **Fixed** |
| Hive | Trial Hive Mind | Drones free: Upgrades chip "Drones · Frame", Build row, Targeting row; never offered in slot / Refit pickers | **Fixed** (picker offered Drones → "Already mounted"; Build drew a slot row that never opened) |
| Bulwark | Trial Siege Mentality | second Bastion Doctrine, full strength → fork | **Fixed** |
| Echo Engine | Ascension I | automatic | Verified |
| Prism | Ascension III | Laser free (same as Hive) | **Fixed** |
| Singularity Core | Ascension V | second Doctrine in every tree at 60% → every fork | **Fixed** |

Frame caps in Build and the Prestige modal now include Expanded Frame, Third Attunement and Trial rules
(`UiState.slotCaps`, `frameCapsText`).

### Anomalies (25)

Offered in the draft (Pick / Skip / Reroll / Later; replace at full sockets). The replace dialog now says what a
capability Anomaly takes with it (`replaceLoss`). "Needs X" tags counted only slotted systems: a Frame free mount or a
Borrowed Blade now counts (`draft.ts:23`).

| Anomaly | What it lets the player do → where | Status |
| --- | --- | --- |
| Spare Barrel | a second Barrel Doctrine at 50% → Ballistics fork "Choose as 2nd · 50%"; Build row "Choose 2nd" | **Fixed** |
| Borrowed Blade | base blade nodes → Upgrades "Orbital Blade · borrowed"; mount it into a slot to open the whole tree (the sim refused: "Already mounted") | **Fixed** (mount); chip Verified (earlier pass) |
| Recursive Warhead | Cluster Warheads free → the Ordnance Exotic says it is already granted (buying it added nothing) | **Fixed** |
| Second Opinion | two designators → tap two enemies; HUD "2/2 designated" | **Fixed** |
| Loaded Dice, Seventh Shot, Mirror Node, Pinball, Stormglass, Clockwork Blade, Ghost Protocol, Rogue Moon, Cold Iron, Heavy Water, Overcharged Capacitor, Glass Cannon, Unstable Isotope, Tithe, Hungry Core, Afterimage Round, Echo Chamber, Feedback Loop, Rot Bloom, Smolder, Martyr Plating | automatic rule / stat changes; nothing to control | Verified (21) |

### Boons (36)

Offer card on Battle (start of an attempt, boss first clears; queued offers "+N"), Take, Replace at the cap (oldest
by default or a chosen one), Reroll (Cores), Decline, active list (row under the top bar, Build → Boons). All
Verified (tests/ui/boons.test.ts, e2e). "Needs" tags now count Frame / borrowed systems (`needsBuild`).

### Trials (10)

More → Trials: Start (confirm), End (Trials list or the Battle banner), tier pips W30 / W60 / W90. The reward line now
says it is earned at the first tier (wave 30).

| Trial reward | Where the player uses it | Status |
| --- | --- | --- |
| Bare Metal → Monolith, Hive Mind → Hive, Siege Mentality → Bulwark | Prestige modal Frame cards | Verified |
| Commander → a permanent second designator | taps + HUD chip | **Fixed** |
| Monochrome, Blackout, Scatter, Swarmstorm, Poverty, Pacifist Core (Rot pool) | automatic (stats, prices, draft pool) | Verified |

Trial rules: the slot pickers no longer offer systems a Trial forbids (`UiState.mountBlocked`); a Prestige during a
Trial now explains instead of opening a modal the sim refuses.

### Prestige nodes (38)

| Node | Automatic, or the control | Status |
| --- | --- | --- |
| Seed Capital, Memory of Steel, Memory of Motion, Boss Bounty, Checkpoint Dividend, Scrap Resonance, Hardened Core | automatic | Verified |
| Accelerated Clearing | automatic speed at wave start; the speed chip shows (and can lower) it | Verified |
| Frames | Prestige modal Frame cards | Verified (list **Fixed**) |
| Blueprint Slots | More → Automation → Blueprints: save, overwrite, delete; load in the Prestige modal | **Fixed** (delete; full slots were a dead end: "the sim decides which it replaces" but the sim refused) |
| Weapon Seed, Elemental Memory, Early Hardpoints | automatic; Build slot rows say when slots open | Verified |
| Third Attunement, Expanded Frame | automatic caps; Build and Prestige modal now show them | **Fixed** (display) |
| Keepsake | Prestige modal picker (socketed Anomalies) | Verified |
| Anomaly Socket | automatic (Build shows sockets) | Verified |
| Branch Discount | Prestige modal tree picker; prices | Verified |
| Autocast | Build → Abilities: "Auto on / off" per ability (`meta.settings.autocastOff`) | **Fixed** (always on, no control) |
| Trials | More → Trials | Verified |
| Directives | More → Automation (Directives, Targeting, Upgrade Queue) | Verified |
| Third Tactical Slot | a third ability button, Build row, toast | **Fixed** |
| Threat Dial | Prestige modal slider (0–10, 0–20 from Ascension IV); mid-run Build → Threat Dial → Lower… | **Fixed** (mid-run lowering had no control) |
| Directive Tuning | automatic; Directives text shows the real delay | **Fixed** (text said 0.6 s always) |
| Long Patrol | automatic (offline) | Verified |
| Speed Controls | Battle speed chip | Verified |
| Dual Doctrine | fork "Choose as 2nd · 60%" on the first tree that takes one; "Clear 2nd" moves it; Prestige modal note | **Fixed** |
| Duplication, Double Launch, Conscription, Overflow, Reversal, Ghost Edges, Critical Relay, Held Open, Relay Fire, Paradox Pool | automatic | Verified |
| Autonomy | Directives: Prestige action and Adept conditions; Settings → Auto-Prestige; a Prestige rule now warns while Auto-Prestige is off | Verified (warning **Fixed**) |

### Constellation and Ascension

| Item | Control | Status |
| --- | --- | --- |
| Majors, Bridges, Minors | Prestige → Ascension: tap a star, Buy (Bridges need both Majors) | Verified |
| Regions | a node's region opens at Ascension region + 1; the detail now says "Region revealed at Ascension N" and Buy is disabled | **Fixed** |
| Respec | automatic at Ascend (refund); the Ascend confirm now says so | **Fixed** (text) |
| Ascend | Ascend… button after wave 100 (a Trial refuses with a toast) | Verified |
| Ascension unlocks (Echo Engine, 5th socket, Echo pool, Triads, Fusion Apex, Prism, formations, Threat Dial 20, Singularity Core, Deep Waves) | automatic; Frames in the Prestige modal, Triads under Cross → Fusions, dial range in the modal | Verified |

### Other systems

| Item | Control | Status |
| --- | --- | --- |
| Exotics | Cores → Exotics; each tree's Exotic section | Verified |
| Refit | Cores → Refit; hardpoint tree; Build | Verified (picker **Fixed**) |
| Doctrine choose / change (checkpoint rule) | tree fork; Cores → Doctrines; Build row | Verified; second Doctrine **Fixed** |
| Second Doctrine choose / replace / clear | fork cards "Choose as 2nd · N%", "Replace 1st / Replace 2nd", "Clear 2nd"; tags "1st" / "2nd · N%"; Build row shows both | **Fixed** |
| Ability rank nodes | Upgrades → Reactor → "Ability ranks" (were only reachable through quick chips) | **Fixed** |
| Ability slots 3 and 4 | Battle bar (2×2 grid in landscape), Build rows, picker, keys 1–4, toast | **Fixed** |
| Autocast per ability | Build → Abilities | **Fixed** |
| Targeting Profiles | Automation → Targeting: primary, slotted, Frame-mounted and borrowed systems | **Fixed** (missed the last two) |
| Directives editor | every `DirectiveCondition` / `DirectiveAction` variant (Records keyed by the unions: a new variant fails to compile), edit, delete, enable, reorder by arrows on touch (drag on desktop); a rule that can never act now says why | **Fixed** (warnings; editor Verified) |
| Upgrade Queue | Automation → Upgrade Queue: add, max rank, keep-within, reorder, delete, save | Verified (see Open 3) |
| Blueprints | save / overwrite / delete (Automation), load (Prestige modal), slot limit shown | **Fixed** |
| Push / Patrol, restart checkpoint, manual aim, speed | Battle chips; hold on the field | Verified |
| Designation (one or two) | tap an enemy; tap again to clear; HUD chip with two | **Fixed** |
| Offline return | automatic toast | Verified |
| Save export / import / hard reset | More → Settings | Verified |
| Bulk buy, `Later` on drafts | quantity selector, Spend here, Buy all; draft Later → Build | Verified |
| Boss-tell Counters | tell banner (equip / arm); designate tells: re-tapping the designated enemy re-designates instead of clearing | Verified |
| Codex | More → Chain Codex | Verified |
| Free second-Doctrine slot | Build tab badge "+" and death-card suggestion now count it | **Fixed** |

## 3. UiState fields

`tests/ui/coverage.test.ts` parses `UiState` and fails when a field is never read in `src/ui`, `src/app` or
`src/audio`. Unread and allowlisted: `stats` (damage share: a sim-cli / agent metric), `recentEvents` (the UI
consumes event batches), `run.attempts`, `wave.enemiesTotal`, `wave.spawned` (folded into `wave.progress`),
`wave.formation` (informational). New fields: `secondDoctrine`, `abilitySlots`, `designators`, `slotCaps`,
`mountBlocked`.

Data ids: the same test checks a display name / blurb / icon for every tree node, Doctrine and capstone, Fusion,
Linkage, Infusion, Anomaly (rarity label and icon), Boon (category icon and labels), Frame (trait, unlock), Trial,
Prestige node (layer), Constellation node, ability (icon, rank node), enemy, boss, sector, hardpoint, element,
weapon system and targeting profile; and classifies every Prestige node, Anomaly, Frame and Trial reward as automatic
or reached by a named control whose marker must exist in its file.

## 4. States the player cannot enter, and dead ends (all Fixed)

- Hive / Prism: Build drew a hardpoint row for the free mount ("Locked slot: opens deeper in the climb") that never opens.
- Slot and Refit pickers offered the Frame's free mount and Trial-forbidden systems; each Mount failed.
- Blueprint slots full: "The sim decides which Blueprint the new one replaces" → the sim refused ("No free blueprint slot").
- A Directive casting an unslotted ability, or the Prestige action with Auto-Prestige off, never acts and said nothing.
- Dual Doctrine says "At Prestige start, choose one tree": there is no such choice (the first tree that takes a second
  Doctrine gets it). The fork and the Prestige modal now explain it; the node text lives in `src/sim/data/prestige.ts`
  (the effects audit owns it) and should change too.
- With a second Doctrine allowed, the fork's old "Change · 1 Core" button (and its confirm) actually filled the second
  slot for free.
- Prestige during a Trial opened the modal, then the sim refused.

## 5. Decisions

1. **Designating by tap** (`designate_at` without `slot`, run/commands.ts `autoDesignateSlot`): a tap fills slot 0,
   then slot 1 when a second designator exists, and with both filled replaces the older; tapping a designated enemy
   clears it, also with one designator (there was no way to clear one), except while a boss tell asks for a
   designation (re-designating scores the Counter). Explicit `slot` keeps the old behavior.
2. **Second Doctrine change / clear**: both follow the first-Doctrine change rule (1 Core, only at a checkpoint). A
   free clear would make a change free (clear + choose again).
3. **While the second slot is empty the first Doctrine cannot be changed**: `economy/shop.doctrineChoice` routes any
   pick to the empty second slot. The fork offers only "Choose as 2nd" there and the note says so. Changing that rule
   belongs to the economy owner.
4. **Autocast** is switched per ability (the node text says "each tactical ability can be set"), stored as a bitmask
   in `meta.settings.autocastOff` over the ABILITIES data order and sent with the existing `set_setting`; the switch
   lives on the Build screen's ability rows.
5. **Threat Dial lowering** lives on the Build screen (a commitment of this Prestige), with a slider and a warning that
   Echoes then pay at the lower level.
6. **Borrowed Blade** can be mounted into a hardpoint slot; it then is an ordinary mount with its whole tree.
7. **Ability slots** follow the count in `StatResolver.rebuild` (every stat change and every load): grow with empty
   slots; when the count falls, trailing empty slots go and filled ones stay (shown inactive; casting already ignores
   them).
8. **Landscape** abilities anchor bottom-left (a 2×2 grid for 3–4 slots) so the run controls above them can wrap
   (designator chip, trial banner, boon card narrowing the strip) without overlap.
9. **Recursive Warhead**: the Cluster Warheads Exotic stays buyable but says it adds nothing while the Anomaly is
   socketed (buying it keeps the effect after a replace).

## 6. Open

1. **Codex milestone palettes** (`meta.palettes`, 10 / 25 / 50 entries): unlocked by the sim, never usable; the UI never
   mentions them, so it is not a false promise. Needs palette art and renderer support (src/render).
2. **Blueprints** store Frame, mounts, attunements, first Doctrines, Targeting and the Queue, not second Doctrines,
   the ability loadout or Autocast (`Blueprint` schema and `run/prestige.ts applyBlueprint`).
3. **Upgrade Queue** can only add nodes the shop shows now (no pre-planning Doctrine nodes before the fork).
4. `src/sim/core/types.ts` is 733 lines (lint size warning, guideline 700) after the additions.

## Regression guard

- `tests/ui/coverage.test.ts`: Command senders, validate coverage, display names / icons, capability → control table,
  UiState fields.
- `tests/core/reachability.test.ts`: sim support (second Doctrine choose / change / clear and UiState, ability slots on
  rebuild and load, `designate_at` slot choice, Borrowed Blade mount, `mountBlocked` / `slotCaps`, Blueprint delete,
  Autocast off).
- `tests/ui/doctrine.test.ts`: the fork model against a real Sim, rule warnings, Autocast mask, granted Exotic,
  regions, Frame caps, replace warnings.
- `tests/e2e/e2e.mjs` "phone reach": choose a second Doctrine, the third slot appears / is assigned / casts, two
  designations and a clear.
