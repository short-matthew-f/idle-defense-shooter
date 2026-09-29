/**
 * Audio engine: the Web Audio graph, the sound-effect voices and the music player, on any
 * BaseAudioContext (a live AudioContext in the game, an OfflineAudioContext in the render harness).
 *
 *   sfx voices ─► slot panners ─► sfxBus ─► sfxVol ──────────────────────────────┐
 *   laser hum ──────────────────► sfxBus          └► sfxRevSend ─► reverb ────────┤
 *   music notes ─► musicIn ─► musicDuck ─► musicMuffle ─► musicFade ─► musicVol ──┤► mix ─► glue comp ─► limiter ─► master ─► soft clip ─► out
 *                                       └► musicRevSend ─► reverb, delaySend ─► delay ──┘
 *
 * Voices: `Admission` (mixer.ts) rate-limits each sound and caps simultaneous voices (24) with
 * priorities; the slot panners are created once and reused, so a play only builds its own short-lived
 * sources. Levels: master default about −6 dB, music below effects; the soft clip after the limiter
 * guarantees |sample| ≤ 0.98.
 */
import { Admission } from './mixer';
import { AudioRng } from './rng';
import { makeImpulse, makeNoise, softClipCurve, type Voice } from './synth';
import { SFX, SFX_IDS, SFX_INDEX, type SfxId, type SfxParams } from './sfx/index';
import { NOTE_DUR, playNote } from './sfx/notes';
import type { Timbre } from './chain';
import { MusicPlayer, type MusicTarget } from './music/player';
import type { SectorMusic } from './music/sectors';
import { midiToHz, type Key } from './theory';

export interface Levels {
  /** Slider values 0..1 (gain = v²: perceptual). */
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
  musicOn: boolean;
}

/** Defaults: master ≈ −6 dB, effects ≈ −4 dB, music ≈ −10 dB below them. */
export const DEFAULT_LEVELS: Levels = { master: 0.71, sfx: 0.8, music: 0.55, muted: false, musicOn: true };

export const sliderGain = (v: number): number => { const c = Math.max(0, Math.min(1, v)); return c * c; };

const TIMBRES: Timbre[] = ['pluck', 'ember', 'spark', 'drop', 'glass', 'blip', 'mallet', 'air', 'beam', 'deep', 'shimmer', 'bell'];
export const VOICE_CAP = 24;

/** What the director drives. The engine implements it; tests use a counting fake. */
export interface SoundOut {
  now(): number;
  sfx(id: SfxId, p?: SfxParams, at?: number): boolean;
  note(timbre: Timbre, midi: number, vel: number, pan: number, at: number, priority: number): boolean;
  setSpeed(speed: number): void;
  setMuffled(on: boolean): void;
  setHum(level: number, midi: number): void;
  setMusic(t: MusicTarget): void;
  reseedMusic(seed: number): void;
  dropBeat(): void;
  fallAway(): void;
  rebuild(): void;
  readonly key: Key;
  readonly beatSeconds: number;
  /** Music clock: the next sixteenth-note boundary (divided by `div`) at or after t; chain notes snap to it. */
  nextGrid(t: number, div?: number): number;
}

interface Slot { pan: StereoPannerNode | null; input: AudioNode; voice: GainNode | null; srcs: AudioScheduledSourceNode[] }

export class AudioEngine implements SoundOut {
  readonly admission = new Admission(SFX_IDS.length + TIMBRES.length, VOICE_CAP);
  readonly music: MusicPlayer;
  private readonly rng: AudioRng;
  private readonly noiseBuf: AudioBuffer;
  private readonly slots: Slot[] = [];
  private readonly mix: GainNode;
  private readonly master: GainNode;
  private readonly sfxBus: GainNode;
  private readonly sfxVol: GainNode;
  private readonly musicDuck: GainNode;
  private readonly musicMuffle: BiquadFilterNode;
  private readonly musicFade: GainNode;
  private readonly musicVol: GainNode;
  private readonly musicRevSend: GainNode;
  private readonly delaySend: GainNode;
  private readonly delay: DelayNode;
  private hum: { a: OscillatorNode; b: OscillatorNode; g: GainNode } | null = null;
  private levels: Levels = { ...DEFAULT_LEVELS };
  private muffled = false;
  private duckUntil = 0;
  private startedMusic = false;
  private fallen = false;
  private readonly rand = (): number => this.rng.next();
  /** Voices started (tests / load harness). */
  plays = 0;

