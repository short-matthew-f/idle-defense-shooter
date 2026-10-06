/**
 * The Prestige and More screens of the shell.
 *   Prestige: one breadcrumb line "View ▾ › Tier ▾" (crumbs.ts) over the Forecast (readouts, chart, the Prestige
 *     button), the Echo tiers shop (one tier at a time: "Tier ▾") and the Constellation / Ascend. The View menu lists
 *     the three views; a locked one shows its lock and reason and cannot be picked. A swipe (or ← / →) steps along the
 *     unlocked views, Echo tiers through its four tiers.
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
import { ECHO_TIERS, earliestGate, gateText } from './echo-tiers';
import { CrumbMenu, crumbButton, crumbGap, crumbLine, crumbSep, paintCrumb, slideIn, stepStop, wireSwipe, type Crumb, type NavStop } from './crumbs';

const pr = (ui: UiState, id: string): number => ui.meta.prestigeRanks[`prestige.${id}`] | 0;

// ---------------------------------------------------------------- Prestige

export type PrestigeSeg = 'forecast' | 'layers' | 'ascension';
export const PRESTIGE_SEGS: { id: PrestigeSeg; label: string; lock: (ui: UiState) => string | null }[] = [
  { id: 'forecast', label: 'Forecast', lock: (ui) => (ui.run.deepestCleared < 20 && ui.meta.prestigeCount === 0 ? 'Opens at wave 20' : null) },
  { id: 'layers', label: 'Echo tiers', lock: (ui) => (ui.meta.deepestEver < 20 ? 'Reach wave 20 to open Echo tier I' : null) },
  { id: 'ascension', label: 'Ascension', lock: (ui) => (ui.meta.ascension === 0 && ui.run.deepestCleared < 100 ? 'Beat wave 100' : null) },
];

/** The roman numeral of an Echo tier (1–4). */
const ROMAN = ['I', 'II', 'III', 'IV'];

export class PrestigeScreen {
  /** The screen: the pinned breadcrumb line over its own scroller (the shell's top row holds the Echoes balance). */
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly panel = h('div', { class: 'ps-body crumb-page-body' });
  /** Progressive reveal: before the first Prestige the tab opens as a teaser. */
  private readonly teaser = h('p', { class: 'ps-teaser', text: 'Something is coming: Prestige starts a new, stronger machine. The Forecast says when it pays off.' });
  private readonly viewC: Crumb;
  private readonly sep = crumbSep();
  private readonly tierC: Crumb;
  private readonly menu = new CrumbMenu();
  private cur: PrestigeSeg = 'forecast';
  private shown = false;
  private slide: -1 | 0 | 1 = 0;
  /** The segment on show changed (GameUi: the wallet bar follows it). */
  onViewChange: (() => void) | null = null;

  constructor(private readonly ctx: UiCtx, private readonly forecast: ForecastPanel, private readonly layers: PrestigeShop, private readonly stars: ConstellationPanel) {
    this.viewC = crumbButton(() => this.openViewMenu(), { cls: 'crumb-page', hint: 'view-menu' });
    this.tierC = crumbButton(() => this.openTierMenu(), { cls: 'crumb-tree', hint: 'tier-menu', dotCls: 'chip-dot', count: true });
    const head = h('div', { class: 'crumb-head' }, crumbLine('Prestige: view', this.viewC.btn, this.sep, this.tierC.btn, crumbGap()));
    this.body = h('div', { class: 'crumb-body' }, this.teaser, this.panel);
    this.el = h('div', { class: 'crumb-screen prestige-screen', attrs: { 'aria-label': 'Prestige' } }, head, this.body);
    // the Constellation map's stars are tapped, never swiped from
    wireSwipe(this.body, (d) => this.step(d), 'button, input, label, select, .pick-card, .fork-cards, g.star');
    this.render();
  }

  get segment(): PrestigeSeg { return this.cur; }

  select(s: PrestigeSeg): void {
    if (s === this.cur) return;
    this.menu.close();
    this.cur = s;
    if (s === 'layers' && this.layers.guiding) this.layers.setTier(1);   // the first-Prestige guide's picks are in tier I
    this.render();
    this.body.scrollTop = 0;
    this.onViewChange?.();
  }

  /** Echo tiers: show tier `t` (1–4). */
  selectTier(t: number): void {
    this.menu.close();
    if (this.cur !== 'layers') this.select('layers');
    if (this.layers.tier !== t) { this.layers.setTier(t); this.body.scrollTop = 0; slideIn(this.panel, this.slide); }
    this.slide = 0;
    const ui = this.ctx.state();
    if (ui) this.update(ui);
  }

  /** The swipe order: the unlocked views, Echo tiers flattened into its four tiers. */
  private stops(ui: UiState): NavStop<PrestigeSeg>[] {
    const out: NavStop<PrestigeSeg>[] = [];
    for (const s of PRESTIGE_SEGS) {
      if (s.lock(ui) && s.id !== this.cur) continue;
      if (s.id === 'layers') for (let t = 1; t <= ECHO_TIERS.length; t++) out.push({ cat: 'layers', tree: String(t) });
      else out.push({ cat: s.id, tree: '' });
    }
    return out;
  }

