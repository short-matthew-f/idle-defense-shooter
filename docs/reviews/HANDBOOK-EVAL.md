# Usability evaluation against the Mobile Game UX Handbook v1.1, and the plan

Date: 2026-10-05. Build: master `c04ede8`.

Criteria: the owner-supplied *Mobile Game UX & Player Experience Handbook v1.1*:
- 01 Foundations
- 02 Engagement
- 03 Depth without overwhelm
- 05 Idle / incremental
- 07 Action / roguelike
- 08 Evaluation (method, evidence ladder, severities S0–S3)
- 09 Accessibility
- 10 Connected UX (the parts that apply: saves, offline, updates)

## Evidence (doc 08 §2.1)

Four evaluators ran in parallel:
- **A:** Foundations and Accessibility (01, 09)
- **B:** Depth and Idle (03, 05)
- **C:** Engagement and Action (02, 07)
- **D:** doc-08 audits: screenshot matrix, navigation, attention, interruption and resume, performance

D stopped partway: a usage limit ended it, but its interruption and performance logs survived and are used below.

What they ran:
- **Static inspection** of the code and data.
- **Scripted interaction:** Playwright on Chromium with software GL, touch emulation.
- **Viewports:** 375×667, 393×852, 430×932, 852×393, 1280×800, plus emulated 125–200 % zoom.
- **Saves:** crafted saves from a fresh game to Prestige 6, waves 1–75.
- **Input perturbation:** taps offset ±8/16/24 px, and a sweep of the Overcharge release timing.
- **The simulator:** pacing and interruption counts, seeds 1–4.

**Not done: no physical device, no human player.** Nothing here is "human-validated". Every comprehension claim is a prediction, and section 6 lists what needs people.

Raw reports, screenshots and scripts are in the session scratchpad (`uxeval/A`, `B`, `C`, `D`). This document is the consolidated result.

## 1. Scorecard (doc 08 §18)

| Area | Score | Why (evaluators) |
| --- | --- | --- |
| Comprehension | **3** (minutes 0–10) / **2** (after wave 20) | The first two minutes are excellent: one verb, a ring on the button, a "why" line. After that: unexplained jargon, an ability prompt that runs ahead of the reveal, an unexplained wall (A, B, C). |
| Input reliability | **3** | DOM controls survive ±16 px with 0 wrong targets and the tower hold is exact. Enemy picks in formations are 27–40 % wrong at 8–16 px off-centre. Slow or drifting taps (280 ms or more, 11 px or more) vanish silently (A). |
| Navigation | **3–4** | Shallow tabs with proper history. But Back with a dialog open changes the screen underneath, rings pull the player off Battle mid-combat, and the main verb (Upgrade) leaves Battle at wave 12 (A, B, C). |
| Hierarchy | **2–3** | The calm spending screens work. Boss clears and boss tells stack 5–9 attention items, and the death card is buried by the boon offer (A, C). |
| Feedback | **3–4** | Rich tap, purchase and death feedback. But dropped taps are silent, the Rush is unexplained, a tell tap silently swaps an ability, and Overcharge perfect vs weak is shown only through motion and sound (A, C). |
| Complexity management | **3** | Real staging: ladder, folds, content pool, ceremony. But the first boss is a spike of about 12 concepts, boons, drafts and tells leak past the ladder, Doctrines are on no ladder, and stage 7 has no coach line (B, C). |
| Engagement | **3** (structure only) | Strong growth of possibilities with no guilt mechanics. But peak moments (boss kills, the first Prestige) are buried in paperwork, and the 10-minute wall before the first Prestige is never explained (C, B). |
| Accessibility | **3** | Good semantics, labels, multi-channel tells and the OS reduced-motion setting is honoured. No text scaling, the in-game reduce-motion is partial, no timing assists or haptics, and focus escapes dialogs (A). |
| Performance feel | **not judged** | The software renderer ran at 1–8 fps. Needs a device trace. |

## 2. What already works (keep it)

