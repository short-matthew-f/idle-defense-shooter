import { describe, expect, it } from 'vitest';
import { clampLayer, countingSortByLayer, INSTANCE_STRIDE, LAYER_COUNT } from '../../src/render/layer-sort';

function makeSrc(layers: number[]): Float32Array {
  const a = new Float32Array(layers.length * INSTANCE_STRIDE);
  layers.forEach((l, i) => {
    a[i * INSTANCE_STRIDE] = i; // x doubles as original index
    a[i * INSTANCE_STRIDE + 9] = l;
    a[i * INSTANCE_STRIDE + 11] = i * 2;
  });
  return a;
}

function sortIt(layers: number[]) {
  const src = makeSrc(layers);
  const dst = new Float32Array(src.length);
  const counts = new Int32Array(LAYER_COUNT);
  const starts = new Int32Array(LAYER_COUNT + 1);
  const cursors = new Int32Array(LAYER_COUNT);
  const total = countingSortByLayer(src, layers.length, dst, counts, starts, cursors);
  return { dst, counts, starts, total };
}

describe('counting sort by layer', () => {
  it('orders instances by ascending layer', () => {
    const layers = [4, 0, 7, 3, 4, 1, 6, 2, 5, 0, 4];
    const { dst, total } = sortIt(layers);
    expect(total).toBe(layers.length);
    let prev = -1;
    for (let i = 0; i < total; i++) {
      const l = dst[i * INSTANCE_STRIDE + 9];
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('is stable within a layer and preserves every field', () => {
    const layers = [4, 4, 0, 4, 0];
    const { dst } = sortIt(layers);
    const order = Array.from({ length: layers.length }, (_, i) => dst[i * INSTANCE_STRIDE]);
    expect(order).toEqual([2, 4, 0, 1, 3]);
    for (let i = 0; i < layers.length; i++) {
      const orig = dst[i * INSTANCE_STRIDE];
      expect(dst[i * INSTANCE_STRIDE + 11]).toBe(orig * 2);
    }
  });

  it('computes layer start offsets for draw ranges', () => {
    const layers = [0, 0, 1, 3, 3, 3, 4, 4, 7];
    const { starts } = sortIt(layers);
    expect(Array.from(starts)).toEqual([0, 2, 3, 3, 6, 8, 8, 8, 9]);
    // layers 1-3 form one contiguous additive range, 4-7 another
    expect(starts[4] - starts[1]).toBe(4);
    expect(starts[8] - starts[4]).toBe(3);
  });

  it('clamps out-of-range and fractional layers and writes the sanitized layer', () => {
    expect(clampLayer(-3)).toBe(0);
    expect(clampLayer(99)).toBe(7);
    expect(clampLayer(3.9999)).toBe(4);
    const { dst, counts } = sortIt([9, -1, 2.0000001]);
    expect(counts[0]).toBe(1);
    expect(counts[2]).toBe(1);
    expect(counts[7]).toBe(1);
    expect(dst[0 * INSTANCE_STRIDE + 9]).toBe(0);
    expect(dst[2 * INSTANCE_STRIDE + 9]).toBe(7);
  });

  it('handles empty input', () => {
    const { total, starts } = sortIt([]);
    expect(total).toBe(0);
    expect(Array.from(starts).every((s) => s === 0)).toBe(true);
  });

  it('only reads `count` instances of a larger buffer', () => {
    const src = makeSrc([3, 1, 2, 0]);
    const dst = new Float32Array(src.length);
    const counts = new Int32Array(LAYER_COUNT), starts = new Int32Array(LAYER_COUNT + 1), cursors = new Int32Array(LAYER_COUNT);
    const total = countingSortByLayer(src, 2, dst, counts, starts, cursors);
    expect(total).toBe(2);
    expect(dst[0 * INSTANCE_STRIDE]).toBe(1);
    expect(dst[1 * INSTANCE_STRIDE]).toBe(0);
  });
});
