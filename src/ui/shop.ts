/**
 * Upgrade shop. Pinned: one breadcrumb line (the shell's top row above it holds the wallet and the buy-quantity chip):
 *   "Page ▾ › Tree ▾ … QM [switch]". Page ▾ lists the revealed pages (Chassis, Elements, Hardpoints, Cross, Cores);
 *   Tree ▾ (pages with two or more trees or slots) lists the page's trees, its empty slots ("+ Empty slot") and, under
 *   the current tree, jump links to its sections. Stacked pages (Cross, Cores) list their sections under the page.
 *   Menus are popovers (modal.ts variant 'popover': Esc, Back, a tap outside and a choice close them).
 * Everything else scrolls in one list:
 *   decision rows (an empty attunement / hardpoint slot of this category, the open Doctrine fork of this tree)
 *   the tree view: shared nodes · Doctrine fork (2–4 cards) · doctrine nodes + capstone · Exotic · "N locked" · "N maxed"
 * Each section's light header sticks under the breadcrumb while it scrolls. A swipe left / right on the list (or ← / →)
 * steps along one flattened order of every revealed tree and page (navStops); a swipe from the left edge stays the
 * system's swipe back to Battle.
 * A node row shows its name, rank and headline effect; tapping the row body unfolds the full description (the Buy
 * button keeps hold-to-buy). Up to three rows carry "★ Suggested" (suggestedNodes: the cheapest affordable buys; a hint
 * only, nothing auto-buys). The quantity chip (×1 → ×10 → Max, Q) drives every Buy button (bulk.ts).
 * Attention dots mean a decision is waiting (an empty slot, an open fork), never "something is affordable" (the tab
 * bar's count says that); a tree's count is its affordable nodes, in a quiet neutral style.
 * Progressive reveal (progression.ts, setFeatures): pages appear as they are earned; ★ Suggested and the quantity chip
 * wait for 'bulk' (until then every Buy is ×1 and Q does nothing).
 */
import '../styles/shop.css';
import type { DoctrineId, ElementId, HardpointId, TreeId } from '@sim/core/ids';
import { Ev, type ShopEntry, type SimEvent, type UiState } from '@sim/core/types';
import { button, h, holdRepeat, text, disable, show, attr } from './dom';
import { buyLabel, buyLabelText, bulkToast, nextQty, parseQty, qtyLabel, rowBuy, type BuyLabel, type BuyQty } from './bulk';
import { icon } from './icons';
import { fmtNum, fmtStatChange, splitDesc, substituteDesc, titleCase } from './format';
import { CHASSIS, ELEMENTS, ELEMENT_BLURB, HARDPOINTS, HARDPOINT_BLURB, NODE_BY_ID, TREE_BY_ID, TREE_LABEL } from './content';
import { confirmDialog, openModal, type ModalHandle } from './modal';
import { doctrineFork, doctrinesShown, forkKey, freeDoctrineTrees } from './doctrine';
import { prefs, setPref } from './prefs';
import { POOL_COMPLETE_AT, STARTER_IDS, contentPool, newInPool, poolShop, type ContentPool, type Features } from './progression';
import { QuartermasterPanel } from './quartermaster';
import { fmtExactish, qmBank, walletChip } from './wallet';
import type { UiCtx } from './ctx';

export type Category = 'chassis' | 'elements' | 'hardpoints' | 'cross' | 'cores';
const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'chassis', label: 'Chassis' }, { id: 'elements', label: 'Elements' }, { id: 'hardpoints', label: 'Hardpoints' },
  { id: 'cross', label: 'Cross' }, { id: 'cores', label: 'Cores' },
];
/** Categories shown as one stacked view (their groups are sections, not tree chips). */
const STACKED = new Set<Category>(['cross', 'cores']);
const CROSS_GROUPS: { id: string; label: string; empty: string }[] = [
  { id: 'fusion', label: 'Fusions', empty: 'Appear when two elements are attuned (Triads need three, from Ascension II).' },
  { id: 'link', label: 'Linkages', empty: 'Appear when two systems are mounted (the primary counts), or a hardpoint pairs with Bastion or Reactor.' },
  { id: 'infuse', label: 'Infusions', empty: 'Appear when a mounted hardpoint meets an attuned element.' },
];
const REFIT_CORES = 3;
/** Purchases after which the first-run explainer on the Suggested line retires. */
const COACH_BUYS = 3;

interface Chip { id: string; label: string; empty?: boolean }

/** 3 cheapest affordable Scrap buys (the compact "combat panel"). */
export function cheapestAffordable(shop: readonly ShopEntry[], n = 3): ShopEntry[] {
  return shop.filter((e) => e.affordable && !e.locked && e.currency === 'scrap' && e.kind !== 'doctrine')
    .sort((a, b) => a.cost - b.cost || (a.node < b.node ? -1 : 1)).slice(0, n);
}

/**
 * Ranks a before → after preview covers at quantity `q`: what the Buy button would buy, else (nothing affordable)
 * one rank (×1 / Max) or the next ≤10 (×10). Pure.
 */
export function previewRanks(e: ShopEntry, q: BuyQty): number {
  const n = rowBuy(e, q).count;
  if (n > 0) return n;
  return q === 10 ? Math.max(1, Math.min(10, e.maxRank - e.rank)) : 1;
}

/** The resolved stat after `n` more ranks (sim previews), or null when the entry has none for `n`. Pure. */
export function statAfter(e: ShopEntry, n: number): number | null {
  if (e.statNow === undefined || !e.statAfter?.length || n < 1) return null;
  if (n <= e.statAfter.length) return e.statAfter[n - 1];
  return n === e.affordableRanks && e.statAfterMax !== undefined ? e.statAfterMax : null;
}

/** "Damage 13.2 → 14.8 (+12%)" for a stat row at quantity `q` (null: no preview; mechanics keep their text). Pure. */
export function statLine(e: ShopEntry, q: BuyQty): string | null {
  const after = statAfter(e, previewRanks(e, q));
  if (after === null || e.statNow === undefined) return null;
  return `${e.statLabel ? `${e.statLabel} ` : ''}${fmtStatChange(e.statNow, after, e.statUnit ?? '')}`;
}

/** The bottleneck line's two forms (tests). */
export const BOTTLENECK_ALL = "Scrap can't buy anything new here. Push for Echoes or Prestige.";
export const BOTTLENECK_CHEAP = 'Your Scrap covers everything left here many times over. Push for Echoes or Prestige.';
/** Share of the Scrap the rest of a category may cost and still count as "nothing meaningful to buy". */
export const BOTTLENECK_SHARE = 0.1;

/**
 * Late-game bottleneck (pure; derived from ShopEntry data only): the open category's Scrap rows (no doctrines). Every
 * row maxed or locked (and at least one maxed) → BOTTLENECK_ALL; every open row affordable to its max rank, with the
 * whole remainder costing ≤ BOTTLENECK_SHARE of the Scrap on hand → BOTTLENECK_CHEAP; otherwise null.
 */
export function scrapBottleneck(entries: readonly ShopEntry[], scrap: number): string | null {
  const sc = entries.filter((e) => e.currency === 'scrap' && e.kind !== 'doctrine');
  if (!sc.length || !(scrap > 0)) return null;
  const open = sc.filter((e) => !e.locked && e.rank < e.maxRank);
  if (!open.length) return sc.some((e) => e.rank >= e.maxRank) ? BOTTLENECK_ALL : null;
  let total = 0;
  for (const e of open) {
    if (e.affordableRanks < e.maxRank - e.rank) return null;
    total += e.affordableTotal;
  }
  return total <= scrap * BOTTLENECK_SHARE ? BOTTLENECK_CHEAP : null;
}

/** Fill a Buy button's two parts: the small count line ("×10", "Max ×7"; hidden for one rank) and the price. */
function paintBuy(countEl: HTMLElement, price: HTMLElement, l: BuyLabel, currency: ShopEntry['currency']): void {
  text(countEl, l.count ?? '');
  show(countEl, !!l.count);
  const key = `${currency}|${l.price}`;
  if (price.dataset.v !== key) { price.dataset.v = key; price.replaceChildren(icon(currency === 'cores' ? 'cores' : 'scrap', 'ico tiny'), fmtNum(l.price)); }
  price.className = `price ${currency}`;
}

/** Make `el` a keyboard-operable toggle that runs `fn` (a row body that unfolds; never a Buy button). */
function tapToggle(el: HTMLElement, fn: () => void): void {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.addEventListener('click', fn);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
}

