# Project Citadel — Architecture

Read `docs/design-v2.md` first; it is the source of truth for *what* the game is.
This file is the source of truth for *how the code is organized* and the rules every
contributor (human or agent) follows so parallel work integrates cleanly.

## Layout

```
src/sim/          Pure TypeScript simulation. NO DOM, NO Math.random/Date/performance.
  math/           Prng (xoshiro128**), LUT trig, ipow/growth/exp/log/pow, geom.ts (segment tests) [owner: architect]
  core/           ids.ts, types.ts, schema (data/schema.ts), system.ts, world.ts,
                  pools, spatial hash, event log, stat resolver, scratch.ts (query scratch stacks) [WP1]
  data/           ALL content as data (trees, nodes, doctrines, fusions, linkages,
                  infusions, anomalies, abilities, frames, enemies, bosses,
                  formations, sectors, trials, prestige, constellation)     [WP-DATA, WP4]
  systems/        One file per combat system implementing core/system.ts    [WP1, WP2, WP3, WP9]
  enemies/        Wave generator, formation scripts, enemy AI, boss scripts  [WP4, WP5]
  economy/        Curves, costs, Scrap/Cores/Echoes/Stars, Forecast          [WP1, WP8]
  run/            Attempt/wave/checkpoint state machine, Push/Patrol, Prestige/Ascension,
                  commands.ts (dispatch) + validate.ts (Command shape validation)  [WP1, WP8]
  directives/     Directive engine, Targeting Profiles, Upgrade Queue        [WP9]
  save/           Serialization, MIGRATIONS table, save sanitization         [WP1, WP7]
  index.ts        `export class Sim implements ISim`                          [WP1]
src/worker/       Web Worker wrapper around Sim (protocol in core/types.ts ToWorker/FromWorker) [WP1]
src/render/       WebGL2 instanced renderer, particles, bloom, readability rules [WP6]
src/ui/           DOM panels: HUD, shop, Forecast, Inspector, Codex, Directives, settings [WP7]
src/app/          main.ts glue: worker, render loop, input, IndexedDB saves, PWA, offline [WP6 skeleton, WP7]
sim-cli/          Headless Node runner: agents, acceptance tests, Difficulty Multiplier tables [WP10]
scripts/          lint.mjs (architecture lint, `npm run lint`), gen-icons.mjs
tests/            Vitest. Determinism hash tests are mandatory for every system.
```

Path aliases: `@sim/*`, `@render/*`, `@ui/*`, `@app/*`.

## Non-negotiable rules

1. **Determinism.** Inside `src/sim` never use `Math.random`, `Math.sin/cos/tan/atan2/exp/log/pow`,
   `**` with non-integer exponents, `Date`, `performance`, `Map`/`Set` iteration order over
   object keys that could differ, or `Array.sort` without a total, deterministic comparator.
   Use `src/sim/math` (`sin`, `cos`, `atan2`, `ipow`, `growth`, `exp`, `log`, `pow`, `Prng`).
   `Math.sqrt/floor/ceil/abs/min/max/imul/round/trunc` are fine. Every random draw comes from a
   `Prng` owned by the World or the wave generator. Entity iteration is by pool index, ascending.
2. **Everything has a cause.** Any damage, status, spawn, explosion, or ability goes through
   `World` methods that take a `cause` event id and emit an event. Never mutate `enemies.hp`
   directly outside `World` (`damage`, `healEnemy`, `killEnemy`; spawn-time setup such as Clump merges
   is marked `lint-allow causality`). The kill chain (Inspector, Codex) depends on this.
3. **Content is data.** Numbers and names live in `src/sim/data/*.ts` conforming to
   `data/schema.ts`. Systems check `world.stats.has('tree.node')`, `rank(...)`, `get('tree.stat')`.
   The shop, agents and Codex read the same data. Node ids: `${tree}.${node}`;
   linkages `link.${a}+${b}` (a before b in `SYSTEM_ORDER_IDS`), chassis linkages
   `chassis.${bastion|reactor}+${system}`, infusions `infuse.${system}.${element}`,
   fusions `fusion.${id}`, triads `triad.${id}`, abilities `ability.${id}`, prestige `prestige.${id}`,
   constellation `star.${id}`, frames `frame.${id}`.
