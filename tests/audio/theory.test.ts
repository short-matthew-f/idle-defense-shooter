import { describe, expect, it } from 'vitest';
import { chordOn, inScale, isMajorMode, midiToHz, MODES, pentatonicFor, quantize, scaleNote, voiceLead, type ModeName } from '../../src/audio/theory';

const MODE_NAMES = Object.keys(MODES) as ModeName[];

describe('audio theory: scales and quantization', () => {
  it('converts MIDI to Hz (A4 = 440, octaves double)', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
  });

  it('every mode has 7 ascending notes from 0 and its pentatonic is a consonant subset', () => {
    for (const m of MODE_NAMES) {
      const s = MODES[m];
      expect(s.length).toBe(7);
      expect(s[0]).toBe(0);
      for (let i = 1; i < 7; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
      const pent = pentatonicFor(m);
      for (const pc of pent) expect(s).toContain(pc);
      // no semitone steps inside the pentatonic (including the wrap to the octave)
      const wrapped = [...pent, 12];
      for (let i = 1; i < wrapped.length; i++) expect(wrapped[i] - wrapped[i - 1]).toBeGreaterThanOrEqual(2);
    }
    expect(isMajorMode('lydian')).toBe(true);
    expect(isMajorMode('dorian')).toBe(false);
  });

  it('quantizes any pitch to the nearest scale note (ties go down) and leaves scale notes alone', () => {
    const root = 50, pent = pentatonicFor('dorian');   // D minor pentatonic: D F G A C
    for (let m = 30; m < 100; m += 0.25) {
      const q = quantize(m, root, pent);
      expect(inScale(q, root, pent)).toBe(true);
      // nothing in the scale is strictly closer
      for (let d = -6; d <= 6; d++) if (inScale(Math.floor(m) + d, root, pent)) expect(Math.abs(m - q)).toBeLessThanOrEqual(Math.abs(m - (Math.floor(m) + d)) + 1e-9);
    }
    expect(quantize(62, root, pent)).toBe(62);   // D stays D
    expect(quantize(64, root, pent)).toBe(65);   // E → F (1 vs 2 semitones)
    expect(quantize(63.5, root, pent)).toBe(62);   // 1.5 from D and from F: a tie goes down
    expect(quantize(66, root, pent)).toBe(65);   // F# is a tie between F and G: goes down
  });

  it('scaleNote walks the scale with octave wrap in both directions', () => {
    const pent = pentatonicFor('aeolian');
    expect(scaleNote(52, pent, 0)).toBe(52);
    expect(scaleNote(52, pent, 5)).toBe(64);
    expect(scaleNote(52, pent, 10)).toBe(76);
    expect(scaleNote(52, pent, -1)).toBe(52 - 12 + 10);
    for (let d = 0; d < 20; d++) expect(scaleNote(52, pent, d + 1)).toBeGreaterThan(scaleNote(52, pent, d));
  });

  it('builds diatonic chords and voice-leads them inside a range with small motion', () => {
    expect(chordOn(50, 'dorian', 0, 3)).toEqual([50, 53, 57]);          // Dm
    expect(chordOn(50, 'dorian', 3, 3)).toEqual([55, 59, 62]);          // G (the Dorian IV)
    expect(chordOn(54, 'lydian', 1, 3)).toEqual([56, 60, 63]);          // G# (the Lydian II)
    const a = voiceLead(chordOn(50, 'dorian', 0, 4), null, 50, 72);
    const b = voiceLead(chordOn(50, 'dorian', 3, 4), a, 50, 72);
    for (const m of [...a, ...b]) { expect(m).toBeGreaterThanOrEqual(50); expect(m).toBeLessThanOrEqual(72); }
    const move = b.reduce((s, m, i) => s + Math.abs(m - (a[i] ?? m)), 0);
    expect(move).toBeLessThanOrEqual(12);   // common-tone voice leading, not a jump
  });
});
