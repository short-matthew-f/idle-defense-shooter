/**
 * The Prestige and More screens of the shell.
 *   Prestige: a segmented control over the Forecast (readouts, chart, the Prestige button), the
 *     Prestige layers shop and the Constellation / Ascend; each segment explains its lock.
 *   More: a list of rows (Inspector, Codex, Automation, Trials, Settings, Help) that push a
 *     sub-screen with a back button (the shell records it in the browser history).
 */
import '../styles/menu.css';
import type { UiState } from '@sim/core/types';
import { button, h, text, show, attr, clear } from './dom';
import { icon } from './icons';
import type { ForecastPanel } from './forecast';
import type { PrestigeShop } from './prestige-shop';
import type { ConstellationPanel } from './constellation';
import type { UiCtx } from './ctx';
import type { Features, FeatureId } from './progression';
import { earliestGate, gateText } from './echo-tiers';

const pr = (ui: UiState, id: string): number => ui.meta.prestigeRanks[`prestige.${id}`] | 0;

// ---------------------------------------------------------------- Prestige

export type PrestigeSeg = 'forecast' | 'layers' | 'ascension';
export const PRESTIGE_SEGS: { id: PrestigeSeg; label: string; lock: (ui: UiState) => string | null }[] = [
  { id: 'forecast', label: 'Forecast', lock: (ui) => (ui.run.deepestCleared < 20 && ui.meta.prestigeCount === 0 ? 'Opens at wave 20' : null) },
  { id: 'layers', label: 'Echo tiers', lock: (ui) => (ui.meta.deepestEver < 20 ? 'Reach wave 20 to open Echo tier I' : null) },
  { id: 'ascension', label: 'Ascension', lock: (ui) => (ui.meta.ascension === 0 && ui.run.deepestCleared < 100 ? 'Beat wave 100' : null) },
];

export class PrestigeScreen {
  readonly el: HTMLElement;
  private readonly seg = h('div', { class: 'seg-ctl', attrs: { role: 'tablist', 'aria-label': 'Prestige' } });
  private readonly body = h('div', { class: 'ps-body' });
  /** Progressive reveal: before the first Prestige the tab opens as a teaser. */
  private readonly teaser = h('p', { class: 'ps-teaser', text: 'Something is coming: Prestige starts a new, stronger machine. The Forecast says when it pays off.' });
  private readonly btns = new Map<PrestigeSeg, { b: HTMLButtonElement; lock: HTMLElement; dot: HTMLElement }>();
  private cur: PrestigeSeg = 'forecast';
  private shown = false;
  /** The segment on show changed (GameUi: the wallet bar follows it). */
  onViewChange: (() => void) | null = null;

  constructor(private readonly ctx: UiCtx, private readonly forecast: ForecastPanel, private readonly layers: PrestigeShop, private readonly stars: ConstellationPanel) {
    for (const s of PRESTIGE_SEGS) {
      const lock = icon('lock', 'ico tiny seg-lock');
      const dot = h('span', { class: 'seg-dot', attrs: { 'aria-hidden': 'true' } });
      const b = button([lock, s.label, dot], () => this.select(s.id), { class: 'seg-btn' });
      b.setAttribute('role', 'tab');
      this.btns.set(s.id, { b, lock: lock as unknown as HTMLElement, dot });
      this.seg.appendChild(b);
    }
    this.el = h('div', { class: 'prestige-screen' }, this.teaser, this.seg, this.body);
    this.render();
  }

  get segment(): PrestigeSeg { return this.cur; }

  select(s: PrestigeSeg): void {
    if (s === this.cur) return;
    this.cur = s;
    this.render();
    this.el.closest('.screen')?.scrollTo({ top: 0 });
    this.onViewChange?.();
  }

  setShown(on: boolean): void {
    this.shown = on;
    this.forecast.setShown(on && this.cur === 'forecast');
    this.layers.setShown(on && this.cur === 'layers');
    this.stars.setShown(on && this.cur === 'ascension');
    const ui = this.ctx.state();
    if (on && ui) this.update(ui);
  }

  private render(): void {
    const panel = this.cur === 'forecast' ? this.forecast.el : this.cur === 'layers' ? this.layers.el : this.stars.el;
    this.body.replaceChildren(panel);
    for (const [id, x] of this.btns) {
      x.b.classList.toggle('active', id === this.cur);
      attr(x.b, 'aria-selected', id === this.cur ? 'true' : 'false');
    }
    if (this.shown) this.setShown(true);
  }

  update(ui: UiState): void {
    if (!this.shown) return;
    show(this.teaser, ui.meta.prestigeCount === 0);
    for (const s of PRESTIGE_SEGS) {
      const x = this.btns.get(s.id)!;
      const lock = s.lock(ui);
      x.lock.style.display = lock ? '' : 'none';   // an SVG icon: `hidden` does not apply
      x.b.title = lock ?? '';
      attr(x.b, 'aria-label', lock ? `${s.label} (locked: ${lock})` : s.label);
      const alert = s.id === 'forecast' ? !!ui.forecast?.recommended : s.id === 'ascension' ? ui.run.deepestCleared >= 100 : false;
      x.dot.classList.toggle('on', alert);
    }
  }
}

// ---------------------------------------------------------------- More

export type MoreSub = 'codex' | 'automation' | 'trials' | 'settings' | 'help';
interface MoreItem { id: MoreSub | 'inspector'; label: string; icon: string; hint: string; lock?: (ui: UiState) => string | null; /** progressive reveal: listed once this is earned */ reveal?: FeatureId }

