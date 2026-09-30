/**
 * Upgrade shop. Categories → tree chips → tree view:
 *   shared nodes · Doctrine fork (2–4 cards) · doctrine nodes + capstone · Exotic (Cores)
 * Elements / Hardpoints list attuned / mounted trees plus empty slots (picker → attune /
 * mount_hardpoint). Cross: Fusions, Linkages, Infusions. Cores: Exotics, Refit, Doctrine change.
 * Prices and affordability update in place from `ui.shop`; rows are rebuilt only when the set of
 * visible nodes changes. The Suggested card on top shows the 3 cheapest affordable buys with a
 * "Buy all" button; the quantity selector (×1 · ×10 · Max, Q) drives every Buy button, the
 * suggestion chips, Buy all and each tree's "Spend here" (bulk.ts has the pure planning).
 * Progressive reveal (progression.ts, setFeatures): categories appear as they are earned; the Suggested card,
 * quantity selector and "Spend here" wait for 'bulk' (until then every Buy is ×1 and Q does nothing).
 */
import '../styles/shop.css';
import type { DoctrineId, ElementId, HardpointId, TreeId } from '@sim/core/ids';
import { Ev, type ShopEntry, type SimEvent, type UiState } from '@sim/core/types';
import { inBulkTree } from '@sim/economy/bulk';
import { button, h, holdRepeat, text, disable, show, attr, Keyed, clear } from './dom';
import { BUY_QTYS, buyLabel, buyLabelText, bulkToast, nextQty, parseQty, planBuyAll, qtyLabel, spendLabel, treeSpend, type BuyLabel, type BuyQty } from './bulk';
import { icon } from './icons';
import { fmtDuration, fmtNum, substituteDesc, titleCase } from './format';
import { nextPurchase, openSlots } from './advice';
import { CHASSIS, ELEMENTS, ELEMENT_BLURB, HARDPOINTS, HARDPOINT_BLURB, NODE_BY_ID, TREE_BY_ID, TREE_LABEL } from './content';
import { confirmDialog, openModal } from './modal';
import { doctrineFork, forkKey } from './doctrine';
import { prefs, setPref } from './prefs';
import { STARTER_IDS, contentPool, type Features } from './progression';
import type { UiCtx } from './ctx';

export type Category = 'chassis' | 'elements' | 'hardpoints' | 'cross' | 'cores';
const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'chassis', label: 'Chassis' }, { id: 'elements', label: 'Elements' }, { id: 'hardpoints', label: 'Hardpoints' },
  { id: 'cross', label: 'Cross' }, { id: 'cores', label: 'Cores' },
];
const REFIT_CORES = 3;
/** Purchases after which the "Tap to buy" coach retires. */
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

