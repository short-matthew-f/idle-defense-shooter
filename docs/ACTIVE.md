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
| **Overcharge** | unlocks at wave 12 (progression feature `overcharge`) | when the ring glows: press and hold the button (or the tower), release as the arc crosses the bright band | a beam along the designated enemy's line (else the nearest enemy): 4 primary shots of damage to every enemy on it and a 1 s stagger; outside the window 2 shots and a 0.4 s stagger (never a fail state) | the meter waits, full, forever |

Details the sim enforces (`systems/active.ts`):

- **Commands** are player-only and never an error: `tap_assist {x, y}`, `collect_salvage {x, y}`,
  `overcharge {action: 'charge' | 'release' | 'cancel'}`. A tap that finds nothing, lands inside the cooldown or comes
  outside combat does nothing, so spamming never toasts and never gains anything.
- **Assist**: one shot per max(0.6 s, 1 / (0.15 × the primary's shots/s)) of sim time: the assist never adds more than
  15% of the gun's own shots (3.3 s at the base 2 shots/s, the 0.6 s floor from ~11 shots/s; see *Measured active edge*
  for why). Damage = 1.0 × `ballistics.damage` (the primary's current shot), crit at `ballistics.crit_chance` + 10%
  (like manual aim) × `ballistics.crit_damage`. The enemy nearest the tap within max(32, radius + 12) world units. Not in the Blackout Trial (it disables
  active input).
- **Salvage**: drop chance per kill 1.2% (ordinary), 8% (elite), 40% (boss), rolled on the system's own PRNG stream
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
  2/s from shots (a token bucket, so late-game fire rates do not trivialise it), +2 per assist hit. It never decays and
  empties on death, like CE. Charging needs a full meter, combat, not Blackout. The hold is counted in real seconds
  (sim ticks ÷ speed multiplier). Perfect window 0.75–1.2 s, judged on the hold the release reports (what the arc showed) when it lies within 0.3 s below
  the sim's own hold, else on the sim's hold (found on the phone check: UiState and input latency otherwise turn a release
  the player saw inside the band into a late one); holding 2.2 s releases weak; `cancel` (a second finger,
  pointer cancel, leaving combat) keeps the meter. The beam: every tangible enemy within 26 + its radius of the line
  from the tower, 560 units long.
- **Cause chain**: `Ev.Assist` → its Hit (src `assist`); `Ev.Overcharge` → its Hits (src `overcharge`);
  `Kill → Ev.SalvageDrop → Ev.SalvageCollect` (`salvage.tap` / `salvage.passive`). The Inspector names these events,
  and a collect's chain reads "The gun killed the Brute, which dropped a salvage crate, which paid 120 Scrap."

## Constants (`src/sim/data/active.ts`)

| Constant | Value | Notes |
| --- | --- | --- |
| `assist.cooldown` | 0.6 s | sim time; the floor |
| `assist.maxPrimaryShare` | 15% | cooldown ≥ 1 / (share × primary shots/s): 3.3 s at 2 shots/s |
| `assist.damageMul` | 1.0 | × `ballistics.damage` (spec range 1.0–1.5; tuned to the low end, see below) |
| `assist.critBonus` | +10% | like manual aim |
| `assist.reach`, `pad` | 32, +12 | world units (sim-side) |
| `assist.meterPerTap` | 2 | Overcharge meter per assist hit |
| `salvage.fromWave` | 2 | |
| `salvage.chance` / `eliteChance` / `bossChance` | 1.2% / 8% / 40% | own PRNG stream |
| `salvage.valueMin`–`valueMax` | 4–8× | the kill's Scrap |
| `salvage.lifeSeconds` | 5 s | kill → tower |
| `salvage.maxLive` | 6 | |
| `salvage.tapReach` | 56 | world units; the UI reach is ≥ 44 CSS px |
| `salvage.chainWindow` | 1.5 s | real time |
| `salvage.chainStep`, `chainMax` | +0.5, ×3 | |
| `salvage.passiveValue` | 40% | the passive collector |
| `overcharge.unlockWave` | 12 | max(deepest ever, deepest this run) |
| `overcharge.meterMax` | 100 | |
| `overcharge.meterPerHit`, `shotCapPerSecond` | 1, 2/s | ~50 s to fill from shots alone |
| `overcharge.perfectFrom`–`perfectTo` | 0.75–1.2 s | hold time |
| `overcharge.releaseLatency` | 0.3 s | a release reports the hold the player saw (the UI arc); accepted when at most this much below the sim's hold, never above it |
| `overcharge.maxHoldSeconds` | 2.2 s | auto-release (weak) |
| `overcharge.perfectMul` / `weakMul` | 4 / 2 | primary shots per enemy on the line |
| `overcharge.beamHalfWidth`, `beamLength` | 26, 560 | |
| `overcharge.staggerSeconds` / `weakStaggerSeconds` | 1.0 / 0.4 s | bosses: interrupt only |

## Controls (phone, one thumb)

| Gesture | Result |
| --- | --- |
| tap near a crate (≥ 44 px) | collect it (crates win in open ground: they are gone in seconds), unless the tap is on an enemy nearer to it than the crate: then the enemy tap below (a drifting crate never steals a designation) |
| tap an enemy | assist shot **and** designation (`designate_at`, unchanged) |
| tap the *same* enemy again within 0.9 s (≤ 48 px, and it is drawn with its reticle or moved ≤ 16 world units) | assist shot only: hammering never toggles the designation off |
| quick taps on two different enemies | each designates (two designators: both), as before |
| a lone tap on a designated enemy | clears it, as before |
| tap with an ability armed | casts it (unchanged; no assist) |
| hold on the tower (Overcharge ready) | charge; lift to fire |
| hold anywhere else | manual aim (unchanged) |
| Overcharge button (bottom-right, over the arena) | press-and-hold / release; keyboard Enter or O |

The button sits at the bottom-right of the arena, level with the ability row, and moves above the row when three or
four ability slots make the row wide. It shows when the sim has unlocked Overcharge (`UiState.active.overcharge.unlocked`)
**and** the unlock ladder reveals it (`ctx.features().overcharge`, src/ui/progression.ts; `overchargeShown` in
`src/ui/active.ts`). Both unlock at wave 12 (a unit test keeps `UNLOCKS.overcharge.wave` equal to
`ACTIVE.overcharge.unlockWave`); "Unlock everything" reveals the feature early, but the button stays hidden until the sim
would accept a charge. The tower hold needs the same feature. The ladder also gates the taps (`app/active-tap.ts`
`TapGates`): `tapAssist` (wave 0) for assist shots, `salvage` (the first boss, wave 5) for tap-collecting; on waves 2–4
crates already drift in and pay the passive 40%, and a tap near one is an ordinary field / enemy tap. Its ring shows the meter; while charging, a white arc sweeps once per
2.2 s and the timing window is the bright band; the label reads …, NOW, LATE. The arc follows the sim's hold (UiState,
extrapolated at most 0.15 s between updates), so on a slow device where the sim lags the wall clock, the button, the
in-world ring and the sim's timing agree. The `Ev.Overcharge` event carries `data.hold` (s) for the Inspector and tests. Coach lines (src/ui/coach.ts, live
explainers: shown only while their subject is on screen, after any unread stage message, and kept up until "Got it"):
`salvage` "Glowing crates: tap them for bonus Scrap. Quick taps chain." while a crate is on the field (from the wave-5
reveal), `overcharge` "Overcharge is full: hold the glowing button, let go in the bright band." when the meter is first
ready. The assist needs none: the stage-0 line already has the player tapping.

