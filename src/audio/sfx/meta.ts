/**
 * Run and interface sounds: purchases, Cores, wave and checkpoint moments, boss tells, Counters and
 * phases, death, Prestige and Ascension, the Anomaly draft, and light UI taps. All pitched sounds use
 * the music's key.
 */
import { fm, noise, noiseSwell, swell, tone } from '../synth';
import { midiToHz, pentatonicFor, scaleNote } from '../theory';
import type { Voice } from '../synth';
import { fixed, type SfxDef, type SfxParams } from './types';

const root = (p: SfxParams, up = 12): number => (p.key?.root ?? 50) + up;
const pent = (p: SfxParams): readonly number[] => pentatonicFor(p.key?.mode ?? 'dorian');
const major = (p: SfxParams): boolean => (p.key?.mode ?? 'dorian') === 'ionian' || p.key?.mode === 'lydian' || p.key?.mode === 'mixolydian';

/** A soft brass-ish chord hit (saw through a closing low-pass). */
function brass(v: Voice, midis: number[], at: number, d: number, gain: number): void {
  for (const m of midis) {
    tone(v, { type: 'sawtooth', f: midiToHz(m), at, a: 0.02, d, gain, lp: 2400, lp1: 600, detune: (v.rand() - 0.5) * 10 });
    tone(v, { type: 'triangle', f: midiToHz(m), at, a: 0.02, d, gain: gain * 0.8 });
  }
}

