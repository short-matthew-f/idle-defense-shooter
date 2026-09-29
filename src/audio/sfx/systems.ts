/**
 * Weapon-system sounds: hardpoints (missiles, drones, blade, gravity wells; the laser is a continuous
 * hum the engine runs) and the combination systems (fusion, triad, linkage, infusion, anomaly), which
 * all share a shimmer chord family in the music's key.
 */
import { fm, noise, noiseSwell, swell, tone } from '../synth';
import { midiToHz, pentatonicFor, scaleNote, type Key } from '../theory';
import type { Voice } from '../synth';
import { fixed, type SfxDef } from './types';

/** Chord tones of the key's pentatonic, high register: degrees give the shimmer's voicing. */
function shimmer(v: Voice, key: Key | undefined, degrees: number[], d: number, gain: number, spread = 0.025): void {
  const root = (key?.root ?? 50) + 24;
  const pent = pentatonicFor(key?.mode ?? 'dorian');
  degrees.forEach((deg, k) => {
    const f = midiToHz(scaleNote(root, pent, deg));
    tone(v, { type: 'triangle', f, at: k * spread, a: 0.03, d, gain, lp: 5000, detune: (v.rand() - 0.5) * 12 });
    tone(v, { f: f * 2, at: k * spread + 0.01, a: 0.04, d: d * 0.7, gain: gain * 0.35 });
  });
}

export const SYSTEMS = {
  /** Fusion: a three-note shimmer chord. */
  fusion: {
    priority: 5, minInterval: 0.25, dur: fixed(0.9),
    play(v, p) { shimmer(v, p.key, [0, 2, 4], 0.75, 0.04); },
  },
  /** Triad: a wider four-note shimmer with an octave on top. */
  triad: {
    priority: 6, minInterval: 0.4, dur: fixed(1.3),
    play(v, p) {
      shimmer(v, p.key, [0, 2, 4, 5], 1.1, 0.036, 0.04);
      noiseSwell(v, { type: 'highpass', f: 6000, rise: 0.1, release: 0.6, gain: 0.012 });
    },
  },
  /** Linkage: a bell dyad (root and fifth). */
  linkage: {
    priority: 4, minInterval: 0.25, dur: fixed(1.0),
    play(v, p) {
      const root = (p.key?.root ?? 50) + 24;
      fm(v, { f: midiToHz(root), ratio: 1.41, index: 1.1, d: 0.85, gain: 0.045 });
      fm(v, { f: midiToHz(root + 7), ratio: 1.41, index: 0.9, at: 0.03, d: 0.8, gain: 0.035 });
    },
  },
  /** Infusion: a two-note shimmer a fourth apart with a breath. */
  infusion: {
    priority: 4, minInterval: 0.25, dur: fixed(0.6),
    play(v, p) {
      shimmer(v, p.key, [1, 3], 0.45, 0.04, 0.05);
      noise(v, { type: 'bandpass', f: 2500, q: 1.5, a: 0.02, d: 0.2, gain: 0.02 });
    },
  },
  /** Anomaly: a detuned shimmer that bends down slightly. */
  anomaly: {
    priority: 4, minInterval: 0.3, dur: fixed(0.9),
    play(v, p) {
      const root = (p.key?.root ?? 50) + 24;
      const f = midiToHz(root + 7);
      tone(v, { type: 'triangle', f, f1: f * 0.94, a: 0.04, d: 0.75, gain: 0.04, detune: 14 });
      tone(v, { type: 'triangle', f: f * 1.5, f1: f * 1.41, a: 0.05, d: 0.7, gain: 0.03, detune: -14 });
    },
  },
  /** Missile launch: a rising whoosh over a low push. */
  missile_launch: {
    priority: 2, minInterval: 0.12, dur: fixed(0.4),
    play(v) {
      noiseSwell(v, { type: 'bandpass', f: 400, f1: 2400, q: 1.4, rise: 0.08, release: 0.26, gain: 0.07 });
      tone(v, { f: 170, f1: 90, d: 0.1, gain: 0.05 });
    },
  },
  /** Drone: a buzzy blip (one, sometimes two). */
  drone_blip: {
    priority: 1, minInterval: 0.1, dur: fixed(0.12),
    play(v) {
      const f = 1050 + v.rand() * 300;
      tone(v, { type: 'square', f, f1: f * 1.25, d: 0.035, gain: 0.05, lp: 2600 });
      if (v.rand() < 0.4) tone(v, { type: 'square', f: f * 1.2, at: 0.05, d: 0.03, gain: 0.035, lp: 2600 });
    },
  },
  /** Blade: a band-passed whoosh that sweeps up and back. */
  blade_whoosh: {
    priority: 2, minInterval: 0.18, dur: fixed(0.3),
    play(v) {
      noiseSwell(v, { type: 'bandpass', f: 500, f1: 1900, q: 2.2, rise: 0.08, release: 0.16, gain: 0.07 });
    },
  },
  /** Gravity well: a slow low swell. */
  well_swell: {
    priority: 4, minInterval: 0.5, dur: fixed(1.2),
    play(v) {
      swell(v, { type: 'sine', f: 55, f1: 82, rise: 0.5, release: 0.6, gain: 0.05 });
      swell(v, { type: 'triangle', f: 110, f1: 164, rise: 0.5, release: 0.6, gain: 0.02 });
      noiseSwell(v, { type: 'lowpass', f: 250, f1: 600, rise: 0.5, release: 0.5, gain: 0.025 });
    },
  },
  /** Gravity well collapse: an inward rush, then a thump. */
  well_collapse: {
    priority: 5, minInterval: 0.3, dur: fixed(0.8),
    play(v) {
      noiseSwell(v, { type: 'lowpass', f: 3000, f1: 150, rise: 0.15, release: 0.12, gain: 0.05 });
      tone(v, { f: 85, f1: 34, at: 0.2, d: 0.45, gain: 0.09 });
    },
  },
} satisfies Record<string, SfxDef>;
