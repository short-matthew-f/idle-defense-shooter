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
