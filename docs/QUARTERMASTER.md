# Quartermaster

Automation as a reward. Early play was "press Purchase all, Purchase all" over and over. After the
first Prestige, a **Quartermaster** unlocks that keeps the repeatable stat ranks topped up, so the
player's taps go to decisions instead of refills.

**Rule: it never makes a choice for you.** It buys only stat ramps in trees you already chose to use.

| Where | What |
| --- | --- |
| `src/sim/directives/quartermaster.ts` | the rule (`quartermasterNode`), the pass (`runQuartermaster`), settings, constants, `UiState.quartermaster` |
| `src/sim/directives/engine.ts` | calls the pass from the Directives system (after the Upgrade Queue) |
| `src/sim/economy/shop.ts` | `purchaseRank` / `quoteNode`: the shop's own prices, locks and `Ev.Purchase` |
| `src/sim/run/commands.ts`, `validate.ts` | the `set_quartermaster` command |
| `src/sim/save/serialize.ts` | `SAVE_VERSION` 2: migration 1 → 2 and settings sanitization |
| `src/ui/quartermaster.ts`, `src/styles/quartermaster.css` | the card (`QuartermasterPanel`) |
| `tests/active/quartermaster.test.ts`, `tests/ui/quartermaster.test.ts` | sim and UI tests |
| `sim-cli` `--quartermaster [RESERVE]` | harness flag (see "Measured effect") |

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
  `set_quartermaster` is rejected before the first Prestige, and a hand-edited save with it on buys nothing.
- **Default:** off. Old saves migrate with it off. New games also start with it off; the player turns
  it on from the card.
- **Where:** it runs only during the `between` and `combat` phases, inside the Directives system update.
- **Pacing:** one pass per sim second (`run.tick % 60 === 0`). A pass buys at most **8** ranks.
- **Spreading:** each pass goes round-robin over the enabled trees and buys one rank per tree per
  round. In each tree it buys the cheapest eligible rank it can afford (ties go to content order).
- **Tree order:** the player's order comes first, then the remaining trees in data order. The default
  order is empty, which means the tree with the cheapest next rank goes first on each pass.
- **Cause:** a pass that buys first emits `Ev.Quartermaster` (src `'quartermaster'`, a = Scrap on
  hand, b = allowance). Each of its `Ev.Purchase` events names that event as its `cause` and carries
  `data: { via: 'quartermaster' }`. Stats rebuild once per pass.

## Reserve, allowance, and the Upgrade Queue

The Quartermaster and the Upgrade Queue share one engine. Both run in the Directives system and buy
through `economy/shop.ts`. The Quartermaster spends only what is left after these rules:

1. **The Upgrade Queue goes first.** On a tick where both are due, the Queue runs first. The
   Quartermaster also never takes Scrap below the price of the rank the Queue is saving for (its head
   rule: the first rule that wants a rank and can be bought).
2. **Reserve** (0 / 25 / 50 / 75%, default 25%). A pass never takes Scrap below reserve% of the Scrap on
   hand when the pass starts.
3. **Allowance.** The Quartermaster spends only from its allowance:
   - it starts at (100 − reserve)% of the Scrap on hand when it begins (switched on, reserve changed,
     a new Prestige, or a load);
   - it grows by (100 − reserve)% of all Scrap earned through `World.addScrap` after that (kills, and
     any Scrap routed the same way).

   Without the allowance, the reserve would drain on every pass and you could never save up for an
   expensive choice. With it, reserve% of your income always piles up for your own picks. Scrap that
   does not come through `addScrap` stays yours: offline return, Refit refunds and Seed Capital. When
   you spend Scrap by hand, the allowance is capped at the Scrap you have left.

**Offline:** `offline_return` credits Scrap and simulates no purchases, so the Quartermaster does not
run offline. That Scrap does not join its allowance. The Patrol rule "Patrol never fights a boss" is
unchanged.

## Constants

