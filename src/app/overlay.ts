/**
 * Field overlay (UI-in-world, layer 7): feedback the sim snapshot does not draw at phone scale.
 *   - tap ripple: an expanding ring where a tap landed (snapped onto the enemy it designated)
 *   - designation reticle: a ring around every enemy drawn with the designated/marked outline
 *     colour (the sim's outline is only 2 world units wide, under 1 px on a phone)
 *   - aim line: tower → pointer while hold-to-aim steers the primary
 * Sizes are in CSS pixels converted with the camera scale, so they read the same on every screen.
 * Pure over typed arrays (no DOM, no GL); allocates nothing per frame.
 */
import { INSTANCE_FLOATS, Shape, ARENA_RADIUS, TOWER_RADIUS } from '@sim/core/types';

export const OVERLAY_LAYER = 7;
const OUTLINE_LAYER = 5;
const MAX = 96;
const RIPPLE_S = 0.35;
/** Designated / Hunter-marked outline colour written by the sim snapshot (core/snapshot.ts). */
export function isDesignatedOutline(r: number, g: number, b: number): boolean {
  return r === 1 && Math.abs(g - 0.3) < 1e-3 && Math.abs(b - 0.3) < 1e-3;
}

export class FieldOverlay {
  readonly buf = new Float32Array(MAX * INSTANCE_FLOATS);
  count = 0;
  private rippleX = 0;
  private rippleY = 0;
  private rippleT = -1;
  private rippleHit = false;

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
      let marks = 0;
      for (let i = 0; i < n && marks < 8; i++) {
        const o = i * INSTANCE_FLOATS;
        if (instances[o + 9] !== OUTLINE_LAYER || !isDesignatedOutline(instances[o + 5], instances[o + 6], instances[o + 7])) continue;
        const r = Math.max(instances[o + 2] + 6, 12 * px);
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
    if (aim !== null) {
      const r0 = TOWER_RADIUS + 4;
      const x0 = Math.cos(aim) * r0, y0 = Math.sin(aim) * r0;
      const x1 = Math.cos(aim) * ARENA_RADIUS, y1 = Math.sin(aim) * ARENA_RADIUS;
      this.push(x0, y0, 1.2 * px, Shape.Line, 1, 0.86, 0.45, 0.55, x1, y1);
    }
    return this.count;
  }
}
