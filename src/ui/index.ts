/**
 * GameUi: composes the HUD, ability bar, toasts and every screen into the Shell (tab bar, screens,
 * status strip, history), and routes keyboard shortcuts. main.ts feeds it UiState (≤ 10 Hz), event
 * batches and field taps.
 */
import '../styles/theme.css';
import '../styles/controls.css';
import { Ev, type Command, type SimEvent, type UiState } from '@sim/core/types';
import { sectorIndexForWave } from '@sim/data/sectors';
import { h } from './dom';
import { Hud, StatusStrip } from './hud';
import { AbilityBar } from './abilities';
import { ActiveWidget } from './active';   // Active edge: Overcharge button, salvage floaters
import { Shop } from './shop';
import { qtyLabel } from './bulk';
import { DraftModal } from './draft';
import { BoonOffer, BoonRow } from './boons';
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
import { CoachBanner, activeCoachLive, initialSeen, markCoachSeen } from './coach';
import { StarterPanel } from './starter';
import { HintDriver, setArenaSource } from './pointer';
import { OverlayLanes } from './lanes';
import { Attention } from './attention';
import { contentPool, features, newInPool, stageOf, type Features } from './progression';
import { QM_COACH_ID, QM_COACH_TEXT, echoGuideOn, newContentCoach } from './ceremony';
import type { CoachExtra } from './coach';
import { tabsShown, TABS } from './shell-logic';
import { prefs, setPref } from './prefs';
import { showOfflineReturn } from './offline';
import { BuildScreen } from './build';
import { MoreScreen, PrestigeScreen, type MoreSub } from './screens';
import { Shell } from './shell';
import { WalletBar, updateLiveWallets, type WalletView } from './wallet';
import { anyModalOpen, mountModalLayer } from './modal';
import { sectorAccent } from './content';
import type { UiHost } from './host';
import type { ScreenId, ToastKind, UiCtx } from './ctx';

export class GameUi {
  readonly ctx: UiCtx;
  readonly hud: Hud;
  readonly abilities: AbilityBar;
  readonly active: ActiveWidget;
  readonly shop: Shop;
  readonly shell: Shell;
  readonly feed = new Feed();
  readonly death: DeathCard;
  readonly inspector: Inspector;
  private readonly draft: DraftModal;
  private readonly boonOffer: BoonOffer;
  private readonly boonRow: BoonRow;
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
  /** The balances the screen in view spends, pinned under the status strip (wallet.ts). */
  readonly wallet = new WalletBar();
  private latest: UiState | null = null;
  private sector = -1;
  private autoTab: AutoTab = 'directives';
  private pendingOffline: { seconds: number; estimate: number; timer: number } | null = null;
  /** Progressive reveal: what the unlock ladder shows for the latest UiState (progression.ts). */
  private feats: Features;
  /** ?showall=1: Unlock everything for this session (tests, demos); the Settings switch persists it. */
  private readonly showAll = (() => { try { return new URLSearchParams(location.search).get('showall') === '1'; } catch { return false; } })();
  private readonly starter: StarterPanel;
  private readonly coach = new CoachBanner();
  /** Pointer hints: a ring on the control the coach banner is about (pointer.ts, hints.ts). */
  private readonly hints: HintDriver;
  /** Where the transient overlays go on Battle (lanes.ts): clear of the tower, the dock, the HUD and each other. */
  readonly lanes: OverlayLanes;
  /** Which overlay may ask for attention now (attention.ts): death first, the boss-clear beat, one decision, boss mode. */
  readonly attn: Attention;

