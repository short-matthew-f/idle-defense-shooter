/**
 * Field overlay (UI-in-world, layer 7): feedback the sim snapshot does not draw at phone scale.
 *   - tap ripple: an expanding ring where a tap landed (snapped onto the enemy it designated)
 *   - designation reticle: the sim marks every designated / Hunter-marked enemy with a layer-7 Ring
 *     tagged aux1 = RETICLE_MARK (core/snapshot.ts); here it is redrawn at least 12 CSS px wide (the
 *     sim's ring is sized in world units, a few px on a phone)
 *   - aim line: tower → pointer while hold-to-aim steers the primary
 *   - salvage crates (active edge): the sim's layer-7 Diamond tagged aux1 = SALVAGE_MARK is redrawn at least 7 CSS px
 *     wide with a 13 px ring, so the crate is a thumb target on a phone (the sim draws it in world units)
 *   - touch test markers (More → Help → Touch test): where the game computed a tap, calibration rings
 * Sizes are in CSS pixels converted with the camera scale, so they read the same on every screen.
 * Pure over typed arrays (no DOM, no GL); allocates nothing per frame.
 */
import { INSTANCE_FLOATS, Shape, ARENA_RADIUS, TOWER_RADIUS, RETICLE_MARK, SALVAGE_MARK } from '@sim/core/types';
import type { TouchMarker } from '@ui/host';

export const OVERLAY_LAYER = 7;
const MAX = 96;
const RIPPLE_S = 0.35;
/** Is instance `o` (float offset) the sim's designation reticle? */
export function isReticle(f: Float32Array, o: number): boolean {
  return f[o + 9] === OVERLAY_LAYER && f[o + 4] === Shape.Ring && f[o + 11] === RETICLE_MARK;
}
/** Is instance `o` a salvage crate (systems/active.ts)? */
export function isCrate(f: Float32Array, o: number): boolean {
  return f[o + 9] === OVERLAY_LAYER && f[o + 4] === Shape.Diamond && f[o + 11] === SALVAGE_MARK;
}

export class FieldOverlay {
  readonly buf = new Float32Array(MAX * INSTANCE_FLOATS);
  count = 0;
  private rippleX = 0;
  private rippleY = 0;
  private rippleT = -1;
  private rippleHit = false;
  private markers: readonly TouchMarker[] = [];

  /** Touch test markers (world units); drawn every frame until replaced. */
  setMarkers(m: readonly TouchMarker[]): void { this.markers = m; }

  /** A tap landed at world (x, y); `hit` = it snapped onto an enemy. `now` in seconds. */
  tap(x: number, y: number, hit: boolean, now: number): void {
    this.rippleX = x; this.rippleY = y; this.rippleT = now; this.rippleHit = hit;
  }

  private push(x: number, y: number, r: number, shape: number, cr: number, cg: number, cb: number, a: number, aux0 = 0, aux1 = 0): void {
    if (this.count >= MAX) return;
    const o = this.count++ * INSTANCE_FLOATS, f = this.buf;
    f[o] = x; f[o + 1] = y; f[o + 2] = r; f[o + 3] = 0; f[o + 4] = shape;
    f[o + 5] = cr; f[o + 6] = cg; f[o + 7] = cb; f[o + 8] = a; f[o + 9] = OVERLAY_LAYER; f[o + 10] = aux0; f[o + 11] = aux1;
  }

  /**
   * Rebuild for this frame. `scale` = CSS px per world unit; `instances` = the drawn snapshot;
   * `aim` = the manual-aim angle while aiming, else null. Returns the instance count.
   */
  build(instances: Float32Array | null, instanceCount: number, scale: number, now: number, aim: number | null): number {
    this.count = 0;
    const px = 1 / Math.max(1e-6, scale);   // world units per CSS px
    if (instances) {
      const n = Math.min(instanceCount, Math.floor(instances.length / INSTANCE_FLOATS));
      let marks = 0, crates = 0;
      for (let i = 0; i < n && (marks < 8 || crates < 8); i++) {
        const o = i * INSTANCE_FLOATS;
        if (crates < 8 && isCrate(instances, o)) {
          const r = Math.max(instances[o + 2], 7 * px), rr = Math.max(instances[o + 2] * 1.6, 13 * px);
          this.push(instances[o], instances[o + 1], rr, Shape.Ring, 1, 0.86, 0.42, 0.7, Math.min(0.5, (2 * px) / rr));
          this.push(instances[o], instances[o + 1], r, Shape.Diamond, 1, 0.86, 0.42, 1);
          crates++;
          continue;
        }
        if (marks >= 8 || !isReticle(instances, o)) continue;
        const r = Math.max(instances[o + 2], 12 * px);
        this.push(instances[o], instances[o + 1], r, Shape.Ring, 1, 0.42, 0.42, 0.95, Math.min(0.5, (2.5 * px) / r));
        marks++;
      }
    }
    if (this.rippleT >= 0) {
      const t = (now - this.rippleT) / RIPPLE_S;
      if (t >= 1 || t < 0) this.rippleT = -1;
      else {
        const r = (8 + 18 * t) * px;
        const c = this.rippleHit ? [1, 0.45, 0.45] : [0.85, 0.92, 1];
        this.push(this.rippleX, this.rippleY, r, Shape.Ring, c[0], c[1], c[2], 0.9 * (1 - t), Math.min(0.5, (2 * px) / r));
      }
    }
    for (const m of this.markers) {
      if (m.kind === 'tap') {
        // where the game computed the tap: magenta ring + dot + short cross arms (14 CSS px)
        this.push(m.x, m.y, 14 * px, Shape.Ring, 1, 0.3, 0.9, 1, (2.5 * px) / (14 * px));
        this.push(m.x, m.y, 2.5 * px, Shape.Circle, 1, 0.3, 0.9, 1);
        this.push(m.x - 22 * px, m.y, 1 * px, Shape.Line, 1, 0.3, 0.9, 0.9, m.x - 16 * px, m.y);
        this.push(m.x + 16 * px, m.y, 1 * px, Shape.Line, 1, 0.3, 0.9, 0.9, m.x + 22 * px, m.y);
        this.push(m.x, m.y - 22 * px, 1 * px, Shape.Line, 1, 0.3, 0.9, 0.9, m.x, m.y - 16 * px);
        this.push(m.x, m.y + 16 * px, 1 * px, Shape.Line, 1, 0.3, 0.9, 0.9, m.x, m.y + 22 * px);
      } else {
        const on = m.kind === 'target';
        this.push(m.x, m.y, 24 * px, Shape.Ring, 0.55, 0.95, 1, on ? 1 : 0.35, (3 * px) / (24 * px));
        this.push(m.x, m.y, 3 * px, Shape.Circle, 0.55, 0.95, 1, on ? 1 : 0.35);
      }
    }
    if (aim !== null) {
      const r0 = TOWER_RADIUS + 4;
      const x0 = Math.cos(aim) * r0, y0 = Math.sin(aim) * r0;
      const x1 = Math.cos(aim) * ARENA_RADIUS, y1 = Math.sin(aim) * ARENA_RADIUS;
      this.push(x0, y0, 1.2 * px, Shape.Line, 1, 0.86, 0.45, 0.55, x1, y1);
    }
    return this.count;
  }
}
