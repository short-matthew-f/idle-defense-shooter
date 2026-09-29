/**
 * Pointer input for the game canvas. No sim knowledge: it only turns pointer events into
 *   - onTap(worldX, worldY)                 short press without much movement
 *   - onAimStart(angle) / onAim(angle) / onAimEnd()   press-and-hold steers manual aim
 *   - pinch / wheel zoom (applied to the Camera; onZoom fires after)
 * Angles are radians from `aimOrigin` (the tower, default 0,0) to the pointer in world space
 * (atan2(dy, dx), +y down on screen). Touch and mouse both go through Pointer Events.
 */
import type { Camera } from '@render/camera';

export interface InputCallbacks {
  onTap?: (worldX: number, worldY: number) => void;
  onAimStart?: (angle: number) => void;
  onAim?: (angle: number) => void;
  onAimEnd?: () => void;
  onZoom?: (zoom: number) => void;
}

export interface InputOptions {
  /** Hold time before a press becomes manual aim (ms). */
  holdMs?: number;
  /** Movement (CSS px) that turns a press into a drag rather than a tap. */
  slopPx?: number;
  /** World point aim angles are measured from. */
  aimOrigin?: { x: number; y: number };
}

const MAX_POINTERS = 2;

export class Input {
  onTap: InputCallbacks['onTap'];
  onAimStart: InputCallbacks['onAimStart'];
  onAim: InputCallbacks['onAim'];
  onAimEnd: InputCallbacks['onAimEnd'];
  onZoom: InputCallbacks['onZoom'];
  enabled = true;
  holdMs: number;
  slopPx: number;
  aimOrigin: { x: number; y: number };

  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;

  // pointer slots (no per-event allocation)
  private readonly ids = new Int32Array(MAX_POINTERS).fill(-1);
  private readonly px = new Float32Array(MAX_POINTERS);
  private readonly py = new Float32Array(MAX_POINTERS);
  private readonly downX = new Float32Array(MAX_POINTERS);
  private readonly downY = new Float32Array(MAX_POINTERS);
  private active = 0;

  private aiming = false;
  private moved = false;
  private holdTimer = 0;
  private pinching = false;
  private lastPinchDist = 0;
  private lastPinchCx = 0;
  private lastPinchCy = 0;
  private rectLeft = 0;
  private rectTop = 0;