- **First two minutes:** follow doc 03 §5 "see → touch → succeed". Only 2 interruptions came before the first purchase, and both pointed at it.
- **Retry:** death to retry takes 3 s and keeps Scrap and upgrades. No streaks, dailies or decay. Offers never time out or auto-pick.
- **Ordinary buttons:** 0 wrong-target taps at ±16 px. 36 px chips get 44 px hit areas. Destructive actions are confirmed, with Cancel focused.
- **Boss tells:** use four channels (sound, text, a window bar, an icon) and work muted.
- **Colour:** always paired with a shape or label.
- **OS reduced motion:** fully honoured.
- **Overcharge timing:** generous. About 86 % of releases land perfect at σ = 150 ms, and a weak release still fires.
- **Calm spending screens:** the first-Prestige ceremony, the Quartermaster's honest bank, and the pinned wallet.

## 3. Findings that more than one evaluator hit independently

These carry the most weight.

| # | Issue | Raised by | Severity |
| --- | --- | --- | --- |
| X1 | **The wave-10 Broodheart tell asks the player to "equip Bombardment" two waves before abilities are revealed.** Tapping it silently overwrites ability slot 1, and does the same at depth inside a 1.3 s window. | A-08, C-04, C-16 | S1 |
| X2 | **The death card is buried by the start-of-attempt boon offer on every retry.** Its recovery purchases are unreachable at 375×667 and clipped to a sliver at 393×852. | A-09, C-02 | S1 |
| X3 | **Boss clears and boss tells stack 5–9 attention items:** toasts, a boon offer, a queued second offer, a full-screen draft while the run continues, a coach line, a ring, badges. Clearing wave 10 takes 6–7 taps. | C-01, A-07 | S1 |
| X4 | **The coach shows the newest line and retires older unread ones.** The abilities/CE and checkpoint lines were never shown in a scripted 11-minute session. Lines also shrink to an ellipsis after 6 s. | B-03, C-03, A-16 | S1 |
| X5 | **Events leak past the unlock ladder.** Boon cards and drafts name CE, abilities, Cores, Target Designators and Laser before they exist, and reroll costs Cores before Cores are revealed. A boon called "Overcharge" collides with the Overcharge mechanic. | B-02, C-06, C-07 | S1/S2 |
| X6 | **The player is pulled off Battle mid-combat** by rings or decisions, with no pause before wave 20. In a scripted run the tower died behind the Build tab. | C-09 (and A-03 Back behaviour) | S2 |

Other S1s raised by one evaluator:
- **B-01:** the Frontier wall (×3.5 enemy HP per wave past wave 28) is unexplained until "Prestige recommended" fires, about 10 minutes and 13–21 attempts later.
- **D (interruption log):** the autosave runs every 30 s plus an asynchronous save on hide or pagehide. A scripted reload lost purchases made in the preceding ~26 s, and active boons are dropped on every load. **S1** under doc 08 §17 ("loses state"). It needs confirmation on a real iPhone, where swipe-killing a PWA may or may not finish the asynchronous save.

## 4. The plan

Four phases. Fix S0/S1 before adding features to the same flow (doc 08 §17). Each phase ends with the doc-08 §19 agent self-review loop (screenshots at 375/393/430/landscape/desktop, interaction paths, the smallest screen) and the existing e2e suite, extended where noted.

### Phase 1: Stop the bleeding (all S1, plus the cheap cross-confirmed S2s)

Effort: about 1–2 days of agent work.

1. **Tells respect the ladder; no silent swaps.**
   - Fixes X1 (A-08, C-04, C-16).
   - Before abilities are revealed, a tell is information only: "Brood sac swells: abilities unlock at wave 12".
   - Afterwards, a tell tap casts the counter if it is slotted. Otherwise it equips into an empty slot, or asks "Bombardment → slot 1 (replaces Repulsor Pulse)" with Undo.
   - Add a pre-boss card in `between` naming the boss's counter, so loadouts are prepared outside the 1–1.5 s window.
2. **Death card first.**
   - Fixes X2 (A-09, C-02).
   - For about 8 s after a death the death card owns the lane: three suggested buys, then "Pick a boon for this attempt". The start offer waits as the "Boon ready" chip.
   - The headline wraps to two lines.
