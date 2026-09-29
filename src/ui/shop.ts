/**
 * Upgrade shop. Categories → tree chips → tree view:
 *   shared nodes · Doctrine fork (2–4 cards) · doctrine nodes + capstone · Exotic (Cores)
 * Elements / Hardpoints list attuned / mounted trees plus empty slots (picker → attune /
 * mount_hardpoint). Cross: Fusions, Linkages, Infusions. Cores: Exotics, Refit, Doctrine change.
 * Prices and affordability update in place from `ui.shop`; rows are rebuilt only when the set of
 * visible nodes changes. `quickChips` renders the 3 cheapest affordable buys (combat panel).
 */
import '../styles/shop.css';
import type { DoctrineId, ElementId, HardpointId, TreeId } from '@sim/core/ids';
import type { ShopEntry, UiState } from '@sim/core/types';
import { button, h, holdRepeat, text, disable, show, attr, Keyed, clear } from './dom';
import { icon } from './icons';
import { fmtNum, substituteDesc, titleCase } from './format';
import { CHASSIS, ELEMENTS, ELEMENT_BLURB, HARDPOINTS, HARDPOINT_BLURB, NODE_BY_ID, TREE_BY_ID, TREE_LABEL } from './content';
import { confirmDialog, openModal } from './modal';
import { prefs, setPref } from './prefs';
import type { UiCtx } from './ctx';

export type Category = 'chassis' | 'elements' | 'hardpoints' | 'cross' | 'cores';
const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'chassis', label: 'Chassis' }, { id: 'elements', label: 'Elements' }, { id: 'hardpoints', label: 'Hardpoints' },
  { id: 'cross', label: 'Cross' }, { id: 'cores', label: 'Cores' },
];
const ATTUNE_WAVES = [5, 25, 45];
const HARDPOINT_WAVES = [10, 30, 55, 75];
const REFIT_CORES = 3;

interface Chip { id: string; label: string; empty?: boolean }

/** 3 cheapest affordable Scrap buys (the compact "combat panel"). */
export function cheapestAffordable(shop: readonly ShopEntry[], n = 3): ShopEntry[] {
  return shop.filter((e) => e.affordable && !e.locked && e.currency === 'scrap' && e.kind !== 'doctrine')
    .sort((a, b) => a.cost - b.cost || (a.node < b.node ? -1 : 1)).slice(0, n);
}

function costLabel(e: ShopEntry): HTMLElement {
  return h('span', { class: `price ${e.currency}` }, icon(e.currency === 'cores' ? 'cores' : 'scrap', 'ico tiny'), fmtNum(e.cost));
}

class NodeRow {
  readonly el: HTMLElement;
  private readonly name = h('span', { class: 'node-name' });
  private readonly rank = h('span', { class: 'node-rank' });
  private readonly desc = h('p', { class: 'node-desc' });
  private readonly lock = h('p', { class: 'node-lock' });
  private readonly btn: HTMLButtonElement;
  private readonly price = h('span', { class: 'price' });
  private readonly priceIco = h('span');
  private readonly priceVal = h('span');
  private lastKey = '';
  entry: ShopEntry;
  constructor(entry: ShopEntry, send: (id: string) => void) {
    this.entry = entry;
    this.price.append(this.priceIco, this.priceVal);
    this.btn = h('button', { type: 'button', class: 'btn buy' }, this.price);
    holdRepeat(this.btn, () => send(this.entry.node));
    this.el = h('div', { class: 'node', data: { node: entry.node } },
      h('div', { class: 'node-main' }, h('div', { class: 'node-head' }, this.name, this.rank), this.desc, this.lock), this.btn);
    this.update(entry);
  }
  update(e: ShopEntry): void {
    this.entry = e;
    const key = `${e.rank}|${e.maxRank}|${e.cost}|${e.affordable}|${e.locked ?? ''}|${e.currency}`;
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
    if (maxed) { this.priceIco.replaceChildren(icon('check', 'ico tiny')); text(this.priceVal, 'Max'); }
    else { this.priceIco.replaceChildren(icon(e.currency === 'cores' ? 'cores' : 'scrap', 'ico tiny')); text(this.priceVal, fmtNum(e.cost)); }
    this.price.className = `price ${e.currency}`;
    disable(this.btn, maxed || !!e.locked || !e.affordable);
    attr(this.btn, 'aria-label', maxed ? `${e.name}: max rank` : `Buy ${e.name} for ${fmtNum(e.cost)} ${e.currency === 'cores' ? 'Cores' : 'Scrap'}${e.locked ? ` (locked: ${e.locked})` : e.affordable ? '' : ' (not enough)'}`);
    this.btn.title = e.locked ?? (e.affordable ? 'Hold to buy repeatedly' : `Need ${fmtNum(e.cost)} ${e.currency === 'cores' ? 'Cores' : 'Scrap'}`);
  }
}

