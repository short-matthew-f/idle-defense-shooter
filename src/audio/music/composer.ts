/**
 * Procedural composer (pure, no Web Audio): turns (Sector, seed, layers) into note events one
 * sixteenth-note step at a time. The music engine plays what it returns; tests and the offline
 * render harness drive it directly, so a render is reproducible from its seed.
 *
 * Listenable for hours:
 *  - harmony moves slowly (a chord lasts 1–4 bars) along a Markov chain of each Sector's favourite
 *    progressions, with a pull back to the tonic at every 8-chord section;
 *  - pulse patterns switch per 4-bar section, the lead plays short phrases with long rests and
 *    reuses its last motif (transposed) about half the time, drum fills mark 8-bar sections, and
 *    velocities are humanized, so no 4-bar loop repeats verbatim;
 *  - tempo drifts at most 1 BPM per bar toward the intensity's tempo.
 */
import { AudioRng } from '../rng';
import type { Layers } from '../intensity';
import { chordOn, MODES, pentatonicFor, quantize, scaleNote, transpose, voiceLead, type Key } from '../theory';
import { stepSeconds, tempoFor, type SectorMusic } from './sectors';

export type InstId = 'pad' | 'bass' | 'pulse' | 'lead' | 'kick' | 'snare' | 'hat' | 'tension' | 'boss' | 'fill';

export interface NoteEv {
  inst: InstId;
  /** MIDI pitch (drums: a nominal pitch; kick/timpani use it). */
  midi: number;
  /** Offset from the step's start (s): swing and humanization. */
  t: number;
  /** Seconds. */
  dur: number;
  /** 0..1 (already scaled by the layer gain). */
  vel: number;
}

export interface ComposerInput {
  layers: Layers;
  intensity: number;
  /** Boss phase (0-based) on a boss wave, else -1. */
  bossPhase: number;
}

interface Phrase { start: number; notes: { at: number; deg: number; len: number }[] }

export class Composer {
  private rng: AudioRng;
  sector: SectorMusic;
  /** Key in effect (boss phases shift it; the change lands on the next chord). */
  key: Key;
  private wantKey: Key;
  bpm: number;
  private degree = 0;
  private chord: number[] = [];
  private voicing: number[] | null = null;
  private chordIndex = 0;
  private patternIdx = 0;
  private phrase: Phrase | null = null;
  private motif: { at: number; deg: number; len: number }[] | null = null;

  constructor(sector: SectorMusic, seed: number) {
    this.sector = sector;
    this.rng = new AudioRng(seed);
    this.key = { ...sector.key };
    this.wantKey = this.key;
    this.bpm = sector.bpm[0];
    this.chord = chordOn(this.key.root, this.key.mode, 0, sector.chordSize);
  }

  /** New seed (wave start): the harmony restarts from the tonic. */
  reseed(seed: number): void {
    this.rng = new AudioRng(seed);
    this.degree = 0; this.chordIndex = 0; this.phrase = null; this.motif = null;
  }

  setSector(s: SectorMusic): void {
    if (s === this.sector) return;
    this.sector = s;
    this.wantKey = { ...s.key };
  }

  /** Boss phase key shift (-1 = no boss): lands at the next chord change. */
  setBossPhase(phase: number): void {
    const shift = phase < 0 ? 0 : this.sector.bossShift[Math.min(this.sector.bossShift.length - 1, phase)] ?? 0;
    this.wantKey = transpose(this.sector.key, shift);
  }

  /** Current chord (MIDI, root position near the key root). */
  get currentChord(): readonly number[] { return this.chord; }