3. **One beat, then one queue, at boss clears.**
   - Fixes X3 (C-01, A-07).
   - First 1.5–2 s of celebration, with the checkpoint, Core and slot toasts merged into one summary line.
   - Then decisions one at a time: draft, then boon. Hold `between` until the first decision is made or set aside, capped at about 15 s. Coach lines and rings wait until the queue is empty.
   - A queued second boon offer merges into the start-offer slot.
   - During a boss fight the overlay lanes switch to "boss mode": the offer folds to its chip, the coach is held, and the glow and hints pause.
4. **Coach queue.**
   - Fixes X4 (B-03, C-03, A-16).
   - Oldest unread line first, at most one per wave clear. Lines that introduce a verb (checkpoint, abilities, mount) are never retired unseen.
   - Shrink only after the player acts or after 15 s on Battle.
5. **Ladder-aware offers.**
   - Fixes X5 (B-02, C-06, C-07).
   - Boons, Anomalies and drafts get weight 0 when their `needs` sit outside the revealed features or the content pool. CE and ability items need `abilities`.
   - Hide Reroll and Cores until Cores are revealed, and give the first Core a one-line explainer.
   - Rename the boon "Overcharge" to "Hot Barrel".
   - This changes balance a little: re-run the boon balance guard and the quick acceptance subset.
6. **Explain the Frontier.**
   - Fixes B-01.
   - From `frontier − 2` on, the death card leads with "Past wave 28 enemies harden fast: this is where a Prestige pays", plus a Forecast button.
   - The HUD marks waves past the Frontier, and the Forecast shows the Frontier line whether or not a Prestige is recommended.
7. **Rush on boss waves.**
   - Fixes C-05.
   - Rush only after the boss dies, or make the boss step in. Name the stalemate on the death card ("The Broodheart wasn't taking damage").
8. **Never lose a purchase.**
   - Fixes the save finding from D.
   - Debounced save about 2 s after any purchase, choice or offer pick, plus a synchronous backup snapshot in `localStorage` on `pagehide` / `visibilitychange`.
   - Keep the attempt's boons across a reload, since a reload isn't a death.
   - Test: reload, hide and kill paths in the e2e.
9. **Interruption safety.**
   - Fixes A-10 and A-03.
   - Updates never auto-reload while a dialog, sub-screen or text field is open or a boss wave is live. Instead show a persistent "Update ready · Restart" chip.
   - Back or swipe-back closes the top dialog instead of changing the screen underneath.

### Phase 2: Make value and state legible (doc 05 §2–9, doc 03 §14)

Effort: about 2–3 days.

1. **Before → after values:** "Primary damage 13.2 → 14.8 (+16%)" on every stat row and on the starter button. Fixes B-05.
2. **Keep the verb on Battle:** a compact quick-buy chip (the starter logic) stays in the dock after wave 12. Fixes C-17.
3. **Tap to explain:** a one-line info sheet replaces every hover-only `title` (Scrap, Cores, Push/Patrol, the Forecast readouts). The Wall gauge names its unlock ("Now: Execution ◆150"). Help gains a "What is…" glossary built from the revealed features. Fixes B-07, B-19.
4. **Naming:**
   - The Echo layers become "Echo tier I–IV".
   - Locks state the real gate, for example "Reach wave 40 · buy Trials (120 Echoes)".
   - The post-Prestige coach line is reworded.
   - Fixes B-06.
5. **Prestige decisions:**
   - The modal leads with the Forecast verdict, the next-boss gain and the Frontier move.
   - Fold the locked frames.
   - Show Keepsake, Threat Dial and the other choices above the pinned button and summarize them in the confirm.
   - The Echo guide marks one suggested pick.
   - Fixes B-10, B-16.
6. **Return card:** time counted vs the cap, Scrap gained, "now affordable", the next boss, one button. No start-offer interruption on load. Fixes B-11, C-15, A-19.
7. **Doctrines:**
   - A `doctrines` rung on the ladder (wave 10) with a coach line.
   - Fork cards show what each capstone does and a numeric tradeoff.
   - "Change at next checkpoint" replaces the 2-second window.
   - Fixes B-04, C-10.
