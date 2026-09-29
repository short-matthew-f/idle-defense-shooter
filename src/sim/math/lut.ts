/**
 * Lookup-table trigonometry and integer-safe growth functions.
 *
 * The sim must never call Math.sin/cos/tan/atan2/exp/log/pow/random: engines
 * disagree in the last bits, and determinism across Node and browsers is an
 * acceptance test. Math.sqrt, Math.floor, Math.abs, Math.min, Math.max,
 * Math.imul, Math.hypot? (NO: hypot is not exact) — use `len` below.
 *
 * Every table is built with integer arithmetic plus a fixed Taylor series so
 * its contents are bit-identical everywhere.
 */
export const TAU = 6.283185307179586;
export const PI = 3.141592653589793;
export const HALF_PI = 1.5707963267948966;

const LUT_BITS = 14;
export const LUT_SIZE = 1 << LUT_BITS;          // 16384 entries
const LUT_MASK = LUT_SIZE - 1;
const LUT_SCALE = LUT_SIZE / TAU;

const SIN_TABLE = new Float64Array(LUT_SIZE);
(function buildSin(): void {
  // Taylor series evaluated over [-pi, pi], same op order everywhere.
  for (let i = 0; i < LUT_SIZE; i++) {
    let x = (i / LUT_SIZE) * TAU;
    if (x > PI) x -= TAU;
    const x2 = x * x;
    // sin x = x - x^3/3! + x^5/5! - ... to x^17 (error < 1e-12 on [-pi, pi])
    let term = x, sum = x;
    for (let k = 1; k <= 8; k++) { term *= -x2 / ((2 * k) * (2 * k + 1)); sum += term; }
    SIN_TABLE[i] = sum;
  }
})();

/** sin via 16384-entry table (nearest sample; ~0.0002 max error, deterministic). */
export function sin(a: number): number {
  // Math.round-free nearest-sample lookup; `& LUT_MASK` wraps negatives correctly.
  return SIN_TABLE[Math.floor(a * LUT_SCALE + 0.5) & LUT_MASK];
}
/** cos via the sin table. */
export function cos(a: number): number { return sin(a + HALF_PI); }

/** Both sin and cos at once, written into out[0]=cos, out[1]=sin. */
export function sincos(a: number, out: Float32Array | Float64Array | number[], off = 0): void {
  out[off] = cos(a); out[off + 1] = sin(a);
}

/**
 * atan2 with a deterministic polynomial approximation (max error ~1e-4 rad).
 * Good enough for aiming, angle sorting, and formation math.
 */
export function atan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  const a = ax < ay ? ax / ay : ay / ax;    // in [0,1]
  const s = a * a;
  // Degree-11 minimax polynomial for atan on [0,1] (max err ~1e-6)
  let r = ((((( 0.0028662257 * s - 0.0161657367) * s + 0.0429096138) * s - 0.0752896400) * s + 0.1065626393) * s - 0.1420889944) * s;
  r = ((r + 0.1999355085) * s - 0.3333314528) * s * a + a;
  if (ay > ax) r = HALF_PI - r;
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}

/** Wrap an angle into [0, TAU). */
export function wrapAngle(a: number): number { a = a % TAU; return a < 0 ? a + TAU : a; }
/** Signed shortest difference b - a in (-PI, PI]. */
export function angleDiff(a: number, b: number): number { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d <= -PI) d += TAU; return d; }

/** Euclidean length; Math.sqrt is IEEE-exact so this is deterministic. */
export function len(x: number, y: number): number { return Math.sqrt(x * x + y * y); }
export function dist(ax: number, ay: number, bx: number, by: number): number { const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
export function dist2(ax: number, ay: number, bx: number, by: number): number { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }

export function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/**
 * base^n for integer n via exponentiation by squaring (deterministic).
 * Negative n gives 1/(base^-n).
 */
export function ipow(base: number, n: number): number {
  n = n | 0;
  let neg = false;
  if (n < 0) { neg = true; n = -n; }
  let result = 1, b = base;
  while (n > 0) { if (n & 1) result *= b; b *= b; n >>= 1; }
  return neg ? 1 / result : result;
}

/**
 * Cached geometric growth: growth(g, n) === g^n, memoized per growth factor.
 * Use this for all economy curves (1.13^w, 1.11^w, 1.15^r, 1.2^(D-20) ...).
 */
const growthCache = new Map<number, Float64Array>();
/** Largest exponent served from the table; beyond it growth() uses ipow (never reached in play). */
export const GROWTH_TABLE_MAX = 1 << 16;
export function growth(g: number, n: number): number {
  if (!(n > -GROWTH_TABLE_MAX && n < GROWTH_TABLE_MAX)) {
    // huge / non-finite n (e.g. ranks from a corrupted save): `n | 0` would wrap and allocate a table of
    // up to 2^31 entries. Keep the old NaN → 1 behaviour and compute large powers directly.
    if (Number.isNaN(n)) return 1;
    if (!Number.isFinite(n)) return n > 0 ? (g > 1 ? Infinity : g === 1 ? 1 : 0) : (g > 1 ? 0 : g === 1 ? 1 : Infinity);
    return ipow(g, Math.trunc(n) > 0 ? Math.min(Math.trunc(n), 0x7fffffff) : Math.max(Math.trunc(n), -0x7fffffff));
  }
  n = n | 0;
  if (n < 0) return 1 / growth(g, -n);
  let table = growthCache.get(g);
  if (!table || table.length <= n) {
    const size = Math.max(256, n + 64, table ? table.length * 2 : 0);
    const t = new Float64Array(size);
    t[0] = 1;
    for (let i = 1; i < size; i++) t[i] = t[i - 1] * g;
    growthCache.set(g, t);
    table = t;
  }
  return table[n];
}

/** Deterministic exp(x) via range reduction + series; for the rare continuous curve. */
export function exp(x: number): number {
  if (x > 700) return Infinity;
  if (x < -700) return 0;
  const k = Math.floor(x / 0.6931471805599453);
  const r = x - k * 0.6931471805599453;     // r in [0, ln2)
  let term = 1, sum = 1;
  for (let i = 1; i <= 16; i++) { term *= r / i; sum += term; }
  return sum * ipow(2, k);
}

/** Deterministic natural log for x > 0 (Newton on exp; ~1e-12). */
export function log(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  let e = 0; let m = x;
  while (m >= 2) { m *= 0.5; e++; }
  while (m < 1) { m *= 2; e--; }
  // ln(m) for m in [1,2) via atanh series: ln m = 2*atanh((m-1)/(m+1))
  const z = (m - 1) / (m + 1), z2 = z * z;
  let term = z, sum = z;
  for (let i = 1; i <= 12; i++) { term *= z2; sum += term / (2 * i + 1); }
  return 2 * sum + e * 0.6931471805599453;
}

/** Deterministic real power for non-integer exponents (rare; prefer growth/ipow). */
export function pow(base: number, p: number): number {
  if (p === (p | 0)) return ipow(base, p);
  if (base <= 0) return base === 0 ? 0 : NaN;
  return exp(p * log(base));
}
