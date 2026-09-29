/**
 * GameUi: composes the HUD, ability bar, toasts and every screen into the Shell (tab bar, screens,
 * status strip, history), and routes keyboard shortcuts. main.ts feeds it UiState (≤ 10 Hz), event
 * batches and field taps.
 */
import '../styles/theme.css';
import '../styles/controls.css';
import { Ev, type SimEvent, type UiState } from '@sim/core/types';
import { sectorIndexForWave } from '@sim/data/sectors';
import { h } from './dom';
import { Hud, StatusStrip } from './hud';
import { AbilityBar } from './abilities';
import { Shop } from './shop';
import { DraftModal } from './draft';
import { ForecastPanel } from './forecast';
import { openPrestige } from './prestige';
import { PrestigeShop } from './prestige-shop';
import { ConstellationPanel } from './constellation';
import { Inspector } from './inspector';
import { CodexPanel } from './codex';
import { DirectivesPanel, type AutoTab } from './directives';
import { TrialsPanel, activeTrial, trialName } from './trials';
import { helpPanel, settingsPanel } from './settings';
import { Feed } from './feed';
import { DeathCard } from './death';
import { maybeOnboard } from './onboard';
import { showOfflineReturn } from './offline';
import { BuildScreen } from './build';
import { MoreScreen, PrestigeScreen, type MoreSub } from './screens';
import { Shell } from './shell';
import { anyModalOpen, mountModalLayer } from './modal';
import { sectorAccent } from './content';
import type { UiHost } from './host';
import type { ScreenId, ToastKind, UiCtx } from './ctx';

export class GameUi {
  readonly ctx: UiCtx;
  readonly hud: Hud;
  readonly abilities: AbilityBar;
  readonly shop: Shop;
  readonly shell: Shell;
  readonly feed = new Feed();
  readonly death: DeathCard;
  readonly inspector: Inspector;
  private readonly draft: DraftModal;
  private readonly forecast: ForecastPanel;
  private readonly pshop: PrestigeShop;
  private readonly constellation: ConstellationPanel;
  private readonly codex = new CodexPanel();
  private readonly directives: DirectivesPanel;
  private readonly trials: TrialsPanel;
  private readonly build: BuildScreen;
  private readonly prestigeScreen: PrestigeScreen;
  private readonly more: MoreScreen;
  private readonly strip: StatusStrip;
  private latest: UiState | null = null;
  private sector = -1;
  private autoTab: AutoTab = 'directives';
  private pendingOffline: { seconds: number; estimate: number; timer: number } | null = null;