4. **Systems are plugins.** Implement `core/system.ts` `System`; register in `systems/index.ts`.
   Systems never import each other. Cross-system behavior goes through hooks and events.
5. **No allocation in the hot path.** Pools are struct-of-arrays typed arrays. Per-tick scratch
   buffers are preallocated. `uiState()` may allocate (≤10 Hz). `snapshot()` reuses buffers.
6. **Budgets.** ≤1500 enemies, ≤4000 projectiles. Past the enemy cap, merge swarms into Clumps.
7. **Tests.** Each work package ships Vitest tests and a determinism test: run the same seed twice
   (fresh Sim each time) and compare `events.hash()` after N ticks. No module-level mutable state that
   outlives a tick (tests/core/determinism-extended.test.ts steps two Sims interleaved to catch it).
8. **No DOM in sim, no sim internals in UI.** UI sends `Command`s and reads `UiState`. Commands are
   untrusted input: `run/validate.ts` rejects malformed ones with an error, never an exception.

`npm run lint` (`scripts/lint.mjs`, part of `npm run check` and CI) enforces the grep-able parts of rules
1, 2, 4 and 8: banned Math/Date/performance/`**`/comparator-less `sort` in `src/sim` (outside `math/`),
enemy/tower HP writes outside their owners, ui/render/app imports or DOM globals in the sim, systems
importing systems, and warns on files over 700 lines. A line opts out with `lint-allow <rule>: <reason>`.
9. **Commit style.** Conventional, imperative subject; body says what and why.

## Tick order (Sim.step, src/sim/index.ts)

```
 1  player Commands (validated, run/commands.ts), then Directive/Autocast commands queued last tick
 2  run machine preTick: between → startWave (generateWave), wave_clear → draft / next wave,
    draft auto-pick after 30 s, dead → new attempt                               [run/machine.ts]
 3  spawn scheduled enemies (past the enemy cap grunts/swarms merge into a Clump)
 4  statuses (core StatusesSystem): durations, speedMul (see "Movement speed"), DoT pulses
 5  enemy AI (enemies/ai.ts): elite init, speed auras, behaviors, boss movement, separation
    (behaviors rebuild the spatial hash lazily, once, if they query it)
 6  rebuild spatial hash
 7  SYSTEM_ORDER plugins (systems/index.ts), in this order:
      bosses → ballistics → ordnance → drones → blade → laser → gravitics → elements → fusions →
      linkages → infusions → anomalies → progression (run/prestige.ts) → bastion → reactor →
      active (tap assist, salvage, Overcharge) → abilities → directives
 8  projectiles move / collide / expire                                          [core/projectiles.ts]
 9  hazards (4 Hz pulses)                                                         [core/hazards.ts]
10  tower upkeep (core TowerSystem): invulnerability, regen, shield recharge, TowerDeath event
11  run machine postTick: death → dead; wave clear → first-clear, checkpoint, slots, draft, onWaveEnd
12  endTick: compact pools, repair cached indices, System.onCompact
13  advance clocks (tick, attemptTick, waveTick, playSeconds, Patrol rate)
```

Hooks (`onHit`, `onKill`, `onStatusApply`, `onTowerHit`, `damageMul`, `onCommand`, `onCompact`) run over
`[statuses, ...SYSTEM_ORDER, tower]` in that order. Economy (Scrap, CE, Cores) is paid inside
`World.finishKill`; the Codex, Forecast samples and Trial tiers are bookkept by the progression system.

## Cross-system channels (additive contract members, one rule each)

Systems never import each other; they talk through `World`, hooks and events, plus these channels.
Each has exactly one writer rule. Full inventory and consolidation plan: `docs/reviews/CODE-HEALTH.md`.

