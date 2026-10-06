/**
 * Settings → Graphics (graphics pass): quality tier (Low / Medium / High) with session auto-adjust,
 * bloom, kill-chain lines, screen shake; `motionRow` is the reduced-motion control (System / Reduce / Full), shown
 * under Settings → Accessibility. Values live in
 * render/quality.ts (localStorage `citadel.gfx.v1`); the Renderer listens and applies them at once.
 * Bloom stays in the UI prefs (`bloom`) as before.
 */
import '../styles/graphics.css';
import { button, h } from './dom';
import { setPref } from './prefs';
import { gfxRuntime, gfxSettings, setGfxSettings, systemReducedMotion, type MotionPref, type QualityTier } from '@render/quality';
import type { UiCtx } from './ctx';

type RowFn = (label: string, control: HTMLElement, hint?: string, stack?: boolean) => HTMLElement;
type ToggleFn = (label: string, on: boolean, change: (v: boolean) => void) => HTMLElement;

const TIER_HINT: Record<QualityTier, string> = {
  high: 'Composite enemies, full ambience, all particles',
  medium: 'Fewer particles and details at high enemy counts',
  low: 'Base shapes, no bloom or ambience: for older phones',
};

/** A small inline segmented control (radio semantics). */
export function segmented<T extends string>(label: string, options: readonly [T, string][], value: T, change: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'gfx-seg', attrs: { role: 'radiogroup', 'aria-label': label } });
  const btns: HTMLButtonElement[] = [];
  const mark = (v: T): void => {
    options.forEach(([id], i) => { const on = id === v; btns[i].classList.toggle('active', on); btns[i].setAttribute('aria-checked', String(on)); });
  };
  for (const [id, text] of options) {
    const b = button(text, () => { mark(id); change(id); }, { class: 'gfx-seg-btn' });
    b.setAttribute('role', 'radio');
    btns.push(b);
    wrap.appendChild(b);
  }
  mark(value);
  return wrap;
}

/** The Graphics section's rows (spread into the Settings body in place of the old Bloom row). */
export function graphicsSettings(ctx: UiCtx, row: RowFn, toggle: ToggleFn): HTMLElement[] {
  const g = gfxSettings();
  const qHint = h('span', { class: 'dim small', text: '' });
  const refreshHint = (): void => {
    const q = gfxSettings().quality;
    qHint.textContent = gfxRuntime.autoLowered ? `Lowered to ${gfxRuntime.effective} this session (frames ran long)` : TIER_HINT[q];
  };
  refreshHint();
  const quality = segmented<QualityTier>('Graphics quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], g.quality, (q) => { setGfxSettings({ quality: q }); refreshHint(); });
  return [
    h('h3', { class: 'sec-title', text: 'Graphics' }),
    h('div', { class: 'set-row stack' }, h('div', { class: 'set-label' }, h('span', { text: 'Quality' }), qHint), quality),
    row('Auto-adjust quality', toggle('Auto-adjust quality', g.auto, (v) => { setGfxSettings({ auto: v }); refreshHint(); }), 'Lowers quality for this session when frames run long'),
    row('Bloom', toggle('Bloom', ctx.host.bloomOn(), (v) => { ctx.host.setBloom(v); setPref('bloom', v); }), 'Off on Low'),
    row('Kill-chain lines', toggle('Kill-chain lines', g.chainLines, (v) => setGfxSettings({ chainLines: v })), 'Thin links from each cause to its effect'),
    row('Screen shake', toggle('Screen shake', g.screenShake, (v) => setGfxSettings({ screenShake: v }))),
  ];
}

/** The one Reduced motion control (Settings → Accessibility since Phase 3; it also drives `body.reduce-motion`). */
export function motionRow(row: RowFn): HTMLElement {
  const motion = segmented<MotionPref>('Reduced motion', [['system', 'System'], ['reduce', 'Reduce'], ['full', 'Full']], gfxSettings().motion, (m) => setGfxSettings({ motion: m }));
  return row('Reduced motion', motion, systemReducedMotion() ? 'Your device asks for reduced motion' : 'No idle wobble, shake, punch or slow-motion; no UI animation; softer flashes', true);
}
