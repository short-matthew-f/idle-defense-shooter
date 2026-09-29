/**
 * Counting sort of instances by layer (0..7). Pure functions over preallocated typed arrays so
 * the render path never allocates. Instances are 12 floats: layer lives at offset 9.
 */
export const INSTANCE_STRIDE = 12;
export const LAYER_COUNT = 8;
export const LAYER_OFFSET = 9;

export function clampLayer(v: number): number {
  const l = (v + 0.5) | 0;
  return l < 0 ? 0 : l > LAYER_COUNT - 1 ? LAYER_COUNT - 1 : l;
}

/** Add per-layer counts of the first `count` instances of `src` into `counts` (length 8, not cleared here). */
export function countLayers(src: Float32Array, count: number, counts: Int32Array): void {
  for (let i = 0, o = LAYER_OFFSET; i < count; i++, o += INSTANCE_STRIDE) counts[clampLayer(src[o])]++;
}

/** Exclusive prefix sum: starts[l] = first index of layer l; starts[8] = total. cursors = copy of starts[0..7]. */
export function layerStarts(counts: Int32Array, starts: Int32Array, cursors: Int32Array): number {
  let acc = 0;
  for (let l = 0; l < LAYER_COUNT; l++) { starts[l] = acc; cursors[l] = acc; acc += counts[l]; }
  starts[LAYER_COUNT] = acc;
  return acc;
}

/** Stable scatter of `count` instances into `dst` at the per-layer cursors (advances the cursors). Layer values are sanitized. */
export function scatterInstances(src: Float32Array, count: number, dst: Float32Array, cursors: Int32Array): void {
  for (let i = 0, s = 0; i < count; i++, s += INSTANCE_STRIDE) {
    const layer = clampLayer(src[s + LAYER_OFFSET]);
    const d = cursors[layer]++ * INSTANCE_STRIDE;
    dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3];
    dst[d + 4] = src[s + 4]; dst[d + 5] = src[s + 5]; dst[d + 6] = src[s + 6]; dst[d + 7] = src[s + 7];
    dst[d + 8] = src[s + 8]; dst[d + 9] = layer; dst[d + 10] = src[s + 10]; dst[d + 11] = src[s + 11];
  }
}

/**
 * Convenience: full counting sort of one source. Returns the total. `counts`, `starts` (len 9) and
 * `cursors` (len 8) are caller-owned scratch.
 */
export function countingSortByLayer(
  src: Float32Array, count: number, dst: Float32Array,
  counts: Int32Array, starts: Int32Array, cursors: Int32Array,
): number {
  counts.fill(0);
  countLayers(src, count, counts);
  const total = layerStarts(counts, starts, cursors);
  scatterInstances(src, count, dst, cursors);
  return total;
}
