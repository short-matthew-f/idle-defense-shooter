/**
 * The UI shell: owns the tab bar, the screens, the status strip, the browser history and the
 * Battle camera insets.
 *
 *   phone (portrait)   Battle is the arena; Upgrades / Build / Prestige / More are full-screen tabs
 *                      over it, switched from a bottom tab bar. One top row on those screens, outside every
 *                      scroller: the wallet (the balances the screen spends, every layout) on the left and a
 *                      compact "Battle ›" button (the status strip: tower HP as a thin bar, red when low) on the
 *                      right; with no wallet (More) the strip shows wave, HP and Scrap in full. The renderer
 *                      pauses (the sim keeps running) while a full-screen tab covers the arena.
 *   rail (landscape)   the same, with the tabs on a left rail so the arena keeps its height.
 *   desktop (≥ 900 px) the arena stays visible; the four screens are tabs of a side panel.
 *
 * History (phone / rail): each tab pushes one entry above Battle and switching tabs replaces it, a
 * More sub-screen pushes one more; so the iOS swipe-back and Android back walk sub-screen → tab →
 * Battle (NavModel in shell-logic.ts mirrors the stack).
 *
 * Progressive reveal (progression.ts): tabs not yet earned are not rendered (`hidden`), and with no tab but
 * Battle the bar itself goes (body.no-tabbar). More stays reachable (Settings, Help) from a Battle chip.
 * A tab that stops being available while on screen (Unlock everything switched off) falls back to Battle.
 * A newly revealed tab carries a "New" badge until it is first opened (prefs.tabsVisited).
 */
