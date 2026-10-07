# Project Citadel — Graphics

The battlefield should read like the game's sentence: every enemy family has its own silhouette and
motion, statuses show on the body, chains draw themselves, and the tower wears the machine the player
built. It stays a single WebGL2 instanced renderer (at most 9 draw calls a frame) and presentation
never touches the simulation.

## Rules this pass keeps

1. **Presentation only.** `snapshot()` and everything in `src/render` never write sim state, never draw
   from the sim PRNG and never emit events. Animation phase is an integer hash of the entity
   generation (`animPhase`), time is the tick or a snapshot frame counter, and the per-enemy
   presentation state (hit-flash limiter, knockback wobble) lives in `SnapshotWriter`, keyed by pool
   index and validated by generation. `tests/render/snapshot-purity.test.ts` proves `events.hash()`, the
   PRNG, every enemy's HP, the tower and Scrap are identical after 2,400 ticks whether `snapshot()` ran
   every tick, every 7 ticks or never, with ordnance, drones, blade, laser, fire and frost mounted.
2. **Enemies stay the most legible thing on screen.** Draw order is unchanged (arena, hazards, player
   effects, projectiles, enemies, outlines, halos, UI). Enemies and their parts never dim; the density
   governor and Clarity still fade only player effects. Every enemy outline now carries a soft dark
   knockout shadow (1.2–5 px, scaled with the on-screen size) so bodies separate from bright blasts
   behind them, and blast cores are smaller and tinted rather than white.
3. **Statuses read by shape and motion first**, colour second (see below).
4. **No flashes above 3 Hz.** Hit flashes are rate-limited per enemy (one every 20 frames), the boss Tell
   ring pulses at 2.5 Hz (was ~8 Hz), weak points and kamikaze fuses pulse at ≤ 3 Hz, tower damage sparks
   blink at 2 Hz, the Bombardment zone blinks at 1.9 Hz (was 7.5 Hz; `src/sim/systems/abilities.ts`).
   The only full-screen effect, the cue vignette, tints the **floor only**, is capped at alpha 0.22 and
   merges pulses closer than 1/3 s.
5. **Reduced motion** (Settings → Graphics, default *System* = `prefers-reduced-motion`): no idle
   wobble, screen shake, camera punch or slow-motion; flashes at 45% alpha; backdrop drift slowed.

## Where things live

| File | Role |
| --- | --- |
| `src/sim/core/snapshot.ts` | `writeScene`: tower, hazards, projectiles, enemies, reticles, system visuals, events → fx and chain links. LOD, hit-flash limiter, knockback detection |
| `src/sim/core/snapshot-art.ts` | `EnemyView` + `writeEnemy`: composite silhouettes for all families, statuses on the body, telegraphs, elite crowns, spawn-in / squash / flash, boss machines and weak points |
| `src/sim/core/snapshot-tower.ts` | `TowerView` + `writeTowerBase` / `writeTowerTop`: nine Frame hulls, hardpoint mounts, attunement runes, shields, cracks, ornament, barrel recoil and muzzle flash |
| `src/sim/core/snapshot-fx.ts` | Colours by source tag, `ChainLines` (kill-chain links), shake / punch tuning |
| `src/render/frame-prep.ts` | The renderer's CPU frame, GL-free: cue fx, visual time, particles, flag decoding, Detail LOD, idle animation, parts following their body, counting sort |
| `src/render/shaders.ts` | Instance SDFs (18 shapes), part shading, status patterns on bodies, outline + knockout, per-Sector backdrop |
| `src/render/quality.ts` | Tiers, reduced motion, auto-degrade monitor, the persisted settings store (`citadel.gfx.v1`) |
| `src/render/juice.ts` | Camera punch, floor vignette pulse, slow visual time, cue shake |
| `src/render/particles.ts` | New effects: Shatter, ChainPips, Scrap / Core pickups homing on the HUD counters |
| `src/ui/graphics-settings.ts`, `src/styles/graphics.css` | Settings → Graphics |
| `src/app/dev-harness.ts` | `#dev:showcase[=enemies|statuses|towers|bosses|fx]` |
| `tests/render/*.test.ts` | Purity, composites, chain lines, timing and safety caps, frame prep, showcase |

