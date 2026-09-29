# Project Citadel — Architecture

Read `docs/design-v2.md` first; it is the source of truth for *what* the game is.
This file is the source of truth for *how the code is organized* and the rules every
contributor (human or agent) follows so parallel work integrates cleanly.

## Layout

```
src/sim/          Pure TypeScript simulation. NO DOM, NO Math.random/Date/performance.
  math/           Prng (xoshiro128**), LUT trig, ipow/growth/exp/log/pow    [owner: architect]
  core/           ids.ts, types.ts, schema (data/schema.ts), system.ts, world.ts,
                  pools, spatial hash, event log, stat resolver, Sim class  [WP1]
  data/           ALL content as data (trees, nodes, doctrines, fusions, linkages,
                  infusions, anomalies, abilities, frames, enemies, bosses,
                  formations, sectors, trials, prestige, constellation)     [WP-DATA, WP4]
  systems/        One file per combat system implementing core/system.ts    [WP1, WP2, WP3, WP9]
  enemies/        Wave generator, formation scripts, enemy AI, boss scripts  [WP4, WP5]
  economy/        Curves, costs, Scrap/Cores/Echoes/Stars, Forecast          [WP1, WP8]
  run/            Attempt/wave/checkpoint state machine, Push/Patrol, Prestige/Ascension [WP1, WP8]
  directives/     Directive engine, Targeting Profiles, Upgrade Queue        [WP9]
  save/           Serialization, migrations                                  [WP1, WP7]
  index.ts        `export class Sim implements ISim`                          [WP1]
src/worker/       Web Worker wrapper around Sim (protocol in core/types.ts ToWorker/FromWorker) [WP1]
src/render/       WebGL2 instanced renderer, particles, bloom, readability rules [WP6]
src/ui/           DOM panels: HUD, shop, Forecast, Inspector, Codex, Directives, settings [WP7]
src/app/          main.ts glue: worker, render loop, input, IndexedDB saves, PWA, offline [WP6 skeleton, WP7]
sim-cli/          Headless Node runner: agents, acceptance tests, Difficulty Multiplier tables [WP10]
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
   directly outside `World.damage`. The kill chain (Inspector, Codex) depends on this.
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
   (fresh Sim each time) and compare `events.hash()` after N ticks.
8. **No DOM in sim, no sim internals in UI.** UI sends `Command`s and reads `UiState`.
9. **Commit style.** Conventional, imperative subject; body says what and why.

## Tick order (World.step)

```
apply queued Commands
run state machine (between → combat → wave_clear/dead ...)
spawn scheduled enemies for this tick
statuses tick (burn/poison DoT, chill/shock/bleed durations)   [elements system]
enemy AI + movement + contact damage + enemy abilities          [enemies/ai]
rebuild spatial hash
SYSTEM_ORDER: primary → ordnance → drones → blade → laser → gravitics → elements/fusions →
              linkages → anomalies → bastion → reactor → abilities/CE → directives
projectiles move/collide/expire
hazards tick
tower regen/shield recharge; death check
wave clear check; checkpoint; economy; drafts
events → hash; snapshot dirty
```

## Economy constants (design §17) — implement in `economy/curves.ts`

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
