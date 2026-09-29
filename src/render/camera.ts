/**
 * Camera: maps arena (world) units to CSS pixels.
 *
 * World: +x right, +y DOWN on screen (canvas convention), tower at (0,0).
 * `zoom` is a user multiplier on top of the fit scale: zoom 1 shows the whole arena; > 1 zooms in.
 * All pixel values here are CSS pixels (not device pixels).
 */

export interface Vec2 { x: number; y: number }

export const MIN_ZOOM = 0.7;
export const MAX_ZOOM = 3.5;
/** Extra room around the arena rim (fraction of the radius) so the boundary glow is visible. */
export const FIT_MARGIN = 1.08;

export class Camera {
  /** World point at the center of the view (pan). */
  x = 0;
  y = 0;
  /** User zoom multiplier (1 = whole arena visible). */
  zoom = 1;
  minZoom = MIN_ZOOM;
  maxZoom = MAX_ZOOM;

  viewW = 1;
  viewH = 1;
  arenaRadius = 520;
  /** CSS pixels per world unit at zoom 1. */
  baseScale = 1;
  /** Pixel center of the arena in the view (differs from the middle when insets are set). */
  centerPx = 0.5;
  centerPy = 0.5;

  /** Reserved screen margins (px) for overlaid UI, e.g. the phone bottom sheet. */
  insetTop = 0;
  insetRight = 0;
  insetBottom = 0;
  insetLeft = 0;

  /** Shake state. `trauma` in 0..1 decays; offsets are in world units. */
  trauma = 0;
  shakeX = 0;
  shakeY = 0;
  maxShakePx = 14;
  shakeDecay = 5;
  private time = 0;

  private readonly tmp: Vec2 = { x: 0, y: 0 };

  /** Fit the whole arena into the view (keeps it visible on portrait phones and desktop). */
  fit(arenaRadius: number, canvasW: number, canvasH: number): void {
    this.arenaRadius = arenaRadius;
    this.viewW = Math.max(1, canvasW);
    this.viewH = Math.max(1, canvasH);
    const availW = Math.max(1, this.viewW - this.insetLeft - this.insetRight);
    const availH = Math.max(1, this.viewH - this.insetTop - this.insetBottom);
    this.baseScale = Math.min(availW, availH) / (2 * arenaRadius * FIT_MARGIN);
    this.centerPx = this.insetLeft + availW * 0.5;
    this.centerPy = this.insetTop + availH * 0.5;
    this.clampPan();
  }

  setInsets(top: number, right: number, bottom: number, left: number): void {
    this.insetTop = top; this.insetRight = right; this.insetBottom = bottom; this.insetLeft = left;
    this.fit(this.arenaRadius, this.viewW, this.viewH);
  }

  /** CSS pixels per world unit at the current zoom. */
  get scale(): number { return this.baseScale * this.zoom; }

  /** Pixel -> world (includes current shake so taps line up with what is drawn). Returns a shared object unless `out` is given. */
  toWorld(px: number, py: number, out: Vec2 = this.tmp): Vec2 {
    const s = this.scale;
    out.x = (px - this.centerPx) / s + this.x + this.shakeX;
    out.y = (py - this.centerPy) / s + this.y + this.shakeY;
    return out;
  }

  /** World -> pixel. Returns a shared object unless `out` is given. */
  toScreen(wx: number, wy: number, out: Vec2 = this.tmp): Vec2 {
    const s = this.scale;
    out.x = (wx - this.x - this.shakeX) * s + this.centerPx;
    out.y = (wy - this.y - this.shakeY) * s + this.centerPy;
    return out;
  }

  /** Multiply the zoom by `factor`, keeping the world point under pixel (px, py) fixed. */
  zoomBy(factor: number, px: number = this.centerPx, py: number = this.centerPy): void {
    this.setZoom(this.zoom * factor, px, py);
  }

  setZoom(z: number, px: number = this.centerPx, py: number = this.centerPy): void {
    const nz = z < this.minZoom ? this.minZoom : z > this.maxZoom ? this.maxZoom : z;
    const sx = this.shakeX, sy = this.shakeY;
    this.shakeX = 0; this.shakeY = 0;
    const bx = (px - this.centerPx) / this.scale + this.x;
    const by = (py - this.centerPy) / this.scale + this.y;
    this.zoom = nz;
    const ax = (px - this.centerPx) / this.scale + this.x;
    const ay = (py - this.centerPy) / this.scale + this.y;
    this.x += bx - ax;
    this.y += by - ay;
    this.shakeX = sx; this.shakeY = sy;
    this.clampPan();
  }

  /** Pan by a pixel delta (used by two-finger drag). */
  panByPixels(dx: number, dy: number): void {
    const s = this.scale;
    this.x -= dx / s;
    this.y -= dy / s;
    this.clampPan();
  }

  /** Keep the arena covering the view: no pan at zoom <= 1, limited pan when zoomed in. */
  clampPan(): void {
    if (this.zoom <= 1) { this.x = 0; this.y = 0; return; }
    const lim = this.arenaRadius * (1 - 1 / this.zoom) * 1.05;
    if (this.x > lim) this.x = lim; else if (this.x < -lim) this.x = -lim;
    if (this.y > lim) this.y = lim; else if (this.y < -lim) this.y = -lim;
  }

  reset(): void { this.zoom = 1; this.x = 0; this.y = 0; this.trauma = 0; this.shakeX = 0; this.shakeY = 0; }

  /** Add trauma directly (0..1). */
  addShake(amount: number): void {
    this.trauma = Math.min(1, Math.max(this.trauma, amount));
  }

  /**
   * Advance shake. `snapShake` is `RenderSnapshot.cameraShake`, interpreted as trauma in 0..1:
   * the camera follows max(decayed trauma, snapshot value). Offset = trauma^2 * maxShakePx.
   */
  update(dt: number, snapShake: number): void {
    this.time += dt;
    const decayed = this.trauma * Math.exp(-this.shakeDecay * dt);
    const inShake = snapShake > 0 ? (snapShake > 1 ? 1 : snapShake) : 0;
    this.trauma = decayed > inShake ? decayed : inShake;
    if (this.trauma < 0.002) { this.trauma = 0; this.shakeX = 0; this.shakeY = 0; return; }
    const amp = (this.trauma * this.trauma * this.maxShakePx) / this.scale;
    const t = this.time;
    this.shakeX = amp * (Math.sin(t * 47.3) + 0.5 * Math.sin(t * 91.7 + 1.3)) * 0.66;
    this.shakeY = amp * (Math.sin(t * 53.1 + 2.1) + 0.5 * Math.sin(t * 83.9 + 0.4)) * 0.66;
  }
}
