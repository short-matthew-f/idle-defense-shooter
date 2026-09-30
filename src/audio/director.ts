/**
 * AudioDirector (DOM-free): turns sim event batches, UiState and UI context into sound. It owns the
 * chain-depth ring map and the chain-note budget; everything audible goes through a SoundOut (the
 * engine), fetched per call so the director keeps working (silently) before the first tap unlocks
 * audio, while muted or hidden, and when Web Audio does not exist at all.
 *
 * No information is carried by sound alone: every sound here doubles something the screen shows.
 */
import { ARENA_RADIUS, Ev, type AudioDigest, type SimEvent, type UiState } from '@sim/core/types';
import { StateBit } from '@sim/core/events';
import { BOSSES } from '@sim/data/bosses';
import { sectorIndexForWave } from '@sim/data/sectors';
import { ChainBudget, ChainTracker, chainPitch, timbreFor, type NoteCandidate } from './chain';
import type { SoundOut } from './engine';
import { musicInputFrom, targetIntensity, tensionFor } from './intensity';
import { speedDensity } from './mixer';
import { mixSeed } from './rng';
import { SFX, type SfxId, type SfxParams } from './sfx/index';
import { pentatonicFor, scaleNote } from './theory';

export type UiTapKind = 'tab' | 'toggle' | 'sheet' | 'tap' | 'test';
export type ScreenKind = 'battle' | 'other';

/** StatusApply status index (core/events.ts STATUS_NAMES order) → sound. */
const STATUS_SFX: (SfxId | null)[] = ['el_fire', 'st_shock', 'el_poison', 'st_chill', 'st_bleed', 'st_brittle', 'st_marked', 'el_lightning', 'el_frost'];
const TRIGGER_SFX: Partial<Record<Ev, SfxId>> = { [Ev.Fusion]: 'fusion', [Ev.Triad]: 'triad', [Ev.Linkage]: 'linkage', [Ev.Infusion]: 'infusion', [Ev.Anomaly]: 'anomaly' };
const FX_SFX: Record<string, SfxId> = {
  'gravitics.well': 'well_swell', 'gravitics.collapse': 'well_collapse', 'drones.payload': 'drone_blip',
  'drones.carrier.launch_bay': 'drone_blip', 'drones.carrier.brood': 'drone_blip', 'blade.tempest.cyclone': 'blade_whoosh',
};
const TELL_SECONDS = new Map<string, number>(BOSSES.map((b) => [`boss.${b.id}`, b.tell.windowSeconds]));
/** Notes-per-second budget for chain melodies at ×1 (burst 5, at most 4 per batch). */
export const CHAIN_NOTES_PER_SECOND = 7;
/** New ordinary (priority < 5) sounds per event batch (one batch per frame). */
export const LOW_PER_BATCH = 2;
const MAX_CANDIDATES = 64;
/** Quartermaster auto-buys (Purchase with data.via 'quartermaster'): a soft tick, rate-limited, never the purchase sound. */
export const QM_TICK_SECONDS = 4;
export const QM_TICK_LEVEL = 0.25;

const clampPan = (x: number): number => Math.max(-1, Math.min(1, x / ARENA_RADIUS));

export class AudioDirector {
  readonly chain = new ChainTracker();
  readonly budget = new ChainBudget(CHAIN_NOTES_PER_SECOND, 5, 4);
  private cands: NoteCandidate[] = [];
  private picked: NoteCandidate[] = [];
  /** Reused candidate objects (no per-event allocation). */
  private readonly candPool: NoteCandidate[] = Array.from({ length: MAX_CANDIDATES }, () => ({ depth: 0, id: 0, src: '', x: 0, weight: 0 }));
  private p: SfxParams = {};
  private ui: UiState | null = null;
  private screen: ScreenKind = 'battle';
  private paused = false;
  private speed = 1;
  private draftShown = false;
  /** Boons: last boon offer sequence number heard (a higher one with an offer pending chimes once). */
  private boonSeq = -1;
  private laserRate = 0;
  private lastBatchAt = -1;
  private disposed = false;
  /** Seed of the music for the current Prestige (prestige count and ascension: UiState has no prestigeSeed). */
  private prestigeKey = 0;
  /** Chain notes played (tests / harness). */
  notesPlayed = 0;

  constructor(private readonly out: () => SoundOut | null) {}

  /** Fresh params object for one play (the engine may fill `key`). */
  private params(pan = 0, extra?: Partial<SfxParams>): SfxParams {
    const p = this.p;
    p.size = undefined; p.level = undefined; p.pitch = undefined; p.dur = undefined; p.n = undefined; p.key = undefined;
    p.pan = pan;
    if (extra) Object.assign(p, extra);
    return p;
  }

