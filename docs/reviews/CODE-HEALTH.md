# Code health review: simulation, worker, simulator

Scope: `src/sim/**`, `src/worker/**`, `src/app/sim-client.ts`, `sim-cli/**`, the sim-side tests, tooling
and `ARCHITECTURE.md`, reviewed against the non-negotiable rules in `ARCHITECTURE.md`. Base commit
`20f3a87`. UI, render and app code belong to the parallel UX review; UI-side findings are listed
at the end, not fixed.

## Result in one paragraph

No determinism break was found. The grep audit is clean and two new tests cover the gaps: Sims
stepped interleaved in one process, and save → load mid-run across a wave boundary. The main
problems were robustness (malformed commands and corrupted saves could throw or poison the sim),
hot-path cost (spatial hash and pool bookkeeping were about a third of a headless run), and
integration leftovers (heals that skip `World`, three copies of the same helpers, defensive shape
probes, dead code). These are fixed. The headless simulator is **1.6× faster** on the Generalist
2-hour run and **2× faster** on Greedy. The reference run keeps the **same deepest wave and event
hash**: 13 scenarios were compared hash-for-hash against the base commit after every change.
The design-level items are Open with plans below: multiplier composition, shield causality,
Deep Waves, and cross-system references.

| Check | Before | After |
| --- | --- | --- |
| `npm run sim -- --agent generalist --seed 1 --hours 0.5 --report` | deepest **19**, 12 attempts, final hash **3851031538** | deepest **19**, 12 attempts, final hash **3851031538** |
| 13-scenario hash sweep (9 agents × seeds, active + Directive policies, bare 20-min Sim, ~950-enemy dense case) | recorded at `20f3a87` | **identical** (every scenario, every hash) |
| `npx vitest run` | 567 tests, 56 files, 70.6 s wall | 605 tests, 62 files, 45–61 s wall, green |
| `npx tsc --noEmit -p tsconfig.json` | clean | clean |
| `npm run lint` | did not exist | 0 errors, 10 warnings (enemy-shield writes, see M4) |
| `npm run build` | ok | ok |
| Headless throughput, Generalist 2 sim-h | 28,033 ticks/s | 44–45,000 ticks/s |
| Greedy 1 sim-h / optimizer_lite / optimizer | 57,386 / 32,868 / 25,601 | 98–117,000 / 57–61,000 / 60–69,000 |
| Dense (~950 enemies, 4 hardpoints + 3 elements) | ~2,400–2,600 ticks/s | ~2,400–2,600 ticks/s (unchanged: its cost is combat itself; 0.4 ms/tick is 5× under the ×8 budget) |

Only one fix changes behaviour on purpose: a pending Anomaly draft now survives save/load (H6).
It changes nothing in headless runs, so no hash moved.

## Findings, ranked

Status: **Fixed** (what changed) or **Open** (plan and effort: S < ½ day, M ≈ 1–2 days, L > 2 days).

### Critical

None. No wall-clock, engine-dependent maths, unordered iteration or cross-Sim state leak reaches
the event stream (see "Determinism audit").

### High