8. **Pacing of reveals:**
   - Split stage 6.
   - Add coach lines for Cores, Exotics and Push/Patrol.
   - Reveal Cross at the first buyable node.
   - Only present-tense notes in Build; locked Trials collapse to one card.
   - Fixes B-08, B-09.
9. **Late-game bottleneck:** Upgrades leads with "Scrap can't buy new behaviour now: push for Echoes or Prestige" when that's true. Fixes B-14.
10. **Stay with the fight:** decisions opened by a ring, coach line, draft or death card hold the run until the player is back on Battle. Below 30 % HP the Battle tab flashes, with a haptic pulse where supported. Fixes C-09.
11. **Quartermaster card:** folds to one line with an inline switch after it has been seen once. Fixes B-12, A-18.

### Phase 3: Adaptive play and accessibility (doc 09)

Effort: about 2 days.

1. **Text size:** a setting (100 / 115 / 130 %) through root `rem`. Layouts below 340 px: icon-only tabs, the boon footer on its own row, Overcharge in the ability row. Drop `user-scalable=no` in favour of `touch-action: manipulation`. Add 320 px and 150 % zoom to `overlap.mjs`. Fixes A-01.
2. **Reduced motion:** the in-game "Reduce motion" applies a `body.reduce-motion` class that mirrors every OS-media rule. The Overcharge glow pulses for 5 s, then holds steady. Fixes A-02, C-20.
3. **Tap intent:**
   - Weighted, sticky enemy picks: boss, weak point or elite first; keep the current designation inside about 6 px.
   - A short "aim" over an enemy or crate counts as a tap. Slop goes to 16 px, and a hold-delay setting is added.
   - Always show a ripple.
   - A missed `designate_at` is silent.
   - Fixes A-05, A-06, C-14.
4. **Dialogs:** focus trap via `inert`, initial focus on the title or "Later", focus returns to the opener. Fixes A-04.
5. **Contrast:** dark text on the HP, CE and boss bar fills. Fixes A-12.
6. **Timing and cues:**
   - An Overcharge tick plus haptic at band entry, a "PERFECT" / "WEAK" floater, and an optional auto-release assist.
   - A tell-window assist (×1.5, or slow time during tells).
   - Optional haptics for tells and low HP.
   - Fixes A-13, A-14, A-15, C-21.
7. **Accessibility settings group** at the top of Settings, including a left-hand mirror. Screen-reader announcements for boss start and tells; the canvas gets `role="img"` with a label. Fixes A-17, A-20.
8. **Landscape Decline:** keeps its word, plus an Undo toast. Fixes A-11.
9. **Boon offers:** remember "set aside" so new offers arrive as the chip. Fixes C-08.

### Phase 4: Moments and polish (doc 02, doc 07 §8)

Effort: about 1–2 days.

1. **First-Prestige rebuild beat:** cut to Battle for 2–3 s (the old ornament dissolves, the new hull assembles) before the Echo shop. Add a permanent per-Prestige mark on the hull. Merge the post-Prestige coach lines into one card. Fixes C-19.
2. **Telegraphs survive spectacle:** during a live tell, fade player geometry and blast cores near the boss, and add tell-specific in-world markers. Extend the readability test with a tell frame. Fixes C-18.
3. **Salvage:** boss kills spill 3–5 crates so chains can happen. Drop "quick taps chain" until they can, and freeze the first crate's fuse while its line is unread. Fixes C-11.
4. **Small fixes:**
   - Codex toasts gated and named: "Codex: 3-link chain" (C-12).
   - Hazard owner on the death headline (C-13).
   - Codex and Infusion text (B-17).
   - One number format per screen (B-18).
   - Badges only for new decisions (B-20).
   - Split "Unlock everything" into screens vs content (B-13).
   - Boon card clipping at 375 (B-15).
   - Import preview before the confirm (A-21).

### Phase 5: Evidence

Runs in parallel with the phases above and is the only way to close the comprehension questions.

The handbook is explicit (doc 08 §2.1, §5–7): only people and devices settle these. A lightweight protocol for the owner and a second player:

1. **No-help session to the first Prestige** (doc 08 §5, §8, §9).
   - **Record:** first touch, hesitations, repeated taps, what they say at wave 5, wave 10, the Broodheart tell, and wave 28.
   - **Then ask:** "Why couldn't you pass wave 30?", "What are Cores?", "What does Prestige keep?"
