/**
 * Element and status sounds. The four elements each have a signature texture (fire crackles, lightning
 * cracks, poison bubbles, frost pings like glass); the other statuses get small, quieter marks.
 */
import { fm, noise, noiseSwell, tone } from '../synth';
import { midiToHz, pentatonicFor, scaleNote } from '../theory';
import { fixed, type SfxDef } from './types';

export const ELEMENTS = {
  /** Fire: a crackling whoosh (a band-passed breath with three tiny crackles on top). */
  el_fire: {
    priority: 2, minInterval: 0.15, dur: fixed(0.35),
    play(v) {
      noiseSwell(v, { type: 'bandpass', f: 700, f1: 2000, q: 0.9, rise: 0.05, release: 0.24, gain: 0.08 });
      for (let k = 0; k < 3; k++) noise(v, { type: 'highpass', f: 2500 + v.rand() * 2000, at: 0.02 + v.rand() * 0.2, d: 0.008, gain: 0.05 });
    },
  },
  /** Lightning: a dry double crack with a falling buzz. */
  el_lightning: {
    priority: 3, minInterval: 0.12, dur: fixed(0.2),
    play(v) {
      noise(v, { type: 'bandpass', f: 3600, q: 0.7, d: 0.06, gain: 0.14 });
      noise(v, { type: 'bandpass', f: 2600, q: 0.7, at: 0.035, d: 0.05, gain: 0.08 });
      tone(v, { type: 'square', f: 1100, f1: 180, d: 0.08, gain: 0.02, lp: 3500 });
    },
  },
  /** Poison: two soft bubbles rising. */
  el_poison: {
    priority: 2, minInterval: 0.15, dur: fixed(0.25),
    play(v) {
      const f = 260 + v.rand() * 60;
      tone(v, { f, f1: f * 2.4, glide: 0.06, a: 0.01, d: 0.09, gain: 0.11 });
      tone(v, { f: f * 1.3, f1: f * 3, glide: 0.05, at: 0.08, a: 0.01, d: 0.08, gain: 0.07 });
    },
  },
  /** Frost: a glass ping (FM with an inharmonic ratio), in key. */
  el_frost: {
    priority: 2, minInterval: 0.2, dur: fixed(0.7),
    play(v, p) {
      const root = (p.key?.root ?? 50) + 36;
      const m = scaleNote(root, pentatonicFor(p.key?.mode ?? 'dorian'), Math.floor(v.rand() * 3));
      fm(v, { f: midiToHz(m), ratio: 3.51, index: 0.9, d: 0.6, gain: 0.045 });
      noise(v, { type: 'bandpass', f: 7000, q: 3, d: 0.05, gain: 0.02 });
    },
  },
  /** Chill: a soft, airy breath. */
  st_chill: {
    priority: 1, minInterval: 0.25, dur: fixed(0.35),
    play(v) { noiseSwell(v, { type: 'bandpass', f: 4200, f1: 3000, q: 2.5, rise: 0.05, release: 0.25, gain: 0.06 }); },
  },
  /** Shock: a short electric zap. */
  st_shock: {
    priority: 2, minInterval: 0.18, dur: fixed(0.14),
    play(v) {
      fm(v, { type: 'triangle', f: 190, ratio: 7.1, index: 3, d: 0.09, gain: 0.09 });
      noise(v, { type: 'bandpass', f: 3200, q: 2, d: 0.03, gain: 0.06 });
    },
  },
  /** Bleed: a wet slice. */
  st_bleed: {
    priority: 1, minInterval: 0.2, dur: fixed(0.16),
    play(v) {
      noise(v, { type: 'bandpass', f: 1300, f1: 500, q: 2, d: 0.11, gain: 0.11 });
      tone(v, { f: 190, f1: 150, d: 0.07, gain: 0.07 });
    },
  },
  /** Brittle: a tiny crystalline crack. */
  st_brittle: {
    priority: 1, minInterval: 0.2, dur: fixed(0.12),
    play(v) {
      tone(v, { type: 'triangle', f: 2900, f1: 2300, d: 0.07, gain: 0.07, lp: 5000 });
      noise(v, { type: 'highpass', f: 5000, d: 0.03, gain: 0.05 });
    },
  },
  /** Marked: a two-blip target lock, in key. */
  st_marked: {
    priority: 5, minInterval: 0.3, dur: fixed(0.2),
    play(v, p) {
      const root = (p.key?.root ?? 50) + 24;
      const pent = pentatonicFor(p.key?.mode ?? 'dorian');
      tone(v, { type: 'triangle', f: midiToHz(scaleNote(root, pent, 3)), d: 0.05, gain: 0.05, lp: 4000 });
      tone(v, { type: 'triangle', f: midiToHz(scaleNote(root, pent, 5)), at: 0.07, d: 0.07, gain: 0.05, lp: 4000 });
    },
  },
} satisfies Record<string, SfxDef>;
