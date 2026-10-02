# Quartermaster

Automation as a reward. Early play was "press Purchase all, Purchase all" over and over. After the
first Prestige, a **Quartermaster** unlocks that keeps the repeatable stat ranks topped up, so the
player's taps go to decisions instead of refills.

**Rules: it never makes a choice for you, and it never touches your Scrap.** It has its **own bank**:
it takes a share of the Scrap you earn from then on, and it spends only that bank, only on stat ramps
in trees you already chose to use.

| Where | What |
| --- | --- |
| `src/sim/directives/quartermaster.ts` | the rule (`quartermasterNode`), the bank (`divertIncome`, `quartermasterShare`), the pass (`runQuartermaster`), settings, constants, `UiState.quartermaster` |
| `src/sim/core/world-impl.ts` | `addScrap(amount, divert = true)`: every diverted income goes through here |
| `src/sim/directives/engine.ts` | calls the pass from the Directives system (after the Upgrade Queue) |
| `src/sim/economy/shop.ts` | `purchaseRank` / `quoteNode`: the shop's own prices, locks and `Ev.Purchase` |
| `src/sim/run/commands.ts`, `validate.ts` | the `set_quartermaster` command |
| `src/sim/save/serialize.ts` | `SAVE_VERSION` 3: migrations 1 → 2 (settings, off) and 2 → 3 (reserve → share, bank saved), sanitization |
| `src/ui/quartermaster.ts`, `src/styles/quartermaster.css` | the card (`QuartermasterPanel`) |
| `src/ui/hud.ts` (`qmBankChip`), `src/styles/hud.css` | the bank chip beside the Scrap counter |
| `tests/active/quartermaster.test.ts`, `tests/ui/quartermaster.test.ts` | sim (incl. conservation property tests) and UI tests |
| `sim-cli` `--quartermaster [SHARE]` | harness flag (see "Measured effect") |

## The bank

```
 income through World.addScrap (kills, salvage crates, Reactor dividend)
        │  scrapEarned, waveScrap, the wave's ScrapGain, Forecast rates: the GROSS amount
        ▼
   ┌─ on, unlocked, not idle? ─ no ──────────────────────────────┐
   │ yes                                                         │
   ├── amount × share/100 ──► Quartermaster BANK                 │
   └── the rest ───────────────────────────────────────────────► run.scrap (yours)
                                   │                                  ▲
         a pass (1/s) buys stat ranks ONLY from the bank              │
                                   │                                  │
   off / every tree off / idle ────┴──── whole bank released ─────────┘

 not split (100% yours): Seed Capital, the Checkpoint Dividend perk (addScrap(bonus, false)),
 offline return, Refit refunds, any other direct credit
```

- **Share** (`settings.quartermaster.share`): 10, 25, 50, 75 or 100% of incoming Scrap, default **50**.
  `addScrap` computes `banked = amount × share / 100`, adds it to `run.quartermaster.bank`, and credits
  `amount − banked` to `run.scrap`. Nothing else is rounded or scaled. At 100% every diverted income goes to the
  bank, so the player's own Scrap grows only from the paths that are never split (and from releases).
- **Which income is split:** everything that goes through `World.addScrap` with the default `divert = true`: kill
  Scrap (`finishKill`), salvage crates (`systems/active.ts`) and the Reactor's Checkpoint Dividend
  (`systems/reactor.ts`). The Prestige perk Checkpoint Dividend (`run/prestige.ts`) passes `divert = false`: Prestige
  perks are the player's. Seed Capital (at a run start and when bought mid-run), `offline_return` and Refit refunds
  credit `run.scrap` directly and are never split. A test lists every `addScrap` caller, so a new income path has to
  choose.
