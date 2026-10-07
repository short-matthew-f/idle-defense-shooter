# Balance pass log

Scope: the first tuning pass against the §19 acceptance gate, starting from the untuned baseline in
`sim-out/BASELINE.md` (HEAD `dc35765`). Every constant changed is listed below with the value before,
the value after, why, and the measured effect. The formulas keep the design's shape (§17); only
constants, per-boss data and a few mechanics' caps changed. Bugs found in systems are listed
separately. The final gate is in `sim-out/tuned/accept.md` (the untuned gate stays in
`sim-out/accept.md`).

Measurement notes

- Quick loops used `npm run sim -- --agents … --hours 2.5–4 --report` (seeds 1–3) plus three scratch
  probes (per-system DPS in isolation, first-session purchase pacing, stuck-wave dump). Single-seed
  numbers move by roughly one checkpoint between seeds; treat differences under ~15% as noise.
- **Damage share now counts effective damage** (HP and shield actually removed), not dealt damage
  including overkill (`WorldImpl.damage` → `recordShare`). An 8,000-damage blast on a 50-HP enemy now
  counts 50. Before this change, every AoE that bursts pending DoT (Flashpoint, Toxic Combustion)
  looked 2–3× bigger than its kill contribution. This changes the *input* to the damage-share,
  Spend-efficiency and Build-health notes, not any test definition; Hit events still carry the full
  damage (Inspector and Codex are unaffected). It is called out here so nobody compares the
  baseline's shares to the tuned ones as like for like: Flashpoint in the untuned build measured
  85–97% raw and ~53–56% effective (Generalist, seeds 1–2).

## Changes

### 1. No single mechanic dominates (Flashpoint, fusions, DoT stacking)

| Knob | Before | After | Why | Effect (measured) |
| --- | --- | --- | --- | --- |
| `fire.wildfire.flashpoint` per rank (`data/elements.ts`) | 0.5 | 0.15 | Each eruption dealt 50–150% of the victim's *pending* Burn to everything in 60 u; pending Burn at high ranks is 10–100× the victim's HP | together with the rows below: Flashpoint 53–56% → 24–38% of effective damage (Generalist) |
| Flashpoint explosion falloff (`systems/elements.ts detonateFlash`) | `falloff: false` | `falloff: true` | edge targets took full damage | " |
| `fire.wildfire.flashpoint.source_cap` (new, `base-stats.ts`) | — | 0.35 | eruption damage ≤ 0.35 × the erupting enemy's max HP (it converts overkill Burn into AoE) | " |
| `fire.wildfire.flashpoint.target_cap` (new) | — | 0.12 | one eruption deals ≤ 12% of each target's max HP (new `maxHpCap` option on `World.explode`) | caps are what bind: 0.5/0.1 gave 16%, 0.5/0.25 gave ~50% |
| `fire.wildfire.flashpoint.inherit` (new) | 1 (implicit) | 0.5 | Burn passed on by a Flashpoint burns at half the victim's DPS, so Conflagration chains fade instead of re-erupting at full strength across the whole wave | " |
| `fusion.toxic_combustion` base / per rank | 1 / +0.5 (×1.5 at r1) | 0.25 / +0.25 (×0.5 at r1) | same pending-DoT-to-AoE pattern as Flashpoint | Toxic Combustion 65–69% → 19–26% (Elemental); still 76% in one Random run (see open issues) |
| `fusion.toxic_combustion.radius` | 80 | 60 | " | " |
| Toxic Combustion falloff / `target_cap` (new) | none | falloff, 0.15 × target max HP | " | " |
| `fire.burn_stacks` (Accelerant) maxRank | 12 | 7 (→ 4 after the rank scale below) | burn DPS is stacks × per-stack DPS; 15 stacks × 76% of the hit per second made Burn 5–10× the primary's own DPS | fire share in Elemental 28–33% |
| `fire.burn_damage` (Thermite) per rank | +8% | +6% | " | " |
| `poison.stack_cap` (Saturation) maxRank | 30 | 15 (→ 8) | 40 stacks × 30% of primary damage per second | poison still carries Survival (open issue) |
| `poison.damage` (Neurotoxin) per rank | +8% | +6% | " | " |

### 2. Every hardpoint matters

| Knob | Before | After | Why | Effect |
| --- | --- | --- | --- | --- |
| Gravitics base damage (`systems/gravitics.ts`, new `gravitics.damage` = 60 and a shared **Crushing Depth** node, +15%/rank) | wells dealt **0** damage without the Collapse Doctrine | every collapse crushes captives for `gravitics.damage × (1 + 0.15 × captives)`; Collapse multiplies it (`gravitics.collapse.implosion` base 0.5 → 1, so rank 1 = ×1.5) | the tree had no damage path before its fork, so hp_gravitics dealt 0% and walled at 19 | own share 0% → 45–68% (≤ wave 40: 27–30% once ordnance joins at 30); depth 19 → 52–61 |
| `blade.damage` / per rank | 8 / +8% | 20 / +15% | 0–1.5% own share in the dedicated build | own share ≤ w40 0% → 17–27% |
| `blade.length` | 60 | 140 | enemies rarely come within 84 u of a living tower | " |
| `laser.damage` / per rank | 12 / +8% | 60 / +15% | 0.1% own share | ≤ w40 0.1% → 12–17% (still short, see open issues) |
| `laser.radius` | 110 | 170 | the polygon sat inside the primary's kill zone | " |
| `drones.damage` / per rank | 6 / +8% | 16 / +15% | 0.8% own share | ≤ w40 0.8% → 31–35% |
| `ordnance.damage` per rank | +8% | +12% | parity with the other damage nodes | 38% → 45–55% |
| hardpoint damage nodes maxRank | 40 | 60 (→ 30 after the rank scale) | dedicated trees ran out while the primary + elements kept scaling | — |

### 3. Pacing, the wall and bosses (§3, §17, §18)

