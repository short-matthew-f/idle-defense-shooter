/**
 * Upgrade shop. Pinned: the category tabs (the shell's top row above them holds the wallet, the buy-quantity chip and
 * the Battle button). Everything else scrolls in one list:
 *   Suggested (one line: "Suggested 3 · Buy all ◆53"; its chevron opens the 3 cheapest affordable buys, remembered)
 *   decision rows (an empty attunement / hardpoint slot of this category, the open Doctrine fork of this tree)
 *   tree chips (only when the category has two or more trees) · the tree view (sort on its first heading):
 *   shared nodes · Doctrine fork (2–4 cards) · doctrine nodes + capstone · Exotic (Cores) · "N locked" · "N maxed"
 * Elements / Hardpoints list attuned / mounted trees; an empty slot is a row at the top that opens its picker
 * (attune / mount_hardpoint). Cross (Fusions, Linkages, Infusions) and Cores (Exotics, Refit, Doctrine change) are one
 * stacked view each, no chips. A node row shows its name, rank and headline effect; tapping the row body unfolds the
 * full description (the Buy button keeps hold-to-buy). Locked and maxed rows fold into one line each at the end.
 * Prices and affordability update in place from `ui.shop`; rows are rebuilt only when the set of visible nodes
 * changes. The quantity chip (×1 → ×10 → Max, Q) drives every Buy button, the suggestion chips, Buy all and each
 * tree's "Spend here" (bulk.ts has the pure planning).
 * Attention dots mean a decision is waiting (an empty slot, an open fork), never "something is affordable" (the tab
 * bar's count says that); a tree chip's count is its affordable nodes, in a quiet neutral style.
 * Progressive reveal (progression.ts, setFeatures): categories appear as they are earned; the Suggested line,
 * quantity chip and "Spend here" wait for 'bulk' (until then every Buy is ×1 and Q does nothing).
 */
import '../styles/shop.css';
import type { DoctrineId, ElementId, HardpointId, TreeId } from '@sim/core/ids';
import { Ev, type ShopEntry, type SimEvent, type UiState } from '@sim/core/types';
import { inBulkTree } from '@sim/economy/bulk';
import { button, h, holdRepeat, text, disable, show, attr, Keyed, clear } from './dom';
import { buyLabel, buyLabelText, bulkToast, nextQty, parseQty, planBuyAll, qtyLabel, spendLabel, treeSpend, type BuyLabel, type BuyQty } from './bulk';
import { icon } from './icons';
import { fmtDuration, fmtNum, splitDesc, substituteDesc, titleCase } from './format';
import { nextPurchase } from './advice';
import { CHASSIS, ELEMENTS, ELEMENT_BLURB, HARDPOINTS, HARDPOINT_BLURB, NODE_BY_ID, TREE_BY_ID, TREE_LABEL } from './content';
import { confirmDialog, openModal } from './modal';
import { doctrineFork, forkKey, freeDoctrineTrees } from './doctrine';
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
  private readonly desc = h('p', { class: 'node-desc' });
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
    this.main = h('div', { class: 'node-main' }, h('div', { class: 'node-head' }, this.name, this.rank, this.chev), this.desc, this.lock);
    this.el = h('div', { class: 'node', data: { node: entry.node } }, this.main, this.btn);
    this.update(entry);
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
    const key = `${e.rank}|${e.maxRank}|${e.cost}|${e.affordable}|${e.locked ?? ''}|${e.currency}|${q}|${e.affordableRanks}|${e.affordableTotal}`;
    if (key === this.lastKey) return;
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
      const expandable = s.more || s.headline.length > 64;
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
  | { t: 'head'; text: string; sub?: string; /** bulk-tree key for a "Spend here" button */ spend?: string; /** stacked views: the group id (setTree scrolls to it) */ sec?: string }
  | { t: 'node'; e: ShopEntry }
  | { t: 'note'; text: string }
  | { t: 'fork'; tree: TreeId }
  | { t: 'el'; key: string; make: () => HTMLElement }
  | { t: 'fold'; kind: 'locked' | 'maxed'; key: string; list: ShopEntry[] };

/** An open slot (index into the build's list) and whether the content pool has something to put in it. */
interface SlotDecision { slot: number; offer: boolean }

