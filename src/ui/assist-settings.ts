/**
 * Phase 3 timing and input assists (Settings → Accessibility). Owned by the input/timing work: tap hold delay,
 * Overcharge auto-release, tell-window assist, haptic cues. The Accessibility group in settings.ts appends these rows.
 */
import type { UiCtx } from './ctx';

export type RowFn = (label: string, control: HTMLElement, hint?: string, stack?: boolean) => HTMLElement;
export type ToggleFn = (label: string, on: boolean, change: (v: boolean) => void) => HTMLLabelElement;

/** Rows for the Accessibility group (filled in by the input/timing work). */
export function assistSettingRows(_ctx: UiCtx, _row: RowFn, _toggle: ToggleFn): HTMLElement[] {
  return [];
}