import '../styles/shell.css';
import type { UiState } from '@sim/core/types';
import { button, h, text, attr, show } from './dom';
import { icon } from './icons';
import { BATTLE, NavModel, PANEL_WIDTH, DOCK_GAP, PHONE_ARENA_BIAS, STARTER_CONTENT, RAIL_WIDTH, TABS, battleInsets, readNavState, shellLayout, tabBadges, tabReachable, tabsShown, writeNavState, type NavOp, type NavState, type ShellLayout, type TabId } from './shell-logic';
import { features as featuresOf, type Features } from './progression';
import { anyModalOpen, handleBackWithModal } from './modal';
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
  /** The balances of what the screen in view spends (wallet.ts), pinned in the top row outside every scroller. */
  wallet?: HTMLElement;
  /** A control that rides in the top row between the wallet and the Battle button (Upgrades: the buy-quantity chip). */
  topExtra?: HTMLElement;
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
  /** What the unlock ladder reveals (GameUi sets it from every UiState; stage 0 until then). */
  private feats: Features = featuresOf({ run: { deepestCleared: 0 }, meta: { deepestEver: 0, prestigeCount: 0 } }, { unlockAll: prefs().unlockAll });
  private shownKey = '';
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
      b.dataset.hint = `tab-${t.id}`;   // pointer hints (hints.ts)
      badge.hidden = true;
      this.tabBtns.set(t.id, { b, badge });
      this.tabbar.appendChild(b);
    }
    const close = button(icon('close'), () => this.setPanelOpen(false), { class: 'btn icon-btn ghost panel-close', label: 'Hide the side panel (B)' });
    this.tabbar.appendChild(close);
    this.reopen = button([icon('panel', 'ico tiny'), 'Panel'], () => this.setPanelOpen(true), { class: 'btn ctl panel-reopen', label: 'Show the side panel (B)' });
    parts.battle.querySelector('.battle-controls')?.appendChild(this.reopen);

    // one top row on every tab screen: the wallet on the left, the Battle button (the status strip) on the right
    this.screensEl = h('div', { class: 'screens' }, h('div', { class: 'screen-top' }, parts.wallet ?? null, parts.topExtra ?? null, parts.strip.el));
    for (const id of Object.keys(parts.screens) as ScreenId[]) {
      const spec = parts.screens[id];
      const el = h('section', { class: `screen s-${id}${spec.ownScroll ? ' own-scroll' : ''}`, attrs: { 'aria-label': TABS.find((t) => t.id === id)?.label ?? id } }, spec.el);
      el.hidden = true;
      this.screenEls.set(id, el);
      this.screensEl.appendChild(el);
    }
    root.prepend(parts.topbar, parts.battle, this.screensEl, parts.toasts, this.tabbar);
    this.applyShown();

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
    for (const el of [parts.topbar, parts.abilities, parts.battle.querySelector('.starter'), this.tabbar]) if (el) ro?.observe(el, { box: 'border-box' });
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

  /** Can this tab be navigated to now (unlock ladder)? */
  reachable(tab: TabId): boolean { return tabReachable(this.feats, tab); }

  /** Navigate to a tab (and a More sub-screen). A tab not yet revealed is ignored. */
  go(tab: TabId, sub: string | null = null): void {
    if (!this.reachable(tab)) return;
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
    // Back with a dialog open closes it (or is ignored when it cannot be dismissed) and leaves the screen underneath alone:
    // the entry Back just left is pushed again so history and the nav stack stay in step
    if (handleBackWithModal() !== 'navigate') {
      try { history.pushState(writeNavState(this.nav.current), ''); } catch { /* history unavailable */ }
      return;
    }
    const r = this.nav.pop(readNavState(state));
    this.run(r.ops);
    this.view = r.show;
    if (this.view.tab !== 'battle') this.panel = this.view;
    this.apply();
    // Forward / Back onto a tab that is no longer revealed (Unlock everything switched off): Battle instead
    if (!this.reachable(this.view.tab)) this.go('battle');
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
    if (this.layout === 'desktop') { if (this.feats.tabbar) this.setPanelOpen(!this.deskOpen); }
    else this.go(this.view.tab === 'upgrades' ? 'battle' : 'upgrades');
  }

  /** Desktop: the side panel is on screen (open, and its tab is revealed). */
  private get deskOpen(): boolean { return this.panelOpen && this.reachable(this.panel.tab); }

  /** The unlock ladder changed what is revealed (GameUi, every UiState; cheap when nothing changed). */
  setFeatures(f: Features): void {
    this.feats = f;
    const shown = tabsShown(f);
    const key = TABS.map((t) => (shown[t.id] ? 1 : 0)).join('') + (f.tabbar ? 'b' : '');
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.applyShown();
    // on a tab that is no longer available (Unlock everything switched off): back to Battle
    if (!this.reachable(this.view.tab)) this.go('battle');
    if (!this.reachable(this.panel.tab)) {
      const first = TABS.find((t) => t.id !== 'battle' && shown[t.id]);
      this.panel = { tab: first ? first.id : 'upgrades', sub: null };
    }
    this.apply();
    this.relayout();
  }

  private applyShown(): void {
    const shown = tabsShown(this.feats);
    for (const [id, x] of this.tabBtns) x.b.hidden = !shown[id];
    document.body.classList.toggle('no-tabbar', !this.feats.tabbar);
    this.badgeKey = '';
  }

  /** Show / hide screens and tab states for the current layout and view. */
  private apply(): void {
    const desk = this.layout === 'desktop';
    const want: NavState | null = desk ? (this.deskOpen ? this.panel : null) : this.view.tab === 'battle' ? null : this.view;
    const prev = this.visible;
    if (prev && (!want || want.tab !== prev.tab)) this.parts.screens[prev.tab as ScreenId]?.onHide?.();
    this.visible = want;
    for (const [id, el] of this.screenEls) show(el, want?.tab === id);
    if (want) {
      this.parts.screens[want.tab as ScreenId]?.onShow?.(want.sub);
      this.visit(want.tab);
    }

    const b = document.body.classList;
    const shownTab = desk ? this.panel.tab : this.view.tab;
    for (const t of TABS) b.toggle(`tab-${t.id}`, t.id === (want ? want.tab : 'battle'));
    b.toggle('panel-closed', desk && !this.deskOpen);
    for (const [id, x] of this.tabBtns) {
      const on = id === shownTab && (!desk || this.deskOpen);
      x.b.classList.toggle('active', on);
      attr(x.b, 'aria-selected', on ? 'true' : 'false');
    }
    show(this.reopen, desk && !this.deskOpen && this.feats.tabbar);
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
    r.setProperty('--rail-w', `${this.feats.tabbar ? RAIL_WIDTH : 0}px`);
    const topH = Math.ceil(this.parts.topbar.getBoundingClientRect().height);
    r.setProperty('--top-h', `${topH}px`);
    const bar = this.feats.tabbar ? this.tabbar.getBoundingClientRect() : { width: 0, height: 0 };
    const tabH = layout === 'phone' ? Math.ceil(bar.height) : 0;
    r.setProperty('--tab-h', `${tabH}px`);
    const railW = layout === 'rail' ? Math.ceil(bar.width) : 0;
    // the ability row (never the armed hint above it: arming must not move the arena) or the first-session Upgrade panel
    const ab = this.dockBox();
    const abilities = layout === 'desktop' ? (ab.height ? Math.ceil(ab.height) + 24 : 0) : layout === 'rail' ? (ab.width ? Math.ceil(ab.width) + 16 : 0) : 0;
    const dock = layout === 'phone' ? this.dockPx(tabH) : 0;
    this.lastDock = dock;
    const i = battleInsets(layout, { top: topH, tabBar: tabH, rail: railW, abilities, panel: layout === 'desktop' && this.deskOpen ? PANEL_WIDTH : 0, dock });
    this.host.setInsets(i.top, i.right, i.bottom, i.left, layout === 'phone' ? PHONE_ARENA_BIAS : 0.5);
    this.onLayout?.();
  }

  /** Dock height seen by the last relayout (the arena refits when the floating controls grow or shrink). */
  private lastDock = 0;

  /**
   * Phone: how far up from the bottom of the canvas the controls floating over the arena reach (beyond the tab bar): the
   * first-session Upgrade button and hint, else the ability row. The arena is fitted above it so nothing sits on it.
   */
  private dockPx(tabH: number): number {
    const vh = window.innerHeight;
    const st = this.parts.battle.querySelector<HTMLElement>('.starter');
    if (st && !st.hidden) {
      const r = st.getBoundingClientRect();
      if (r.height > 0) return Math.max(0, Math.ceil(vh - r.bottom + STARTER_CONTENT + DOCK_GAP - tabH));
    }
    const row = this.parts.abilities.querySelector('.ability-row');
    const ab = row && !row.closest('[hidden]') ? row.getBoundingClientRect() : null;
    if (ab && ab.height > 0) return Math.max(0, Math.ceil(vh - ab.top - tabH + DOCK_GAP));
    return 0;
  }

  /**
   * Desktop and landscape phone: the box of the controls docked over the arena's edge (the ability row, or the
   * first-session Upgrade panel, whichever is larger), for the camera insets. Zero size when neither shows. The panel
   * counts as its button and line (STARTER_CONTENT, as on phones), so its stat list appearing never refits the arena.
   */
  private dockBox(): { width: number; height: number } {
    let w = 0, hh = 0;
    for (const el of [this.parts.abilities.querySelector('.ability-row'), this.parts.battle.querySelector('.starter')]) {
      if (!el || el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0)) continue;
      w = Math.max(w, r.width); hh = Math.max(hh, el.classList.contains('starter') ? STARTER_CONTENT : r.height);
    }
    return { width: w, height: hh };
  }

  /** Badges and the status strip (10 Hz). */
  update(ui: UiState): void {
    this.parts.strip.update(ui);
    if (this.layout === 'phone' && this.view.tab === 'battle' && Math.abs(this.dockPx(Math.ceil(this.tabbar.getBoundingClientRect().height) * (this.feats.tabbar ? 1 : 0)) - this.lastDock) > 2) this.relayout();
    const shown = tabsShown(this.feats), visited = new Set(prefs().tabsVisited);
    const fresh = new Set(TABS.filter((t) => t.id !== 'battle' && shown[t.id] && !visited.has(t.id)).map((t) => t.id));
    const badges = tabBadges(ui, fresh);
    const key = TABS.map((t) => { const x = badges[t.id]; return x ? `${x.kind}${x.text}` : ''; }).join('|');
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    for (const t of TABS) {
      const x = badges[t.id], el = this.tabBtns.get(t.id)!;
      show(el.badge, !!x);
      text(el.badge, x ? x.text : '');
      el.badge.className = `tab-badge${x ? ` ${x.kind}` : ''}${x?.fresh ? ' fresh' : ''}`;
      attr(el.b, 'aria-label', x ? `${t.label}: ${x.label}` : t.label);
    }
  }

  /** A tab was opened: its "New" badge retires (prefs, fail-safe). */
  private visit(tab: TabId): void {
    const v = prefs().tabsVisited;
    if (v.includes(tab)) return;
    setPref('tabsVisited', [...v, tab]);
    this.badgeKey = '';
  }

  /** Mark tabs as already visited (first run of the reveal on an existing save: no "New" on what the player knows). */
  markVisited(tabs: readonly TabId[]): void {
    const v = new Set(prefs().tabsVisited);
    const n = v.size;
    for (const t of tabs) v.add(t);
    if (v.size !== n) { setPref('tabsVisited', [...v]); this.badgeKey = ''; }
  }

  /** The screen element of a tab (for scrolling). */
  screen(id: ScreenId): HTMLElement | undefined { return this.screenEls.get(id); }
}
