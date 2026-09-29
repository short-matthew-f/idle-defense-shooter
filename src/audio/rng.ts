/**
 * The audio module's own small seeded PRNG (mulberry32). Music is generated from it so a render is
 * reproducible from (prestige seed, wave); it never touches the sim's PRNG or Math.random.
 */
export class AudioRng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 0x9e3779b9; }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p: number): boolean { return this.next() < p; }
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.next() * list.length)]; }
  /** Index drawn with the given (non-negative) weights. */
  weighted(weights: readonly number[]): number {
    let sum = 0;
    for (const w of weights) sum += w;
    let r = this.next() * sum;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
    return weights.length - 1;
  }
  get state(): number { return this.s; }
}

/** Mix two integers into one 32-bit seed (FNV-style). */
export function mixSeed(a: number, b: number): number {
  let h = 0x811c9dc5;
  for (const v of [a | 0, b | 0]) {
    for (let k = 0; k < 4; k++) h = Math.imul(h ^ ((v >>> (8 * k)) & 0xff), 0x01000193);
  }
  return h >>> 0;
}