class NodeRow {
  readonly el: HTMLElement;
  private readonly name = h('span', { class: 'node-name' });
  private readonly rank = h('span', { class: 'node-rank' });
  private readonly chev = icon('down', 'ico tiny node-chev');
  /** "★ Suggested" (a hint only: nothing buys on its own). */
  private readonly star = h('span', { class: 'star-tag', text: '★ Suggested' });
  private readonly desc = h('p', { class: 'node-desc' });
  /** Before → after of the headline stat at the buy quantity (stat rows). */
  private readonly stat = h('p', { class: 'node-stat' });
  private readonly lock = h('p', { class: 'node-lock' });
  private readonly main: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private readonly bcount = h('span', { class: 'buy-count' });
  private readonly price = h('span', { class: 'price' });
  private lastKey = '';
  private full = '';
  private headline = '';
  entry: ShopEntry;
  constructor(entry: ShopEntry, send: (e: ShopEntry, count: number) => void, private readonly qty: () => BuyQty, private readonly opened: Set<string>) {
    this.entry = entry;
    this.btn = h('button', { type: 'button', class: 'btn buy' }, this.bcount, this.price);
    // hold-to-repeat only at ×1; a ×10 / Max press buys once
    holdRepeat(this.btn, () => { const l = buyLabel(this.entry, this.qty()); if (l.send !== null) send(this.entry, l.send); }, () => this.qty() === 1);
    this.main = h('div', { class: 'node-main' }, h('div', { class: 'node-head' }, this.name, this.rank, this.chev, this.star), this.stat, this.desc, this.lock);
    this.el = h('div', { class: 'node', data: { node: entry.node } }, this.main, this.btn);
    this.star.hidden = true;
    this.update(entry);
  }
  setSuggested(on: boolean): void {
    if (this.star.hidden !== on) return;
    this.star.hidden = !on;
    this.el.classList.toggle('suggested', on);
  }
  private get open(): boolean { return this.opened.has(this.entry.node); }
  private paintDesc(): void {
    const open = this.open;
    this.el.classList.toggle('open', open);
    text(this.desc, open ? this.full : this.headline);
    attr(this.main, 'aria-expanded', open ? 'true' : 'false');
  }
  update(e: ShopEntry): void {
    this.entry = e;
    const q = this.qty();
    const sl = e.rank < e.maxRank ? statLine(e, q) : null;
    const key = `${e.rank}|${e.maxRank}|${e.cost}|${e.affordable}|${e.locked ?? ''}|${e.currency}|${q}|${e.affordableRanks}|${e.affordableTotal}|${sl ?? ''}`;
    if (key === this.lastKey) return;
    text(this.stat, sl ?? '');
    show(this.stat, !!sl);
    // a labelled preview says what the headline would; the headline returns when the row unfolds
    this.el.classList.toggle('has-stat', !!sl && !!e.statLabel);
    const first = this.lastKey === '';
    this.lastKey = key;
    if (first) {
      text(this.name, e.name);
      const def = NODE_BY_ID.get(e.node);
      const eff = def?.effects[0];
      this.full = substituteDesc(e.desc, eff?.perRank, eff?.op);
      const s = splitDesc(this.full);
      this.headline = s.headline;
      // the headline effect (at most two lines); the row body unfolds the rest
      const expandable = s.more || s.headline.length > 64 || (!!e.statLabel && e.statNow !== undefined);   // a labelled stat line folds the headline away
      this.el.classList.add(`k-${e.kind}`, `t${e.tier}`);
      this.el.classList.toggle('expandable', expandable);
      (this.chev as unknown as HTMLElement).style.display = expandable ? '' : 'none';
      if (expandable) {
        tapToggle(this.main, () => { if (this.open) this.opened.delete(this.entry.node); else this.opened.add(this.entry.node); this.paintDesc(); });
        attr(this.main, 'aria-label', `${e.name}: ${this.full}`);
      }
      this.paintDesc();
    }
    text(this.rank, e.maxRank > 1 ? `${e.rank}/${e.maxRank}` : e.rank > 0 ? 'Owned' : '');
    const maxed = e.rank >= e.maxRank;
    this.el.classList.toggle('maxed', maxed);
    this.el.classList.toggle('affordable', e.affordable);
    this.el.classList.toggle('locked', !!e.locked && !maxed);
    text(this.lock, e.locked && !maxed ? e.locked : '');
    show(this.lock, !!e.locked && !maxed);
    const l = buyLabel(e, q);
    const cur = e.currency === 'cores' ? 'Cores' : 'Scrap';
    this.btn.classList.toggle('bulk', !!l.count && !maxed);
    if (maxed) { show(this.bcount, false); this.price.dataset.v = 'max'; this.price.replaceChildren(icon('check', 'ico tiny'), 'Max'); this.price.className = `price ${e.currency}`; }
    else paintBuy(this.bcount, this.price, l, e.currency);
    disable(this.btn, maxed || !!e.locked || l.disabled);
    const what = l.count ? `${l.count.replace('×', '')} ranks of ${e.name}` : e.name;
    attr(this.btn, 'aria-label', maxed ? `${e.name}: max rank` : `Buy ${what} for ${fmtNum(l.price)} ${cur}${e.locked ? ` (locked: ${e.locked})` : l.disabled ? ' (not enough)' : ''}`);
    this.btn.title = e.locked ?? (l.disabled ? `Need ${fmtNum(l.price)} ${cur}` : q === 1 ? 'Hold to buy repeatedly' : `Buy ${buyLabelText(l)} ${cur}`);
  }
}

type Item =
  | { t: 'head'; text: string; sub?: string; /** stacked views: the group id (setTree scrolls to it) */ sec?: string }
  | { t: 'node'; e: ShopEntry }
  | { t: 'note'; text: string }
  | { t: 'fork'; tree: TreeId }
  | { t: 'el'; key: string; make: () => HTMLElement }
  | { t: 'fold'; kind: 'locked' | 'maxed'; key: string; list: ShopEntry[] };

/** An open slot (index into the build's list) and whether the content pool has something to put in it. */
interface SlotDecision { slot: number; offer: boolean }

/** A section of the list on show (a jump link in the breadcrumb menus). */
interface Section { sec: string; label: string }

/** Minimum horizontal travel (px) for a swipe on the list, and how much more horizontal than vertical it must be. */
export const SWIPE_MIN_DX = 50;
export const SWIPE_RATIO = 1.5;
/** Touches that start this close to the left edge belong to the system's swipe-back (→ Battle). */
export const SWIPE_EDGE = 24;

/** Is a touch from (x0, y0) to (x1, y1) a list swipe? -1 / +1 (previous / next) or 0. Pure. */
export function swipeDir(x0: number, y0: number, x1: number, y1: number): -1 | 0 | 1 {
  if (x0 < SWIPE_EDGE) return 0;
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) <= SWIPE_RATIO * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** One stop of the swipe order: a tree of a page, or a whole page (stacked pages, pages with no tree yet). */
export interface NavStop { cat: Category; tree: string }

/** The flattened swipe order: every revealed page's trees in order (a page without trees is one stop). Pure. */
export function navStops(pages: readonly { cat: Category; trees: readonly string[] }[]): NavStop[] {
  const out: NavStop[] = [];
  for (const p of pages) {
    if (STACKED.has(p.cat) || !p.trees.length) out.push({ cat: p.cat, tree: '' });
    else for (const t of p.trees) out.push({ cat: p.cat, tree: t });
  }
  return out;
}

/** The stop `dir` steps from (cat, tree), or null at either end (no wrap). Pure. */
export function stepStop(stops: readonly NavStop[], cat: Category, tree: string, dir: -1 | 1): NavStop | null {
  let i = stops.findIndex((s) => s.cat === cat && (s.tree === '' || s.tree === tree));
  if (i < 0) i = stops.findIndex((s) => s.cat === cat);
  if (i < 0) return stops[0] ?? null;
  return stops[i + dir] ?? null;
}

/** How many rows carry a "★ Suggested" tag (across the whole Upgrades screen). */
export const SUGGEST_MAX = 3;
/** The rows marked "★ Suggested": today's Suggested pick (the cheapest affordable, unlocked Scrap buys). A hint only. Pure. */
export function suggestedNodes(shop: readonly ShopEntry[], n = SUGGEST_MAX): Set<string> {
  return new Set(cheapestAffordable(shop.filter((e) => e.rank < e.maxRank), n).map((e) => e.node));
}