  constructor(canvas: HTMLCanvasElement, camera: Camera, callbacks: InputCallbacks = {}, opts: InputOptions = {}) {
    this.canvas = canvas;
    this.camera = camera;
    this.onTap = callbacks.onTap;
    this.onAimStart = callbacks.onAimStart;
    this.onAim = callbacks.onAim;
    this.onAimEnd = callbacks.onAimEnd;
    this.onZoom = callbacks.onZoom;
    this.holdMs = opts.holdMs ?? 260;
    this.slopPx = opts.slopPx ?? 10;
    this.aimOrigin = opts.aimOrigin ?? { x: 0, y: 0 };

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.handleDown);
    canvas.addEventListener('pointermove', this.handleMove);
    canvas.addEventListener('pointerup', this.handleUp);
    canvas.addEventListener('pointercancel', this.handleCancel);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.handleContext);
  }

  get isAiming(): boolean { return this.aiming; }

  dispose(): void {
    this.cancelHold();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.handleDown);
    c.removeEventListener('pointermove', this.handleMove);
    c.removeEventListener('pointerup', this.handleUp);
    c.removeEventListener('pointercancel', this.handleCancel);
    c.removeEventListener('wheel', this.handleWheel);
    c.removeEventListener('contextmenu', this.handleContext);
  }

  // ---------------------------------------------------------------- internals

  private slotOf(id: number): number {
    for (let i = 0; i < MAX_POINTERS; i++) if (this.ids[i] === id) return i;
    return -1;
  }

  private updateRect(): void {
    const r = this.canvas.getBoundingClientRect();
    this.rectLeft = r.left;
    this.rectTop = r.top;
  }

  private angleTo(slot: number): number {
    const w = this.camera.toWorld(this.px[slot], this.py[slot]);
    return Math.atan2(w.y - this.aimOrigin.y, w.x - this.aimOrigin.x);
  }

  private readonly handleContext = (e: Event): void => { e.preventDefault(); };

  private readonly handleDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    let slot = this.slotOf(e.pointerId);
    if (slot < 0) {
      for (let i = 0; i < MAX_POINTERS; i++) if (this.ids[i] === -1) { slot = i; break; }
    }
    if (slot < 0) return;
    this.updateRect();
    this.ids[slot] = e.pointerId;
    this.px[slot] = this.downX[slot] = e.clientX - this.rectLeft;
    this.py[slot] = this.downY[slot] = e.clientY - this.rectTop;
    this.active++;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

    if (this.active === 1) {
      this.moved = false;
      this.cancelHold();
      this.holdTimer = window.setTimeout(this.handleHold, this.holdMs);
    } else if (this.active === 2) {
      // second finger: pinch. Abort tap / aim.
      this.cancelHold();
      if (this.aiming) this.endAim();
      this.pinching = true;
      this.moved = true;
      this.startPinch();
    }
  };

  private readonly handleHold = (): void => {
    this.holdTimer = 0;
    if (!this.enabled || this.moved || this.active !== 1 || this.pinching) return;
    const slot = this.firstActive();
    if (slot < 0) return;
    this.aiming = true;
    this.onAimStart?.(this.angleTo(slot));
  };

  private firstActive(): number {
    for (let i = 0; i < MAX_POINTERS; i++) if (this.ids[i] !== -1) return i;
    return -1;
  }

  private readonly handleMove = (e: PointerEvent): void => {
    const slot = this.slotOf(e.pointerId);
    if (slot < 0) return;
    this.px[slot] = e.clientX - this.rectLeft;
    this.py[slot] = e.clientY - this.rectTop;
    if (this.pinching) { this.updatePinch(); return; }
    if (!this.moved) {
      const dx = this.px[slot] - this.downX[slot];
      const dy = this.py[slot] - this.downY[slot];
      if (dx * dx + dy * dy > this.slopPx * this.slopPx) {
        this.moved = true;
        // moving before the hold fires cancels the pending hold (a drag is not a tap either)
        if (!this.aiming) this.cancelHold();
      }
    }
    if (this.aiming) this.onAim?.(this.angleTo(slot));
  };

  private readonly handleUp = (e: PointerEvent): void => {
    const slot = this.slotOf(e.pointerId);
    if (slot < 0) return;
    this.px[slot] = e.clientX - this.rectLeft;
    this.py[slot] = e.clientY - this.rectTop;
    const wasSingle = this.active === 1 && !this.pinching;
    const wasAiming = this.aiming;
    const wasMoved = this.moved;
    this.release(slot, e.pointerId);
    if (!wasSingle) {
      if (this.active <= 1) this.pinching = false;
      return;
    }
    this.cancelHold();
    if (wasAiming) { this.endAim(); return; }
    if (!wasMoved && this.enabled) {
      const w = this.camera.toWorld(this.downX[slot], this.downY[slot]);
      this.onTap?.(w.x, w.y);
    }
  };

  private readonly handleCancel = (e: PointerEvent): void => {
    const slot = this.slotOf(e.pointerId);
    if (slot < 0) return;
    this.release(slot, e.pointerId);
    this.cancelHold();
    if (this.aiming) this.endAim();
    if (this.active <= 1) this.pinching = false;
  };

  private release(slot: number, pointerId: number): void {
    this.ids[slot] = -1;
    this.active = Math.max(0, this.active - 1);
    try { this.canvas.releasePointerCapture(pointerId); } catch { /* already released */ }
    if (this.active === 0) this.pinching = false;
  }

  private endAim(): void {
    this.aiming = false;
    this.onAimEnd?.();
  }

  private cancelHold(): void {
    if (this.holdTimer) { window.clearTimeout(this.holdTimer); this.holdTimer = 0; }
  }

  private startPinch(): void {
    const dx = this.px[1] - this.px[0], dy = this.py[1] - this.py[0];
    this.lastPinchDist = Math.hypot(dx, dy) || 1;
    this.lastPinchCx = (this.px[0] + this.px[1]) * 0.5;
    this.lastPinchCy = (this.py[0] + this.py[1]) * 0.5;
  }

  private updatePinch(): void {
    if (this.ids[0] === -1 || this.ids[1] === -1) return;
    const dx = this.px[1] - this.px[0], dy = this.py[1] - this.py[0];
    const dist = Math.hypot(dx, dy) || 1;
    const cx = (this.px[0] + this.px[1]) * 0.5;
    const cy = (this.py[0] + this.py[1]) * 0.5;
    this.camera.panByPixels(cx - this.lastPinchCx, cy - this.lastPinchCy);
    this.camera.zoomBy(dist / this.lastPinchDist, cx, cy);
    this.lastPinchDist = dist;
    this.lastPinchCx = cx;
    this.lastPinchCy = cy;
    this.onZoom?.(this.camera.zoom);
  }

  private readonly handleWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this.updateRect();
    // normalize line/page deltas to pixels
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const f = Math.exp(-e.deltaY * unit * 0.0015);
    this.camera.zoomBy(f, e.clientX - this.rectLeft, e.clientY - this.rectTop);
    this.onZoom?.(this.camera.zoom);
  };
}