export const META = {
  /** Purchase: a tick whose pitch climbs with the node's rank (pitch param). */
  purchase: {
    priority: 7, minInterval: 0.03, dur: fixed(0.2),
    play(v, p) {
      const f = midiToHz(p.pitch ?? root(p, 24));
      tone(v, { type: 'triangle', f, d: 0.12, gain: 0.08, lp: 4000 });
      noise(v, { type: 'highpass', f: 4000, d: 0.01, gain: 0.02 });
    },
  },
  /** Bulk purchase: a fast rising arpeggio of n pentatonic notes from degree `size` (the first rank bought). */
  purchase_bulk: {
    priority: 7, minInterval: 0.1, dur: (p) => 0.2 + 0.045 * Math.min(8, p.n ?? 4),
    play(v, p) {
      const n = Math.max(2, Math.min(8, p.n ?? 4));
      const d0 = Math.max(0, Math.min(8, Math.round(p.size ?? 0)));
      for (let k = 0; k < n; k++) {
        const m = scaleNote(root(p, 24), pent(p), d0 + k);
        tone(v, { type: 'triangle', f: midiToHz(m), at: k * 0.045, d: 0.1, gain: 0.065, lp: 4000 });
      }
    },
  },
  /** Core drop: two crystalline bells. */
  core_drop: {
    priority: 8, minInterval: 0.3, dur: fixed(1.3),
    play(v, p) {
      fm(v, { f: midiToHz(root(p, 36)), ratio: 3.01, index: 0.7, d: 1.1, gain: 0.05 });
      fm(v, { f: midiToHz(root(p, 36) + 7), ratio: 3.01, index: 0.6, at: 0.09, d: 1.0, gain: 0.045 });
    },
  },
  /** Checkpoint: a short fanfare (root, fifth, octave, then the chord). */
  checkpoint: {
    priority: 10, minInterval: 1, dur: fixed(2.2), duck: 0.6,
    play(v, p) {
      const r = root(p, 12), third = major(p) ? 4 : 3;
      brass(v, [r], 0, 0.18, 0.045);
      brass(v, [r + 7], 0.16, 0.18, 0.045);
      brass(v, [r, r + third + 12, r + 7, r + 12], 0.34, 1.5, 0.03);
      tone(v, { f: midiToHz(r - 12), at: 0.34, d: 1.2, gain: 0.08 });
    },
  },
  /** Wave start: a low swell and a soft ping. */
  wave_start: {
    priority: 6, minInterval: 1, dur: fixed(1.1),
    play(v, p) {
      swell(v, { type: 'triangle', f: midiToHz(root(p, -12)), rise: 0.4, release: 0.6, gain: 0.045, lp: 900 });
      fm(v, { f: midiToHz(root(p, 24)), ratio: 2, index: 0.5, at: 0.35, d: 0.6, gain: 0.03 });
    },
  },
  /** Wave clear: a resolving two-note chime (fifth → root). */
  wave_clear: {
    priority: 7, minInterval: 1, dur: fixed(1.2),
    play(v, p) {
      fm(v, { f: midiToHz(root(p, 24) + 7), ratio: 2, index: 0.6, d: 0.5, gain: 0.05 });
      fm(v, { f: midiToHz(root(p, 24)), ratio: 2, index: 0.6, at: 0.18, d: 0.9, gain: 0.055 });
    },
  },
  /** Boss tell: a riser that lasts the tell window (dur param) and cuts off at its end. */
  boss_tell: {
    priority: 9, minInterval: 0.5, dur: (p) => (p.dur ?? 1.3) + 0.1,
    play(v, p) {
      const d = Math.max(0.5, p.dur ?? 1.3);
      noiseSwell(v, { type: 'bandpass', f: 300, f1: 3200, q: 2.5, rise: d - 0.04, release: 0.04, gain: 0.07 });
      swell(v, { type: 'sawtooth', f: midiToHz(root(p, 0)), f1: midiToHz(root(p, 12)), rise: d - 0.04, release: 0.04, gain: 0.04, lp: 500, lp1: 2600 });
      swell(v, { type: 'sine', f: midiToHz(root(p, -12)), rise: d - 0.04, release: 0.04, gain: 0.06 });
    },
  },
  /** Counter scored: a bright stinger (the music drops out for a beat around it). */
  counter: {
    priority: 10, minInterval: 0.3, dur: fixed(1.2), duck: 0.9,
    play(v, p) {
      const r = root(p, 12);
      brass(v, [r, r + 7, r + 12, r + 16 - (major(p) ? 0 : 1)], 0, 0.9, 0.035);
      noise(v, { type: 'bandpass', f: 2500, q: 0.8, d: 0.12, gain: 0.07 });
      tone(v, { f: 110, f1: 45, d: 0.35, gain: 0.25 });
      fm(v, { f: midiToHz(r + 24), ratio: 2, index: 0.8, at: 0.02, d: 0.9, gain: 0.04 });
    },
  },
  /** Boss phase change: a low gong and a descending minor third. */
  boss_phase: {
    priority: 9, minInterval: 0.5, dur: fixed(2.0), duck: 0.5,
    play(v, p) {
      fm(v, { f: midiToHz(root(p, -12)), ratio: 1.4, index: 2.2, d: 1.8, gain: 0.12 });
      tone(v, { f: 80, f1: 40, d: 0.6, gain: 0.2 });
      brass(v, [root(p, 12) + 3], 0.1, 0.4, 0.035);
      brass(v, [root(p, 12)], 0.45, 0.9, 0.035);
    },
  },
  /** Tower death: a long descending glide into a dark wash. */
  tower_death: {
    priority: 10, minInterval: 2, dur: fixed(2.8), duck: 0.8,
    play(v, p) {
      swell(v, { type: 'sawtooth', f: midiToHz(root(p, 12)), f1: midiToHz(root(p, -24)), rise: 0.05, hold: 1.8, release: 0.8, gain: 0.07, lp: 2000, lp1: 200 });
      swell(v, { type: 'sawtooth', f: midiToHz(root(p, 19)), f1: midiToHz(root(p, -17)), rise: 0.05, hold: 1.8, release: 0.8, gain: 0.045, lp: 1600, lp1: 180 });
      noiseSwell(v, { type: 'lowpass', f: 1500, f1: 120, rise: 0.3, hold: 1.2, release: 1.0, gain: 0.05 });
      tone(v, { f: 90, f1: 30, d: 1.5, gain: 0.22 });
    },
  },
  /** Prestige: a big swell on the tonic chord with bells on top. */
  prestige: {
    priority: 10, minInterval: 2, dur: fixed(5.0), duck: 0.85,
    play(v, p) {
      const r = root(p, 0), third = major(p) ? 4 : 3;
      for (const m of [r - 12, r, r + 7, r + 12 + third, r + 19, r + 24]) {
        swell(v, { type: 'sawtooth', f: midiToHz(m), rise: 2.4, hold: 0.4, release: 1.8, gain: 0.03, lp: 400, lp1: 3000, detune: (v.rand() - 0.5) * 14 });
      }
      for (let k = 0; k < 5; k++) fm(v, { f: midiToHz(scaleNote(r + 36, pent(p), k)), ratio: 3.01, index: 0.5, at: 2.4 + k * 0.08, d: 1.4, gain: 0.03 });
    },
  },
  /** Ascension: the Prestige swell, longer and an octave wider, with a choir-like detune. */
  ascension: {
    priority: 10, minInterval: 2, dur: fixed(7.0), duck: 0.9,
    play(v, p) {
      const r = root(p, 0), third = major(p) ? 4 : 3;
      for (const m of [r - 24, r - 12, r, r + 7, r + 12 + third, r + 19, r + 24, r + 31]) {
        for (const dt of [-9, 9]) swell(v, { type: 'sawtooth', f: midiToHz(m), rise: 3.4, hold: 0.8, release: 2.4, gain: 0.018, lp: 300, lp1: 3400, detune: dt });
      }
      for (let k = 0; k < 8; k++) fm(v, { f: midiToHz(scaleNote(r + 36, pent(p), k)), ratio: 3.01, index: 0.5, at: 3.4 + k * 0.07, d: 1.8, gain: 0.026 });
    },
  },
  /** Anomaly draft ready: a three-note rising chime. */
  draft_ready: {
    priority: 8, minInterval: 1, dur: fixed(1.1),
    play(v, p) {
      for (let k = 0; k < 3; k++) fm(v, { f: midiToHz(scaleNote(root(p, 24), pent(p), 2 + k * 2)), ratio: 2.01, index: 0.7, at: k * 0.11, d: 0.7, gain: 0.045 });
    },
  },
  /** UI: tab switch (a tiny soft click). */
  ui_tab: {
    priority: 7, minInterval: 0.05, dur: fixed(0.06),
    play(v) { tone(v, { f: 1250, d: 0.03, gain: 0.1 }); noise(v, { type: 'bandpass', f: 3000, q: 2, d: 0.01, gain: 0.035 }); },
  },
  /** UI: toggle (two-tone click). */
  ui_toggle: {
    priority: 7, minInterval: 0.05, dur: fixed(0.1),
    play(v) { tone(v, { f: 900, d: 0.025, gain: 0.07 }); tone(v, { f: 1350, at: 0.04, d: 0.03, gain: 0.07 }); },
  },
  /** UI: a sheet or sub-screen opening (a soft upward breath). */
  ui_sheet: {
    priority: 7, minInterval: 0.1, dur: fixed(0.2),
    play(v) { noiseSwell(v, { type: 'bandpass', f: 500, f1: 1500, q: 1.5, rise: 0.05, release: 0.12, gain: 0.08 }); },
  },
  /** UI: a plain button tap. */
  ui_tap: {
    priority: 7, minInterval: 0.05, dur: fixed(0.05),
    play(v) { tone(v, { f: 1000, d: 0.025, gain: 0.09 }); },
  },
  /** Settings → Test sound: a pleasant arpeggio in the current key. */
  test: {
    priority: 10, minInterval: 0.3, dur: fixed(1.2),
    play(v, p) {
      for (let k = 0; k < 4; k++) tone(v, { type: 'triangle', f: midiToHz(scaleNote(root(p, 12), pent(p), k * 2)), at: k * 0.12, a: 0.01, d: 0.5, gain: 0.07, lp: 3000 });
    },
  },
} satisfies Record<string, SfxDef>;