| # | Finding | Where | Why it matters | Status |
| --- | --- | --- | --- | --- |
| H1 | **Malformed Commands could throw or corrupt state.** No shape validation: `designate {enemy: 1.5}` passes `alive()` (typed-array reads of `1.5` are `undefined`) and makes the target NaN; `manual_aim {angle: NaN}` sends every shot to NaN; `mount_hardpoint {slot: NaN}` writes a `"NaN"` key into `build.hardpoints`; `set_setting` writes any key into settings; a `null` command threw in `Sim.applyPlayer`. | `src/sim/run/commands.ts:19`, `src/sim/index.ts:111` | Commands come from the UI, Directives, devtools and blueprints in saves. One bad one stopped the tick loop, or persisted junk into the build. | **Fixed.** New `src/sim/run/validate.ts` checks every command's shape (types, finiteness, integer slots, known enum members). `applyCommand` rejects with an error and wraps dispatch in a guard, so a handler that still throws becomes an error, not a crashed tick. Test: 40 malformed commands, fed every 20 ticks for 1,800 ticks, never throw and leave the **event hash identical** to a Sim that got none (`tests/core/robustness.test.ts`). |
| H2 | **Corrupted or hand-edited saves crashed or poisoned the sim.** An unknown `meta.activeTrial` made `trialHas` throw on every stat lookup. `growth(g, n)` did `n \| 0`, so huge ranks allocated a table of up to 2³¹ doubles (1e10 wraps to 1.4e9: out of memory). An all-zero PRNG state stays zero forever. An unknown frame allocated a fallback object on every `frameDef` call. `migrate()` only handled v1, with no path for v2. | `src/sim/economy/prestige.ts:131`, `src/sim/math/lut.ts:95`, `src/sim/save/serialize.ts` | Every save passes through here, and saves are imported from strings (`importString`). | **Fixed.** `migrate(save, target, table)` walks a `MIGRATIONS` table step by step. A missing step throws a readable error, and so does a non-save. After migration, `sanitize()` repairs unknown Trial / frame / anomalies, non-finite numbers, bad arrays and a zero PRNG state; valid saves pass unchanged (tested). `trialHas` tolerates unknown ids. `growth()` serves exponents ≥ 2¹⁶ with `ipow` instead of a table (never reached in play). Tests: a synthetic v2 migration, a missing step, non-saves, and a heavily corrupted save that loads, plays 1,200 ticks and renders. |
| H3 | **Hot path: the spatial hash and pool bookkeeping were ~33% of a headless run.** `SpatialHash.rebuild` cleared and prefix-summed all 1,936 cells, twice per tick (AI and core) however few enemies there were. `nearest` scanned every cell in range (up to ~225) for every weapon, every tick. `allocEnemy`/`allocProjectile`/compaction zeroed or copied ~60 columns through one mixed list of typed arrays, so every element access was megamorphic. | `src/sim/core/spatial.ts`, `src/sim/core/pools.ts` | Headless balance runs (`sim:accept` ≈ 20 min) and the ×8 speed mode spend their time here. | **Fixed**, results bit-identical. Rebuild is O(enemies + occupied cells): lazily reset per-cell counts, no full prefix sum. Queries clip to the bounding box of occupied cells. `nearest` searches rings outward and stops at an exact lower bound; the winner is still the argmin over (distance², index), so visiting order cannot change it. A randomized test checks it against brute force, including grid-aligned ties, off-grid points and enemies, intangibles and exclusions. Pool copy/zero loops are grouped by array type. Also: interned Infusion node ids (`infusedElement` built four strings per launch), and hoisted the per-tick event-scan closures (anomalies, progression) into long-lived visitors over a new `EventLog.forEachRange`. Profile below. |
| H4 | **Enemy heals bypassed `World`** (rule 2): boss/support `healEnemy` wrote `e.hp` directly, and so did the healer pulse and regenerating elites. | `src/sim/enemies/bosses/common.ts`, `enemies/behaviors/support.ts:57`, `enemies/elites.ts:64` | The causality rule and future hooks (e.g. an "on heal" Codex entry) need one entry point. | **Fixed.** New `World.healEnemy(enemy, amount, srcTag, cause, silent?)`. All three sites route through it with identical arithmetic; per-tick regeneration is `silent` and the healer keeps its single aggregate event, so the hash is unchanged. Lint now fails on any other enemy-HP write (spawn-time Clump merge and Singularity scaling are marked `lint-allow causality`). Tested. |
| H5 | **Flaky timing tests.** Four wall-clock perf asserts (2–5 s) and one test at vitest's 5 s default timeout failed under coverage instrumentation; CI runners are slower still. | `tests/core/perf.test.ts`, `tests/systems/{elements,linkages}.test.ts`, `tests/enemies/bosses.test.ts`, `tests/core/run.test.ts` | Random red CI erodes trust in the gate. | **Fixed.** `tests/core/perf-budget.ts`: budgets ×2 locally (`PERF_BUDGET_SCALE`), skipped when `CI` is set or `PERF_BUDGETS=off` (the scenario still has to run). `testTimeout: 30_000` in `vite.config.ts`. |
| H6 | **A pending Anomaly draft was lost on reload** (bug). `run.pendingDraft` was not saved, but `anomaliesOfferedAt[k]` was, so the offer never came back. Drafts open on the first clear of waves 10, 20, …, which are also checkpoints, i.e. autosave points. | `src/sim/save/serialize.ts` (`toRunSave` / `fromRunSave`) | Closing the tab inside the 30 s draft window cost the player that Anomaly permanently. | **Fixed.** Optional `RunSave.pendingDraft`, restored on load and filtered to known anomalies; no version bump needed. The optimizer's draft rollouts already set the draft themselves, so agent results are unchanged. Tested. |

