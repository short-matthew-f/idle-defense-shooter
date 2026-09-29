# Project Citadel — Audio

The game should sound like its central idea: *the drone shocked the frozen enemy, which caused the
lightning to jump through the laser node, which detonated its poison, which killed the elite, which
launched the missiles.* Chains become melodies you can hear. Because it is an idle game the player
watches for hours, the mix is soft, never fatiguing, never noise at 1,500 enemies, and quiet at ×8.

Everything is synthesized with Web Audio at run time: no sample files, no dependencies. Without Web
Audio (or before the first tap) every call is a silent no-op. **No information is carried by sound
alone**: every sound doubles something the screen already shows.

## Where things live

| File | Role |
| --- | --- |
| `src/audio/index.ts` | DOM runtime: lazy `AudioContext` on the first gesture, iOS playback session, suspend when hidden or muted, the music timer, prefs, delegated UI-tap sounds. `createGameAudio()` / `gameAudio()` |
| `src/audio/director.ts` | `AudioDirector` (DOM-free): event batches, UiState, screen, pause, sim speed → sounds and music targets |
| `src/audio/engine.ts` | `AudioEngine`: the Web Audio graph, voices, ducking, muffling, laser hum; runs on any `BaseAudioContext` (live or offline) |
| `src/audio/mixer.ts` | Pure admission control: `RateLimiter`, `TokenBucket`, `VoiceAllocator`, `speedDensity`, `Admission` |
| `src/audio/chain.ts` | Pure chain-depth ring map, chain pitch, timbre by src, notes-per-second budget |
| `src/audio/theory.ts` | Pure modes, pentatonics, quantization, chords, voice leading |
| `src/audio/intensity.ts` | Pure game state → music intensity, tension and layer gains |
| `src/audio/scheduler.ts` | Pure lookahead scheduler on the audio clock |
| `src/audio/music/{sectors,composer,instruments,player}.ts` | Sector parameters, the procedural composer, instruments, the adaptive player |
| `src/audio/sfx/*.ts` | Sound definitions: `combat`, `elements`, `systems`, `abilities`, `meta`, chain-note timbres in `notes` |
| `src/audio/synth.ts` | Synthesis primitives (tones, filtered noise, FM, swells, reverb impulse, soft clip) |
| `src/audio/wav.ts` | WAV encoding (the iOS silent loop, the harness) |
| `src/audio/ui.ts`, `src/styles/audio.css` | Settings → Sound section, Battle mute chip |
| `tests/audio/*.test.ts` | Node tests of the pure logic and a 500 events/s director load test |
| `tests/audio/render.mjs` + `harness-entry.ts` | `npm run audio:check`: offline renders in headless Chromium, measured and asserted |

### Data flow

The worker's `events` batch leaves out Hit, Spawn and StatusTick events (too many). The audio pass adds
an optional `audio` digest to that message (`AudioDigest` in `core/types.ts`): `[id, cause, continues]`
for **every** Hit (so chain depth survives through hits), a sample of ≤ 48 Hit events (crits and deep
chains first), and projectile launches by class (bullets, missiles, drone shots) read from new projectile
generations. Hit events carry a `StateBit.Crit` bit in `c` (not hashed; determinism unchanged).
`SimClient.onEvents(events, audio)` hands both to `game.ts`, which feeds `AudioDirector.onEvents`. UiState
(≤ 10 Hz, `pushUi`) feeds `onUi` and the sim speed; `host.setPaused` / `host.setRenderPaused` feed pause and
screen.

## Chains as melodies

`ChainTracker` is a 4,096-slot ring of event id → depth. Depth = depth(cause) + 1 when the cause is known,
else 0. A Hit that continues a same-src cause, or a Kill caused by the Hit of the same damage call, keeps
its cause's depth, exactly as the Inspector counts links. Every Hit (sampled), Kill, StatusApply, Explosion,
Fusion, Triad, Linkage, Infusion and Anomaly event of depth ≥ 1 is a note candidate. `ChainBudget` allows
7 notes/s (burst 5, at most 4 per batch), keeps the deepest candidates, and plays them in ascending depth on
the music's 32nd-note grid, so a chain inside one frame is heard as a rising figure. Pitch = the key's
pentatonic, one step per link above the key root's upper octave, capped at two octaves (10 steps). Timbre
comes from the src: gun pluck, fire ember (soft saw), lightning spark (FM), poison drop, frost glass
(inharmonic FM), drone blip, ordnance mallet, blade air, laser beam, gravity deep, fusion/triad/anomaly/
ability shimmer, linkage bell; infusions take their element's timbre. Sim speed shrinks the budget
(×8 → 35%).

## Sound list