| Constant | Value |
| --- | --- |
| `QM_UNLOCK_PRESTIGES` | 1 |
| `QM_INTERVAL_TICKS` | 60 (one pass per sim second) |
| `QM_MAX_RANKS_PER_PASS` | 8 (so at most 8 ranks per second) |
| `QM_RESERVES` / `QM_DEFAULT_RESERVE` | 0, 25, 50, 75 / 25 |
| `QM_TREES` | ballistics, bastion, reactor, ordnance, drones, blade, laser, gravitics |

## Command, state, save

- `{ type: 'set_quartermaster', on?, reserve?, trees?: { [tree]: boolean }, order?: TreeId[] }` is a partial
  patch. Unknown trees, element trees and reserves that are not offered are rejected. Changing `on` or
  `reserve` restarts the allowance.
- `meta.settings.quartermaster = { on, reserve, trees, order }` is saved. A tree missing from `trees`
  counts as on. The sanitizer repairs junk.
- `run.quartermaster = { allowance, earnedMark, active, bought, spent }` is per Prestige and not saved.
- `UiState.quartermaster = { unlocked, on, reserve, trees: [{ tree, on, bought }], order, boughtThisRun, scrapSpentThisRun }`.
  `trees` lists the chassis trees and the mounted hardpoint trees, in priority order.

## Measured effect

Harness: `npm run sim -- --quartermaster [RESERVE]`. Once the Quartermaster unlocks, the runner turns
it on. The purchase agent then stops buying the stat ranks the Quartermaster covers (they are hidden
from its shop) and spends only Scrap above the Quartermaster's allowance. So it plays the player who
hands over the ramps and keeps making the choices, and nothing is bought twice. The optimizer's
rollouts do the same.

**Single climbs after one Prestige.** Same meta (prestigeCount 1), seeds 1 to 4, 1 sim-hour, reserve 25%:

| Agent / policy | Deepest (mean) manual → QM | Attempts to common checkpoint manual → QM |
| --- | --- | --- |
| Generalist idle | 34.0 → 35.8 | 13.8 → 15.5 |
| Greedy idle | 31.3 → 35.3 | 23.8 → 15.0 |
| Survival idle | 36.5 → 31.8 | 16.0 → 15.8 |
| Generalist **active** (no QM) | 46.8 | 6.8 |

- The Quartermaster spent about 300 ranks and 45–60K Scrap per sim-hour. The agent's own purchases fell
  from about 300–430 to about 100.
- **Active edge is intact.** Manual idle → active is 51% fewer attempts. Idle with the Quartermaster is
  within noise of manual idle: +1.8 waves for the Generalist, with 13% *more* attempts. It never gets
  near active (46.8).
- **Why it cannot beat careful buying:** it spreads cheapest-first across trees instead of weighting
  by value, and it spends at most (100 − reserve)% of income. It helped the pure-DPS Greedy agent
  (Greedy neglects defense and the spread fixes that). It hurt the Survival agent, which loses its
  defense weighting.
- **Defense row** (Survival ≥ 90% of Greedy depth) after Prestige 1: manual 117%, with the
  Quartermaster 90%, which is at the line. A player who wants defense can put Bastion first in the
  order.

**Prestige chains.** Generalist idle, 3 Prestiges, 2 sim-hours per run, seeds 1 and 2: the Push
depths were identical with and without the Quartermaster (s1 34 → 39 → 51, s2 39 → 39 → 69). Reclimb
was 40%/55% with the Quartermaster vs 40%/45% without (s1), and 35%/51% vs 29%/62% (s2). The baseline
itself fails the Push and Reclimb rows on this branch, and the Greedy and Survival chains swing ±30
waves between seeds (Survival reached 97–100 in some baseline chains). Balance data was being edited
while these ran, so treat the chain numbers as noise-bound. They show no systematic gain.

**Conclusion:** the Quartermaster removes taps, not difficulty. It does not make idle play easier
than the active edge allows. First-run acceptance rows (Checkpoint odds and time, First wall,
Defense, Active edge, Directive gap) cannot change: it is locked in run 1, and the harness default
is off. Re-measure with `--quartermaster` after the balance pass settles.
