/**
 * Graphics settings and quality tiers (graphics pass). Pure logic plus a tiny persisted store
 * (localStorage key `citadel.gfx.v1`, fail-safe) that the Renderer reads and Settings → Graphics writes.
 *
 * Tiers (docs/GRAPHICS.md):
 *   high    DPR ≤ 2, bloom, composite silhouettes up to 600 enemies (the snapshot's own LOD), full ambience,
 *           all particles, 64 chain lines
 *   medium  DPR ≤ 1.5, bloom, composites up to 350 enemies, simple ambience, 75% particles, 40 chain lines
 *   low     DPR ≤ 1, no bloom, base shapes only, grid without sweep or motes, 50% particles, 24 chain lines
 * Auto-degrade: when the mean rAF delta over a 2 s window stays above 22 ms (under ~45 fps), drop one tier
 * for the session (never below Low, never above the chosen tier; 4 s settle time between steps).
 */

export type QualityTier = 'low' | 'medium' | 'high';
export type MotionPref = 'system' | 'reduce' | 'full';

export interface GfxSettings {
  quality: QualityTier;
  /** Let the renderer lower the tier for this session when frames run long. */
  auto: boolean;
  chainLines: boolean;
  motion: MotionPref;
  screenShake: boolean;
}

export interface TierSpec {
  maxDpr: number;
  bloom: boolean;
  /** Composite parts drawn at all. */
  detail: boolean;
  /** Renderer-side LOD: composite parts drop above this many enemies. */
  detailMaxEnemies: number;
  particleScale: number;
  /** Backdrop ambience: 0 grid only, 1 grid + sweep, 2 grid + sweep + drifting parallax motes. */
  ambience: number;
  chainMax: number;
}

export const TIERS: Readonly<Record<QualityTier, Readonly<TierSpec>>> = {
  high: { maxDpr: 2, bloom: true, detail: true, detailMaxEnemies: 600, particleScale: 1, ambience: 2, chainMax: 64 },
  medium: { maxDpr: 1.5, bloom: true, detail: true, detailMaxEnemies: 350, particleScale: 0.75, ambience: 1, chainMax: 40 },
  low: { maxDpr: 1, bloom: false, detail: false, detailMaxEnemies: 0, particleScale: 0.5, ambience: 0, chainMax: 24 },
};
export const TIER_ORDER: readonly QualityTier[] = ['low', 'medium', 'high'];

export const GFX_DEFAULTS: Readonly<GfxSettings> = { quality: 'high', auto: true, chainLines: true, motion: 'system', screenShake: true };
export const GFX_KEY = 'citadel.gfx.v1';

/** Resolve reduced motion from the setting and the OS preference. */
export function reducedMotion(pref: MotionPref, systemReduce: boolean): boolean {
  return pref === 'reduce' || (pref === 'system' && systemReduce);
}

/**
 * Presentation scalars for a motion preference: idle animation amplitude, camera shake / punch,
 * vignette pulse, slow-mo, and the cap on bright flashes.
 */
export interface MotionScales { idle: number; shake: number; punch: number; vignette: number; slowmo: boolean; flash: number }
export function motionScales(reduced: boolean, shakeOn: boolean): MotionScales {
  return reduced
    ? { idle: 0, shake: 0, punch: 0, vignette: 0.35, slowmo: false, flash: 0.45 }
    : { idle: 1, shake: shakeOn ? 1 : 0, punch: 1, vignette: 1, slowmo: true, flash: 1 };
}

/** The lower of two tiers. */
export function minTier(a: QualityTier, b: QualityTier): QualityTier {
  return TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b) ? a : b;
}
export function lowerTier(t: QualityTier): QualityTier { const i = TIER_ORDER.indexOf(t); return TIER_ORDER[i > 0 ? i - 1 : 0]; }

/** Sanitize anything read from storage into valid settings. */
export function sanitizeGfx(raw: unknown): GfxSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof GfxSettings, unknown>>;
  const q = o.quality === 'low' || o.quality === 'medium' || o.quality === 'high' ? o.quality : GFX_DEFAULTS.quality;
  const m = o.motion === 'system' || o.motion === 'reduce' || o.motion === 'full' ? o.motion : GFX_DEFAULTS.motion;
  return {
    quality: q, motion: m,
    auto: typeof o.auto === 'boolean' ? o.auto : GFX_DEFAULTS.auto,
    chainLines: typeof o.chainLines === 'boolean' ? o.chainLines : GFX_DEFAULTS.chainLines,
    screenShake: typeof o.screenShake === 'boolean' ? o.screenShake : GFX_DEFAULTS.screenShake,
  };
}

// ---------------------------------------------------------------- auto-degrade
export const AUTO_WINDOW_MS = 2000;
export const AUTO_SLOW_MS = 22;
export const AUTO_SETTLE_MS = 4000;
/** rAF deltas outside this range (tab switches, hitches, duplicate callbacks) are ignored. */
export const AUTO_MAX_DELTA_MS = 250;

/**
 * Watches rAF deltas; `push` returns true when the mean over the last full 2 s window exceeds
 * AUTO_SLOW_MS (the caller then lowers the tier and the monitor resets and settles for 4 s).
 */
export class FrameMonitor {
  private sum = 0;
  private frames = 0;
  private settle = AUTO_SETTLE_MS;
  /** Mean frame time (ms) of the last completed window, 0 until one completes. */
  lastMean = 0;

  reset(settleMs = AUTO_SETTLE_MS): void { this.sum = 0; this.frames = 0; this.settle = settleMs; }

  push(deltaMs: number): boolean {
    if (!(deltaMs > 1) || deltaMs > AUTO_MAX_DELTA_MS) return false;
    if (this.settle > 0) { this.settle -= deltaMs; return false; }
    this.sum += deltaMs;
    this.frames++;
    if (this.sum < AUTO_WINDOW_MS) return false;
    const mean = this.sum / this.frames;
    this.lastMean = mean;
    this.sum = 0; this.frames = 0;
    return mean > AUTO_SLOW_MS;
  }
}

// ---------------------------------------------------------------- persisted store
type Listener = (s: GfxSettings) => void;
let current: GfxSettings | null = null;
const listeners: Listener[] = [];

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** Current graphics settings (loaded once from localStorage, defaults when unavailable). */
export function gfxSettings(): GfxSettings {
  if (current) return current;
  let raw: unknown = null;
  try { const s = storage(); raw = s ? JSON.parse(s.getItem(GFX_KEY) ?? 'null') : null; } catch { raw = null; }
  current = sanitizeGfx(raw);
  return current;
}

/** Change settings, persist them and notify listeners (the Renderer). */
export function setGfxSettings(patch: Partial<GfxSettings>): GfxSettings {
  const next = sanitizeGfx({ ...gfxSettings(), ...patch });
  current = next;
  try { storage()?.setItem(GFX_KEY, JSON.stringify(next)); } catch { /* private mode / blocked */ }
  for (const l of listeners.slice()) l(next);
  return next;
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onGfxChange(l: Listener): () => void {
  listeners.push(l);
  return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
}

/** Test helper: forget the cached settings (next read reloads from storage). */
export function resetGfxCache(): void { current = null; }

/** OS "reduce motion" preference (false outside a browser). */
export function systemReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Live runtime state the Settings screen shows (set by the Renderer). */
export const gfxRuntime = { effective: 'high' as QualityTier, autoLowered: false, meanFrameMs: 0 };
