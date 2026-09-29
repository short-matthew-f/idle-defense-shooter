/**
 * CPU particle system. Consumes the snapshot `fx` stream ([kind, x, y, r, g, b, size, count] x N)
 * and emits instances (same 12-float format as the sim stream) into the renderer's sorted buffer.
 *
 * Everything lives in preallocated typed arrays (budget 10,000). Removal is swap-with-last.
 * Player-effect particles go to layer 2 (additive); Tell rings go to layer 7 (in-world UI, normal
 * blending) so warnings are never dimmed by the density governor.
 */
import { FxKind, Shape, FX_FLOATS } from '@sim/core/types';
import { INSTANCE_STRIDE, LAYER_OFFSET } from './layer-sort';

export const PARTICLE_BUDGET = 10000;
export const GOVERNOR_THRESHOLD = 0.7;
export const GOVERNOR_FLOOR = 0.4;

/**
 * Density governor (design §20): at or below 70% of the particle budget player effects are fully
 * opaque; above it, alpha fades linearly to 40% at 100% load. Enemies never use this.
 */
export function governorAlpha(live: number, budget: number = PARTICLE_BUDGET): number {
  const load = live / budget;
  if (load <= GOVERNOR_THRESHOLD) return 1;
  if (load >= 1) return GOVERNOR_FLOOR;
  const t = (load - GOVERNOR_THRESHOLD) / (1 - GOVERNOR_THRESHOLD);
  return 1 - t * (1 - GOVERNOR_FLOOR);
}

/**
 * Multiplier applied to the number of particles a new fx request may create. 1 up to 85% load,
 * then ramps to 0.15 at 100% so the pool degrades by thinning rather than hard-dropping bursts.
 */
export function spawnThinning(live: number, budget: number = PARTICLE_BUDGET): number {
  const load = live / budget;
  if (load <= 0.85) return 1;
  if (load >= 1) return 0.15;
  return 1 - ((load - 0.85) / 0.15) * 0.85;
}

/** Fade modes. */
const FADE_LINEAR = 0;   // a * (1 - t)
const FADE_FLASH = 1;    // a * (1 - t)^2
const FADE_PULSE = 2;    // pulsing warning ring
const FADE_HOLD = 3;     // hold, then fade over the last third

const LAYER_FX = 2;
const LAYER_UI = 7;

export class Particles {
  readonly budget: number;
  /** Live particle count. */
  count = 0;

  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly gy: Float32Array;
  private readonly drag: Float32Array;
  private readonly life: Float32Array;
  private readonly invLife: Float32Array;
  private readonly t: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly rot: Float32Array;
  private readonly vrot: Float32Array;
  private readonly cr: Float32Array;
  private readonly cg: Float32Array;
  private readonly cb: Float32Array;
  private readonly a0: Float32Array;
  private readonly aux0: Float32Array;
  private readonly ex: Float32Array; // line end offset from (x, y)
  private readonly ey: Float32Array;
  private readonly shape: Uint8Array;
  private readonly layer: Uint8Array;
  private readonly mode: Uint8Array;

  private seed = 0x9e3779b9 | 0;
  /** Scale on emission counts, set from the Clarity slider (1 = Spectacle, lower = Clarity). */
  emissionScale = 1;

  constructor(budget: number = PARTICLE_BUDGET) {
    this.budget = budget;
    const f = () => new Float32Array(budget);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f(); this.gy = f(); this.drag = f();
    this.life = f(); this.invLife = f(); this.t = f(); this.s0 = f(); this.s1 = f();
    this.rot = f(); this.vrot = f(); this.cr = f(); this.cg = f(); this.cb = f(); this.a0 = f();
    this.aux0 = f(); this.ex = f(); this.ey = f();
    this.shape = new Uint8Array(budget); this.layer = new Uint8Array(budget); this.mode = new Uint8Array(budget);
  }

  clear(): void { this.count = 0; }

  /** Live fraction of the budget. */
  get load(): number { return this.count / this.budget; }

  /** Current governor alpha for player effects. */
  get governor(): number { return governorAlpha(this.count, this.budget); }

  private rnd(): number {
    // xorshift32 -> [0,1)
    let s = this.seed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.seed = s;
    return (s >>> 0) * 2.3283064365386963e-10;
  }

  private alloc(): number {
    if (this.count >= this.budget) return -1;
    return this.count++;
  }