export class Shop {
  readonly el: HTMLElement;
  /** Buy quantity: one chip cycling ×1 → ×10 → Max (Q); GameUi puts it in the shell's top row. */
  readonly qtyChip: HTMLButtonElement;
  private readonly qtyVal = h('span', { class: 'qty-val' });
  // ---- the breadcrumb line: Page ▾ › Tree ▾ … QM [switch]
  private readonly pageLabel = h('span', { class: 'crumb-label' });
  private readonly pageDot = h('span', { class: 'cat-dot', attrs: { 'aria-hidden': 'true' } });
  private readonly pageCaret = h('span', { class: 'crumb-caret', text: '▾', attrs: { 'aria-hidden': 'true' } });
  private readonly pageBtn: HTMLButtonElement;
  private readonly sep = h('span', { class: 'crumb-sep', text: '›', attrs: { 'aria-hidden': 'true' } });
  private readonly treeLabel = h('span', { class: 'crumb-label' });
  private readonly treeCount = h('span', { class: 'crumb-count', attrs: { 'aria-hidden': 'true' } });
  private readonly treeDot = h('span', { class: 'chip-dot', attrs: { 'aria-hidden': 'true' } });
  private readonly treeBtn: HTMLButtonElement;
  private readonly qmBtn: HTMLButtonElement;
  private readonly crumbs: HTMLElement;
  private readonly head: HTMLElement;
  /** First-purchase explainer (retires after COACH_BUYS purchases). */
  private readonly coach = h('p', { class: 'quick-coach star-explain', text: '★ marks the cheapest upgrades your Scrap buys right now. Tap a price to buy.' });
  /** Decision rows: an empty slot of this category, this tree's open Doctrine fork. */
  private readonly decisions = h('div', { class: 'shop-decisions' });
  private decisionKey = '';
  private readonly list = h('div', { class: 'shop-list' });
  private readonly body: HTMLElement;
  /** A bulk buy in flight: its Purchase events are summed into one toast. */
  private pendingBulk: { where: string | null; until: number; events: SimEvent[]; timer: number } | null = null;
  /** Bring the Upgrades screen forward when a chip, the death card or the Build screen jumps to a tree (GameUi wires it). */
  onReveal: (() => void) | null = null;
  /** The category on show changed (GameUi: the wallet bar follows it). */
  onViewChange: (() => void) | null = null;
  private readonly rows = new Map<string, NodeRow>();
  private cat: Category;
  private tree: string;
  /** The tree to go back to when an open slot's picker is folded away. */
  private lastTree = '';
  private viewKey = '';
  private ui: UiState | null = null;
  private revealKey = '';
  /** Folds ("N locked", "N maxed") opened this session, and node rows unfolded to their full description. */
  private readonly foldsOpen = new Set<string>();
  private readonly descOpen = new Set<string>();
  /** A stacked view's group to scroll to once rendered. */
  private pendingSec: string | null = null;
  /** The sections of the list on show (jump links in the menus). */
  private sections: Section[] = [];
  /** Rows marked "★ Suggested" (suggestedNodes over the pooled shop; only once 'bulk' is revealed). */
  private suggested = new Set<string>();
  /** The breadcrumb menu open now (closed by Esc, Back, a tap outside or a choice). */
  private menu: ModalHandle | null = null;
  /** Slide direction for the next render (a swipe or ← / →). */
  private slide: -1 | 0 | 1 = 0;
  /**
   * Quartermaster (quartermaster.ts), once 'quartermaster' is revealed. Before it unlocks: its one-line teaser at the
   * top of the list. The first time it is unlocked (prefs.qmSeen) the full card shows there, under a one-row summary
   * that folds it away; after that it lives in the breadcrumb line: "QM [switch]", and a tap on "QM" opens the card
   * as a sheet.
   */
  private readonly qm: QuartermasterPanel;
  private readonly qmState = h('span', { class: 'qmf-state' });
  private readonly qmAct = h('span', { class: 'fold-act' });
  private readonly qmChev = h('span', { class: 'qmf-chev' });
  private readonly qmSummary: HTMLButtonElement;
  private readonly qmWrap: HTMLElement;
  /** The player's fold choice this session (null: the default above). */
  private qmOpen: boolean | null = null;
  /** The card had not been seen when this session started: it stays open this session until folded. */
  private readonly qmFirst = !prefs().qmSeen;
  private readonly qmSwitch = h('input', { attrs: { type: 'checkbox', 'aria-label': 'Quartermaster on' } }) as HTMLInputElement;
  private readonly qmSwitchWrap = h('label', { class: 'switch qm-inline', data: { hint: 'quartermaster-toggle' } }, this.qmSwitch, h('span', { class: 'slider' }));
  private readonly qmCrumb: HTMLElement;
  private qmSheet: ModalHandle | null = null;
  /** Late game (Phase 2): "Scrap can't buy anything new here" + a Forecast button, at the top of the list. */
  private readonly bneckText = h('span', { class: 'bn-text' });
  private readonly bneck: HTMLElement;

  constructor(private readonly ctx: UiCtx) {
    const p = prefs();
    this.cat = (CATEGORIES.some((c) => c.id === p.shopCategory) ? p.shopCategory : 'chassis') as Category;
    this.tree = p.shopTree;
    this.pageBtn = button([this.pageLabel, this.pageDot, this.pageCaret], () => this.openPageMenu(), { class: 'btn ghost crumb crumb-page' });
    this.pageBtn.dataset.hint = 'page-menu';
    attr(this.pageBtn, 'aria-haspopup', 'menu');
    this.treeBtn = button([this.treeLabel, this.treeCount, this.treeDot, h('span', { class: 'crumb-caret', text: '▾', attrs: { 'aria-hidden': 'true' } })], () => this.openTreeMenu(), { class: 'btn ghost crumb crumb-tree' });
    this.treeBtn.dataset.hint = 'tree-menu';
    attr(this.treeBtn, 'aria-haspopup', 'menu');
    this.qmBtn = button('QM', () => this.openQmSheet(), { class: 'btn ghost crumb crumb-qm', label: 'Quartermaster settings' });
    this.qmCrumb = h('div', { class: 'qm-crumb' }, this.qmBtn, this.qmSwitchWrap);
    this.qmCrumb.hidden = true;
    this.crumbs = h('nav', { class: 'crumbs', attrs: { 'aria-label': 'Upgrades: page and tree' } }, this.pageBtn, this.sep, this.treeBtn, h('span', { class: 'crumb-gap' }), this.qmCrumb);
    this.head = h('div', { class: 'shop-head' }, this.crumbs);
    this.qtyChip = button([h('span', { class: 'qty-k', text: 'Buy' }), this.qtyVal], () => this.cycleQty(), { class: 'btn qty-chip', title: 'Ranks per Buy tap: ×1 → ×10 → Max (Q)' });
    this.qtyChip.dataset.hint = 'qty';
    this.syncQty();
    this.body = h('div', { class: 'shop-body' }, this.coach, this.decisions, this.list);
    // pinned: the breadcrumb line (the wallet and the quantity chip are in the shell's top row); the rest scrolls
    this.el = h('section', { class: 'shop', attrs: { 'aria-label': 'Upgrades' } }, this.head, this.body);
    this.qm = new QuartermasterPanel(ctx);
    this.qmSummary = button([icon('bank', 'ico tiny'), h('span', { class: 'fold-label', text: 'Quartermaster' }), this.qmState, this.qmAct, this.qmChev], () => {
      this.qmOpen = this.qm.el.hidden || !this.qmWrap.contains(this.qm.el);
      this.viewKey = '';
      if (this.ui) this.update(this.ui);
    }, { class: 'btn fold-btn qm-fold-btn' });
    this.qmSwitch.addEventListener('change', () => this.ctx.host.send({ type: 'set_quartermaster', on: this.qmSwitch.checked }));
    this.qmWrap = h('div', { class: 'qm-fold' }, h('div', { class: 'qm-row' }, this.qmSummary), this.qm.el);
    this.bneck = h('div', { class: 'bottleneck', attrs: { role: 'status' } }, icon('forecast', 'ico bn-ico'), this.bneckText,
      button('Forecast', () => this.ctx.open('forecast'), { class: 'btn small bn-btn', label: 'Open the Forecast' }));
    this.bneck.hidden = true;
    this.body.insertBefore(this.bneck, this.body.firstChild);
    this.wireSwipe();
  }

  // ---------------------------------------------------------------- Quartermaster
  /** Where the Quartermaster shows: nowhere, its teaser / first-time card at the top of the list, or the breadcrumb line. */
  private qmPlace(ui: UiState): 'none' | 'list' | 'crumb' {
    if (!this.f.quartermaster) return 'none';
    const q = ui.quartermaster;
    if (!q?.unlocked) return this.cat === 'cores' ? 'none' : 'list';   // the teaser, as before
    return (this.qmOpen ?? this.qmFirst) && this.cat !== 'cores' ? 'list' : 'crumb';
  }

  /** The Quartermaster summary line, the card and the breadcrumb switch. */
  private syncQm(ui: UiState): void {
    const q = ui.quartermaster;
    const locked = !q?.unlocked;
    const place = this.qmPlace(ui);
    if (place === 'list' && !locked && !prefs().qmSeen) setPref('qmSeen', true);
    const inList = place === 'list';
    if (inList && !this.qmSheet && this.qm.el.parentElement !== this.qmWrap) this.qmWrap.appendChild(this.qm.el);
    this.qm.el.hidden = !(inList || this.qmSheet);
    show(this.qmSummary, inList && !locked);
    show(this.qmCrumb, place === 'crumb');
    if (q && this.qmSwitch.checked !== q.on) this.qmSwitch.checked = q.on;
    this.qmSwitch.disabled = locked;
    const bank = qmBank(ui);
    const state = !q ? '' : q.on ? `On${bank !== null ? ` · bank ${fmtExactish(bank)}` : ''}` : 'Off';
    text(this.qmState, state);
    attr(this.qmBtn, 'aria-label', `Quartermaster settings${state ? ` (${state})` : ''}`);
    if (this.qmChev.dataset.open !== 'true') {
      this.qmChev.dataset.open = 'true';
      text(this.qmAct, 'Hide');
      this.qmChev.replaceChildren(icon('up', 'ico tiny chev'));
      attr(this.qmSummary, 'aria-expanded', 'true');
      attr(this.qmSummary, 'aria-label', 'Quartermaster: fold the card into the top line');
    }
    this.qm.update(ui);
  }

