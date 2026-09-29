/**
 * The renderer's CPU frame (graphics pass), kept free of GL so it can be unit tested and benchmarked:
 *   cue fx (punch / shake / slow-mo) → visual time → particles (consume + update) → count, filter,
 *   animate and counting-sort every instance by layer into one buffer ready for a single upload.
 *
 * Instance flags (types.ts InstFlag, packed into the layer float) are decoded here:
 *   Detail parts are dropped at the Low tier and above the tier's enemy count (renderer LOD);
 *   Chain lines are dropped when Settings → Graphics → Chain lines is off, and capped per tier;
 *   Part instances follow their body: the body's idle animation (scale / rotation) and its minimum
 *   on-screen size are applied around the body centre, so composites stay proportioned on phones.
 * Unflagged layer-4/5/6 instances (bodies, outlines, halos) get their idle animation from the packed aux1.
 * The sorted buffer keeps the flags in the layer float for the shader.
 */
import { AnimKind, AnimRate, FX_FLOATS, FxKind, INST_FLAG_SCALE, InstFlag, type RenderSnapshot } from '@sim/core/types';
import { INSTANCE_STRIDE, LAYER_COUNT, LAYER_OFFSET, countLayers, layerStarts, scatterInstances } from './layer-sort';
import { Particles, PARTICLE_BUDGET } from './particles';
import { Juice } from './juice';
import { motionScales, type MotionScales } from './quality';

const TAU = 6.283185307179586;
/** Composite parts fade out between these on-screen radii (CSS px). */
export const PART_FADE_FROM_PX = 0.9;
export const PART_FADE_TO_PX = 1.8;
const RATE: readonly number[] = [1, 0.45, 0, 1.9];

/** Idle animation for a packed aux1 at visual time `time`: writes [scale, rotation offset] into `out`. */
export function idleAnim(packed: number, time: number, motion: number, out: Float64Array | number[]): void {
  out[0] = 1; out[1] = 0;
  const kind = (packed >> 14) & 15;
  if (kind === AnimKind.None || motion <= 0) return;
  const rm = RATE[(packed >> 18) & 3];
  if (rm === 0) return;
  const ph = ((packed >> 8) & 63) * (TAU / 64);
  const t = time * rm;
  let s = 1, r = 0;
  switch (kind) {
    case AnimKind.Breathe: s = 1 + 0.05 * Math.sin(TAU * 0.8 * t + ph); break;
    case AnimKind.Wobble: r = 0.14 * Math.sin(TAU * 1.3 * t + ph); s = 1 + 0.03 * Math.sin(TAU * 1.3 * t + ph + 1.3); break;
    case AnimKind.Spin: r = (ph < Math.PI ? 1.8 : -1.8) * t; break;
    case AnimKind.Jitter: r = 0.35 * Math.sin(TAU * 2.2 * t + ph); s = 1 + 0.07 * Math.sin(TAU * 2.7 * t + 2 * ph); break;
    case AnimKind.Heavy: s = 1 + 0.03 * Math.sin(TAU * 0.45 * t + ph); r = 0.04 * Math.sin(TAU * 0.45 * t + ph + 1.57); break;
    case AnimKind.Pulse: { const q = Math.sin(TAU * 0.9 * t + ph); s = q > 0 ? 1 + 0.08 * q * q : 1; break; }
    case AnimKind.Sway: r = 0.22 * Math.sin(TAU * 0.6 * t + ph); break;
    case AnimKind.SlowSpin: r = (ph < Math.PI ? 0.5 : -0.5) * t; s = 1 + 0.03 * Math.sin(TAU * 0.7 * t + ph); break;
    default: return;
  }
  if (r > 1e4 || r < -1e4) r %= TAU;
  out[0] = 1 + (s - 1) * motion;
  out[1] = r * motion;
}
/** Is the packed aux1's AnimRate Frozen (for tests)? */
export function isFrozenRate(packed: number): boolean { return ((packed >> 18) & 3) === AnimRate.Frozen; }