export const MORE_ITEMS: MoreItem[] = [
  { id: 'inspector', label: 'Kill-Chain Inspector', icon: 'inspector', hint: 'Pause the field and trace why things died', reveal: 'inspector' },
  { id: 'codex', label: 'Chain Codex', icon: 'codex', hint: 'Discovered interactions and rumours', reveal: 'codex' },
  { id: 'automation', label: 'Automation', icon: 'directives', hint: 'Directives, Targeting, Upgrade Queue, Blueprints', lock: (ui) => (pr(ui, 'directives') || pr(ui, 'blueprint_slots') ? null : earliestGate(['directives', 'blueprint_slots'], ui.meta.deepestEver)?.text ?? null), reveal: 'automation' },
  { id: 'trials', label: 'Trials', icon: 'trials', hint: 'Constraint runs with permanent rewards', lock: (ui) => gateText('trials', ui.meta.deepestEver, pr(ui, 'trials')), reveal: 'trials' },
  { id: 'settings', label: 'Settings', icon: 'settings', hint: 'Clarity, sound, saves, unlock everything, start over' },
  { id: 'help', label: 'Help & shortcuts', icon: 'info', hint: 'Tips, gestures, keys' },
];

export interface SubScreen { title: string; el: () => HTMLElement; onShow?: () => void; onHide?: () => void }

export class MoreScreen {
  readonly el: HTMLElement;
  private readonly list = h('nav', { class: 'more-list', attrs: { 'aria-label': 'More' } });
  private readonly sub = h('div', { class: 'more-sub' });
  private readonly subTitle = h('h2', { class: 'sub-title' });
  private readonly subBody = h('div', { class: 'sub-body' });
  private readonly locks = new Map<string, HTMLElement>();
  private readonly hints = new Map<string, HTMLElement>();
  private readonly rows = new Map<string, HTMLElement>();
  private current: MoreSub | null = null;
  private hidden = true;
  private lockKey = '';

  /**
   * `go(sub)` asks the shell to navigate (pushes history); `back()` pops the sub-screen;
   * `inspector()` switches to Battle and opens the Inspector overlay.
   */
  constructor(private readonly subs: Record<MoreSub, SubScreen>, nav: { go: (sub: MoreSub) => void; back: () => void; inspector: () => void }) {
    for (const it of MORE_ITEMS) {
      const lock = h('span', { class: 'mi-lock' });
      const hintEl = h('span', { class: 'mi-hint', text: it.hint });
      this.locks.set(it.id, lock);
      this.hints.set(it.id, hintEl);
      const row = button([
        icon(it.icon, 'ico'),
        h('span', { class: 'mi-main' }, h('span', { class: 'mi-label', text: it.label }), hintEl),
        lock, icon('right', 'ico tiny chev'),
      ], () => (it.id === 'inspector' ? nav.inspector() : nav.go(it.id)), { class: 'menu-item' });
      this.rows.set(it.id, row);
      this.list.appendChild(row);
    }
    const back = button([icon('left', 'ico'), 'More'], () => nav.back(), { class: 'btn ghost sub-back', label: 'Back to More' });
    this.sub.append(h('div', { class: 'sub-head' }, back, this.subTitle), this.subBody);
    this.sub.hidden = true;
    this.el = h('div', { class: 'more' }, this.list, this.sub);
  }

  /** Show the list (null) or a sub-screen. */
  show(sub: string | null): void {
    const next = sub && sub in this.subs ? (sub as MoreSub) : null;
    if (next === this.current) return;
    if (this.current) this.subs[this.current].onHide?.();
    this.current = next;
    show(this.list, !next);
    show(this.sub, !!next);
    clear(this.subBody);
    if (next) {
      const s = this.subs[next];
      text(this.subTitle, s.title);
      this.subBody.appendChild(s.el());
      s.onShow?.();
    }
    this.el.closest('.screen')?.scrollTo({ top: 0 });
  }

  /** The screen became visible showing `sub` (the shell calls this on every show). */
  enter(sub: string | null): void {
    const was = this.hidden;
    this.hidden = false;
    if ((sub ?? null) !== this.current) this.show(sub);
    else if (was && this.current) this.subs[this.current].onShow?.();
  }

  /** The screen was hidden (another tab): the open sub-screen stops updating. */
  hide(): void {
    if (this.hidden) return;
    this.hidden = true;
    if (this.current) this.subs[this.current].onHide?.();
  }

  update(ui: UiState, f?: Features): void {
    // progressive reveal: an item not yet earned is not listed (a sub-screen open on it goes back to the list)
    const shown = (it: MoreItem): boolean => !f || !it.reveal || f[it.reveal];
    const key = MORE_ITEMS.map((it) => `${shown(it) ? 1 : 0}${it.lock ? it.lock(ui) ?? '' : ''}`).join('|');
    if (key === this.lockKey) return;
    this.lockKey = key;
    if (this.current && !shown(MORE_ITEMS.find((x) => x.id === this.current)!)) this.show(null);
    for (const it of MORE_ITEMS) {
      this.rows.get(it.id)!.hidden = !shown(it);
      const el = this.locks.get(it.id)!;
      const lock = it.lock ? it.lock(ui) : null;
      // the lock names its real gate ("Reach wave 40 · buy Trials (120 Echoes)") in the row's own line; the badge just says Locked
      el.replaceChildren(...(lock ? [icon('lock', 'ico tiny'), 'Locked'] : []));
      text(this.hints.get(it.id)!, lock ?? it.hint);
      el.parentElement?.classList.toggle('locked', !!lock);
    }
  }
}
