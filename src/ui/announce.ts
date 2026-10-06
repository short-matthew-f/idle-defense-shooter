/**
 * Screen-reader announcements (Phase 3, A-20): two visually hidden aria-live regions (polite, assertive) and
 * `announce(text, urgent?)`. Off when Settings → Accessibility → "Screen reader announcements" is off (prefs.srAnnounce).
 * Throttled: the same line is not repeated within REPEAT_MS, and polite lines are spaced POLITE_GAP_MS apart (a burst
 * keeps only the newest).
 */
import { prefs } from './prefs';

export const REPEAT_MS = 5000;
export const POLITE_GAP_MS = 1200;

export interface AnnounceState { lastText: string; lastAt: number; lastPoliteAt: number }

/** The throttle (pure): 'now' speaks at once, 'later' waits for the polite gap, 'drop' skips a repeat. */
export function announceDecision(s: AnnounceState, text: string, urgent: boolean, now: number): 'now' | 'later' | 'drop' {
  if (!text.trim()) return 'drop';
  if (text === s.lastText && now - s.lastAt < REPEAT_MS) return 'drop';
  if (urgent) return 'now';
  return now - s.lastPoliteAt >= POLITE_GAP_MS ? 'now' : 'later';
}

const state: AnnounceState = { lastText: '', lastAt: -Infinity, lastPoliteAt: -Infinity };
let polite: HTMLElement | null = null;
let assertive: HTMLElement | null = null;
let pending: { text: string; timer: number } | null = null;

function region(live: 'polite' | 'assertive'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'sr-only sr-live';
  el.setAttribute('aria-live', live);
  el.setAttribute('aria-atomic', 'true');
  if (live === 'assertive') el.setAttribute('role', 'alert');
  else el.setAttribute('role', 'status');
  document.body.appendChild(el);
  return el;
}

/** Create the live regions (idempotent; announce() also mounts them on first use). */
export function mountAnnouncer(): void {
  if (typeof document === 'undefined') return;
  polite ??= region('polite');
  assertive ??= region('assertive');
}

function speak(el: HTMLElement, text: string): void {
  // clear first, so a screen reader hears a line even when it matches the previous one after REPEAT_MS
  el.textContent = '';
  window.setTimeout(() => { el.textContent = text; }, 30);
}

/** Announce a line to screen readers. `urgent` uses the assertive region (death, boss tells). */
export function announce(text: string, urgent = false): void {
  if (typeof document === 'undefined' || prefs().srAnnounce === false) return;
  mountAnnouncer();
  const now = performance.now();
  const d = announceDecision(state, text, urgent, now);
  if (d === 'drop') return;
  if (d === 'later') {
    if (pending) clearTimeout(pending.timer);
    const wait = POLITE_GAP_MS - (now - state.lastPoliteAt);
    pending = { text, timer: window.setTimeout(() => { pending = null; announce(text, false); }, Math.max(0, wait)) };
    return;
  }
  state.lastText = text; state.lastAt = now;
  if (urgent) speak(assertive!, text);
  else { state.lastPoliteAt = now; speak(polite!, text); }
}
