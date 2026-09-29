/**
 * Deterministic PRNG: xoshiro128** over 32-bit state, implemented with
 * integer ops only so every JS engine produces identical streams.
 *
 * The sim owns one Prng per Prestige (build-level rolls) and derives one per
 * wave from (prestigeSeed, wave) so wave content is fixed per Prestige seed.
 */
export class Prng {
  private s0 = 0; private s1 = 0; private s2 = 0; private s3 = 0;

  constructor(seed: number | string) { this.reseed(seed); }

  reseed(seed: number | string): void {
    let h = typeof seed === 'string' ? hashString(seed) : (seed >>> 0);
    // splitmix32 to expand the seed into four non-zero words
    const next = (): number => {
      h = (h + 0x9e3779b9) | 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next(); this.s1 = next(); this.s2 = next(); this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    const s0 = this.s0, s1 = this.s1, s2 = this.s2, s3 = this.s3;
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    this.s2 = (s2 ^ s0) >>> 0;
    this.s3 = (s3 ^ s1) >>> 0;
    this.s1 = (s1 ^ this.s2) >>> 0;
    this.s0 = (s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform float in [0, 1) with 24 bits of precision (exact in float32 and float64). */
  next(): number { return (this.nextU32() >>> 8) / 16777216; }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }

  /** Uniform integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    const span = hi - lo + 1;
    if (span <= 0) return lo;
    return lo + (this.nextU32() % span);
  }

  /** True with probability p. */
  chance(p: number): boolean { return this.next() < p; }

  /** Pick a uniformly random element; undefined for an empty array. */
  pick<T>(arr: readonly T[]): T { return arr[this.int(0, arr.length - 1)]; }

  /** Weighted pick; weights need not sum to 1. */
  pickWeighted<T>(arr: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = this.next() * total;
    for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r < 0) return arr[i]; }
    return arr[arr.length - 1];
  }

  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) { const j = this.int(0, i); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }

  /** Fork a child generator deterministically from this one's stream plus a label. */
  fork(label: string | number): Prng { return new Prng(((this.nextU32() ^ hashString(String(label))) >>> 0)); }

  state(): [number, number, number, number] { return [this.s0, this.s1, this.s2, this.s3]; }
  setState(s: readonly [number, number, number, number]): void { [this.s0, this.s1, this.s2, this.s3] = s; }
}

function rotl(x: number, k: number): number { return ((x << k) | (x >>> (32 - k))) >>> 0; }

/** FNV-1a 32-bit string hash. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Combine integers into one 32-bit seed (order-sensitive). */
export function combineSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) { h ^= (p >>> 0); h = Math.imul(h, 0x01000193); h ^= h >>> 15; }
  return h >>> 0;
}

/** The PRNG that governs wave w of a Prestige with seed s (fixed wave content). */
export function waveSeed(prestigeSeed: number, wave: number): number { return combineSeed(prestigeSeed, 0x57415645, wave); }