## Presentation

- Crates: a small gold diamond (layer 7, `aux1 = SALVAGE_MARK`) with a soft halo (layer 2) pulsing at ~1.2 Hz (under
  the 3 Hz flash rule) and a fuse ring that fades as the crate nears the tower; the field overlay redraws the diamond
  at least 7 CSS px wide with a 13 px ring so it is a thumb target on a phone.
- Assist: a tracer from the barrel for 9 ticks, a muzzle flash and hit sparks (snapshot fx from `Ev.Assist`).
- Overcharge: 12 meter pips around the tower (a glow when full), a charge ring growing toward a target band while
  charging, the beam (22 ticks), a shockwave and, on a perfect release, a camera punch (scaled to 0 by reduced motion).
- Floaters: "+1.2K ×2" rising from a collected crate (DOM, client px via the camera); passive collects show a small dim
  "+N". Under reduced motion they fade in place. No toasts. The floater anchor is a zero-size fixed box appended to
  `#ui`; base.css gives every direct child of `#ui` `pointer-events: auto` (`#ui > *`, specificity 1-0-0), so its rule
  is written `#ui > .salvage-floaters { pointer-events: none }` (1-1-0) and wins on specificity whatever the stylesheet
  order (a plain `.salvage-floaters` rule loses, and the layer swallowed canvas taps: found in the phone check).