  /** "QM" in the breadcrumb line: the full Quartermaster card as a sheet. */
  private openQmSheet(): void {
    if (this.qmSheet || !this.ui) return;
    this.closeMenu();
    this.qm.el.hidden = false;
    this.qmSheet = openModal({ title: 'Quartermaster', body: this.qm.el, variant: 'sheet', className: 'qm-sheet', returnFocus: this.qmBtn,
      onClose: () => { this.qmSheet = null; this.qm.el.remove(); if (this.ui) this.syncQm(this.ui); } });
    this.qm.update(this.ui);
  }

  /** What this Prestige offers (progression.ts content pool; Unlock everything offers all). */
  private pool(ui: UiState): ContentPool { return contentPool(ui, { unlockAll: this.f.unlockAll }); }
  /** The sim's shop without cross-system entries whose parts the pool does not offer yet. */
  private pooled(ui: UiState): ShopEntry[] { return poolShop(ui.shop, this.pool(ui)); }

  /** The open category's Scrap entries (pooled), for the bottleneck line. */
  private catEntries(ui: UiState, c: Category = this.cat): ShopEntry[] {
    const pooled = this.pooled(ui);
    const inCat = (t: string): boolean => {
      switch (c) {
        case 'chassis': return (CHASSIS as string[]).includes(t) || t === 'ability';
        case 'elements': return (ELEMENTS as string[]).includes(t);
        case 'hardpoints': return (HARDPOINTS as string[]).includes(t);
        case 'cross': return t === 'fusion' || t === 'link' || t === 'infuse';
        default: return false;
      }
    };
    return pooled.filter((e) => inCat(e.tree as string));
  }

  /** The bottleneck line (shown only once the Forecast is revealed: it names Echoes and Prestige). */
  private updateBottleneck(ui: UiState): void {
    // not while a decision waits here (an empty slot, a free Doctrine fork): that is the next thing to do, not a Prestige
    const b = this.f.forecast && this.f.prestigeTab && !this.decisionIn(ui, this.cat) ? scrapBottleneck(this.catEntries(ui), ui.run.scrap) : null;
    show(this.bneck, !!b);
    if (b) text(this.bneckText, b);
  }

  private get f(): Features { return this.ctx.features(); }
  /** The category and tree on show (pointer hints chain through them). */
  view(): { cat: string; tree: string } { return { cat: this.cat, tree: this.tree }; }

  /** Progressive reveal: categories and the quantity chip (GameUi, every UiState). */
  setFeatures(f: Features): void {
    const key = `${f.elements}${f.hardpoints}${f.cross}${f.cores}${f.bulk}${f.chassisAll}${f.quartermaster}`;
    if (key === this.revealKey) return;
    this.revealKey = key;
    const cats = this.shownCats(f);
    this.qtyChip.hidden = !f.bulk;
    this.el.classList.toggle('no-bulk', !f.bulk);
    if (!cats.includes(this.cat)) this.setCategory('chassis');
    this.syncQty();
    this.viewKey = ''; this.decisionKey = '';
  }

  private shownCats(f: Features = this.f): Category[] {
    return CATEGORIES.map((c) => c.id).filter((c) => c === 'chassis' || f[c]);
  }

  // ---------------------------------------------------------------- bulk buying
  get qty(): BuyQty { return this.f.bulk ? parseQty(prefs().buyQty) : 1; }

  /** Set the buy quantity (×1 · ×10 · Max). */
  setQty(q: BuyQty): void {
    if (q === this.qty) return;
    setPref('buyQty', q);
    this.syncQty();
    if (this.ui) this.update(this.ui);
  }
  /** The quantity chip and Q: ×1 → ×10 → Max → ×1. Returns the new quantity. */
  cycleQty(): BuyQty { const q = nextQty(this.qty); this.setQty(q); return q; }

  private syncQty(): void {
    const q = this.qty;
    text(this.qtyVal, qtyLabel(q));
    this.qtyChip.classList.toggle('bulk', q !== 1);
    attr(this.qtyChip, 'aria-label', `Buy quantity ${qtyLabel(q)}: tap for ${qtyLabel(nextQty(q))} (Q)`);
    this.el?.classList.toggle('qty-bulk', q !== 1);
  }

  /** Send one `buy` (count 1 = a single rank, the old command shape; 10; 0 = Max). */
  private sendBuy(e: ShopEntry, count: number): void {
    if (count !== 1) this.expectBulk(`of ${e.name}`);
    this.ctx.host.send(count === 1 ? { type: 'buy', node: e.node } : { type: 'buy', node: e.node, count });
  }

  /** The next Purchase events (within ~3 s) belong to a bulk buy: toast one summary. */
  private expectBulk(where: string | null): void {
    if (this.pendingBulk?.timer) clearTimeout(this.pendingBulk.timer);
    this.pendingBulk = { where, until: performance.now() + 3000, events: [], timer: 0 };
  }

  /** Event batches from the sim (GameUi.onEvents): sum a bulk buy's Purchase events into one toast. */
  notePurchases(events: readonly SimEvent[]): void {
    const p = this.pendingBulk;
    if (!p) return;
    if (performance.now() > p.until && !p.timer) { this.pendingBulk = null; return; }
    let any = false;
    for (const e of events) if (e.type === Ev.Purchase && e.data?.via !== 'quartermaster') { p.events.push(e); any = true; }   // automatic buys are not the player's
    if (!any || p.timer) return;
    p.timer = window.setTimeout(() => {
      if (this.pendingBulk === p) this.pendingBulk = null;
      const msg = bulkToast(p.events, p.where);
      if (msg) this.ctx.toast(msg, 'good');
    }, 350);
  }

  setCategory(c: Category): void {
    if (c === this.cat) return;
    this.cat = c; this.tree = '';
    setPref('shopCategory', c);
    this.viewKey = ''; this.decisionKey = '';
    if (this.ui) this.update(this.ui);
    this.body.scrollTop = 0;
    this.onViewChange?.();
  }
  setTree(t: string): void {
    if (t === this.tree) { if (STACKED.has(this.cat)) this.scrollToSec(t); return; }
    if (!this.tree.startsWith('slot:')) this.lastTree = this.tree;
    this.tree = t;
    setPref('shopTree', t);
    if (STACKED.has(this.cat)) { this.scrollToSec(t); return; }   // one stacked view: scroll to the group
    this.viewKey = ''; this.decisionKey = '';
    if (this.ui) this.update(this.ui);
    this.body.scrollTop = 0;
  }

  /** Bring a section (data-sec) to the top of the list once it is laid out (its header sticks under the breadcrumb). */
  private scrollToSec(sec: string): void {
    this.pendingSec = sec;
    requestAnimationFrame(() => {
      const s = this.pendingSec;
      this.pendingSec = null;
      const el = s ? this.list.querySelector<HTMLElement>(`[data-sec="${CSS.escape(s)}"]`) : null;
      if (el) this.body.scrollTop = Math.max(0, el.offsetTop - 2);
    });
  }

  // ---------------------------------------------------------------- navigation: swipe, ← / →
  /** Every revealed page with its trees (filled ones; stacked pages none), for the swipe order. */
  private stops(ui: UiState): NavStop[] {
    return navStops(this.shownCats().map((cat) => ({ cat, trees: STACKED.has(cat) ? [] : this.chips(ui, cat).filter((c) => !c.empty).map((c) => c.id) })));
  }

  /** Next (+1) / previous (-1) tree along the one flattened order (swipe on the list, ← / →). False at either end. */
  step(dir: -1 | 1): boolean {
    const ui = this.ui;
    if (!ui) return false;
    const next = stepStop(this.stops(ui), this.cat, this.tree, dir);
    if (!next) return false;
    this.closeMenu();
    this.slide = dir;
    if (next.cat !== this.cat) { this.cat = next.cat; this.tree = next.tree; setPref('shopCategory', next.cat); this.viewKey = ''; this.decisionKey = ''; if (next.tree) setPref('shopTree', next.tree); this.update(ui); this.body.scrollTop = 0; this.onViewChange?.(); }
    else this.setTree(next.tree);
    return true;
  }