| Channel | Writers → readers | Timing / rule |
| --- | --- | --- |
| `EnemyPool.speedMul` | statuses → every mover | Recomputed each tick (see "Movement speed"); plugins never write it |
| `EnemyPool.fieldSlow` | Time Field, Containment, boss Deep Freeze window → statuses | `max()` into it; consumed and cleared next tick |
| `World.dynamicSpeedMul` / `dynamicPowerMul` / `towerArmorMul` | abilities (Overdrive), bastion, reactor → weapons, `World.damage`, `damageTower` | Composed: divide out your previous factor, multiply in the new one |
| `World.shared` (SharedGeometry) | hardpoints publish geometry → linkages, infusions (same tick); linkages write `bladeSpeedMul`, `laserWidthMul`, `laserPulseRateMul`, `droneBoost` → hardpoints (next tick) | Each section rewritten every tick by its owner |
| `World.signals` (ProgressionSignals) | anomalies → blade, laser (next tick) | Rewritten every tick |
| `World.damageModifier` | bosses (single owner) → `World.damage` | Pre-armor, also applies to true damage |
| `System.damageMul` | elements, fusions, reactor, anomalies → `World.damage` | Non-true damage, after power multipliers |
| `World.bossTell` | bosses → directives, ui-state | Live tell window |
| `World.enqueueCommand` | directives, autocast, abilities → next tick's command phase | Same dispatch as player commands |
| `World.healOverflow` | `healTower` → bastion (Fortress Keep) | Drained each tick |

### Movement speed

`speedMul` is the single slow channel. The statuses system sets it every tick, before the AI, to
`base × (1 − fieldSlow)`, where `base` is 0 while frozen or staggered (bosses: stagger interrupts only),
else `1 − min(slowCap, slowPerStack × chill)` (half on Immovable). It then clears `fieldSlow`. Only the
AI's auras multiply it afterwards (commanding ×1.2, boss haste ×1.5, boss accelerate ×1.6). To slow
enemies, apply chill / freeze / stagger or raise `fieldSlow`; `bossSlowUntil` and `freezeLockUntil` are
timers, not slows.

## Active edge (tap-to-assist, salvage, Overcharge)

`systems/active.ts` (numbers: `data/active.ts`, the one `ACTIVE` table; mechanics and measurements: `docs/ACTIVE.md`).
Three player-only Commands, never an error (a tap that finds nothing is ignored, so the UI never toasts):
`tap_assist {x, y}`, `collect_salvage {x, y}`, `overcharge {action}`. `onCommand` records them; `update()` resolves them
after the spatial hash is rebuilt. The system owns a private `Prng` (reseeded per attempt from the Prestige seed and the
attempt count), so salvage rolls and assist crits never perturb the combat stream. Salvage values read
`WorldImpl.killScrap[i]` (the Scrap `finishKill` just paid for enemy i, set before the onKill hooks, so nested kills
cannot overwrite it) and pay through `World.addScrap`. Events: `Ev.Assist` / `Ev.Overcharge` are the causes of their
Hits (srcTag `assist` / `overcharge`, source `ability`); `Kill → Ev.SalvageDrop → Ev.SalvageCollect` (src `salvage.tap` /
`salvage.passive`). `UiState.active` carries the cooldown, chain and meter. Crates are drawn as layer-7 Diamonds with
`aux1 = SALVAGE_MARK`; `app/pick.ts nearestCrate` and `app/overlay.ts` find them by that mark (like the reticle).
The app routes taps (`app/active-tap.ts`): crate → collect (unless an enemy is nearer the tap); enemy → assist +
`designate_at` (rapid re-taps of the same enemy skip the designation toggle); a hold claimed on the tower
(`Input.onHoldStart`) charges Overcharge. Gated by the unlock ladder (`tapAssist`, `salvage`, `overcharge`). UI: `src/ui/active.ts`.

## Economy constants (design §17) — implement in `economy/curves.ts`

These are the design's starting shapes. The tuned constants (e.g. EnemyHP base 6 and growth 1.14, Scrap
growth 1.10, 1 CE per ordinary kill, the Frontier: waves past wave 28 — then ~10 past the depth of the player's
lifetime Echoes — get ×3.5 HP per wave) live in `economy/curves.ts` / `world-impl.ts`; `docs/BALANCE.md`
records every change from the values below.