export class Shop {
  readonly el: HTMLElement;
  /** The Suggested line (top of the list). */
  readonly quick: HTMLElement;
  /** Buy quantity: one chip cycling ×1 → ×10 → Max (Q); GameUi puts it in the shell's top row. */
  readonly qtyChip: HTMLButtonElement;
  private readonly qtyVal = h('span', { class: 'qty-val' });
  private readonly catRow = h('div', { class: 'tabs cat-tabs', attrs: { role: 'tablist', 'aria-label': 'Upgrade trees' } });
  private readonly head = h('div', { class: 'shop-head' }, this.catRow);
  private readonly treeRow = h('div', { class: 'chips tree-chips', attrs: { role: 'tablist', 'aria-label': 'Tree' } });
  /** Tree chips: the head of the list (it scrolls with it). */
  private readonly listHead = h('div', { class: 'shop-sub' }, this.treeRow);
  /** Decision rows: an empty slot of this category, this tree's open Doctrine fork. */
  private readonly decisions = h('div', { class: 'shop-decisions' });
  private decisionKey = '';
  private readonly list = h('div', { class: 'shop-list' });
  private readonly body: HTMLElement;
  private readonly quickRow = h('div', { class: 'quick-row' });
  /** When nothing is affordable: the next buy, its price and ETA at the current income. */
  private readonly nextChip: HTMLButtonElement;
  private readonly nextLabel = h('span', { class: 'qc-name' });
  private readonly nextPrice = h('span', { class: 'price scrap' });
  private readonly nextEta = h('span', { class: 'qc-eta' });
  private nextTree = '';
  private readonly doneChip: HTMLButtonElement;
  private readonly noneText = h('span', { class: 'sg-none', text: 'Nothing affordable yet' });
  /** First-run explainer (the old "Tap to buy" coach; retires after COACH_BUYS purchases). */
  private readonly coach = h('p', { class: 'quick-coach sg-explain', text: 'Cheapest upgrades your Scrap buys right now. Tap one to buy it.' });
  private readonly sgToggle: HTMLButtonElement;
  private readonly sgCount = h('span', { class: 'sg-count' });
  private readonly buyAll: HTMLButtonElement;
  private readonly buyAllText = h('span', { class: 'sg-buyall-text' });
  private readonly buyAllPrice = h('span', { class: 'price scrap' });
  /** Every "Spend here" button on show (rebuilt with the view, relabelled every update). */
  private spends: { tree: string; name: string; btn: HTMLButtonElement; line: HTMLSpanElement; key: string }[] = [];
  /** A bulk buy in flight: its Purchase events are summed into one toast. */
  private pendingBulk: { where: string | null; until: number; events: SimEvent[]; timer: number } | null = null;
  /** Bring the Upgrades screen forward when a chip, the death card or the Build screen jumps to a tree (GameUi wires it). */
  onReveal: (() => void) | null = null;
  /** The category on show changed (GameUi: the wallet bar follows it). */
  onViewChange: (() => void) | null = null;
  private readonly sortBtn: HTMLButtonElement;
  private readonly catBtns = new Map<Category, { b: HTMLButtonElement; dot: HTMLSpanElement }>();
  private treeBtns = new Map<string, { b: HTMLButtonElement; n: HTMLSpanElement; dot: HTMLSpanElement }>();
  private readonly rows = new Map<string, NodeRow>();
  private readonly quickList: Keyed<ShopEntry, { el: HTMLButtonElement; label: HTMLSpanElement; rank: HTMLSpanElement; count: HTMLSpanElement; price: HTMLSpanElement; entry: ShopEntry; key: string }>;
  private cat: Category;
  private tree: string;
  /** The tree to go back to when an open slot's picker is folded away. */
  private lastTree = '';
  private chipKey = '';
  private viewKey = '';
  private ui: UiState | null = null;
  private revealKey = '';
  /** Folds ("N locked", "N maxed") opened this session, and node rows unfolded to their full description. */
  private readonly foldsOpen = new Set<string>();
  private readonly descOpen = new Set<string>();
  /** A stacked view's group to scroll to once rendered. */
  private pendingSec: string | null = null;
  /**
   * Quartermaster card (quartermaster.ts), at the top of the Chassis and Hardpoints lists once 'quartermaster' is
   * revealed, under a one-line summary that folds it: open while it is off (its switch is the decision), folded once on.
   */
  private readonly qm: QuartermasterPanel;
  private readonly qmState = h('span', { class: 'qmf-state' });
  private readonly qmAct = h('span', { class: 'fold-act' });
  private readonly qmChev = h('span', { class: 'qmf-chev' });
  private readonly qmSummary: HTMLButtonElement;
  private readonly qmWrap: HTMLElement;
  /** The player's fold choice this session (null: the default above). */
  private qmOpen: boolean | null = null;

