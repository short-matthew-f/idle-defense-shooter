/**
 * Death card (design pillar 3, "failure creates progress"): when the tower falls it says where and
 * what happens next, and offers three purchases that could help (open slot, Doctrine fork, best
 * affordable buys, or what you are saving toward with an ETA). It names the killer from the Ev.TowerDeath
 * payload and the source of most damage taken this attempt (UiState.run.attemptDamageTaken). Non-modal: the machine restarts on
 * its own; the card stays until dismissed, the next wave is cleared, or the next death replaces it. The overlay lanes place it
 * (lanes.ts: under the tower when there is room, else above it; never on it) and fold it to its headline when neither has
 * room; left alone for DEATH_SHRINK_MS it folds itself so the next attempt has its arena back. A tap on the headline (or
 * the chevron) unfolds it.
 */
import '../styles/death.css';
import type { SimEvent, UiState } from '@sim/core/types';
import { button, h, text, clear } from './dom';
import { icon } from './icons';
import { fmtDuration, fmtNum } from './format';
import { damageSourceName, deathHeadline, killerName, suggestPurchases, topDamageSource, type Category, type Suggestion } from './advice';
import { BOSS_BY_ID, TREE_LABEL } from './content';
import type { UiCtx } from './ctx';
import { STARTER_IDS, contentPool, poolShop } from './progression';
import { frontierNear } from './forecast';

/**
 * The stalemate cause (Phase 1 item 7): the boss was not taking damage (UiState.wave.stalled === 'boss', kept through
 * `dead`; or a TowerDeath payload saying so).
 */
export function stalemateOf(data: SimEvent['data'] | undefined, ui: Pick<UiState, 'wave'>): boolean {
  const d = data as { stalled?: unknown } | undefined;
  return d?.stalled === 'boss' || ui.wave.stalled === 'boss';
}

/** The death card's Frontier line (the deepest wave cleared is within 2 of it), or null. */
export function frontierLine(ui: Pick<UiState, 'run' | 'forecast'>): string | null {
  const f = ui.forecast?.frontier;
  return frontierNear(ui) && f !== undefined ? `Past wave ${f} enemies harden fast. A Prestige pays here.` : null;
}

/** The card folds to its headline after this long without a touch (ms). */
export const DEATH_SHRINK_MS = 10000;

export class DeathCard {
  readonly el: HTMLElement;
  private readonly title = h('div', { class: 'dc-title' });
  private readonly sub = h('p', { class: 'dc-sub' });
  private readonly cause = h('p', { class: 'dc-sub dc-cause' });
  private bossId: string | null = null;
  private readonly lead = h('p', { class: 'dc-lead' });
  /** The Frontier line (and its Forecast button), first under the headline near the Frontier. */
  private readonly frontierText = h('span');
  private readonly frontier: HTMLElement;
  /** "The Broodheart wasn't taking damage" and what to do about it (the sim's stalemate cause). */
  private readonly stall = h('p', { class: 'dc-sub dc-stall' });
  private stalled = false;
  private stallName = 'boss';
  /** performance.now() when the card last opened (the attention plan's death-first window, attention.ts). */
  shownAt = 0;
  /** The attention plan gave the card the lane (death first): the lanes place it whole, in the roomiest slot. */
  first = false;
  private readonly list = h('div', { class: 'dc-list' });
  private key = '';
  private bought = new Set<string>();
  /** Open the upgrades panel at a category / tree. */
  reveal: (cat: Category, tree?: string) => void = () => {};
  private readonly fold: HTMLButtonElement;
  private foldTimer = 0;
  /** The player asked for the whole card (a tap on a headline the lanes folded): the lanes give it their roomiest slot. */
  wantFull = false;
  /** Called when the card opens, folds or unfolds (the overlay lanes re-fit). */
  onChange: (() => void) | null = null;