  /** Next (+1) / previous (-1) view or tier (swipe on the page, ← / →). False at either end. */
  step(dir: -1 | 1): boolean {
    const ui = this.ctx.state();
    if (!ui) return false;
    const next = stepStop(this.stops(ui), this.cur, this.cur === 'layers' ? String(this.layers.tier) : '', dir);
    if (!next) return false;
    this.slide = dir;
    if (next.cat === 'layers') {
      const t = Number(next.tree);
      if (this.cur !== 'layers') { this.layers.setTier(t); this.select('layers'); slideIn(this.panel, dir); this.slide = 0; this.update(ui); }
      else this.selectTier(t);
    } else { this.select(next.cat); slideIn(this.panel, dir); this.slide = 0; }
    return true;
  }

  setShown(on: boolean): void {
    this.shown = on;
    if (!on) this.menu.close();
    this.forecast.setShown(on && this.cur === 'forecast');
    this.layers.setShown(on && this.cur === 'layers');
    this.stars.setShown(on && this.cur === 'ascension');
    const ui = this.ctx.state();
    if (on && ui) this.update(ui);
  }

  private render(): void {
    const panel = this.cur === 'forecast' ? this.forecast.el : this.cur === 'layers' ? this.layers.el : this.stars.el;
    this.panel.replaceChildren(panel);
    if (this.shown) this.setShown(true);
  }

  /** A view's attention: the Forecast recommends a Prestige; Ascension is open. */
  private alert(ui: UiState, s: PrestigeSeg): string | null {
    return s === 'forecast' ? (ui.forecast?.recommended ? 'Prestige recommended' : null) : s === 'ascension' ? (ui.run.deepestCleared >= 100 ? 'Ascension open' : null) : null;
  }

  private openViewMenu(): void {
    const ui = this.ctx.state();
    if (!ui) return;
    const rows: HTMLElement[] = [];
    for (const s of PRESTIGE_SEGS) {
      const cur = s.id === this.cur;
      rows.push(this.menu.row({ label: s.label, current: cur, lock: s.lock(ui), dot: this.alert(ui, s.id), hint: `pview-${s.id}`,
        onPick: () => { if (cur) this.body.scrollTop = 0; else this.select(s.id); } }));
      // under Echo tiers on show: its tiers as indented jump links
      if (cur && s.id === 'layers') for (const t of this.layers.tierState(ui)) rows.push(this.menu.row({ label: tierName(t.layer), sub: true, onPick: () => this.selectTier(t.layer) }));
    }
    this.menu.open(this.viewC.btn, 'Prestige views', rows, 'view-menu');
  }

  private openTierMenu(): void {
    const ui = this.ctx.state();
    if (!ui || this.cur !== 'layers') return;
    const rows = this.layers.tierState(ui).map((t) => this.menu.row({ label: tierName(t.layer), current: t.layer === this.layers.tier, count: t.affordable,
      status: t.open ? null : `wave ${t.wave}`, onPick: () => this.selectTier(t.layer) }));
    this.menu.open(this.tierC.btn, 'Echo tiers', rows, 'tier-menu');
  }

  update(ui: UiState): void {
    if (!this.shown) return;
    show(this.teaser, ui.meta.prestigeCount === 0);
    const def = PRESTIGE_SEGS.find((s) => s.id === this.cur)!;
    const lock = def.lock(ui);
    const others = PRESTIGE_SEGS.filter((s) => s.id !== this.cur).map((s) => this.alert(ui, s.id)).filter(Boolean);
    paintCrumb(this.viewC, { label: def.label, menuable: true, dot: others.length > 0,
      aria: `View: ${def.label}${lock ? ` (locked: ${lock})` : ''}. Choose a view${others.length ? ` (${others[0]})` : ''}` });
    this.viewC.btn.dataset.views = PRESTIGE_SEGS.map((s) => `${s.id}:${s.lock(ui) ? 'locked' : 'open'}`).join(',');   // tests
    const tiers = this.cur === 'layers';
    show(this.tierC.btn, tiers);
    show(this.sep, tiers);
    if (tiers) {
      const st = this.layers.tierState(ui).find((t) => t.layer === this.layers.tier);
      const name = tierName(this.layers.tier);
      paintCrumb(this.tierC, { label: tierName(this.layers.tier, true), menuable: true, count: st?.affordable ?? 0, aria: `Tier: ${name}${st && !st.open ? ` (opens at wave ${st.wave})` : ''}. Choose a tier` });
    }
  }
}

/** "Tier I · Inheritance" (the menus), or "Tier I" (the crumb, `short`). */
function tierName(layer: number, short = false): string {
  const t = ECHO_TIERS[layer - 1];
  return t && !short ? `Tier ${ROMAN[layer - 1]} · ${t.name}` : `Tier ${ROMAN[layer - 1] ?? layer}`;
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
