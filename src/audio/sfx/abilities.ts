/**
 * The ten tactical abilities (design §10). Each has its own shape so a player can tell them apart
 * by ear (the render harness checks their spectra and envelopes differ), and each follows its effect:
 * Bombardment's whistle lasts its 0.6 s fuse, Singularity Bomb's pull lasts its 2 s before the blast.
 */
import { fm, noise, noiseSwell, swell, tone } from '../synth';
import { midiToHz, pentatonicFor, scaleNote } from '../theory';
import { fixed, type SfxDef, type SfxParams } from './types';

const keyRoot = (p: SfxParams, up = 12): number => (p.key?.root ?? 50) + up;
const pent = (p: SfxParams): readonly number[] => pentatonicFor(p.key?.mode ?? 'dorian');

export const ABILITY_SFX = {
  /** Hunter Mark: three rising lock-on blips and a ping. */
  ab_hunter_mark: {
    priority: 8, minInterval: 0.2, dur: fixed(0.6),
    play(v, p) {
      for (let k = 0; k < 3; k++) tone(v, { type: 'square', f: midiToHz(scaleNote(keyRoot(p, 24), pent(p), k * 2)), at: k * 0.07, d: 0.045, gain: 0.04, lp: 2400 });
      fm(v, { f: midiToHz(scaleNote(keyRoot(p, 24), pent(p), 7)), ratio: 2, index: 0.6, at: 0.22, d: 0.3, gain: 0.05 });
    },
  },
  /** Repulsor Pulse: a deep whoomp with a falling band of air. */
  ab_repulsor_pulse: {
    priority: 8, minInterval: 0.2, dur: fixed(0.7),
    play(v) {
      tone(v, { f: 210, f1: 55, d: 0.5, gain: 0.26 });
      noise(v, { type: 'bandpass', f: 2800, f1: 250, q: 1.2, a: 0.01, d: 0.45, gain: 0.08 });
    },
  },
  /** Time Field: a chord that slows like a tape stopping, under a slow wobble. */
  ab_time_field: {
    priority: 8, minInterval: 0.2, dur: fixed(1.6),
    play(v, p) {
      for (const [k, deg] of [0, 2, 4].entries()) {
        const f = midiToHz(scaleNote(keyRoot(p), pent(p), deg));
        swell(v, { type: 'triangle', f, f1: f * 0.5, rise: 0.08, hold: 0.9, release: 0.5, gain: 0.05 - k * 0.008, lp: 2200, lp1: 500 });
      }
      noiseSwell(v, { type: 'bandpass', f: 900, f1: 300, q: 4, rise: 0.3, hold: 0.5, release: 0.6, gain: 0.03 });
    },
  },
  /** Bombardment: a falling whistle over the 0.6 s fuse, then the blast. */
  ab_bombardment: {
    priority: 8, minInterval: 0.2, dur: fixed(1.9), duck: 0.35,
    play(v) {
      swell(v, { type: 'sine', f: 1700, f1: 520, rise: 0.5, release: 0.08, gain: 0.04 });
      tone(v, { f: 100, f1: 32, at: 0.6, d: 1.1, gain: 0.21 });
      noise(v, { type: 'lowpass', f: 3200, f1: 220, at: 0.6, a: 0.003, d: 1.0, gain: 0.14 });
    },
  },
  /** EMP: an electric discharge sweeping down, with crackle. */
  ab_emp: {
    priority: 8, minInterval: 0.2, dur: fixed(1.0),
    play(v) {
      fm(v, { type: 'sawtooth', f: 90, ratio: 5.3, index: 6, d: 0.7, gain: 0.09 });
      noise(v, { type: 'bandpass', f: 4000, f1: 250, q: 2, a: 0.005, d: 0.8, gain: 0.14 });
      for (let k = 0; k < 4; k++) noise(v, { type: 'highpass', f: 3000, at: 0.05 + k * 0.12 + v.rand() * 0.05, d: 0.015, gain: 0.08 });
    },
  },
  /** Overdrive: an engine revving up through an opening filter. */
  ab_overdrive: {
    priority: 8, minInterval: 0.2, dur: fixed(0.9),
    play(v) {
      swell(v, { type: 'sawtooth', f: 90, f1: 300, rise: 0.5, hold: 0.1, release: 0.25, gain: 0.07, lp: 350, lp1: 2800 });
      swell(v, { type: 'square', f: 45, f1: 150, rise: 0.5, hold: 0.1, release: 0.25, gain: 0.035, lp: 600 });
    },
  },
  /** Emergency Repair: a warm rising major arpeggio with a shimmer. */
  ab_emergency_repair: {
    priority: 8, minInterval: 0.2, dur: fixed(1.1),
    play(v, p) {
      const root = keyRoot(p);
      [0, 4, 7, 12].forEach((m, k) => tone(v, { f: midiToHz(root + m), at: k * 0.07, a: 0.01, d: 0.55, gain: 0.07 }));
      noiseSwell(v, { type: 'highpass', f: 5000, at: 0.1, rise: 0.25, release: 0.5, gain: 0.012 });
    },
  },
  /** Drone Surge: a swarm of detuned buzzing blips taking off. */
  ab_drone_surge: {
    priority: 8, minInterval: 0.2, dur: fixed(0.8),
    play(v) {
      for (let k = 0; k < 7; k++) {
        const f = 700 + v.rand() * 700;
        tone(v, { type: 'square', f, f1: f * 1.6, at: k * 0.07 + v.rand() * 0.03, d: 0.09, gain: 0.055, lp: 2400 });
      }
      noiseSwell(v, { type: 'bandpass', f: 300, f1: 1200, q: 1, rise: 0.4, release: 0.3, gain: 0.055 });
    },
  },
  /** Missile Storm: a volley of launch whooshes over a low rumble. */
  ab_missile_storm: {
    priority: 8, minInterval: 0.2, dur: fixed(1.3),
    play(v) {
      for (let k = 0; k < 8; k++) noiseSwell(v, { type: 'bandpass', f: 500 + v.rand() * 200, f1: 2600, q: 1.5, at: k * 0.09, rise: 0.06, release: 0.2, gain: 0.05 });
      swell(v, { type: 'sine', f: 50, f1: 42, rise: 0.2, hold: 0.5, release: 0.4, gain: 0.045 });
    },
  },
  /** Singularity Bomb: a 2 s inward pull (rising pitch, closing air) and then the collapse. */
  ab_singularity_bomb: {
    priority: 8, minInterval: 0.2, dur: fixed(3.0), duck: 0.4,
    play(v) {
      swell(v, { type: 'sine', f: 40, f1: 130, rise: 1.9, release: 0.1, gain: 0.14 });
      noiseSwell(v, { type: 'lowpass', f: 200, f1: 3800, q: 2, rise: 1.9, release: 0.08, gain: 0.07 });
      tone(v, { f: 70, f1: 28, at: 2.0, d: 0.9, gain: 0.21 });
      noise(v, { type: 'lowpass', f: 2600, f1: 160, at: 2.0, a: 0.003, d: 0.8, gain: 0.12 });
    },
  },
} satisfies Record<string, SfxDef>;
