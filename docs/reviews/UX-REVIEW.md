# Project Citadel: UX review

Sep 29, 2026 · build `20f3a87` + this pass (uncommitted)

Played as a new player and as a returning one in Chromium via Playwright (SwiftShader GL), at desktop
1280×800 and with touch emulation at phone 390×844, 360×740 and landscape 844×390. Progressed saves
came from the headless sim (Generalist agent, seed 3) at waves 12, 25, 42 and 62; the 42 and 62 saves
carry Prestige III meta (Directives, Trials, Threat Dial, Blueprints, frames) so every screen could be
reached. Screenshots referenced below are in the session scratchpad under `ux/` (`j1-*` first launch,
`j2-*` shop, `j3-*` active play, `j4-*` Forecast/Prestige/menus, `j6-*` readability, `j7-*`
accessibility and layout, `j9-*` after-fix checks).

Severity: **Blocker** (a pillar fails or a screen is unusable), **Major** (a core loop is confusing or a
touch action misfires), **Minor**, **Polish**.

## Top 10

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | Blocker | Death is silent: no message, no reason, no suggestion; the tower just reappears at wave 1 | Fixed |
| 2 | Blocker | Landscape phone (844×390): HUD + peek sheet leave no arena at all (camera scale 0.001) | Fixed |
| 3 | Major | Touch: swiping the shop list or the quick-buy row over a Buy button buys it | Fixed |
| 4 | Major | Primary buttons and the active speed chip have light text on the bright accent (contrast 1.7–2.1:1) | Fixed |
| 5 | Major | Enemies are 1–3 px on a phone and the tap reach is under 8 px, so thumb designation mostly misses; no visible designation or aim feedback | Fixed |
| 6 | Major | First boss tell says "counter with Repulsor Pulse" while both ability slots are empty and nothing explains how to equip | Fixed |
| 7 | Major | New attunement / hardpoint slots open silently; nothing in the quick buys points at them | Fixed |
| 8 | Major | Anomaly draft auto-picks after 30 s with no warning | Fixed |
| 9 | Major | "Nothing affordable yet" is a dead end (early game), and a lie at the wall (w62: 2.4M Scrap, every node maxed) | Fixed |
| 10 | Major | First purchase is not discoverable on a phone: the "Quick buys" label is hidden under 420 px and nothing says "tap to buy" | Fixed |

## First-session timeline (phone, idle player, sim time)

| Time | Before this pass | After |
| --- | --- | --- |
| 0:00 | Three onboarding cards (`j1-01…03`). Clear, short. The "Next" button is white on amber (finding 4). | Same cards, dark-on-amber button. |
| 0:05 | Wave 1. Sheet peek says "Nothing affordable yet", the rest is an empty arena with three dots (`j1-04`). | "NEXT Muzzle Velocity ♦12 ~8s" chip (`j9-01`). |
| 0:12 | First node affordable (12 Scrap). Chips appear with no label and no hint (`j1-05-idle-15s`). | "Tap to buy" coach, first chip pulses until three purchases (`j9-02`). |
| 0:40–1:10 | Waves 2–3, 58 → 111 Scrap, 16 affordable nodes, nothing bought by an idle player (`j1-05-idle-70s`). | Same economy; the coach keeps pointing at the chips. |
| ~1:40 | Wave 5, The Breaker. Tell "Slam wind-up: counter with Repulsor Pulse" while both ability slots are empty (`j1-11-boss-tell-0`). | Tell reads "Repulsor Pulse counters it. Tap to equip it"; tapping equips it (`j9-03`, `j9-04`). Empty slots pulse once CE ≥ 25. |
| ~2:00 | The tower dies on wave 5, the HUD flips to wave 1, no toast, 205–282 Scrap unspent (`j1-06`, `j1-08`). | Death card: "The Breaker destroyed the tower on wave 5 · Restarting at wave 1" and three purchases to tap (`j9-05`, `j9-06`). |
| ~2:10 | Attunement slot opened (after clearing wave 5) with no announcement. | Toast "Attunement slot open" and an "Attune an element" chip in the quick row. |
| 2–30 min | A player who buys only from the quick chips needs 26–33 min and 14–20 deaths from checkpoint 5 to 10 (headless model below). The Generalist with the active policy reaches wave 12 in 5.5 min. | UI can't change this; reported as a balance note (S8). |
| wave 10 | Anomaly draft modal: readable on a phone, rarity shown by shape and label (`j1-20`). Auto-picks silently after 30 s. | Countdown line: "If you don't choose, Overcharged Capacitor is picked automatically in 24s." |

