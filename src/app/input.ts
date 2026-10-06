/**
 * Pointer input for the game canvas. No sim knowledge: it only turns pointer events into
 *   - onTap(worldX, worldY)                 short press without much movement
 *   - onAimStart(angle) / onAim(angle) / onAimEnd()   press-and-hold steers manual aim
 *   - onHoldStart(worldX, worldY) → true claims a hold instead (Overcharge on the tower); onHoldEnd(cancelled) on lift
 *   - pinch / wheel zoom (applied to the Camera; onZoom fires after)
 * Angles are radians from `aimOrigin` (the tower, default 0,0) to the pointer in world space
 * (atan2(dy, dx), +y down on screen). Touch and mouse both go through Pointer Events.
 *
 * Pointer → camera pixels (docs/TOUCH.md): every event reads the canvas' CSS box, applies the tap
 * calibration (if the player stored one) in box pixels, then scales box pixels into the camera's view size
 * (`camera.viewW / rect.width`), so a tap maps onto what is drawn even when the box and the size the
 * camera was fitted to disagree (the draw maps the camera view onto the whole box). A disagreement also
 * calls `onStale` (the app re-fits). `probe` (the touch test) takes every pointer instead of the game.
 */
import type { Camera } from '@render/camera';
import { applyCal, type TouchCal } from './touch-cal';

/** Everything the touch test shows about one pointer event. */
export interface ProbeSample {
  phase: 'down' | 'move' | 'up';
  pointerType: string;
  clientX: number; clientY: number;
  pageX: number; pageY: number;
  screenX: number; screenY: number;
  offsetX: number; offsetY: number;
  /** Canvas CSS box at the event. */
  rect: { left: number; top: number; width: number; height: number };
  /** Canvas-local CSS px, no calibration (what calibration fits against). */
  rawX: number; rawY: number;
  /** Canvas-local CSS px after the calibration. */
  calX: number; calY: number;
  /** Camera px (after scaling the box to the camera view). */
  camX: number; camY: number;
  /** The world point the game would act on. */
  worldX: number; worldY: number;
}

/** Box-local CSS px → camera px: calibration in box px, then box → camera view scale. Pure (tests). */
export function boxToView(x: number, y: number, rectW: number, rectH: number, viewW: number, viewH: number, cal: Readonly<TouchCal> | null, out: { x: number; y: number }): { x: number; y: number } {
  applyCal(cal, x, y, out);
  out.x *= rectW > 0 ? viewW / rectW : 1;
  out.y *= rectH > 0 ? viewH / rectH : 1;
  return out;
}

/** Box and camera view differ by more than this (CSS px): the camera is stale. */
const STALE_PX = 1;