  /**
   * Events for one sixteenth-note step (appended to `out`). Returns the step's duration (s).
   * `step` is the scheduler's monotonic step index; bar = step / 16.
   */
  step(step: number, inp: ComposerInput, out: NoteEv[]): number {
    const s = this.sector, L = inp.layers, rng = this.rng;
    const pos = step % 16, bar = Math.floor(step / 16);
    if (pos === 0) {
      // tempo drifts 1 BPM per bar toward the target
      const target = tempoFor(s, inp.intensity);
      this.bpm += Math.sign(target - this.bpm) * Math.min(1, Math.abs(target - this.bpm));
      if (bar % 4 === 0) this.patternIdx = rng.int(0, s.pulse.patterns.length - 1);
    }
    const sd = stepSeconds(this.bpm);
    const chordSteps = 16 * s.barsPerChord;
    if (step % chordSteps === 0) this.nextChord(inp, sd * chordSteps, out);

    const hum = (): number => (rng.next() - 0.5) * 0.008;
    const swing = pos % 4 === 2 && s.id === 'outskirts' ? sd * 0.12 : 0;

    // bass
    const bp = s.bass.pattern[pos];
    if (bp && L.bass > 0.02) {
      let len = 1;
      while (pos + len < 16 && !s.bass.pattern[pos + len]) len++;
      const root = this.bassRoot();
      const midi = bp === 5 ? root + 7 : bp === 8 ? root + 12 : root;
      out.push({ inst: 'bass', midi, t: 0, dur: len * sd * 0.92, vel: L.bass * (pos === 0 ? 0.9 : 0.7) * (0.9 + 0.2 * rng.next()) });
    }
    // boss ostinato: a 3-3-4 low pulse, doubled on phase 3
    if (L.boss > 0.02 && (pos === 0 || pos === 3 || pos === 6 || pos === 10 || (inp.bossPhase >= 2 && pos === 13))) {
      out.push({ inst: 'boss', midi: this.bassRoot() - 12 + (pos === 10 ? 7 : 0), t: 0, dur: sd * 2.2, vel: L.boss * (pos === 0 ? 0.9 : 0.65) });
    }
    // pulse / arpeggio
    const pp = s.pulse.patterns[this.patternIdx][pos];
    if (pp && L.pulse > 0.02) {
      const n = this.chord.length;
      const midi = this.chord[(pp - 1) % n] + 12 * Math.floor((pp - 1) / n) + 12;
      out.push({ inst: 'pulse', midi, t: swing + hum(), dur: sd * 1.6, vel: L.pulse * (0.55 + 0.35 * rng.next()) });
      if (inp.intensity > 0.82 && pp === 1) out.push({ inst: 'pulse', midi: midi + 12, t: swing + hum(), dur: sd * 1.2, vel: L.pulse * 0.25 });
    }
    // lead phrases
    this.leadStep(step, inp, sd, out);
    // drums
    if (L.perc > 0.02) {
      const p = s.perc;
      let k = p.kick[pos];
      if (inp.bossPhase >= 1 && (pos === 10 || pos === 14)) k = Math.max(k, 0.55);   // phase change shifts the rhythm
      if (inp.bossPhase >= 2 && pos % 4 === 0) k = Math.max(k, 0.8);
      if (k > 0) out.push({ inst: 'kick', midi: this.bassRoot() - 12, t: 0, dur: 0.5, vel: L.perc * k });
      const sn = p.snare[pos];
      if (sn > 0 && L.perc > 0.3) out.push({ inst: 'snare', midi: 0, t: hum(), dur: 0.25, vel: L.perc * sn * (0.85 + 0.3 * rng.next()) });
      let hv = p.hat[pos] * L.perc;
      const h16 = inp.bossPhase >= 1 ? Math.max(L.hats16, 0.6) : L.hats16;
      if (pos % 2 === 1) hv = Math.max(hv, 0.22 * h16 * L.perc);
      if (hv > 0.02) out.push({ inst: 'hat', midi: 0, t: swing + hum(), dur: pos % 8 === 6 && rng.chance(0.15) ? 0.25 : 0.06, vel: hv * (0.8 + 0.4 * rng.next()) });
      // fill on the last beat of every 8th bar
      if (bar % 8 === 7 && pos >= 12 && L.perc > 0.5 && rng.chance(0.55)) {
        out.push({ inst: 'fill', midi: this.bassRoot() + 12 - (pos - 12) * 2, t: hum(), dur: 0.3, vel: L.perc * (0.35 + 0.1 * (pos - 12)) });
      }
    }
    return sd;
  }

  private bassRoot(): number {
    // chord root in the bass octave (MIDI 33–44)
    let m = this.chord[0];
    while (m > 44) m -= 12;
    while (m < 33) m += 12;
    return m;
  }

