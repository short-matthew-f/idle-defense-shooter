/**
 * What the screen reader hears (Phase 3, A-20): boss start, each boss tell (the tell line's own text), Prestige
 * recommended. Deaths are announced from GameUi.onEvents (Ev.TowerDeath). Pure diff + a small driver.
 */
import type { UiState } from '@sim/core/types';
import { announce } from './announce';

export interface SrSnap { bossLive: boolean; bossName: string; tell: string | null; prestigeRec: boolean }
export interface SrLine { text: string; urgent: boolean }

/** The lines to announce going from `prev` to `next` (pure). */
export function srLines(prev: SrSnap | null, next: SrSnap): SrLine[] {
  if (!prev) return [];   // the first UiState after boot sets the baseline: nothing is "new" on load
  const out: SrLine[] = [];
  if (next.bossLive && !prev.bossLive) out.push({ text: `Boss: ${next.bossName}`, urgent: false });
  if (next.tell && next.tell !== prev.tell) out.push({ text: next.tell, urgent: true });
  if (next.prestigeRec && !prev.prestigeRec) out.push({ text: 'Prestige recommended', urgent: false });
  return out;
}

export class SrWatch {
  private prev: SrSnap | null = null;
  /** `tellText` reads the tell line's current text (the boss bar's), or null when no tell is up. */
  constructor(private readonly tellText: () => string | null, private readonly bossName: () => string) {}
  update(ui: UiState, prestigeRevealed: boolean): void {
    const bossLive = ui.wave.isBoss && ui.run.phase === 'combat' && ui.wave.bossHp > 0;
    const next: SrSnap = {
      bossLive,
      bossName: bossLive ? this.bossName() : '',
      tell: ui.wave.tellActive !== null ? this.tellText() : null,
      prestigeRec: prestigeRevealed && !!ui.forecast?.recommended,
    };
    for (const l of srLines(this.prev, next)) announce(l.text, l.urgent);
    this.prev = next;
  }
}