  /** Horizontal swipes on the list (not from the left edge: that is the system's swipe back to Battle). */
  private wireSwipe(): void {
    let s: { x: number; y: number; id: number } | null = null;
    let swallowUntil = 0;
    this.body.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      const tgt = e.target as Element | null;
      // one finger, on the list, not on a control that is pressed and held (a Buy button, a switch, a picker card)
      s = e.touches.length === 1 && t && !tgt?.closest('button, input, label, select, .pick-card, .fork-cards') ? { x: t.clientX, y: t.clientY, id: t.identifier } : null;
    }, { passive: true });
    this.body.addEventListener('touchend', (e) => {
      const st = s;
      s = null;
      if (!st) return;
      const t = [...e.changedTouches].find((x) => x.identifier === st.id);
      if (!t) return;
      const d = swipeDir(st.x, st.y, t.clientX, t.clientY);
      if (d && this.step(d)) swallowUntil = performance.now() + 400;
    }, { passive: true });
    this.body.addEventListener('touchcancel', () => { s = null; }, { passive: true });
    // the tap that ended a swipe never also unfolds a row
    this.body.addEventListener('click', (e) => { if (performance.now() < swallowUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  // ---------------------------------------------------------------- breadcrumb menus
  private closeMenu(): void { const m = this.menu; this.menu = null; m?.close(); }

  private openMenu(anchor: HTMLButtonElement, title: string, rows: HTMLElement[], cls: string): void {
    this.closeMenu();
    const body = h('div', { class: `crumb-menu-list ${cls}`, attrs: { role: 'menu', 'aria-label': title } }, ...rows);
    attr(anchor, 'aria-expanded', 'true');
    const m = openModal({ title, body, variant: 'popover', className: 'crumb-menu', anchor, returnFocus: anchor,
      onClose: () => { attr(anchor, 'aria-expanded', 'false'); if (this.menu === m) this.menu = null; } });
    this.menu = m;
    (body.querySelector<HTMLElement>('[aria-current="true"]') ?? body.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }

  /** One menu row: label, a quiet count, ★ (holds a suggested buy), a dot + "New" (a decision waits). */
  private menuRow(o: { label: string; sub?: boolean; current?: boolean; count?: number; star?: boolean; dot?: string | null; hint?: string; empty?: boolean; onPick: () => void }): HTMLButtonElement {
    const parts: (HTMLElement | string)[] = [h('span', { class: 'cm-label', text: o.label })];
    if (o.count) parts.push(h('span', { class: 'cm-count', text: String(o.count), attrs: { 'aria-hidden': 'true' } }));
    if (o.star) parts.push(h('span', { class: 'cm-star', text: '★', attrs: { 'aria-hidden': 'true' } }));
    if (o.dot) parts.push(h('span', { class: 'cm-new' }, h('span', { class: 'cat-dot', attrs: { 'aria-hidden': 'true' } }), h('span', { text: 'New' })));
    const b = button(parts, () => { this.closeMenu(); o.onPick(); }, { class: `btn ghost cm-row${o.sub ? ' sub' : ''}${o.current ? ' current' : ''}${o.empty ? ' empty' : ''}` });
    b.setAttribute('role', 'menuitem');
    if (o.current) attr(b, 'aria-current', 'true');
    if (o.hint) b.dataset.hint = o.hint;
    attr(b, 'aria-label', `${o.label}${o.count ? `, ${o.count} affordable` : ''}${o.star ? ', has a suggested upgrade' : ''}${o.dot ? ` (${o.dot})` : ''}`);
    return b;
  }

  /** Jump links to the sections of the list on show (indented under the current page or tree). */
  private sectionRows(): HTMLElement[] {
    return this.sections.map((s) => this.menuRow({ label: s.label, sub: true, onPick: () => this.scrollToSec(s.sec) }));
  }

  /** "Page ▾": the revealed pages in order; a stacked page on show lists its sections under it. */
  private openPageMenu(): void {
    const ui = this.ui;
    if (!ui) return;
    const cats = this.shownCats();
    if (cats.length < 2 && !STACKED.has(this.cat)) return;
    const rows: HTMLElement[] = [];
    for (const c of CATEGORIES) {
      if (!cats.includes(c.id)) continue;
      const cur = c.id === this.cat;
      rows.push(this.menuRow({ label: c.label, current: cur, star: this.starIn(ui, c.id), dot: this.decisionIn(ui, c.id), hint: `cat-${c.id}`,
        onPick: () => { if (cur) this.body.scrollTop = 0; else this.setCategory(c.id); } }));
      if (cur && STACKED.has(c.id)) rows.push(...this.sectionRows());
    }
    this.openMenu(this.pageBtn, 'Upgrade pages', rows, 'page-menu');
  }

  /** "Tree ▾": the page's trees (and empty slots); the current tree lists its sections under it. */
  private openTreeMenu(): void {
    const ui = this.ui;
    if (!ui || STACKED.has(this.cat)) return;
    const forks = new Set(this.forksOf(ui, this.cat));
    const rows: HTMLElement[] = [];
    for (const c of this.chips(ui, this.cat)) {
      const cur = c.id === this.tree;
      if (c.empty) {
        rows.push(this.menuRow({ label: '+ Empty slot', empty: true, current: cur, hint: 'slot-menu', onPick: () => this.setTree(c.id) }));
        continue;
      }
      rows.push(this.menuRow({ label: c.label, current: cur, count: this.affordableCount(ui, c.id), star: this.starInTree(ui, c.id), dot: forks.has(c.id) ? 'Doctrine fork open' : null,
        onPick: () => { if (cur) this.body.scrollTop = 0; else this.setTree(c.id); } }));
      if (cur) rows.push(...this.sectionRows());
    }
    this.openMenu(this.treeBtn, `${CATEGORIES.find((c) => c.id === this.cat)?.label ?? ''} trees`, rows, 'tree-menu');
  }

  /** Does `cat` hold a ★ Suggested row? */
  private starIn(ui: UiState, cat: Category): boolean {
    if (!this.suggested.size || cat === 'cores') return false;
    return this.catEntries(ui, cat).some((e) => this.suggested.has(e.node));
  }
  private starInTree(ui: UiState, tree: string): boolean {
    return this.suggested.size > 0 && this.entriesFor(ui, tree).some((e) => this.suggested.has(e.node));
  }

  /** The breadcrumb line: page, tree (pages with two or more trees or slots), dots, counts. */
  private updateCrumbs(ui: UiState, all: Chip[], chipsOn: boolean, forks: Set<string>): void {
    const cats = this.shownCats();
    const label = CATEGORIES.find((c) => c.id === this.cat)?.label ?? '';
    text(this.pageLabel, label);
    const menuable = cats.length > 1 || STACKED.has(this.cat);
    this.pageBtn.classList.toggle('static', !menuable);
    this.pageBtn.dataset.pages = cats.join(',');   // the revealed pages (tests, and the menu's source)
    show(this.pageCaret, menuable);
    const others = cats.filter((c) => c !== this.cat).map((c) => this.decisionIn(ui, c)).filter(Boolean);
    show(this.pageDot, others.length > 0);
    attr(this.pageBtn, 'aria-label', `Page: ${label}${menuable ? '. Choose a page' : ''}${others.length ? ` (${others[0]} on another page)` : ''}`);
    this.pageBtn.tabIndex = menuable ? 0 : -1;
    show(this.treeBtn, chipsOn);
    show(this.sep, chipsOn);
    if (chipsOn) {
      const cur = all.find((c) => c.id === this.tree);
      const name = cur?.empty ? 'Empty slot' : cur?.label ?? '';
      text(this.treeLabel, name);
      const n = cur && !cur.empty ? this.affordableCount(ui, cur.id) : 0;
      text(this.treeCount, n > 0 ? String(n) : '');
      const otherFork = [...forks].some((t) => t !== this.tree);
      show(this.treeDot, otherFork);
      attr(this.treeBtn, 'aria-label', `Tree: ${name}${n > 0 ? `, ${n} affordable` : ''}. Choose a tree${otherFork ? ' (Doctrine fork open in another tree)' : ''}`);
    }
  }

  // ---------------------------------------------------------------- chips
  /** The trees of a category (open slots of Elements / Hardpoints are `slot:<i>`; stacked views list their groups). */
  private chips(ui: UiState, cat: Category = this.cat): Chip[] {
    const b = ui.build, r = ui.run;
    switch (cat) {
      case 'chassis': return CHASSIS.map((id) => ({ id, label: TREE_LABEL[id] }));
      case 'elements': {
        const n = Math.max(r.attunementSlotsOpen, b.attunements.length);
        const out: Chip[] = [];
        for (let i = 0; i < n; i++) { const el = b.attunements[i]; out.push(el ? { id: el, label: TREE_LABEL[el] } : { id: `slot:${i}`, label: 'Empty slot', empty: true }); }
        return out;
      }
      case 'hardpoints': {
        const n = Math.max(r.hardpointSlotsOpen, b.hardpoints.length);
        const out: Chip[] = [];
        for (let i = 0; i < n; i++) { const hp = b.hardpoints[i]; out.push(hp ? { id: hp, label: TREE_LABEL[hp] } : { id: `slot:${i}`, label: 'Empty slot', empty: true }); }
        // systems that run without a slot: a Frame's free mount, or a Borrowed Blade
        for (const x of ui.extraSystems ?? []) out.push({ id: x.system, label: `${TREE_LABEL[x.system]} · ${x.via === 'borrowed' ? 'borrowed' : 'Frame'}` });
        return out;
      }
      case 'cross': return CROSS_GROUPS.map((g) => ({ id: g.id, label: g.label }));
      case 'cores': return [{ id: 'exotic', label: 'Exotics' }, { id: 'refit', label: 'Refit' }, { id: 'doctrine', label: 'Doctrines' }];
    }
  }

  private entriesFor(ui: UiState, chip: string): ShopEntry[] {
    if (chip.startsWith('slot:')) return [];
    const t = TREE_BY_ID.get(chip as TreeId);
    if (!t) return [];
    const ids = new Set<string>([...t.shared.map((n) => n.id), ...t.doctrines.flatMap((d) => d.nodes.map((n) => n.id)), t.exotic.id, ...t.doctrines.map((d) => `${t.id}.${d.id}`)]);
    return ui.shop.filter((e) => ids.has(e.node) || (t.id === 'reactor' && e.tree === 'ability'));   // Reactor lists the ability rank nodes
  }

  private affordableCount(ui: UiState, chip: string): number {
    return this.entriesFor(ui, chip).filter((e) => e.affordable && !e.locked && e.kind !== 'doctrine' && e.rank < e.maxRank).length;
  }

  /** Empty open slots of Elements (true) / Hardpoints (false), and whether the pool offers something for them. */
  private openSlotsOf(ui: UiState, isEl: boolean): SlotDecision[] {
    const list = isEl ? ui.build.attunements : ui.build.hardpoints;
    const open = isEl ? ui.run.attunementSlotsOpen : ui.run.hardpointSlotsOpen;
    const offer = this.pickList(ui, isEl).some((id) => isEl || !ui.mountBlocked?.[id as HardpointId]);
    const out: SlotDecision[] = [];
    for (let i = 0; i < open; i++) if (!list[i]) out.push({ slot: i, offer });
    return out;
  }

  /** Trees with a free Doctrine choice (an open fork, an empty second slot), by the category that shows them. */
  private forksOf(ui: UiState, c: Category): string[] {
    const frame = (ui.extraSystems ?? []).filter((x) => x.via === 'frame').map((x) => x.system as string);
    const inCat = (t: string): boolean => c === 'chassis' ? (CHASSIS as string[]).includes(t)
      : c === 'elements' ? (ui.build.attunements as (string | null)[]).includes(t)
      : c === 'hardpoints' ? (ui.build.hardpoints as (string | null)[]).includes(t) || frame.includes(t) : false;
    if (!doctrinesShown(ui, this.f.unlockAll)) return [];
    return freeDoctrineTrees({ shop: ui.shop, build: ui.build }).filter(inCat);
  }

  /** A decision waits in this category: an empty slot with something to put in it, or a free Doctrine fork. */
  private decisionIn(ui: UiState, c: Category): string | null {
    if ((c === 'elements' || c === 'hardpoints') && this.openSlotsOf(ui, c === 'elements').some((s) => s.offer)) return c === 'elements' ? 'empty attunement slot' : 'empty hardpoint slot';
    if (this.forksOf(ui, c).length) return 'Doctrine fork open';
    return null;
  }

  /** Show a category / tree (death card, Build screen) and bring Upgrades forward. */
  open(cat: Category, tree?: string): void {
    this.setCategory(cat);
    if (tree) this.setTree(tree);
    this.onReveal?.();
  }

  /** Open the tree that `tree` belongs to (a chassis, element, hardpoint or cross tree); `fork` scrolls to its Doctrine fork. */
  jumpTo(tree: string, fork = false): void {
    const t = TREE_BY_ID.get(tree as TreeId);
    const cat: Category = !t ? 'cross' : (ELEMENTS as string[]).includes(tree) ? 'elements' : (HARDPOINTS as string[]).includes(tree) ? 'hardpoints' : 'chassis';
    this.open(cat, tree);
    // the screen renders synchronously when it is brought forward; scroll once it has laid out
    if (fork) requestAnimationFrame(() => { const f = this.list.querySelector<HTMLElement>('.fork'); const s = (f?.closest('.shop-section') ?? f) as HTMLElement | null; if (s) this.body.scrollTop = Math.max(0, s.offsetTop - 4); });
  }

  /** A purchase happened (Ev.Purchase): retire the first-purchase explainer after three. */
  noteBuy(): void {
    const n = prefs().buyCoach;
    if (n < COACH_BUYS) setPref('buyCoach', n + 1);
  }

  // ---------------------------------------------------------------- update
  update(ui: UiState, _scrapRate = 0): void {
    this.syncQty();
    this.ui = ui;
    this.updateBottleneck(ui);
    this.updateSuggest(ui);

    const all = this.chips(ui);
    if (!all.some((c) => c.id === this.tree)) this.tree = all.find((c) => !c.empty)?.id ?? all[0]?.id ?? '';
    const stacked = STACKED.has(this.cat);
    // the tree crumb: a page with two or more trees (empty slots count: the menu opens their picker)
    const chipsOn = !stacked && all.length >= 2;
    const forks = new Set(this.forksOf(ui, this.cat));
    this.updateCrumbs(ui, all, chipsOn, forks);
    this.updateDecisions(ui, all, forks);
    this.syncQm(ui);

    const items = this.fold(this.plan(ui, chipsOn), stacked);
    const key = `${this.cat}|${stacked ? '' : this.tree}|${chipsOn}|${this.qmPlace(ui)}|` + items.map((i) => i.t === 'node' ? i.e.node : i.t === 'fork' ? `fork:${forkKey(ui, i.tree)}`
      : i.t === 'el' ? `el:${i.key}` : i.t === 'fold' ? `fold:${i.key}:${this.foldsOpen.has(i.key)}:${i.list.map((e) => e.node).join('+')}` : `${i.t}:${i.text}`).join(',');
    if (key !== this.viewKey) {
      this.viewKey = key;
      this.render(ui, items);
    } else {
      for (const it of items) {
        if (it.t === 'node') this.rows.get(it.e.node)?.update(it.e);
        else if (it.t === 'fold' && this.foldsOpen.has(it.key)) for (const e of it.list) this.rows.get(e.node)?.update(e);
      }
    }
    for (const [id, r] of this.rows) r.setSuggested(this.suggested.has(id));
  }

  /** ★ Suggested: at most SUGGEST_MAX rows across the screen (only once 'bulk' is revealed, like the old Suggested line). */
  private updateSuggest(ui: UiState): void {
    this.suggested = this.f.bulk ? suggestedNodes(this.pooled(ui)) : new Set();
    // the explainer only for the first few purchases, and only while something carries the tag
    show(this.coach, prefs().buyCoach < COACH_BUYS && this.suggested.size > 0);
  }

  /**
   * Decision rows at the top of the list: each empty slot of Elements / Hardpoints (it opens the slot's picker in
   * place; tapped again it folds back to the tree), and the open Doctrine fork of the tree on show.
   */
  private updateDecisions(ui: UiState, all: Chip[], forks: Set<string>): void {
    const isEl = this.cat === 'elements';
    const slots = this.cat === 'elements' || this.cat === 'hardpoints' ? this.openSlotsOf(ui, isEl) : [];
    const fork = !this.tree.startsWith('slot:') && forks.has(this.tree) ? this.tree : null;
    const second = fork ? !!ui.build.doctrines[fork as TreeId] : false;
    const key = `${this.cat}|${this.tree}|${slots.map((s) => `${s.slot}${s.offer}`).join(',')}|${fork ?? ''}${second}`;
    if (key === this.decisionKey) return;
    this.decisionKey = key;
    const filled = all.filter((c) => !c.empty);
    const rows: HTMLElement[] = [];
    for (const s of slots) {
      const on = this.tree === `slot:${s.slot}`;
      const b = button([icon('plus', 'ico dr-ico'),
        h('span', { class: 'dr-main' }, h('span', { class: 'dr-title', text: isEl ? 'Attune an element' : 'Mount a weapon' }),
          h('span', { class: 'dr-sub', text: s.offer ? `Slot ${s.slot + 1} is empty` : `Slot ${s.slot + 1} is empty · nothing new to ${isEl ? 'attune' : 'mount'} yet` })),
        s.offer ? h('span', { class: 'dr-dot', attrs: { 'aria-hidden': 'true' } }) : null,
        on && !filled.length ? null : icon(on ? 'up' : 'down', 'ico tiny chev')],   // nothing to fold back to: no chevron
      () => { if (!on) this.setTree(`slot:${s.slot}`); else if (filled.length) this.setTree(filled.some((c) => c.id === this.lastTree) ? this.lastTree : filled[0].id); },
      { class: `btn decision-row slot-row${on ? ' on' : ''}${s.offer ? ' decision' : ''}` });
      b.dataset.hint = 'slot-chip';   // pointer hints (hints.ts): the empty slot, then its picker
      attr(b, 'aria-expanded', on ? 'true' : 'false');
      rows.push(b);
      // the picker opens right under its row (not down in the list, where the Quartermaster card could push it off screen)
      if (on) rows.push(this.slotPicker(isEl, s.slot));
    }
    if (fork) {
      const name = TREE_LABEL[fork as TreeId] ?? fork;
      const sd = ui.secondDoctrine?.[fork as TreeId];
      rows.push(button([icon('plus', 'ico dr-ico'),
        h('span', { class: 'dr-main' }, h('span', { class: 'dr-title', text: second ? `Choose a second ${name} Doctrine` : `Choose a ${name} Doctrine` }),
          h('span', { class: 'dr-sub', text: second ? `Free${sd ? `, runs at ${Math.round(sd.strength * 100)}%` : ''}` : 'The fork is open: pick one path' })),
        h('span', { class: 'dr-dot', attrs: { 'aria-hidden': 'true' } }), icon('right', 'ico tiny chev')],
      () => this.jumpTo(fork, true), { class: 'btn decision-row fork-row decision' }));
    }
    this.decisions.replaceChildren(...rows);
    show(this.decisions, rows.length > 0);
  }
  /** The view's items before folding. */
  private plan(ui: UiState, chipsOn: boolean): Item[] {
    const chip = this.tree;
    const out: Item[] = [];
    const byId = new Map(ui.shop.map((e) => [e.node, e]));
    const nodes = (ids: string[]): Item[] => (ids.map((id) => byId.get(id)).filter((e): e is ShopEntry => !!e)).map((e) => ({ t: 'node', e }));

    if (this.cat === 'elements' || this.cat === 'hardpoints') {
      const isEl = this.cat === 'elements';
      const open = isEl ? ui.run.attunementSlotsOpen : ui.run.hardpointSlotsOpen;
      if (open === 0 && !chip) {
        const next = isEl ? ui.nextAttunementWave : ui.nextHardpointWave;   // run/slots.ts thresholds (Prestige nodes, Frame, Trial)
        const when = next === null ? null : next <= 0 ? 'now' : `after clearing wave ${next}`;
        out.push({ t: 'note', text: isEl
          ? (when ? `Your first attunement opens ${when}. Attuning an element opens its tree, its Infusions and Fusions with other attuned elements.` : 'No attunement slots are available with this Frame or Trial.')
          : (when ? `Your first hardpoint slot opens ${when}. Each slot mounts one weapon system for the rest of this Prestige.` : 'No hardpoint slots are available with this Frame or Trial.') });
        return out;
      }
      if (chip.startsWith('slot:')) {
        return out;   // the picker sits under the slot's decision row (updateDecisions)
      }
    }

    if (this.cat === 'cross') {
      for (const g of CROSS_GROUPS) {
        const list = (this.pooled(ui).filter((e) => e.tree === g.id));
        out.push({ t: 'head', text: g.label, sec: g.id });
        if (!list.length) out.push({ t: 'note', text: g.empty });
        for (const e of list) out.push({ t: 'node', e });
      }
      return out;
    }

    if (this.cat === 'cores') {
      out.push({ t: 'head', text: 'Exotics', sec: 'exotic', sub: '2 Cores each, one per tree, once its Doctrine fork is reached' });
      const list = (ui.shop.filter((e) => e.kind === 'exotic'));
      if (!list.length) out.push({ t: 'note', text: 'No Exotics visible yet.' });
      for (const e of list) out.push({ t: 'node', e });
      out.push({ t: 'head', text: 'Refit', sec: 'refit', sub: `${REFIT_CORES} Cores: swap a mounted hardpoint. 60% of its Scrap comes back; its ranks are lost.` });
      out.push({ t: 'el', key: `refit:${ui.build.hardpoints.join(',')}:${ui.run.cores >= REFIT_CORES}`, make: () => this.refitList(ui) });
      out.push({ t: 'head', text: 'Doctrine changes', sec: 'doctrine', sub: '1 Core, only at a checkpoint (between waves, right after a boss)' });
      let any = false;
      const frameMounted = (ui.extraSystems ?? []).filter((x) => x.via === 'frame').map((x) => x.system);
      for (const t of [...CHASSIS, ...ui.build.attunements, ...ui.build.hardpoints, ...frameMounted]) {
        if (!t || !ui.build.doctrines[t as TreeId]) continue;
        any = true;
        out.push({ t: 'fork', tree: t as TreeId });
      }
      if (!any) out.push({ t: 'note', text: 'No Doctrines chosen yet. Each tree forks once at its middle tier.' });
      return out;
    }

    const t = TREE_BY_ID.get(chip as TreeId);
    if (!t) return out;
    if (!this.f.chassisAll) { out.push({ t: 'head', text: t.name }, ...nodes(t.shared.map((n) => n.id).filter((id) => STARTER_IDS.has(id)))); return out; }   // stage 0: 3 stats
    // the chip row names the tree; without it (one tree in the category) the heading does
    out.push({ t: 'head', text: chipsOn ? 'Core nodes' : `${t.name} core nodes` });
    // Reachability: a Borrowed Blade takes base nodes only; mounting it in an open slot opens the rest
    if ((ui.extraSystems ?? []).some((x) => x.system === t.id && x.via === 'borrowed')) {
      const free = this.openSlotsOf(ui, false).length > 0;
      out.push({ t: 'note', text: `Borrowed by an Anomaly: tier-1 nodes only, no Doctrines or Exotic.${free ? ' Mount it in your open hardpoint slot to open its whole tree.' : ' Mount it in a hardpoint slot when one opens to open its whole tree.'}` });
    }
    out.push(...nodes(t.shared.map((n) => n.id)));
    const chosen = [ui.build.doctrines[t.id], ui.build.secondDoctrines[t.id]].filter(Boolean) as DoctrineId[];
    const forkOpen = ui.shop.some((e) => e.kind === 'doctrine' && e.tree === t.id && !e.locked);
    if (doctrinesShown(ui, this.f.unlockAll)) {
      out.push({ t: 'head', text: 'Doctrine', sub: chosen.length ? undefined : forkOpen ? 'Choose one path.' : `The fork opens after ${t.forkRequirement} core nodes.` });
      out.push({ t: 'fork', tree: t.id });
    }
    for (const d of t.doctrines) {
      if (!chosen.includes(d.id)) continue;
      out.push({ t: 'head', text: d.name, sub: d.identity });
      out.push(...nodes(d.nodes.map((n) => n.id)));
    }
    const ex = byId.get(t.exotic.id);
    if (ex) {
      out.push({ t: 'head', text: 'Exotic', sub: 'Costs Cores; one per tree.' });
      const granted = grantedExotic(ui, ex.node);
      if (granted) out.push({ t: 'note', text: granted });
      out.push({ t: 'node', e: ex });
    }
    if (t.id === 'reactor') {
      // ability rank nodes (visible while the ability is slotted)
      const ab = (ui.shop.filter((e) => e.tree === 'ability'));
      out.push({ t: 'head', text: 'Ability ranks', sub: 'One per slotted ability (slot them on the Battle bar or in Build).' });
      if (!ab.length) out.push({ t: 'note', text: 'No ability is slotted: slot one to upgrade it here.' });
      for (const e of ab) out.push({ t: 'node', e });
    }
    if (this.cat === 'hardpoints') {
      const slot = ui.build.hardpoints.indexOf(t.id as HardpointId);
      if (slot >= 0) out.push({ t: 'el', key: `refit-one:${t.id}:${ui.run.cores >= REFIT_CORES}`, make: () => h('div', { class: 'refit-one' }, button(`Refit ${t.name}… (${REFIT_CORES} Cores)`, () => this.refitPicker(slot), { class: 'btn ghost', disabled: ui.run.cores < REFIT_CORES })) });
    }
    return out;
  }

  /**
   * Fold locked and maxed rows: one "N locked" / "N maxed" line each, at the end of the tree view (stacked views: at
   * the end of each group), opened per session. A heading left with nothing under it goes too.
   */
  private fold(items: Item[], perSection: boolean): Item[] {
    if (!this.f.chassisAll) return items;
    const out: Item[] = [];
    let locked: ShopEntry[] = [], maxed: ShopEntry[] = [];
    let sec = '';
    const flush = (): void => {
      const base = `${this.cat}|${perSection ? sec : this.tree}`;
      if (locked.length) out.push({ t: 'fold', kind: 'locked', key: `${base}|locked`, list: locked });
      if (maxed.length) out.push({ t: 'fold', kind: 'maxed', key: `${base}|maxed`, list: maxed });
      locked = []; maxed = [];
    };
    for (const it of items) {
      if (it.t === 'head' && perSection) { flush(); sec = it.sec ?? it.text; }
      if (it.t === 'node') {
        if (it.e.rank >= it.e.maxRank) { maxed.push(it.e); continue; }
        if (it.e.locked) { locked.push(it.e); continue; }
      }
      out.push(it);
    }
    flush();
    // drop headings with nothing left under them (stacked views keep theirs: they are scroll targets)
    return out.filter((it, i) => {
      if (it.t !== 'head' || perSection) return true;
      const next = out[i + 1];
      return !!next && next.t !== 'head' && next.t !== 'fold';
    });
  }

  // ---------------------------------------------------------------- render
  private render(ui: UiState, items: Item[]): void {
    const frag = document.createDocumentFragment();
    let section: HTMLElement | null = null;
    const used = new Set<string>();
    const sections: Section[] = [];
    const nodeRow = (e: ShopEntry): HTMLElement => {
      let row = this.rows.get(e.node);
      if (!row) { row = new NodeRow(e, (x, count) => this.sendBuy(x, count), () => this.qty, this.descOpen); this.rows.set(e.node, row); }
      else row.update(e);
      used.add(e.node);
      return row.el;
    };
    for (const it of items) {
      if (it.t === 'head') {
        // a light header that sticks under the breadcrumb while its section scrolls (no buttons in it)
        const sec = it.sec ?? `s${sections.length}`;
        sections.push({ sec, label: it.text });
        const head = h('div', { class: 'sec-head' }, h('h3', { class: 'sec-title', text: it.text }));
        section = h('div', { class: 'shop-section', data: { sec } }, head, it.sub ? h('p', { class: 'sec-sub', text: it.sub }) : null);
        frag.appendChild(section);
        continue;
      }
      if (it.t === 'fold') {
        const open = this.foldsOpen.has(it.key);
        const n = it.list.length;
        const btn = button([icon(it.kind === 'locked' ? 'lock' : 'check', 'ico tiny'), h('span', { class: 'fold-label', text: `${n} ${it.kind}` }),
          h('span', { class: 'fold-act', text: open ? 'Hide' : 'Show' }), icon(open ? 'up' : 'down', 'ico tiny chev')], () => {
          if (this.foldsOpen.has(it.key)) this.foldsOpen.delete(it.key); else this.foldsOpen.add(it.key);
          this.viewKey = '';
          if (this.ui) this.update(this.ui);
        }, { class: `btn fold-btn ${it.kind}`, label: `${open ? 'Hide' : 'Show'} ${n} ${it.kind} upgrade${n === 1 ? '' : 's'}` });
        attr(btn, 'aria-expanded', open ? 'true' : 'false');
        const wrap = h('div', { class: `shop-fold ${it.kind}${open ? ' open' : ''}` }, btn, open ? h('div', { class: 'fold-body' }, ...it.list.map(nodeRow)) : null);
        // a tree view's folds close the view; a stacked group's close its own section
        if (STACKED.has(this.cat) && section) section.appendChild(wrap); else { frag.appendChild(wrap); section = null; }
        continue;
      }
      const host = section ?? frag;
      if (it.t === 'node') host.appendChild(nodeRow(it.e));
      else if (it.t === 'note') host.appendChild(h('p', { class: 'note', text: it.text }));
      else if (it.t === 'fork') host.appendChild(doctrineFork(this.ctx, ui, it.tree, { title: this.cat === 'cores' }));
      else host.appendChild(it.make());
    }
    for (const k of [...this.rows.keys()]) if (!used.has(k)) this.rows.delete(k);
    this.sections = sections;
    if (this.qmPlace(ui) === 'list') { frag.insertBefore(this.qmWrap, frag.firstChild); this.syncQm(ui); }
    this.list.replaceChildren(frag);
    // a swipe / ← → slides the new tree in from its side (none with reduced motion: CSS)
    if (this.slide) {
      const cls = this.slide > 0 ? 'slide-next' : 'slide-prev';
      this.slide = 0;
      this.list.classList.remove('slide-next', 'slide-prev');
      void this.list.offsetWidth;
      this.list.classList.add(cls);
      window.setTimeout(() => this.list.classList.remove(cls), 260);
    }
  }

  /** Attune / mount picker for an open slot (the Upgrades slot row and the Build screen's Mount button). */
  slotPicker(isEl: boolean, slot: number, onDone?: () => void): HTMLElement {
    const ui = this.ctx.state() ?? this.ui!;
    const wrap = h('div', { class: 'slot-picker', data: { hint: 'slot-picker' } },
      h('p', { class: 'note', text: isEl ? 'Attunements lock for the rest of this Prestige.' : 'Mounts lock for this Prestige (a Refit costs 3 Cores). At most four systems ever: one always sits out.' }));
    // "New" until first seen here: a system the latest Prestige added to the pool (listed first)
    const fresh = new Set(this.f.unlockAll ? [] : newInPool(this.pool(ui), new Set(prefs().contentSeen)));
    const offered = this.pickList(ui, isEl);   // what this Prestige offers (progression.ts content pool)
    const list = [...offered.filter((id) => fresh.has(id)), ...offered.filter((id) => !fresh.has(id))];
    if (!list.length) {
      const later = !this.f.unlockAll && (ui.meta.prestigeCount | 0) < POOL_COMPLETE_AT;
      wrap.appendChild(h('p', { class: 'note', text: later ? `Nothing else to ${isEl ? 'attune' : 'mount'} yet: new ${isEl ? 'elements' : 'weapon systems'} join with later Prestiges.` : `Every ${isEl ? 'element' : 'weapon system'} is already in use.` }));
    }
    const seenNow = list.filter((id) => fresh.has(id));
    if (seenNow.length) setPref('contentSeen', [...new Set([...prefs().contentSeen, ...seenNow])]);
    for (const id of list) {
      const tag = fresh.has(id) ? h('span', { class: 'tag new-tag', text: 'New' }) : null;
      const name = TREE_LABEL[id as TreeId] ?? titleCase(id);
      const blurb = isEl ? ELEMENT_BLURB[id as ElementId] : HARDPOINT_BLURB[id as HardpointId];
      // Frame free mount / Trial rule: shown with the reason instead of a Mount button that would fail
      const blocked = isEl ? undefined : ui.mountBlocked?.[id as HardpointId];
      const borrowed = !isEl && (ui.extraSystems ?? []).some((x) => x.system === id && x.via === 'borrowed');
      if (blocked) {
        wrap.appendChild(h('div', { class: `pick-card ${id} blocked` },
          h('div', { class: 'pick-main' }, h('div', { class: 'pick-name' }, name, tag), h('p', { class: 'pick-blurb', text: blocked }))));
        continue;
      }
      wrap.appendChild(h('div', { class: `pick-card ${id}` },
        h('div', { class: 'pick-main' }, h('div', { class: 'pick-name' }, name, tag), h('p', { class: 'pick-blurb', text: borrowed ? `Borrowed now (tier 1). Mounting it here opens its full tree and Doctrines. ${blurb}` : blurb })),
        button(isEl ? 'Attune' : 'Mount', async () => {
          if (!(await confirmDialog(`${isEl ? 'Attune' : 'Mount'} ${name}?`, `${name} ${isEl ? 'is attuned' : 'is mounted'} for the rest of this Prestige.`, isEl ? 'Attune' : 'Mount'))) return;
          this.ctx.host.send(isEl ? { type: 'attune', slot, element: id as ElementId } : { type: 'mount_hardpoint', slot, system: id as HardpointId });
          this.tree = id;
          setPref('shopTree', id);
          onDone?.();
        }, { class: 'btn primary' })));
    }
    return wrap;
  }

  /** Ids a slot picker offers: in the content pool and not already in a slot. */
  private pickList(ui: UiState, isEl: boolean): string[] {
    const pool = this.pool(ui);
    return isEl ? ELEMENTS.filter((e) => pool.elements.includes(e) && !ui.build.attunements.includes(e)) : HARDPOINTS.filter((hp) => pool.hardpoints.includes(hp) && !ui.build.hardpoints.includes(hp));
  }

  private refitList(ui: UiState): HTMLElement {
    const wrap = h('div', { class: 'refit-list' });
    let any = false;
    ui.build.hardpoints.forEach((hp, slot) => {
      if (!hp) return;
      any = true;
      wrap.appendChild(h('div', { class: 'pick-card' },
        h('div', { class: 'pick-main' }, h('div', { class: 'pick-name', text: `Slot ${slot + 1}: ${TREE_LABEL[hp]}` }), h('p', { class: 'pick-blurb', text: HARDPOINT_BLURB[hp] })),
        button('Refit…', () => this.refitPicker(slot), { class: 'btn', disabled: ui.run.cores < REFIT_CORES })));
    });
    if (!any) wrap.appendChild(h('p', { class: 'note', text: 'Nothing mounted yet.' }));
    else if (ui.run.cores < REFIT_CORES) wrap.appendChild(h('p', { class: 'node-lock', text: `Needs ${REFIT_CORES} Cores (you have ${ui.run.cores}).` }));
    return wrap;
  }

  /** Refit dialog for a mounted hardpoint slot (Upgrades and the Build screen). */
  refitPicker(slot: number): void {
    const ui = this.ctx.state();
    if (!ui) return;
    const old = ui.build.hardpoints[slot];
    if (!old) return;
    const body = h('div', { class: 'slot-picker' }, h('p', { class: 'note', text: `Replace ${TREE_LABEL[old]} for ${REFIT_CORES} Cores. You get back 60% of the Scrap spent in ${TREE_LABEL[old]}; its ranks, Doctrine and Linkages are lost.` }));
    const m = openModal({ title: `Refit slot ${slot + 1}`, body, wallet: walletChip(['cores'], ui) });
    const pool = this.pool(ui);   // a Refit offers what a mount would (progression.ts content pool)
    for (const hp of HARDPOINTS.filter((x) => pool.hardpoints.includes(x) && !ui.build.hardpoints.includes(x) && !ui.mountBlocked?.[x])) {
      body.appendChild(h('div', { class: 'pick-card' },
        h('div', { class: 'pick-main' }, h('div', { class: 'pick-name', text: TREE_LABEL[hp] }), h('p', { class: 'pick-blurb', text: HARDPOINT_BLURB[hp] })),
        button('Refit', async () => {
          m.close();
          if (await confirmDialog('Confirm Refit', `${TREE_LABEL[old]} → ${TREE_LABEL[hp]} for ${REFIT_CORES} Cores.`, 'Refit', { danger: true, wallet: walletChip(['cores'], this.ctx.state()) })) {
            this.ctx.host.send({ type: 'refit_hardpoint', slot, system: hp });
            this.tree = hp;
          }
        }, { class: 'btn primary' })));
    }
  }
}

/** A note when an Anomaly already grants this Exotic (buying it would add nothing), else null. */
export function grantedExotic(ui: Pick<UiState, 'build'>, node: string): string | null {
  if (node === 'ordnance.cluster_warheads' && ui.build.anomalies.includes('recursive_warhead') && (ui.build.ranks[node] | 0) === 0) {
    return 'Recursive Warhead already gives you Cluster Warheads: buying this Exotic adds nothing while it is socketed.';
  }
  return null;
}