## The instance stream contract

Instances stay 12 floats. The graphics pass adds, without breaking any reader that tests `layer === 4`:

* **Flags in the layer float**: `layer + 8 × InstFlag` (`Part`, `Detail`, `Chain`, `Flash`, `Soft`).
  Pickers (`app/pick.ts`), the reticle overlay, e2e and tests see exactly one unflagged layer-4 body per
  enemy, as before.
* **Parts** (`InstFlag.Part`) carry their body's instance index in `aux1`. The renderer applies the body's
  idle animation and the phone minimum size (3.5 CSS px) around the body centre, so composites keep
  their proportions when a swarmer is enlarged on a phone.
* **Bodies, outlines, halos** carry a packed `aux1`: `RStatus` bits (0–7), animation phase (8–13),
  `AnimKind` (14–17), `AnimRate` (18–19: normal, chilled = slow, frozen = none, fast).
* **New shapes** (`Shape`): Pentagon, Octagon, Chevron, Arc (90° ring segment), Gear, Drop.
* **New fx** (`FxKind`): Shatter, ChainPips, Punch, Shake, SlowMo, Pickup, PickupCore.

## A. Enemy life

* **Idle animation per family** (renderer, from the packed aux1, phase per enemy): breathe (grunt,
  shielded, veteran), jitter (swarm, brood, fragments), sway (runner, leech, phase), heavy (brute,
  armored, anchor, artillery, bosses), spin (kamikaze, jammer), slow spin (warden, nullifier,
  refractor), pulse (healer, carrier), wobble (splitter, charger, burrower, clump). Scale stays within
  ±8 %, rotation ±0.35 rad; chilled enemies animate at 45 % speed, frozen ones not at all.
* **Hit flash and squash** from `lastHitTick`: a white silhouette (Flash flag) for 6 frames and a 14 %
  squash, at most one flash per enemy every 20 frames (3 Hz).
* **Spawn-in**: scale 0.55 → 1 and fade 0.35 → 1 over 24 ticks.
* **Telegraphs**: charger wind-up pulls the body back and flares its horn with a red ring (the existing
  charge line stays); kamikaze fuse core pulses 0.8 → 3 Hz as it closes in; artillery barrels always aim
  at the tower and draw an aim line for the last 0.75 s before a shell; healers emit a ring that expands
  to their 90-unit aura on their real 0.5 s heal cadence (≤ 16 per frame).
* **Knockback wobble**: an outward jump of more than 4 units in a frame rocks the body for 12 frames.
* **Deaths** shatter: killer-tinted shards and flash (`Kill`, colour from the Kill event `src`: element,
  fusion, linkage or system) plus body-coloured chunks (`Shatter`), both scaled by the enemy radius.
* **Elites** wear a gold crown (kept at LOD) and a soft gold aura.

## B. Composite silhouettes

Every family is its def shape plus 0–3 parts; `tests/render/composite.test.ts` checks all 21 read
distinctly (body + part shapes), bodies stay single and pickable, and parts never exceed 3.

| Family | Read | Family | Read |
| --- | --- | --- | --- |
| Grunt | triangle + dark eye | Armored | square + inner plate + visor slit |
| Swarm | circle, jitter | Warden | hex core + two rotating shield arcs |
| Runner | shard + speed streak | Artillery | triangle + barrel aimed at the tower + base plate |
| Brute | square + shoulder pads + visor | Charger | shard + horn chevron (flares on wind-up), dash streak |
| Kamikaze | star + fuse core | Anchor | heavy square + dark hex + chain links |
| Shielded | hex + front shield arc (fades as the shield breaks) | Phase | circle + inner crescent + ghost echo ring |
| Splitter | diamond + three fragment seeds | Burrower | crescent + drill; a dust mound while burrowed |
| Carrier | hex + three brood pods that swell before a release | Nullifier | cross + void core + null octagon |
| Healer | disc + white cross | Refractor | diamond + inner prism + glint |
| Leech | crescent + fangs (+ red mouth when tethered) | Jammer | star + orbiting antenna + static wave ring |
| Veteran | triangle + rank chevron + armor plate | Clump / Retainer | hex + merged bodies / role marks (resistance orb, generator, turret barrel) |