  /**
   * Ordinary sounds (priority < 5) started per batch: at most LOW_PER_BATCH, so a dense wave builds
   * texture instead of churning voices (important sounds are never capped here).
   */
  private lowLeft = LOW_PER_BATCH;
  private play(o: SoundOut, id: SfxId, pan = 0, extra?: Partial<SfxParams>): void {
    const def = SFX[id];
    if (!def) return;
    const low = def.priority < 5;
    if (low && this.lowLeft <= 0) return;
    if (o.sfx(id, this.params(pan, extra)) && low) this.lowLeft--;
  }

  /** One `events` batch from the worker (ascending ids) and its optional audio digest. */
  onEvents(events: readonly SimEvent[], digest?: AudioDigest): void {
    if (this.disposed) return;
    const o = this.out();
    const links = digest?.links;
    const nLinks = links ? Math.floor(links.length / 3) : 0;
    let li = 0;
    const cands = this.cands;
    cands.length = 0;
    this.lowLeft = LOW_PER_BATCH;
    let purchases = 0, minRank = 1e9, checkpoint = false, autoBuys = 0;
    const recordLinksBefore = (id: number): void => {
      while (li < nLinks && links![li * 3] < id) { this.chain.record(links![li * 3], links![li * 3 + 1], true, links![li * 3 + 2] === 1); li++; }
    };
    for (const e of events) if (e.type === Ev.Checkpoint) checkpoint = true;
    for (const e of events) {
      recordLinksBefore(e.id);
      const cont = e.type === Ev.Kill && this.chain.isHit(e.cause);
      const depth = this.chain.record(e.id, e.cause, false, cont);
      if (!o) continue;
      if (e.type === Ev.Purchase) {
        // Quartermaster buys (data.via) are not the player's: no purchase sound, at most a soft tick (quartermasterTick)
        if (e.data?.via === 'quartermaster') autoBuys++;
        else { purchases++; minRank = Math.min(minRank, e.a | 0); }
        continue;
      }
      this.react(o, e, depth, checkpoint);
    }
    recordLinksBefore(Number.MAX_SAFE_INTEGER);
    if (!o) return;
    const now = o.now();
    if (digest) this.digest(o, digest, nLinks, now);
    if (purchases > 0) this.purchase(o, purchases, minRank);
    else if (autoBuys > 0) this.quartermasterTick(o, now);
    this.playChain(o, now);
  }

  private candidate(e: SimEvent, depth: number, weight: number): void {
    if (depth < 1 || this.cands.length >= MAX_CANDIDATES) return;
    const c = this.candPool[this.cands.length];
    c.depth = depth; c.id = e.id; c.src = e.src; c.x = e.x; c.weight = weight;
    this.cands.push(c);
  }