  constructor(root: HTMLElement, readonly host: UiHost) {
    // any game command from the UI ends a "stay with the fight" hold: once the player acts, the run goes on
    const acting: UiHost = new Proxy(host, {
      get: (t, p) => {
        if (p === 'send') return (cmd: Command) => { this.shell?.noteCommand(); t.send(cmd); };
        const v = (t as unknown as Record<string | symbol, unknown>)[p];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    this.ctx = {
      host: acting,
      state: () => this.latest,
      open: (s, arg) => this.open(s, arg),
      toast: (m, k) => this.feed.toast(m, k),
      features: () => this.feats,
    };
    this.feats = features({ run: { deepestCleared: 0 }, meta: { deepestEver: 0, prestigeCount: 0 } }, { unlockAll: this.unlockAll });
    mountModalLayer(root);
    this.hud = new Hud(this.ctx);
    this.abilities = new AbilityBar(this.ctx);
    this.active = new ActiveWidget(this.ctx);
    this.shop = new Shop(this.ctx);
    this.inspector = new Inspector(this.ctx);
    this.inspector.onPauseChange = (p) => this.hud.setPaused(p);
    this.draft = new DraftModal(this.ctx);
    this.boonOffer = new BoonOffer(this.ctx);
    this.boonRow = new BoonRow(this.ctx);
    this.forecast = new ForecastPanel(this.ctx);
    this.pshop = new PrestigeShop(this.ctx);
    this.constellation = new ConstellationPanel(this.ctx);
    this.directives = new DirectivesPanel(this.ctx);
    this.trials = new TrialsPanel(this.ctx);
    this.death = new DeathCard(this.ctx, () => this.hud.lastRate);
    this.build = new BuildScreen(this.ctx, this.shop, this.abilities, this.draft, () => { this.shell.go('battle'); this.boonOffer.expand(); });
    this.prestigeScreen = new PrestigeScreen(this.ctx, this.forecast, this.pshop, this.constellation);
    this.strip = new StatusStrip(() => this.shell.go('battle'));
    this.starter = new StarterPanel(this.ctx, () => this.hud.lastRate);
    this.hud.onMenu = () => this.shell.go('more');
    this.more = new MoreScreen({
      codex: { title: 'Chain Codex', el: () => this.codex.el, onShow: () => this.codex.setShown(true, this.latest), onHide: () => this.codex.setShown(false, null) },
      automation: { title: 'Automation', el: () => this.directives.el, onShow: () => { this.directives.open(this.autoTab); this.directives.setShown(true); }, onHide: () => this.directives.setShown(false) },
      trials: { title: 'Trials', el: () => this.trials.el, onShow: () => this.trials.setShown(true), onHide: () => this.trials.setShown(false) },
      settings: { title: 'Settings', el: () => settingsPanel(this.ctx) },
      help: { title: 'Help & shortcuts', el: () => helpPanel(this.ctx) },
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
      this.abilities.tellTap(t);   // tells.ts: info before the reveal; cast / equip / ask before replacing after
    };

    this.hud.bossBar.el.appendChild(this.abilities.tellPanel);
    const battle = h('div', { class: 'battle-layer' },
      h('div', { class: 'arena-top' }, this.hud.bossBar.el, this.abilities.preBoss, h('div', { class: 'arena-strip' }, this.boonRow.el, this.boonOffer.chip, this.hud.controls)),
      this.death.el,
      this.boonOffer.el,
      this.starter.el,
      this.abilities.el,
      this.active.el);
    const toasts = h('div', { class: 'toast-layer' }, this.coach.el, this.feed.el);
    this.shell = new Shell(root, host, {
      topbar: this.hud.el, battle, abilities: this.abilities.el, toasts, strip: this.strip, wallet: this.wallet.el, topExtra: this.shop.qtyChip,
      screens: {
        upgrades: {
          el: this.shop.el, ownScroll: true,
          onShow: () => { if (this.latest) this.shop.update(this.latest, this.hud.lastRate); this.refreshWallet(); },
        },
        build: { el: this.build.el, onShow: () => { this.build.setShown(true); this.refreshWallet(); }, onHide: () => this.build.setShown(false) },
        prestige: { el: this.prestigeScreen.el, onShow: () => { this.prestigeScreen.setShown(true); this.refreshWallet(); }, onHide: () => this.prestigeScreen.setShown(false) },
        more: { el: this.more.el, onShow: (sub) => { this.more.enter(sub); this.refreshWallet(); }, onHide: () => this.more.hide() },
      },
    });
    this.hints = new HintDriver(root, {
      nav: () => ({ screen: (['upgrades', 'build', 'prestige', 'more'] as const).find((s) => this.shell.isShown(s)) ?? null, battle: this.shell.battleVisible }),
      shop: () => this.shop.view(),
      coach: () => (this.coach.el.hidden ? null : this.coach.el.dataset.coach ?? null),   // ladder lines and extras alike
      blocked: () => anyModalOpen() || this.death.visible || this.attn.hintsHeld,
      armed: () => this.abilities.arming.armed,
      boonChip: () => !this.boonOffer.chip.hidden,
      draftWaiting: () => this.draft.pending,
    });
    this.lanes = new OverlayLanes({
      battle, arenaTop: battle.querySelector<HTMLElement>('.arena-top')!, death: this.death, offer: this.boonOffer.el,
      coach: this.coach, feed: this.feed, starter: this.starter.el, row: this.abilities.row, armHint: this.abilities.hint, oc: this.active.el,
    }, { arena: () => host.arena?.() ?? null, layout: () => this.shell.layout, battleVisible: () => this.shell.battleVisible });
    this.attn = new Attention({ host, death: this.death, feed: this.feed, offer: this.boonOffer, draft: this.draft, coach: this.coach,
      battleVisible: () => this.shell.battleVisible, changed: () => { this.lanes.schedule(); this.hints.refresh(); } });
    setArenaSource(() => host.arena?.() ?? null);
    // UX Phase 2 item 10 (decision-hold.ts): a tab opened from the fight holds the run until Battle is back (≤ 30 s)
    for (const el of [this.death.el, this.coach.el, this.boonOffer.el, this.boonOffer.chip]) el.addEventListener('click', () => this.shell.armDecision(), true);
    const layout = this.shell.onLayout;
    this.shell.onLayout = () => { layout?.(); this.lanes.schedule(); this.hints.pointer.schedule(); };
    // the wallet follows the view at once (a category or segment switch, not only the next UiState)
    this.shop.onViewChange = () => this.refreshWallet();
    this.prestigeScreen.onViewChange = () => this.refreshWallet();
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Where the player is, for the wallet: the screen on show, its More sub-screen, shop category and Prestige segment. */
  walletView(): WalletView {
    const tab = (['upgrades', 'build', 'prestige', 'more'] as const).find((s) => this.shell?.isShown(s)) ?? null;
    return { tab, sub: tab ? this.shell.sub : null, shopCat: this.shop.view().cat, prestigeSeg: this.prestigeScreen.segment };
  }

  private refreshWallet(): void {
    if (this.latest) this.wallet.update(this.latest, this.walletView(), this.feats);
  }

  /** Recompute the layout and camera insets. */
  relayout(): void { this.shell.relayout(); }

  /** First UiState: accent, initial layout (the coach banners replace the old intro cards). */
  onReady(ui: UiState): void {
    this.update(ui);
    this.relayout();
  }

  /** The master switch (Settings → Unlock everything, or ?showall=1). */
  private get unlockAll(): boolean { return this.showAll || prefs().unlockAll; }

  /** Recompute what the unlock ladder reveals and hand it to every gated component. */
  private reveal(ui: UiState): void {
    const f = features(ui, { unlockAll: this.unlockAll });
    if (!prefs().revealInit) {
      // first run of the ladder on this device: an existing save has already seen what it has (no banner stack, no "New")
      setPref('revealInit', true);
      markCoachSeen(initialSeen(f, stageOf(ui)));
      if (stageOf(ui) > 0) this.shell.markVisited(TABS.filter((t) => tabsShown(f)[t.id]).map((t) => t.id));
    }
    this.feats = f;
    this.shell.setFeatures(f);
    this.shop.setFeatures(f);
    this.hud.setFeatures(f);
    this.abilities.setVisible(f.abilities);
    this.coach.update(f, { boonOffer: !!ui.run.boonOffer?.length, draft: !!ui.run.pendingDraft?.length, ...activeCoachLive(ui.active) },
      this.postPrestigeCoach(ui, f), echoGuideOn() ? ['machine'] : []);
  }

  /**
   * Coach lines after a Prestige (ceremony.ts), behind the ladder's own ('machine' waits for the Echo guide): what the
   * content pool just added (progression.ts), then the Quartermaster with a "Turn on" button (the sim starts it off).
   */
  private postPrestigeCoach(ui: UiState, f: Features): CoachExtra[] {
    if (f.unlockAll) return [];
    const p = prefs();
    const pool = contentPool(ui);
    if (!p.contentInit) {
      // first run on this device: what the save already offers is not "New"
      setPref('contentInit', true);
      setPref('contentSeen', [...new Set([...p.contentSeen, ...pool.elements, ...pool.hardpoints])]);
    }
    const out: CoachExtra[] = [];
    const fresh = newContentCoach(newInPool(pool, new Set(prefs().contentSeen)));
    if (fresh) out.push(fresh);
    const q = ui.quartermaster;
    if (q?.on && !p.coachSeen.includes(QM_COACH_ID)) markCoachSeen([QM_COACH_ID]);   // switched on from its card: never re-offer
    else if (f.quartermaster && q?.unlocked && !q.on) {
      out.push({ id: QM_COACH_ID, icon: 'blueprint', text: QM_COACH_TEXT, action: { label: 'Turn on', run: () => {
        this.ctx.host.send({ type: 'set_quartermaster', on: true });
        this.feed.toast('Quartermaster on: its card is at the top of Upgrades', 'good');
      } } });
    }
    return out;
  }

  update(ui: UiState): void {
    this.latest = ui;
    this.attn.update(ui);
    this.reveal(ui);
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
    this.active.update(ui);
    this.starter.update(ui, this.feats);
    this.shell.update(ui);
    this.wallet.update(ui, this.walletView(), this.feats);
    updateLiveWallets(ui);
    if (this.shell.isShown('upgrades')) this.shop.update(ui, this.hud.lastRate);
    this.death.update(ui);
    this.feed.update(ui, this.feats);
    this.draft.update(ui);
    this.boonOffer.update(ui);
    this.boonRow.update(ui);
    this.build.update(ui);
    this.prestigeScreen.update(ui);
    this.forecast.update(ui);
    this.pshop.update(ui);
    this.constellation.update(ui);
    this.more.update(ui, this.feats);
    this.codex.update(ui);
    this.directives.update(ui);
    this.trials.update(ui);
    this.lanes.apply();   // before the pointer: its label keeps clear of where the overlays now are
    this.hints.update(ui, this.feats);
  }

  onEvents(events: readonly SimEvent[]): void {
    this.inspector.ring.push(events);
    this.feed.onEvents(events);
    this.active.onEvents(events);
    this.shop.notePurchases(events);   // bulk-buy summary toast
    for (const e of events) {
      if (e.type === Ev.TowerDeath && this.latest) this.death.show(e.a || this.latest.run.wave, this.latest, e.data);
      else if (e.type === Ev.WaveClear || e.type === Ev.Prestige || e.type === Ev.Ascend) this.death.hide();
      else if (e.type === Ev.Purchase && e.data?.via !== 'quartermaster') this.shop.noteBuy();   // automatic buys are not the player's
    }
    if (events.some((e) => (e.type === Ev.ScrapGain && e.src === 'offline') || e.type === Ev.Prestige || e.type === Ev.Ascend)) this.hud.resetRate();
    if (this.pendingOffline) {
      const off = events.find((e) => e.type === Ev.ScrapGain && e.src === 'offline');
      if (off) { clearTimeout(this.pendingOffline.timer); this.pendingOffline = null; showOfflineReturn(off.a, off.b, false, this.latest); }
    }
  }

  /**
   * An offline_return was sent: show the sim's ScrapGain('offline') result when it arrives, or
   * the client-side estimate if it does not (e.g. a zero Patrol rate or the tab paused).
   */
  expectOffline(seconds: number, estimate: number): void {
    if (this.pendingOffline) clearTimeout(this.pendingOffline.timer);
    this.pendingOffline = null;
    // no income to wait for: the sim reports no Scrap, so the card says so now (not after the fallback timer)
    if (estimate <= 0 && seconds >= 300) { showOfflineReturn(seconds, 0, true, this.latest); return; }
    const timer = window.setTimeout(() => {
      this.pendingOffline = null;
      // zero income is explained on the card (after a real absence), not a bare toast
      if (estimate > 0 || seconds >= 300) showOfflineReturn(seconds, estimate, true, this.latest);
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
      if (this.feats.inspector || this.inspector.isOpen) this.open('inspector');
      return;
    }
    if (anyModalOpen()) return;
    const k = e.key.toLowerCase();
    const f = this.feats;
    if (k >= '1' && k <= '4') { if (this.shell.battleVisible && f.abilities) { this.abilities.press(Number(k) - 1); e.preventDefault(); } }
    else if (k === 'escape') this.abilities.cancel();
    else if (k === 'p') { const ui = this.latest; if (ui && f.runControls) this.ctx.host.send({ type: 'set_mode', mode: ui.run.mode === 'push' ? 'patrol' : 'push' }); }
    else if (k === 'b') this.shell.togglePanel();
    else if (k === 'f') { if (f.forecast) this.open('forecast'); }
    else if (k === 'q') {
      if (!f.bulk) return;   // no quantity selector yet: Q does nothing
      const q = this.shop.cycleQty();
      if (!this.shell.isShown('upgrades')) this.feed.toast(`Buy quantity: ${qtyLabel(q)}`, 'info');
    }
  }
}
