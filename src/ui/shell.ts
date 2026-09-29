/**
 * The UI shell: owns the tab bar, the screens, the status strip, the browser history and the
 * Battle camera insets.
 *
 *   phone (portrait)   Battle is the arena; Upgrades / Build / Prestige / More are full-screen tabs
 *                      over it, switched from a bottom tab bar. A status strip on those screens shows
 *                      wave, HP and Scrap and returns to Battle. The renderer pauses (the sim keeps
 *                      running) while a full-screen tab covers the arena.
 *   rail (landscape)   the same, with the tabs on a left rail so the arena keeps its height.
 *   desktop (≥ 900 px) the arena stays visible; the four screens are tabs of a side panel.
 *
 * History (phone / rail): each tab pushes one entry above Battle and switching tabs replaces it, a
 * More sub-screen pushes one more; so the iOS swipe-back and Android back walk sub-screen → tab →
 * Battle (NavModel in shell-logic.ts mirrors the stack).
 */
import '../styles/shell.css';
import type { UiState } from '@sim/core/types';
import { button, h, text, attr, show } from './dom';
import { icon } from './icons';
import { BATTLE, NavModel, PANEL_WIDTH, RAIL_WIDTH, TABS, battleInsets, readNavState, shellLayout, tabBadges, writeNavState, type NavOp, type NavState, type ShellLayout, type TabId } from './shell-logic';
import { anyModalOpen } from './modal';
import { prefs, setPref } from './prefs';
import type { UiHost } from './host';
import type { StatusStrip } from './hud';

export type ScreenId = Exclude<TabId, 'battle'>;

export interface ScreenSpec {
  /** Screen content. */
  el: HTMLElement;
  /** The screen manages its own scrolling (Upgrades: pinned chips over a scrolling list). */
  ownScroll?: boolean;
  /** Became visible (with the sub-screen to show, More only) / hidden. */
  onShow?: (sub: string | null) => void;
  onHide?: () => void;
}

export interface ShellParts {
  topbar: HTMLElement;
  /** Everything that floats over the arena (boss bar, controls, death card, abilities). */
  battle: HTMLElement;
  abilities: HTMLElement;
  toasts: HTMLElement;
  strip: StatusStrip;
  screens: Record<ScreenId, ScreenSpec>;
}

export class Shell {
  layout: ShellLayout = 'phone';
  readonly tabbar: HTMLElement;
  readonly screensEl: HTMLElement;
  private readonly tabBtns = new Map<TabId, { b: HTMLButtonElement; badge: HTMLElement }>();
  private readonly screenEls = new Map<ScreenId, HTMLElement>();
  private readonly reopen: HTMLButtonElement;
  readonly nav = new NavModel();
  /** What the phone shows (Battle or a tab / sub-screen). */
  private view: NavState = BATTLE;
  /** The desktop side panel's tab (never Battle). */
  private panel: NavState = { tab: 'upgrades', sub: null };
  /** The screen currently visible (null = none: phone on Battle, or desktop panel closed). */
  private visible: NavState | null = null;
  panelOpen: boolean;
  private badgeKey = '';
  /** Called after the layout or insets changed. */
  onLayout: (() => void) | null = null;