**Bosses** are multi-part machines from a per-boss table (arms, sacs, treads, jaws, halos, clock hands,
gates, cells, accretion disks...): parts orbit, spin, pulse, or extend while the boss's tell winds up;
plates and cores appear or vanish by phase (and the body shifts hotter per phase), so phase changes are
visible in the silhouette (17 of 21 bosses change their part set). Weak points show as a dark hatch
while closed and a pulsing gold node with an expanding ring while open.

## C. Statuses on the body

Patterns are drawn in the body's own fragment shader (no extra instances, kept at LOD), plus up to
two small marks per enemy (Detail):

| Status | On the body (shape / motion) | Mark |
| --- | --- | --- |
| Burning | flames travelling around the rim, stronger on top | flickering flame above |
| Chilled | frost speckle crust on the rim; animation at 45 % speed | frost flake at the rim |
| Frozen solid | pale, faceted ice lines; no idle motion | translucent hex ice shell (kept at LOD) |
| Poisoned | bubbles rising inside | green drip falling |
| Shocked | a zig-zag bolt re-rolled 3 × a second | spark jumping around the rim |
| Bleeding | dark drip streaks from the lower half | dark red drip |
| Brittle | dark crack lines | — |
| Marked | the existing red reticle (layer 7) | — |

## D. The tower wears its build

Nine hulls: Standard hex; Arsenal fortress with four corner turrets; Conductor copper coil with
lightning prongs; Monolith stacked octagons and a heavier barrel; Hive honeycomb; Bulwark turning
cog; Echo Engine hex with a drifting echo; Prism star of two triangles; Singularity Core dark core with
accretion arcs. Hardpoints mount on the diagonals: ordnance pod with missile tips, drone bay (three
docked drones while none are deployed), spinning blade hub, laser emitter (plus an emitter ring),
gravitics core with orbiting motes. Attunements are element rune arcs with the status glyph. Shield =
hex cell ring, barrier = six rotating plates, cracks below 50 / 30 / 15 % HP and 2 Hz sparks below 25 %.
The barrel housing recoils and flashes when a primary round leaves it. Ornament grows with the deepest
wave: bare at 1; a foundation ring at 5; ticks at 20; rotating arcs at 40; a crown star at 60; an outer
ring of studs at 80; a gold filigree ring with orbiting motes at 100.

**Prestige mark and rebuild beat (UX Phase 4, `src/render/moments.ts`, renderer-side only).** One amber pip per
Prestige done sits on an arc above the hull; past 10 it is one pip and the count as a seven-segment numeral. On the
first Prestige the old tower dissolves and the new hull assembles (see docs/ONBOARDING.md, "The first Prestige").

**Telegraphs survive spectacle (UX Phase 4, C-18).** While a boss tell is live (UiState.wave.tellActive), player
effects on layers 1–3 within ~2.2 boss radii + 70 units of the boss keep 20 % of their alpha (10 % at full Clarity), so
blast cores and their bloom no longer bury the tell, and one amber marker with a dark under-stroke is drawn on layer 7,
picked by the tell's Counter: a closing ring (Repulsor Pulse, Missile Storm, Singularity Bomb), a wedge toward the
tower (Time Field), a beam line toward the tower (EMP), a ring with crosshair ticks (Bombardment, designate), or a ring
on every boss-sized body (Hunter Mark: the clones, never giving the true one away). The boss is the largest enemy body
in the snapshot. Reduced motion holds the marker still. Known limit: layer 3 also holds enemy shots, which fade near the
boss too.

## E. Visible chains