2. **Three-second test** (§4) on Battle, Upgrades, Build and Prestige screenshots.
3. **Dense-tap test** (§7) on the smallest phone: 100 enemy designations and 30 crate taps. Count wrong picks and misses.
4. **Device pass** (§13, §15) on a physical iPhone, plus an Android if available: a frame trace at wave 40+, reload/kill save checks, the largest OS text size.
5. **Optional opt-in, on-device event log** (doc 08 §16) exportable from Settings: stage reached, deaths per wave, time to first Prestige, tell answered/missed, screens opened, abandon points. No network.

## 5. Release gates (doc 08 §20), status today

| Gate | Status |
| --- | --- |
| No S0/S1 known | ✗ (X1–X5, B-01, save durability) |
| Screenshots clean on supported classes | ~ (clean except at 375×667 death/boon and 125 %+ zoom) |
| Touch reliable on the smallest phone | ~ (DOM yes; arena picks in formations no; device unverified) |
| Dense interactions stress-tested | ✓ scripted / perturbed; ✗ human |
| Back / cancel / retry flows | ~ (Back with a dialog open is wrong) |
| Features teach themselves | ~ (coach queue drops lines; ladder leaks) |
| Performance stable | not judged (needs a device) |
| Accessibility options considered | ~ (Phase 3) |
| Resume after interruption | ✗ (recent purchases and boons lost on reload) |
| Pending/offline states understandable | ~ (offline card generic) |
| Human-validation claims backed | ✓ (none claimed) |

## 6. Not covered by this evaluation

- Evaluator D's full screenshot matrix of every More sub-screen, its navigation tap-count table and its attention tables were cut short by a usage limit. The other three covered the same ground for Battle, Upgrades, Build and Prestige. Re-run D after Phase 1.
- Physical devices, human comprehension, VoiceOver/TalkBack, colour-vision simulation of the arena, one-handed comfort, muted-play balance, and real performance. See Phase 5.

## 7. Navigation and attention audit after Phases 1–2 (2026-10-05, master `a589366`)

