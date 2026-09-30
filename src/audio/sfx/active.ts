/**
 * Active-edge sounds (docs/ACTIVE.md): the assist shot's crack, the salvage collect pluck (pitch climbs one pentatonic
 * step per chain link, so a chain is heard as a rising run), a soft tick when the passive collector takes a crate, and
 * the Overcharge release thump (bigger on a perfect release). All pitched sounds sit in the music's key.
 */
import { fm, noise, tone } from '../synth';
import { midiToHz, pentatonicFor, scaleNote } from '../theory';
import { fixed, type SfxDef, type SfxParams } from './types';

const keyRoot = (p: SfxParams, up = 12): number => (p.key?.root ?? 50) + up;
const pent = (p: SfxParams): readonly number[] => pentatonicFor(p.key?.mode ?? 'dorian');

export const ACTIVE_SFX = {
  /** Assist shot: a bright, short crack (louder than the auto-fire `shot`, so a tap is felt). */
  assist: {
    priority: 6, minInterval: 0.08, dur: fixed(0.2),
    play(v) {
      noise(v, { type: 'bandpass', f: 3400, f1: 1200, q: 1.4, a: 0.002, d: 0.07, gain: 0.08 });
      tone(v, { type: 'triangle', f: 880, f1: 330, d: 0.09, gain: 0.07, lp: 5000 });
    },
  },
  /** Salvage collect: a plucked note, one pentatonic step higher per chain link (`size` = links − 1, 0..8). */
  salvage_pluck: {
    priority: 7, minInterval: 0.05, dur: fixed(0.5),
    play(v, p) {
      const deg = Math.max(0, Math.min(8, Math.round(p.size ?? 0)));
      const m = scaleNote(keyRoot(p, 24), pent(p), deg);
      fm(v, { f: midiToHz(m), ratio: 2, index: 1.1, d: 0.32, gain: 0.07 });
      tone(v, { type: 'triangle', f: midiToHz(m + 12), d: 0.12, gain: 0.03, lp: 6000 });
    },
  },
  /** Passive collector: a quiet low tick (the crate still paid). */
  salvage_passive: {
    priority: 3, minInterval: 0.15, dur: fixed(0.2),
    play(v, p) { tone(v, { type: 'sine', f: midiToHz(keyRoot(p, 12)), d: 0.1, gain: 0.035 }); },
  },
  /** Overcharge release: a deep thump and a rising zap along the beam (`size` 1 = perfect, 0.5 = weak). */
  overcharge_thump: {
    priority: 9, minInterval: 0.3, dur: fixed(1.0), duck: 0.3,
    play(v, p) {
      const s = Math.max(0.3, Math.min(1, p.size ?? 1));
      tone(v, { f: 150, f1: 38, d: 0.55, gain: 0.24 * s });
      noise(v, { type: 'lowpass', f: 2400, f1: 200, a: 0.003, d: 0.4, gain: 0.08 * s });
      tone(v, { type: 'sawtooth', f: midiToHz(keyRoot(p, 0)), f1: midiToHz(keyRoot(p, 24)), d: 0.35, gain: 0.04 * s, lp: 3000 });
    },
  },
} satisfies Record<string, SfxDef>;