| Knob | Before | After | Why | Effect |
| --- | --- | --- | --- | --- |
| `ENEMY_HP_GROWTH` (`economy/curves.ts`) | 1.13 | 1.14 | enemies must outgrow Scrap (§3 "why a wall forms"); 1.15–1.17 walled non-fire builds at wave 19–23 (before any Echoes) | with the rows below: checkpoint median 4.2 → 8.3 min |
| `ENEMY_HP_BASE` | 10 | 7 | pairs with the 1.5× stat prices below so the first ten waves keep their pace | wave 10 at 13–32 min (seed-dependent) |
| `SCRAP_GROWTH` | 1.11 | 1.10 | BASELINE observation 2 (income outran every price) | — |
| Stat price growth (`data/builders.ts` `STAT_GROWTH_ADD`/`MAX`) | authored 1.16–1.22 | authored + 0.03, capped at 1.22 | late ranks kept costing nothing at wave-40+ income | — |
| Stat node depth (`STAT_RANK_SCALE`) | authored maxRank | ×0.5 (rounded up) | a build never ran out of stat ranks before wave 60–70, so the Echo rate rose for the whole 4-hour budget and never peaked; at half depth the first build's shop runs out around wave 45–55 and a §3 wall forms there | runs now stop at a real wall (40 min without a checkpoint) at 49–79 instead of running to wave 100; the Forecast recommends at the Echo-rate peak when the wall arrives inside the harness window |
| Stat base prices (`STAT_BASE_MUL`) | ×1 | ×1.5 | ~70–80 purchases in the first 10 minutes, one every 5–10 s (target ~30, one every 20–40 s) | 52–56 purchases in 10 min, median gap 15–18 s. ×2 hit 27–32 and 16–26 s but pushed wave 10 to 30–40 min and the wall past the harness window |
| Boss `hpMul` (`data/bosses.ts`) | 1 (finales 1.3) | 1, 0.75, 2.1, 2.7, 4.2, 4.9, 5.6, 7, 6.3, 7, 7.7, 9.8, 8.4, 8.4, 9.1, 11.2, 9.8, 9.8, 10.5, 12.6 (waves 5…100; Deep Graft 11.2) | 12 × one enemy's HP is a shrinking share of a wave as the Threat Budget grows (19 → 228 weight); past wave 20 bosses died in 15–25 s on the first attempt (design: 60–150 s) while ordinary waves did the killing | boss fights at 25+ now 25–100 s; finales stay ≥ 1.2× the boss before them |
| Broodheart hpMul / adds per phase | 1 / 12 brood + 6 swarm | 0.75 / 9 brood + 6 swarm | wave-10 Broodheart cost 9–18 attempts (17–22 min) | still the slowest early segment (9–14 attempts, 23–28 min; Greedy seed 2 walls there). 0.6 / 7 + 5 was tried and dropped: it moved enough downstream trajectories to lose Forecast, Checkpoint time and Anomaly cap (6 passes instead of 9) |
| Siege Engine hpMul | 1.3 | 2.7 on the new curve | at 4× it walled half the seeds at wave 19; 2.2 (with a softer Warden) let run 1 reach 64 and broke the Prestige chain (Push −10) | — |

### 4. Forecast

| Knob | Before | After | Why | Effect |
| --- | --- | --- | --- | --- |
| `isRecommended` window (`economy/forecast.ts`) | ≥ 5 waves of progress while ≥ 15% below the peak (`RECOMMEND_WAVES`) | ≥ one checkpoint cycle of **play time** while ≥ 15% below the peak; the cycle is the median time between this run's checkpoints, floored at 300 s (`RECOMMEND_MIN_CYCLE`, `checkpointCycleSeconds`) | design §3: "15% below its peak for one full checkpoint cycle". At a real wall no waves are cleared, so the wave-based window could never close (0 of 3 runs recommended) | recommends at the peak wave when the wall arrives early enough (e.g. 52 vs peak 52; chain 52 → 69 → 79, every run stopped on `recommended`) |

### 5. Prestige layer I (reclimb)

| Knob | Before | After | Why | Effect |
| --- | --- | --- | --- | --- |
| Accelerated Clearing base price (`data/prestige.ts`) | 15 Echoes | 1,500 | ×2/×4/×8 play speed on solved waves made every reclimb take 3–15% of the previous run. The first wall now sits at wave ~53, where a Prestige pays ~3,400 Echoes (the layer was priced for 15–40 Echoes at D 22–28), so AC was bought outright after run 1 | reclimb 2.7–3.9% → 29% / 25% (chain seed 1); without AC at all it was 23.5% / 56.8% |
| Layer-I stat nodes base price (Seed Capital, Memory of Steel/Motion, Boss Bounty, Checkpoint Dividend, Scrap Resonance, Hardened Core) | 5–10 | ×2 (10–20) | same over-payment; run 2 re-reached the old best in 23.5% | 23.5% → 29% |

### 6. Active play

| Knob | Before | After | Why | Effect |
| --- | --- | --- | --- | --- |
| Command Energy per ordinary kill (`world-impl.ts finishKill`) | 2 | 1 | active needed 56% fewer attempts than idle (target 15–30%), Directives closed 74% of the gap | quick gate: 23% fewer attempts; see final table |
| Ability costs / cooldowns | — | unchanged | the §10 table and `tests/data/content.test.ts` fix the CE costs; ×1.5 would also push Singularity Bomb (105) over the 100 CE cap | — |

### 7. Doctrines and Anomalies

| Knob | Before | After | Why |
| --- | --- | --- | --- |
| `ballistics.heavy.fire_rate` | 0.6 | 0.85 | Heavy Rounds walled at the wave-10 Broodheart (probe depth 9). The data value was ignored until the bug below was fixed; 0.75 still walled at 9, 0.8 gave 52/34 and 0.9 gave 52 (vs Multishot 28–29), 0.85 gives 34/34 | probe depth 9 → 34 (tree best) |
| `ballistics.heavy.base_size` | 1.75 | 2.5 | big rounds should clip swarms |
| `poison.venom.virulence` base | 0 | 0.03 | Venom did nothing until ranks were bought |
| Glass Cannon HP penalty (`data/anomalies.ts`) | `bastion.max_hp` mul −0.5 | new `bastion.max_hp_final` ×0.5 (applied after every other max-HP bonus) | the resolver adds muls, so with +150% Fortress HP the "−50%" was really −20% |
| Glass Cannon damage | +80% | +50% | with the HP penalty biting it still measured +20.6% depth (cap 15%); design §9 lists +80%, so this is a deviation from the design table | +20.6% → +2% |
| Unstable Isotope self-damage cap (`anomaly.unstable_isotope.self_cap`, new) | uncapped 10% of the explosion | ≤ 2% of tower max HP per detonation | with Flashpoint volume it stalled Prestige 3 for 290+ deaths |
| Ablative Coating / Matched Edges / Containment Field per rank | 1% / 1.5% / 2% | 2% / 3% / 4% | keep their promised maxima after the ×0.5 rank scale |

## Bugs fixed

- `src/sim/economy/forecast.ts` (`isRecommended`, new `checkpointCycleSeconds`): the recommendation
  window was measured in cleared waves, so it could never fire at a wall. Now measured in play time.
