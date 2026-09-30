# Project Citadel

A browser idle tower-defense game where a single tower in an open arena is the player's
character, and each Prestige is a new machine they design. Built from
[`docs/design-v2.md`](docs/design-v2.md).

> "The drone shocked the frozen enemy, which caused the lightning to jump through the laser
> node, which detonated its poison, which killed the elite, which launched the missiles."
> That sentence is the game, and the Kill-Chain Inspector will show it to you.

## Play

- **Hosted:** `https://short-matthew-f.github.io/idle-defense-shooter/` once GitHub Pages is enabled
  for this repo (Settings → Pages → Source: *GitHub Actions*; the workflow in
  `.github/workflows/deploy.yml` already builds, tests and deploys on every push to `master`).
- **Locally:**

```sh
npm install
npm run dev        # http://localhost:5173/idle-defense-shooter/
npm run build && npm run preview
```

It is an installable PWA and runs offline. Saves live in IndexedDB, autosave every 30 s and at
every checkpoint; export/import strings are in Settings.

### How it plays

- The tower fights on its own. Enemies come from the perimeter in authored formations; every fifth
  wave is a boss and a checkpoint. Dying restarts you at the wave after your last cleared boss and
  keeps your Scrap and upgrades. Failure is progress: come back with three or four new purchases.
- **Tap an enemy** to designate it (every weapon that can reach it prefers it). **Hold** to steer the
  primary weapon. **1–4** arm tactical abilities that spend Command Energy; cast the right one during a
  boss's tell to score a Counter.
- **Build identity.** A Frame, up to four Hardpoints (Ordnance, Drones, Orbital Blade, Laser Polygon,
  Gravitics), Attunements (Fire, Lightning, Poison, Frost), and one Doctrine per tree lock for the
  Prestige. Cores from boss first-kills buy Exotics, Refits, Doctrine changes and Anomaly rerolls.
- **Prestige** when the Forecast says your Echo rate has peaked. Echoes buy the four Prestige layers;
  wave 100 opens Ascension, Stars and the Constellation; Trials, the Chain Codex, the Threat Dial and
  Deep Waves give the long tail.
- **Directives** (Prestige III) let you program the machine: `WHEN 5 enemies in inner ring → Repulsor
  Pulse`. Automation closes part of the gap to active play, never all of it.

Keys: `Space` pause + Inspector · `1–4` abilities · `P` Push/Patrol · `B` shop · `F` Forecast · `Esc`.
Append `#dev` to the URL for the renderer stress harness.

## Develop

```sh
npm run check        # typecheck + all tests (vitest)
npm run test:watch
npm run sim -- --agent generalist --policy idle --seed 1 --hours 2 --report
npm run sim -- --agents all --policies idle,active --seeds 1,2 --report --jobs 4
npm run sim -- --difficulty          # per-formation, per-archetype Difficulty Multipliers
npm run sim:accept -- --quick        # the design's §19 acceptance tests (full run ~20 min)
```

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first. The short version:

| Layer | Where | Notes |
| --- | --- | --- |
| Simulation | `src/sim/` | Pure TypeScript, fixed 60 Hz, struct-of-arrays pools, seeded PRNG and lookup-table trig so Node and every browser produce identical event hashes. Every damage, status, spawn and explosion carries a cause id, which feeds the Inspector and the Codex. |
| Content | `src/sim/data/` | All trees, doctrines, fusions, linkages, infusions, anomalies, abilities, frames, enemies, bosses, formations, prestige and constellation nodes as data. |
| Systems | `src/sim/systems/`, `src/sim/enemies/` | One plugin per combat system; bosses and enemy behaviors; hooks instead of cross-imports. |
| Worker | `src/worker/`, `src/app/sim-client.ts` | The sim runs in a Web Worker; the main thread paces it and receives snapshots. |
| Rendering | `src/render/` | WebGL2 instanced SDF shapes, additive glow, one bloom pass, density governor, threat halos. |
| UI | `src/ui/`, `src/app/` | Vanilla DOM: HUD, shop, Forecast, Inspector, Codex, Directives editor, Trials, settings, saves, PWA. |
| Simulator | `sim-cli/` | Headless runner, purchase agents, player policies, Difficulty Multiplier grid, acceptance gate. |

Balance history and current acceptance status: [`docs/BALANCE.md`](docs/BALANCE.md) and
`sim-out/BASELINE.md` (generated).

How a new player meets the game (the unlock ladder, which weapons and elements each Prestige offers, the
first-Prestige ceremony, the Quartermaster, Unlock everything, and how to test it): [`docs/ONBOARDING.md`](docs/ONBOARDING.md).
