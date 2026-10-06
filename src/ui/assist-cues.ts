/**
 * Phase 3 timing cues and assists (HANDBOOK-EVAL A-13..A-15, C-21), pure rules plus one small DOM-free watcher:
 *  - Overcharge: the hold crossed into the perfect band (tick + short vibration), and the optional auto-release
 *    (prefs.overchargeAssist) that lets go at the top of the band through the normal `release` command.
 *  - Haptic cues (prefs.hapticCues, only offered where navigator.vibrate exists): a boss tell opens, HP drops low.
 * Nothing here touches the sim: the auto-release is an ordinary UI command; the tell assist is a sim setting.
 */
import { ACTIVE } from '@sim/data/active';
import { LOW_HP_FRAC } from './decision-hold';

const O = ACTIVE.overcharge;

/** The ready glow pulses this long, then holds steady (class `steady` on the Overcharge button). */
export const GLOW_PULSE_MS = 5_000;
/**
 * Auto-release lets go this far (s) below the top of the perfect band: the release reports the hold the arc shows,
 * which may run up to a frame plus the UiState extrapolation ahead of the sim's own hold.
 */
export const AUTO_RELEASE_MARGIN = 0.08;

/** The hold went from below the perfect band to inside it between two frames. */
export function bandEntered(prevSecs: number, secs: number): boolean {
  return prevSecs < O.perfectFrom && secs >= O.perfectFrom && secs <= O.perfectTo;
}

/** Overcharge auto-release: with the assist on, release once the hold reaches the top of the band (minus a margin). */
export function autoReleaseDue(secs: number, assistOn: boolean): boolean {
  return assistOn && secs >= O.perfectTo - AUTO_RELEASE_MARGIN;
}

/** navigator.vibrate exists (Android Chrome yes; iOS Safari no): the haptic settings row only shows here. */
export function vibrationSupported(): boolean {
  try { return typeof navigator !== 'undefined' && typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === 'function'; } catch { return false; }
}

/** Edge detector for haptic cues: returns which cue fires for this UiState (at most one per kind per entry). */
export class HapticCues {
  private tell = false;
  private low = false;

  /** `tellOpen`: a boss tell window is live; `hpFrac`: tower HP fraction; `inCombat`: the run is fighting. */
  update(tellOpen: boolean, hpFrac: number, inCombat: boolean): 'tell' | 'low' | null {
    const low = inCombat && hpFrac > 0 && hpFrac < LOW_HP_FRAC;
    const tellEdge = tellOpen && !this.tell;
    const lowEdge = low && !this.low;
    this.tell = tellOpen; this.low = low;
    return tellEdge ? 'tell' : lowEdge ? 'low' : null;
  }
}