  private react(o: SoundOut, e: SimEvent, depth: number, checkpoint: boolean): void {
    const pan = clampPan(e.x);
    switch (e.type) {
      case Ev.Kill: {
        const bits = e.c ?? 0;
        if (bits & StateBit.Boss) break;   // BossKilled plays the big one
        this.play(o, (bits & StateBit.Elite) ? 'kill_elite' : 'kill', pan, { level: bits & StateBit.Clump ? 1 : 0.85 });
        this.candidate(e, depth, 1.5);
        break;
      }
      case Ev.BossKilled: this.play(o, 'kill_boss', pan); break;
      case Ev.Explosion:
        if (e.src === 'ability.bombardment' || e.src === 'ability.singularity_bomb') break;   // the ability sound has its blast
        this.play(o, 'explosion', pan, { size: Math.max(0, Math.min(1, e.a / 150)) });
        this.candidate(e, depth, 1);
        break;
      case Ev.StatusApply: {
        const id = STATUS_SFX[(e.c ?? 0) & 0xff];
        if (id) this.play(o, id, pan);
        this.candidate(e, depth, 1);
        break;
      }
      case Ev.Fusion: case Ev.Triad: case Ev.Linkage: case Ev.Infusion: case Ev.Anomaly:
        this.play(o, TRIGGER_SFX[e.type]!, pan);
        this.candidate(e, depth, 2);
        break;
      case Ev.Cast: {
        const id = `ab_${e.src.startsWith('ability.') ? e.src.slice(8) : e.src}` as SfxId;
        this.play(o, id, pan);
        break;
      }
      case Ev.TowerHit: {
        const t = this.ui?.tower;
        const frac = t && t.maxHp > 0 ? e.b / t.maxHp : 0.05;
        this.play(o, t && (t.shield > 0 || t.barrier > 0) ? 'shield_hit' : 'tower_hit', 0, { level: Math.min(1, frac * 10) });
        break;
      }
      case Ev.BarrierBreak: this.play(o, 'barrier_break'); break;
      case Ev.SecondCore: this.play(o, 'second_core'); break;
      case Ev.CoreDrop: this.play(o, 'core_drop', pan); break;
      // Active edge (systems/active.ts)
      case Ev.Assist: this.play(o, 'assist', pan); break;
      case Ev.SalvageCollect:
        if (e.src === 'salvage.tap') this.play(o, 'salvage_pluck', pan, { size: Math.max(0, (e.b | 0) - 1) });
        else this.play(o, 'salvage_passive', pan);
        break;
      case Ev.Overcharge: this.play(o, 'overcharge_thump', 0, { size: e.a ? 1 : 0.55 }); break;
      case Ev.BoonPicked: if (e.src !== 'decline') this.play(o, 'boon_pick'); break;   // Boons
      case Ev.DoctrineChosen: case Ev.Mounted: case Ev.Attuned: case Ev.AnomalyPicked:
        this.play(o, 'purchase', 0, { pitch: scaleNote(o.key.root + 24, pentatonicFor(o.key.mode), 7) });
        break;
      case Ev.Checkpoint: this.play(o, 'checkpoint'); break;
      case Ev.WaveStart: {
        this.play(o, 'wave_start');
        o.rebuild();   // no-op unless the music fell away (a Prestige or Trial can follow a death)
        o.reseedMusic(mixSeed(this.prestigeKey, e.a | 0));
        break;
      }
      case Ev.WaveClear: if (!checkpoint) this.play(o, 'wave_clear'); break;
      case Ev.BossTell: this.play(o, 'boss_tell', pan, { dur: TELL_SECONDS.get(e.src) ?? 1.3 }); break;
      case Ev.CounterScored: this.play(o, 'counter'); o.dropBeat(); break;
      case Ev.BossPhase: if (e.b >= 1) this.play(o, 'boss_phase', pan); break;
      case Ev.TowerDeath: this.play(o, 'tower_death'); o.fallAway(); break;
      case Ev.AttemptStart: o.rebuild(); break;
      case Ev.Prestige: this.play(o, 'prestige'); o.rebuild(); break;
      case Ev.Ascend: this.play(o, 'ascension'); break;
      case Ev.Fx: { const id = FX_SFX[e.src]; if (id) this.play(o, id, pan); break; }
      default: break;
    }
  }

  /** Hits (sampled) and projectile launches from the worker's audio digest. */
  private digest(o: SoundOut, d: AudioDigest, nLinks: number, now: number): void {
    let laser = 0;
    for (const h of d.hits) {
      const depth = this.chain.depthOf(h.id);
      const pan = clampPan(h.x);
      const crit = ((h.c ?? 0) & StateBit.Crit) !== 0;
      switch (h.src) {
        case 'ballistics': case 'primary': this.play(o, crit ? 'hit_crit' : 'hit', pan, { level: 0.8 }); break;
        case 'lightning': case 'static': this.play(o, 'el_lightning', pan); break;
        case 'blade': this.play(o, 'blade_whoosh', pan); break;
        case 'laser': laser++; break;
        case 'drones': case 'fire': case 'burn': case 'poison': case 'bleed': break;
        default: this.play(o, crit ? 'hit_crit' : 'hit', pan, { level: 0.6 }); break;
      }
      if (depth >= 1) this.candidate(h, depth, crit ? 1 : 0.5);
    }
    // laser activity (hits per second, scaled up from the sample) drives the hum
    const dt = this.lastBatchAt < 0 ? 1 / 60 : Math.max(1 / 240, Math.min(0.5, now - this.lastBatchAt));
    this.lastBatchAt = now;
    const est = d.hits.length > 0 ? laser * (nLinks / d.hits.length) : 0;
    this.laserRate += (est / dt - this.laserRate) * Math.min(1, dt / 0.8);
    const s = d.shots;
    if (s[0] > 0) this.play(o, 'shot', clampPan(s[1]), { level: Math.min(1, 0.6 + 0.1 * s[0]) });
    if (s[2] > 0) this.play(o, 'missile_launch', clampPan(s[3]));
    if (s[4] > 0) this.play(o, 'drone_blip', clampPan(s[5]));
  }

  private purchase(o: SoundOut, n: number, minRank: number): void {
    const pent = pentatonicFor(o.key.mode);
    const deg = Math.max(0, Math.min(10, minRank - 1));
    if (n === 1) this.play(o, 'purchase', 0, { pitch: scaleNote(o.key.root + 24, pent, deg) });
    else this.play(o, 'purchase_bulk', 0, { n: Math.min(8, n), size: Math.min(8, deg) });
  }