  constructor(root: HTMLElement, private readonly host: UiHost, private readonly parts: ShellParts) {
    this.panelOpen = prefs().panelOpen;
    this.tabbar = h('nav', { class: 'tabbar', attrs: { 'aria-label': 'Screens', role: 'tablist' } });
    for (const t of TABS) {
      const badge = h('span', { class: 'tab-badge', attrs: { 'aria-hidden': 'true' } });
      const b = button([h('span', { class: 'tab-ico' }, icon(t.icon, 'ico'), badge), h('span', { class: 'tab-label', text: t.label })],
        () => this.onTab(t.id), { class: `tab-btn t-${t.id}`, title: t.hint });
      b.setAttribute('role', 'tab');
      b.dataset.tab = t.id;
      badge.hidden = true;
      this.tabBtns.set(t.id, { b, badge });
      this.tabbar.appendChild(b);
    }
    const close = button(icon('close'), () => this.setPanelOpen(false), { class: 'btn icon-btn ghost panel-close', label: 'Hide the side panel (B)' });
    this.tabbar.appendChild(close);
    this.reopen = button([icon('panel', 'ico tiny'), 'Panel'], () => this.setPanelOpen(true), { class: 'btn ctl panel-reopen', label: 'Show the side panel (B)' });
    parts.battle.querySelector('.battle-controls')?.appendChild(this.reopen);

    this.screensEl = h('div', { class: 'screens' }, parts.strip.el);
    for (const id of Object.keys(parts.screens) as ScreenId[]) {
      const spec = parts.screens[id];
      const el = h('section', { class: `screen s-${id}${spec.ownScroll ? ' own-scroll' : ''}`, attrs: { 'aria-label': TABS.find((t) => t.id === id)?.label ?? id } }, spec.el);
      el.hidden = true;
      this.screenEls.set(id, el);
      this.screensEl.appendChild(el);
    }
    root.prepend(parts.topbar, parts.battle, this.screensEl, parts.toasts, this.tabbar);

    // history: Battle is the bottom entry
    try { history.replaceState(writeNavState(BATTLE), ''); } catch { /* sandboxed frames */ }
    window.addEventListener('popstate', (e) => this.onPop(e.state));
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || anyModalOpen() || this.layout === 'desktop' || this.view.tab === 'battle') return;
      if (document.body.classList.contains('arming')) return;   // Esc cancels the armed ability first
      e.preventDefault();
      this.back();
    });
    // border-box: the safe-area insets are padding, so a notch / rotation change must re-measure the bars too
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.relayout()) : null;
    for (const el of [parts.topbar, parts.abilities, this.tabbar]) ro?.observe(el, { box: 'border-box' });
    window.addEventListener('resize', () => this.relayout());
    this.relayout();
    this.apply();
  }

  /** The tab on screen (desktop: 'battle' when only the arena is in focus is never reported; the panel tab is). */
  get tab(): TabId { return this.layout === 'desktop' ? this.panel.tab : this.view.tab; }
  get sub(): string | null { return this.layout === 'desktop' ? this.panel.sub : this.view.sub; }
  /** Is this screen visible right now? */
  isShown(id: ScreenId): boolean { return this.visible?.tab === id; }
  /** Is the Battle arena visible (always on desktop)? */
  get battleVisible(): boolean { return this.layout === 'desktop' || this.view.tab === 'battle'; }

  /** Navigate to a tab (and a More sub-screen). */
  go(tab: TabId, sub: string | null = null): void {
    if (this.layout === 'desktop') {
      if (tab === 'battle') return;
      this.panel = { tab, sub };
      if (!this.panelOpen) { this.setPanelOpen(true); return; }
      this.apply();
      return;
    }
    this.run(this.nav.go({ tab, sub }));
    this.view = this.nav.current;
    if (this.view.tab !== 'battle') this.panel = this.view;
    this.apply();
  }

  /** Back: a sub-screen → its tab; a tab → Battle. */
  back(): void {
    const cur = this.layout === 'desktop' ? this.panel : this.view;
    if (cur.sub) this.go(cur.tab, null);
    else this.go('battle');
  }

  private onTab(tab: TabId): void {
    const cur = this.layout === 'desktop' ? this.panel : this.view;
    if (tab === cur.tab) {
      if (cur.sub) this.go(tab, null);                                   // re-tap: pop to the tab's root
      else this.screenEls.get(tab as ScreenId)?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    this.go(tab);
  }

  private onPop(state: unknown): void {
    if (this.layout === 'desktop') return;
    const r = this.nav.pop(readNavState(state));
    this.run(r.ops);
    this.view = r.show;
    if (this.view.tab !== 'battle') this.panel = this.view;
    this.apply();
  }

  private run(ops: NavOp[]): void {
    for (const o of ops) {
      try {
        if (o.op === 'back') history.go(-o.n);
        else if (o.op === 'push') history.pushState(writeNavState(o.state), '');
        else history.replaceState(writeNavState(o.state), '');
      } catch { /* history unavailable */ }
    }
  }

  setPanelOpen(on: boolean): void {
    this.panelOpen = on;
    setPref('panelOpen', on);
    this.apply();
    this.relayout();
  }

  togglePanel(): void {
    if (this.layout === 'desktop') this.setPanelOpen(!this.panelOpen);
    else this.go(this.view.tab === 'upgrades' ? 'battle' : 'upgrades');
  }

  /** Show / hide screens and tab states for the current layout and view. */
  private apply(): void {
    const desk = this.layout === 'desktop';
    const want: NavState | null = desk ? (this.panelOpen ? this.panel : null) : this.view.tab === 'battle' ? null : this.view;
    const prev = this.visible;
    if (prev && (!want || want.tab !== prev.tab)) this.parts.screens[prev.tab as ScreenId]?.onHide?.();
    this.visible = want;
    for (const [id, el] of this.screenEls) show(el, want?.tab === id);
    if (want) this.parts.screens[want.tab as ScreenId]?.onShow?.(want.sub);

    const b = document.body.classList;
    const shownTab = desk ? this.panel.tab : this.view.tab;
    for (const t of TABS) b.toggle(`tab-${t.id}`, t.id === (want ? want.tab : 'battle'));
    b.toggle('panel-closed', desk && !this.panelOpen);
    for (const [id, x] of this.tabBtns) {
      const on = id === shownTab && (!desk || this.panelOpen);
      x.b.classList.toggle('active', on);
      attr(x.b, 'aria-selected', on ? 'true' : 'false');
    }
    show(this.reopen, desk && !this.panelOpen);
    show(this.parts.strip.el, !desk);
    // a full-screen tab hides the arena: stop drawing it (the sim keeps running) until Battle is back
    this.host.setRenderPaused(!desk && this.view.tab !== 'battle');
  }

  /** Layout mode, measured bar heights (CSS vars) and camera insets. */
  relayout(): void {
    const layout = shellLayout(window.innerWidth, window.innerHeight);
    const changed = layout !== this.layout;
    this.layout = layout;
    const b = document.body.classList;
    b.toggle('shell-phone', layout === 'phone');
    b.toggle('shell-rail', layout === 'rail');
    b.toggle('shell-desktop', layout === 'desktop');
    if (changed) {
      if (layout === 'desktop' && this.view.tab !== 'battle') this.panel = this.view;
      this.apply();
    }
    const r = document.documentElement.style;
    r.setProperty('--panel-w', `${PANEL_WIDTH}px`);
    r.setProperty('--rail-w', `${RAIL_WIDTH}px`);
    const topH = Math.ceil(this.parts.topbar.getBoundingClientRect().height);
    r.setProperty('--top-h', `${topH}px`);
    const tabH = layout === 'phone' ? Math.ceil(this.tabbar.getBoundingClientRect().height) : 0;
    r.setProperty('--tab-h', `${tabH}px`);
    const railW = layout === 'rail' ? Math.ceil(this.tabbar.getBoundingClientRect().width) : 0;
    const ab = this.parts.abilities.getBoundingClientRect();
    const abilities = layout === 'desktop' ? (ab.height ? Math.ceil(ab.height) + 24 : 0) : layout === 'rail' ? (ab.width ? Math.ceil(ab.width) + 16 : 0) : 0;
    const i = battleInsets(layout, { top: topH, tabBar: tabH, rail: railW, abilities, panel: layout === 'desktop' && this.panelOpen ? PANEL_WIDTH : 0 });
    this.host.setInsets(i.top, i.right, i.bottom, i.left);
    this.onLayout?.();
  }

  /** Badges and the status strip (10 Hz). */
  update(ui: UiState): void {
    this.parts.strip.update(ui);
    const badges = tabBadges(ui);
    const key = TABS.map((t) => { const x = badges[t.id]; return x ? `${x.kind}${x.text}` : ''; }).join('|');
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    for (const t of TABS) {
      const x = badges[t.id], el = this.tabBtns.get(t.id)!;
      show(el.badge, !!x);
      text(el.badge, x ? x.text : '');
      el.badge.className = `tab-badge${x ? ` ${x.kind}` : ''}`;
      attr(el.b, 'aria-label', x ? `${t.label}: ${x.label}` : t.label);
    }
  }

  /** The screen element of a tab (for scrolling). */
  screen(id: ScreenId): HTMLElement | undefined { return this.screenEls.get(id); }
}