```
EnemyHP(w)      = 10 * 1.13^w * k * 1.6^A          (Threat Dial: * (1 + 0.12*T))
BossHP(w)       = 12 * EnemyHP(w) * boss.hpMul
ScrapPerKill(w) = 1.11^w * k                        (first clear of a wave ×3; Strip Mine ×4/×5)
StatCost(r)     = base * g^r, g ∈ [1.15, 1.22]
Mechanic cost   = flat, ×8 per tier within a tree
Echoes(D,T)     = floor(10 * 1.2^(D-20) * (1 + 0.1*T)),  D = deepest wave cleared this run (0 if D<20)
Stars(D,A)      = floor(4 * (1+A) * 1.1^(D-100))
Tower heal between waves: +25% max HP. CE cap 100 base. Hardpoint slots at waves 10/30/55/75;
attunements at 5/25/45. Cores: 1 per boss first kill. Exotic 2, Refit 3, Doctrine change 1, reroll 1.
```

Use `growth(g, n)` from `math/lut.ts` for all of these.

## Work packages and file ownership

| WP | Scope | Owns |
| --- | --- | --- |
| WP1 Core | pools, spatial hash, event log, stat resolver, World, run state machine, economy basics, Ballistics base + doctrines, tower, basic enemy movement, Sim class, worker wrapper, save/load | `src/sim/core/*` (except ids/types/schema/system/world contracts: extend, don't break), `src/sim/run/*`, `src/sim/economy/curves.ts`, `src/sim/systems/{ballistics,tower,statuses}.ts`, `src/sim/index.ts`, `src/worker/*`, `src/sim/save/*` |
| WP-DATA | every content table except enemies/bosses/formations | `src/sim/data/{chassis,elements,hardpoints,fusions,linkages,infusions,anomalies,abilities,frames,prestige,trials,constellation}.ts`, fills `data/index.ts` |
| WP4 Enemies | enemy defs, sectors, formation templates + scripts, wave generator, boss data | `src/sim/data/{enemies,bosses,formations,sectors}.ts`, `src/sim/enemies/{generator,formations}.ts` |
| WP6 Render | WebGL2 renderer, particles, bloom, density governor, threat halos, dev harness | `src/render/*`, `src/app/main.ts` (skeleton), `index.html`, `public/*` |
| WP2 Chassis+Elements | Bastion, Reactor systems; Fire/Lightning/Poison/Frost; Fusions; Triads | `src/sim/systems/{bastion,reactor,elements,fusions}.ts` |
| WP3 Hardpoints | Ordnance, Drones, Blade, Laser, Gravitics; Linkages; Infusions | `src/sim/systems/{ordnance,drones,blade,laser,gravitics,linkages,infusions}.ts` |
| WP5 Bosses+AI | enemy behaviors, 20 bosses, tells, counters, weak points, elite modifiers | `src/sim/enemies/{ai,bosses,elites}.ts`, `src/sim/enemies/bosses/*` |
| WP8 Progression | Prestige, Echoes, Forecast, Prestige layers, Frames, Cores, Anomalies, Trials, Threat Dial, Ascension, Constellation, Codex | `src/sim/economy/{forecast,prestige,ascension,codex}.ts`, `src/sim/run/{prestige,trials}.ts`, `src/sim/systems/anomalies.ts` |
| WP9 Active+Directives | Designator, manual aim, CE, abilities, Directives, Targeting Profiles, Upgrade Queue, Autocast | `src/sim/systems/abilities.ts`, `src/sim/directives/*` |
| WP7 UI | HUD, shop, Forecast, Inspector, Codex, Directives editor, Blueprints, settings, saves, PWA, offline return | `src/ui/*`, `src/app/*` |
| WP10 Simulator | headless runner, agents, acceptance tests, Difficulty Multiplier tables | `sim-cli/*`, `tests/accept/*` |

When you must touch a file you don't own (e.g. `systems/index.ts`, `data/index.ts`), make the
smallest additive change and say so in your report.