  /** Low-level emit. Returns the particle index or -1 when the pool is full. */
  private emit(
    shape: number, layer: number, mode: number,
    x: number, y: number, vx: number, vy: number,
    s0: number, s1: number, life: number,
    r: number, g: number, b: number, a: number,
    drag: number, gy: number, rot: number, vrot: number, aux0: number,
  ): number {
    const i = this.alloc();
    if (i < 0) return -1;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.gy[i] = gy; this.drag[i] = drag;
    this.life[i] = life; this.invLife[i] = 1 / life; this.t[i] = 0;
    this.s0[i] = s0; this.s1[i] = s1; this.rot[i] = rot; this.vrot[i] = vrot;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.a0[i] = a;
    this.aux0[i] = aux0; this.ex[i] = 0; this.ey[i] = 0;
    this.shape[i] = shape; this.layer[i] = layer; this.mode[i] = mode;
    return i;
  }

  /** Number of particles to create for a request of `n` (probabilistic rounding, thinning + clarity applied). */
  private amount(n: number, thin: number): number {
    const f = n * thin * this.emissionScale;
    const whole = f | 0;
    return whole + (this.rnd() < f - whole ? 1 : 0);
  }

  /** Consume `fxCount` requests from the snapshot fx stream. */
  consume(fx: Float32Array, fxCount: number): void {
    const thin = spawnThinning(this.count, this.budget);
    for (let i = 0, o = 0; i < fxCount; i++, o += FX_FLOATS) {
      this.spawnFx(fx[o] | 0, fx[o + 1], fx[o + 2], fx[o + 3], fx[o + 4], fx[o + 5], fx[o + 6], fx[o + 7], thin);
    }
  }