- **Spending:** a pass pays only from the bank. For each rank it moves exactly the price from the bank into the
  purchase (the player's `run.scrap` is restored to the same value), so the shop's price, locks, `spentByTree` and
  `Ev.Purchase` are unchanged. There is no floor, no reserve and no look at the player's Scrap. The player's own
  buys never touch the bank. The Upgrade Queue spends the player's Scrap as before and is not affected.
- **Release:** the whole bank moves into `run.scrap` at once when the player switches it off, switches every tree
  off, or when it goes **idle**. A release emits `Ev.Quartermaster` (src `quartermaster.release`, a = Scrap
  released). Changing the share keeps the bank. No Scrap is ever lost.
- **Idle:** every enabled tree has nothing it could ever buy (no eligible node that is visible, unlocked and below
  max rank; a node it cannot afford yet does not count). The pass checks this every second (and the command checks
  it at once). While idle, nothing is diverted and the bank is released; diversion resumes on the first pass that
  finds something buyable. The card then says "Nothing left to buy: all your income is yours".
- **Run boundaries:** the bank belongs to the run, like its Scrap. A death or a checkpoint restart keeps it. A
  Prestige, an Ascension or a Trial start begins a new run with an empty bank (the old run's Scrap resets too). A
  Trial parks the main run with its bank (`meta.parkedRun`), and ending the Trial restores it.
- **Saved:** `RunSave.quartermaster = { bank, idle, bought, spent }`. A reload never loses the bank.
- **Conservation** (property tests over random income, passes, player buys and switches): player Scrap + bank +
  everything spent (`spentByTree`) always equals the starting Scrap plus all income, and no Quartermaster action
  ever lowers the player's Scrap.

## What it buys, and what it never buys

It buys a node only when all of these hold (`quartermasterNode`, checked against every node in the content by a test):

- it is a tree node with `kind: 'stat'` and a Scrap price;
- its tree is a **chassis** tree (Ballistics, Bastion, Reactor) or a **hardpoint** tree that is mounted;
- the shop shows it unlocked right now (its `requires` are owned; below max rank).

The stat nodes of a Doctrine count once you have chosen that Doctrine. Choosing it was your decision;
its ramps are not.

It never buys: mechanics, Exotics, anything priced in Cores, Doctrine choices, element trees (attuning
is a choice), Fusions, Triads, Linkages, Infusions, ability ranks, mounts, attunements, Refit, or
Anomaly and Boon picks. Mechanic ranks are left out on purpose. Many are unlocks or behaviour changes,
so leaving them all out is the simple, safe rule.

## When it acts

- **Unlock:** `meta.prestigeCount >= 1`. This is hard-coded in the sim, so a first run can never turn it on.
  `set_quartermaster` is rejected before the first Prestige, and a hand-edited save with it on neither banks nor buys.
- **Default:** off, share 50%. Old saves migrate with their on/off state (version-1 saves: off). New games start
  with it off; the player turns it on from the card or the first-Prestige coach line.
- **Where:** passes run only during the `between` and `combat` phases, inside the Directives system update.
  Diversion happens whenever income arrives.
- **Pacing:** one pass per sim second (`run.tick % 60 === 0`). A pass buys at most **8** ranks.
- **Spreading:** each pass goes round-robin over the enabled trees and buys one rank per tree per
  round. In each tree it buys the cheapest eligible rank the bank can pay for (ties go to content order).
  It buys as soon as the bank can afford the cheapest enabled stat.
- **Tree order:** the player's order comes first, then the remaining trees in data order. The default
  order is empty, which means the tree with the cheapest next rank goes first on each pass.
- **Cause:** a pass that buys first emits `Ev.Quartermaster` (src `'quartermaster'`, a = bank, b = share).
  Each of its `Ev.Purchase` events names that event as its `cause` and carries `data: { via: 'quartermaster' }`.
  Stats rebuild once per pass.
- **Offline:** `offline_return` credits Scrap (all of it the player's) and simulates no purchases, so the
  Quartermaster does not run offline. The Patrol rule "Patrol never fights a boss" is unchanged.
- **Forecast:** income rates count the gross Scrap. The Wall gauge (seconds until the player can afford the next
  mechanic) uses the player's part of income: `income × (1 − share/100)` while it banks.

## Constants

| Constant | Value |
| --- | --- |
| `QM_UNLOCK_PRESTIGES` | 1 |
| `QM_INTERVAL_TICKS` | 60 (one pass per sim second) |
| `QM_MAX_RANKS_PER_PASS` | 8 (so at most 8 ranks per second) |
| `QM_SHARES` / `QM_DEFAULT_SHARE` | 10, 25, 50, 75, 100 / 50 |
| `QM_TREES` | ballistics, bastion, reactor, ordnance, drones, blade, laser, gravitics |

## Command, state, save

- `{ type: 'set_quartermaster', on?, share?, trees?: { [tree]: boolean }, order?: TreeId[] }` is a partial
  patch. Unknown trees, element trees and shares that are not offered are rejected. Off releases the bank; any patch
  re-checks idle at once.
- `meta.settings.quartermaster = { on, share, trees, order }` is saved. A tree missing from `trees`
  counts as on. The sanitizer repairs junk (an unknown share becomes 50).
- `run.quartermaster = { bank, idle, bought, spent }` is per run and saved with it (`RunSave.quartermaster`).
- `UiState.quartermaster = { unlocked, on, share, bank, idle, trees: [{ tree, on, bought }], order, boughtThisRun, scrapSpentThisRun }`.
  `trees` lists the chassis trees and the mounted hardpoint trees, in priority order.
- **Migration 2 → 3:** a saved `reserve` r (percent of Scrap kept for the player) becomes the share nearest
  100 − r: reserve 0 → 100%, 25 → 75%, 50 → 50%, 75 → 25%. On/off, trees and order are kept; the bank starts empty
  (version 2 saved no run state). Version-1 saves still migrate with it off.

## UI

- **Card** (top of Upgrades → Chassis and Hardpoints): master switch; "It banks a share of everything you earn and
  spends only that. Your own Scrap is never touched. It never makes choices for you."; the **Bank** (icon, amount,
  and the Scrap flowing in per second, measured from the UiState ticks); "Buys when it can afford the cheapest
  enabled stat" (or "Nothing left to buy: all your income is yours" while idle, or "Off: all your income is yours");
  **Share of income** 10 / 25 / 50 / 75 / 100% with "Quartermaster takes 50% of new Scrap"; the per-tree switches
  (`data-hint="quartermaster-toggle"` stays on the master switch); "Bought N ranks this run · X Scrap".
- **HUD chip:** a small bank icon and amount beside the Scrap counter while it is on and holds at least 1 Scrap
  (`qmBankChip`), dimmer than the player's Scrap. Hidden below 360 px wide, and on phones (≤ 400 px) during a boss
  wave so the boss name never truncates. On a 375 px phone "The Outskirts" still fits beside it; a longer Sector
  name gives way first (ellipsis), as the top bar is designed to.
- **Coach line** after the first Prestige: "Quartermaster: it banks a share of your new Scrap and buys your stat
  upgrades with it, never your choices." with **Turn on**.

## Measured effect

Harness: `npm run sim -- --quartermaster [SHARE]` (default 50). Once the Quartermaster unlocks, the runner turns it
on with that share. The purchase agent then stops buying the stat ranks the Quartermaster covers (they are hidden
from its shop) and spends only its own Scrap (`run.scrap`): the bank is a separate field, so the agent can neither
spend it nor count it. So it plays the player who hands over the ramps and keeps making the choices, and nothing is
bought twice. The optimizer's rollouts do the same (the bank is saved, so a rollout inherits it).

"Old" below is the previous allowance model (reserve r, which spent up to 100 − r% of income), measured on the same
code base just before this change; "new" is the bank. An old reserve of 25 (its default) spent like a share of 75.

**Single climbs after one Prestige.** Meta `prestigeCount` 1, seeds 1 to 4, 1 sim-hour, idle policy. Mean deepest
wave; mean attempts to the deepest checkpoint every variant reached.

| Agent | Manual | Old reserve 25 (≈ 75%) | New 75% | Old reserve 50 | **New 50% (default)** | Old reserve 0 | New 100% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Generalist deepest / attempts | 29.5 / 10.2 | 29.5 / 11.8 | 29.5 / 14.0 | 29.5 / 19.0 | **30.2 / 15.0** | 29.2 / 10.0 | 28.0 / 10.2 |
| Greedy | 29.0 / 13.2 | 29.5 / 11.0 | 30.0 / 9.2 | 28.5 / 16.5 | **28.8 / 15.8** | 29.5 / 9.0 | 28.5 / 10.2 |
| Survival | 28.0 / 10.5 | 28.5 / 13.5 | 28.5 / 12.0 | 26.8 / 20.5 | **28.0 / 17.2** | 28.0 / 11.0 | 28.0 / 12.8 |

- At 50% it bought about 280–330 ranks for 34–40K Scrap per sim-hour (old reserve 50: 250–290 ranks, 26–38K); the
  agent's own purchases fell from 390–495 to about 95–135. Less than 1K Scrap was left in the bank at the end.
- At the same spending share the bank is as good as or better than the allowance (50%: fewer attempts for all
  three agents; 75%: within noise). The default moved from "reserve 25" (≈ 75% of income) to a 50% share, so the
  default spends less on ramps than before: more attempts to the common checkpoint than the old default.
- At 100% the player's own Scrap only comes from Seed Capital, perks, offline and releases, so the agent can buy
  almost no choices (4 purchases per hour): Generalist 28.0 deep vs 29.5 manual. That is what "100%" means; the
  card says "Quartermaster takes all new Scrap".
- **Defense row** (median Survival ≥ 90% of median Greedy depth) after Prestige 1: manual 97%; new 50% 97%,
  75% 93%, 100% 98% (old: reserve 25 95%, reserve 50 98%; the previous measurement in this file, on older balance
  data, was 90%). Not worse.

**Prestige chains.** Generalist idle, 3 Prestiges, 2 sim-hours per run, seeds 1 to 4 (the Quartermaster runs from
Prestige 1, so run 1 is identical). Push (waves past the previous best) and Reclimb (time to the previous best as a
share of the previous run's time, target 25–40%):

| Variant | Depths s1 / s2 / s3 / s4 | Push | Reclimb run 2, mean | Reclimb run 3, mean |
| --- | --- | --- | --- | --- |
| Manual | 28→39→51 / 28→22→41 / 28→39→52 / 28→39→51 | +11+12 / −6+13 / +11+13 / +11+12 | 32.1% (3 seeds) | 28.0% (3 seeds; s2 85.6%) |
| Old reserve 25 | 28→39→51 / 28→39→51 / 28→39→52 / 28→39→51 | +11+12 / +11+12 / +11+13 / +11+12 | 34.9% | 34.1% |
| Old reserve 50 | same depths as reserve 25 | same | 51.0% | 32.4% |
| New 75% | 28→39→51 / 28→38→50 / 28→39→52 / 28→39→51 | +11+12 / +10+12 / +11+13 / +11+12 | 37.1% | 33.6% |
| **New 50%** | 28→39→51 / 28→39→51 / 28→39→52 / 28→39→51 | +11+12 / +11+12 / +11+13 / +11+12 | **45.7%** | **32.7%** |
| New 100% | 28→37→50 / 28→23→37 / 28→37→49 / 28→28→37 | +9+13 / −5+9 / +9+12 / +0+9 | 27.1% (3 seeds) | 52.1% |

- **Push** at 50% is identical to the old Quartermaster and to manual play. (Manual seed 2 stalled on run 2; no
  50% or 75% chain did.)
- **Reclimb** at 50% is better than the old allowance at the same share (45.7% vs 51.0% on run 2, equal on run 3),
  but the new default spends less than the old default (reserve 25), so run 2's reclimb is slower than with the old
  default (45.7% vs 34.9%; seeds swing 36–56%). Players who want the old pace pick 75% (37.1% / 33.6%).
- **100%** starves the choices (no Scrap for mechanics, mounts, attunements): two of four chains stalled on run 2.

**Conclusion:** the Quartermaster removes taps, not difficulty. It does not make idle play easier than the active
edge allows. First-run acceptance rows (Checkpoint odds and time, First wall, Defense, Active edge, Directive gap)
cannot change: it is locked in run 1, and the harness default is off.
