# Project Citadel — Active edge

"It lacks a truly active component." Three small things an attentive player can do, each an **edge, never a toll**
(design §1 pillar 5): an idle player loses nothing that existed before, absence is never punished (pillar 8: nothing
decays, missed crates still pay, no dailies or streaks), and the whole active advantage stays inside the §19 *Active
edge* band. Code: `src/sim/systems/active.ts` (sim), `src/sim/data/active.ts` (the one `ACTIVE` constant table),
`src/app/active-tap.ts` + `src/app/game.ts` (tap routing), `src/ui/active.ts` (widgets), `sim-cli/policies.ts` (the
active policy's use of them).

## Mechanics

| Piece | Available | What the player does | What happens | If the player does nothing |
| --- | --- | --- | --- | --- |
| **Tap-to-assist** | from the first second, in combat | tap an enemy | the tower fires a free bonus shot at it (tracer, muzzle flash, hit sparks, a crack); the same tap still designates it | the gun fires as always |
| **Salvage crates** | from wave 2 | tap a glowing crate drifting to the tower | Scrap burst worth 4–8× the kill's Scrap; quick collects chain ×1 → ×1.5 → … → ×3; a "+Scrap ×chain" floater and a pluck whose pitch climbs along the chain | the passive collector takes the crate at the tower for 40% of its value |
| **Overcharge** | unlocks at wave 12 (progression feature `overcharge`) | when the ring glows: press and hold the button (or the tower), release as the arc crosses the bright band | a beam along the designated enemy's line (else the nearest enemy): 5 primary shots of damage to every enemy on it and a 1 s stagger; outside the window 2.5 shots and a 0.4 s stagger (never a fail state) | the meter waits, full, forever |

Details the sim enforces (`systems/active.ts`):

- **Commands** are player-only and never an error: `tap_assist {x, y}`, `collect_salvage {x, y}`,
  `overcharge {action: 'charge' | 'release' | 'cancel'}`. A tap that finds nothing, lands inside the cooldown or comes
  outside combat does nothing, so spamming never toasts and never gains anything.
- **Assist**: one shot per 0.6 s of sim time; damage = 1.0 × `ballistics.damage` (the primary's current shot), crit at
  `ballistics.crit_chance` + 10% (like manual aim) × `ballistics.crit_damage`. The enemy nearest the tap within
  max(32, radius + 12) world units. Not in the Blackout Trial (it disables active input).
- **Salvage**: drop chance per kill 4% (ordinary), 25% (elite), 100% (boss), rolled on the system's own PRNG stream
  (reseeded per attempt from the Prestige seed and the attempt number), so the combat stream is untouched and runs stay
  reproducible. At most 6 live crates (further drops are skipped). Every crate lives exactly 5 s, drifting in a
  straight line from the kill to the tower. A tap takes the crate nearest the point within 56 world units (the app
  snaps taps to the drawn crate with a ≥ 44 CSS px reach). Chain: a collect within 1.5 s (real time) of the previous
  one adds a link; multiplier 1 + 0.5 × (links − 1), max ×3; the chain lapses after the window. A crate reaching the
  tower pays 40% (no chain; it does not break one). Crates keep drifting and paying between waves; on death the
  crates in flight pay at 40%.
- **Scrap path**: a crate's value is a multiple of `World.killScrap[i]`, the Scrap the kill itself paid, so it already
  carries the first-clear ×3 (Strip Mine ×4/×5), `economy.scrap_mul` (Reclamation, Prestige, Constellation), Boss
  Scavenging and clump merges; no multiplier is applied twice. The payout goes through `World.addScrap`, the kill
  Scrap path: `run.scrap`, `scrapEarned` (Forecast, rates) and `waveScrap` (the wave's `ScrapGain` event and the
  Patrol / offline estimate).
- **Overcharge**: a 0–100 meter, separate from Command Energy (it never costs CE). +1 per landed primary hit, at most
  3/s from shots (a token bucket, so late-game fire rates do not trivialise it), +3 per assist hit. It never decays and
  empties on death, like CE. Charging needs a full meter, combat, not Blackout. The hold is counted in real seconds
  (sim ticks ÷ speed multiplier). Perfect window 0.75–1.2 s; holding 2.2 s releases weak; `cancel` (a second finger,
  pointer cancel, leaving combat) keeps the meter. The beam: every tangible enemy within 26 + its radius of the line
  from the tower, 560 units long.
- **Cause chain**: `Ev.Assist` → its Hit (src `assist`); `Ev.Overcharge` → its Hits (src `overcharge`);
  `Kill → Ev.SalvageDrop → Ev.SalvageCollect` (`salvage.tap` / `salvage.passive`). The Inspector names these events,
  and a collect's chain reads "The gun killed the Brute, which dropped a salvage crate, which paid 120 Scrap."

## Constants (`src/sim/data/active.ts`)

| Constant | Value | Notes |
| --- | --- | --- |
| `assist.cooldown` | 0.6 s | sim time |
| `assist.damageMul` | 1.0 | × `ballistics.damage` (spec range 1.0–1.5; tuned to the low end, see below) |
| `assist.critBonus` | +10% | like manual aim |
| `assist.reach`, `pad` | 32, +12 | world units (sim-side) |
| `assist.meterPerTap` | 3 | Overcharge meter per assist hit |
| `salvage.fromWave` | 2 | |
| `salvage.chance` / `eliteChance` / `bossChance` | 4% / 25% / 100% | own PRNG stream |
| `salvage.valueMin`–`valueMax` | 4–8× | the kill's Scrap |
| `salvage.lifeSeconds` | 5 s | kill → tower |
| `salvage.maxLive` | 6 | |
| `salvage.tapReach` | 56 | world units; the UI reach is ≥ 44 CSS px |
| `salvage.chainWindow` | 1.5 s | real time |
| `salvage.chainStep`, `chainMax` | +0.5, ×3 | |
| `salvage.passiveValue` | 40% | the passive collector |
| `overcharge.unlockWave` | 12 | max(deepest ever, deepest this run) |
| `overcharge.meterMax` | 100 | |
| `overcharge.meterPerHit`, `shotCapPerSecond` | 1, 3/s | |
| `overcharge.perfectFrom`–`perfectTo` | 0.75–1.2 s | hold time |
| `overcharge.maxHoldSeconds` | 2.2 s | auto-release (weak) |
| `overcharge.perfectMul` / `weakMul` | 5 / 2.5 | primary shots per enemy on the line |
| `overcharge.beamHalfWidth`, `beamLength` | 26, 560 | |
| `overcharge.staggerSeconds` / `weakStaggerSeconds` | 1.0 / 0.4 s | bosses: interrupt only |

## Controls (phone, one thumb)

| Gesture | Result |
| --- | --- |
| tap near a crate (≥ 44 px) | collect it (crates win over enemies: they are gone in seconds) |
| tap an enemy | assist shot **and** designation (`designate_at`, unchanged) |
| tap the same enemy again within 0.9 s (≤ 48 px) | assist shot only: hammering never toggles the designation off |
| a lone tap on a designated enemy | clears it, as before |
| tap with an ability armed | casts it (unchanged; no assist) |
| hold on the tower (Overcharge ready) | charge; lift to fire |
| hold anywhere else | manual aim (unchanged) |
| Overcharge button (bottom-right, over the arena) | press-and-hold / release; keyboard Enter or O |

The button sits at the bottom-right of the arena, level with the ability row, and moves above the row when three or
four ability slots make the row wide. It is hidden until Overcharge unlocks (`overchargeUnlocked(ui)` in
`src/ui/active.ts`, the same rule as the sim). Its ring shows the meter; while charging, a white arc sweeps once per
2.2 s and the timing window is the bright band; the label reads …, NOW, LATE. Coach strings are exported from
`src/ui/active.ts` (`COACH_OVERCHARGE_UNLOCK`, `COACH_OVERCHARGE_READY`, `COACH_SALVAGE`, `COACH_ASSIST`).

## Presentation

- Crates: a small gold diamond (layer 7, `aux1 = SALVAGE_MARK`) with a soft halo (layer 2) pulsing at ~1.2 Hz (under
  the 3 Hz flash rule) and a fuse ring that fades as the crate nears the tower; the field overlay redraws the diamond
  at least 7 CSS px wide with a 13 px ring so it is a thumb target on a phone.
- Assist: a tracer from the barrel for 9 ticks, a muzzle flash and hit sparks (snapshot fx from `Ev.Assist`).
- Overcharge: 12 meter pips around the tower (a glow when full), a charge ring growing toward a target band while
  charging, the beam (22 ticks), a shockwave and, on a perfect release, a camera punch (scaled to 0 by reduced motion).
- Floaters: "+1.2K ×2" rising from a collected crate (DOM, client px via the camera); passive collects show a small dim
  "+N". Under reduced motion they fade in place. No toasts.
- Sounds (`src/audio/sfx/active.ts`): `assist` crack, `salvage_pluck` (one pentatonic step up per chain link),
  `salvage_passive` tick, `overcharge_thump` (bigger on a perfect release).

## Measured active edge

Method: `sim-cli` Generalist, seeds 1–6, 4 sim-hours per climb, stop at wave 100 (the acceptance row's setup with six
seeds instead of three); attempts summed over the checkpoints both runs reached. `active:off` is the active policy
without the three pieces (`RunConfig.activeExtras = false`); the per-piece rows use only that piece. The active policy
plays like a human: ≤ 2 taps/s in total, collects 70% of crates 0.35 s or more after they drop, releases Overcharge at
the window centre ± 0.3 s. The idle policy never taps (it still gets the 40% passive collector).

The balance data changed while this was built (other passes retuned the early curve and bosses), and the edge of the
*existing* active play moved with it: 24.0% at the start (98 vs 129 attempts, seeds 1–3), 42–49% during this work. The
three pieces are therefore judged by what they add on top of the existing active play, measured in the same code
state:

| Run (seeds 1–6, same code state) | Attempts | vs idle | vs active without the pieces |
| --- | --- | --- | --- |
| idle | 161 | — | — |
| active, no new pieces | 94 | 41.6% fewer | — |
| active + assist only | 83 | 47.8% fewer | 5.5% fewer |
| active + salvage only | 96 | 40.4% fewer | ≈ 0 (noise) |
| active + Overcharge only | 91 | 43.5% fewer | 3.1% fewer |
| **active, all three** | **80** | **50.3% fewer** | **14.3% fewer** |

At the first tuning (assist 1.25×, salvage 5% / 35%, Overcharge 4 meter/s from shots) the three pieces added 26–37%;
they were cut to the values above. With the pre-rebalance existing edge (24%), 14% more gives about
1 − 0.76 × 0.86 ≈ 35% fewer attempts: inside the 15–40% band this pass targeted. In the current data the existing edge
alone is already outside it, and idle ends 1–3 bosses behind active at the 4-hour horizon in 2 of 6 seeds (it was
already 2–4 bosses behind at the start); that is a property of the ability / CE balance, not of these pieces. Idle
clears every boss it reaches without any of them: nothing here gates progress.

Reproduce: `npx tsx <script>` driving `sim-cli/pool.ts` with `RunConfig.activeExtras` (see `sim-cli/types.ts`), or
`npm run sim -- --agent generalist --policies idle,active --seeds 1,2,3,4,5,6 --hours 4 --stop-wave 100`.