  constructor(private readonly ctx: UiCtx) {
    const p = prefs();
    this.cat = (CATEGORIES.some((c) => c.id === p.shopCategory) ? p.shopCategory : 'chassis') as Category;
    this.tree = p.shopTree;
    for (const c of CATEGORIES) {
      const dot = h('span', { class: 'cat-dot', attrs: { 'aria-hidden': 'true' } });
      const b = button([c.label, dot], () => this.setCategory(c.id), { class: 'tab' });
      b.dataset.hint = `cat-${c.id}`;   // pointer hints (hints.ts)
      dot.hidden = true;
      b.setAttribute('role', 'tab');
      this.catBtns.set(c.id, { b, dot });
      this.catRow.appendChild(b);
    }
    this.sortBtn = button(icon('sort'), () => {
      setPref('affordableFirst', !prefs().affordableFirst);
      this.syncSort();
      this.viewKey = '';
      if (this.ui) this.update(this.ui);
    }, { class: 'btn icon-btn ghost toggle sort-btn', title: 'Affordable first: sort what you can buy to the top', label: 'Sort affordable upgrades first' });
    this.syncSort();
    this.quickList = new Keyed(this.quickRow, (e) => {
      const label = h('span', { class: 'qc-name' });
      const rank = h('span', { class: 'qc-rank' });
      const count = h('span', { class: 'qc-count' });
      const price = h('span', { class: 'price scrap' });
      const row = { el: h('button', { type: 'button', class: 'btn chip quick' }, label, rank, count, price), label, rank, count, price, entry: e, key: '' };
      holdRepeat(row.el, () => { const l = buyLabel(row.entry, this.qty); if (l.send !== null) this.sendBuy(row.entry, l.send); }, () => this.qty === 1);
      return row;
    }, (r, e) => {
      r.entry = e;
      const key = `${e.rank}|${e.cost}|${this.qty}|${e.affordableRanks}|${e.affordableTotal}`;
      if (key === r.key) return;
      r.key = key;
      const l = buyLabel(e, this.qty);
      text(r.label, e.name);
      text(r.rank, e.maxRank > 1 ? `rank ${e.rank + 1}` : '');
      paintBuy(r.count, r.price, l, 'scrap');
      attr(r.el, 'aria-label', `Buy ${l.count ? `${l.count.replace('×', '')} ranks of ` : ''}${e.name}${e.maxRank > 1 ? ` (rank ${e.rank + 1} of ${e.maxRank})` : ''} for ${fmtNum(l.price)} Scrap`);
    });
    this.nextChip = button([h('span', { class: 'qc-next', text: 'Next' }), this.nextLabel, this.nextPrice, this.nextEta], () => this.jumpTo(this.nextTree), { class: 'btn chip next-chip' });
    this.doneChip = button([icon('forecast', 'ico tiny'), 'All owned: see the Forecast'], () => this.ctx.open('forecast'), { class: 'btn chip next-chip done-chip' });
    this.doneChip.hidden = true;
    // the Suggested line: chevron + title + count (expands to the chips, remembered) and Buy all on the right
    this.sgToggle = button([icon('down', 'ico tiny sg-chev'), h('span', { class: 'sg-title', text: 'Suggested' }), this.sgCount], () => {
      setPref('suggestExpanded', !prefs().suggestExpanded);
      this.syncSuggest();
    }, { class: 'btn ghost sg-toggle' });
    this.buyAll = button([this.buyAllText, this.buyAllPrice], () => this.doBuyAll(), { class: 'btn primary sg-buyall' });
    this.buyAll.dataset.hint = 'buy-all';
    this.quick = h('div', { class: 'quick suggest' },
      h('div', { class: 'sg-head' }, this.sgToggle, this.noneText, this.nextChip, this.doneChip, this.buyAll),
      this.coach,
      h('div', { class: 'sg-body' }, this.quickRow));
    this.syncSuggest();
    this.qtyChip = button([h('span', { class: 'qty-k', text: 'Buy' }), this.qtyVal], () => this.cycleQty(), { class: 'btn qty-chip', title: 'Ranks per Buy tap: ×1 → ×10 → Max (Q)' });
    this.qtyChip.dataset.hint = 'qty';
    this.syncQty();
    this.body = h('div', { class: 'shop-body' }, this.quick, this.decisions, this.listHead, this.list);
    // only the category tabs stay pinned (the wallet and the quantity chip are in the shell's top row); the rest scrolls
    this.el = h('section', { class: 'shop', attrs: { 'aria-label': 'Upgrades' } }, this.head, this.body);
    this.qm = new QuartermasterPanel(ctx);
    this.qmSummary = button([icon('bank', 'ico tiny'), h('span', { class: 'fold-label', text: 'Quartermaster' }), this.qmState, this.qmAct, this.qmChev], () => {
      this.qmOpen = this.qm.el.hidden;
      if (this.ui) this.syncQm(this.ui);
    }, { class: 'btn fold-btn qm-fold-btn' });
    this.qmWrap = h('div', { class: 'qm-fold' }, this.qmSummary, this.qm.el);
  }