export interface FrameOptions {
  /** Idle-animation amplitude / cue scales (quality.ts motionScales). */
  motion: MotionScales;
  /** Minimum on-screen enemy body radius, world units (same value the vertex shader uses). */
  minR: number;
  /** CSS px per world unit (0 = unknown: no size fade). Parts under ~2 px on screen fade out (a 1 px part is just a smudge). */
  pxPerUnit: number;
  detail: boolean;
  detailMaxEnemies: number;
  chains: boolean;
  chainMax: number;
  particleScale: number;
  clarity: number;
}

export const DEFAULT_FRAME_OPTIONS: FrameOptions = {
  motion: motionScales(false, true), minR: 0, pxPerUnit: 0, detail: true, detailMaxEnemies: 600, chains: true, chainMax: 64, particleScale: 1, clarity: 0,
};

export class FramePrep {
  readonly particles: Particles;
  readonly juice = new Juice();
  /** Visual time (seconds): slowed by slow-mo, frozen when dt = 0. */
  time = 0;
  sorted = new Float32Array(0);
  readonly counts = new Int32Array(LAYER_COUNT);
  readonly starts = new Int32Array(LAYER_COUNT + 1);
  readonly cursors = new Int32Array(LAYER_COUNT);
  /** Stats of the last frame. */
  enemies = 0; partsDrawn = 0; partsDropped = 0; chainsDrawn = 0; total = 0;
  private lastFxTick = -1;
  private readonly anim = new Float64Array(2);
  private detailNow = true;
  private chainsLeft = 0;
  private overlay: Float32Array = new Float32Array(0);
  private overlayCount = 0;

  constructor(budget = PARTICLE_BUDGET) { this.particles = new Particles(budget); }

  setOverlay(buf: Float32Array, count: number): void { this.overlay = buf; this.overlayCount = count; }

  /** Run the CPU side of one frame. Returns the instance total in `sorted`. `dt` in real seconds. */
  frame(snap: RenderSnapshot, dt: number, o: FrameOptions): number {
    const parts = this.particles;
    const newFx = snap.tick !== this.lastFxTick;
    if (newFx) {
      // cues first: they are not particles
      const fx = snap.fx;
      for (let i = 0, off = 0; i < snap.fxCount; i++, off += FX_FLOATS) {
        const k = fx[off] | 0;
        if (k >= FxKind.Punch && k <= FxKind.SlowMo) this.juice.cue(k, fx[off + 6], fx[off + 3], fx[off + 4], fx[off + 5], o.motion);
      }
    }
    const ts = dt > 0 ? this.juice.update(dt) : this.juice.timeScale;
    const vdt = dt * ts;
    this.time += vdt;
    parts.emissionScale = (1 - 0.65 * o.clarity) * o.particleScale;
    parts.flashScale = o.motion.flash;
    if (newFx) { this.lastFxTick = snap.tick; parts.consume(snap.fx, snap.fxCount); }
    parts.update(vdt);

    // detail LOD from last frame's enemy count (one frame of lag keeps this a single pass)
    this.detailNow = o.detail && this.enemies <= o.detailMaxEnemies;
    const n = snap.instanceCount;
    const on = this.overlayCount;
    const counts = this.counts;
    counts.fill(0);
    this.chainsLeft = o.chains ? o.chainMax : 0;
    const kept = this.countSnapshot(snap.instances, n, counts);
    parts.countLayers(counts);
    if (on) countLayers(this.overlay, on, counts);
    const total = kept + parts.count + on;
    if (this.sorted.length < total * INSTANCE_STRIDE) this.sorted = new Float32Array(Math.max(total + 1024, (this.sorted.length / INSTANCE_STRIDE) * 1.5 | 0) * INSTANCE_STRIDE);
    layerStarts(counts, this.starts, this.cursors);
    this.chainsLeft = o.chains ? o.chainMax : 0;
    this.scatterSnapshot(snap.instances, n, o);
    parts.scatter(this.sorted, this.cursors);
    if (on) scatterInstances(this.overlay, on, this.sorted, this.cursors);
    this.total = total;
    return total;
  }

  /** Keep this instance? (identical decisions in the count and scatter passes) */
  private keep(flags: number): boolean {
    if ((flags & InstFlag.Detail) && !this.detailNow) return false;
    if (flags & InstFlag.Chain) { if (this.chainsLeft <= 0) return false; this.chainsLeft--; }
    return true;
  }