class NodeRow {
  readonly el: HTMLElement;
  private readonly name = h('span', { class: 'node-name' });
  private readonly rank = h('span', { class: 'node-rank' });
  private readonly desc = h('p', { class: 'node-desc' });
  private readonly lock = h('p', { class: 'node-lock' });
  private readonly btn: HTMLButtonElement;
  private readonly bcount = h('span', { class: 'buy-count' });
  private readonly price = h('span', { class: 'price' });
  private lastKey = '';
  entry: ShopEntry;
  constructor(entry: ShopEntry, send: (e: ShopEntry, count: number) => void, private readonly qty: () => BuyQty) {
    this.entry = entry;
    this.btn = h('button', { type: 'button', class: 'btn buy' }, this.bcount, this.price);
    // hold-to-repeat only at ×1; a ×10 / Max press buys once
    holdRepeat(this.btn, () => { const l = buyLabel(this.entry, this.qty()); if (l.send !== null) send(this.entry, l.send); }, () => this.qty() === 1);
    this.el = h('div', { class: 'node', data: { node: entry.node } },
      h('div', { class: 'node-main' }, h('div', { class: 'node-head' }, this.name, this.rank), this.desc, this.lock), this.btn);
    this.update(entry);
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
      text(this.desc, substituteDesc(e.desc, eff?.perRank, eff?.op));
      this.el.classList.add(`k-${e.kind}`, `t${e.tier}`);
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
  | { t: 'head'; text: string; sub?: string; /** bulk-tree key for a "Spend here" button */ spend?: string }
  | { t: 'node'; e: ShopEntry }
  | { t: 'note'; text: string }
  | { t: 'fork'; tree: TreeId }
  | { t: 'el'; key: string; make: () => HTMLElement };

export class Shop {
  readonly el: HTMLElement;
  readonly quick: HTMLElement;
  private readonly catRow = h('div', { class: 'tabs cat-tabs', attrs: { role: 'tablist', 'aria-label': 'Upgrade trees' } });
  private readonly treeRow = h('div', { class: 'chips tree-chips', attrs: { role: 'tablist', 'aria-label': 'Tree' } });
  private readonly body = h('div', { class: 'shop-body' });
  private readonly quickRow = h('div', { class: 'quick-row' });
  /** Open-slot chips ("Attune an element") shown before the quick buys. */
  private readonly slotRow = h('div', { class: 'quick-row slots' });
  private slotKey = '';
  /** When nothing is affordable: the next buy, its price and ETA at the current income. */
  private readonly nextChip: HTMLButtonElement;
  private readonly nextLabel = h('span', { class: 'qc-name' });
  private readonly nextPrice = h('span', { class: 'price scrap' });
  private readonly nextEta = h('span', { class: 'qc-eta' });
  private nextTree = '';
  private readonly doneChip: HTMLButtonElement;
  /** First-run explainer (the old "Tap to buy" coach; retires after COACH_BUYS purchases). */
  private readonly coach = h('p', { class: 'quick-coach sg-explain', text: 'Cheapest upgrades your Scrap buys right now. Tap one to buy it.' });
  private readonly sgToggle: HTMLButtonElement;
  private readonly sgCount = h('span', { class: 'sg-count' });
  private readonly buyAll: HTMLButtonElement;
  private readonly buyAllText = h('span', { class: 'sg-buyall-text' });
  private readonly buyAllPrice = h('span', { class: 'price scrap' });
  private readonly qtyBtns = new Map<BuyQty, HTMLButtonElement>();
  private readonly qtySeg = h('div', { class: 'qty-seg', attrs: { role: 'radiogroup', 'aria-label': 'Buy quantity (Q)' } });
  /** The open tree's "Spend here" button (rebuilt with the view, relabelled every update). */
  private spend: { tree: string; name: string; btn: HTMLButtonElement; line: HTMLSpanElement; key: string } | null = null;
  /** A bulk buy in flight: its Purchase events are summed into one toast. */
  private pendingBulk: { where: string | null; until: number; events: SimEvent[]; timer: number } | null = null;
  /** Bring the Upgrades screen forward when a chip, the death card or the Build screen jumps to a tree (GameUi wires it). */
  onReveal: (() => void) | null = null;
  private readonly sortBtn: HTMLButtonElement;
  private readonly catBtns = new Map<Category, { b: HTMLButtonElement; n: HTMLSpanElement }>();
  private treeBtns = new Map<string, { b: HTMLButtonElement; n: HTMLSpanElement }>();
  private readonly rows = new Map<string, NodeRow>();
  private readonly quickList: Keyed<ShopEntry, { el: HTMLButtonElement; label: HTMLSpanElement; rank: HTMLSpanElement; count: HTMLSpanElement; price: HTMLSpanElement; entry: ShopEntry; key: string }>;
  private cat: Category;
  private tree: string;
  private chipKey = '';
  private viewKey = '';
  private ui: UiState | null = null;
  private readonly qtyTools: HTMLElement[];
  private revealKey = '';

  constructor(private readonly ctx: UiCtx) {
    const p = prefs();
    this.cat = (CATEGORIES.some((c) => c.id === p.shopCategory) ? p.shopCategory : 'chassis') as Category;
    this.tree = p.shopTree;
    for (const c of CATEGORIES) {
      const n = h('span', { class: 'count' });
      const b = button([c.label, n], () => this.setCategory(c.id), { class: 'tab' });
      n.setAttribute('aria-hidden', 'true');
      b.setAttribute('role', 'tab');
      this.catBtns.set(c.id, { b, n });
      this.catRow.appendChild(b);
    }
    this.sortBtn = button(icon('sort'), () => {
      setPref('affordableFirst', !prefs().affordableFirst);
      this.syncSort();
      this.viewKey = '';
      if (this.ui) this.update(this.ui);
    }, { class: 'btn icon-btn toggle sort-btn', title: 'Affordable first: sort what you can buy to the top', label: 'Sort affordable upgrades first' });
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
    // Suggested card: title + chevron (collapsible, remembered) and Buy all; the chips scroll sideways below
    this.sgToggle = button([icon('down', 'ico tiny sg-chev'), h('span', { class: 'sg-title', text: 'Suggested' }), this.sgCount], () => {
      setPref('suggestOpen', !prefs().suggestOpen);
      this.syncSuggest();
    }, { class: 'btn ghost sg-toggle' });
    this.buyAll = button([this.buyAllText, this.buyAllPrice], () => this.doBuyAll(), { class: 'btn sg-buyall' });
    this.quick = h('div', { class: 'quick suggest' },
      h('div', { class: 'sg-head' }, this.sgToggle, this.buyAll),
      this.coach,
      h('div', { class: 'sg-body' }, this.slotRow, this.quickRow, this.nextChip, this.doneChip));
    this.syncSuggest();
    for (const q of BUY_QTYS) {
      const b = button(qtyLabel(q), () => this.setQty(q), { class: 'qty-opt', label: q === 0 ? 'Buy max' : `Buy ${q} at a time` });
      b.setAttribute('role', 'radio');
      this.qtyBtns.set(q, b);
      this.qtySeg.appendChild(b);
    }
    this.syncQty();
    // suggestions, categories, tree chips and the toolbar stay pinned (a side column on a landscape phone); the list scrolls
    this.el = h('section', { class: 'shop', attrs: { 'aria-label': 'Upgrades' } },
      h('div', { class: 'shop-side' }, this.quick,
        h('div', { class: 'shop-head' }, this.catRow),
        h('div', { class: 'shop-sub' }, this.treeRow),
        h('div', { class: 'shop-tools' }, h('span', { class: 'qty-label', text: 'Buy', attrs: { 'aria-hidden': 'true' } }), this.qtySeg, h('span', { class: 'tools-gap' }), this.sortBtn)),
      this.body);
    this.qtyTools = [this.el.querySelector('.shop-tools') as HTMLElement];   // quantity selector (and the sort toggle beside it)
  }

  private get f(): Features { return this.ctx.features(); }

  /** Progressive reveal: categories, the Suggested card and the quantity tools (GameUi, every UiState). */
  setFeatures(f: Features): void {
    const key = `${f.elements}${f.hardpoints}${f.cross}${f.cores}${f.bulk}${f.chassisAll}`;
    if (key === this.revealKey) return;
    this.revealKey = key;
    const cats = this.shownCats(f);
    for (const [id, x] of this.catBtns) x.b.hidden = !cats.includes(id);
    this.catRow.hidden = cats.length < 2;   // one category: its tree chips say enough
    for (const el of this.qtyTools) el.hidden = !f.bulk;
    this.el.classList.toggle('no-bulk', !f.bulk);
    if (!cats.includes(this.cat)) this.setCategory('chassis');
    this.syncQty();
    this.chipKey = ''; this.viewKey = '';
  }

  private shownCats(f: Features): Category[] {
    return CATEGORIES.map((c) => c.id).filter((c) => c === 'chassis' || f[c]);
  }

  // ---------------------------------------------------------------- bulk buying
  get qty(): BuyQty { return this.f.bulk ? parseQty(prefs().buyQty) : 1; }

  /** Set the quantity selector (×1 · ×10 · Max). */
  setQty(q: BuyQty): void {
    if (q === this.qty) return;
    setPref('buyQty', q);
    this.syncQty();
    if (this.ui) this.update(this.ui);
  }
  /** Q: ×1 → ×10 → Max → ×1. Returns the new quantity. */
  cycleQty(): BuyQty { const q = nextQty(this.qty); this.setQty(q); return q; }

  private syncQty(): void {
    const q = this.qty;
    for (const [v, b] of this.qtyBtns) { b.classList.toggle('on', v === q); attr(b, 'aria-checked', v === q ? 'true' : 'false'); }
    this.el?.classList.toggle('qty-bulk', q !== 1);
  }

  private syncSuggest(): void {
    const open = prefs().suggestOpen;
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
    const plan = planBuyAll(cheapestAffordable(ui.shop), ui.run.scrap, this.qty);
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
    for (const e of events) if (e.type === Ev.Purchase) { p.events.push(e); any = true; }
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
    this.chipKey = ''; this.viewKey = '';
    if (this.ui) this.update(this.ui);
    this.body.scrollTop = 0;
  }
  setTree(t: string): void {
    if (t === this.tree) return;
    this.tree = t;
    setPref('shopTree', t);
    this.viewKey = '';
    if (this.ui) this.update(this.ui);
    this.body.scrollTop = 0;
  }

  // ---------------------------------------------------------------- chips
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
      case 'cross': return [{ id: 'fusion', label: 'Fusions' }, { id: 'link', label: 'Linkages' }, { id: 'infuse', label: 'Infusions' }];
      case 'cores': return [{ id: 'exotic', label: 'Exotics' }, { id: 'refit', label: 'Refit' }, { id: 'doctrine', label: 'Doctrines' }];
    }
  }