When an event's cause is a *new link* (its chain depth is ≥ 2 and deeper than its parent's: another
system or element joined), a thin line is drawn from the parent's position to the child's, coloured by
the child's source, fading over 24 snapshot frames (~0.4 s). The snapshot keeps at most 64 links and
prefers the deepest (`chooseChainSlot`); the renderer caps them per tier (64 / 40 / 24) and Settings can
turn them off. Enemy chains (their attacks are caused by their own Spawn) are excluded. Kills at depth
≥ 3 show a row of small gold pips, one per link (up to 8).

## F. Juice (presentation only)

* Camera punch (zoom kick ≤ 7 %) and floor vignette pulse on a Counter (strength 1), a boss's final blow
  (1.4) and Prestige (2).
* Screen shake per event: explosions 0.1 per 100 units of radius (max 0.22), an enemy blast near the
  tower 0.35, boss phase 0.45, barrier break 0.5, boss killed 0.85, plus the existing tower-hit trauma.
* Slowed *visual* time during a Counter: particles, idle animation and shader time run at 35 % for
  0.25 s and ease back over 0.6 s. The sim is untouched.
* Scrap and Core pickups: every third kill sends a gold mote, every Core drop a violet hex, bursting out
  and homing on the HUD counters.

## G. Sector ambience

The backdrop shader draws a per-Sector floor from `palette.ts` (motes use the Sector accent from
`data/sectors.ts`): Outskirts rings and spokes; Hive honeycomb; Bastion Line plate grid with ticked
rings and a crenellated rim; Fold warped, slowly breathing rings; Court double rings with filigree and
a double rim. Two layers of drifting motes slide against the camera when it pans (parallax). The floor
stays dark and low-contrast so enemies remain the brightest, sharpest thing on screen, and a static
edge vignette frames the arena.

## H. Quality tiers

| Tier | DPR cap | Bloom | Composite parts | Particles | Ambience | Chain lines |
| --- | --- | --- | --- | --- | --- | --- |
| High | 2 | on | up to 600 enemies | 100 % | grid + sweep + motes | 64 |
| Medium | 1.5 | on | up to 350 enemies | 75 % | grid + sweep | 40 |
| Low | 1 | off | none (base shapes) | 50 % | grid | 24 |

**LOD thresholds.** The snapshot drops composites for everyone above **600** live enemies and restores
them below **540** (hysteresis, `lodFor`); the ice shell, elite crowns, boss parts and telegraphs stay.
The renderer additionally drops Detail parts above the tier's enemy count.

**Auto-degrade.** The renderer measures real rAF deltas; when the mean over a full 2 s window exceeds
**22 ms** (under ~45 fps) it drops one tier for the session (not persisted), then waits 4 s to settle.
Deltas over 250 ms (tab switches, hitches) are ignored, and nothing is measured in the first 4 s.
Settings shows "Lowered to … this session" when it happens; *Auto-adjust quality* turns it off.

Settings → Graphics: Quality, Auto-adjust quality, Bloom, Kill-chain lines, Screen shake, Reduced
motion (System / Reduce / Full). Persisted in `localStorage['citadel.gfx.v1']` (Bloom stays in the UI
prefs).

## I. Showcase

`index.html#dev:showcase` (pages: `=enemies`, `=statuses`, `=towers`, `=bosses`, `=fx`) lays out the
real art writers: all 21 families and sub-units (plain, elite, active/telegraph with a hit flash and
spawn-in every 3 s), every status on three bodies and all at once, spawn / flash / knockback / LOD
beats, the nine Frames with hardpoints and ornament from wave 1 to 100, all 21 bosses cycling phases,
tells and weak points, and a hopping five-link chain with pips, deaths, pickups and every effect kind.
Enemies are drawn 2.2 × larger than in play. Keys 1–5 switch the Sector palette.

## Measurements

### CPU and instances

`npx tsx tests/render/bench-gfx.ts [enemies]`: wave 40, the field topped up to N enemies of all 21
families (3 % elite), 600 measured frames after 120 warm-up frames; `snapshot()` is the worker's cost per
frame, *render CPU* is `FramePrep.frame` (cue fx, particles, flag filter, idle animation, parts, sort;
everything the renderer does on the CPU except GL calls). Node 22 on the dev container's CPU; the
baseline is the same harness on the tree before this pass (commit `3e32c4d`, old `snapshot.ts` and the
old sort + particles path). Software GL makes frame rates meaningless here, so only CPU-side numbers
are reported. Means of 2–3 runs.

