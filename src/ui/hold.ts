/**
 * Press-and-hold repeat gesture (pure state machine; `holdRepeat` in dom.ts wires it to a button).
 *
 * Mouse / pen: fire on press, then repeat after HOLD_DELAY_MS, speeding up.
 * Touch: a press may be the start of a scroll (the Buy buttons sit in scrolling lists), so nothing
 * fires on touch-down. A tap fires once on release; holding still for TOUCH_HOLD_DELAY_MS starts the
 * repeat; moving more than SLOP_PX, or the browser taking the touch for scrolling
 * (pointercancel), aborts without buying anything.
 */
export const HOLD_DELAY_MS = 380;
/** Touch waits longer before repeating (iOS long-press is ~500 ms): a thumb often rests before it scrolls. */
export const TOUCH_HOLD_DELAY_MS = 480;
export const FIRST_REPEAT_MS = 160;
export const MIN_REPEAT_MS = 40;
export const SLOP_PX = 10;
/** Upper bound on fires from one press (~6 s at the fastest cadence). */
export const MAX_HOLD_FIRES = 150;

export type HoldAction =
  | { kind: 'none' }
  | { kind: 'fire'; next: number }     // fire now; schedule the next tick in `next` ms
  | { kind: 'wait'; next: number }     // nothing yet; tick in `next` ms
  | { kind: 'stop' };

export class HoldGesture {
  pressed = false;
  fired = 0;
  private touch = false;
  private delay = FIRST_REPEAT_MS;
  private sx = 0;
  private sy = 0;
  /** A touch press that may still become a tap-fire on its click (cleared by scroll, cancel, or a repeat). */
  private tapArmed = false;

  down(pointerType: string, x: number, y: number): HoldAction {
    this.pressed = true; this.fired = 0; this.delay = FIRST_REPEAT_MS;
    this.touch = pointerType === 'touch';
    this.sx = x; this.sy = y;
    this.tapArmed = this.touch;               // mouse fires on press; its click must not fire again
    if (this.touch) return { kind: 'wait', next: TOUCH_HOLD_DELAY_MS };
    this.fired = 1;
    return { kind: 'fire', next: HOLD_DELAY_MS };
  }

  /** Timer tick while pressed. `ok` = the button is still connected and enabled. */
  tick(ok: boolean): HoldAction {
    if (!this.pressed || !ok || this.fired >= MAX_HOLD_FIRES) return this.stop();
    this.fired++;
    this.tapArmed = false;
    const next = this.fired === 1 ? FIRST_REPEAT_MS : (this.delay = Math.max(MIN_REPEAT_MS, this.delay * 0.82));
    return { kind: 'fire', next };
  }

  move(x: number, y: number): HoldAction {
    if (!this.pressed || !this.touch || this.fired > 0) return { kind: 'none' };
    const dx = x - this.sx, dy = y - this.sy;
    if (dx * dx + dy * dy > SLOP_PX * SLOP_PX) { this.tapArmed = false; return this.stop(); }
    return { kind: 'none' };
  }

  /** pointerup / pointerleave / blur. */
  up(): HoldAction { return this.stop(); }

  /** pointercancel: the browser took the touch (scroll) — never fire. */
  cancel(): HoldAction { this.tapArmed = false; return this.stop(); }

  /**
   * Click event. `detail === 0` is keyboard activation (always fires once). A touch tap that
   * neither repeated nor scrolled fires once here.
   */
  click(detail: number): boolean {
    if (detail === 0) return true;
    const fire = this.tapArmed;
    this.tapArmed = false;
    return fire;
  }

  stop(): HoldAction {
    this.pressed = false;
    return { kind: 'stop' };
  }
}
