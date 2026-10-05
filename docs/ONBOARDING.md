# Onboarding

How a new player meets Project Citadel: one decision at a time, a first Prestige at the Frontier (wave ~28), and
one new weapon system or element with each early Prestige. Everything here is UI-side and presentation-only. The
sim accepts any valid command, and nothing here changes balance. Pacing numbers are in `docs/BALANCE.md`
("Onboarding pass").

| Where | What |
| --- | --- |
| `src/ui/progression.ts` | `UNLOCKS` (the unlock ladder), `features()`, `CONTENT_POOL` / `contentPool()` / `poolAllows()` (the content pool), `STARTER_*` |
| `src/ui/coach.ts` | Coach lines: the ladder's `COACH` table, plus one-off lines (`CoachExtra`) after a Prestige |
| `src/ui/starter.ts` | Stage 0: the single Upgrade button (Damage, Fire Rate, Hull) |
| `src/ui/ceremony.ts`, `src/styles/ceremony.css` | The first-Prestige modal, the guided first Echo spend, the post-Prestige coach lines |
| `src/ui/quartermaster.ts` | The Quartermaster card (sim and rules: `docs/QUARTERMASTER.md`) |
| `src/ui/prefs.ts` | Presentation state: `coachSeen`, `tabsVisited`, `contentSeen`, `echoGuide`, `unlockAll` |
| `tests/ui/progression.test.ts`, `tests/ui/onboarding.test.ts` | Ladder, pool, ceremony and feedback tests |

**Rules.** What is revealed or offered comes from progress state every time: the best wave cleared, `prestigeCount`,
and what the player owns or has pending. It is never a stored flag. What a player owns, uses or has pending is never
hidden (a mounted hardpoint, an attuned element, a socketed Anomaly, a draft, a boon offer, a recommended Prestige).
Prefs only record what was *read* or *seen* (coach lines, tabs, "New" tags).

## The unlock ladder

Best wave = `max(meta.deepestEver, run.deepestCleared)`. A first Prestige reveals every feature.

| Stage | Best wave | Features revealed (`UNLOCKS`) |
| --- | --- | --- |
| 0 | 0 | The tower and the single Upgrade button (Damage, Fire Rate, Hull); tap assist |
| 1 | 5 (first boss) | Tab bar; Upgrades tab with every Chassis node; Push / Patrol and Restart; salvage |
| 2 | 6 | Upgrades → Elements (first attunement) |
| 3 | 10 | Build tab; Upgrades → Hardpoints (first hardpoint slot); More tab; **Doctrine forks** (`doctrines` rung, `DOCTRINES_REVEAL_WAVE`: the fork heading, cards, decision row and dot stay hidden below it) |
| 4 | 12 | Ability bar, Command Energy; Overcharge |
| 5 | 15 | Boons and Anomalies on Build (offers and drafts always show); the Suggested line, Buy all, the ×1 → ×10 → Max chip, Spend here |
| 6 | 20 | Prestige tab and Forecast; Upgrades → Cross (Fusions, Linkages, Infusions), shown once the first Cross node can be bought or one is owned; Inspector; Codex |
| 7 | 25, or the first Prestige | Cores; Build → Frame |
| 7 | 30, or the first Prestige | Exotics (the Core-priced upgrades in Upgrades → Cores) |
| 7 | the first Prestige only | More → Automation; More → Trials; the Quartermaster |

**Coach lines** (`COACH`, oldest unread first, at most one new line per wave clear). Phase 2 added: `patrol` (Push vs Patrol),
`doctrines` ("Doctrine fork: pick one path for this tree. You can change it at a checkpoint."), `cross`, `inspector`,
`cores`, `frame` and `exotics`. `checkpoint`, `elements`, `patrol`, `build`, `doctrines`, `abilities` and `cross` are
verb lines (`VERB_COACH`): reading a later line never retires them unseen. `cross` waits for the build (its first node),
so it can arrive after later lines.

**Tap to explain** (`src/ui/info.ts`): any element with `data-info` opens a small info sheet on tap (a long press on
controls that already act on tap). Help's "What is…" list is built from the same table and only names revealed features.

**Echo tiers:** the Prestige shop's Echo upgrades are called Echo tiers I to IV everywhere in the UI (never "Layers");
a tier opens when the deepest wave ever reaches its number (tier I at wave 20), not by Prestige count.

The bulk tools also appear from wave 10 once 12 or more Scrap rows are affordable at once.

## The content pool

Which elements and weapon systems are **offered**, by Prestige count (`CONTENT_POOL`). There is one new system per
early Prestige, and everything is offered from Prestige 4.

