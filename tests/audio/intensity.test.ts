import { describe, expect, it } from 'vitest';
import { crowd, layersFor, smoothToward, targetIntensity, tensionFor, waveDepth, type MusicInput } from '../../src/audio/intensity';

const base: MusicInput = { wave: 1, phase: 'combat', enemiesAlive: 8, isBoss: false, bossPhase: 0, hp: 1 };
const at = (m: Partial<MusicInput>): number => targetIntensity({ ...base, ...m });

describe('audio intensity mapping', () => {
  it('wave 1 is nearly ambient: only the pad plays', () => {
    const i = at({});
    expect(i).toBeLessThan(0.2);
    const L = layersFor(i, false, 0);
    expect(L.pad).toBeGreaterThan(0.5);
    expect(L.perc).toBe(0);
    expect(L.lead).toBe(0);
    expect(L.pulse).toBe(0);
    expect(L.bass).toBeLessThan(0.3);
  });

  it('enemies alive and wave depth raise intensity; bosses lift it; between waves settles; death is silent', () => {
    expect(at({ enemiesAlive: 200 })).toBeGreaterThan(at({ enemiesAlive: 8 }));
    expect(at({ wave: 19 })).toBeGreaterThan(at({ wave: 2 }));
    expect(at({ wave: 90 })).toBeGreaterThan(at({ wave: 30 }));
    expect(at({ wave: 20, isBoss: true })).toBeGreaterThan(at({ wave: 20 }));
    expect(at({ wave: 50, phase: 'between' })).toBeLessThan(at({ wave: 50 }));
    expect(at({ wave: 50, phase: 'dead' })).toBe(0);
    expect(at({ wave: 100, isBoss: true, enemiesAlive: 1500 })).toBeLessThanOrEqual(1);
    expect(at({ wave: 100, isBoss: true, enemiesAlive: 1500 })).toBeGreaterThan(0.85);
  });

  it('wave depth and crowd are bounded, monotonic curves', () => {
    for (let w = 1; w < 20; w++) expect(waveDepth(w + 1)).toBeGreaterThan(waveDepth(w));
    expect(waveDepth(1)).toBe(0);
    expect(waveDepth(500)).toBeLessThanOrEqual(1);
    expect(crowd(0)).toBe(0);
    expect(crowd(20)).toBeGreaterThan(0.45);
    expect(crowd(20)).toBeLessThan(0.6);
    expect(crowd(5000)).toBe(1);
  });

  it('low tower HP maps to tension only in combat', () => {
    expect(tensionFor({ ...base, hp: 0.9 })).toBe(0);
    expect(tensionFor({ ...base, hp: 0.3 })).toBeGreaterThan(0.3);
    expect(tensionFor({ ...base, hp: 0.05 })).toBe(1);
    expect(tensionFor({ ...base, hp: 0.05, phase: 'between' })).toBe(0);
  });

  it('layers enter in order as intensity rises and never decrease', () => {
    const keys = ['pad', 'bass', 'pulse', 'perc', 'lead', 'hats16'] as const;
    let prev = layersFor(0, false, 0);
    for (let i = 0.02; i <= 1.0001; i += 0.02) {
      const L = layersFor(i, false, 0);
      for (const k of keys) expect(L[k]).toBeGreaterThanOrEqual(prev[k] - 1e-12);
      prev = L;
    }
    // first-entry order
    const first = (k: (typeof keys)[number]): number => { for (let i = 0; i <= 1; i += 0.01) if (layersFor(i, false, 0)[k] > 0.05) return i; return 2; };
    expect(first('bass')).toBeLessThan(first('pulse'));
    expect(first('pulse')).toBeLessThan(first('perc'));
    expect(first('perc')).toBeLessThan(first('lead'));
    expect(first('lead')).toBeLessThan(first('hats16'));
    expect(layersFor(0.8, true, 0).boss).toBeGreaterThan(0.9);
    expect(layersFor(0.8, false, 0).boss).toBe(0);
  });

  it('smoothing rises faster than it falls and converges', () => {
    const up = smoothToward(0, 1, 1), down = 1 - smoothToward(1, 0, 1);
    expect(up).toBeGreaterThan(down);
    let v = 0;
    for (let t = 0; t < 40; t += 0.1) v = smoothToward(v, 0.7, 0.1);
    expect(v).toBeCloseTo(0.7, 3);
  });
});
