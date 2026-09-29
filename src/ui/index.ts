/**
 * GameUi: composes the HUD, ability bar, upgrades sheet / side panel, toasts and every screen,
 * and routes keyboard shortcuts. main.ts feeds it UiState (≤ 10 Hz), event batches and field taps.
 */
import '../styles/theme.css';
import '../styles/controls.css';
import { Ev, type SimEvent, type UiState } from '@sim/core/types';
import { sectorIndexForWave } from '@sim/data/sectors';
import { h } from './dom';
import { Hud } from './hud';
import { AbilityBar } from './abilities';
import { Shop } from './shop';
import { Sheet } from './sheet';
import { DraftModal } from './draft';
import { ForecastPanel } from './forecast';
import { openPrestige } from './prestige';
import { PrestigeShop } from './prestige-shop';
import { ConstellationPanel } from './constellation';
import { Inspector } from './inspector';
import { CodexPanel } from './codex';
import { DirectivesPanel } from './directives';
import { TrialsPanel, activeTrial, trialName } from './trials';
import { openSettings } from './settings';
import { Feed } from './feed';
import { maybeOnboard } from './onboard';
import { showOfflineReturn } from './offline';
import { openMenu } from './menu';
import { anyModalOpen, mountModalLayer } from './modal';
import { sectorAccent } from './content';
import type { UiHost } from './host';
import type { ScreenId, ToastKind, UiCtx } from './ctx';

export class GameUi {
  readonly ctx: UiCtx;
  readonly hud: Hud;
  readonly abilities: AbilityBar;
  readonly shop: Shop;
  readonly sheet: Sheet;
  readonly feed = new Feed();
  readonly inspector: Inspector;
  private readonly draft: DraftModal;
  private readonly forecast: ForecastPanel;
  private readonly pshop: PrestigeShop;
  private readonly constellation: ConstellationPanel;
  private readonly codex = new CodexPanel();
  private readonly directives: DirectivesPanel;
  private readonly trials: TrialsPanel;
  private readonly topStack: HTMLElement;
  private latest: UiState | null = null;
  private sector = -1;
  private hudH = 0;
  private abilityH = 0;
  private pendingOffline: { seconds: number; estimate: number; timer: number } | null = null;