  constructor(readonly ctx: BaseAudioContext, opts: { seed?: number; levels?: Partial<Levels> } = {}) {
    this.rng = new AudioRng(opts.seed ?? 0x5eed);
    const c = ctx;
    this.noiseBuf = makeNoise(c, this.rand);
    // master chain
    const clip = c.createWaveShaper();
    clip.curve = softClipCurve(0.98);
    clip.connect(c.destination);
    this.master = c.createGain();
    this.master.connect(clip);
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    limiter.connect(this.master);
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.01; glue.release.value = 0.25;
    glue.connect(limiter);
    this.mix = c.createGain();
    this.mix.gain.value = 0.55;   // headroom into the glue compressor (its makeup gain restores level)
    this.mix.connect(glue);
    // reverb (shared)
    const reverb = c.createConvolver();
    reverb.buffer = makeImpulse(c, this.rand);
    const revOut = c.createGain(); revOut.gain.value = 0.8;
    reverb.connect(revOut); revOut.connect(this.mix);
    // sfx
    this.sfxVol = c.createGain(); this.sfxVol.connect(this.mix);
    const sfxRev = c.createGain(); sfxRev.gain.value = 0.12;
    this.sfxVol.connect(sfxRev); sfxRev.connect(reverb);
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.sfxVol);
    for (let i = 0; i < VOICE_CAP; i++) {
      const pan = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
      if (pan) pan.connect(this.sfxBus);
      this.slots.push({ pan, input: pan ?? this.sfxBus, voice: null, srcs: [] });
    }
    // music
    this.musicVol = c.createGain(); this.musicVol.connect(this.mix);
    this.musicFade = c.createGain(); this.musicFade.connect(this.musicVol);
    this.musicMuffle = c.createBiquadFilter(); this.musicMuffle.type = 'lowpass'; this.musicMuffle.frequency.value = 18000; this.musicMuffle.Q.value = 0.5;
    this.musicMuffle.connect(this.musicFade);
    this.musicDuck = c.createGain(); this.musicDuck.connect(this.musicMuffle);
    this.musicRevSend = c.createGain(); this.musicRevSend.gain.value = 0.35;
    this.musicVol.connect(this.musicRevSend); this.musicRevSend.connect(reverb);
    this.delay = c.createDelay(2);
    this.delay.delayTime.value = 0.5;
    const fb = c.createGain(); fb.gain.value = 0.35;
    const fbLp = c.createBiquadFilter(); fbLp.type = 'lowpass'; fbLp.frequency.value = 2200;
    this.delay.connect(fbLp); fbLp.connect(fb); fb.connect(this.delay);
    const delayOut = c.createGain(); delayOut.gain.value = 0.7;
    fbLp.connect(delayOut); delayOut.connect(this.mix);
    this.delaySend = c.createGain(); this.delaySend.gain.value = 0;
    this.musicVol.connect(this.delaySend); this.delaySend.connect(this.delay);
    this.music = new MusicPlayer(c, this.musicDuck, this.noiseBuf, opts.seed ?? 1, this.rand);
    this.music.onSector = (s, bpm) => this.applySector(s, bpm);
    this.applySector(this.music.composer.sector, this.music.bpm);
    this.setLevels({ ...DEFAULT_LEVELS, ...opts.levels });
  }

  now(): number { return this.ctx.currentTime; }
  get key(): Key { return this.music.key; }
  get beatSeconds(): number { return this.music.beatSeconds; }

  nextGrid(t: number, div = 1): number { return this.levels.musicOn ? this.music.gridAfter(t, div) : t; }

  setLevels(l: Partial<Levels>): void {
    this.levels = { ...this.levels, ...l };
    const L = this.levels, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(L.muted ? 0 : sliderGain(L.master), t, 0.03);
    this.sfxVol.gain.setTargetAtTime(sliderGain(L.sfx), t, 0.03);
    this.musicVol.gain.setTargetAtTime(L.musicOn ? sliderGain(L.music) * (this.muffled ? 0.7 : 1) : 0, t, 0.08);
  }
  getLevels(): Levels { return { ...this.levels }; }

  setSpeed(speed: number): void { this.admission.setSpeed(speed); }

  /** Music low-pass (and a little quieter) while a non-Battle tab is shown or the Inspector pauses. */
  setMuffled(on: boolean): void {
    if (on === this.muffled) return;
    this.muffled = on;
    const t = this.ctx.currentTime;
    this.musicMuffle.frequency.setTargetAtTime(on ? 750 : 18000, t, on ? 0.12 : 0.3);
    this.setLevels({});
  }

  private voice(slotIdx: number, wasBusy: boolean, t: number, level: number, pan: number): Voice {
    const s = this.slots[slotIdx];
    if (wasBusy) this.release(s, t);
    const g = this.ctx.createGain();
    g.gain.value = level;
    g.connect(s.input);
    if (s.pan) s.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)) * 0.6, t);
    s.voice = g;
    const v: Voice = { ctx: this.ctx, t, out: g, noise: this.noiseBuf, srcs: [], rand: this.rand };
    s.srcs = v.srcs;
    this.plays++;
    return v;
  }

  private release(s: Slot, t: number): void {
    const g = s.voice;
    if (!g) return;
    try {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.015);
    } catch { /* ignore */ }
    for (const src of s.srcs) { try { src.stop(t + 0.02); } catch { /* already stopped */ } }
    s.voice = null; s.srcs = [];
  }

  sfx(id: SfxId, p: SfxParams = {}, at?: number): boolean {
    const def = SFX[id];
    if (!def) return false;
    const t = Math.max(this.ctx.currentTime + 0.01, at ?? 0);
    const dur = def.dur(p);
    const adm = this.admission.admit({ id: SFX_INDEX[id], priority: def.priority, minInterval: def.minInterval, dur }, t);
    if (!adm) return false;
    const level = (p.level ?? 1) * (def.priority >= 8 ? 1 : this.admission.gainTrim);
    const v = this.voice(adm.slot, adm.wasBusy, t, level, p.pan ?? 0);
    if (!p.key) p.key = this.key;
    def.play(v, p);
    if (def.duck) this.duck(def.duck, Math.min(1.5, dur * 0.5), t);
    return true;
  }

  note(timbre: Timbre, midi: number, vel: number, pan: number, at: number, priority: number): boolean {
    const t = Math.max(this.ctx.currentTime + 0.01, at);
    const idx = SFX_IDS.length + TIMBRES.indexOf(timbre);
    const adm = this.admission.admit({ id: idx, priority, minInterval: 0.035, dur: NOTE_DUR[timbre] }, t);
    if (!adm) return false;
    const v = this.voice(adm.slot, adm.wasBusy, t, this.admission.gainTrim, pan);
    playNote(v, timbre, midi, vel);
    return true;
  }

  /** Duck the music by `depth` (0..1) for `hold` seconds, then recover over 0.6 s. */
  duck(depth: number, hold: number, t = this.ctx.currentTime): void {
    if (t + hold < this.duckUntil) return;
    this.duckUntil = t + hold;
    const g = this.musicDuck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - depth, t + 0.04);
    g.setValueAtTime(1 - depth, t + 0.04 + hold);
    g.linearRampToValueAtTime(1, t + 0.64 + hold);
  }

  /** Counter: the music drops to near silence for one beat, then comes back. */
  dropBeat(): void {
    const t = this.ctx.currentTime, beat = this.music.beatSeconds;
    this.duckUntil = t + beat;
    const g = this.musicDuck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.04, t + 0.03);
    g.setValueAtTime(0.04, t + beat);
    g.linearRampToValueAtTime(1, t + beat + 0.15);
  }

  /** Tower death: the music falls away over 4 s (until rebuild). */
  fallAway(): void {
    this.fallen = true;
    const t = this.ctx.currentTime, g = this.musicFade.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 4);
  }

  /** New attempt (or any wave start after a death): the music rebuilds from quiet over 3 s. No-op unless it fell away. */
  rebuild(): void {
    if (!this.fallen) return;
    this.fallen = false;
    const t = this.ctx.currentTime, g = this.musicFade.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1, t + 3);
    this.music.intensity = Math.min(this.music.intensity, 0.1);
  }

  setMusic(t: MusicTarget): void {
    this.music.setTarget(t);
    if (!this.startedMusic) { this.startedMusic = true; this.music.settle(); }
  }
  reseedMusic(seed: number): void { this.music.reseed(seed); }

  /** Schedule music up to the lookahead (a coarse timer calls this; timing uses the audio clock). */
  pump(now = this.ctx.currentTime): void {
    if (!this.levels.musicOn) return;
    this.music.pump(now);
  }

  /** The laser's continuous hum: level 0..1 (activity), pitch rising with node count (already in key). */
  setHum(level: number, midi: number): void {
    const t = this.ctx.currentTime;
    if (!this.hum) {
      if (level <= 0.001) return;
      const g = this.ctx.createGain(); g.gain.value = 0;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      lp.connect(g); g.connect(this.sfxBus);
      const a = this.ctx.createOscillator(); a.type = 'sine';
      const b = this.ctx.createOscillator(); b.type = 'triangle'; b.detune.value = 4;
      a.connect(lp); b.connect(lp);
      a.start(t); b.start(t);
      this.hum = { a, b, g };
    }
    const f = midiToHz(midi);
    this.hum.a.frequency.setTargetAtTime(f, t, 0.4);
    this.hum.b.frequency.setTargetAtTime(f * 2, t, 0.4);
    this.hum.g.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.022, t, 0.35);
  }

  private applySector(s: SectorMusic, bpm: number): void {
    const t = this.ctx.currentTime;
    this.musicRevSend.gain.setTargetAtTime(s.reverb, t, 0.5);
    this.delaySend.gain.setTargetAtTime(s.delay, t, 0.5);
    this.delay.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * s.delayBeats), t, 0.2);
  }

  activeVoices(): number { return this.admission.voices.active(this.ctx.currentTime); }

  /** Stop everything and release the graph (the context itself is closed by the runtime). */
  dispose(): void {
    const t = this.ctx.currentTime;
    for (const s of this.slots) this.release(s, t);
    if (this.hum) { try { this.hum.a.stop(); this.hum.b.stop(); } catch { /* ignore */ } this.hum = null; }
    try { this.master.disconnect(); } catch { /* ignore */ }
  }
}