  /** Spawn one fx request (exposed for tests and the dev harness). */
  spawnFx(kind: number, x: number, y: number, r: number, g: number, b: number, size: number, count: number, thin = 1): void {
    if (!(size > 0)) size = 8;
    const TAU = 6.283185307179586;
    switch (kind) {
      case FxKind.Hit: {
        const n = this.amount(count > 0 ? count : 4, thin);
        for (let k = 0; k < n; k++) {
          const a = this.rnd() * TAU, sp = 70 + this.rnd() * 110;
          this.emit(Shape.Diamond, LAYER_FX, FADE_LINEAR, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
            1.6 + this.rnd() * 1.2, 0.5, 0.13 + this.rnd() * 0.15, r, g, b, 1, 5, 0, a, this.rnd() * 6 - 3, 0);
        }
        break;
      }
      case FxKind.Kill: {
        const n = this.amount(count > 0 ? count : 10, thin);
        for (let k = 0; k < n; k++) {
          const a = this.rnd() * TAU, sp = 60 + this.rnd() * 170;
          this.emit(Shape.Shard, LAYER_FX, FADE_LINEAR, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
            2.6 + this.rnd() * 2.4 + size * 0.05, 0.8, 0.35 + this.rnd() * 0.35, r, g, b, 0.95, 3.5, 0, a, this.rnd() * 10 - 5, 0);
        }
        if (thin > 0.5) {
          this.emit(Shape.Ring, LAYER_FX, FADE_FLASH, x, y, 0, 0, size * 0.35, size * 1.15, 0.26, r, g, b, 0.6, 0, 0, 0, 0, 0.14);
          this.emit(Shape.Circle, LAYER_FX, FADE_FLASH, x, y, 0, 0, size * 0.5, size * 0.9, 0.1, 1, 1, 1, 0.7, 0, 0, 0, 0, 0);
        }
        break;
      }
      case FxKind.Explosion: {
        this.emit(Shape.Circle, LAYER_FX, FADE_FLASH, x, y, 0, 0, size * 0.45, size * 0.85, 0.14, 1, 0.95, 0.85, 0.85, 0, 0, 0, 0, 0);
        this.emit(Shape.Ring, LAYER_FX, FADE_FLASH, x, y, 0, 0, size * 0.25, size, 0.42, r, g, b, 1, 0, 0, 0, 0, 0.1);
        const n = this.amount(count > 0 ? count : 18, thin);
        const top = Math.min(320, size * 3.5);
        for (let k = 0; k < n; k++) {
          const a = this.rnd() * TAU, sp = (0.25 + this.rnd() * 0.75) * top;
          this.emit(Shape.Circle, LAYER_FX, FADE_LINEAR, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
            2.2 + this.rnd() * 2.4, 0.4, 0.5 + this.rnd() * 0.7, r, g, b, 1, 2.6, 34, 0, 0, 0);
        }
        break;
      }
      case FxKind.Spark: {
        const n = this.amount(count > 0 ? count : 5, thin);
        for (let k = 0; k < n; k++) {
          const a = this.rnd() * TAU, sp = 150 + this.rnd() * 220;
          this.emit(Shape.Shard, LAYER_FX, FADE_LINEAR, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
            2.6 + this.rnd() * 1.6, 0.8, 0.15 + this.rnd() * 0.2, r, g, b, 1, 4, 0, a, 0, 0);
        }
        break;
      }
      case FxKind.Ember: {
        const n = this.amount(count > 0 ? count : 3, thin);
        for (let k = 0; k < n; k++) {
          this.emit(Shape.Circle, LAYER_FX, FADE_LINEAR,
            x + (this.rnd() - 0.5) * size, y + (this.rnd() - 0.5) * size,
            (this.rnd() - 0.5) * 30, -(18 + this.rnd() * 44), 2.2 + this.rnd() * 2.2, 0.4, 0.5 + this.rnd() * 0.6,
            r, g, b, 0.95, 0.6, -26, 0, 0, 0);
        }
        break;
      }
      case FxKind.Frost: {
        const n = this.amount(count > 0 ? count : 3, thin);
        for (let k = 0; k < n; k++) {
          this.emit(Shape.Star, LAYER_FX, FADE_HOLD,
            x + (this.rnd() - 0.5) * size, y + (this.rnd() - 0.5) * size,
            (this.rnd() - 0.5) * 40, 8 + this.rnd() * 26, 3.4 + this.rnd() * 1.6, 2.4, 0.7 + this.rnd() * 0.6,
            r, g, b, 0.95, 0.8, 8, this.rnd() * TAU, this.rnd() * 6 - 3, 0);
        }
        break;
      }
      case FxKind.Toxic: {
        const n = this.amount(count > 0 ? count : 3, thin);
        for (let k = 0; k < n; k++) {
          this.emit(Shape.Circle, LAYER_FX, FADE_LINEAR,
            x + (this.rnd() - 0.5) * size, y + (this.rnd() - 0.5) * size,
            (this.rnd() - 0.5) * 36, -(20 + this.rnd() * 55), 2.2 + this.rnd() * 1.4, 1.4, 0.5 + this.rnd() * 0.4,
            r, g, b, 0.9, 0.3, 170, 0, 0, 0);
        }
        break;
      }
      case FxKind.Arc: {
        // Jagged line segments starting at (x, y), total length `size`, random direction.
        const seg = count >= 2 ? Math.min(count | 0, 14) : 5;
        const a = this.rnd() * TAU;
        const dx = Math.cos(a), dy = Math.sin(a);
        const px = -dy, py = dx;
        let lx = x, ly = y;
        for (let k = 1; k <= seg; k++) {
          const along = (size * k) / seg;
          const jit = k === seg ? 0 : (this.rnd() - 0.5) * size * 0.28;
          const nx = x + dx * along + px * jit;
          const ny = y + dy * along + py * jit;
          const p = this.emit(Shape.Line, LAYER_FX, FADE_FLASH, lx, ly, 0, 0, 1.5, 1.0, 0.11 + this.rnd() * 0.07, r, g, b, 1, 0, 0, 0, 0, 0);
          if (p >= 0) { this.ex[p] = nx - lx; this.ey[p] = ny - ly; }
          lx = nx; ly = ny;
        }
        break;
      }
      case FxKind.Shockwave:
        this.emit(Shape.Ring, LAYER_FX, FADE_FLASH, x, y, 0, 0, size * 0.12, size, 0.55, r, g, b, 0.9, 0, 0, 0, 0, 0.07);
        break;
      case FxKind.Muzzle: {
        this.emit(Shape.Star, LAYER_FX, FADE_FLASH, x, y, 0, 0, size * 0.9, size * 0.3, 0.07, r, g, b, 1, 0, 0, this.rnd() * TAU, 0, 0);
        const n = this.amount(count > 0 ? count : 2, thin);
        for (let k = 0; k < n; k++) {
          const a = this.rnd() * TAU, sp = 80 + this.rnd() * 100;
          this.emit(Shape.Circle, LAYER_FX, FADE_LINEAR, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 1.6, 0.4, 0.12, r, g, b, 0.9, 6, 0, 0, 0, 0);
        }
        break;
      }
      case FxKind.Trail:
        if (thin > 0.3) this.emit(Shape.Circle, LAYER_FX, FADE_LINEAR, x, y, 0, 0, size, size * 0.2, 0.28, r, g, b, 0.5, 0, 0, 0, 0, 0);
        break;
      case FxKind.Text:
        break; // damage numbers are DOM/UI territory
      case FxKind.Counter: {
        this.emit(Shape.Ring, LAYER_FX, FADE_LINEAR, x, y, 0, 0, size * 0.25, size, 0.85, r, g, b, 1, 0, 0, 0, 0, 0.09);
        this.emit(Shape.Ring, LAYER_FX, FADE_FLASH, x, y, 0, 0, size * 0.1, size * 0.65, 0.6, 1, 1, 1, 0.8, 0, 0, 0, 0, 0.06);
        const n = this.amount(count > 0 ? count : 12, thin);
        for (let k = 0; k < n; k++) {
          const a = (k / Math.max(1, n)) * TAU, sp = size * 1.1;
          this.emit(Shape.Star, LAYER_FX, FADE_FLASH, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 5, 1.5, 0.7, r, g, b, 1, 2.5, 0, a, 3, 0);
        }
        break;
      }
      case FxKind.Tell:
        // Pulsing warning ring on the UI layer: never dimmed by the density governor.
        this.emit(Shape.Ring, LAYER_UI, FADE_PULSE, x, y, 0, 0, size, size * 0.9, 0.5, r, g, b, 0.9, 0, 0, 0, 0, 0.06);
        break;
      default:
        break;
    }
  }