  private entriesFor(ui: UiState, chip: string): ShopEntry[] {
    if (chip.startsWith('slot:')) return [];
    if (this.cat === 'cross') return ui.shop.filter((e) => e.tree === chip);
    if (this.cat === 'cores') return chip === 'exotic' ? ui.shop.filter((e) => e.kind === 'exotic') : chip === 'doctrine' ? ui.shop.filter((e) => e.kind === 'doctrine' && e.currency === 'cores' && e.cost > 0) : [];
    const t = TREE_BY_ID.get(chip as TreeId);
    if (!t) return [];
    const ids = new Set<string>([...t.shared.map((n) => n.id), ...t.doctrines.flatMap((d) => d.nodes.map((n) => n.id)), t.exotic.id, ...t.doctrines.map((d) => `${t.id}.${d.id}`)]);
    return ui.shop.filter((e) => ids.has(e.node) || (t.id === 'reactor' && e.tree === 'ability'));   // Reactor lists the ability rank nodes
  }

  private affordableCount(ui: UiState, chip: string): number {
    return this.entriesFor(ui, chip).filter((e) => e.affordable && !e.locked && e.kind !== 'doctrine').length;
  }

  private categoryCount(ui: UiState, c: Category): number {
    const saved = this.cat; this.cat = c;
    let n = 0;
    for (const ch of this.chips(ui)) n += ch.empty ? 1 : this.affordableCount(ui, ch.id);
    this.cat = saved;
    return n;
  }

