import { describe, expect, it } from 'vitest';
import { encodeWav, silentWav } from '../../src/audio/wav';
import { softClipCurve } from '../../src/audio/synth';
import { AudioRng, mixSeed } from '../../src/audio/rng';

describe('audio: WAV encoding, soft clip, PRNG', () => {
  it('writes a valid 16-bit PCM header and clamps samples', () => {
    const w = encodeWav([Float32Array.from([0, 1, -1, 2])], 8000);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.slice(8, 12))).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getInt16(50, true)).toBe(32767);
  });

  it('the iOS session loop is tiny and effectively silent', () => {
    const w = silentWav();
    expect(w.length).toBeLessThan(10_000);
    const v = new DataView(w.buffer);
    for (let o = 44; o < w.length; o += 2) expect(Math.abs(v.getInt16(o, true))).toBeLessThanOrEqual(1);
  });

  it('the soft clip is transparent below 0.9 and never exceeds 0.98', () => {
    const c = softClipCurve(0.98);
    let max = 0;
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      max = Math.max(max, Math.abs(c[i]));
      if (Math.abs(x) <= 0.9) expect(c[i]).toBeCloseTo(x, 6);
    }
    expect(max).toBeLessThanOrEqual(0.98);
  });

  it('the audio PRNG is seeded and reproducible', () => {
    const a = new AudioRng(mixSeed(3, 20)), b = new AudioRng(mixSeed(3, 20)), c = new AudioRng(mixSeed(3, 21));
    const sa = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 8 }, () => c.next())).not.toEqual(sa);
    for (const x of sa) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});
