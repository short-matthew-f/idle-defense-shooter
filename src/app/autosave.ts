/**
 * "Never lose a purchase" (UX Phase 1). Pure helpers for app/game.ts:
 *  - `savesAfter(cmd)`: a player command that changes what a save holds (a purchase, a choice, an offer or draft
 *    pick, a Doctrine, a mount / attune, a setting...) schedules a save SAVE_DEBOUNCE_MS later.
 *  - `Debouncer`: one timer, restarted by every call, so a burst of taps saves once ~2 s after the last.
 *  - `updateBlocker`: why a waiting new version must not reload the page now (UX Phase 1, A-10).
 * The synchronous backup on pagehide / hidden and the "newer of IndexedDB vs backup" load live in app/storage.ts.
 */
import type { Command } from '@sim/core/types';

export const SAVE_DEBOUNCE_MS = 2000;

/** Commands that never change what the player would lose on a reload (aim, taps, casts, speed, holds...). */
const TRANSIENT: ReadonlySet<Command['type']> = new Set<Command['type']>([
  'manual_aim', 'designate', 'designate_at', 'cast', 'tap_assist', 'collect_salvage', 'overcharge', 'set_speed',
  'release_hold', 'offline_return',
]);

/** Does this player command warrant a debounced save? */
export function savesAfter(cmd: Pick<Command, 'type'>): boolean { return !TRANSIENT.has(cmd.type); }

type SetT = (fn: () => void, ms: number) => unknown;
type ClearT = (h: unknown) => void;

/** A restartable one-shot timer (timers injectable for tests). */
export class Debouncer {
  private handle: unknown = null;
  constructor(private readonly fn: () => void, private readonly ms: number,
    private readonly setT: SetT = (f, ms) => setTimeout(f, ms), private readonly clearT: ClearT = (h) => clearTimeout(h as ReturnType<typeof setTimeout>)) {}
  /** (Re)start the timer. */
  poke(): void {
    if (this.handle !== null) this.clearT(this.handle);
    this.handle = this.setT(() => { this.handle = null; this.fn(); }, this.ms);
  }
  /** A save is waiting to run. */
  get pending(): boolean { return this.handle !== null; }
  /** Run now if pending (e.g. on hide). */
  flush(): void { if (this.handle !== null) { this.clearT(this.handle); this.handle = null; this.fn(); } }
  cancel(): void { if (this.handle !== null) { this.clearT(this.handle); this.handle = null; } }
}

/** Pick the newer of two saves by savedAtMs (ties keep `a`, the primary store). */
export function newerSave<T extends { savedAtMs?: number }>(a: T | null, b: T | null): T | null {
  if (!a) return b;
  if (!b) return a;
  return (b.savedAtMs ?? 0) > (a.savedAtMs ?? 0) ? b : a;
}

/** Why an update must not reload now (null = it may). Pure; game.ts feeds it the live state. */
export function updateBlocker(s: { phase?: string; isBoss?: boolean; decision?: boolean; dialog?: boolean; sub?: boolean; input?: boolean; wave?: number; checkpoint?: number }): string | null {
  if (s.dialog) return 'dialog';
  if (s.sub) return 'sub-screen';
  if (s.input) return 'text input';
  if (s.decision) return 'decision pending';
  if (s.isBoss && s.phase === 'combat') return 'boss wave';
  if (s.phase === 'combat') return 'wave';
  // a reload resumes at checkpoint + 1: never trade cleared waves for an update
  if (s.wave !== undefined && s.checkpoint !== undefined && s.wave > s.checkpoint + 1) return 'progress since checkpoint';
  return null;
}
