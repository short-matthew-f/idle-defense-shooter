/**
 * Boss tells and the unlock ladder (pure rules; the DOM lives in hud.ts and abilities.ts).
 *  - Before the `abilities` feature is revealed a tell is information only.
 *  - After: counter slotted -> cast; an empty usable slot -> equip there; otherwise ask before replacing (and offer Undo).
 *  - Before a boss wave, the "between" card names the counter so the loadout is prepared outside the 1 s window.
 */
import type { AbilityId } from '@sim/core/ids';
import { BOSS_BY_ID } from './content';

export type TellDecision = 'info' | 'cast' | 'equip-empty' | 'confirm-replace';

export interface SlotView {
  /** build.abilities (may hold more entries than are usable). */
  slots: readonly (AbilityId | null)[];
  /** UiState.abilitySlots (undefined: all of them). */
  usable?: number;
}

const usableOf = (s: SlotView): number => Math.min(s.slots.length, s.usable ?? s.slots.length);

/** Slot index holding `ability` within the usable slots, or -1. */
export function usableSlotOf(s: SlotView, ability: AbilityId): number {
  const i = s.slots.indexOf(ability);
  return i >= 0 && i < usableOf(s) ? i : -1;
}

/** The slot an equip goes to: the first empty usable slot, else slot 0 (a replacement). */
export function equipTarget(s: SlotView): { slot: number; replaces: AbilityId | null } {
  const n = usableOf(s);
  for (let i = 0; i < n; i++) if (!s.slots[i]) return { slot: i, replaces: null };
  return { slot: 0, replaces: s.slots[0] ?? null };
}

export function tellDecision(i: SlotView & { revealed: boolean; counter: AbilityId }): TellDecision {
  if (!i.revealed) return 'info';
  if (usableSlotOf(i, i.counter) >= 0) return 'cast';
  return equipTarget(i).replaces ? 'confirm-replace' : 'equip-empty';
}

export interface PreBossInfo { bossName: string; tellName: string; ability: AbilityId; slot: number; replaces: AbilityId | null }

/** One key per boss wave per attempt: the card shows at most once for it. */
export const preBossKey = (attempts: number, wave: number): string => `${attempts}|${wave}`;

/**
 * The pre-boss card, or null: in `between`, the wave about to start is a boss wave, abilities are revealed, the boss has an
 * ability Counter and it is not slotted (usable), and the card has not been shown for this wave and attempt.
 */
export function preBossInfo(i: SlotView & { phase: string; wave: number; attempts: number; revealed: boolean; bossFor: (wave: number) => string | null; handled: string | null }): PreBossInfo | null {
  if (!i.revealed || i.phase !== 'between' || i.wave < 5 || i.wave % 5 !== 0) return null;
  if (i.handled === preBossKey(i.attempts, i.wave)) return null;
  const id = i.bossFor(i.wave);
  const def = id ? BOSS_BY_ID.get(id as never) : undefined;
  const counter = def?.tell.counter;
  if (!def || !counter || counter === 'designate') return null;
  if (usableSlotOf(i, counter) >= 0) return null;
  const t = equipTarget(i);
  return { bossName: def.name, tellName: def.tell.name, ability: counter, slot: t.slot, replaces: t.replaces };
}
