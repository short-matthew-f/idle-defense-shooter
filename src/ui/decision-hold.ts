/**
 * Stay with the fight (UX Phase 2 item 10, HANDBOOK-EVAL C-09). On a phone a full-screen tab hides the arena, so a
 * decision screen opened FROM the fight (a pointer ring, a coach line, the death card, a boon offer / draft) pauses
 * the run until the player is back on Battle, for at most HOLD_CAP_MS. Tabs the player opens on their own stay live.
 * The pause is the app's own (UiHost.setPaused: the sim is simply not stepped), so determinism is untouched.
 *
 * Below LOW_HP_FRAC the Battle tab flashes (a class; reduced motion gets a steady tint) and, once per
 * VIBRATE_GAP_MS, the phone vibrates where the browser supports it (guarded).
 *
 * This file is the pure state (tests/ui/decision-hold.test.ts); shell.ts wires it.
 */
export const HOLD_CAP_MS = 30_000;
/** A tap on a decision source arms the hold for a navigation that follows within this long. */
export const ARM_WINDOW_MS = 1_000;
export const LOW_HP_FRAC = 0.3;
export const VIBRATE_GAP_MS = 15_000;

export class DecisionHold {
  /** performance.now() the hold started at, or null. */
  since: number | null = null;
  private armedAt = -Infinity;

  /** A tap landed on a decision source (death card, coach line, offer, ring). */
  arm(now: number): void { this.armedAt = now; }

  /**
   * A navigation away from Battle happened at `now` on a layout that hides the arena. `guided` = a pointer ring led to
   * it. Returns true when the hold should start (it was armed or guided, and none is running).
   */
  navigatedAway(now: number, guided: boolean): boolean {
    const armed = now - this.armedAt <= ARM_WINDOW_MS;
    this.armedAt = -Infinity;
    if (this.since !== null || !(armed || guided)) return false;
    this.since = now;
    return true;
  }

  get active(): boolean { return this.since !== null; }

  /** ms left before the cap releases the hold (0 when none or expired). */
  left(now: number): number { return this.since === null ? 0 : Math.max(0, this.since + HOLD_CAP_MS - now); }

  /** The cap has passed: the hold should end. */
  expired(now: number): boolean { return this.since !== null && now - this.since >= HOLD_CAP_MS; }

  /** End the hold (back on Battle, the cap, or a layout without a full-screen tab). Returns whether one was running. */
  release(): boolean { const was = this.since !== null; this.since = null; return was; }
}

/** Low-HP alert state for the Battle tab: flash while low and off Battle; vibrate on entering, at most once per gap. */
export class LowHpAlert {
  private lastBuzz = -Infinity;
  low = false;

  /** Returns whether to vibrate now. */
  update(now: number, hpFrac: number, offBattle: boolean, inCombat: boolean): boolean {
    const low = offBattle && inCombat && hpFrac > 0 && hpFrac < LOW_HP_FRAC;
    const entering = low && !this.low;
    this.low = low;
    if (entering && now - this.lastBuzz >= VIBRATE_GAP_MS) { this.lastBuzz = now; return true; }
    return false;
  }
}

/** navigator.vibrate where supported (iOS Safari has none); never throws. */
export function buzz(pattern: number | number[] = [90, 60, 90]): void {
  try {
    const n = typeof navigator !== 'undefined' ? (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }) : null;
    if (n && typeof n.vibrate === 'function') n.vibrate(pattern);
  } catch { /* unsupported or blocked */ }
}