Levels are the loudest 50 ms relative to the reference tone (a 440 Hz sine at −12 dBFS peak through the
same chain), measured by `npm run audio:check`. Priority: higher steals lower at the voice cap; ≥ 8 is
never thinned by sim speed. Interval: minimum spacing between two plays at ×1.

| Sound | Trigger | Prio | Interval | dB |
| --- | --- | --- | --- | --- |
| `shot` | bullet launches (digest) | 1 | 70 ms | −37 |
| `hit` / `hit_crit` | sampled gun (and other) Hits; brighter ring on crits | 1 / 2 | 60 / 100 ms | −33 / −34 |
| `kill` / `kill_elite` / `kill_boss` | Kill (elite bit) / BossKilled | 3 / 6 / 10 | 50 ms / 150 ms / 0.5 s | −27 / −18 / −5 |
| `explosion` | Explosion, size = radius / 150 | 3 | 80 ms | −22 (small) … −10 (size 1) |
| `tower_hit` / `shield_hit` | TowerHit (shield or barrier up → glassy) | 5 / 4 | 120 / 100 ms | −19 / −27 |
| `barrier_break`, `second_core` | BarrierBreak, SecondCore | 8 / 9 | | −16 / −10 |
| `el_fire` / `el_lightning` / `el_poison` / `el_frost` | StatusApply burn / static, lightning Hits / poison / frozen | 2–3 | 120–200 ms | −25 / −33 / −22 / −26 |
| `st_chill` / `st_shock` / `st_bleed` / `st_brittle` / `st_marked` | StatusApply of that status | 1–5 | 180–300 ms | −31 / −32 / −32 / −33 / −28 |
| `fusion` / `triad` / `linkage` / `infusion` / `anomaly` | the trigger event (shimmer chord family, in key) | 4–6 | 250–400 ms | −18 / −17 / −21 / −22 / −23 |
| `missile_launch`, `drone_blip`, `blade_whoosh` | launches (digest), drone Fx, blade Hits / cyclone | 1–2 | 100–180 ms | −27 / −32 / −30 |
| laser hum | continuous while the laser fires; pitch climbs one pentatonic step per node | — | — | (hum level ≤ 0.022) |
| `well_swell`, `well_collapse` | `gravitics.well` / `gravitics.collapse` Fx | 4 / 5 | 0.5 / 0.3 s | −16 / −15 |
| `ab_*` (10) | Cast of each ability (see below) | 8 | 0.2 s | −21 … −6 |
| `purchase` / `purchase_bulk` | Purchase: tick pitched by rank / a batch of ≥ 2 is a fast arpeggio | 7 | 30 / 100 ms | −31 / −22 |
| `core_drop` | CoreDrop | 8 | | −18 |
| `checkpoint` | Checkpoint (replaces `wave_clear`) | 10 | | −11 |
| `wave_start` / `wave_clear` | WaveStart / WaveClear | 6 / 7 | 1 s | −18 / −18 |
| `boss_tell` | BossTell: a riser lasting the boss's tell window | 9 | | −14 |
| `counter` | CounterScored: stinger, and the music drops out for one beat | 10 | | −12 |
| `boss_phase` | BossPhase (phase ≥ 2) | 9 | | −9 |
| `tower_death` | TowerDeath: a long descending glide; the music falls away | 10 | | −9 |
| `prestige` / `ascension` | Prestige / Ascend: big swells in key | 10 | | −14 / −13 |
| `draft_ready` | an Anomaly draft appears (UiState) | 8 | | −18 |
| `ui_tab` / `ui_toggle` / `ui_sheet` / `ui_tap` | tab bar / switches / More menu items / control chips | 7 | 50–100 ms | −34 / −29 / −31 / −35 |
| `test` | Settings → Test sound | 10 | | −17 |

Abilities, each with its own shape (the harness checks their pairwise distinctness): Hunter Mark three rising
lock-on blips and a ping; Repulsor Pulse a deep whoomp with falling air; Time Field a chord slowing like a tape
stop; Bombardment a falling whistle for its 0.6 s fuse, then the blast; EMP an FM discharge sweeping down with
crackle; Overdrive an engine rev through an opening filter; Emergency Repair a warm rising major arpeggio;
Drone Surge a swarm of detuned blips; Missile Storm a volley of whooshes over a rumble; Singularity Bomb a 2 s
inward pull, then the collapse.

## Music design per Sector

The music is generated live: a lookahead scheduler (`scheduler.ts`) wakes on a 50 ms timer but schedules every
sixteenth-note step on the audio clock, 0.3 s ahead, so timer jitter never drifts the beat. `Composer` is pure:
a Markov chain over each Sector's favourite progressions (a chord lasts 1–4 bars and every 8 chords leans back
to the tonic), pulse patterns that change every 4 bars, a lead that plays short pentatonic phrases with long
rests and reuses its last motif transposed half the time, 8-bar drum fills, humanized velocities and timing,
and tempo that drifts at most 1 BPM per bar. Its PRNG is its own (`rng.ts`), seeded from the Prestige (count
and Ascension; UiState has no prestigeSeed) and the wave, so a render is reproducible and the sim's PRNG is
never touched. The test suite checks that over 64 bars at least 14 of 16 four-bar windows differ.