- `src/sim/systems/gravitics.ts` (`spawn`, ~line 150): wells formed on any enemy within 2,000 u. A lone
  shield-regenerating enemy beyond every weapon's range (r ≈ 400–640) was re-captured by a new well
  after every collapse and pinned forever: wave 27 never ended (hp_gravitics "walled" at 19–28).
  Wells now form only inside the primary's range and centre a quarter radius inward of the cluster, so
  captives are dragged toward the tower ("Wells drag enemies inward").
- `src/sim/systems/gravitics.ts` (`rebuild`/`collapseWell`): wells had no damage at all before the
  Collapse Doctrine (see table 2).
- `src/sim/enemies/generator.ts` (`comet_tail` layout): a single comet (≤ 40 picks) spawned its whole
  tail at 8-tick spacing, so the entire wave arrived in ~3.5 s. Wave 6 cost one seed 19–24 deaths.
  The tail now spans ~70% of the comet's share of the spawn window.
- `src/sim/core/world-impl.ts` (`damage`): damage share recorded overkill (see measurement notes).
- `src/sim/systems/ballistics.ts` (`rebuild`, ~line 78): Heavy Rounds hard-coded its fire-rate (×0.6), damage
  (×1.9), size (×1.75) and knockback (18) instead of reading `ballistics.heavy.fire_rate/base_damage/
  base_size/base_knockback`, so the data table (and every earlier tuning attempt on it) had no effect.