Headless model of a quick-chip player (`quickbuy-sim.ts` in the scratchpad): buying the cheapest affordable
node every 1.5 s, with and without filling open slots, seeds 1–2: checkpoint 10 at 26–33 min, 14–20 deaths;
filling slots only saves ~4 deaths. Spending order barely matters. The gap to the active Generalist is in
active play (abilities, designation), which is why the tell/equip and ability-slot fixes matter.

## What already works well

- The HUD covers everything the design lists (checkpoint pips, CE marks per ability, boss phase marks,
  a tell window that shrinks), all with aria labels. Keyboard focus order is sensible
  (Menu → Push → speeds → restart → pause → Forecast → abilities → panel → tabs), with a visible focus ring.
- Drafts, Prestige, Forecast, Trials, Codex, Directives and Settings are all usable at 390 px
  (`j4-phone-*`). The Directive editor builds a rule on touch with 44 px controls throughout; the audit found
  no control smaller than 44 px except the sheet handle, whose visible 22 px bar has a 44 px hit area.
- Rarity, status and tell cues use shape + label + border style, never hue alone (design §10, §20).
- The Kill-Chain Inspector overlays the paused field and traces a kill in one tap (`j4-phone-11`).
- The offline-return modal explains exactly how the number was made (`j4-phone-01`).
- UI update cost stays small at wave 61: `ui.update` p50 0.6 ms, p95 0.8–0.9 ms, max 3.1 ms.
- The hold-to-buy and target-switching fixes from the last commit hold up: no runaway repeats seen.
- Toast volume is low: 0 toasts in 30 s real time at ×8 on the wave-62 save.

## Findings

### Blocker