| Sector | Key, mode | Tempo | Character and why |
| --- | --- | --- | --- |
| The Outskirts (1–20) | D Dorian | 72–84 | **Warm and lonely.** Dorian is minor with a raised 6th: sad but not dark, and its major IV (G) gives the warm lift. Low-passed saw pad, sparse triangle plucks, a lonely triangle lead, brushed time with a slight swing. Wave 1 is the pad alone. |
| The Hive (21–40) | E Aeolian | 96–110 | **Pulsing and organic.** Square-wave plucks in a 3-against-4 cycle over a busy root pulse, a breathing (filter-swept) triangle pad, woody knocks instead of a snare, a kick with a click. |
| The Bastion Line (41–60) | G Aeolian | 100–112 | **A steady march.** One chord per bar (i–VI–VII, i–iv–v), root–fifth bass on the beat, snare on 2 and 4 with a ruff, a brassy filtered-saw lead. No delay: dry and disciplined. |
| The Fold (61–80) | F# Lydian | 60–70 | **Eerie and wide.** Lydian's raised 4th floats unresolved; the harmony rocks between I and the Lydian II for 4 bars at a time. Sine pads doubled an octave up with wide detune, 60% reverb and a dotted-eighth delay, a heartbeat kick and almost no hats. |
| The Court (81–100+) | Bb Ionian | 80–92 | **Grand.** Major, plagal and authentic cadences (I–IV–V–vi), an octave-doubled saw pad, rising two-octave arpeggios, tuned timpani on the chord root. |