  /** The Quartermaster summary line and whether its card shows. */
  private syncQm(ui: UiState): void {
    const q = ui.quartermaster;
    // before it unlocks the card is already a one-line teaser: no summary over it
    const locked = !q?.unlocked;
    const open = locked || (this.qmOpen ?? !q?.on);
    this.qm.el.hidden = !open;
    show(this.qmSummary, !locked);
    const bank = qmBank(ui);
    text(this.qmState, !q ? '' : q.on ? `On${bank !== null ? ` · bank ${fmtExactish(bank)}` : ''}` : 'Off');
    if (this.qmChev.dataset.open !== String(open)) {
      this.qmChev.dataset.open = String(open);
      text(this.qmAct, open ? 'Hide' : 'Show');
      this.qmChev.replaceChildren(icon(open ? 'up' : 'down', 'ico tiny chev'));
      attr(this.qmSummary, 'aria-expanded', open ? 'true' : 'false');
    }
    this.qm.update(ui);
  }

  /** What this Prestige offers (progression.ts content pool; Unlock everything offers all). */
  private pool(ui: UiState): ContentPool { return contentPool(ui, { unlockAll: this.f.unlockAll }); }
  /** The sim's shop without cross-system entries whose parts the pool does not offer yet. */
  private pooled(ui: UiState): ShopEntry[] { return poolShop(ui.shop, this.pool(ui)); }
  private qmHere(): boolean { return this.f.quartermaster && (this.cat === 'chassis' || this.cat === 'hardpoints'); }

  private get f(): Features { return this.ctx.features(); }
  /** The category and tree chip on show (pointer hints chain through them). */
  view(): { cat: string; tree: string } { return { cat: this.cat, tree: this.tree }; }

  /** Progressive reveal: categories, the Suggested line and the quantity chip (GameUi, every UiState). */
  setFeatures(f: Features): void {
    const key = `${f.elements}${f.hardpoints}${f.cross}${f.cores}${f.bulk}${f.chassisAll}${f.quartermaster}`;
    if (key === this.revealKey) return;
    this.revealKey = key;
    const cats = this.shownCats(f);
    for (const [id, x] of this.catBtns) x.b.hidden = !cats.includes(id);
    this.catRow.hidden = cats.length < 2;   // one category: its tree chips say enough
    this.head.hidden = cats.length < 2;
    this.qtyChip.hidden = !f.bulk;
    this.el.classList.toggle('no-bulk', !f.bulk);
    if (!cats.includes(this.cat)) this.setCategory('chassis');
    this.syncQty();
    this.chipKey = ''; this.viewKey = ''; this.decisionKey = '';
  }