  /** Show a category / tree (death card, slot chips, "Next" chip, Build screen) and bring Upgrades forward. */
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
    if (fork) requestAnimationFrame(() => { const f = this.body.querySelector('.fork'); (f?.closest('.shop-section') ?? f)?.scrollIntoView({ block: 'start' }); });
  }

  /** A purchase happened (Ev.Purchase): retire the first-purchase coach after three. */
  noteBuy(): void {
    const n = prefs().buyCoach;
    if (n < COACH_BUYS) setPref('buyCoach', n + 1);
  }

  // ---------------------------------------------------------------- update
  update(ui: UiState, scrapRate = 0): void {
    this.syncQty();
    this.ui = ui;
    // open slots first: a new weapon system or element is the biggest step change there is
    const slots = openSlots(ui).filter((x) => this.f[x.cat]);   // a slot's chip waits for its category (progression.ts)
    const sk = slots.map((x) => `${x.cat}:${x.slot}`).join(',');
    if (sk !== this.slotKey) {
      this.slotKey = sk;
      this.slotRow.replaceChildren(...slots.map((x) => button([icon('plus', 'ico tiny'), x.cat === 'elements' ? 'Attune an element' : 'Mount a weapon'],
        () => this.open(x.cat, `slot:${x.slot}`), { class: 'btn chip quick slot-chip' })));
    }
    // quick chips + Buy all (the Suggested card waits for the 'bulk' reveal)
    const sugg = cheapestAffordable(ui.shop);
    this.quickList.sync(sugg, (e) => e.node);
    show(this.quick, this.f.bulk);
    const empty = this.quickList.rows.size === 0;
    const plan = planBuyAll(sugg, ui.run.scrap, this.qty);
    show(this.buyAll, plan.cmds.length > 0);
    text(this.sgCount, sugg.length ? String(sugg.length) : '');
    if (plan.cmds.length) {
      const plus = plan.open ? '+' : '';
      text(this.buyAllText, 'Buy all');   // the rank counts live on the chips; keeps the header on one line in a 300 px column
      const pk = `${plan.total}${plus}`;
      if (this.buyAllPrice.dataset.v !== pk) { this.buyAllPrice.dataset.v = pk; this.buyAllPrice.replaceChildren(icon('scrap', 'ico tiny'), fmtNum(plan.total) + plus); }
      this.buyAll.title = `${plan.ranks}${plus} rank${plan.ranks === 1 ? '' : 's'}`;
      attr(this.buyAll, 'aria-label', `Buy all suggested: ${plan.open ? 'at least ' : ''}${plan.ranks} rank${plan.ranks === 1 ? '' : 's'} for ${plan.open ? 'at least ' : ''}${fmtNum(plan.total)} Scrap`);
    }
    const next = empty ? nextPurchase(ui.shop, ui.run.scrap, scrapRate) : null;
    // Everything owned (the Prestige Wall): say so and point at the Forecast instead of "nothing affordable yet".
    const allOwned = empty && !next && slots.length === 0 && !ui.shop.some((e) => e.currency === 'scrap' && e.rank < e.maxRank);
    show(this.doneChip, allOwned);
    this.quick.classList.toggle('empty', empty && slots.length === 0 && !next && !allOwned);
    show(this.nextChip, !!next);
    if (next) {
      this.nextTree = next.entry.tree;
      const e = next.entry;
      text(this.nextLabel, e.rank > 0 && e.maxRank > 1 ? `${e.name} ${e.rank + 1}` : e.name);
      if (this.nextPrice.dataset.v !== String(e.cost)) { this.nextPrice.dataset.v = String(e.cost); this.nextPrice.replaceChildren(icon('scrap', 'ico tiny'), fmtNum(e.cost)); }
      text(this.nextEta, next.eta !== null && next.eta > 0 ? `~${fmtDuration(next.eta)}` : '');
      attr(this.nextChip, 'aria-label', `Next upgrade: ${e.name}, ${fmtNum(e.cost)} Scrap${next.eta ? `, affordable in about ${fmtDuration(next.eta)}` : ''}. Opens its tree.`);
    }
    const coach = prefs().buyCoach < COACH_BUYS && !empty;
    show(this.coach, coach);
    this.quickRow.classList.toggle('coach', coach);
    this.updateSpend(ui);

    for (const c of CATEGORIES) {
      const cb = this.catBtns.get(c.id)!;
      if (cb.b.hidden) continue;
      const n = this.categoryCount(ui, c.id);
      text(cb.n, n > 0 ? String(n) : '');
      attr(cb.b, 'aria-label', n > 0 ? `${c.label} (${n} affordable)` : c.label);
      cb.b.title = n > 0 ? `${n} affordable` : '';
      cb.b.classList.toggle('active', c.id === this.cat);
      attr(cb.b, 'aria-selected', c.id === this.cat ? 'true' : 'false');
    }

    const chips = this.chips(ui);
    if (!chips.some((c) => c.id === this.tree)) this.tree = chips[0]?.id ?? '';
    const ck = this.cat + '|' + chips.map((c) => c.id + c.label).join(',');
    if (ck !== this.chipKey) {
      this.chipKey = ck;
      this.treeBtns = new Map();
      clear(this.treeRow);
      for (const c of chips) {
        const n = h('span', { class: 'count' });
        const b = button([c.empty ? icon('plus', 'ico tiny') : null, c.label, n], () => this.setTree(c.id), { class: `chip tree-chip${c.empty ? ' empty' : ''}` });
        b.setAttribute('role', 'tab');
        this.treeBtns.set(c.id, { b, n });
        this.treeRow.appendChild(b);
      }
    }
    for (const [id, tb] of this.treeBtns) {
      tb.b.classList.toggle('active', id === this.tree);
      attr(tb.b, 'aria-selected', id === this.tree ? 'true' : 'false');
      const n = id.startsWith('slot:') ? 0 : this.affordableCount(ui, id);
      text(tb.n, n > 0 ? String(n) : '');
    }

    const items = this.plan(ui);
    const sortKey = prefs().affordableFirst ? items.map((i) => (i.t === 'node' ? (i.e.affordable ? 1 : 0) : '')).join('') : '';
    const key = `${this.cat}|${this.tree}|${sortKey}|` + items.map((i) => i.t === 'node' ? i.e.node : i.t === 'fork' ? `fork:${forkKey(ui, i.tree)}` : i.t === 'el' ? `el:${i.key}` : `${i.t}:${i.text}`).join(',');
    if (key !== this.viewKey) {
      this.viewKey = key;
      this.render(ui, items);
      this.updateSpend(ui);
    } else {
      for (const it of items) if (it.t === 'node') this.rows.get(it.e.node)?.update(it.e);
    }
  }

  /** Relabel the open tree's "Spend here" button: Max uses the sim's shopTreeTotals (approximate). */
  private updateSpend(ui: UiState): void {
    const sp = this.spend;
    if (!sp || !sp.btn.isConnected) return;
    const q = this.qty;
    const s = treeSpend(ui.shop.filter((e) => inBulkTree(e, sp.tree)), ui.run.scrap, q, ui.shopTreeTotals?.[sp.tree]);
    const key = `${q}|${s.ranks}|${s.total}`;
    if (key === sp.key) return;
    sp.key = key;
    text(sp.line, spendLabel(s, q));
    disable(sp.btn, s.ranks === 0);
    attr(sp.btn, 'aria-label', s.ranks === 0 ? `Spend here: nothing affordable in ${sp.name}` : `Spend here: buy the cheapest ${q === 1 ? 'rank' : `${s.ranks} ranks`} in ${sp.name} for about ${fmtNum(s.total)} Scrap`);
  }

  private sorted(list: ShopEntry[]): ShopEntry[] {
    if (!prefs().affordableFirst) return list;
    return list.map((e, i) => ({ e, i })).sort((a, b) => (Number(b.e.affordable) - Number(a.e.affordable)) || a.i - b.i).map((x) => x.e);
  }

  private plan(ui: UiState): Item[] {
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
      const list = this.sorted(ui.shop.filter((e) => e.tree === chip));
      if (list.length) out.push({ t: 'head', text: chip === 'fusion' ? 'Fusions' : chip === 'link' ? 'Linkages' : 'Infusions', spend: this.f.bulk ? chip : undefined });
      if (!list.length) out.push({ t: 'note', text: chip === 'fusion' ? 'Fusions appear when two elements are attuned (Triads need three, from Ascension II).' : chip === 'link' ? 'Linkages appear when two systems are mounted (the primary counts), or a hardpoint pairs with Bastion or Reactor.' : 'Infusions appear when a mounted hardpoint meets an attuned element.' });
      for (const e of list) out.push({ t: 'node', e });
      return out;
    }

    if (this.cat === 'cores') {
      if (chip === 'exotic') {
        out.push({ t: 'head', text: 'Exotics', sub: 'One per tree, 2 Cores each; open once the tree\'s Doctrine fork is reached.' });
        const list = this.sorted(ui.shop.filter((e) => e.kind === 'exotic'));
        if (!list.length) out.push({ t: 'note', text: 'No Exotics visible yet.' });
        for (const e of list) out.push({ t: 'node', e });
      } else if (chip === 'refit') {
        out.push({ t: 'head', text: 'Refit', sub: `Swap a mounted hardpoint for another: ${REFIT_CORES} Cores, refunds 60% of the Scrap spent in the removed system. Its ranks are lost.` });
        out.push({ t: 'el', key: `refit:${ui.build.hardpoints.join(',')}:${ui.run.cores >= REFIT_CORES}`, make: () => this.refitList(ui) });
      } else {
        out.push({ t: 'head', text: 'Doctrine changes', sub: 'Changing a chosen Doctrine costs 1 Core and is allowed only at a checkpoint (between waves, right after a boss).' });
        let any = false;
        const frameMounted = (ui.extraSystems ?? []).filter((x) => x.via === 'frame').map((x) => x.system);
        for (const t of [...CHASSIS, ...ui.build.attunements, ...ui.build.hardpoints, ...frameMounted]) {
          if (!t || !ui.build.doctrines[t as TreeId]) continue;
          any = true;
          out.push({ t: 'fork', tree: t as TreeId });
        }
        if (!any) out.push({ t: 'note', text: 'No Doctrines chosen yet. Each tree forks once at its middle tier.' });
      }
      return out;
    }

    const t = TREE_BY_ID.get(chip as TreeId);
    if (!t) return out;
    if (!this.f.chassisAll) { out.push({ t: 'head', text: t.name }, ...nodes(t.shared.map((n) => n.id).filter((id) => STARTER_IDS.has(id)))); return out; }   // stage 0: 3 stats
    out.push({ t: 'head', text: t.name, sub: 'Core nodes', spend: this.f.bulk ? t.id : undefined });
    // Reachability: a Borrowed Blade takes base nodes only; mounting it in an open slot opens the rest
    if ((ui.extraSystems ?? []).some((x) => x.system === t.id && x.via === 'borrowed')) {
      const free = openSlots(ui).find((x) => x.cat === 'hardpoints');
      out.push({ t: 'note', text: `Borrowed by an Anomaly: tier-1 nodes only, no Doctrines or Exotic.${free ? ' Mount it in your open hardpoint slot to open its whole tree.' : ' Mount it in a hardpoint slot when one opens to open its whole tree.'}` });
    }
    out.push(...nodes(t.shared.map((n) => n.id)));
    out.push({ t: 'head', text: 'Doctrine', sub: 'Choose one path; the fork opens after enough core nodes.' });
    out.push({ t: 'fork', tree: t.id });
    const chosen = [ui.build.doctrines[t.id], ui.build.secondDoctrines[t.id]].filter(Boolean) as DoctrineId[];
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
      out.push({ t: 'head', text: 'Ability ranks', sub: 'One per slotted tactical ability. Slot abilities from the Battle bar or the Build tab.' });
      if (!ab.length) out.push({ t: 'note', text: 'No ability is slotted: slot one to upgrade it here.' });
      for (const e of ab) out.push({ t: 'node', e });
    }
    if (this.cat === 'hardpoints') {
      const slot = ui.build.hardpoints.indexOf(t.id as HardpointId);
      if (slot >= 0) out.push({ t: 'el', key: `refit-one:${t.id}:${ui.run.cores >= REFIT_CORES}`, make: () => h('div', { class: 'refit-one' }, button(`Refit ${t.name}… (${REFIT_CORES} Cores)`, () => this.refitPicker(slot), { class: 'btn ghost', disabled: ui.run.cores < REFIT_CORES })) });
    }
    return out;
  }

  // ---------------------------------------------------------------- render
  private render(ui: UiState, items: Item[]): void {
    const frag = document.createDocumentFragment();
    let section: HTMLElement | null = null;
    const used = new Set<string>();
    this.spend = null;
    for (const it of items) {
      if (it.t === 'head') {
        const title = h('h3', { class: 'sec-title' }, it.text, it.sub ? h('span', { class: 'sec-sub', text: it.sub }) : null);
        if (it.spend) {
          const tree = it.spend, name = it.text;
          const line = h('span', { class: 'spend-line' });
          const btn = button([h('span', { class: 'spend-title', text: 'Spend here' }), line], () => this.doSpend(tree, name), { class: 'btn spend-btn', title: 'Buy the cheapest upgrades in this tree (uses the ×1 · ×10 · Max selector)' });
          this.spend = { tree, name, btn, line, key: '' };
          section = h('div', { class: 'shop-section' }, h('div', { class: 'sec-head' }, title, btn));
        } else section = h('div', { class: 'shop-section' }, title);
        frag.appendChild(section);
        continue;
      }
      const host = section ?? frag;
      if (it.t === 'node') {
        let row = this.rows.get(it.e.node);
        if (!row) { row = new NodeRow(it.e, (e, count) => this.sendBuy(e, count), () => this.qty); this.rows.set(it.e.node, row); }
        else row.update(it.e);
        used.add(it.e.node);
        host.appendChild(row.el);
      } else if (it.t === 'note') host.appendChild(h('p', { class: 'note', text: it.text }));
      else if (it.t === 'fork') host.appendChild(doctrineFork(this.ctx, ui, it.tree, { title: this.cat === 'cores' }));
      else host.appendChild(it.make());
    }
    for (const k of [...this.rows.keys()]) if (!used.has(k)) this.rows.delete(k);
    this.body.replaceChildren(frag);
  }

  /** Attune / mount picker for an open slot (the Upgrades slot chip and the Build screen's Mount button). */
  slotPicker(isEl: boolean, slot: number, onDone?: () => void): HTMLElement {
    const ui = this.ctx.state() ?? this.ui!;
    const wrap = h('div', { class: 'slot-picker' },
      h('p', { class: 'note', text: isEl ? 'Attune an element to this slot. Attunements lock for the rest of this Prestige.' : 'Mount a weapon system in this slot. Mounts lock for this Prestige (a Refit costs 3 Cores). At most four systems ever: one always sits out.' }));
    const pool = contentPool(ui, { unlockAll: this.f.unlockAll });   // what this Prestige offers (progression.ts)
    const list = isEl ? ELEMENTS.filter((e) => pool.elements.includes(e) && !ui.build.attunements.includes(e)) : HARDPOINTS.filter((hp) => pool.hardpoints.includes(hp) && !ui.build.hardpoints.includes(hp));
    for (const id of list) {
      const name = TREE_LABEL[id as TreeId] ?? titleCase(id);
      const blurb = isEl ? ELEMENT_BLURB[id as ElementId] : HARDPOINT_BLURB[id as HardpointId];
      // Frame free mount / Trial rule: shown with the reason instead of a Mount button that would fail
      const blocked = isEl ? undefined : ui.mountBlocked?.[id as HardpointId];
      const borrowed = !isEl && (ui.extraSystems ?? []).some((x) => x.system === id && x.via === 'borrowed');
      if (blocked) {
        wrap.appendChild(h('div', { class: `pick-card ${id} blocked` },
          h('div', { class: 'pick-main' }, h('div', { class: 'pick-name', text: name }), h('p', { class: 'pick-blurb', text: blocked }))));
        continue;
      }
      wrap.appendChild(h('div', { class: `pick-card ${id}` },
        h('div', { class: 'pick-main' }, h('div', { class: 'pick-name', text: name }), h('p', { class: 'pick-blurb', text: borrowed ? `Borrowed now (tier 1). Mounting it here opens its full tree and Doctrines. ${blurb}` : blurb })),
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
    const m = openModal({ title: `Refit slot ${slot + 1}`, body });
    for (const hp of HARDPOINTS.filter((x) => !ui.build.hardpoints.includes(x) && !ui.mountBlocked?.[x])) {
      body.appendChild(h('div', { class: 'pick-card' },
        h('div', { class: 'pick-main' }, h('div', { class: 'pick-name', text: TREE_LABEL[hp] }), h('p', { class: 'pick-blurb', text: HARDPOINT_BLURB[hp] })),
        button('Refit', async () => {
          m.close();
          if (await confirmDialog('Confirm Refit', `${TREE_LABEL[old]} → ${TREE_LABEL[hp]} for ${REFIT_CORES} Cores.`, 'Refit', { danger: true })) {
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