The five keys are spread (D, E, G, F#, Bb) so each Sector sounds like a new place; every chain note and pitched
sound effect is quantized to the current key's pentatonic, which lies inside the mode, so effects never clash.

**Intensity** (`intensity.ts`) = 0.08 + 0.42 × wave depth (55% position in the Sector, 45% overall) + 0.35 ×
crowd (enemies alive on a log scale, weighted more deeply into the game) + 0.2 on boss waves; ×0.6 between
waves; 0 when dead. It eases up over ~4 s and down over ~9 s. Layers fade in by smooth windows: pad (always),
bass (0.1–0.3), pulse (0.24–0.45), drums (0.4–0.6), lead (0.5–0.72), sixteenth hats (0.72–0.92); tempo follows
intensity inside the Sector range.

- **Boss waves** add a low 3-3-4 ostinato. **Phase changes** shift the key (phase 2: +2 semitones, phase 3:
  +3; The Fold +1/+3) at the next chord, add off-beat kicks (phase 2) and four-on-the-floor (phase 3), and force
  sixteenth hats.
- **Low tower HP** (below 45%) adds tension: the pad filter closes and resonates, and a soft semitone rub
  (plus a tritone below 27% HP) sounds under each chord.
- **Tell** → the `boss_tell` riser, in key, lasting the tell window. **Counter** → stinger, and the music bus
  drops to near silence for one beat, then returns.
- **Death** → the music fades out over 4 s; the next attempt (or wave, Prestige) rebuilds it from quiet over 3 s.
- **Prestige / Ascension** → a big in-key swell with bells, ducking the music under it.
- **Non-Battle tab or Inspector pause** → the music bus low-passes to 750 Hz and drops 3 dB.

## Mix

```
voices (24 pooled slots, panners reused) → sfxBus → Effects volume ─┐   ┌→ reverb (shared, 2.2 s dark IR)
music → duck → muffle LP → fade → Music volume ────────────────────┤   │   delay (music only, per Sector)
                                                                   └→ mix (×0.55) → glue comp (−20 dB, 3:1)
                                                                        → limiter (−4 dB, 20:1, 2 ms) → Master volume → soft clip (≤ 0.98) → out
```

- Defaults: Master 71% (gain −6 dB), Effects 80% (−4 dB), Music 55% (−10 dB): music sits below effects. Slider
  gain = value². Sound on once the first tap unlocks it; Mute and Music on/off persist in prefs.
- Voice cap 24 with priorities (a new sound steals a strictly lower-priority voice, oldest first, or an equal one
  past half its life; otherwise it is dropped). Per-sound minimum intervals. At most 2 new ordinary
  (priority < 5) sounds per event batch.
- Sim speed ×s widens intervals by s^0.6, shrinks the chain-note budget by s^−0.5 and trims ordinary sounds
  by 1.5 dB per doubling (×8: intervals ×3.5, budget 35%, −4.5 dB).
- Big moments duck the music (Counter 90%, Prestige 85%, death 80%, checkpoint and boss kill 60%, …) for about
  half their length, recovering over 0.6 s.
- Stereo: pan = world x / arena radius × 0.6 (gentle).

## Lifecycle, iOS and failure modes

- The `AudioContext` (`latencyHint: 'balanced'`) is created inside the first `pointerdown` / `touchend` /
  `keydown` / `click`. Before that, and whenever the context is not running, the page is hidden or sound is
  muted, the director gets no output and does nothing (it still tracks chain depth).
- iOS: the same gesture starts a looping, effectively silent `<audio>` element (a 0.5 s, ±1 LSB WAV generated at
  run time as a blob URL) and sets `navigator.audioSession.type = 'playback'` where it exists, so the ring/silent
  switch does not mute the game. Later gestures retry if either was blocked or interrupted. Note: a playback
  session pauses other apps' audio while the game plays; muting pauses the loop and suspends the context, which
  releases it.
- `visibilitychange` hidden → the context is suspended, the loop paused, the music timer stopped; visible →
  resumed. After a stall the scheduler skips missed steps instead of bursting.
- No `AudioContext` constructor → `available: false`, Settings says so, everything is a no-op.

## Measurements (`npm run audio:check`)

Offline renders through the real engine with every level at maximum (worst case), in headless Chromium:

- **SFX (57 + a small explosion):** none silent, max peak 0.31 (limit 0.98), no NaN; loudest 50 ms from −37 dB
  (`shot`) to −5 dB (`kill_boss`) relative to the reference tone (band asserted: −38 … 0 dB). Explosions: size
  1 is 12 dB louder than size 0.1.
- **Distinctness** (|Δ log₂ spectral centroid| + 0.35 × |Δ log₂ attack| + 0.35 × |Δ log₂ length| + 3 × (1 −
  cosine of 16-band spectra), asserted ≥ 0.35): elements closest pair fire~lightning 1.9 (centroids fire 4.3 kHz,
  lightning 4.1 kHz, frost 1.6 kHz, poison 470 Hz); abilities closest pair Time Field~Overdrive 1.6.
- **Music, 60 s per Sector at intensity 0.12 / 0.5 / 0.92** (RMS dBFS at full levels): Outskirts −23.5 / −17.2 /
  −17.2, Hive −22.7 / −18.4 / −18.2, Bastion −24.6 / −19.0 / −18.7, Fold −19.2 / −15.6 / −15.6, Court −23.3 / −17.4 /
  −17.0. Rise low → high 3.6–6.3 dB (intended 6 ± 6); Sectors within 5.4 dB of each other at every intensity; max
  peak 0.66; spectral centroid 180–440 Hz (no harsh highs, asserted < 2.5 kHz). A boss phase-3, low-HP Court render
  is written too. Music renders are stepped like the live game (the context pauses every 0.2 s and the scheduler
  tops up its lookahead): audio-thread cost 4–6% of real time on the CI machine (the reverb, compressors and delay
  are the ~4% floor), main-thread scheduling about 1 ms per second of music.
- **Load:** 500 events/s + 2,000 hit links/s for 10 s through the director into the real engine (a stepped
  OfflineAudioContext): voice peak 24 (cap 24), ~78 voices started per second, 74 chain notes, main-thread cost
  p50 0.2 ms, p95 0.5–0.6 ms per frame, output peak 0.59, no NaN. The Node load test (director + admission, no Web
  Audio) measures p95 < 0.1 ms.

Output: WAVs for every render and `stats.json` in `AUDIO_OUT` (default `<os tmp>/citadel-audio`).

## How to add a sound

1. Add an entry to the right table in `src/audio/sfx/` (`combat`, `elements`, `systems`, `abilities`, `meta`):
   `priority`, `minInterval` (s at ×1), `dur(params)` (how long the voice holds its slot), optional `duck`, and
   `play(v, p)` built from `synth.ts` primitives (`tone`, `noise`, `fm`, `swell`, `noiseSwell`). Pitched sounds
   take `p.key` (the engine fills it with the music's key) and should use `scaleNote` / `pentatonicFor` so they
   stay in key. Keep attacks soft (≥ 2 ms), highs filtered, and ordinary sounds short.
2. Trigger it from `AudioDirector.react` (events), `digest` (hits / launches), `onUi` (state changes) or
   `onUiTap` (DOM taps, wired in `index.ts`). Use the event's `x` for pan.
3. Run `npm run audio:check`: the new sound is rendered automatically, must not clip, and its loudest 50 ms must
   fall inside the band. Listen to its WAV in `AUDIO_OUT`. If it belongs to a group that must stay distinct
   (elements, abilities), the distinctness check covers it.
4. Add the row to the sound list above.