  private shownCats(f: Features): Category[] {
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

  private syncSuggest(): void {
    const open = prefs().suggestExpanded;
    this.quick.classList.toggle('collapsed', !open);
    attr(this.sgToggle, 'aria-expanded', open ? 'true' : 'false');
    attr(this.sgToggle, 'aria-label', open ? 'Suggested purchases (collapse)' : 'Suggested purchases (expand)');
  }

  /** Send one `buy` (count 1 = a single rank, the old command shape; 10; 0 = Max). */
  private sendBuy(e: ShopEntry, count: number): void {
    if (count !== 1) this.expectBulk(`of ${e.name}`);
    this.ctx.host.send(count === 1 ? { type: 'buy', node: e.node } : { type: 'buy', node: e.node, count });
  }

  private doBuyAll(): void {
    const ui = this.ui;
    if (!ui) return;
    const plan = planBuyAll(cheapestAffordable(this.pooled(ui)), ui.run.scrap, this.qty);
    if (!plan.cmds.length) return;
    this.expectBulk(null);
    for (const c of plan.cmds) this.ctx.host.send(c.count === 1 ? { type: 'buy', node: c.node } : { type: 'buy', node: c.node, count: c.count });
  }

  private doSpend(tree: string, name: string): void {
    this.expectBulk(`in ${name}`);
    this.ctx.host.send({ type: 'buy_cheapest', tree: tree as ShopEntry['tree'], count: this.qty });
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
    // Buy all sends up to three commands; give them a moment to land in the same summary
    p.timer = window.setTimeout(() => {
      if (this.pendingBulk === p) this.pendingBulk = null;
      const msg = bulkToast(p.events, p.where);
      if (msg) this.ctx.toast(msg, 'good');
    }, 350);
  }

  private syncSort(): void {
    const on = prefs().affordableFirst;
    this.sortBtn.classList.toggle('on', on);
    attr(this.sortBtn, 'aria-pressed', on ? 'true' : 'false');
  }

  setCategory(c: Category): void {
    if (c === this.cat) return;
    this.cat = c; this.tree = '';
    setPref('shopCategory', c);
    this.chipKey = ''; this.viewKey = ''; this.decisionKey = '';
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
    // keep the tree chips (or the decision rows) at the top of the view, never further down than where they sit
    const top = this.decisions.offsetTop;
    if (this.body.scrollTop > top) this.body.scrollTop = top;
  }

  /** Stacked views (Cross, Cores): bring a group's section to the top once it is laid out. */
  private scrollToSec(sec: string): void {
    this.pendingSec = sec;
    requestAnimationFrame(() => {
      const s = this.pendingSec;
      this.pendingSec = null;
      const el = s ? this.list.querySelector<HTMLElement>(`[data-sec="${s}"]`) : null;
      if (el) this.body.scrollTop = Math.max(0, el.offsetTop - 4);
    });
  }

  // ---------------------------------------------------------------- chips
  /** The trees of the category (open slots of Elements / Hardpoints are `slot:<i>`; stacked views list their groups). */
  private chips(ui: UiState): Chip[] {
    const b = ui.build, r = ui.run;
    switch (this.cat) {
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
    return freeDoctrineTrees(ui).filter(inCat);
  }

  /** A decision waits in this category: an empty slot with something to put in it, or a free Doctrine fork. */
  private decisionIn(ui: UiState, c: Category): string | null {
    if ((c === 'elements' || c === 'hardpoints') && this.openSlotsOf(ui, c === 'elements').some((s) => s.offer)) return c === 'elements' ? 'empty attunement slot' : 'empty hardpoint slot';
    if (this.forksOf(ui, c).length) return 'Doctrine fork open';
    return null;
  }

  /** Show a category / tree (death card, "Next" chip, Build screen) and bring Upgrades forward. */
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
  update(ui: UiState, scrapRate = 0): void {
    this.syncQty();
    this.ui = ui;
    this.updateSuggest(ui, scrapRate);
    if (this.qmHere()) this.syncQm(ui);
    this.updateSpend(ui);

    for (const c of CATEGORIES) {
      const cb = this.catBtns.get(c.id)!;
      if (cb.b.hidden) continue;
      const why = this.decisionIn(ui, c.id);
      show(cb.dot, !!why);
      attr(cb.b, 'aria-label', why ? `${c.label} (${why})` : c.label);
      cb.b.title = why ? `${why[0].toUpperCase()}${why.slice(1)}` : '';
      cb.b.classList.toggle('active', c.id === this.cat);
      attr(cb.b, 'aria-selected', c.id === this.cat ? 'true' : 'false');
    }

    const all = this.chips(ui);
    if (!all.some((c) => c.id === this.tree)) this.tree = all.find((c) => !c.empty)?.id ?? all[0]?.id ?? '';
    const stacked = STACKED.has(this.cat);
    const trees = stacked ? [] : all.filter((c) => !c.empty);
    const chipsOn = trees.length >= 2;
    const ck = this.cat + '|' + trees.map((c) => c.id + c.label).join(',');
    if (ck !== this.chipKey) {
      this.chipKey = ck;
      this.treeBtns = new Map();
      clear(this.treeRow);
      for (const c of trees) {
        const n = h('span', { class: 'count', attrs: { 'aria-hidden': 'true' } });
        const dot = h('span', { class: 'chip-dot', attrs: { 'aria-hidden': 'true' } });
        const b = button([c.label, n, dot], () => this.setTree(c.id), { class: 'chip tree-chip' });
        b.setAttribute('role', 'tab');
        this.treeBtns.set(c.id, { b, n, dot });
        this.treeRow.appendChild(b);
      }
    }
    show(this.treeRow, chipsOn);
    const forks = new Set(this.forksOf(ui, this.cat));
    for (const [id, tb] of this.treeBtns) {
      tb.b.classList.toggle('active', id === this.tree);
      attr(tb.b, 'aria-selected', id === this.tree ? 'true' : 'false');
      const n = this.affordableCount(ui, id);
      text(tb.n, n > 0 ? String(n) : '');
      show(tb.dot, forks.has(id));
      attr(tb.b, 'aria-label', `${TREE_LABEL[id as TreeId] ?? id}${n > 0 ? `, ${n} affordable` : ''}${forks.has(id) ? ', Doctrine fork open' : ''}`);
    }
    this.updateDecisions(ui, all, forks);

    const items = this.fold(this.plan(ui, chipsOn), stacked);
    const sortKey = prefs().affordableFirst ? items.map((i) => (i.t === 'node' ? (i.e.affordable ? 1 : 0) : '')).join('') : '';
    const key = `${this.cat}|${stacked ? '' : this.tree}|${chipsOn}|${sortKey}|` + items.map((i) => i.t === 'node' ? i.e.node : i.t === 'fork' ? `fork:${forkKey(ui, i.tree)}`
      : i.t === 'el' ? `el:${i.key}` : i.t === 'fold' ? `fold:${i.key}:${this.foldsOpen.has(i.key)}:${i.list.map((e) => e.node).join('+')}` : `${i.t}:${i.text}`).join(',');
    if (key !== this.viewKey) {
      this.viewKey = key;
      this.render(ui, items, chipsOn);
      this.updateSpend(ui);
    } else {
      for (const it of items) {
        if (it.t === 'node') this.rows.get(it.e.node)?.update(it.e);
        else if (it.t === 'fold' && this.foldsOpen.has(it.key)) for (const e of it.list) this.rows.get(e.node)?.update(e);
      }
    }
  }

  /** The Suggested line: chips + Buy all, else the next buy and its ETA, else "All owned". */
  private updateSuggest(ui: UiState, scrapRate: number): void {
    const sugg = cheapestAffordable(this.pooled(ui));
    this.quickList.sync(sugg, (e) => e.node);
    show(this.quick, this.f.bulk);
    const empty = this.quickList.rows.size === 0;
    const plan = planBuyAll(sugg, ui.run.scrap, this.qty);
    show(this.buyAll, plan.cmds.length > 0);
    show(this.sgToggle, !empty);
    text(this.sgCount, sugg.length ? String(sugg.length) : '');
    if (plan.cmds.length) {
      const plus = plan.open ? '+' : '';
      text(this.buyAllText, 'Buy all');   // the rank counts live on the chips; keeps the line short in a 300 px column
      const pk = `${plan.total}${plus}`;
      if (this.buyAllPrice.dataset.v !== pk) { this.buyAllPrice.dataset.v = pk; this.buyAllPrice.replaceChildren(icon('scrap', 'ico tiny'), fmtNum(plan.total) + plus); }
      this.buyAll.title = `${plan.ranks}${plus} rank${plan.ranks === 1 ? '' : 's'}`;
      attr(this.buyAll, 'aria-label', `Buy all suggested: ${plan.open ? 'at least ' : ''}${plan.ranks} rank${plan.ranks === 1 ? '' : 's'} for ${plan.open ? 'at least ' : ''}${fmtNum(plan.total)} Scrap`);
    }
    const next = empty ? nextPurchase(ui.shop, ui.run.scrap, scrapRate) : null;
    // Everything owned (the Prestige Wall): say so and point at the Forecast instead of "nothing affordable yet".
    const allOwned = empty && !next && !ui.shop.some((e) => e.currency === 'scrap' && e.rank < e.maxRank);
    show(this.doneChip, allOwned);
    show(this.noneText, empty && !next && !allOwned);
    show(this.nextChip, !!next);
    this.quick.classList.toggle('empty', empty);
    if (next) {
      this.nextTree = next.entry.tree;
      const e = next.entry;
      text(this.nextLabel, e.rank > 0 && e.maxRank > 1 ? `${e.name} ${e.rank + 1}` : e.name);
      if (this.nextPrice.dataset.v !== String(e.cost)) { this.nextPrice.dataset.v = String(e.cost); this.nextPrice.replaceChildren(icon('scrap', 'ico tiny'), fmtNum(e.cost)); }
      text(this.nextEta, next.eta !== null && next.eta > 0 ? `~${fmtDuration(next.eta)}` : '');
      attr(this.nextChip, 'aria-label', `Next upgrade: ${e.name}, ${fmtNum(e.cost)} Scrap${next.eta ? `, affordable in about ${fmtDuration(next.eta)}` : ''}. Opens its tree.`);
    }
    // the explainer only for the first few purchases, and only while the chips it explains are open
    const coach = prefs().buyCoach < COACH_BUYS && !empty;
    show(this.coach, coach);
    this.quickRow.classList.toggle('coach', coach);
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

  /** Relabel every "Spend here" button: Max uses the sim's shopTreeTotals (approximate). */
  private updateSpend(ui: UiState): void {
    const q = this.qty;
    for (const sp of this.spends) {
      if (!sp.btn.isConnected) continue;
      const s = treeSpend(ui.shop.filter((e) => inBulkTree(e, sp.tree)), ui.run.scrap, q, ui.shopTreeTotals?.[sp.tree]);
      const key = `${q}|${s.ranks}|${s.total}`;
      if (key === sp.key) continue;
      sp.key = key;
      text(sp.line, spendLabel(s, q));
      disable(sp.btn, s.ranks === 0);
      attr(sp.btn, 'aria-label', s.ranks === 0 ? `Spend here: nothing affordable in ${sp.name}` : `Spend here: buy the cheapest ${q === 1 ? 'rank' : `${s.ranks} ranks`} in ${sp.name} for about ${fmtNum(s.total)} Scrap`);
    }
  }

  private sorted(list: ShopEntry[]): ShopEntry[] {
    if (!prefs().affordableFirst) return list;
    return list.map((e, i) => ({ e, i })).sort((a, b) => (Number(b.e.affordable) - Number(a.e.affordable)) || a.i - b.i).map((x) => x.e);
  }

  /** The view's items before folding. */
  private plan(ui: UiState, chipsOn: boolean): Item[] {
    const chip = this.tree;
    const out: Item[] = [];
    const byId = new Map(ui.shop.map((e) => [e.node, e]));
    const nodes = (ids: string[]): Item[] => this.sorted(ids.map((id) => byId.get(id)).filter((e): e is ShopEntry => !!e)).map((e) => ({ t: 'node', e }));

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
        const slot = Number(chip.slice(5));
        out.push({ t: 'el', key: `pick:${this.cat}:${slot}:${(isEl ? ui.build.attunements : ui.build.hardpoints).join(',')}`, make: () => this.slotPicker(isEl, slot) });
        return out;
      }
    }

    if (this.cat === 'cross') {
      for (const g of CROSS_GROUPS) {
        const list = this.sorted(this.pooled(ui).filter((e) => e.tree === g.id));
        out.push({ t: 'head', text: g.label, sec: g.id, spend: this.f.bulk && list.length ? g.id : undefined });
        if (!list.length) out.push({ t: 'note', text: g.empty });
        for (const e of list) out.push({ t: 'node', e });
      }
      return out;
    }

    if (this.cat === 'cores') {
      out.push({ t: 'head', text: 'Exotics', sec: 'exotic', sub: '2 Cores each, one per tree, once its Doctrine fork is reached' });
      const list = this.sorted(ui.shop.filter((e) => e.kind === 'exotic'));
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
    out.push({ t: 'head', text: chipsOn ? 'Core nodes' : `${t.name} core nodes`, spend: this.f.bulk ? t.id : undefined });
    // Reachability: a Borrowed Blade takes base nodes only; mounting it in an open slot opens the rest
    if ((ui.extraSystems ?? []).some((x) => x.system === t.id && x.via === 'borrowed')) {
      const free = this.openSlotsOf(ui, false).length > 0;
      out.push({ t: 'note', text: `Borrowed by an Anomaly: tier-1 nodes only, no Doctrines or Exotic.${free ? ' Mount it in your open hardpoint slot to open its whole tree.' : ' Mount it in a hardpoint slot when one opens to open its whole tree.'}` });
    }
    out.push(...nodes(t.shared.map((n) => n.id)));
    const chosen = [ui.build.doctrines[t.id], ui.build.secondDoctrines[t.id]].filter(Boolean) as DoctrineId[];
    const forkOpen = ui.shop.some((e) => e.kind === 'doctrine' && e.tree === t.id && !e.locked);
    out.push({ t: 'head', text: 'Doctrine', sub: chosen.length ? undefined : forkOpen ? 'Choose one path.' : `The fork opens after ${t.forkRequirement} core nodes.` });
    out.push({ t: 'fork', tree: t.id });
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
      // ability rank nodes (visible while the ability is slotted; Reactor's "Spend here" buys them too)
      const ab = this.sorted(ui.shop.filter((e) => e.tree === 'ability'));
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
  private render(ui: UiState, items: Item[], chipsOn: boolean): void {
    const frag = document.createDocumentFragment();
    let section: HTMLElement | null = null;
    const used = new Set<string>();
    this.spends = [];
    const nodeRow = (e: ShopEntry): HTMLElement => {
      let row = this.rows.get(e.node);
      if (!row) { row = new NodeRow(e, (x, count) => this.sendBuy(x, count), () => this.qty, this.descOpen); this.rows.set(e.node, row); }
      else row.update(e);
      used.add(e.node);
      return row.el;
    };
    let firstHead: HTMLElement | null = null;
    for (const it of items) {
      if (it.t === 'head') {
        const title = h('h3', { class: 'sec-title' }, it.text, it.sub ? h('span', { class: 'sec-sub', text: it.sub }) : null);
        const head = h('div', { class: 'sec-head' }, title);
        if (it.spend) {
          const tree = it.spend, name = it.text;
          const line = h('span', { class: 'spend-line' });
          const btn = button([h('span', { class: 'spend-title', text: 'Spend here' }), line], () => this.doSpend(tree, name), { class: 'btn spend-btn', title: 'Buy the cheapest upgrades here (uses the buy quantity)' });
          this.spends.push({ tree, name, btn, line, key: '' });
          head.appendChild(btn);
        }
        firstHead ??= head;
        section = h('div', { class: 'shop-section', data: it.sec ? { sec: it.sec } : undefined }, head);
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
    if (this.qmHere()) { frag.insertBefore(this.qmWrap, frag.firstChild); this.syncQm(ui); }
    this.list.replaceChildren(frag);
    // sort: on the list's first heading, beside "Spend here" (nothing to sort in a picker)
    if (firstHead) firstHead.insertBefore(this.sortBtn, firstHead.querySelector('.spend-btn'));
    this.sortBtn.hidden = !firstHead;
    show(this.listHead, chipsOn);
    // the chip row fades at its right edge only when it scrolls sideways
    requestAnimationFrame(() => this.treeRow.classList.toggle('more', this.treeRow.scrollWidth > this.treeRow.clientWidth + 1));
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
