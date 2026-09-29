import { describe, expect, it } from 'vitest';
import { FX_FLOATS, FxKind, Shape } from '../../src/sim/core/types';
import { GOVERNOR_FLOOR, GOVERNOR_THRESHOLD, governorAlpha, Particles, PARTICLE_BUDGET, spawnThinning } from '../../src/render/particles';
import { INSTANCE_STRIDE, LAYER_COUNT } from '../../src/render/layer-sort';

describe('density governor', () => {
  it('leaves player effects fully opaque up to 70% of budget', () => {
    expect(governorAlpha(0)).toBe(1);
    expect(governorAlpha(PARTICLE_BUDGET * GOVERNOR_THRESHOLD)).toBe(1);
  });

  it('fades linearly toward 40% at the budget', () => {
    expect(governorAlpha(PARTICLE_BUDGET)).toBeCloseTo(GOVERNOR_FLOOR, 9);
    expect(governorAlpha(PARTICLE_BUDGET * 2)).toBeCloseTo(GOVERNOR_FLOOR, 9);
    const mid = governorAlpha(PARTICLE_BUDGET * 0.85);
    expect(mid).toBeCloseTo((1 + GOVERNOR_FLOOR) / 2, 6);
  });

  it('is monotonically non-increasing', () => {
    let prev = 2;
    for (let n = 0; n <= PARTICLE_BUDGET; n += 250) {
      const a = governorAlpha(n);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });

  it('thins new spawns only near the cap', () => {
    expect(spawnThinning(PARTICLE_BUDGET * 0.8)).toBe(1);
    expect(spawnThinning(PARTICLE_BUDGET)).toBeCloseTo(0.15, 9);
    expect(spawnThinning(PARTICLE_BUDGET * 0.95)).toBeLessThan(1);
  });
});

function fx(rows: number[][]): Float32Array {
  const a = new Float32Array(rows.length * FX_FLOATS);
  rows.forEach((r, i) => a.set(r, i * FX_FLOATS));
  return a;
}

describe('Particles', () => {
  it('never exceeds its budget', () => {
    const p = new Particles(500);
    const rows: number[][] = [];
    for (let i = 0; i < 400; i++) rows.push([FxKind.Explosion, 0, 0, 1, 0.5, 0, 60, 40]);
    p.consume(fx(rows), rows.length);
    expect(p.count).toBeLessThanOrEqual(500);
    expect(p.count).toBeGreaterThan(400);
  });

  it('emits particles for every non-text kind and none for Text', () => {
    for (let kind = 0; kind <= FxKind.Tell; kind++) {
      const p = new Particles(2000);
      p.consume(fx([[kind, 10, 20, 1, 1, 1, 30, 6]]), 1);
      if (kind === FxKind.Text) expect(p.count).toBe(0);
      else expect(p.count, `kind ${kind}`).toBeGreaterThan(0);
    }
  });

  it('expires particles and compacts (swap-with-last)', () => {
    const p = new Particles(1000);
    p.consume(fx([[FxKind.Hit, 0, 0, 1, 1, 1, 8, 10], [FxKind.Explosion, 0, 0, 1, 1, 1, 60, 30]]), 2);
    const start = p.count;
    expect(start).toBeGreaterThan(20);
    p.update(0.5); // short-lived ones die
    expect(p.count).toBeLessThan(start);
    for (let i = 0; i < 10; i++) p.update(0.5);
    expect(p.count).toBe(0);
  });

  it('scatter writes valid instances at the per-layer cursors', () => {
    const p = new Particles(2000);
    p.consume(fx([[FxKind.Kill, 5, 5, 1, 0.5, 0.2, 10, 8], [FxKind.Tell, 0, 0, 1, 0, 0, 80, 1], [FxKind.Arc, 0, 0, 1, 1, 0, 90, 6]]), 3);
    p.update(0.016);
    const counts = new Int32Array(LAYER_COUNT);
    p.countLayers(counts);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(p.count);
    expect(counts[2]).toBeGreaterThan(0);
    expect(counts[7]).toBe(1); // Tell rings live on the UI layer so the governor never dims them
    const cursors = new Int32Array(LAYER_COUNT);
    let acc = 0;
    for (let l = 0; l < LAYER_COUNT; l++) { cursors[l] = acc; acc += counts[l]; }
    const dst = new Float32Array(p.count * INSTANCE_STRIDE);
    p.scatter(dst, cursors);
    for (let i = 0; i < p.count; i++) {
      const o = i * INSTANCE_STRIDE;
      const layer = dst[o + 9];
      expect(layer === 2 || layer === 7).toBe(true);
      expect(dst[o + 4]).toBeGreaterThanOrEqual(0);
      expect(dst[o + 4]).toBeLessThanOrEqual(Shape.Crescent);
      expect(dst[o + 8]).toBeGreaterThanOrEqual(0);
      expect(dst[o + 8]).toBeLessThanOrEqual(1);
      expect(dst[o + 2]).toBeGreaterThan(0);
      for (let k = 0; k < INSTANCE_STRIDE; k++) expect(Number.isFinite(dst[o + k])).toBe(true);
    }
    // cursors advanced to the ends of their ranges
    expect(cursors[2]).toBe(counts[2]);
    expect(cursors[7]).toBe(counts[2] + counts[7] + 0);
  });

  it('Arc emits Line segments with an end point (aux0/aux1) away from the start', () => {
    const p = new Particles(100);
    p.consume(fx([[FxKind.Arc, 0, 0, 1, 1, 1, 100, 5]]), 1);
    const counts = new Int32Array(LAYER_COUNT);
    p.countLayers(counts);
    const cursors = new Int32Array(LAYER_COUNT);
    cursors[2] = 0;
    const dst = new Float32Array(p.count * INSTANCE_STRIDE);
    p.scatter(dst, cursors);
    let total = 0;
    for (let i = 0; i < p.count; i++) {
      const o = i * INSTANCE_STRIDE;
      expect(dst[o + 4]).toBe(Shape.Line);
      total += Math.hypot(dst[o + 10] - dst[o], dst[o + 11] - dst[o + 1]);
    }
    expect(p.count).toBe(5);
    expect(total).toBeGreaterThan(90); // jagged path is at least as long as the straight length
  });

  it('is deterministic for a given input sequence', () => {
    const run = () => {
      const p = new Particles(3000);
      const rows: number[][] = [];
      for (let k = 0; k <= FxKind.Tell; k++) rows.push([k, k * 3, k * 5, 1, 1, 1, 30, 8]);
      p.consume(fx(rows), rows.length);
      for (let i = 0; i < 20; i++) p.update(1 / 60);
      const counts = new Int32Array(LAYER_COUNT);
      p.countLayers(counts);
      const cursors = new Int32Array(LAYER_COUNT);
      let acc = 0;
      for (let l = 0; l < LAYER_COUNT; l++) { cursors[l] = acc; acc += counts[l]; }
      const dst = new Float32Array(p.count * INSTANCE_STRIDE);
      p.scatter(dst, cursors);
      return Array.from(dst);
    };
    expect(run()).toEqual(run());
  });

  it('clarity (emissionScale) reduces emission', () => {
    const a = new Particles(5000), b = new Particles(5000);
    b.emissionScale = 0.35;
    const rows = Array.from({ length: 20 }, () => [FxKind.Kill, 0, 0, 1, 1, 1, 10, 20]);
    a.consume(fx(rows), rows.length);
    b.consume(fx(rows), rows.length);
    expect(b.count).toBeLessThan(a.count);
  });

  it('the governor reads the live count', () => {
    const p = new Particles(100);
    const rows = Array.from({ length: 30 }, () => [FxKind.Explosion, 0, 0, 1, 1, 1, 60, 40]);
    p.consume(fx(rows), rows.length);
    expect(p.governor).toBeLessThan(1);
    expect(p.governor).toBeGreaterThanOrEqual(GOVERNOR_FLOOR);
  });
});