  /** Automatic (Quartermaster) buys: one quiet, low tick at most every QM_TICK_SECONDS, whatever the number of ranks. */
  private lastQmTick = -1e9;
  private quartermasterTick(o: SoundOut, now: number): void {
    if (now - this.lastQmTick < QM_TICK_SECONDS) return;
    this.lastQmTick = now;
    this.play(o, 'purchase', 0, { level: QM_TICK_LEVEL, pitch: scaleNote(o.key.root + 12, pentatonicFor(o.key.mode), 0) });
  }

  /** The chain melody: the deepest candidates within budget, as a rising figure on the music's 32nd-note grid. */
  private playChain(o: SoundOut, now: number): void {
    const picked = this.budget.select(this.cands, now, this.picked);
    if (picked.length === 0) return;
    const key = o.key;
    let t = o.nextGrid(now + 0.02, 2);
    const step = Math.max(0.05, o.beatSeconds / 8);
    for (const c of picked) {
      const midi = chainPitch(c.depth, key);
      const vel = 0.55 + 0.45 * Math.min(1, c.depth / 6);
      if (o.note(timbreFor(c.src), midi, vel, clampPan(c.x), t, 4 + Math.min(3, c.depth * 0.5))) this.notesPlayed++;
      t += step;
    }
  }

  /** Latest UiState (≤ 10 Hz): music target, Anomaly draft chime, laser hum. */
  onUi(ui: UiState): void {
    if (this.disposed) return;
    const prevKey = this.prestigeKey;
    this.prestigeKey = (ui.meta.prestigeCount | 0) * 131 + (ui.meta.ascension | 0);
    const first = this.ui === null || prevKey !== this.prestigeKey;
    this.ui = ui;
    const o = this.out();
    const draft = !!ui.run.pendingDraft && ui.run.pendingDraft.length > 0;
    if (o && draft && !this.draftShown) this.play(o, 'draft_ready');
    this.draftShown = draft;
    // Boons: a soft chime when a new offer appears (not on rerolls, not for an offer already pending at load)
    const seq = ui.run.boonOfferSeq;
    if (typeof seq === 'number') {
      if (o && this.boonSeq >= 0 && seq > this.boonSeq && ui.run.boonOffer && ui.run.boonOffer.length > 0) this.play(o, 'boon_offer');
      this.boonSeq = seq;
    }
    if (!o) return;
    if (first) o.reseedMusic(mixSeed(this.prestigeKey, ui.run.wave));
    const m = musicInputFrom(ui);
    o.setMusic({
      sector: sectorIndexForWave(ui.run.wave),
      intensity: targetIntensity(m),
      tension: tensionFor(m),
      bossPhase: ui.wave.isBoss && ui.run.phase === 'combat' ? ui.wave.bossPhase : -1,
    });
    // laser hum: on while the laser is mounted and firing; pitch climbs a pentatonic step per node
    const laserOn = ui.build.hardpoints.includes('laser') && ui.run.phase === 'combat';
    const nodes = 2 + ((ui.build.ranks['laser.nodes'] ?? 0) | 0);
    const key = o.key;
    o.setHum(laserOn ? Math.min(1, this.laserRate / 15) : 0, scaleNote(key.root - 12, pentatonicFor(key.mode), nodes - 2));
  }

  onUiTap(kind: UiTapKind): void {
    const o = this.out();
    if (!o || this.disposed) return;
    this.play(o, kind === 'tab' ? 'ui_tab' : kind === 'toggle' ? 'ui_toggle' : kind === 'sheet' ? 'ui_sheet' : kind === 'test' ? 'test' : 'ui_tap');
  }

  setScreen(tab: ScreenKind | string): void { this.screen = tab === 'battle' ? 'battle' : 'other'; this.applyMuffle(); }
  setPaused(p: boolean): void { this.paused = p; this.applyMuffle(); }
  private applyMuffle(): void { this.out()?.setMuffled(this.screen !== 'battle' || this.paused); }

  /** Effective sim speed (speed multiplier × any playtest fast factor). */
  setSimSpeed(n: number): void {
    const s = Math.max(1, n || 1);
    if (s === this.speed) return;
    this.speed = s;
    this.budget.setBudget(speedDensity(s).budget);
    this.out()?.setSpeed(s);
  }

  /** Re-apply screen, pause and speed to a freshly created engine. */
  resync(): void {
    const o = this.out();
    if (!o) return;
    o.setSpeed(this.speed);
    o.setMuffled(this.screen !== 'battle' || this.paused);
    if (this.ui) { const ui = this.ui; this.ui = null; this.onUi(ui); }
  }

  dispose(): void {
    this.out()?.setHum(0, 48);
    this.disposed = true;
  }
}