  constructor(private readonly root: HTMLElement, readonly host: UiHost) {
    this.ctx = {
      host,
      state: () => this.latest,
      open: (s, arg) => this.open(s, arg),
      toast: (m, k) => this.feed.toast(m, k),
    };
    mountModalLayer(root);
    this.hud = new Hud(this.ctx);
    this.abilities = new AbilityBar(this.ctx);
    this.shop = new Shop(this.ctx);
    this.sheet = new Sheet(this.shop.quick, this.shop.el);
    this.inspector = new Inspector(this.ctx);
    this.inspector.onPauseChange = (p) => this.hud.setPaused(p);
    this.draft = new DraftModal(this.ctx);
    this.forecast = new ForecastPanel(this.ctx);
    this.pshop = new PrestigeShop(this.ctx);
    this.constellation = new ConstellationPanel(this.ctx);
    this.directives = new DirectivesPanel(this.ctx);
    this.trials = new TrialsPanel(this.ctx);
    this.topStack = h('div', { class: 'top-stack' }, this.hud.el, this.hud.bossBar.el);
    root.prepend(this.topStack, this.abilities.el, this.sheet.el, this.sheet.reopen, this.feed.el);
    this.sheet.onLayout = () => this.relayout();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.relayout()) : null;
    ro?.observe(this.hud.el);
    ro?.observe(this.abilities.el);
    window.addEventListener('resize', () => this.relayout());
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.relayout();
  }

  /** Recompute sheet snap heights and camera insets. */
  relayout(): void {
    this.hudH = Math.ceil(this.hud.el.getBoundingClientRect().height);
    this.abilityH = this.abilities.el.offsetParent ? Math.ceil(this.abilities.el.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--hud-h', `${this.hudH}px`);
    this.sheet.layout(this.hudH);
    const i = this.sheet.insets(this.abilityH ? this.abilityH + 12 : 0);
    this.host.setInsets(i.top + 4, i.right, i.bottom, i.left);
  }

  /** First UiState: onboarding, accent, initial layout. */
  onReady(ui: UiState): void {
    this.update(ui);
    this.relayout();
    maybeOnboard();
  }

  update(ui: UiState): void {
    this.latest = ui;
    const si = sectorIndexForWave(ui.run.wave);
    if (si !== this.sector) {
      this.sector = si;
      const a = sectorAccent(si);
      const r = document.documentElement.style;
      r.setProperty('--accent', a.fg);
      r.setProperty('--accent-2', a.accent);
    }
    this.hud.update(ui);
    this.hud.setTrial(trialName(activeTrial(ui)));
    this.abilities.update(ui);
    this.shop.update(ui);
    this.feed.update(ui);
    this.draft.update(ui);
    this.forecast.update(ui);
    this.pshop.update(ui);
    this.constellation.update(ui);
    this.codex.update(ui);
    this.directives.update(ui);
    this.trials.update(ui);
  }

  onEvents(events: readonly SimEvent[]): void {
    this.inspector.ring.push(events);
    this.feed.onEvents(events);
    if (events.some((e) => (e.type === Ev.ScrapGain && e.src === 'offline') || e.type === Ev.Prestige || e.type === Ev.Ascend)) this.hud.resetRate();
    if (this.pendingOffline) {
      const off = events.find((e) => e.type === Ev.ScrapGain && e.src === 'offline');
      if (off) { clearTimeout(this.pendingOffline.timer); this.pendingOffline = null; showOfflineReturn(off.a, off.b, false); }
    }
  }

  /**
   * An offline_return was sent: show the sim's ScrapGain('offline') result when it arrives, or
   * the client-side estimate if it does not (e.g. a zero Patrol rate or the tab paused).
   */
  expectOffline(seconds: number, estimate: number): void {
    if (this.pendingOffline) clearTimeout(this.pendingOffline.timer);
    const timer = window.setTimeout(() => {
      this.pendingOffline = null;
      if (estimate > 0) showOfflineReturn(seconds, estimate, true);
      else this.feed.toast('Welcome back', 'info');
    }, 4000);
    this.pendingOffline = { seconds, estimate, timer };
  }

  /** Battlefield tap (world units) with the nearest enemy index or null. */
  tapField(x: number, y: number, enemy: number | null): void {
    if (this.host.isPaused()) return;
    this.abilities.tapField(x, y, enemy);
  }

  open(s: ScreenId, arg?: unknown): void {
    switch (s) {
      case 'menu': openMenu(this.ctx); break;
      case 'forecast': this.forecast.open(); break;
      case 'prestige': openPrestige(this.ctx); break;
      case 'prestige_shop': this.pshop.open(); break;
      case 'constellation': this.constellation.open(); break;
      case 'codex': this.codex.open(this.latest); break;
      case 'directives': this.directives.open((arg as 'directives' | undefined) ?? 'directives'); break;
      case 'blueprints': this.directives.open('blueprints'); break;
      case 'trials': this.trials.open(); break;
      case 'settings': openSettings(this.ctx); break;
      case 'inspector': this.inspector.toggle(); break;
      case 'abilities': this.abilities.openPicker(Number(arg ?? 0)); break;
    }
  }

  toast(msg: string, kind?: ToastKind): void { this.feed.toast(msg, kind); }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (anyModalOpen() && !this.inspector.isOpen) return;   // inside dialogs Space activates buttons
      // Space is the global pause key: it never activates the focused HUD button (Enter still does).
      e.preventDefault();
      if (e.repeat) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.inspector.toggle();
      return;
    }
    if (anyModalOpen()) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '4') { this.abilities.press(Number(k) - 1); e.preventDefault(); }
    else if (k === 'escape') this.abilities.cancel();
    else if (k === 'p') { const ui = this.latest; if (ui) this.host.send({ type: 'set_mode', mode: ui.run.mode === 'push' ? 'patrol' : 'push' }); }
    else if (k === 'b') this.sheet.toggle();
    else if (k === 'f') this.forecast.open();
  }
}