  private nextChord(inp: ComposerInput, seconds: number, out: NoteEv[]): void {
    const s = this.sector, rng = this.rng;
    if (this.wantKey.root !== this.key.root || this.wantKey.mode !== this.key.mode) {
      this.key = this.wantKey;
      this.degree = 0;
    } else if (this.chordIndex > 0) {
      // section starts (every 8 chords) lean back to the tonic
      this.degree = this.chordIndex % 8 === 0 && rng.chance(0.6) ? 0 : rng.weighted(s.moves[this.degree]);
    }
    this.chordIndex++;
    this.chord = chordOn(this.key.root, this.key.mode, this.degree, s.chordSize);
    this.voicing = voiceLead(this.chord, this.voicing, 50, 72);
    const L = inp.layers;
    const dur = seconds + 0.6;   // overlap: pads cross-fade
    for (const m of this.voicing) out.push({ inst: 'pad', midi: m, t: 0, dur, vel: L.pad });
    if (s.pad.octaveDouble && inp.intensity > 0.3) out.push({ inst: 'pad', midi: this.voicing[0] + 12, t: 0, dur, vel: L.pad * 0.5 });
    if (L.tension > 0.05) {
      // low-HP dissonance: a semitone rub against the chord root and a tritone, both soft
      out.push({ inst: 'tension', midi: this.voicing[0] + 1, t: 0, dur, vel: L.tension * 0.8 });
      if (L.tension > 0.5) out.push({ inst: 'tension', midi: this.voicing[0] + 6 + 12, t: 0.1, dur, vel: (L.tension - 0.5) * 0.9 });
    }
  }

  private leadStep(step: number, inp: ComposerInput, sd: number, out: NoteEv[]): void {
    const s = this.sector, rng = this.rng, L = inp.layers;
    const block = 32;
    if (step % block === 0) {
      this.phrase = null;
      if (L.lead > 0.02 && rng.chance(Math.min(0.9, s.lead.density * (0.6 + 0.7 * L.lead)))) this.phrase = this.makePhrase(step);
    }
    const ph = this.phrase;
    if (!ph || L.lead <= 0.02) return;
    const at = step - ph.start;
    for (const n of ph.notes) {
      if (n.at !== at) continue;
      const pent = pentatonicFor(this.key.mode);
      let midi = scaleNote(this.key.root + s.lead.octave, pent, n.deg);
      midi = quantize(midi, this.key.root, MODES[this.key.mode]);
      out.push({ inst: 'lead', midi, t: 0, dur: n.len * sd * 0.95, vel: L.lead * (0.7 + 0.25 * rng.next()) });
    }
  }

  private makePhrase(start: number): Phrase {
    const rng = this.rng;
    if (this.motif && rng.chance(0.5)) {
      // reuse the last motif, moved by a pentatonic step or two (a sequence, not a loop)
      const shift = rng.pick([-2, -1, 1, 2]);
      const notes = this.motif.map((n) => ({ ...n, deg: Math.max(-2, Math.min(9, n.deg + shift)) }));
      return { start, notes };
    }
    // rhythm cells (in steps) for a 2-bar phrase, leaving room to breathe at the end
    const cells = [[0, 4, 6, 8, 12], [0, 3, 6, 10], [2, 4, 8, 14, 16], [0, 6, 8, 12, 20], [4, 6, 8, 16]];
    const rhythm = rng.pick(cells);
    // start on a chord tone of the pentatonic (0, 2 or 4 steps), then move stepwise
    let deg = rng.pick([0, 2, 3, 4]);
    const notes: Phrase['notes'] = [];
    for (let k = 0; k < rhythm.length; k++) {
      const next = rhythm[k + 1] ?? rhythm[k] + 8;
      const len = Math.min(8, next - rhythm[k]);
      notes.push({ at: rhythm[k], deg, len: k === rhythm.length - 1 ? Math.min(10, len + 4) : len });
      deg += rng.weighted([1, 3, 0, 3, 1]) - 2;   // -2..+2, mostly steps
      deg = Math.max(-1, Math.min(8, deg));
    }
    // land the phrase on a stable degree
    notes[notes.length - 1].deg = rng.pick([0, 2, 5]);
    this.motif = notes;
    return { start, notes };
  }
}