- Sounds (`src/audio/sfx/active.ts`): `assist` crack, `salvage_pluck` (one pentatonic step up per chain link),
  `salvage_passive` tick, `overcharge_thump` (bigger on a perfect release).

## Measured active edge

Method: `sim-cli` Generalist, 4 sim-hours per climb, stop at wave 100 (the acceptance row's setup, with 6–12 seeds
instead of 3); attempts summed over the checkpoints both runs reached. `active:off` is the active policy without the
three pieces (`RunConfig.activeExtras = false`); a per-piece run uses only that piece (`activeExtras: ['assist']` …).
The active policy plays like a human: ≤ 2 taps/s in total, collects 70% of crates 0.35 s or more after they drop, taps
the boss / the designated enemy / the enemy nearest the tower, releases Overcharge at the window centre ± 0.3 s. The
idle policy never taps (it still gets the 40% passive collector).

The balance data changed several times while this was built (other passes retuned the early curve, bosses and
Prestige), and the edge of the *existing* active play (abilities, Counters, designation) moved with it: 24.0% at the
start of this work (seeds 1–3: 98 vs 129 attempts), 22–49% during it. So the three pieces are judged by what they add
on top of the existing active play, measured in the same code state, and tuned so that on top of the ~24% existing edge
the total stays inside 15–40%: 1 − 0.76 × (1 − m) ≤ 40% needs m ≤ ~21%.

| Tuning round | Assist | Salvage (ordinary / elite / boss) | Overcharge (meter/s from shots, perfect ×) | m: fewer attempts than `active:off` |
| --- | --- | --- | --- | --- |
| 1 (6 seeds) | 1.25×, 0.6 s | 5% / 35% / 100% | 4/s, ×5 | 26–37% |
| 2 (6 seeds) | 1.0×, 0.6 s | 4% / 25% / 100% | 3/s, ×5 | 14–36% (per piece: assist 5–19%, salvage 0–19%, Overcharge 2–10%) |
| 3 (6 seeds) | 1.0×, ≤ 35% of primary shots | 2.5% / 15% / 100% | 2/s, ×4 | 34% |
| **final (12 seeds)** | **1.0×, ≤ 15% of primary shots** | **1.2% / 8% / 40%** | **2/s, ×4** | **19.4%** (assist 12.6%, salvage 5.4%) |

Final measurement, 12 seeds, same code state:

| Run | Attempts over common checkpoints | vs idle |
| --- | --- | --- |
| idle | 249 | — |
| active, no new pieces | 163 | 34.5% fewer |
| **active, all three pieces** | **125** | **49.8% fewer** |
| active vs active without the pieces | 150 vs 186 | 19.4% fewer |

Reading it:

- In the current data the *existing* active edge is already 34.5%, so the total is 49.8%, above the band. With the
  existing edge at its pre-rebalance 24%, the same 19.4% gives 1 − 0.76 × 0.806 ≈ 39%: inside 15–40%. Bringing the
  existing edge back to ~24% is a job for the ability / CE balance, not these pieces; if it stays at ~34%, the knobs
  are `assist.maxPrimaryShare` (the biggest: the assist's value is mostly survival, killing leakers near the tower) and
  the salvage chances.
- The assist's measured value is not its DPS share (15% of primary shots early is a small share of total damage) but what it
  hits: the enemy nearest the tower, i.e. kamikazes and leakers. That is the kind of edge the pillar wants (attention
  pays), but it is why it needed the primary-share cap: at a flat 0.6 s it roughly doubled early primary fire.
- Idle vs active: all runs wall at checkpoint 25–30 in 4 h in the current data; idle is at most one boss behind active in
  all 12 seeds (s3 / s8: idle 25, active 30). Nothing here gates progress; the passive
  collector gives idle 40% of every crate it lets drift in.

Reproduce: a `tsx` script that runs `sim-cli/pool.ts` jobs `{ kind: 'attempt', cfg: { agent: 'generalist', policy,
activeExtras, seed, maxSimSeconds: 14400, stopAtWave: 100 } }` and sums `attemptsUpTo` (sim-cli/metrics.ts) over the
common checkpoint, or `npm run sim -- --agent generalist --policies idle,active --seeds 1,2,3,4,5,6 --hours 4 --stop-wave 100`.
