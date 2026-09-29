/**
 * Chain-note instruments: one short, pitched voice per timbre (chain.ts picks the timbre from the
 * event's src). Pitches arrive already quantized to the music's key; these only shape the tone.
 */
import type { Timbre } from '../chain';
import { fm, noise, tone } from '../synth';
import type { Voice } from '../synth';
import { midiToHz } from '../theory';

export const NOTE_DUR: Record<Timbre, number> = {
  pluck: 0.35, ember: 0.45, spark: 0.4, drop: 0.3, glass: 0.8, blip: 0.2, mallet: 0.45, air: 0.4, beam: 0.55, deep: 0.5, shimmer: 0.7, bell: 0.9,
};

/** Play a chain note of `timbre` at `midi`, velocity 0..1. */
export function playNote(v: Voice, timbre: Timbre, midi: number, vel: number): void {
  const f = midiToHz(midi);
  const g = 0.075 * vel;
  switch (timbre) {
    case 'pluck': tone(v, { type: 'triangle', f, d: 0.3, gain: g, lp: 3200, lp1: 900 }); break;
    case 'ember': tone(v, { type: 'sawtooth', f, a: 0.012, d: 0.38, gain: g * 0.55, lp: 1600, lp1: 500 }); tone(v, { f, d: 0.3, gain: g * 0.4 }); break;
    case 'spark': fm(v, { f, ratio: 3, index: 1.3, d: 0.34, gain: g * 0.8 }); break;
    case 'drop': tone(v, { f: f * 0.9, f1: f, glide: 0.03, a: 0.006, d: 0.25, gain: g }); break;
    case 'glass': fm(v, { f, ratio: 3.51, index: 0.7, d: 0.75, gain: g * 0.7 }); break;
    case 'blip': tone(v, { type: 'square', f, d: 0.14, gain: g * 0.45, lp: 2400 }); break;
    case 'mallet': tone(v, { f, d: 0.4, gain: g }); tone(v, { f: f * 4, d: 0.06, gain: g * 0.25 }); break;
    case 'air': noise(v, { type: 'bandpass', f: Math.min(6000, f * 2), q: 9, a: 0.02, d: 0.3, gain: g * 1.6 }); tone(v, { f, a: 0.02, d: 0.3, gain: g * 0.5 }); break;
    case 'beam': tone(v, { f, a: 0.03, d: 0.5, gain: g * 0.9 }); tone(v, { f: f * 1.005, a: 0.03, d: 0.5, gain: g * 0.4, type: 'triangle' }); break;
    case 'deep': tone(v, { type: 'triangle', f: f * 0.5, a: 0.02, d: 0.45, gain: g * 1.1 }); tone(v, { f, d: 0.3, gain: g * 0.4 }); break;
    case 'shimmer': tone(v, { type: 'triangle', f, a: 0.02, d: 0.6, gain: g * 0.6, detune: 7 }); tone(v, { type: 'triangle', f: f * 1.5, a: 0.03, d: 0.55, gain: g * 0.35, detune: -7 }); break;
    case 'bell': fm(v, { f, ratio: 1.41, index: 1, d: 0.85, gain: g * 0.8 }); break;
  }
}