The hardpoint "0% damage" in the baseline was not an attribution bug: blade, laser and drone hits all
carry their system's `srcTag` (checked with an isolated DPS probe: at rank 0 each system cleared wave 6
about as fast as the primary). It was numbers, geometry (blade/laser inside the primary's kill zone),
the missing Gravitics damage path, and Flashpoint overkill drowning everything in the raw metric.


## Final gate (full `npm run sim:accept`, `sim-out/tuned/accept.md`): 9 pass, 7 fail

| Test | Result | Value (baseline → tuned) | Target |
| --- | --- | --- | --- |
| Checkpoint odds | FAIL | 62/67/69% → 35.3 / 47.1 / 55.9% (n=34) | 15–30 / 40–60 / 70–90% |
| Checkpoint time | PASS | 4.2 → 8.3 min median | 8–20 min |
| First wall | FAIL | never → recommended at 53 / 64 / 64 | 22–28 |
| Reclimb | PASS | 2.6% → 29% / 25.3% | 25–40% |
| Push | PASS | +28, −28 → +11, +15 (53 → 64 → 79) | +8–15 |
| Forecast | PASS | never → 0% off the peak (53/53, 64/64, 64/64) | ≤ 10% |
| Build health | FAIL | 19% → 73.3% (hp_blade 44 at F60; others 44–53) | ≥ 85% |
| Doctrine health | FAIL | 14.3% → 79.2% (reactor Overclock/Command 19 vs Synchronization 24; Wildfire 19 vs Inferno 24) | ≥ 80% |
| Spend efficiency | FAIL | 4 → 11 offenders (second-slot Drones 22–26% of spend for 1–9% of damage; Laser in Elemental/hp_laser) | 0 |
| Defense | PASS | 117.8% → 114.5% (79 vs 69) | ≥ 90% |
| Active edge | FAIL | 56.3% → 36.2% fewer attempts; idle ends 1–5 bosses behind active | 15–30% and idle within one boss |
| Directive gap | PASS | 73.8% → 59.4% | 40–70% |
| Formation fairness | FAIL | 11/216 → 33/144 unfair template-bands (mostly blade/laser at band 1, poison at band 6) | 0 |
| Anomaly cap | PASS | Glass Cannon +23% → max +5.1% | ≤ 15% |
| Offline | PASS | 40% | ≤ 40% |
| Determinism | PASS | identical hashes | — |

Damage share (effective damage, whole run / waves ≤ 40), seed 1 idle unless noted:

| agent | depth | whole run | waves ≤ 40 |
| --- | --- | --- | --- |
| Generalist s1 / s2 / s3 | 53 / 64 / 64 | fire 47–61%, fusion 17–20%, ordnance 12–22% | ordnance 28–38%, fire 19–34%, ballistics 17–28% |
| Elemental | 53 | fire 47%, Toxic Combustion 20%, drones 17% | fire 46%, ballistics 18%, fusion 12% |
| Greedy s1 / s3 | 69 / 69 | fire 34–39%, lightning 25%, ordnance 16–19% | ordnance 37–43% |
| Survival s1–s3 | 77 / 89 / 79 | poison 55–60%, Cryotoxin 36–38% | ballistics 30–32%, poison 23–31%, drones 26–30% |
| hp_ordnance / drones / blade / laser / gravitics | 52 / 52 / 54 / 52 / 53 | own 44 / 12 / 3 / 2 / 10% | own 55 / 39 / 23 / 18 / 31% |

Flashpoint alone: 24–30% of effective damage in the Generalist (was 85–97% raw, ~55% effective).

First-session pacing (Generalist idle, seeds 1–3): 52–56 purchases in the first 10 minutes (was
70–90), median gap to wave 10 15–18 s (p90 28–32 s; was 8–11 s), wave 10 at 25–32 min (was 19–24).

## Open issues and suggested next steps

1. **First wall (22–28) is structurally out of reach of this economy.** The Echo rate
   `10·1.2^(D−20)/t` only peaks when a checkpoint takes about 0.9× the time already played. A smooth
   HP-vs-price economy never produces that at wave 25 (checked with enemy HP growth 1.13–1.17, boss HP
   ×2.5, and Echo bases 1.08–1.2 applied to recorded runs: the peak stayed at the end of every run).
   The wall now comes from shop exhaustion (`STAT_RANK_SCALE`): ×0.5 → wave 53–64, ×0.3 → wave 34–44.
   Getting 22–28 needs ~×0.15–0.2 (stat trees of 4–8 ranks), which makes the shop trivial, or the
   design's layer-I prices and first-Prestige Echo payout re-based on a deeper first wall. Recommend a
   design decision: either accept a first Prestige around wave 45–55 (and re-base §3/§14 numbers on
   it, as done here for Accelerated Clearing) or gate the first wall on content (e.g. the wave-25/30
   boss as a hard DPS check, the second attunement/hardpoint slots after it).
2. **Checkpoint odds are bimodal.** A wall segment (10, 20, 30: 9–21 attempts) is followed by a
   one-attempt segment (15, 25: the build overshoots while farming the wall). Most deaths still happen
   on specific ordinary formations (radial ring, kamikaze ring, synchronized burst, staggered lanes),
   not at bosses. Next: put the measured Difficulty multipliers into `data/formations.ts` (blocked:
   the measured values contradict the §12 counter map that `tests/enemies/data.test.ts` encodes, e.g.
   Tightening Spiral is easy, not hard, for Lightning), then raise boss HP further once ordinary waves
   are flat.
3. **Build health (73%)**: hardpoint agents all stop at 52–54 (their trees run out before the wave-55
   slot); the best agent is Survival at 77–89 on Poison + Cryotoxin. Blade and Laser deal 18–23% of
   damage by wave 40 but ~2–3% overall because they only touch enemies that get close and have no
   native element. Next: nerf Poison stacking/Cryotoxin (Survival is now the outlier), and give
   Blade/Laser native element procs or larger Infusion values.
4. **Spend efficiency**: the offenders are almost all the *second* hardpoint (Drones) in non-drone
   builds, plus Survival's Drones on the Support Doctrine (heals/shields, never damage by design). The
   row judges damage only, so a support Doctrine will always fail it; consider exempting Support or
   counting HP restored.
5. **Active edge (36%) / idle behind**: abilities give active runs power beyond the capped shop, so
   active walls 10–25 waves deeper. CE per ordinary kill 2 → 0.5 brought the edge to 26% but dropped the
   Directive gap to 33% and moved Build health/Forecast out of range; left at 1.
6. **Doctrine health (79.2%)**: 1-hour probes mostly stop at the wave-20 Siege Engine (19) or pass it
   (24); the 80% line sits exactly between. A softer Siege Engine (2.2) plus stronger drones broke the
   Prestige chain, so it was reverted.
7. **Formation fairness got worse (11 → 33 unfair)** because Blade and Laser now matter and are
   geometry-sensitive at band 1–3; Poison at band 6 is noisy (few archetype builds reach it).
8. Greedy seed 2 walls at the wave-10 Broodheart (16 deaths). The Broodheart remains the hardest early
   segment.
9. The acceptance chain and Forecast rows are knife-edge: small data changes move run 1's wall by one
   boss and flip Forecast/Push. Single-seed rows (chain, Build health, probes) need more seeds before
   they can gate.

## Onboarding pass (first Prestige at wave ~28) — 2026-09-30

Goal (owner-approved): layer features in progressively and land the **first Prestige at wave ~25–30 after
~25–40 minutes** of engaged idle play (it was recommended at wave 53–64, and in the build this pass started
from, at 69 after 2+ hours or never). Early bosses should not take more than ~3 attempts, and stage 0 of the UI
unlock ladder (`src/ui/progression.ts`: only Damage, Fire Rate and Hull until the wave-5 boss) should give a
purchase every 20–40 s instead of a flood of tiny buys.

Measured with scratch probes (idle Generalist / Greedy, seeds 1–3, 1.5 sim-h each; a stage-0 agent that only buys
the three starter lines; a Prestige chain probe using `sim-cli/runner.ts runPrestige`) and the full
`npm run sim:accept`. "Before" is the build this pass started from (HEAD `54610e4` + other agents' WIP), not the
first balance pass above: boons and other features had already moved it (Generalist walls 69–79).

### Why a Frontier, not shallower stat lines

The first attempt followed open issue 1 above: stat-rank depth scaled by Prestige progress (P0 lines at 15–25% of
their authored depth, deepening with lifetime Echoes). It does not give a clean first wall:

- the approach to the wall is gradual (lines exhaust one by one; mechanics, fusions, linkages and infusions keep
  absorbing Scrap), so waves 20–30 crawl and the Echo-rate peak drifts: depth 0.3 → recommended 24–34 at 57–88 min,
  depth 0.45 → 34–44 walls, with 7–17 attempts on single bosses;
- at the depths that wall near 28, the three stage-0 lines hit "Max rank" around wave 8–10 — exactly the wrong
  lesson for a new player;
- enemy HP is not what bounds a wave-28 build: waves 29–31 at ×1.35, ×1.8 and even ×2.5 HP per wave were still
  cleared (percent-of-max-HP effects: Flashpoint caps, burn, Toxic Combustion), so gentler cliffs leak.

So the wall is explicit: **the Frontier**. Enemies on waves past it get `FRONTIER_GROWTH`× HP per wave beyond it
(every spawn of the wave, boss included; applied by the wave generator's `hpScale`, so Clumps inherit it). It sits at
wave 28 until the player has earned Echoes, then 10 waves past the depth their **lifetime Echoes** (bank + spent on
Prestige nodes) are worth: `frontier = max(28, round(20 + log1.2(E/10)) + 10)`. A first Prestige from 28 (42
Echoes) moves it to 38, a second from 39 to ~49, a third to ~61. Lifetime Echoes only change at a Prestige, so it is
fixed within a run; spending never moves it; Prestiging early (wave 20: 10 Echoes) only moves it to 30. Trials have
no Frontier. Waves at or before the Frontier are the tuned game, unchanged.

The Forecast now carries `frontier` / `nextFrontier`, and its banner names the wall at the Frontier: "Prestige
recommended: past wave 28 (the Frontier) enemies harden fast. Prestige for 42 Echoes and the Frontier moves to
wave 38." (`src/ui/forecast.ts`, a small change in a UI file.)

### Knobs

| Knob | Before | After | Why | Measured |
| --- | --- | --- | --- | --- |
| Frontier (new; `economy/curves.ts` `FRONTIER_FIRST/STEP/GROWTH`, `economy/prestige.ts frontierWave`, `enemies/generator.ts` option `frontier`, passed by `run/machine.ts startWave`) | none | wave 28, +10 past the lifetime-Echo depth, ×3.5 HP per wave past it | a hard, explainable first wall at 28–30 that moves ~10 waves per Prestige (design §3: push 8–15) | ×1.35 / ×1.8 / ×2.5 leaked to 32–37; ×3.5: every Generalist/Greedy run is recommended at 28 (a few clear the ×12 boss at 30 after 13–21 attempts, never enough to move the Echo-rate peak) |
| `ENEMY_HP_BASE` | 7 | 6 | ~1.2 waves of headroom everywhere; fewer early deaths | with the rows below: wave 20 at 15–17 min (was 40–44) |
| Tower base max HP (`data/base-stats.ts`) | 100 | 150 | the wave-5 Breaker cost 1–4 attempts with three starter lines; a new player's first boss should be first-try | Breaker 1 attempt on every Generalist/Greedy/stage-0 seed |
| Caliber / Autoloader / Hull Plating (`data/chassis.ts`) | +8% / +5% / +15 per rank, base 10 / 12 / 10, growth 1.17 / 1.17 / 1.16, authored max 60 | +16% / +10% / +30 per rank, base 20 / 24 / 20, growth 1.19, authored max 30 | "fewer, bigger buys" for stage 0: half the purchases for the same power; the maxed line is unchanged (+240% / +150% / +450 at 15 ranks) | stage 0 (three lines, wave 1 → first boss at ~2 min): buys at 23, 42, 61, 74, 88 s (was 15, 23, 35, 45, 60, 66, 73, 91, 97 s); waves 1–4 need nothing, the three lines alone clear the wave-10 Broodheart at 4.3–4.8 min. Base 30–40 hit 10–12 buys in 5 min but starved the Generalist (it buys the cheapest rank per tree: Caliber 2 at wave 10, Broodheart 11–13 attempts) |
| Memory of Steel / Motion | 2 free ranks per rank | 1 | ranks are twice as big | — |
| Breaker hpMul (wave 5) | 1.0 | 0.8 | first boss | 1 attempt, 2.0–2.1 min |
| Broodheart (wave 10) hpMul / speed | 0.75 / 12 | 0.45 / 8 | deaths came from the boss reaching the tower while the primary shot hatchlings (boss contact 66–79% of tower damage, boss at 100% HP on several deaths); slower approach + less HP | Generalist 3–4 attempts (incl. deaths on waves 6–9), 8–10 min; Greedy 1–4 |
| Warden (wave 15) hpMul | 2.1 | 0.5 | keep the finale ≥ 1.2× the boss before it (`tests/enemies/data.test.ts`) after the Siege Engine drop | 1 attempt |
| Siege Engine (wave 20) hpMul / kamikaze adds per phase | 2.7 / 6 | 0.6 / 3 | the tower died 10–25 s into the fight (ram 128 + volleys + a kamikaze burst at the phase change) with the boss at 50–60%; 6–16 attempts. HP 1.6 and 1.0 barely helped; 0.6 halves the fight | Generalist 1–2 attempts, Greedy 1–8 |
| Iron Maw (wave 25) hpMul | 4.2 | 2.2 | 20→25 took 12–16 min and fired the recommendation at 23–24 | 1 attempt, 2–3 min |
| Accelerated Clearing prices (`data/prestige.ts AC_PRICES`) | 1,500 × 1.5^rank | flat 10 / 1,500 / 60,000 | ×2 is the first Prestige's headline pick (it is what makes the 25–40% reclimb reachable), ×4 / ×8 are late sinks (each would cut a reclimb to a few % of the run) | reclimb P2 28–36%, P3 26–31% (seeds 1–3) |
| Seed Capital | 150 Scrap per rank | 400 | a visible head start (a ×2-size Caliber rank costs 30) | — |
| Seed Capital / Memory timing (`economy/prestige.ts buyPrestige`) | applied at the next Prestige start | also applied at once if bought before the current run has cleared a wave (not in Trials) | Echoes arrive at a Prestige, so the first picks used to do nothing until the Prestige after | chain runs start with them |
| Layer-I stat prices (Seed Capital 10, Memory 16, Boss Bounty 12, Dividend 20, Resonance 10, Hardened Core 10), Echo formula | — | unchanged | 42 Echoes at D 28 buy 4 picks (Scrap Resonance, Hardened Core, Accelerated Clearing, Seed Capital) | first shop: 4 picks, 2 Echoes left |

Unchanged on purpose: `ENEMY_HP_GROWTH` 1.14, `SCRAP_GROWTH`, `STAT_RANK_SCALE` 0.5, `STAT_BASE_MUL` 1.5 (×2 made
Warden and Siege Engine 5–7-attempt walls again and pushed the recommendation to 63–80 min), the Echo formula
(10 · 1.2^(D−20) pays 42 at D 28), first clears ×3, checkpoints, seeded PRNGs and cause ids.

### Early pacing (idle, first Prestige; minutes of play to first clear)

| run | 5 | 10 | 15 | 20 | 25 | 30 | first recommendation | purchases, first 5 min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Generalist s1 before | 2.0 | 9.3 | 20.0 | 43.8 | 46.5 | 54.2 | wave 69 at 128 min | 36 |
| Generalist s2 before | 2.1 | 10.1 | 21.0 | 41.3 | 43.9 | 57.6 | never (wall 79) | 38 |
| Generalist s3 before | 4.3 | 12.1 | 20.3 | 40.2 | 43.1 | 63.1 | wave 69 at 138 min | 29 |
| Generalist s1 after | 2.0 | 10.4 | 12.6 | 15.1 | 17.6 | 45.7 | **wave 28 at 30 min** | 41 |
| Generalist s2 after | 2.1 | 10.3 | 12.7 | 17.3 | 19.7 | 50.9 | **wave 28 at 32 min** | 43 |
| Generalist s3 after | 2.1 | 10.5 | 13.0 | 16.6 | 19.6 | — (wall) | **wave 28 at 35 min** | 42 |
| Greedy s1–s3 before | 5.8 / 4.1 / 8.2 | 14.1 / 11.5 / 31.4 | 28.1 / 26.8 / 36.0 | 53.2 / 45.7 / 59.4 | 63.7 / 59.6 / 71.1 | 75.6 / 69.8 / 86.5 | 34 at 105 min / 69 / 69 | 18 / 24 / 15 |
| Greedy s1–s3 after | 2.0 / 2.1 / 2.1 | 9.1 / 4.6 / 10.1 | 11.1 / 6.9 / 12.3 | 13.4 / 16.6 / 27.7 | 15.5 / 20.7 / 29.7 | — | **28 at 29 / 34 / 43 min** | 32 / 50 / 33 |

Attempts per checkpoint after (Generalist s1–s3): 5: 1/1/1 · 10: 4/3/4 (includes deaths on waves 6–9) · 15: 1/1/1 ·
20: 1/2/2 · 25: 1/1/1; then 13–21 attempts at the Frontier. Greedy: 10: 3/1/4, 20: 1/5/8.

Purchase cadence: the Generalist still buys 41–43 times in 5 min (median gap ~6 s): it buys the cheapest rank in
every open tree and all Chassis lines open at wave 5. The stage-0 player (three lines) buys 5 times before the
first boss (~2 min, 19–20 s apart), then 11–14 more in the 3 minutes after it (the first boss pays ×3 first-clear
Scrap plus its bounty): 16–19 in the first 5 min, median gap 11–17 s. That is the "~8 decisions" target only for
stage 0; see the follow-ups.

Wave 5 now falls at ~2 min, below the 3–5 min target: waves 1–4 last ~25 s each and nothing kills the tower
before the first boss. Slowing it would take longer early waves (generator) rather than weaker purchases.

### First Prestige and the chain (idle Generalist, `runPrestige`, Echoes spent cheapest-first)

| seed | P1 | P2 | P3 | P4 |
| --- | --- | --- | --- | --- |
| 1 | 28, rec at 30 min, 42 Echoes → 4 picks | 39 (+11), reclimb 33.1% | 51 (+12), reclimb 31.2% | 63 (+12), reclimb 48.6% |
| 2 | 28 at 42 min | 39 (+11), 28.1% | 51 (+12), 26.0% | 64 (+13), 44.5% |
| 3 | 28 at 35 min | 39 (+11), 36.1% | 52 (+13), 28.1% | 64 (+12), 42.0% |

Before (first balance pass, `sim-out/tuned`): 53 → 64 → 79, reclimb 29% / 25.3%, 3,400+ Echoes at the first
Prestige. The P4 reclimb (42–49%) is outside the §3 band but outside the harness (a 3-Prestige chain); it comes from
P3 walling sharply after ~25 min, so the ratio's denominator is short.

## Forecast at the Frontier (UX Phase 2) — 2026-10-05

**Report (owner, first Prestige):** at the Frontier the death card said "A Prestige pays here" while the Forecast still
said not yet. The owner's save (deepest 28 = Frontier, 21.8 min of play, 43 Echoes due) loads with
`recommended: false`; the rate rule (≥15% below the peak for one checkpoint cycle, ≥ 300 s) lags the Frontier wall by
several minutes, because the Frontier's ×3.5 HP per wave stops progress at once while the rate decays slowly.

**Rule added** (`economy/forecast.ts frontierRecommends`, also used by the `forecast_recommends` Directive condition):
`recommended` is also true, from wave 20 on and outside Trials, once

- the tower has died on a wave **past** the Frontier this Prestige (`run.deepestDeath`, set by the run machine on every
  death, saved), or
- the Frontier wave is cleared and the Echo rate has stopped rising (≥ `FRONTIER_FLAT` = 2% below its peak).

The rate rule is unchanged and still covers everything that is not a Frontier wall.

| Measure | Before | After | How |
| --- | --- | --- | --- |
| Owner's save (loaded, idle, seed 1) | not recommended at 21.8 min | not recommended on load; **recommended at 23.3 min** (first death, wave 28; rate 110.7/h vs peak 113.1/h) | simulator, `tests/progression/forecast-frontier.test.ts` |
| First wall (full `sim:accept`, s1–s3) | wave 28, 28, 28 | wave 28, 28, 28 | simulator |
| Forecast row | worst 0% off the peak wave | worst 0% off the peak wave | simulator |
| Chain run 1 (Generalist s1) stops at | wave 28 after 44.0 min of play | wave 28 after **33.0 min** | simulator (`accept/chain.json`) |
| Chain run 2 stops at | wave 39 after 36.7 min (its Echo-rate peak was wave 38) | wave 38 after 19.8 min (peak 38) | simulator |
| Push | +11, +12 (28 → 39 → 51) | +10, +11 (28 → 38 → 49) | simulator |
| Reclimb (time to the previous best ÷ the previous run's time) | 35.2%, 28.5% (PASS) | 39.8%, 54% (**FAIL**) | simulator |

**Open: Reclimb.** The reclimbs themselves did not get slower (absolute: 15.5 → 13.1 min, 10.5 → 10.7 min); the
ratio rose because the denominator lost the minutes the old rule spent waiting at the wall (44.0 → 33.0 min,
36.7 → 19.8 min of play). The 25–40% band was calibrated on runs that included that lag. Either the band is re-baselined against
wall-free run times, or the Frontier rule waits longer; the second brings back what the owner reported. Decision for
the owner. Every other row is identical to master and to the branch before this change (full `npm run sim:accept`, 3
seeds; master 12/5, branch before 12/5, after 11/6: the new failure is Reclimb).

**Harness fix (same pass).** The Prestige-chain report printed `echoes +3` at wave 28 where the game pays 43: it
took the bank delta after `spendEchoes` had spent 40 of them. `sim-cli/runner.ts prestigeOnce` now records the
payout before anything is spent (`PrestigeChainResult.paid`), and the note reads `echoes +43 (bank 3 after buying 4
nodes)` (`tests/accept/harness.test.ts`).

## Stalls and knockback

**Report (owner, many Prestiges deep):** waves could not be finished although damage was fine: knockback carried
enemies out of reach and their shields were back up before they walked in again. 20 minutes of idle play did not end the
wave.

**Cause.** Every push went straight into the enemy's position with no limit: stacked Heavy Rounds, Repulsor Pulse (every
5 s), Orbital Blade hits and the Shockwave Shield could carry an enemy to the arena rim and beyond the weapons' reach.
Shielded / shielded_elite shields regenerate after 3 s without damage and Regenerating elites heal 1.5% max HP/s after
1 s, wherever the enemy is. Walking back took longer than the regeneration, so the net progress was zero.

**Reproduction** (scratch probe, wave 62–97, seeds 1–2, 20 sim-minutes per run, a knockback build with the same damage as
a no-knockback build; "ratio" = clear time with knockback ÷ without):

| Probe | Before: uncleared in 20 min | Before: ratio | After: uncleared | After: ratio |
| --- | --- | --- | --- | --- |
| Shielded wave | 13 of 16 | 9.2× | 0 of 16 | 1.00× |
| Shielded elite wave | 0 of 16 | 1.26× | 0 of 16 | 1.00× |
| Regenerating elite wave | 0 of 16 | 1.28× | 0 of 16 | 1.00× |
| Real generated wave | 8 of 16 | 1.62× | 2 of 16 (the anti-stall Rush fired in 4 runs) | 1.41× |

The two real-wave runs still open at 20 min are low-damage probes whose waves are damage-limited rather than stalled; the
numbers above are from a probe, not from a full acceptance run.

**Fixes** (all knobs are base stats, `data/base-stats.ts` `knockback.*` / `wave.*`):

- `core/forces.ts` is the single entry point for every push. Outward pushes never carry an enemy past 0.85 × the primary's
  range or the arena rim; an enemy already beyond that is not pushed farther. Repeated outward pushes inside 2 s fade
  ×0.5 each (floor 10%). Bosses ×0.15, Clumps ×0.3, elites ×0.5 as before. Pushes toward the tower are unaffected.
- `enemies/recovery.ts`: a pushed enemy walks back at ×2 speed ("rally") until it is where it was first pushed from.
  Shield and HP regeneration only work inside the primary's range, not within 3 s of a push and not while Rushing: shields
  punish low damage, not distance.
- Weapons keep their target for 1 s after it was pushed (`core/targeting.ts`), so a push does not make the gun switch.
- `run/stall.ts` anti-stall invariant: 10 s of counted ticks without progress (no net HP/shield removed from the enemies
  alive at the last progress point), with every spawn out, no boss tell live, a tangible enemy in reach or none walking in,
  makes every living enemy and every later spawn Rush: speed ramps to ×3 over 8 s, pushes do ≤ 25% and nothing regenerates.
  One `Ev.Rush` (src `wave.rush`) is emitted per wave with the cause chain to the wave start; the feed shows "Stragglers
  rush the tower" (rate-limited). The upper bound for a wave that has stalled is therefore the stall time (10 s) + the
  ramp (8 s) + the walk in at ×3 speed.
- **Boss waves (UX Phase 1, C-05).** While the boss lives its brood never counts as progress, so a boss nobody damaged
  used to turn the whole wave, brood included, into a ×3 swarm. Now the first 10 s stall only makes the **boss step in**:
  it alone Rushes (speed ramp, ≤ 25% of pushes, no shield / heal), drops its scripted movement and hold distance and
  walks to contact (`enemies/ai.ts`, `enemies/steering.ts`), with one `Ev.Rush` src `boss.step_in`; the clock restarts.
  If the boss still makes no progress for another 10 s, or once it is dead and the rest stalls, the whole wave Rushes as
  above. Bound for a stalled boss wave: 2 × 10 s + the ramp + the walk in. `UiState.wave.stalled` is `'boss'` after a
  step-in, `'wave'` once the wave Rushes, else null; it stays set through `dead` until the next attempt, so the death
  card can say "The Broodheart wasn't taking damage".

**Tests:** `tests/core/forces.test.ts` (rim and reach caps, stacking, inward pushes), `tests/enemies/stall.test.ts` (the
regeneration gate: outside the range, inside the range and 3 s after a push; the Rush starts at 10 s and not before; a
knockback-heavy build clears a Shielded wave as fast as one without); `tests/core/phase1.test.ts` (the boss steps in
alone, then the wave Rushes if nothing changes; non-boss waves unchanged). The existing behavior tests set the primary's range
explicitly because regeneration now needs it.

## Acceptance harness fixes (wip/harness-fixes)

- Active edge now passes at 15–40 % (the agreed band, docs/ACTIVE.md); it was 15–30 % in the harness.
- `sim:accept --quick` reports First wall, Forecast, Active edge and Directive gap as SKIPPED (quick climbs end before the first Prestige; one seed and a few attempts cannot judge the edge). Full mode is unchanged.
- Full mode runs the Prestige chain on every seed (1, 2, 3); Reclimb and Push are gated on the per-Prestige median across seeds, per-seed values are in Notes. Quick mode keeps one seed and marks them "indicative". Full run: Reclimb s1 39.8/54 %, s2 62/34 %, s3 44/40.7 % (median 44 %, 40.7 %: FAIL, band widening is the owner's call); Push +10/+11 on all seeds (PASS).

## Acceptance targets re-set with the owner (2026-10-06)

The balance round (simulator, master b28347a) proposed no game tuning: the remaining failures were targets that
predate the onboarding goals. The owner decided:
- **Checkpoints:** "Bosses at 10 and 20 can be hard." Broodheart (10) and Siege Engine (20) take 4–5 idle attempts and
  are where the Active edge is earned; the checkpoint after each falls first try. *Checkpoint odds* now asks for: the
  first boss first try, the hardest checkpoint before the Prestige recommendation within 6 attempts (median over
  seeds; full run 5/5/8, the 8 being seed 3's Siege Engine, under 11 min), and at least one wall (≥ 3). *Checkpoint time* asks for the first Prestige recommended at 25–40 min of play and no pre-Frontier checkpoint
  over 20 min (skipped in quick mode). The old 15–30 / 40–60 / 70–90 % first-try odds and 8–20 min median are retired.
- **Reclimb:** no published industry figure exists; familiar idle games land around a third to a half of the previous
  run early on, falling as speed-up upgrades stack. Target: 25–50 % of the previous run's time, not rising from one
  Prestige to the next (+5 points of noise), and never more than 20 min of play (medians over seeds).

## Spend efficiency and formation fairness (2026-10-07)

The two rows that still failed after the balance round (simulator, full `npm run sim:accept`, seeds 1–3, master 7336b12).

**Formation fairness: measurement noise (harness fix).** Each template × archetype × band cell was measured on 2
waves. Re-measured on the same archetype builds with 6 and 10 waves per cell, no template-band is unfair (worst ×1.48
and ×1.36, both kamikaze_ring band 1 laser); synchronized_burst b2 gravitics fell from ×1.68 to ×1.32–1.39.
`sim-cli/difficulty.ts FULL_DIFF.seedsPerCell` 2 → 10. Before 3/52 unfair, worst ×1.681; after 0/52, worst ×1.362.

**Spend efficiency: two attribution artifacts and one real weakness.**
- *Fusion damage* was credited to the `fusion` spend key (one cheap rank) although it is made of the elements'
  stacks: Toxic Combustion detonates the Poison it consumes. The spend comparison now splits Fusion / Triad damage
  evenly over the Fusion's elements (`metrics.damageBySpendTree`; the per-system damage report is unchanged).
  Elemental poison: 1.8% → 7.5% of damage.
- *Scaling and carrier trees.* Caliber (ballistics.damage) scales Poison, Burn, Fusions and abilities; hardpoint
  hits apply the attuned elements, whose damage is credited to the element. A share alone cannot judge them. Full
  mode now confirms each flagged system with a counterfactual (`sim-cli/counterfactual.ts`): from the end-of-run save,
  6 waves at the deepest cleared wave (enemy HP ×4 so the fight is damage-limited) are fought with the full build and
  without that system's Scrap-bought ranks; contribution = 1 − t_full / t_without. A flagged system stays an offender
  when its ranks give < 10% of the build's summed contribution. Random ballistics: 18.5% (cleared); Optimizer
  ordnance: 58%, its most valuable tree (cleared); Elemental poison: 2.4% (confirmed).
- *Poison under Toxic Combustion is a real weakness.* With Toxic Combustion off, Poison gives 12.1% of the
  Elemental agent's damage; with it, 7.5%. Burn applied to 5+ stacks consumes them for ×0.5 of their remaining damage
  at rank 1, so the Fusion destroys half the Poison it touches. **Applied (owner, 2026-10-07: "Definitely make poison feel like a valid choice"):**
  `data/base-stats.ts 'fusion.toxic_combustion'` 0.25 → 1.75 (rank 1 ×0.5 → ×2.0, +0.25 per rank; the 15% max-HP cap
  per target is unchanged, so bosses still take at most 15% per explosion). Elemental poison 7.5% → 12.2%; depth 29 in
  every variant tried (×1.0: 9.5%, ×1.5: 10.1%, ×2.0: 12.2%).

| Row | Before | Harness fixes | + tuning |
| --- | --- | --- | --- |
| Spend efficiency | FAIL, 3 offenders | FAIL, 1 (elemental poison) | PASS, 0 |
| Formation fairness | FAIL, 3/52, worst ×1.681 | PASS, 0/52, worst ×1.362 | PASS |
| Every other row | — | identical to before | identical to before (Determinism 143e1846) |

Directive gap (closes 75%, target 40–70%) still fails; it was not part of this pass. Full `sim:accept` wall time
438 s → ~720 s (the counterfactual and the larger difficulty grid).

## Directive gap: measure the real automation (2026-10-07)

**Problem.** The Directive gap row compared fresh-start climbs. Without `prestige.directives` or `prestige.autocast`
the directive policy fell back to an emulated caster ("one affordable ability at the largest group every 3 s"), so the
game's Directive engine and Autocast never ran (1 Counter in 6 seeds).

**Fix (harness only, `sim-cli/`).** The row now starts all three climbs from the same state (`runner.ts
automationStart`): the Generalist's real first Prestige (climb to the recommendation, `prestige`, Echoes spent by
`spendEchoes`, i.e. Prestige 2 of the chain) plus Autocast rank 1 and Directives rank 1. Idle and active leave the
automation off (Autocast off for every ability, no Directives); the directive policy slots Repulsor Pulse and
Bombardment and installs a 3-rule set (`policies.ts AUTOMATION_DIRECTIVES`: designate an open weak point on boss
waves; Repulsor Pulse at 5+ in the inner ring; Bombardment into groups of 10+). Full mode, 6 edge seeds; quick mode
skips it. The old fresh-start row is kept as **Lazy caster (reference)**, reported, never gating.

- *Ranks are an idealisation.* Autocast is a Prestige II node (80 Echoes, opens at deepest-ever wave 40) and Directives a
  Prestige III node (1500 Echoes, opens at wave 60); a real owner of both is several Prestiges in. The first Prestige pays
  ~43 Echoes at wave 28, so the layer gates are bypassed on purpose: the row measures the automation on the same
  checkpoints the Active edge row uses, not a wave-60 player's whole meta.
- *No Counters.* Without Autonomy (Prestige IV, 50,000 Echoes) no rule can read a boss tell (`boss_tell_active` is an
  Adept condition), so rules and Autocast spend CE blind and are rarely ready inside a 1–1.5 s tell window; Autocast's
  Hunter Mark skips a boss that is already marked. Measured: 0 Counters in 495 tells. The engine's Counter path itself works
  (`tests/accept/automation.test.ts`: with Autonomy, a `boss_tell_active` rule scores at 50%).

| Row (full `sim:accept`, seeds 1–3, edge seeds 1–6) | Value |
| --- | --- |
| Directive gap (real automation) | FAIL, closes 37.9% (attempts idle 117, directive 106, active 88; directive casts 1598, Counters 0/495) |
| Lazy caster (reference) | closes 53.8% (idle 156, lazy 135, active 117), the old row's value |
| Every other row | identical to master 148be94 (Determinism 993e9175) |

Other rule sets on seeds 1–2 (attempts to wave 60, idle 78, active 65): this set 75; designations only + Autocast 54;
Hunter Mark + Repulsor sets 74–81; Hunter Mark + Bombardment 67. Per-seed noise is several attempts, so the set was not
picked on these numbers.

## Spend efficiency on seeds 7–12: Elemental Poison (2026-10-07)

`sim:accept --seeds 7,…` judges Spend efficiency on seed 7 only. The offender is the Elemental agent's Poison: spend 27.4%,
damage 9.7%, counterfactual 3.2% of the build's contribution (6 waves; 8.1% on 12 other waves). Re-measured on seeds 1–3
and 7–12 (simulator): Poison takes 21–28% of spend everywhere; its damage share is 5.7–15.5% (under 10% on seeds 3, 7, 8)
and its counterfactual share 3.2–11.3% (under 10% on 7 of 9 seeds). Not a measurement bug and not a one-seed fluke:
Poison ranks are still weak for their cost after the Toxic Combustion change; seed 1 (the default gate) sits just above
the line. Toxic Bloom boon damage (a % of max HP, not scaled by Poison ranks) is not credited to Poison, correctly.
## Poison, second pass (2026-10-07)

Owner: "Definitely make poison feel like a valid choice please." After the Toxic Combustion change above, Poison still
took 21–28% of the Elemental agent's spend for a counterfactual contribution median 9.2% (≥ 10% on 3/12 seeds 1–12).
Poison's own ticks are only 1–4% of damage: Toxic Combustion consumes the stacks, so Poison's ranks pay off mostly
through the explosion, which scales with the per-stack damage.

Variants (simulator, Elemental idle, seeds 1–12, 4 sim-h; counterfactual share = Poison's part of the summed
`sim-cli/counterfactual.ts` contributions, 6 waves; median / seeds ≥ 10%):

| variant | Poison cf | Fire cf | Toxic Combustion dmg | median depth |
| --- | --- | --- | --- | --- |
| master (`poison.damage` 0.08) | 9.2 / 3 | 16.9 | 5–32% | 29 |
| `poison.damage` 0.12 | 9.4 / 5 | 16.1 | 5–53% | 29 |
| **`poison.damage` 0.16 (applied)** | **10.7 / 8** | 15.7 | 5–57% | 30 |
| `poison.damage` 0.20 | 8.7 / 5 | 14.1 | 5–64% | 29 |
| Neurotoxin +12%/rank (was +6%) | 6.5 / 4 | 17.2 | 6–36% | 29 |
| `poison.application` 0.5 | 8.7 / 4 | 17.4 | 7–36% | 29 |
| Toxic Combustion target cap 0.3 | 6.7 / 2 | 15.8 | 9–35% | 29 |
| 0.12 + Poison stat nodes 40% cheaper | 8.7 / 4 | 16.3 | 5–53% | 29 |

**Applied:** `data/base-stats.ts 'poison.damage'` 0.08 → 0.16 (Neurotoxin text: 8% → 16% of primary damage per
stack per second). Poison is never the top counterfactual tree (Ballistics on 11/12 seeds). The counterfactual is
noisy (±5 points seed to seed), and the median 12% target was not reached by any variant.

Full `sim:accept --seeds 1,2,3,4,5,6` vs master: every row identical except Build health (best agent is now
Elemental at 31; worst 100% → 115%), Doctrine health (Plague 28 → 30; worst 93.5% → 93.3%, poison.venom), Defense
96.6% → 98.3%, Formation fairness worst ×1.438 → ×1.458 (still PASS). Reclimb fails on both (38.7% / 47.1%).