  private countSnapshot(src: Float32Array, n: number, counts: Int32Array): number {
    let kept = 0, enemies = 0, dropped = 0;
    for (let i = 0, o = LAYER_OFFSET; i < n; i++, o += INSTANCE_STRIDE) {
      const lf = src[o];
      if (lf < INST_FLAG_SCALE) {
        const l = lf < 0 ? 0 : (lf + 0.5) | 0;
        if (l === 4) enemies++;
        counts[l > 7 ? 7 : l]++; kept++;
        continue;
      }
      const L = (lf + 0.5) | 0;
      if (!this.keep(L >> 3)) { dropped++; continue; }
      counts[L & 7]++; kept++;
    }
    this.enemies = enemies;
    this.partsDropped = dropped;
    return kept;
  }

  private scatterSnapshot(src: Float32Array, n: number, o: FrameOptions): void {
    const dst = this.sorted, cursors = this.cursors, a = this.anim;
    const motion = o.motion.idle, time = this.time, minR = o.minR, ppu = o.pxPerUnit;
    let lastBody = -1, bS = 1, bR = 0, bC = 1, bSn = 0, bx = 0, by = 0;
    let parts = 0, chains = 0;
    for (let i = 0, s = 0; i < n; i++, s += INSTANCE_STRIDE) {
      const lf = src[s + LAYER_OFFSET];
      let layer: number, flags = 0;
      if (lf < INST_FLAG_SCALE) { layer = lf < 0 ? 0 : (lf + 0.5) | 0; if (layer > 7) layer = 7; }
      else {
        const L = (lf + 0.5) | 0;
        flags = L >> 3;
        if (!this.keep(flags)) continue;
        layer = L & 7;
      }
      const d = cursors[layer]++ * INSTANCE_STRIDE;
      let x = src[s], y = src[s + 1], r = src[s + 2], rot = src[s + 3], alphaMul = 1;
      if (flags === 0) {
        if (layer >= 4 && layer <= 6 && motion > 0) {
          idleAnim(src[s + 11] | 0, time, motion, a);
          r *= a[0]; rot += a[1];
        }
      } else if (flags & InstFlag.Part) {
        const b = src[s + 11] | 0;
        if (b !== lastBody) {
          lastBody = b;
          const bo = b * INSTANCE_STRIDE;
          if (b >= 0 && b < n) {
            bx = src[bo]; by = src[bo + 1];
            idleAnim(src[bo + 11] | 0, time, motion, a);
            const rb = src[bo + 2] * a[0];
            const k = rb > 0 && rb < minR ? minR / rb : 1;
            bS = a[0] * k; bR = a[1]; bC = Math.cos(bR); bSn = Math.sin(bR);
          } else { bx = x; by = y; bS = 1; bR = 0; bC = 1; bSn = 0; }
        }
        const ox = x - bx, oy = y - by;
        x = bx + (ox * bC - oy * bSn) * bS;
        y = by + (ox * bSn + oy * bC) * bS;
        r *= bS; rot += bR;
        parts++;
        if (ppu > 0) {
          const rpx = r * ppu;
          if (rpx < PART_FADE_TO_PX) { const f = rpx <= PART_FADE_FROM_PX ? 0 : (rpx - PART_FADE_FROM_PX) / (PART_FADE_TO_PX - PART_FADE_FROM_PX); alphaMul = f; }
        }
      } else if (flags & InstFlag.Chain) chains++;
      dst[d] = x; dst[d + 1] = y; dst[d + 2] = r; dst[d + 3] = rot;
      dst[d + 4] = src[s + 4]; dst[d + 5] = src[s + 5]; dst[d + 6] = src[s + 6]; dst[d + 7] = src[s + 7];
      dst[d + 8] = src[s + 8] * alphaMul; dst[d + 9] = flags === 0 ? layer : layer + INST_FLAG_SCALE * flags;
      dst[d + 10] = src[s + 10]; dst[d + 11] = src[s + 11];
    }
    this.partsDrawn = parts;
    this.chainsDrawn = chains;
  }
}