export interface InputCallbacks {
  onTap?: (worldX: number, worldY: number) => void;
  onAimStart?: (angle: number) => void;
  onAim?: (angle: number) => void;
  onAimEnd?: () => void;
  onZoom?: (zoom: number) => void;
  /** Active edge: a hold fired at world (x, y) where the finger went down; return true to claim it (no manual aim). */
  onHoldStart?: (worldX: number, worldY: number) => boolean;
  /** The claimed hold ended: lifted (false) or cancelled by a second finger / pointercancel (true). */
  onHoldEnd?: (cancelled: boolean) => void;
  /** Phase 3: is there an enemy or crate at world (x, y)? A short unmoved aim over one is a tap (classifyPress). */
  tapTarget?: (worldX: number, worldY: number) => boolean;
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

/** Phase 3 tap intent (A-05, A-06, C-14): the default press-to-hold time (ms), before the player's extra hold delay. */
export const HOLD_MS = 260;
/** Movement (CSS px) that turns a press into a drag: a thumb rolls more than a mouse. Was 10. */
export const SLOP_PX = 16;
/** Settings → Hold delay: extra ms on top of HOLD_MS (Default / Longer / Longest). */
export const HOLD_DELAYS = [0, 150, 300] as const;
/** A press that became an aim but never moved and lifted within this long after the hold fired, over a target, is a tap. */
export const AIM_TAP_MS = 200;

export type PressKind = 'tap' | 'aim' | 'hold' | 'drag';

/**
 * How a single-finger press ends (pure; tests/app/input.test.ts). `maxMovePx`: the farthest the finger got from where it
 * went down; `durMs`: down to up; `holdMs`: HOLD_MS + the hold delay; `claimed`: onHoldStart took the hold (Overcharge);
 * `overTarget`: an enemy or crate was under the finger. A short "aim" (the hold fired, the finger stayed put and lifted
 * within AIM_TAP_MS) over a target is a tap, not a steer.
 */
export function classifyPress(maxMovePx: number, durMs: number, holdMs: number, slopPx: number, claimed: boolean, overTarget: boolean): PressKind {
  const moved = maxMovePx > slopPx;
  if (durMs < holdMs) return moved ? 'drag' : 'tap';
  if (claimed) return 'hold';
  if (!moved && overTarget && durMs <= holdMs + AIM_TAP_MS) return 'tap';
  return 'aim';
}

/** The press-to-hold time for a hold-delay preference (clamped to the offered steps' range). */
export function holdMsFor(delayMs: number): number {
  return HOLD_MS + Math.max(0, Math.min(HOLD_DELAYS[HOLD_DELAYS.length - 1], Number.isFinite(delayMs) ? delayMs : 0));
}

export class Input {
  onTap: InputCallbacks['onTap'];
  onAimStart: InputCallbacks['onAimStart'];
  onAim: InputCallbacks['onAim'];
  onAimEnd: InputCallbacks['onAimEnd'];
  onZoom: InputCallbacks['onZoom'];
  onHoldStart: InputCallbacks['onHoldStart'];
  onHoldEnd: InputCallbacks['onHoldEnd'];
  tapTarget: InputCallbacks['tapTarget'];
  /** Phase 3: the player's extra hold delay (ms, Settings → Hold delay), read at every press. */
  holdDelay: () => number = () => 0;
  enabled = true;
  holdMs: number;
  slopPx: number;
  aimOrigin: { x: number; y: number };
  /** Tap calibration applied to every pointer position (null = identity). */
  calibration: TouchCal | null = null;
  /** The touch test: when set, every pointer goes here and the game sees nothing. */
  probe: ((s: ProbeSample) => void) | null = null;
  /** The canvas box and the camera view disagreed (the app re-fits the camera). */
  onStale: (() => void) | null = null;
  /** Self-check: pointer events that found the canvas box and the camera view out of step (this session). */
  staleCount = 0;
  lastStale = '';

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
  /** A hold claimed by onHoldStart (Overcharge charging) is in progress. */
  private holding = false;
  private moved = false;
  private holdTimer = 0;
  /** performance.now() of the single-finger press that is running. */
  private downAt = 0;
  /** holdMs + the hold delay for the running press. */
  private pressHoldMs = HOLD_MS;
  private pinching = false;
  private lastPinchDist = 0;
  private lastPinchCx = 0;
  private lastPinchCy = 0;
  private rectLeft = 0;
  private rectTop = 0;
  private rectW = 0;
  private rectH = 0;
  /** World point under each pointer when it went down (a tap acts on what the finger touched). */
  private readonly downWX = new Float32Array(MAX_POINTERS);
  private readonly downWY = new Float32Array(MAX_POINTERS);
  private probeId = -1;
  private stalePending = false;
  private readonly tmp = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, camera: Camera, callbacks: InputCallbacks = {}, opts: InputOptions = {}) {
    this.canvas = canvas;
    this.camera = camera;
    this.onTap = callbacks.onTap;
    this.onAimStart = callbacks.onAimStart;
    this.onAim = callbacks.onAim;
    this.onAimEnd = callbacks.onAimEnd;
    this.onZoom = callbacks.onZoom;
    this.onHoldStart = callbacks.onHoldStart;
    this.onHoldEnd = callbacks.onHoldEnd;
    this.tapTarget = callbacks.tapTarget;
    this.holdMs = opts.holdMs ?? HOLD_MS;
    this.slopPx = opts.slopPx ?? SLOP_PX;
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

  /** Read the canvas box (every pointer event: cheap, and never stale) and check it against the camera. */
  private updateRect(): void {
    const r = this.canvas.getBoundingClientRect();
    this.rectLeft = r.left;
    this.rectTop = r.top;
    this.rectW = r.width;
    this.rectH = r.height;
    const cam = this.camera;
    if (r.width > 0 && r.height > 0 && (Math.abs(r.width - cam.viewW) > STALE_PX || Math.abs(r.height - cam.viewH) > STALE_PX)) {
      this.staleCount++;
      this.lastStale = `box ${r.width.toFixed(1)}×${r.height.toFixed(1)} vs camera ${cam.viewW}×${cam.viewH}`;
      if (this.staleCount <= 3) console.info(`[input] canvas ${this.lastStale}: taps rescaled, camera re-fitted`);
      // re-fit after this event: the event itself maps onto the frame on screen, drawn with the current camera
      if (!this.stalePending) { this.stalePending = true; queueMicrotask(() => { this.stalePending = false; this.onStale?.(); }); }
    }
  }

  /** Client px → camera px into `out` (calibrated, scaled to the camera view). */
  private toView(clientX: number, clientY: number, out: { x: number; y: number }): { x: number; y: number } {
    return boxToView(clientX - this.rectLeft, clientY - this.rectTop, this.rectW, this.rectH, this.camera.viewW, this.camera.viewH, this.calibration, out);
  }

  private setPos(slot: number, e: PointerEvent): void {
    const v = this.toView(e.clientX, e.clientY, this.tmp);
    this.px[slot] = v.x;
    this.py[slot] = v.y;
  }

  private emitProbe(e: PointerEvent, phase: ProbeSample['phase']): void {
    const rawX = e.clientX - this.rectLeft, rawY = e.clientY - this.rectTop;
    const c = applyCal(this.calibration, rawX, rawY, { x: 0, y: 0 });
    const v = this.toView(e.clientX, e.clientY, { x: 0, y: 0 });
    const w = this.camera.toWorld(v.x, v.y, { x: 0, y: 0 });
    this.probe?.({
      phase, pointerType: e.pointerType,
      clientX: e.clientX, clientY: e.clientY, pageX: e.pageX, pageY: e.pageY, screenX: e.screenX, screenY: e.screenY,
      offsetX: e.offsetX, offsetY: e.offsetY,
      rect: { left: this.rectLeft, top: this.rectTop, width: this.rectW, height: this.rectH },
      rawX, rawY, calX: c.x, calY: c.y, camX: v.x, camY: v.y, worldX: w.x, worldY: w.y,
    });
  }

  private angleTo(slot: number): number {
    const w = this.camera.toWorld(this.px[slot], this.py[slot]);
    return Math.atan2(w.y - this.aimOrigin.y, w.x - this.aimOrigin.x);
  }

  private readonly handleContext = (e: Event): void => { e.preventDefault(); };

  private readonly handleDown = (e: PointerEvent): void => {
    if (this.probe) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.updateRect();
      this.probeId = e.pointerId;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      this.emitProbe(e, 'down');
      return;
    }
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    let slot = this.slotOf(e.pointerId);
    if (slot < 0) {
      for (let i = 0; i < MAX_POINTERS; i++) if (this.ids[i] === -1) { slot = i; break; }
    }
    if (slot < 0) return;
    this.updateRect();
    this.ids[slot] = e.pointerId;
    this.setPos(slot, e);
    this.downX[slot] = this.px[slot];
    this.downY[slot] = this.py[slot];
    const w = this.camera.toWorld(this.px[slot], this.py[slot]);
    this.downWX[slot] = w.x;
    this.downWY[slot] = w.y;
    this.active++;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

    if (this.active === 1) {
      this.moved = false;
      this.downAt = performance.now();
      this.cancelHold();
      let extra = 0;
      try { extra = this.holdDelay(); } catch { /* prefs unavailable */ }
      this.pressHoldMs = this.holdMs + Math.max(0, Number.isFinite(extra) ? extra : 0);
      this.holdTimer = window.setTimeout(this.handleHold, this.pressHoldMs);
    } else if (this.active === 2) {
      // second finger: pinch. Abort tap / aim.
      this.cancelHold();
      if (this.aiming) this.endAim();
      if (this.holding) this.endHold(true);
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
    if (this.onHoldStart?.(this.downWX[slot], this.downWY[slot])) { this.holding = true; return; }
    this.aiming = true;
    this.onAimStart?.(this.angleTo(slot));
  };

  private firstActive(): number {
    for (let i = 0; i < MAX_POINTERS; i++) if (this.ids[i] !== -1) return i;
    return -1;
  }

  private readonly handleMove = (e: PointerEvent): void => {
    if (this.probe) {
      if (e.pointerId === this.probeId) { this.updateRect(); this.emitProbe(e, 'move'); }
      return;
    }
    const slot = this.slotOf(e.pointerId);
    if (slot < 0) return;
    this.updateRect();
    this.setPos(slot, e);
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
    if (this.probe && e.pointerId === this.probeId) {
      this.probeId = -1;
      this.updateRect();
      this.emitProbe(e, 'up');
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      return;
    }
    const slot = this.slotOf(e.pointerId);
    if (slot < 0) return;
    this.updateRect();
    this.setPos(slot, e);
    const wasSingle = this.active === 1 && !this.pinching;
    const wasAiming = this.aiming;
    const wasHolding = this.holding;
    const wasMoved = this.moved;
    this.release(slot, e.pointerId);
    if (!wasSingle) {
      if (this.active <= 1) this.pinching = false;
      return;
    }
    this.cancelHold();
    if (wasHolding) { this.endHold(false); return; }
    if (wasAiming) {
      this.endAim();
      // a short, unmoved aim over an enemy or crate was meant as a tap (Phase 3 tap intent)
      const dur = performance.now() - this.downAt;
      const over = !wasMoved && this.enabled && !!this.tapTarget?.(this.downWX[slot], this.downWY[slot]);
      if (classifyPress(wasMoved ? Infinity : 0, dur, this.pressHoldMs, this.slopPx, false, over) === 'tap') this.onTap?.(this.downWX[slot], this.downWY[slot]);
      return;
    }
    // the world point under the finger when it went down (the frame the player aimed at)
    if (!wasMoved && this.enabled) this.onTap?.(this.downWX[slot], this.downWY[slot]);
  };

  private readonly handleCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.probeId) { this.probeId = -1; return; }
    const slot = this.slotOf(e.pointerId);
    if (slot < 0) return;
    this.release(slot, e.pointerId);
    this.cancelHold();
    if (this.aiming) this.endAim();
    if (this.holding) this.endHold(true);
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

  private endHold(cancelled: boolean): void {
    this.holding = false;
    this.onHoldEnd?.(cancelled);
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
    if (!this.enabled || this.probe) return;
    e.preventDefault();
    this.updateRect();
    // normalize line/page deltas to pixels
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const f = Math.exp(-e.deltaY * unit * 0.0015);
    const v = this.toView(e.clientX, e.clientY, this.tmp);
    this.camera.zoomBy(f, v.x, v.y);
    this.onZoom?.(this.camera.zoom);
  };
}