| Scene | Snapshot instances | Drawn instances (with particles) | snapshot() | render CPU | CPU total |
| --- | --- | --- | --- | --- | --- |
| **Wave 40, 800 enemies — baseline** | 2,261 | 10,503 | 0.23 ms | 0.44 ms | 0.67 ms |
| **Wave 40, 800 enemies — final** (LOD on) | 2,494 (**+10 %**) | 10,738 (**+2 %**) | 0.38 ms | 0.59 ms | 0.97 ms (**+0.30 ms**) |
| 400 enemies — baseline | 1,243 | 9,279 | 0.16 ms | 0.45 ms | 0.61 ms |
| 400 enemies — final (composites on) | 2,348 (+89 %) | 10,376 (+12 %) | 0.33 ms | 0.54 ms | 0.86 ms (+0.25 ms) |
| 1,500 enemies — baseline | 4,139 | 12,467 | 0.35 ms | 0.48 ms | 0.82 ms |
| 1,500 enemies — final (LOD on) | 4,443 (+7 %) | 12,769 (+2 %) | 0.55 ms | 0.70 ms | 1.25 ms (+0.43 ms) |

The targets for wave 40 with 800 enemies (≤ +25 % instances, ≤ +1 ms CPU) hold with room to spare:
above 600 enemies the snapshot drops composites, so the remaining cost is the body/outline packing, the
per-enemy flash / knockback tracking, status marks for frozen enemies, elite crowns, hit flashes and
64 chain lines. Below the LOD threshold composites cost up to three instances per enemy by design.

### Readability at wave-62 density

`npm run build && node tests/render/readability.mjs` generates a wave-62 save (seed 3), plays it in
headless Chromium at 1280×800 and at 390×844 with touch, freezes the sim and visual time four times
during combat, and for every enemy body compares the luminance of its silhouette rim (55–85 % of the
radius) with the ring just outside it (WCAG contrast ratio), ignoring points that fall on other enemies.
"Over effects" are enemies whose wider surroundings are lit by player effects (the w62 build is
ordnance + drones + blade + fire + frost at ×8, so almost all of them). Pass: median ≥ 1.6, ≥ 30 % of
enemies at 2:1 or better, and median ≥ 1.5 over effects, on both viewports.

| Viewport | Enemies sampled | Median | ≥ 2:1 | Median over effects | Pass |
| --- | --- | --- | --- | --- | --- |
| Desktop, before | 55 | 1.50 | 18 % | 1.41 | no |
| Desktop, after | 92 | **1.93** | **46 %** | **1.81** | yes |
| Phone, before | 57 | 1.39 | 16 % | 1.36 | no |
| Phone, after | 77 | **1.65** | **35 %** | **1.54** | yes |

The committed script on the final build (its own freshly generated wave-62 save): desktop median 1.69,
37 % ≥ 2:1, 1.65 over effects; phone median 1.83, 46 % ≥ 2:1, 1.65 over effects: PASS on both.

What moved the numbers: the knockout pass (outline shapes drawn with MIN blending before the enemy
layers, so only what is *bright* within a few px of an enemy is pulled down; a dark floor is untouched),
opaque outlines, a brighter body rim, and smaller tinted blast cores. Enemies are never dimmed or faded
to achieve this. Composite parts under ~1.8 px on screen fade out (a 1 px part is a smudge that darkens
a phone-sized body), and outlines thin to 1.3 px on tiny bodies.

### Screenshots

Before / after pairs (phone 390×844 with touch and desktop 1280×800) for waves 1, 12, 25, 42 and 62,
four boss waves (30, 40, 45, 60; normal, tell and zoomed), each Frame's tower (zoomed) and the showcase
pages were captured during the pass and reviewed; the showcase regenerates all of them on demand.