  constructor(root: HTMLElement, readonly host: UiHost) {
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
    this.inspector = new Inspector(this.ctx);
    this.inspector.onPauseChange = (p) => this.hud.setPaused(p);
    this.draft = new DraftModal(this.ctx);
    this.forecast = new ForecastPanel(this.ctx);
    this.pshop = new PrestigeShop(this.ctx);
    this.constellation = new ConstellationPanel(this.ctx);
    this.directives = new DirectivesPanel(this.ctx);
    this.trials = new TrialsPanel(this.ctx);
    this.death = new DeathCard(this.ctx, () => this.hud.lastRate);
    this.build = new BuildScreen(this.ctx, this.shop, this.abilities, this.draft);
    this.prestigeScreen = new PrestigeScreen(this.ctx, this.forecast, this.pshop, this.constellation);
    this.strip = new StatusStrip(() => this.shell.go('battle'));
    this.more = new MoreScreen({
      codex: { title: 'Chain Codex', el: () => this.codex.el, onShow: () => this.codex.setShown(true, this.latest), onHide: () => this.codex.setShown(false, null) },
      automation: { title: 'Automation', el: () => this.directives.el, onShow: () => { this.directives.open(this.autoTab); this.directives.setShown(true); }, onHide: () => this.directives.setShown(false) },
      trials: { title: 'Trials', el: () => this.trials.el, onShow: () => this.trials.setShown(true), onHide: () => this.trials.setShown(false) },
      settings: { title: 'Settings', el: () => settingsPanel(this.ctx) },
      help: { title: 'Help & shortcuts', el: () => helpPanel() },
    }, {
      go: (sub: MoreSub) => this.shell.go('more', sub),
      back: () => this.shell.back(),
      inspector: () => { this.shell.go('battle'); this.inspector.open(); },
    });
    this.trials.onStarted = () => this.shell.go('battle');
    this.death.reveal = (cat, tree) => this.shop.open(cat, tree);
    this.shop.onReveal = () => this.shell.go('upgrades');
    this.hud.onTell = (t) => {
      if (t === 'designate') { this.feed.toast('Tap the boss where its weak point opens to designate it', 'info'); return; }
      const i = this.abilities.slotOf(t);
      if (i >= 0) this.abilities.press(i); else this.abilities.equip(t);
    };

    const battle = h('div', { class: 'battle-layer' },
      h('div', { class: 'arena-top' }, this.hud.bossBar.el, this.hud.controls, this.death.el),
      this.abilities.el);
    const toasts = h('div', { class: 'toast-layer' }, this.feed.el);
    this.shell = new Shell(root, host, {
      topbar: this.hud.el, battle, abilities: this.abilities.el, toasts, strip: this.strip,
      screens: {
        upgrades: {
          el: this.shop.el, ownScroll: true,
          onShow: () => { if (this.latest) this.shop.update(this.latest, this.hud.lastRate); },
        },
        build: { el: this.build.el, onShow: () => this.build.setShown(true), onHide: () => this.build.setShown(false) },
        prestige: { el: this.prestigeScreen.el, onShow: () => this.prestigeScreen.setShown(true), onHide: () => this.prestigeScreen.setShown(false) },
        more: { el: this.more.el, onShow: (sub) => this.more.enter(sub), onHide: () => this.more.hide() },
      },
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Recompute the layout and camera insets. */
  relayout(): void { this.shell.relayout(); }

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
    this.shell.update(ui);
    if (this.shell.isShown('upgrades')) this.shop.update(ui, this.hud.lastRate);
    this.death.update(ui);
    this.feed.update(ui);
    this.draft.update(ui);
    this.build.update(ui);
    this.prestigeScreen.update(ui);
    this.forecast.update(ui);
    this.pshop.update(ui);
    this.constellation.update(ui);
    this.more.update(ui);
    this.codex.update(ui);
    this.directives.update(ui);
    this.trials.update(ui);
  }

  onEvents(events: readonly SimEvent[]): void {
    this.inspector.ring.push(events);
    this.feed.onEvents(events);
    for (const e of events) {
      if (e.type === Ev.TowerDeath && this.latest) this.death.show(e.a || this.latest.run.wave, this.latest, e.data);
      else if (e.type === Ev.WaveClear || e.type === Ev.Prestige || e.type === Ev.Ascend) this.death.hide();
      else if (e.type === Ev.Purchase) this.shop.noteBuy();
    }
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

  /** Battlefield tap (world units) with the drawn position of the enemy under it, or null. */
  tapField(x: number, y: number, enemy: { x: number; y: number } | null): void {
    if (this.host.isPaused()) return;
    this.abilities.tapField(x, y, enemy);
  }

  open(s: ScreenId, arg?: unknown): void {
    switch (s) {
      case 'menu': this.shell.go('more'); break;
      case 'forecast': this.prestigeScreen.select('forecast'); this.shell.go('prestige'); break;
      case 'prestige': openPrestige(this.ctx); break;
      case 'prestige_shop': this.prestigeScreen.select('layers'); this.shell.go('prestige'); break;
      case 'constellation': this.prestigeScreen.select('ascension'); this.shell.go('prestige'); break;
      case 'codex': this.shell.go('more', 'codex'); break;
      case 'directives': this.autoTab = (arg as AutoTab | undefined) ?? 'directives'; this.shell.go('more', 'automation'); break;
      case 'blueprints': this.autoTab = 'blueprints'; this.shell.go('more', 'automation'); break;
      case 'trials': this.shell.go('more', 'trials'); break;
      case 'settings': this.shell.go('more', 'settings'); break;
      case 'inspector': if (!this.inspector.isOpen) this.shell.go('battle'); this.inspector.toggle(); break;
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
      this.open('inspector');
      return;
    }
    if (anyModalOpen()) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '4') { if (this.shell.battleVisible) { this.abilities.press(Number(k) - 1); e.preventDefault(); } }
    else if (k === 'escape') this.abilities.cancel();
    else if (k === 'p') { const ui = this.latest; if (ui) this.host.send({ type: 'set_mode', mode: ui.run.mode === 'push' ? 'patrol' : 'push' }); }
    else if (k === 'b') this.shell.togglePanel();
    else if (k === 'f') this.open('forecast');
  }
}