**B1. Death is silent** · `j1-06-death.png`, `j1-08-after-death.png`
The `dead` phase lasts 1.5 s; the HUD shows "HP 0/100", then wave 1. No event feed entry, no reason, no
purchase hint, while 205–282 Scrap sits unspent. Pillar 3 ("a failed attempt should reveal three or four
exciting purchases") needs the game to show them.
Fix: a non-modal death card on `Ev.TowerDeath` with a headline (boss name when it was a boss wave), the
restart wave, the Scrap banked and three suggestions: an open slot, an unchosen Doctrine fork, then the
best affordable buys (mechanics over core stats over other stats, one per tree), padded with what you are
saving toward plus an ETA. Tap buys (single buy, not hold) or jumps to the tree. It clears on the next
wave clear, Prestige, or dismissal, and never rebuilds under a finger (rebuilt only when the suggestions change).
**Fixed**: `src/ui/advice.ts:85` (`suggestPurchases`), `src/ui/death.ts:16`, wired at `src/ui/index.ts:146`,
styles `src/styles/death.css`; toasts and the card share one column (`src/styles/feed.css:3`). Tests: `tests/ui/advice.test.ts`.

**B2. Landscape phone has no arena** · `j7-before-land844.png` → `j7-after-land844.png`
At 844×390 the ≥600 px HUD is two columns and 186 px tall, the bottom sheet peeks 132 px, and the ability row
sits between them: the camera fit scale was 0.001. The manifest allows any orientation.
Fix: short landscape (height < 500, wider than tall, ≥ 600 px) uses the side panel at 300 px, a compact HUD
(controls beside the wave/resources row, collapsing speed picker) and the ability bar as a column on the left
edge, with the camera inset moved left. The arena now draws at radius ~125 px.
**Fixed**: `src/ui/sheet-logic.ts:21` (`isCompactLandscape`, `panelWidth`, `arenaInsets` left inset),
`src/ui/sheet.ts` (layout, `--panel-w`, `layout-compact`), `src/ui/index.ts` (relayout), `src/styles/hud.css:121`,
`src/styles/abilities.css:53`, speed picker media query in `src/ui/hud.ts` `pickSpeed`. Tests: `tests/ui/sheet.test.ts`.

### Major

**M1. Swipe-to-scroll buys** · `j2-05-after-swipe.png` (ranks 725 → 726 after a vertical swipe that started on
a Buy button; the same for a horizontal swipe across the quick chips)
`holdRepeat` fired on `pointerdown`, before the browser could decide the touch was a scroll. Same family as
the reported runaway hold-to-buy.
Fix: a pure `HoldGesture` state machine. Mouse behaviour is unchanged. On touch nothing fires on touch-down:
a tap fires once on its click, holding still for 480 ms starts the repeat, and moving more than 10 px or a
`pointercancel` (the browser scrolling) cancels without buying. Re-tested: swipe 725 → 725, tap +1, hold +n.
**Fixed**: `src/ui/hold.ts:25`, `src/ui/dom.ts:70`. Tests: `tests/ui/hold.test.ts` (8 cases).

**M2. Light text on the accent (contrast)** · `j1-01-onboard-1.png` ("Next"), `j7-before-desk-overview.png`
`#ui button { color: inherit }` (specificity 1-0-1) overrode `.btn.primary { color: var(--on-accent) }`, so
every primary button, the active speed segment and several colour rules (`.tab` dim, `.btn.danger`,
`.mode-btn.patrol`, `.forecast-btn.alert`) lost their colour. Measured 2.07:1 on the blue sector accent and
about 1.7:1 on amber.
Fix: move the reset into `:where()`, which still beats the UA stylesheet but never beats a component rule.
**Fixed**: `src/styles/theme.css:49`. Buttons now also get their intended 600 weight.

**M3. Phone designation and legibility** · `j1-05-idle-70s.png`, `j3-01-designate-tap.png` → `j3b-01-designated-reticle.png`, `j3b-02-aim-line.png`
At phone scale (0.32 px per world unit) a grunt is a 3 px dot and a swarmer about 1 px. The tap gate used 24 world
units (7.7 px). The designated outline is 2 world units wide (under 1 px), and hold-to-aim had no visual at all.
Fixes:
- The tap reach is at least 22 CSS px in screen space, and never below the sim's own reach. The snapped
  enemy position is still what `designate_at` sends, so the sim resolves the same enemy. Off-centre (~14 px)
  thumb taps designated 5/5. `src/app/pick.ts:19` (`tapReach`), `src/app/game.ts:227`.
- Enemy bodies, outlines and halos draw at least 3.5 CSS px in radius (the `uMinPx` uniform; the outline keeps
  its gap and the halo its 1.8× ratio). `src/render/shaders.ts:60,76`, `src/render/renderer.ts` (`minEnemyPx`).
- The field overlay (layer 7): a ripple where a tap lands (red when it hit an enemy), a ≥ 12 px reticle on
  every designated or marked enemy, and an aim line from the tower while holding. `src/app/overlay.ts:21`,
  `Renderer.setOverlay` (`src/render/renderer.ts:229`), built each frame in `src/app/game.ts:180`.
  Tests: `tests/render/overlay.test.ts`.
**Fixed** (the reticle is now driven by the sim's layer-7 marker, S1; the outline-colour guess is gone).

**M4. The Counter prompt is not actionable** · `j1-11-boss-tell-0.png` → `j9-03-tell-unequipped.png`, `j9-04-tell-equipped.png`
The Breaker's tell arrives at about 1:40 into the first session with both ability slots empty. The text named
an ability the player cannot use and gave no route to it (equipping needs a long-press on an empty slot).
Fix: the tell banner is a button, and its text follows the state: "Repulsor Pulse counters it. Tap to equip it" →
"counter with Repulsor Pulse (needs 30 CE)" → "tap to counter with Repulsor Pulse". Tapping equips it into the
first empty slot, arms it, or casts it. Empty ability slots pulse once CE reaches the cheapest ability.
**Fixed**: `src/ui/hud.ts:269` (`tellPrompt`), `src/ui/hud.ts:209`, `src/ui/abilities.ts:73,120`, handler in
`src/ui/index.ts:80`. Tests in `tests/ui/advice.test.ts`.

**M5. Slot openings are invisible**
Attunement slots open at waves 5, 25 and 45, hardpoints at 10, 30, 55 and 75 (the biggest step changes in a
Prestige). The only sign was a dot on the Elements tab. A player living in the peek sheet never saw it.
Fix: a toast when a slot opens, plus an "Attune an element" / "Mount a weapon" chip in front of the quick buys
that opens the slot picker (and expands the sheet).
**Fixed**: `src/ui/feed.ts:50`, `src/ui/shop.ts:268`, `src/ui/advice.ts:59` (`openSlots`), `Sheet.reveal`
(`src/ui/sheet.ts:67`).

**M6. The draft auto-pick is silent** · `j1-20-draft.png`
The run machine picks the first offer after 30 s in the draft phase so an idle tower never stalls. The modal
did not say so, and at ×1 a player comparing cards can lose the choice.
Fix: a countdown line under the cards, naming the card that will be picked.
**Fixed**: `src/ui/draft.ts:37,56`. Tests: `draftSecondsLeft` in `tests/ui/advice.test.ts`. The countdown now reads
the sim's deadline (`UiState.run.draftTicksLeft`, S2).

**M7. The "Nothing affordable yet" dead end** · `j1-04-first-view.png`, `j2-01-peek.png`, `j6-before-clarity-0.png` (wave 61)
Early on it leaves nothing to look at. At the wall it is wrong: the wave-62 save has 2.4M Scrap and every Scrap
node is maxed.
Fix: when nothing is affordable, a "NEXT <node> ♦price ~ETA" chip (ETA from the HUD's income meter) that
opens its tree. When everything is owned, "Every upgrade owned: see the Forecast".
**Fixed**: `src/ui/advice.ts:49` (`nextPurchase`), `src/ui/shop.ts:275–279`. Tests in `tests/ui/advice.test.ts`.

**M8. First-purchase discoverability** · `j1-05-idle-15s.png`
Under 420 px the "Quick buys" label is hidden, so the chips are anonymous pills. The idle run bought nothing in
3 minutes with 17 nodes affordable.
Fix: a "Tap to buy" coach label and a pulse on the first chip until three purchases (stored in prefs).
**Fixed**: `src/ui/shop.ts:289`, `noteBuy` on `Ev.Purchase` (`src/ui/index.ts`), `src/ui/prefs.ts` (`buyCoach`),
`src/styles/sheet.css`.

### Minor

| # | Finding | Screenshot | Status |
| --- | --- | --- | --- |
| m1 | Shield and Barrier bars each took a full 20 px row; the phone HUD reached 205 px (24% of the screen). They now share one 16 px row. | `j6-before-clarity-0` → `j6-after-clarity-0.5` | **Fixed** `src/styles/hud.css:111` |
| m2 | Full Clarity left player effects at 55% opacity, but design §20 says they fade toward 40%. Explosions still bloom white at Clarity 1. | `j6-before-clarity-1` | **Fixed** `src/render/renderer.ts:256` (fx alpha `1 − 0.6·clarity`). Particle emission scaling is unchanged. |
| m3 | Armed-ability hint said "Tap the field to cast X". It now reads "X armed: tap the field to cast". Cancel works by re-tapping the slot, the Cancel pill, or Esc. | `j3-02-armed` | **Fixed** `src/ui/abilities.ts` `renderArmed` |
| m4 | The Inspector footer told phone players "Space resumes". The "6.6s ago" label was clipped at 390 px. | `j4-phone-11-inspector` | **Fixed** `src/ui/inspector.ts:88`, `src/styles/inspector.css` (source chip ellipsizes) |
| m5 | The Forecast "peak 25K/h" label was clipped at the chart's right edge. | `j4-phone-02-forecast` | **Fixed** `src/ui/forecast.ts:109` (anchors away from the edge) |
| m6 | The Forecast chart's peak (25K/h) disagrees with the "Peak 34.6K/h" readout above it. | `j4-phone-02-forecast` | **Fixed** sim-side (S5) |
| m7 | The Codex shows no hints at wave 62 (`ui.hints` is empty with 79 entries undiscovered), so "???" cards give no lead. | `j4-phone-09-codex` | **Fixed** sim-side (S6). A UI fallback that shows the recipe for Fusions/Linkages ("Fire + Frost") is still about 1 h. |
| m8 | Welcome-back credit at wave 62 is 4.8K Scrap for 3 h against a 2.4M bank and ~5K/s live income: `patrolScrapPerSecond` is 1.13/s because it is only measured while patrolling. The modal is honest but the number is meaningless. | `j4-phone-01-offline-return` | **Fixed** sim-side (S7) |
| m9 | HUD boss name truncates to "Boss: The B…" on a phone (the boss bar shows it in full). | `j1-06-death` | **Open**, 15 min (hide `.wave-boss` when the boss bar is visible) |
| m10 | The side panel's quick-buy row is clipped by the close button at 300–360 px (it scrolls, but the clip hides that). | `j7-after-land844` | **Open**, 20 min (fade mask on the row's right edge) |

### Polish (open)

- ~~Inspector sentences repeat themselves ("…caused the loaded dice to trigger loaded dice…", `j4-phone-11`).~~ Fixed sim-side (S4).
- The threat-halo pulse and white-hot explosions still dominate at wave 40+ on a phone even at Clarity 1
  (`j6-after-clarity-1`); a per-kind particle cap for Kill/Explosion fx under Clarity would help (renderer, 1–2 h).
- Undiscovered Codex cards could show their group's recipe shape instead of bare "???" (1 h).
- The "×1" speed control is highlighted as the primary accent even when it is the only speed allowed; a
  neutral style until Accelerated Clearing would draw less attention (15 min).

## Accessibility notes

- Icon-only buttons all carry aria-labels (the audit found no unlabeled buttons, desktop or phone).
- Hit targets: every control is ≥ 44 px at 390, 360 and 844×390, except the sheet handle's visible 22 px bar
  (its hit area is 44 px through `::before`).
- Contrast: after M2, the lowest measured text pair is `--text-faint` on the panel (about 4.6:1, 14 px). The new
  "NEXT" label uses `--text-dim`.
- `prefers-reduced-motion` already disables the new pulses (theme.css rule covers `#ui *`).

## Performance feel (390×844, wave-61 save)

SwiftShader is a software GPU, so frame pacing here (2–3 fps, p50 frame 433 ms with ~8.6K particles) says
nothing about an iPhone. CPU-side numbers are meaningful:

| Measure | Result |
| --- | --- |
| `GameUi.update` (10 Hz), sheet at peek | p50 0.6 ms, p95 0.8 ms, max 1.0 ms |
| `GameUi.update`, sheet full on Chassis | p50 0.6 ms, p95 0.9 ms, max 3.1 ms |
| `Renderer.render` JS time incl. GL calls | p50 1.6 ms, p95 4.1 ms (5.6K instances) |

Nothing on the DOM side exceeds 4 ms. `Renderer.render` p95 is at the budget line, mostly particle scatter
at 8.6K particles while only one enemy is alive. Worth a check on a real phone before tuning.
`PARTICLE_BUDGET` and the governor (67% at the time) are the knobs.

## Requests for the simulation side (not edited here)

| # | Request | Why |
| --- | --- | --- |
| S1 | Mark designated / Hunter-marked enemies explicitly in the snapshot, e.g. a layer-7 reticle instance or a bit in the enemy instance's `aux1` state bits (`StateBit.Designated = 256`). | The overlay infers designation from the outline colour (1, 0.3, 0.3), which loses to elite / frozen / shield colours, so a designated elite shows no reticle. |
| S2 | `UiState.run.draftTicksLeft: number \| null` (ticks until the auto-pick). | The UI estimates it from the first UiState in `phase === 'draft'`. It drifts by up to one UI interval and resets on reload. |
| S3 | `Ev.TowerDeath` payload: `data: { killer: <enemy kind or boss id>, bossPhase?: number }` and damage-taken-by-source over the attempt in `UiState.stats` (or a `lastAttempt` summary). | Lets the death card say *why* ("The Breaker's slam: 62% of damage taken") and weight suggestions (survival vs damage). |
| S4 | Deduplicate consecutive identical clauses in the Inspector sentence builder. | "…the loaded dice to trigger loaded dice…" |
| S5 | Make `Forecast.peakRate` and the `curve` agree (the curve's max is 25K/h against a 34.6K/h readout on the wave-62 save), or sample the curve at the current point. | The chart and the number disagree side by side. |
| S6 | Keep `UiState.hints` non-empty while undiscovered entries remain (fall back to the nearest undiscovered group). | Codex hints disappear late, exactly when the design wants them (§16). |
| S7 | Estimate `patrolScrapPerSecond` for players who never Patrol (e.g. from the last cleared checkpoint cycle's kill Scrap without first-clear ×3), or say "estimate unavailable". | The offline return reads 4.8K for 3 h on a 2.4M bank. |
| S8 | Balance observations: (a) a quick-chip idle player needs 26–33 min and 14–20 deaths from checkpoint 5 to 10 (design: 8–20 min median per checkpoint); (b) the active Generalist reaches wave 12 in 5.5 min, a far larger edge than 15–30%; (c) at wave 62 every Scrap node is maxed with 2.4M Scrap banked, so "only stat ranks remain" (§3) does not hold. | For the balance owner; no UI change needed beyond M7. |
| S9 | Consider starting builds with the two tactical slots filled (e.g. Repulsor Pulse and Bombardment) or a `default loadout` in data. | The first boss's Counter needs an ability the player has never been told about; M4 works around it in the UI. |

### Sim-side follow-ups (done)

| # | Change | Where | Tests |
| --- | --- | --- | --- |
| S1 | The snapshot draws a layer-7 Ring tagged `aux1 = RETICLE_MARK` around every live designated (gen-checked) or Hunter-marked enemy; the overlay enlarges exactly those. | `core/snapshot.ts`, `core/types.ts` (`RETICLE_MARK`), `app/overlay.ts` (`isReticle`) | `tests/core/ux-sim.test.ts`, `tests/render/overlay.test.ts` |
| S2 | `UiState.run.draftTicksLeft` (null without a running countdown); the draft modal reads it. | `run/draft.ts` (`draftTicksLeft`, `DRAFT_AUTO_TICKS`), `ui/draft.ts` | `ux-sim.test.ts`, `tests/ui/advice.test.ts` |
| S3 | `Ev.TowerDeath.data = { killer, boss?, bossPhase? }`; `RunState/UiState.run.attemptDamageTaken` by source (enemy kind, `boss`, `hazard`, `self`, `enemy`). The death card names the killer and the top damage source. | `core/world-impl.ts` (`damageTower`, `towerKiller`), `systems/tower.ts`, `ui/advice.ts`, `ui/death.ts` | `ux-sim.test.ts`, `advice.test.ts` |
| S4 | Triggered Fusions/Linkages/Infusions/Anomalies read "which triggered the X"; consecutive identical clauses collapse. | `core/events.ts` (`chainSentence`) | `tests/core/events.test.ts` |
| S5 | The Forecast curve ends at the current point and `peakRate = max(curve.rate)`. | `economy/forecast.ts` | `tests/progression/forecast-codex.test.ts` |
| S6 | Hints also cover chassis Linkages, Infusions, socketed firing Anomalies and bosses met but not countered, with a group fallback. The Codex's Counters group also accepts the sim's `counter.boss.<id>` ids. | `economy/codex.ts`, `ui/codex.ts` | `forecast-codex.test.ts` |
| S7 | Until Patrol measures it, `patrolScrapPerSecond` is re-estimated at every non-boss Push clear from the last 4 such clears (first-clear bonus removed); `patrolMeasured` is saved. | `run/machine.ts` (`patrolEstimate`) | `tests/core/run.test.ts` |
| S9 | New builds (new games and new Prestiges) start with Repulsor Pulse and Hunter Mark slotted; saves keep theirs. | `run/state.ts` (`DEFAULT_ABILITIES`) | `ux-sim.test.ts` |

## Verification

- `npx tsc --noEmit -p tsconfig.json`: clean (no errors in any file, including the other agent's).
- `npx vitest run tests/ui tests/render`: 14 files, 100 tests pass (21 new: `hold.test.ts`, `advice.test.ts`,
  `overlay.test.ts`, landscape cases in `sheet.test.ts`).
- `npm run build`: succeeds.
- The e2e script (`e2e.mjs`): `SUMMARY {"fail":[],"consoleErrors":0}`.