### Medium

| # | Finding | Where | Status / plan |
| --- | --- | --- | --- |
| M1 | **Multiplier composition by "divide out your old factor, multiply in the new one"** on `dynamicSpeedMul` (3 writers: Overdrive, Ember Heart, Overdrive Core + Critical Mass), `dynamicPowerMul` and `towerArmorMul`. Critical Mass changes its factor almost every tick, so the product random-walks away from the exact value (deterministic but drifting). One contributor with factor 0 would divide by zero. Readers disagree on guards: ballistics uses the raw value, hardpoints use `d > 0 ? d : 1`. | `systems/reactor.ts:79`, `systems/bastion.ts:139-145`, `systems/abilities.ts:144`, `systems/ballistics.ts:112` | **Open (M).** Replace with contributor slots: `world.mods.speed.set(SLOT_OVERDRIVE, f)`, with the product recomputed on write and the slots reset in `installRun`. Values change in the last bits, so land it alone and re-baseline hashes. |
| M2 | **The Deep Waves gate is not enforced.** `deepWavesUnlocked()` (Ascension V) is never called, so every run continues past wave 100. | `economy/ascension.ts:70` | **Fixed.** Before Ascension V, once wave 100 is cleared Push holds at wave 100 in `between` (the Ascend prompt; a toast points at Menu → Ascension), Patrol loops waves 96–99, and deaths/restarts return there (`RunMachine.atDeepWaveGate`/`heldAtGate`/`firstWave`/`patrolBase` in `run/machine.ts`). Test: `tests/core/ux-sim.test.ts` (M2). |
| M3 | **Singularity Core +50% enemy HP** is applied by the progression system one tick after spawn, and it scales current HP, so damage taken in that first tick is scaled too. It also scanned the whole pool every tick, even without the frame. | `run/prestige.ts:291` | **Partly fixed:** without the frame the scan is skipped (a spawn-serial mark, `World.lastSpawnGen`). **Open (S):** move it into `spawnEnemy` as a stat (`enemy.hp_mul`). This changes hashes for that frame only. |
| M4 | **Enemy shield writes outside `World`** (10 sites: EMP, boss counters stripping shields, Blade Sunder clamp, shield regen, warden `addShield`, elite init, Clump init). None emits an event, so the Inspector cannot say "the EMP stripped the shield". | `lint --verbose` lists them; e.g. `systems/abilities.ts:227`, `enemies/bosses/tells.ts:91,246,247,263` | **Open (S–M).** Add `World.setEnemyShield(enemy, value, srcTag, cause)` and `stripShield`, emitting a StatusApply-like event, then promote the lint warning to an error. Hash-changing (new events). |
| M5 | **The Directives engine reaches into AbilitiesSystem** (`findAbilities` does `instanceof` over `world.systems` and keeps a reference) for cost and blocker checks. This breaks rule 4 ("systems never call each other"). | `directives/engine.ts:101`, `systems/abilities.ts:463` | **Open (S).** Expose `castBlocker` and `abilityCost` as pure functions over `World` state (cooldowns onto `World`), or dry-run the command. |
| M6 | **Contract sprawl** (map below): three pre-armor damage-multiplier mechanisms, two per-tick channel namespaces (`shared`, `signals`), five per-enemy `…Until` tick stamps each owned by one system but stored in the shared pool. | `core/world.ts`, `core/types.ts` | **Partly fixed:** one documented rule per channel (ARCHITECTURE.md "Cross-system channels" and "Movement speed"); the slow-channel rule is written on `speedMul`/`fieldSlow`; dead `EnemyPool.lastCause` removed (it was written on every hit, never read, and copied on every compaction). **Open (M):** see the consolidation plan. |
| M7 | **Integration-era defensive probing.** `(w as unknown as {...}).trial`, `.bossTell`, and a `forecastModule` namespace probe with a `world.forecast` fallback, all for members that have long been part of the contract. | `directives/engine.ts`, `systems/abilities.ts:68` | **Fixed:** direct typed access; `setForecastProbe` kept as a test hook. |
| M8 | **Duplicated helpers:** three depth-indexed scratch stacks (hardpoints `ScratchStack`, elements `QueryStack`, `World.explode`'s private stack) and three segment-distance implementations (hardpoints, bosses, hazards). | — | **Fixed:** `core/scratch.ts` and `math/geom.ts`; the old names re-export them. `remapArray` and `densestEnemy` were already single copies. |
| M9 | **The acceptance harness dominates test time:** 57 of 61 s wall, one file serializing the suite (4 cores). | `tests/accept/harness.test.ts` | **Open (S).** Move the `--quick` acceptance run to `npm run test:accept` and a parallel CI job; `npm test` drops to ~15 s. |
| M10 | **The golden generator snapshot fails on any content change** (roster, formation, budget), not only on engine drift. | `tests/enemies/generator.test.ts` | **Documented:** the test now explains when refreshing is expected (`-u`); engine drift is covered by the PRNG goldens. **Open (S):** snapshot a content hash next to the summary so the failure message says which one moved. |
| M11 | **Worker robustness:** an `inspector` request that threw got no reply, so the client's FIFO paired every later reply with the wrong caller. An init failure surfaced as an unlabelled error. The client ignored `worker.onerror` and `onmessageerror`, so a worker that failed to load was silent. | `src/worker/sim.worker.ts`, `src/app/sim-client.ts` | **Fixed:** every inspector request is answered; init failures post `init: …` and leave the worker idle (the app already parks the save, so a fresh game never autosaves over it); `set_clarity` ignores non-finite values; the client forwards worker load and message errors to `onError`. Tests: the new `tests/core/sim-client.test.ts` (0% coverage before) plus two worker cases. |
| M12 | **Module-level mutable state** shared by every Sim in a process: the `ensureSpatial` marker (keyed by world + tick), `setForecastProbe`, `export let bestScore` (a return value smuggled through a module variable), and scratch buffers. | `enemies/behaviors/kinds.ts:47`, `directives/engine.ts:55`, `systems/hardpoints/common.ts:146` | **Verified safe:** the new interleaving test (two Sims stepped alternately equal the same Sims stepped alone) passes. **Open (S):** return `bestScore` through an out-array and keep the forecast probe per engine instance, so the test never has to catch it. |

### Low

| # | Finding | Status |
| --- | --- | --- |
| L1 | Dead code: 20 unused locals/imports/fields (e.g. `abilities.missileTag`, `anomalies.echoCount`, `gravitics.yieldMul`, which duplicated a stat already applied); dead exports `clearEnemies`, `clearProjectiles`, `resetPoolCaches`, `trialRule`, `profileFor`, `bossTicks`, `counterSummary`, `ALL_TREES`, `entryInfo`, `scrapBudget`, `measureDifficulty`, `echoRateAt`. | **Fixed.** Kept on purpose: `sincos`/`lerp` (math library), `ascensionStars`, `prestigeNodePrice`, `deepWavesUnlocked` (UI-facing economy API; see M2), `BOSS_INDEX`, `ROLE_ESCORT`, `CE_CAP_BASE`, `LinkageId`. About 140 further exports are used only inside their own file (harmless). |
| L2 | Silent query truncation: 1,024-entry scratch buffers (AI, hazards, hardpoint `SCRATCH`, `World.explode`) cap a query at 1,024 of the 1,500-enemy budget without a sign. | **Open (S):** documented in `core/scratch.ts`; size the buffers to `MAX_ENEMIES` (no effect until a query exceeds 1,024). |
| L3 | Event ring (16,384) holds ~1.8 s of a dense fight (~150 events/tick). Ordnance, Linkages and Infusions rescan at most 4,096 events per tick, and five systems rescan the log every tick. Inspector chains and event-driven procs silently drop in extreme density. | **Open (M):** roadmap item 4. |
| L4 | `setMode('patrol')` on a boss wave calls `clearCombat()` without `onAttemptStart`, so systems' per-enemy arrays keep stale values for reused indices. | `run/machine.ts:241`. **Open (S):** add an `onCombatCleared` hook, or call `onAttemptStart`. |
| L5 | `addHazard` drops the oldest hazard with `Array.shift()` at the cap (O(n), allocation-free but quadratic under spam). | `core/world-impl.ts:532`. **Open (S):** ring buffer. |
| L6 | `SaveState.trial` is always `null`; Trials park the run in `meta.parkedRun`. | **Open (S):** drop it at the next `SAVE_VERSION` bump (first real `MIGRATIONS` entry). |
| L7 | Per-cast template strings (`` `ability.${id}.cost_mul` ``), `Sim.step` reallocates the command queue on ticks with commands, and the snapshot closure runs once per frame. | **Open (S):** negligible at current rates. |
| L8 | Type safety: 0 `any`, 46 non-null `!`, 110 `as` casts (3 `as unknown as`, 10 `as never` for id unions) in `src/sim`. `noUncheckedIndexedAccess` would raise **3,340 errors** (2,631 in `src/sim`, almost all typed-array reads). | **Not enabled.** Recommend it only for `Record<string, …>` lookups, via a lint rule, not globally. |
| L9 | `growth(g, ±Infinity)` returned 1 (`Infinity \| 0 === 0`); it now returns the mathematical limit. No caller passes a non-finite exponent. | **Fixed** (see H2). |
| L10 | `SimClient.requestSave()` never settles if the worker has no Sim (after an init failure). The app only calls it once `ready`. | **Open (S):** reject after a timeout, or post an error reply. |

## Determinism audit

Grep over `src/sim` (outside `src/sim/math`, which implements the replacements):

| Pattern | Hits | Verdict |
| --- | --- | --- |
| `Math.random`, `Math.sin/cos/tan/atan*/exp/log*/pow/hypot/cbrt` | 0 | clean (now a lint error) |
| `**` | 0 | clean (lint error) |
| `Date.`, `performance.`, timers, `crypto.` | 0 in `src/sim` (the worker stamps `savedAtMs` outside the sim) | clean (lint error) |
| `.sort(` | 10 | all have total comparators (numeric, or key then index/id tie-break); `Array.prototype.sort` is stable anyway |
| `Object.keys/values/entries`, `for … in` | 9 | all over string keys (node ids, tree ids, codex ids, stat keys, pool fields): insertion order is stable and survives JSON round trips. No integer-like keys. |
| `Map`/`Set` iteration | stat resolver key sets (data-order insertion), damage-share buckets (UI only), caches (`get`/`set` only) | clean |
| Module-level mutable state | scratch buffers (used within one call), `ensureSpatial` marker (keyed by world + tick), `bestScore`, forecast test probe, WeakMaps keyed by world | safe (new interleaving test); see M12 |
| Float32 / Float64 mixing | pool columns are f32, maths is f64 | deterministic: identical operation order on every engine |

New tests (`tests/core/determinism-extended.test.ts`):

- **Interleaving.** Two rich-build Sims (4 hardpoints, 3 elements, anomalies, Directives, Upgrade Queue,
  checkpoint 15) are stepped alternately, one with extra steps, and compared with the same Sims
  stepped alone.
- **Save → load mid-run.** A rich Sim saves after 2,700 ticks, mid-combat. Three loads (direct, JSON
  round trip, load → save → load) run 3,600 ticks across at least one wave boundary with equal hashes,
  equal event counts and equal saves.
- **Idempotence.** load → save → load → save is byte-identical.

Browser-versus-Node equality stays covered by the golden PRNG snapshot (`tests/math.test.ts`).

## Causality audit

Writes to `enemies.hp[…]` outside `core/world-impl.ts` before this review: healer pulse, regenerating
elites, and boss `healEnemy` (the heals), plus Clump creation and merging and Singularity Core scaling
(spawn-time). Heals now go through `World.healEnemy`. Spawn-time writes carry `lint-allow causality`.
Tower HP writes are confined to `world-impl.ts`, `systems/tower.ts` (regeneration) and
`run/machine.ts` (attempt reset). The lint enforces both. The 10 enemy-shield writes are warnings (M4).

## Profile

Command: `node --import tsx --cpu-prof sim-cli/main.ts --agent generalist --seed 1 --hours 2`
(self time; module-loader frames excluded; V8 attributes inlined callees to the caller).

| # | Before (`20f3a87`, 22.7 s profiled) | % | After (10.6 s profiled) | % |
| --- | --- | --- | --- | --- |
| 1 | `SpatialHash.nearest` | 11.1 | `SpatialHash.queryRadius` | 6.9 |
| 2 | `WorldImpl.rebuildSpatial` (inlined `SpatialHash.rebuild`) | 8.3 | `SpatialHash.nearest` (+ `scanNearest` 2.3) | 5.2 |
| 3 | `SpatialHash.rebuild` | 6.1 | `steerToward` (hardpoint seekers) | 4.6 |
| 4 | `zeroSlot` (pools) | 4.3 | `updateProjectiles` | 4.4 |
| 5 | `copySlot` (pools) | 3.8 | `Sim.step` | 3.6 |
| 6 | `SpatialHash.queryRadius` | 3.6 | `OrdnanceSystem.steer` | 2.8 |
| 7 | `Sim.step` | 3.1 | `EventLog.pushRaw` | 2.6 |
| 8 | `steerToward` | 2.7 | `steerEnemy` | 2.6 |
| 9 | `selectTarget` | 2.4 | `WorldImpl.damage` | 2.4 |
| 10 | `updateProjectiles` | 2.3 | `SpatialHash.rebuild` | 2.3 |
| — | GC | 1.6 | GC | 2.4 |

Dense case (now `npm run sim -- --profile`, last row: ~950 enemies, 4 hardpoints + 3 elements,
wave 60), after: `WorldImpl.damage` 9.4, `separate` (enemy separation) 8.0, `SpatialHash.rebuild` 7.9,
`steerEnemy` 6.9, `StatusesSystem.update` 4.3, `pushRaw` 4.2, `queryRadius` 3.0, `explode` 2.7,
`updateHazards` 2.5, `aiStep` 2.1. That is 0.4–0.55 ms per tick, against a 2.1 ms per-tick budget at
×8 speed on this machine. The old `--profile` "dense" row peaks at 94 enemies; it is kept and relabelled.

Hot-path allocation sweep: no per-tick `new`, array literals, `map`/`filter` or string building
remains in `update()`/hook paths. What's left is per rebuild, per wave (generator), per cast or per
frame (`uiState` 0.23 ms, `snapshot` 0.08 ms, `save` 0.05 ms at wave 18).

## Contract sprawl map

Additive members on the shared contracts, by the work package that added them:

| Contract | WP1 core | WP2 elements / chassis | WP3 hardpoints | WP5 bosses / AI | WP8 progression | WP9 active | This review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `World` | `freeze`, `despawnEnemy`, `resolveEnemy`, `rebuildStats`, `tagId`/`tagName`, `freeProjectile`, `waveSeconds`, `nearestExcluding`, `damage({silent})`, extra `spawnProjectile`/`spawnEnemy` fields | `dynamicPowerMul`, `towerArmorMul`, `healOverflow` | `shared` (SharedGeometry) | `bossTell`, `damageModifier` | `trial`, `signals` | `dynamicSpeedMul`, `enqueueCommand` | `healEnemy` (+ impl-only `lastSpawnGen`) |
| `System` | `onCompact`, `onCommand` | `damageMul`, HitInfo source `'element'` | — | — | — | — | — |
| `EnemyPool` | `spawnIdx`, `formT`, `speedMul`, `attackT`, `spawnEv`, `scrapMul`, `contact`, DoT causes/accumulators, `bleedDps`, `staticStacks/T` | `bankedPoison`, `freezeLockUntil`, `thermalUntil`, `flashUntil`, `bossSlowUntil`, `comboStart/Mask`, `harmonicUntil` | `weakPointT` | — | — | `fieldSlow` | removed `lastCause` |
| `ProjectilePool` | `tag`, `critMul`, `retention`, `pierceSpeed`, `bounceRange`, `knock`, `execBonus`, `pierced` | — | `hpBits` | — | — | — | — |

Overlaps and the consolidation plan:

1. **Slow channels:** `speedMul`, `fieldSlow`, `chill/chillT`, `frozenT`, `staggerT`, `bossSlowUntil`,
   `freezeLockUntil`. In practice they already form one pipeline. **Done:** one documented rule (only
   statuses writes `speedMul`; plugins raise `fieldSlow`; the `…Until` fields are timers). It is on the
   type and in ARCHITECTURE.md "Movement speed". No code change needed.
2. **Speed multipliers:** `dynamicSpeedMul` (3 writers), the `reactor.global_attack_speed` stat,
   linkage channels `shared.bladeSpeedMul / laserPulseRateMul / droneBoost`, and `run.speedMultiplier`
   (game speed, unrelated). **Plan (M1):** contributor slots in `world.mods.{speed,power,towerArmor}`,
   one reader helper (`attackRate(w)`) replacing the ad-hoc guards.
3. **Damage multipliers:** `combat.power_mul` × `dynamicPowerMul` (scalar), `damageModifier`
   (single-owner function, pre-armor, also hits true damage), `System.damageMul` (hook list,
   non-true only), plus shock and brittle in core. **Plan:** keep `damageMul` as the extension point.
   Split `damageModifier` into a `damageMul` hook on `BossSystem` plus a `trueDamage`-aware flag (it is
   the only one that must zero true damage during phase changes). Fold `dynamicPowerMul` into slots.
4. **Geometry and signals:** `shared` (producer-grouped geometry and next-tick channels) and `signals`
   (anomalies → blade/laser) follow the same "rewritten every tick" rule. **Plan (S):** group the
   write-back channels per consumer (`world.channels.blade.{dir, speedMul}`,
   `channels.laser.{widthMul, pulseRateMul, ghostEdges, nodeMul}`, `channels.drones.boost`). This is a
   mechanical rename.
5. **Per-enemy stamps owned by one system** (`thermalUntil`, `flashUntil`, `harmonicUntil`,
   `comboStart/Mask`, `weakPointT`, `bankedPoison`): move them into the owning systems with `onCompact`
   remaps, as the hardpoints already do. Every pool column is copied on each compaction and zeroed on
   each spawn. **Effort M.**

## Coverage

`vitest --coverage` (v8, installed with `--no-save` for this review), `src/sim` + `src/worker` +
`sim-client`, without the acceptance harness: **95.2% lines, 94.3% functions, 86.8% branches**.
Gaps, lowest first:

| Module | Lines / branches | Untested paths |
| --- | --- | --- |
| `app/sim-client.ts` | 0% → now tested | — (new `tests/core/sim-client.test.ts`) |
| `enemies/bosses/attacks-summon.ts` | 53% / — (36% functions) | most summon attacks (grave, clone, generators) |
| `enemies/bosses/attacks-fire.ts` | 75% | several fire patterns |
| `core/projectiles.ts` | 76% | ricochet retargeting, ReturnFire revisits, LastRites, Stagger, hostile shots hitting the tower |
| `run/commands.ts` | 79% | Refit refund, `set_speed` rejections, `offline_return` |
| `worker/sim.worker.ts` | 87% / 61% | rebuild-from-save recovery after 3 failures, buffer return |
| `run/machine.ts` | 87% | Patrol entered on a boss wave, Clump merge at the enemy cap, draft auto-pick |
| `core/snapshot.ts` | 88% / 59% | per-kind instance branches (render-facing) |
| `directives/autocast.ts` | 88% / 68% | autocast target fallbacks |
| `core/events.ts` | 91% / 67% | chain-sentence phrasing branches |
| `systems/anomalies.ts` | 89% / 73% | several Paradox and Cursed anomalies |
| `economy/shop.ts` | 96% / 74% | lock reasons |
| `save/serialize.ts` | migrations had no test → now covered | — |

Test runtime: 45–61 s wall on 4 cores, ~57 s of it in `tests/accept/harness.test.ts` (M9). Snapshot
tests: `tests/math.test.ts` (PRNG goldens: keep, they are the cross-engine gate) and the generator
summary (M10).

## Tooling added

- `npm run lint` → `scripts/lint.mjs`, zero dependencies. It enforces determinism (banned Math, `**`,
  wall clock, timers and crypto, comparator-less sort), causality (enemy and tower HP writers), and
  boundaries (no ui/render/app imports or DOM globals in the sim, no system-to-system imports), and it
  warns on files over 700 lines. It strips comments and strings first, and a line may opt out with
  `lint-allow <rule>: <reason>`. It was checked by seeding violations (all caught; a string containing
  `Math.sin(` is ignored).
- `npm run check` = typecheck + lint + tests; CI runs it (`.github/workflows/deploy.yml`).
- `"engines": { "node": ">=20" }`.
- `npm run sim -- --profile` gains the ~950-enemy dense case.
- Files over 700 lines: none (largest: `enemies/generator.ts` 657, `core/world-impl.ts` 646).
- TODO/FIXME inventory: none in code.

## UI-side findings (for the UX review; not changed here)

- `src/app/game.ts` handles a sim init failure by parking the save and starting fresh. That stays
  correct: init failures now arrive as `error` messages starting with `init: `, and the worker no
  longer creates a Sim of its own in that case.
- `SimClient.requestSave()` never settles when the worker has no Sim (L10); `game.ts` guards calls
  with `ready`, so keep that guard in any new caller (e.g. an export button shown before `ready`).
- Commands with a malformed shape now come back as `cmd_error` ("Malformed command: …") instead of
  crashing the tick. They indicate a UI bug worth logging, not a player-facing toast.
- During this review `src/app/game.ts` and `src/ui/index.ts` briefly failed to typecheck (a
  redeclared `n`, `Sheet.reveal`) while the UX pass was in flight. Both were clean at the end.

## Roadmap (next five)

1. **Multiplier slots + Singularity HP at spawn** (M1, M3; M). This is one deliberate hash change,
   landed alone: re-run the acceptance gate and note it in `docs/BALANCE.md`.
2. **Test pipeline:** split the acceptance harness into `test:accept` and a parallel CI job; add
   `@vitest/coverage-v8` as a devDependency with thresholds at today's numbers (M9; S).
3. **Finish causality:** `World.setEnemyShield`/`stripShield` with events, promote the shield lint to
   an error, and decouple Directives from `AbilitiesSystem` (M4, M5; M).
4. **Event pipeline:** replace the five per-tick event-log rescans (ordnance, linkages, infusions,
   anomalies, progression) with typed hooks (`onExplosion`, `onCast`, `onCheckpoint`), and size the
   ring from measured peak events per tick so Inspector chains survive dense fights (L3; M).
5. **Close coverage gaps and the Deep Waves rule:** boss summon and fire attacks, projectile
   ricochet/pierce/LastRites paths, Patrol and Clump edge cases; decide and enforce the wave-100 gate
   (M2; M).
