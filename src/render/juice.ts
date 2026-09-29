/**
 * Presentation-only "juice" (graphics pass): camera punch (a brief zoom kick), a floor vignette pulse,
 * slowed VISUAL time (particles, idle animation, shader time; the sim is untouched) and per-event screen
 * shake, all driven by the snapshot's cue fx (FxKind.Punch / Shake / SlowMo).
 *
 * Safety: the vignette tints only the arena floor (enemies never dim) and is capped at VIGNETTE_MAX;
 * pulses closer than MIN_PULSE_GAP_S (3 Hz) merge; reduced motion zeroes punch, shake and slow-mo.
 */
import { FxKind } from '@sim/core/types';
import type { MotionScales } from './quality';

export const PUNCH_PER_STRENGTH = 0.03;
export const PUNCH_MAX = 0.07;
export const VIGNETTE_MAX = 0.22;
export const MIN_PULSE_GAP_S = 1 / 3;
export const SLOWMO_SCALE = 0.35;
export const SLOWMO_HOLD_S = 0.25;
export const SLOWMO_EASE_S = 0.6;

export class Juice {
  /** Current zoom kick (fraction of scale). */
  punch = 0;
  /** Current vignette alpha (0..VIGNETTE_MAX) and colour. */
  vignette = 0;
  vr = 1; vg = 0.85; vb = 0.45;
  /** Multiplier on visual time (1 = normal). */
  timeScale = 1;
  /** Trauma to add to the camera this frame (consumed by the renderer). */
  shake = 0;
  private sinceSlow = 99;
  private sincePulse = 99;

  /** Handle one cue fx. Returns true when `kind` was a cue (not a particle effect). */
  cue(kind: number, size: number, r: number, g: number, b: number, m: MotionScales): boolean {
    switch (kind) {
      case FxKind.Punch: {
        const p = Math.min(PUNCH_MAX, PUNCH_PER_STRENGTH * size) * m.punch;
        if (p > this.punch) this.punch = p;
        if (this.sincePulse >= MIN_PULSE_GAP_S || this.vignette < 0.02) {
          this.sincePulse = 0;
          const v = Math.min(VIGNETTE_MAX, 0.11 * size) * m.vignette;
          if (v > this.vignette) { this.vignette = v; this.vr = r; this.vg = g; this.vb = b; }
        }
        return true;
      }
      case FxKind.Shake:
        this.shake = Math.max(this.shake, Math.min(1, size) * m.shake);
        return true;
      case FxKind.SlowMo:
        if (m.slowmo) this.sinceSlow = 0;
        return true;
      default:
        return false;
    }
  }

  /** Advance by real seconds; returns the visual-time multiplier for this frame. */
  update(dt: number): number {
    this.punch *= Math.exp(-dt * 10);
    if (this.punch < 1e-4) this.punch = 0;
    this.vignette *= Math.exp(-dt * 3.2);
    if (this.vignette < 1e-3) this.vignette = 0;
    this.sincePulse += dt;
    this.sinceSlow += dt;
    this.timeScale = slowMoScale(this.sinceSlow);
    return this.timeScale;
  }
}

/** Visual time scale `s` seconds after a Counter: SLOWMO_SCALE for SLOWMO_HOLD_S, then eased back to 1. */
export function slowMoScale(s: number): number {
  if (s < 0) return 1;
  if (s < SLOWMO_HOLD_S) return SLOWMO_SCALE;
  const t = (s - SLOWMO_HOLD_S) / SLOWMO_EASE_S;
  if (t >= 1) return 1;
  const e = t * t * (3 - 2 * t);
  return SLOWMO_SCALE + (1 - SLOWMO_SCALE) * e;
}