  /** Advance all particles by dt seconds. Removal is swap-with-last. */
  update(dt: number): void {
    let n = this.count;
    const { x, y, vx, vy, gy, drag, life, invLife, t, rot, vrot, s0, s1, cr, cg, cb, a0, aux0, ex, ey, shape, layer, mode } = this;
    for (let i = 0; i < n; i++) {
      const l = life[i] - dt;
      if (l <= 0) {
        n--;
        if (i !== n) {
          x[i] = x[n]; y[i] = y[n]; vx[i] = vx[n]; vy[i] = vy[n]; gy[i] = gy[n]; drag[i] = drag[n];
          life[i] = life[n]; invLife[i] = invLife[n]; t[i] = t[n]; rot[i] = rot[n]; vrot[i] = vrot[n];
          s0[i] = s0[n]; s1[i] = s1[n]; cr[i] = cr[n]; cg[i] = cg[n]; cb[i] = cb[n]; a0[i] = a0[n];
          aux0[i] = aux0[n]; ex[i] = ex[n]; ey[i] = ey[n];
          shape[i] = shape[n]; layer[i] = layer[n]; mode[i] = mode[n];
        }
        i--;
        continue;
      }
      life[i] = l;
      t[i] = 1 - l * invLife[i];
      let k = 1 - drag[i] * dt;
      if (k < 0) k = 0;
      vx[i] *= k;
      vy[i] = vy[i] * k + gy[i] * dt;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      rot[i] += vrot[i] * dt;
    }
    this.count = n;
  }

  /** Add per-layer counts of the live particles into `counts` (length 8). */
  countLayers(counts: Int32Array): void {
    const layer = this.layer;
    for (let i = 0; i < this.count; i++) counts[layer[i]]++;
  }

  /** Write every live particle into `dst` at the per-layer cursors (advances them). */
  scatter(dst: Float32Array, cursors: Int32Array): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const lay = this.layer[i];
      const d = cursors[lay]++ * INSTANCE_STRIDE;
      const t = this.t[i];
      const e = 1 - (1 - t) * (1 - t); // ease-out growth
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      let a = this.a0[i];
      const inv = 1 - t;
      switch (this.mode[i]) {
        case FADE_LINEAR: a *= inv; break;
        case FADE_FLASH: a *= inv * inv; break;
        case FADE_PULSE: a *= (0.55 + 0.45 * Math.sin(t * 25)) * (t > 0.8 ? (1 - t) * 5 : 1); break;
        default: a *= inv > 0.34 ? 1 : inv * 2.94; break;
      }
      const isLine = this.shape[i] === Shape.Line;
      dst[d] = this.x[i]; dst[d + 1] = this.y[i]; dst[d + 2] = size; dst[d + 3] = this.rot[i];
      dst[d + 4] = this.shape[i]; dst[d + 5] = this.cr[i]; dst[d + 6] = this.cg[i]; dst[d + 7] = this.cb[i];
      dst[d + 8] = a; dst[d + LAYER_OFFSET] = lay;
      if (isLine) { dst[d + 10] = this.x[i] + this.ex[i]; dst[d + 11] = this.y[i] + this.ey[i]; }
      else { dst[d + 10] = this.aux0[i]; dst[d + 11] = 0; }
    }
  }
}