  constructor(private readonly ctx: UiCtx, private readonly rate: () => number) {
    const close = button(icon('close'), () => this.hide(), { class: 'btn icon-btn ghost dc-close', label: 'Dismiss' });
    this.fold = button(icon('down'), () => (this.folded || this.el.classList.contains('lane-folded') ? this.unfold() : this.setFolded(true)), { class: 'btn icon-btn ghost dc-fold', label: 'Show what could help' });
    this.frontier = h('div', { class: 'dc-frontier' }, icon('prestige', 'ico tiny'), this.frontierText,
      button('Forecast', () => { this.ctx.open('forecast'); this.setFolded(true); }, { class: 'btn small ghost dc-forecast' }));
    this.frontier.hidden = true;
    this.stall.hidden = true;
    this.el = h('section', { class: 'death-card', attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Tower destroyed' } },
      h('div', { class: 'dc-head' }, icon('skull', 'ico'), this.title, this.fold, close), this.frontier, this.stall, this.sub, this.cause, this.lead, this.list);
    this.el.hidden = true;
    this.title.addEventListener('click', () => { if (this.folded || this.el.classList.contains('lane-folded')) this.unfold(); });
    // reading or using it keeps it open
    for (const ev of ['pointerdown', 'wheel', 'focusin', 'scroll'] as const) this.el.addEventListener(ev, () => this.arm(), { passive: true });
  }

  /** Folded to its headline (it was left alone for DEATH_SHRINK_MS, or folded by the chevron). */
  get folded(): boolean { return this.el.classList.contains('folded'); }

  private setFolded(on: boolean): void {
    this.el.classList.toggle('folded', on);
    this.fold.setAttribute('aria-expanded', on ? 'false' : 'true');
    this.fold.setAttribute('aria-label', on ? 'Show what could help' : 'Fold to the headline');
    if (on) this.wantFull = false;
    if (!on) this.arm(); else clearTimeout(this.foldTimer);
    this.onChange?.();
  }

  /** The player asked for the whole card (folded by its timer, the chevron, or the lanes). */
  private unfold(): void {
    this.wantFull = this.el.classList.contains('lane-folded') || this.wantFull;
    this.setFolded(false);
  }

  /** (Re)start the fold timer. */
  private arm(): void {
    clearTimeout(this.foldTimer);
    if (!this.el.hidden && !this.folded) this.foldTimer = window.setTimeout(() => this.setFolded(true), DEATH_SHRINK_MS);
  }

  get visible(): boolean { return !this.el.hidden; }

  /** Ev.TowerDeath: `wave` is where the tower fell; `data` its payload ({ killer, boss?, bossPhase? }). */
  show(wave: number, ui: UiState, data?: SimEvent['data']): void {
    this.bossId = ui.wave.isBoss ? ui.wave.bossId : null;
    // the sim names the killer; older events without a payload fall back to the wave's boss
    const boss = this.bossId ? BOSS_BY_ID.get(this.bossId as never)?.name ?? null : null;
    const hd = deathHeadline(wave, ui.run.checkpoint, killerName(data) ?? boss);
    text(this.title, hd.title);
    text(this.sub, hd.sub);
    this.showCause(ui);
    this.stalled = stalemateOf(data, ui);
    this.stallName = (boss ?? 'boss').replace(/^The /, '');
    this.shownAt = performance.now();
    this.bought.clear();
    this.key = '';
    this.el.hidden = false;
    this.wantFull = false;
    this.setFolded(false);
    this.update(ui);
  }

  hide(): void { this.el.hidden = true; clearTimeout(this.foldTimer); this.wantFull = false; this.onChange?.(); }

  /** "Most damage this attempt: The Breaker (62%)" from the attempt's damage-taken ledger. */
  private showCause(ui: UiState): void {
    const top = topDamageSource(ui.run.attemptDamageTaken ?? {});
    text(this.cause, top ? `Most damage this attempt: ${damageSourceName(top.source, this.bossId)} (${Math.round(top.share * 100)}%)` : '');
    this.cause.hidden = !top;
  }

  update(ui: UiState): void {
    if (this.el.hidden) return;
    if (ui.run.phase === 'dead') this.showCause(ui);   // the ledger resets when the next attempt starts
    // progressive reveal: suggest only what the player can see (stage 0: the three starter stats; no slot before its category)
    const f = this.ctx.features();
    // near the Frontier: say why the wall is here and where to look (prestige.ts / forecast.ts)
    const fl = f.prestigeTab ? frontierLine(ui) : null;
    text(this.frontierText, fl ?? '');
    this.frontier.hidden = !fl;
    // at the Frontier more Scrap buys are not the answer (a Prestige is): the line replaces the suggestions, so the card fits a 375 px phone
    this.el.classList.toggle('at-frontier', !!fl);
    (this.frontier.querySelector('.dc-forecast') as HTMLElement).hidden = !f.forecast;
    this.stall.hidden = !this.stalled;
    text(this.stall, `The ${this.stallName} wasn't taking damage. Buy Damage${f.abilities ? ', or slot its Counter ability' : ''}.`);
    // …and only cross-system buys whose parts this Prestige offers (progression.ts content pool)
    const pool = contentPool(ui, { unlockAll: f.unlockAll });
    const offered = poolShop(ui.shop, pool);
    const canAttune = f.elements && pool.elements.some((e) => !ui.build.attunements.includes(e));
    const canMount = f.hardpoints && pool.hardpoints.some((x) => !ui.build.hardpoints.includes(x) && !ui.mountBlocked?.[x]);
    const seen = { ...ui, shop: f.chassisAll ? offered : offered.filter((e) => STARTER_IDS.has(e.node)),
      run: { ...ui.run, attunementSlotsOpen: canAttune ? ui.run.attunementSlotsOpen : 0, hardpointSlotsOpen: canMount ? ui.run.hardpointSlotsOpen : 0 } };
    const sugg = suggestPurchases(seen, this.rate(), 3);
    text(this.lead, sugg.length ? `You have ${fmtNum(ui.run.scrap)} Scrap. These could help:` : `You have ${fmtNum(ui.run.scrap)} Scrap.`);
    // Rebuild only when the suggestions change (never under a finger at 10 Hz); ETAs refresh with them.
    const key = `${f.upgradesTab}|` + sugg.map((s) => s.kind === 'slot' ? `slot:${s.cat}` : `${s.entry.node}:${s.entry.rank}:${s.entry.affordable}:${s.kind === 'buy' && s.eta !== null ? Math.ceil(s.eta / 5) : ''}`).join(',');
    if (key === this.key) return;
    this.key = key;
    clear(this.list);
    for (const s of sugg) this.list.appendChild(this.row(s));
    if (f.upgradesTab) this.list.appendChild(button('Open upgrades', () => this.reveal('chassis'), { class: 'btn ghost small dc-more' }));
  }

  private row(s: Suggestion): HTMLElement {
    if (s.kind === 'slot') {
      const el = s.cat === 'elements';
      return button([icon('plus', 'ico'), h('span', { class: 'dc-name', text: el ? 'Attune an element' : 'Mount a weapon system' }), h('span', { class: 'dc-why', text: el ? 'New slot open' : 'New hardpoint open' })],
        () => { this.reveal(s.cat, `slot:${s.slot}`); this.hide(); }, { class: 'btn dc-item slot' });
    }
    if (s.kind === 'doctrine') {
      const tree = TREE_LABEL[s.tree as keyof typeof TREE_LABEL] ?? s.tree;
      return button([icon('check', 'ico'), h('span', { class: 'dc-name', text: `Choose a ${tree} Doctrine` }), h('span', { class: 'dc-why', text: 'Fork open' })],
        () => { this.reveal(catOf(s.tree), s.tree); this.hide(); }, { class: 'btn dc-item' });
    }
    const e = s.entry;
    const done = this.bought.has(e.node);
    const price = h('span', { class: 'price scrap' }, icon('scrap', 'ico tiny'), fmtNum(e.cost));
    const why = s.affordable ? price : h('span', { class: 'dc-why' }, price, s.eta !== null ? ` in ~${fmtDuration(s.eta)}` : '');
    const label = e.rank > 0 && e.maxRank > 1 ? `${e.name} ${e.rank + 1}` : e.name;
    const b = button([done ? icon('check', 'ico') : null, h('span', { class: 'dc-name', text: label }), why], () => {
      if (!s.affordable) { this.reveal(catOf(e.tree), e.tree); return; }
      this.ctx.host.send({ type: 'buy', node: e.node });
      this.bought.add(e.node);
    }, { class: `btn dc-item${s.affordable ? ' affordable' : ''}` });
    b.setAttribute('aria-label', s.affordable ? `Buy ${e.name} for ${fmtNum(e.cost)} Scrap` : `${e.name}: ${fmtNum(e.cost)} Scrap${s.eta !== null ? `, affordable in about ${fmtDuration(s.eta)}` : ''}`);
    return b;
  }
}

function catOf(tree: string): Category {
  if (tree === 'fire' || tree === 'lightning' || tree === 'poison' || tree === 'frost') return 'elements';
  if (tree === 'ordnance' || tree === 'drones' || tree === 'blade' || tree === 'laser' || tree === 'gravitics') return 'hardpoints';
  if (tree === 'link' || tree === 'infuse' || tree === 'fusion') return 'cross';
  return 'chassis';
}
