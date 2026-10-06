/**
 * Phase 3 timing and input assists (Settings → Accessibility). Owned by the input/timing work: tap hold delay,
 * Overcharge auto-release, tell-window assist, haptic cues. The Accessibility group in settings.ts appends these rows.
 *
 *  - Hold delay: per-device pref (prefs.holdDelayMs), read by app/input.ts at every press.
 *  - Overcharge auto-release: per-device pref (prefs.overchargeAssist), ui/active.ts sends the normal release.
 *  - Longer boss tell windows: a SIM setting (meta.settings.tellAssist via `set_setting`), so it is saved with the game
 *    and deterministic; the sim stretches every tell window ×1.5 (data/bosses.ts tellWindowTicks).
 *  - Vibration cues: per-device pref (prefs.hapticCues); the row only exists where navigator.vibrate does (not iOS).
 */
import { button, h } from './dom';
import { prefs, setPref } from './prefs';
import { vibrationSupported } from './assist-cues';
import { HOLD_DELAYS } from '@app/input';
import type { UiCtx } from './ctx';

export type RowFn = (label: string, control: HTMLElement, hint?: string, stack?: boolean) => HTMLElement;
export type ToggleFn = (label: string, on: boolean, change: (v: boolean) => void) => HTMLLabelElement;

const DELAY_LABELS = ['Default', 'Longer', 'Longest'] as const;

/** The hold-delay step nearest a stored value (0 / 150 / 300 ms). */
export function holdDelayStep(ms: number): number {
  let best = 0;
  HOLD_DELAYS.forEach((d, i) => { if (Math.abs(d - ms) < Math.abs(HOLD_DELAYS[best] - ms)) best = i; });
  return best;
}

/** A small inline segmented control (radio semantics; same look as Settings → Graphics). */
function segmented(label: string, options: readonly string[], value: number, change: (i: number) => void): HTMLElement {
  const wrap = h('div', { class: 'gfx-seg', attrs: { role: 'radiogroup', 'aria-label': label } });
  const btns: HTMLButtonElement[] = [];
  const mark = (v: number): void => {
    btns.forEach((b, i) => { const on = i === v; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
  };
  options.forEach((text, i) => {
    const b = button(text, () => { mark(i); change(i); }, { class: 'gfx-seg-btn' });
    b.setAttribute('role', 'radio');
    btns.push(b);
    wrap.appendChild(b);
  });
  mark(value);
  return wrap;
}

/** The first boss wave: a player who has not reached it has never seen a tell (progressive reveal). */
const FIRST_BOSS_WAVE = 5;

/** Rows for the Accessibility group. Rows naming Overcharge or boss tells wait until the player has met them. */
export function assistSettingRows(ctx: UiCtx, row: RowFn, toggle: ToggleFn): HTMLElement[] {
  const p = prefs();
  const ui = ctx.state();
  const delay = segmented('Hold delay', DELAY_LABELS, holdDelayStep(p.holdDelayMs), (i) => setPref('holdDelayMs', HOLD_DELAYS[i]));
  const f = ctx.features();
  const bosses = f.abilities || Math.max(ui?.run.wave ?? 0, ui?.meta.deepestEver ?? 0) >= FIRST_BOSS_WAVE;
  const rows = [row('Hold delay', delay, 'How long a press waits before it steers aim', true)];
  if (f.overcharge) rows.push(row('Overcharge auto-release', toggle('Overcharge auto-release', p.overchargeAssist, (v) => setPref('overchargeAssist', v)),
      'Lets go for you at the end of the bright band'));
  if (bosses) rows.push(row('Longer boss tell windows', toggle('Longer boss tell windows', !!ui?.meta.settings.tellAssist, (v) => {
      setPref('tellAssist', v);   // mirror only; the sim setting is the source of truth
      ctx.host.send({ type: 'set_setting', key: 'tellAssist', value: v });
    }), 'Boss warnings stay open 50% longer'));
  if (vibrationSupported()) {
    rows.push(row('Vibration cues', toggle('Vibration cues', p.hapticCues, (v) => setPref('hapticCues', v)),
      bosses ? 'Buzz when a boss warns and when HP runs low' : 'Buzz when HP runs low'));
  }
  return rows;
}