| Prestige | Elements offered | Hardpoints offered | New this Prestige | Why here |
| --- | --- | --- | --- | --- |
| 0 | Fire, Lightning, Poison | Ordnance, Drones | (starters) | Three elements for two attunement slots (waves 5, 25): a real choice. One hardpoint slot (wave 10) before the Frontier. |
| 1 | + Frost | | Frost | Adds Superconductivity, Thermal Shock and Cryotoxin. |
| 2 | | + Orbital Blade | Orbital Blade | The second hardpoint slot (wave 30, reachable from P1 on) becomes a choice. |
| 3 | | + Laser Polygon | Laser Polygon | Arrives with the third hardpoint slot (wave 55; P3 reaches ~61). |
| 4 | | + Gravitics | Gravitics | Everything is offered (`POOL_COMPLETE_AT` = 4). |

- **Always offered:** anything owned: attuned, mounted, mounted free by the Frame (Hive, Prism), or borrowed (Borrowed
  Blade). Existing saves keep everything they use; `prestigeCount` decides the rest. A Frame that mounts a system
  for free is a deliberate choice at Prestige, so it counts as owned.
- **Where the pool applies:**
  - the attune and mount pickers (the Upgrades empty-slot rows, Build → Attune / Mount);
  - Refit;
  - the open-slot decisions (the category tab's dot, the empty-slot row's dot and the death-card shortcut show only
    when the pool has something to put in it);
  - Prestige → Blueprint (a Blueprint naming a system the next Prestige does not offer is listed but disabled);
  - Automation → Directives (the "Targeting" action's system list);
  - the Suggested line, Buy all and the death card's purchases;
  - Upgrades → Cross.
- **Fusions, Linkages, Infusions** (`poolAllows`): a Fusion or Triad shows only when **both** (all) of its elements
  are in the pool. A Linkage needs its hardpoints, and an Infusion needs its hardpoint and element. An entry with a
  rank always shows. The sim already lists them only for attuned or mounted parts, and owned parts are always in
  the pool, so this filter is a guard, not a visible change today.
- **Not filtered:** the Codex lists every entry as "???" until discovered, and its Rumours name only attuned or
  mounted parts. Triad hints need Ascension II, long after the pool is complete. Anomaly and Boon cards come from
  the sim and name their needs.
- **"New":** after a Prestige adds a system, one coach line names it ("New: Frost joins your arsenal. Look for the
  New tag when you attune."). In the picker it is listed first with a **New** tag until the picker has shown it once
  (`prefs.contentSeen`). On the first run on a device, whatever the save already offers counts as seen.

## The first Prestige

The first Prestige is a story beat at the Frontier (docs/BALANCE.md). At wave 28, the Forecast recommends it and
names the wall.

1. **Ceremony** (`ceremony.ts`). When `prestigeCount === 0` and the player opens Prestige (the Forecast's
   "Prestige…" button), a short modal replaces the usual form. Nothing is chosen at the first Prestige: one Frame,
   no Blueprints, no Echo nodes. The modal shows:
   - the Echoes earned, taken from the Forecast (`echoesNow`), shown large;
   - what resets, in one sentence: "Scrap, upgrades and the wave reset (this run's Cores and Anomalies too): you start
     again at wave 1.";
   - what stays, in one sentence: "You keep your Echoes, the Codex, your records and everything permanent.";
   - "The Frontier moves from wave 28 to wave 38." (`forecast.frontier` → `forecast.nextFrontier`);
   - one primary button, "Prestige for 42 Echoes".

   Unlock everything, or a save that somehow already has choices, gets the normal modal. Second and later Prestiges
   use the normal modal and its confirm, unchanged.
2. **Guided first Echo spend.** After the Prestige, the Prestige tab opens on Upgrades (Layer I). An inline line reads
   "Spend your Echoes: these make every run stronger." The affordable Layer I picks are highlighted (the class `guide`
   only). **Nothing is ever bought for the player.** The guide ends on "Got it", or once nothing in Layer I is
   affordable. While the guide runs, ONE affordable pick (`echoGuideSuggested`: a mechanic before stat ranks, then the
   cheapest, normally Accelerated Clearing) also carries a small "Suggested" tag (class `suggested`) and is named in the
   guide line ("Suggested: Accelerated Clearing"). Every affordable pick stays buyable.
3. **Coach lines, in order, on Battle:**
   - "A new machine: every tab stays open. New weapons and elements arrive with later Prestiges; Automation and
     Trials unlock in More." This line is held back while the Echo guide runs.
   - The "New" line for the content the Prestige added (Frost).
   - The Quartermaster line, with a **Turn on** button.

## Quartermaster

The Quartermaster unlocks at the first Prestige (sim rule, `docs/QUARTERMASTER.md`) and starts **off**.

- **Card:** at the top of Upgrades → Chassis and Upgrades → Hardpoints (the trees it buys in), under a one-line
  summary ("Quartermaster · On · bank 1,234") that folds it: open while the Quartermaster is off (its switch is the
  decision), folded once it is on (tap to open; this session). Shown once the
  `quartermaster` feature is on. Before the first Prestige, Unlock everything shows it as a one-line teaser. It shows
  the Quartermaster's **Bank** (its own Scrap, with what flows in per second), the **Share of income** control
  (10 / 25 / 50 / 75 / 100%, default 50%), the per-tree switches, and "Nothing left to buy: all your income is
  yours" while it is idle.
- **HUD chip:** while it is on and its bank holds Scrap, a small bank chip sits beside the Scrap counter
  (`qmBankChip`, hud.ts), so the player always sees where that share of income went. Hidden below 360 px wide.
- **Offer:** after the first Prestige, a coach line: "Quartermaster: it banks a share of your new Scrap and buys your
  stat upgrades with it, never your choices." Its **Turn on** button sends `set_quartermaster {on: true}` (the saved
  share, 50% by default). Once the Quartermaster has been on, the line is never offered again.
- **Not player feedback:** its buys are `Purchase` events with `data.via === 'quartermaster'`. They do not count
  toward the first-purchase coach (`Shop.noteBuy`) or the bulk summary toast (`Shop.notePurchases`, `bulkToast`), and
  they never play the purchase sound. The audio director plays at most one quiet low tick (`QM_TICK_LEVEL` 0.25)
  every `QM_TICK_SECONDS` (4 s).
- **Inspector:** the pass event (and the release of its bank) shows as "Quartermaster" (`EV_NAMES`).

## Calm spending screens

The tab screens are layered the same way as the ladder: what is needed at the moment of purchase is always in view, the
rest is one tap away.

- **One top row** (`shell.ts`, `.screen-top`): the wallet on the left (the balances this screen spends, with the
  Quartermaster's bank under the Scrap figure), on Upgrades the buy-quantity chip (×1 → ×10 → Max, one tap each; Q), and
  a compact **Battle ›** button with the tower's HP as a thin bar (red and pulsing when low). It sits outside every
  scroller. With no wallet (More) the strip shows wave, HP and Scrap in full.
- **Upgrades** pins only the category tabs below it. The list scrolls as one: the **Suggested** line ("Suggested 3 ·
  Buy all ◆53", collapsed by default; its chevron opens the chips, remembered in `prefs.suggestExpanded`; the
  "Cheapest upgrades…" sentence shows only for the first three purchases, `prefs.buyCoach`), the **decision rows** (an
  empty attunement / hardpoint slot of this category, which opens its picker in place; this tree's open Doctrine fork,
  which scrolls to it), the tree chips (only with two or more trees; Cross and Cores are one stacked view), then the
  rows. A row shows its name, rank and headline effect (`format.ts splitDesc`, two lines at most); tapping the row
  body unfolds the full description (the Buy button keeps hold-to-buy). Locked and maxed rows fold into "N locked" /
  "N maxed" lines at the end (open per session).
- **Dots mean a decision is waiting** (an empty slot with something to put in it, an open Doctrine fork; `--warn`), on
  the category tab, the tree chip and the decision row. Affordability is the tab bar's count; a tree chip's count is
  its affordable nodes in a quiet neutral badge. The bright accent is kept for the primary action (Buy all, the
  starter Upgrade, Attune / Mount / Choose) and the selected state.
- **Build** and **Prestige → Upgrades** follow suit: section notes say only what the title does not; Build folds its
  locked slots into one row, the trees without a Doctrine into one line and the empty Anomaly sockets into one card;
  a Prestige layer not yet open is one line ("9 upgrades · open at deepest wave 60"), and an open layer folds its
  maxed rows (the guided first-Echo picks never fold).
- `tests/e2e/e2e.mjs` "phone calm" (skip with `E2E_SKIP_UX=1`) measures it at 393×852 and 375×667: pinned chrome ≤ 25%
  of the height, at most two pinned rows beyond the category tabs, list ≥ 55%, no sideways overflow, 44 px targets,
  14 px text, AA contrast.

## Unlock everything

Settings → **Unlock everything (for experienced players)** (`prefs.unlockAll`), or `?showall=1` for one session,
bypasses all of the above:

- every feature is on;
- every element and hardpoint is offered, and every Blueprint loads;
- there are no coach lines, no "New" tags and no ceremony (the normal Prestige modal), and no Echo guide.

## How to test

- **Fresh start:** More → Settings → **Start over (new game)** erases the save and the prefs (coach lines, "New"
  tags, the Echo guide), so the opening plays again from stage 0.
- **Everything at once:** open the game with `?showall=1`, or switch on Settings → Unlock everything.
- **A save at the Frontier:** the e2e helper pattern (`tests/e2e/e2e.mjs`, `withSave`) edits the current save and
  reloads into it. For example `s.run.deepestCleared = 28; s.meta.deepestEver = 28; s.run.checkpoint = 25; s.run.wave
  = 29;`, then Prestige tab → Forecast → Prestige… shows the ceremony. Set `s.meta.prestigeCount = N` to see the
  pool at Prestige N (Upgrades → Elements / Hardpoints → an empty slot).
- **Unit tests:** `npx vitest run tests/ui` covers pool monotonicity, starters, owned-is-offered, Unlock everything,
  the Fusion / Linkage / Infusion filter, "New" bookkeeping, the ceremony facts and Echo guide, and Quartermaster buys
  in the bulk toast. `tests/audio/director.test.ts` covers the Quartermaster tick.