Re-run of evaluator D's doc-08 audits (§3 screenshots, §10 navigation, §11 attention, §4 proxy, §15.1 interruption).
Evidence: static + scripted (headless Chromium, software GL; crafted saves and the owner's wave-28 save). No device or
human testing; performance not judged. Scripts and screenshots: session scratchpad `navaudit/`.

**Confirmed fixed:** the wave-10 tell is info-only before abilities; the Frontier death card and "Past the Frontier" HUD
work on the owner's save; the death card owns its lane; Back closes a dialog the player opened; the welcome-back card;
the save-loss window went from ~26 s to ~2 s; Start over is double-confirmed.

Scorecard: Comprehension 3, Input reliability 3 (2 on the ring-guided Upgrades path), Navigation 3, Hierarchy 3,
Feedback 3, Complexity 3, Engagement 3 (structure only), Accessibility 3 (Phase 3 pending), Performance not judged.

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| N-01 | S1 | The Phase-2 decision hold froze the sim, so buys on a ring-guided Upgrades visit did nothing for up to 30 s | hotfix |
| N-02 | S2 | More → Inspector opens and instantly closes (async history pop closes the modal) | hotfix |
| N-03 | S2 | Back while a dialog that opened itself on load is up leaves the app | hotfix |
| N-04 | S2 | Landscape: death card / boon offer column overlaps the quick-buy chip; draft Pick below the fold | Phase 3 |
| N-05 | S2 | The Elements hint ring follows the player onto every screen | hotfix |
| N-06 | S2 | The death card's Frontier "Forecast" action looks like plain text | hotfix |
| N-07 | S2 | Upgrades at 375×667: first upgrade row sits at ~75 % of the screen height | Phase 3 |
| N-08 | S3 | Automation sub-tabs clip "Upgrade Queue"/"Blueprints" | Phase 4 |
| N-09 | S2 | Purchases in the last ~2 s before a reload are lost (debounce window) | Phase 3 (command journal) |
| N-10 | S3 | Quartermaster coach card wraps to 8 lines at 393 | hotfix |
| N-11 | S3 | Quick-buy chip truncates its label | hotfix |
| N-12 | S3 | Zero-income return card appears ~4 s after load | hotfix |
| N-13 | S3 | Importing an old export credits offline time without saying so | Phase 4 |
| N-14 | S3 | Constellation minor/bridge nodes have 31–33 px hit areas; 12 px names | Phase 3 |
| N-15 | S3 | A death past a later Frontier has no why-line | hotfix |

## 8. Phase 3 status (2026-10-06, branch `wip/phase3`)

Evidence: static, unit and scripted (headless Chromium, software GL). No device or human testing; feel and performance not judged.

| Item | What shipped | Evidence |
| --- | --- | --- |
| 1 Text size (A-01) | Settings → Accessibility: 100 / 115 / 130 % via root rem (every stylesheet's font sizes now rem). Below 340 px (and 130 % up to 380 px): icon-only tabs with dot badges, smaller slots, quick-buy above the row. `user-scalable=no` dropped for `touch-action: manipulation`; the arena keeps `touch-action: none`. Overlay audit now also runs at 320×568 and 375×667 @130 %. | scripted (overlay audit), screenshots |
| 2 Reduced motion (A-02, C-20) | One control (Accessibility); `body.reduce-motion` mirrors every `prefers-reduced-motion` rule (src/styles/a11y.css). Overcharge glow pulses 5 s then holds. | scripted: running animations 5 → 0 with either the OS or the in-game setting |
| 3 Tap intent (A-05, A-06, C-14) | A finger on an enemy picks it; otherwise within the assist reach: boss with weak point open > boss > elite > other; the designated enemy keeps the tap within 6 px. Slop 16 px; hold delay setting (+0 / 150 / 300 ms); a short aim over an enemy or crate is a tap; ripple on every tap; a missed `designate_at` is silent. | unit; scripted rolled-tap check |
| 4 Dialogs (A-04) | Focus trap via `inert`, initial focus on the title (Cancel on confirms), focus returns to the opener. | scripted (Tab cycling, Esc, focus return) |
| 5 Contrast (A-12) | Bar labels on a dark plate: ≥ 10.2:1 worst case (was 1.8–3.1:1). | static (computed from CSS) |
| 6 Timing cues (A-13–15, C-21) | Overcharge band-entry tick + vibrate, PERFECT / WEAK floater, optional auto-release; optional ×1.5 boss tell windows (deterministic meta setting); optional vibration on tells and low HP (shown only where the browser vibrates; not on iPhone). | unit + simulator (determinism unchanged) |
| 7 Accessibility group (A-17, A-20) | Top of Settings: text size, reduced motion, left-hand layout, screen-reader announcements (boss start, tells, death, Prestige recommended), then the assists. Canvas `role="img"` with a live label. | unit; screenshots |
| 8 Landscape Decline (A-11) | Decline shows its word; on a landscape phone it waits 6 s behind an Undo toast. | scripted |
| 9 Boon set-aside (C-08) | After setting an offer aside, later offers in that attempt arrive as the chip; resets on a new attempt or Prestige. When the offer lane is under 150 px the offer arrives as its chip. | unit; scripted |
| N-04 | Landscape lanes know the quick-buy chip; draft Pick visible without scrolling at 852×393. | scripted overlay audit at 4 sizes |
| N-07 | Upgrades first row at 375×667: 57 % → 47 % of the height (target was 45 %; the rest needs a row merged — owner's call). | scripted measure |
| N-09 | Command journal: purchases and choices are journaled synchronously and replayed after a reload or kill; a replayed buy waits (up to 60 s of sim time) for the Scrap it needs. | unit; scripted reload-within-300 ms repro (failed before, passes after) |
| N-14 | Constellation hit areas ≥ 44 px at every width, names ≥ 14 px, taps pick the nearest node. | scripted measure |

Open after Phase 3: the remaining ~14 px on Upgrades at 375; the boss tell line and boss HP label ellipsise at 130 %; Active edge reads 41.7 % in `sim:accept --quick` both before and after Phase 3 (for the balance round).