type Item =
  | { t: 'head'; text: string; sub?: string }
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
  private readonly sortBtn: HTMLButtonElement;
  private readonly catBtns = new Map<Category, { b: HTMLButtonElement; n: HTMLSpanElement }>();
  private treeBtns = new Map<string, { b: HTMLButtonElement; n: HTMLSpanElement }>();
  private readonly rows = new Map<string, NodeRow>();
  private readonly quickList: Keyed<ShopEntry, { el: HTMLButtonElement; label: HTMLSpanElement; price: HTMLSpanElement; node: string }>;
  private cat: Category;
  private tree: string;
  private chipKey = '';
  private viewKey = '';
  private ui: UiState | null = null;

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
      const price = h('span', { class: 'price scrap' });
      const row = { el: h('button', { type: 'button', class: 'btn chip quick' }, label, price), label, price, node: e.node };
      holdRepeat(row.el, () => this.ctx.host.send({ type: 'buy', node: row.node }));
      return row;
    }, (r, e) => {
      r.node = e.node;
      text(r.label, e.rank > 0 && e.maxRank > 1 ? `${e.name} ${e.rank + 1}` : e.name);
      r.price.replaceChildren(icon('scrap', 'ico tiny'), fmtNum(e.cost));
      attr(r.el, 'aria-label', `Quick buy ${e.name} for ${fmtNum(e.cost)} Scrap`);
    });
    this.quick = h('div', { class: 'quick' }, h('span', { class: 'quick-label', text: 'Quick buys' }), this.quickRow);
    this.el = h('section', { class: 'shop', attrs: { 'aria-label': 'Upgrades' } },
      h('div', { class: 'shop-head' }, this.catRow),
      h('div', { class: 'shop-sub' }, this.treeRow, this.sortBtn),
      this.body);
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
    return ui.shop.filter((e) => ids.has(e.node));
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

  // ---------------------------------------------------------------- update
  update(ui: UiState): void {
    this.ui = ui;
    // quick chips
    this.quickList.sync(cheapestAffordable(ui.shop), (e) => e.node);
    show(this.quick, true);
    this.quick.classList.toggle('empty', this.quickList.rows.size === 0);

    for (const c of CATEGORIES) {
      const cb = this.catBtns.get(c.id)!;
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
    const key = `${this.cat}|${this.tree}|${sortKey}|` + items.map((i) => i.t === 'node' ? i.e.node : i.t === 'fork' ? `fork:${this.forkKey(ui, i.tree)}` : i.t === 'el' ? `el:${i.key}` : `${i.t}:${i.text}`).join(',');
    if (key !== this.viewKey) {
      this.viewKey = key;
      this.render(ui, items);
    } else {
      for (const it of items) if (it.t === 'node') this.rows.get(it.e.node)?.update(it.e);
    }
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
        const waves = isEl ? ATTUNE_WAVES : HARDPOINT_WAVES;
        out.push({ t: 'note', text: isEl ? `Your first attunement opens after clearing wave ${waves[0]}. Attuning an element opens its tree, its Infusions and Fusions with other attuned elements.` : `Your first hardpoint slot opens after clearing wave ${waves[0]}. Each slot mounts one weapon system for the rest of this Prestige.` });
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
        for (const t of [...CHASSIS, ...ui.build.attunements, ...ui.build.hardpoints]) {
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
    out.push({ t: 'head', text: t.name, sub: 'Core nodes' });
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
    if (ex) { out.push({ t: 'head', text: 'Exotic', sub: 'Costs Cores; one per tree.' }); out.push({ t: 'node', e: ex }); }
    if (this.cat === 'hardpoints') {
      const slot = ui.build.hardpoints.indexOf(t.id as HardpointId);
      if (slot >= 0) out.push({ t: 'el', key: `refit-one:${t.id}:${ui.run.cores >= REFIT_CORES}`, make: () => h('div', { class: 'refit-one' }, button(`Refit ${t.name}… (${REFIT_CORES} Cores)`, () => this.refitPicker(slot), { class: 'btn ghost', disabled: ui.run.cores < REFIT_CORES })) });
    }
    return out;
  }

  private forkKey(ui: UiState, tree: TreeId): string {
    const t = TREE_BY_ID.get(tree);
    if (!t) return tree;
    const e = t.doctrines.map((d) => { const x = ui.shop.find((s) => s.node === `${tree}.${d.id}`); return x ? `${x.cost}${x.affordable}${x.locked ?? ''}` : '-'; }).join(';');
    return `${tree}:${ui.build.doctrines[tree] ?? ''}:${ui.build.secondDoctrines[tree] ?? ''}:${e}`;
  }

  // ---------------------------------------------------------------- render
  private render(ui: UiState, items: Item[]): void {
    const frag = document.createDocumentFragment();
    let section: HTMLElement | null = null;
    const used = new Set<string>();
    for (const it of items) {
      if (it.t === 'head') {
        section = h('div', { class: 'shop-section' }, h('h3', { class: 'sec-title' }, it.text, it.sub ? h('span', { class: 'sec-sub', text: it.sub }) : null));
        frag.appendChild(section);
        continue;
      }
      const host = section ?? frag;
      if (it.t === 'node') {
        let row = this.rows.get(it.e.node);
        if (!row) { row = new NodeRow(it.e, (id) => this.ctx.host.send({ type: 'buy', node: id })); this.rows.set(it.e.node, row); }
        else row.update(it.e);
        used.add(it.e.node);
        host.appendChild(row.el);
      } else if (it.t === 'note') host.appendChild(h('p', { class: 'note', text: it.text }));
      else if (it.t === 'fork') host.appendChild(this.fork(ui, it.tree));
      else host.appendChild(it.make());
    }
    for (const k of [...this.rows.keys()]) if (!used.has(k)) this.rows.delete(k);
    this.body.replaceChildren(frag);
  }

  private fork(ui: UiState, tree: TreeId): HTMLElement {
    const t = TREE_BY_ID.get(tree)!;
    const cur = ui.build.doctrines[tree], second = ui.build.secondDoctrines[tree];
    const wrap = h('div', { class: 'fork', attrs: { role: 'group', 'aria-label': `${t.name} Doctrine` } });
    if (this.cat === 'cores') wrap.appendChild(h('div', { class: 'fork-title', text: t.name }));
    const cards = h('div', { class: 'fork-cards' });
    wrap.appendChild(cards);
    for (const d of t.doctrines) {
      const e = ui.shop.find((s) => s.node === `${tree}.${d.id}`);
      const isCur = cur === d.id, isSecond = second === d.id;
      const cap = NODE_BY_ID.get(d.capstone);
      const card = h('div', { class: `doctrine${isCur || isSecond ? ' chosen' : ''}` },
        h('div', { class: 'doc-name' }, isCur || isSecond ? icon('check', 'ico tiny') : null, d.name, isSecond ? h('span', { class: 'tag', text: '2nd' }) : null),
        h('p', { class: 'doc-id', text: d.identity }),
        cap ? h('p', { class: 'doc-cap' }, h('b', { text: 'Capstone: ' }), cap.name) : null);
      if (isCur || isSecond) card.appendChild(h('span', { class: 'doc-state', text: 'Chosen' }));
      else if (e) {
        const change = !!cur;
        const label = change ? `Change · 1` : e.cost > 0 ? `Choose · ${e.cost}` : 'Choose';
        const b = button([label, e.cost > 0 ? icon('cores', 'ico tiny') : null], async () => {
          if (change && !(await confirmDialog(`Change ${t.name} Doctrine?`, `Switch from ${t.doctrines.find((x) => x.id === cur)?.name} to ${d.name} for ${e.cost} Core. Nodes bought in the old Doctrine stop working.`, 'Change'))) return;
          if (!change && !(await confirmDialog(`Choose ${d.name}?`, `${d.identity} Doctrines lock for this Prestige; changing later costs 1 Core at a checkpoint.`, 'Choose'))) return;
          this.ctx.host.send({ type: 'choose_doctrine', tree, doctrine: d.id });
        }, { class: 'btn small primary', disabled: !!e.locked || !e.affordable });
        if (e.locked) b.title = e.locked;
        card.appendChild(b);
        if (e.locked) card.appendChild(h('p', { class: 'node-lock', text: e.locked }));
      } else card.appendChild(h('p', { class: 'node-lock', text: 'Not available' }));
      cards.appendChild(card);
    }
    return wrap;
  }

  private slotPicker(isEl: boolean, slot: number): HTMLElement {
    const ui = this.ui!;
    const wrap = h('div', { class: 'slot-picker' },
      h('p', { class: 'note', text: isEl ? 'Attune an element to this slot. Attunements lock for the rest of this Prestige.' : 'Mount a weapon system in this slot. Mounts lock for this Prestige (a Refit costs 3 Cores). At most four systems ever: one always sits out.' }));
    const list = isEl ? ELEMENTS.filter((e) => !ui.build.attunements.includes(e)) : HARDPOINTS.filter((hp) => !ui.build.hardpoints.includes(hp));
    for (const id of list) {
      const name = TREE_LABEL[id as TreeId] ?? titleCase(id);
      const blurb = isEl ? ELEMENT_BLURB[id as ElementId] : HARDPOINT_BLURB[id as HardpointId];
      wrap.appendChild(h('div', { class: `pick-card ${id}` },
        h('div', { class: 'pick-main' }, h('div', { class: 'pick-name', text: name }), h('p', { class: 'pick-blurb', text: blurb })),
        button(isEl ? 'Attune' : 'Mount', async () => {
          if (!(await confirmDialog(`${isEl ? 'Attune' : 'Mount'} ${name}?`, `${name} ${isEl ? 'is attuned' : 'is mounted'} for the rest of this Prestige.`, isEl ? 'Attune' : 'Mount'))) return;
          this.ctx.host.send(isEl ? { type: 'attune', slot, element: id as ElementId } : { type: 'mount_hardpoint', slot, system: id as HardpointId });
          this.tree = id;
          setPref('shopTree', id);
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

  private refitPicker(slot: number): void {
    const ui = this.ctx.state();
    if (!ui) return;
    const old = ui.build.hardpoints[slot];
    if (!old) return;
    const body = h('div', { class: 'slot-picker' }, h('p', { class: 'note', text: `Replace ${TREE_LABEL[old]} for ${REFIT_CORES} Cores. You get back 60% of the Scrap spent in ${TREE_LABEL[old]}; its ranks, Doctrine and Linkages are lost.` }));
    const m = openModal({ title: `Refit slot ${slot + 1}`, body });
    for (const hp of HARDPOINTS.filter((x) => !ui.build.hardpoints.includes(x))) {
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
