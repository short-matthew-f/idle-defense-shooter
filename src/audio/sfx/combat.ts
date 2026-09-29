/**
 * Combat sounds: shots, hits, kills, explosions and the tower taking damage. These fire by the
 * hundred, so they are short, soft-edged and quiet: a hundred of them should sum to texture, not noise.
 */
import { fm, noise, noiseSwell, swell, tone } from '../synth';
import { midiToHz, pentatonicFor, scaleNote } from '../theory';
import { fixed, type SfxDef } from './types';

export const COMBAT = {
  /** Primary shot: a very quiet tick. */
  shot: {
    priority: 1, minInterval: 0.07, dur: fixed(0.05),
    play(v) {
      const f = 2200 + v.rand() * 500;
      noise(v, { type: 'bandpass', f, q: 1.2, d: 0.024, gain: 0.2 });
      tone(v, { type: 'triangle', f: f * 0.5, f1: f * 0.4, d: 0.022, gain: 0.07 });
    },
  },
  /** Hit: a soft, low thud. */
  hit: {
    priority: 1, minInterval: 0.06, dur: fixed(0.08),
    play(v) {
      tone(v, { f: 210 + v.rand() * 30, f1: 130, d: 0.06, gain: 0.08 });
      noise(v, { type: 'lowpass', f: 1400, d: 0.035, gain: 0.035 });
    },
  },
  /** Critical hit: the tick, brighter and with a short ring. */
  hit_crit: {
    priority: 2, minInterval: 0.1, dur: fixed(0.12),
    play(v) {
      tone(v, { type: 'triangle', f: 2600, f1: 2100, d: 0.07, gain: 0.05, lp: 5000 });
      noise(v, { type: 'bandpass', f: 4200, q: 1.5, d: 0.03, gain: 0.04 });
      tone(v, { f: 330, f1: 200, d: 0.05, gain: 0.05 });
    },
  },
  /** Kill: a small pop. */
  kill: {
    priority: 3, minInterval: 0.05, dur: fixed(0.12),
    play(v, p) {
      const f = 480 + v.rand() * 120;
      tone(v, { f, f1: f * 0.45, glide: 0.06, d: 0.09, gain: 0.12 * (p.level ?? 1) });
      noise(v, { type: 'bandpass', f: 1600, q: 0.9, d: 0.045, gain: 0.05 * (p.level ?? 1) });
    },
  },
  /** Elite kill: a rounder, bigger pop with a tail. */
  kill_elite: {
    priority: 6, minInterval: 0.15, dur: fixed(0.35),
    play(v) {
      tone(v, { f: 320, f1: 110, d: 0.25, gain: 0.2 });
      noise(v, { type: 'lowpass', f: 2600, f1: 350, d: 0.25, gain: 0.09 });
      tone(v, { type: 'triangle', f: 660, f1: 520, d: 0.16, gain: 0.05, at: 0.01 });
    },
  },
  /** Boss kill: a long boom with a ringing tonic fifth. */
  kill_boss: {
    priority: 10, minInterval: 0.5, dur: fixed(2.8), duck: 0.6,
    play(v, p) {
      tone(v, { f: 92, f1: 38, d: 1.6, gain: 0.32 });
      noise(v, { type: 'lowpass', f: 2800, f1: 180, a: 0.01, d: 1.7, gain: 0.2 });
      const root = p.key ? p.key.root + 12 : 62;
      fm(v, { f: midiToHz(root), ratio: 2, index: 1.2, at: 0.05, d: 2.4, gain: 0.07 });
      fm(v, { f: midiToHz(root + 7), ratio: 2, index: 1, at: 0.09, d: 2.2, gain: 0.05 });
    },
  },
  /** Explosion scaled by size 0..1 (blast radius). */
  explosion: {
    priority: 3, minInterval: 0.08, dur: (p) => 0.35 + 1.0 * (p.size ?? 0.3),
    play(v, p) {
      const s = Math.max(0, Math.min(1, p.size ?? 0.3));
      tone(v, { f: 115 - 50 * s, f1: 38, d: 0.25 + 0.85 * s, gain: 0.08 + 0.12 * s });
      noise(v, { type: 'lowpass', f: 2200 + 800 * s, f1: 260, a: 0.004, d: 0.2 + 0.75 * s, gain: 0.06 + 0.09 * s });
    },
  },
  /** Tower hit: a low-passed thud. */
  tower_hit: {
    priority: 5, minInterval: 0.12, dur: fixed(0.25),
    play(v, p) {
      const l = 0.6 + 0.4 * (p.level ?? 0.5);
      tone(v, { f: 125, f1: 58, d: 0.18, gain: 0.2 * l });
      noise(v, { type: 'lowpass', f: 650, d: 0.12, gain: 0.12 * l });
    },
  },
  /** Shield hit: a short glassy ring over a soft thump. */
  shield_hit: {
    priority: 4, minInterval: 0.1, dur: fixed(0.3),
    play(v) {
      fm(v, { f: 880, ratio: 1.5, index: 0.8, d: 0.22, gain: 0.06 });
      noise(v, { type: 'bandpass', f: 2800, q: 1.2, d: 0.08, gain: 0.03 });
      tone(v, { f: 160, f1: 110, d: 0.08, gain: 0.06 });
    },
  },
  /** Barrier break: a shatter of pings over a thump. */
  barrier_break: {
    priority: 8, minInterval: 0.4, dur: fixed(1.0), duck: 0.3,
    play(v, p) {
      noise(v, { type: 'highpass', f: 2200, d: 0.55, gain: 0.1 });
      tone(v, { f: 150, f1: 60, d: 0.3, gain: 0.18 });
      const root = p.key ? p.key.root + 24 : 74;
      const pent = pentatonicFor(p.key?.mode ?? 'dorian');
      for (let k = 0; k < 5; k++) fm(v, { f: midiToHz(scaleNote(root, pent, 4 - k)), ratio: 3.5, index: 1, at: 0.02 + k * 0.045, d: 0.35, gain: 0.03 });
    },
  },
  /** Second Core: a heartbeat, then a rising swell. */
  second_core: {
    priority: 9, minInterval: 1, dur: fixed(1.6), duck: 0.4,
    play(v, p) {
      tone(v, { f: 70, f1: 45, d: 0.2, gain: 0.25 });
      tone(v, { f: 70, f1: 45, d: 0.2, gain: 0.2, at: 0.28 });
      const root = p.key ? p.key.root : 50;
      for (const [k, m] of [0, 7, 12].entries()) swell(v, { type: 'triangle', f: midiToHz(root + m), f1: midiToHz(root + m + 12), at: 0.5, rise: 0.6, release: 0.4, gain: 0.05 - k * 0.01 });
      noiseSwell(v, { type: 'bandpass', f: 600, f1: 3000, at: 0.5, rise: 0.6, release: 0.3, gain: 0.03 });
    },
  },
} satisfies Record<string, SfxDef>;
