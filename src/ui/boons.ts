/**
 * Boons UI (docs/BOONS.md). Boons are attempt-scoped rewards: three are offered at the start of every retry and
 * after every boss cleared; the player picks one (or rerolls, or declines). Nothing is ever picked for them.
 *
 *  BoonOffer     a compact, non-blocking card over the arena, above the ability buttons: three mini-cards
 *                (category shape + label, rarity shape + label, name, one line with the numbers, "needs" tag).
 *                The first tap selects a card (its full description shows, and at the cap which boon it
 *                replaces); "Take" confirms, so a tap meant for the arena never picks by accident. Reroll
 *                (Cores) and Decline sit beside it; the chevron sets the offer aside as a pulsing "Boon ready" chip.
 *  BoonRow       the active boons as a slim row of category icons under the top bar; tap for the list.
 *  boonsSection  the Build tab's "Active boons" section (and the pending-offer prompt).
 *
 * Pure helpers (no DOM) come first; tests/ui/boons.test.ts covers them.
 */
import '../styles/boons.css';
import type { BoonCategory, BoonId, BoonRarity } from '@sim/core/ids';
import type { BuildState, Command, UiState } from '@sim/core/types';
import { button, h, show, text, attr, clear } from './dom';
import { boonCategoryIcon, icon, rarityIcon } from './icons';
import { BOON_BY_ID, FUSIONS, TREE_LABEL } from './content';
import { openModal, type ModalHandle } from './modal';
import { titleCase } from './format';
import type { UiCtx } from './ctx';

export const CATEGORY_LABEL: Record<BoonCategory, string> = { surge: 'Surge', twist: 'Twist', trade: 'Trade', wild: 'Wild card' };
export const RARITY_LABEL: Record<BoonRarity, string> = { common: 'Common', rare: 'Rare' };

export interface BoonNeed { label: string; have: boolean }
export interface BoonView {
  id: BoonId; name: string; category: BoonCategory; categoryLabel: string; rarity: BoonRarity; rarityLabel: string;
  short: string; desc: string; needs: BoonNeed[];
}
type NeedsBuild = Pick<BuildState, 'hardpoints' | 'attunements' | 'ranks'> & { /** systems running without a slot (UiState.extraSystems) */ extra?: readonly string[] };
/** Reachability: what boon needs are checked against (a Frame's free mount or a Borrowed Blade counts as mounted). */
export function needsBuild(ui: Pick<UiState, 'build' | 'extraSystems'>): NeedsBuild {
  return { hardpoints: ui.build.hardpoints, attunements: ui.build.attunements, ranks: ui.build.ranks, extra: (ui.extraSystems ?? []).map((x) => x.system) };
}

/** What a boon needs and whether the build has it ('fusion' = a Fusion with a rank whose two elements are attuned). */
export function boonNeeds(id: BoonId, build: NeedsBuild | null): BoonNeed[] {
  const d = BOON_BY_ID.get(id);
  return (d?.needs ?? []).map((n) => {
    if (n === 'fusion') {
      const have = !build || FUSIONS.some((f) => (build.ranks[f.node.id] | 0) > 0 && f.elements.every((e) => build.attunements.includes(e)));
      return { label: 'a Fusion', have };
    }
    const have = !build || build.hardpoints.includes(n as never) || build.attunements.includes(n as never) || !!build.extra?.includes(n);
    return { label: TREE_LABEL[n as keyof typeof TREE_LABEL] ?? titleCase(n), have };
  });
}

/** Everything a card or row shows for one boon. */
export function boonView(id: BoonId, build: NeedsBuild | null): BoonView {
  const d = BOON_BY_ID.get(id);
  const category = d?.category ?? 'surge', rarity = d?.rarity ?? 'common';
  return {
    id, name: d?.name ?? titleCase(id), category, categoryLabel: CATEGORY_LABEL[category], rarity, rarityLabel: RARITY_LABEL[rarity],
    short: d?.short ?? '', desc: d?.desc ?? '', needs: boonNeeds(id, build),
  };
}

/** The display name of a boon id (or a `boon.<id>` Codex / event src). */
export function boonName(id: string): string {
  const k = id.startsWith('boon.') ? id.slice(5) : id;
  return BOON_BY_ID.get(k as BoonId)?.name ?? titleCase(k);
}

/** The active boon a pick would drop: none below the cap, else `replace` (if active) or the oldest. */
export function replacedBy(active: readonly BoonId[], cap: number, replace?: BoonId | null): BoonId | null {
  if (active.length < cap) return null;
  if (replace && active.includes(replace)) return replace;
  return active[0] ?? null;
}

/** Heading of the offer: why it is here, and how many more wait behind it. */
export function offerHeading(kind: 'start' | 'boss', queued: number): { title: string; sub: string } {
  const why = kind === 'boss' ? 'Boss cleared' : 'New attempt';
  return { title: 'Pick a boon', sub: queued > 0 ? `${why} · +${queued} waiting` : why };
}

/** Reroll button state: the price (1, then 2, …) and whether the Cores cover it. */
export function rerollState(cores: number, cost: number): { cost: number; can: boolean; label: string } {
  const c = Math.max(1, Math.floor(cost) || 1);
  return { cost: c, can: cores >= c, label: `Reroll for ${c} Core${c === 1 ? '' : 's'}${cores >= c ? '' : ` (you have ${Math.floor(cores)})`}` };
}

/** "2/4" and a spoken list for the active row. */
export function activeSummary(active: readonly BoonId[], cap: number): { count: string; label: string } {
  const names = active.map((id) => boonName(id));
  return { count: `${active.length}/${cap}`, label: active.length ? `Active boons (${active.length} of ${cap}): ${names.join(', ')}. Tap for details` : 'No active boons' };
}

/** The pick command for `id` (with the boon to replace when the player chose one at the cap). */
export function pickCommand(id: BoonId, active: readonly BoonId[], cap: number, replace?: BoonId | null): Command {
  const r = replace && active.length >= cap && active.includes(replace) ? replace : null;
  return r ? { type: 'pick_boon', boon: id, replace: r } : { type: 'pick_boon', boon: id };
}

// ---------------------------------------------------------------- DOM pieces

/** Category shape + label (mini-cards use the short label: "Wild" for "Wild card"). */
function categoryTag(v: BoonView, short = false): HTMLElement {
  return h('span', { class: 'bo-meta' },
    h('span', { class: 'bo-cat' }, boonCategoryIcon(v.category, 'ico tiny'), short && v.category === 'wild' ? 'Wild' : v.categoryLabel),
    // wide cards (landscape) show the rarity here; narrow ones in the tag row (styles/boons.css)
    short && v.rarity === 'rare' ? h('span', { class: 'bo-rare-meta', attrs: { 'aria-hidden': 'true' } }, rarityIcon('rare', 'ico tiny'), v.rarityLabel) : null);
}

/** The tag row: rarity (diamond + "Rare"; commons carry none) and what the boon needs. */
function needTags(v: BoonView): HTMLElement | null {
  if (!v.needs.length && v.rarity !== 'rare') return null;
  return h('span', { class: 'bo-needs' },
    v.rarity === 'rare' ? h('span', { class: 'tag rare' }, rarityIcon('rare', 'ico tiny'), v.rarityLabel) : null,
    ...v.needs.map((n) => h('span', { class: `tag${n.have ? ' have' : ' missing'}`, text: n.have ? n.label : `Needs ${n.label}`, title: n.have ? 'Your build has this' : 'Your build lacks this: the boon does nothing without it' })));
}

/** A full row (active list, Build tab). */
export function boonRowEl(v: BoonView, note?: string | null, actions: (HTMLElement | null)[] = []): HTMLElement {
  return h('div', { class: `boon-item cat-${v.category} r-${v.rarity}` },
    h('span', { class: 'bi-ico' }, boonCategoryIcon(v.category, 'ico')),
    h('div', { class: 'bi-main' },
      h('div', { class: 'bi-name' }, h('span', { text: v.name }), categoryTag(v)),
      h('p', { class: 'bi-desc', text: v.desc }),
      needTags(v),
      note ? h('p', { class: 'bi-note', text: note }) : null),
    actions.some(Boolean) ? h('div', { class: 'bi-act' }, ...actions) : null);
}

/** The Build tab's "Active boons" section. */
export function boonsSection(ui: UiState, openOffer: () => void): HTMLElement {
  const r = ui.run, active = r.boons ?? [];
  const cap = r.boonCap || 4;
  const list = h('div', { class: 'bs-list boon-list' });
  if (r.boonOffer && r.boonOffer.length) {
    list.appendChild(button([icon('boon', 'ico'), h('span', { class: 'bs-main' }, h('span', { class: 'bs-name', text: 'A boon offer is waiting' }), h('span', { class: 'bs-sub', text: r.boonOffer.map((id) => boonName(id)).join(' · ') })), icon('right', 'ico tiny chev')],
      openOffer, { class: 'btn bs-draft boon-waiting' }));
  }
  active.forEach((id, i) => {
    const note = active.length >= cap && i === 0 ? 'Oldest: the next pick replaces it unless you choose another.' : null;
    list.appendChild(boonRowEl(boonView(id, needsBuild(ui)), note));
  });
  // nothing active: say when offers come (not while one is waiting right above)
  if (!active.length && !r.boonOffer?.length) list.appendChild(h('div', { class: 'bs-socket', text: r.mode === 'patrol' ? 'No active boons. Offers come at the start of an attempt and after each boss, in Push.' : 'No active boons. Offers come at the start of every retry and after each boss.' }));
  return h('section', { class: 'bs-section' },
    h('h3', { class: 'sec-title' }, `Active boons · ${active.length}/${cap}`,
      h('span', { class: 'sec-sub', text: 'This attempt only; at the cap a new pick replaces the oldest.' })),
    list);
}

/** Active boons: a list in a dialog (tap on the row under the top bar). */
export function openActiveBoons(ui: UiState): ModalHandle {
  const active = ui.run.boons ?? [];
  const cap = ui.run.boonCap || 4;
  const body = h('div', { class: 'boon-list' },
    h('p', { class: 'dim', text: `${active.length} of ${cap}. Boons last until this attempt ends (death, restart, Prestige; a reload is a new attempt).` }),
    ...active.map((id, i) => boonRowEl(boonView(id, needsBuild(ui)), active.length >= cap && i === 0 ? 'Oldest: replaced first at the cap.' : null)));
  return openModal({ title: 'Active boons', body, className: 'boon-modal' });
}

/**
 * The active-boon row: one category icon per boon and "n/4". Hidden with no boons. Tap: the list.
 */
export class BoonRow {
  readonly el: HTMLButtonElement;
  private readonly icons = h('span', { class: 'br-icons' });
  private readonly count = h('span', { class: 'br-count' });
  private key = '';
  constructor(private readonly ctx: UiCtx) {
    this.el = button([this.icons, this.count], () => { const ui = this.ctx.state(); if (ui && (ui.run.boons ?? []).length) openActiveBoons(ui); }, { class: 'btn ctl boon-row' });
    this.el.hidden = true;
  }
  update(ui: UiState): void {
    const active = ui.run.boons ?? [];
    const cap = ui.run.boonCap || 4;
    const key = active.join(',') + '|' + cap;
    if (key === this.key) return;
    this.key = key;
    show(this.el, active.length > 0);
    this.icons.replaceChildren(...active.map((id) => { const v = boonView(id, null); const s = h('span', { class: `br-ico cat-${v.category}`, title: v.name }, boonCategoryIcon(v.category, 'ico tiny')); return s; }));
    const sum = activeSummary(active, cap);
    text(this.count, sum.count);
    attr(this.el, 'aria-label', sum.label);
  }
}

/**
 * The offer card over the arena (and its "Boon ready" chip). Never modal: the run keeps going and the arena
 * stays tappable around it.
 */
export class BoonOffer {
  readonly el: HTMLElement;
  readonly chip: HTMLButtonElement;
  private readonly cards = h('div', { class: 'bo-cards', attrs: { role: 'group', 'aria-label': 'Boons on offer' } });
  private readonly detail = h('div', { class: 'bo-detail', attrs: { 'aria-live': 'polite' } });
  private readonly title = h('span', { class: 'bo-title' });
  private readonly queue = h('span', { class: 'bo-q' });
  private readonly heading = h('span', { class: 'bo-heading' }, this.title, this.queue);
  private readonly take: HTMLButtonElement;
  private readonly reroll: HTMLButtonElement;
  private readonly rerollCost = h('span', { class: 'price cores' });
  private readonly decline: HTMLButtonElement;
  private readonly chipQueue = h('span', { class: 'count' });
  private seq = -1;
  private selected: BoonId | null = null;
  private replace: BoonId | null = null;
  private collapsed = false;
  private key = '';
  private offer: BoonId[] = [];
  private ro: ResizeObserver | null = null;

  constructor(private readonly ctx: UiCtx) {
    this.take = button([icon('check', 'ico tiny'), 'Take'], () => this.confirm(), { class: 'btn primary bo-take' });
    // landscape phones show the icons instead of the words (styles/boons.css); the labels stay for screen readers
    this.reroll = button([icon('restart', 'ico tiny bo-ico-alt'), h('span', { class: 'bo-lbl', text: 'Reroll' }), this.rerollCost], () => this.send({ type: 'reroll_boon' }), { class: 'btn small bo-reroll' });
    this.decline = button([icon('close', 'ico tiny bo-ico-alt'), h('span', { class: 'bo-lbl', text: 'Decline' })], () => this.send({ type: 'decline_boon' }),
      { class: 'btn small ghost bo-decline', label: 'Decline: free, no boon this time', title: 'Free; you get no boon this time' });
    const collapse = button(icon('down', 'ico'), () => this.setCollapsed(true), { class: 'btn icon-btn ghost bo-collapse', label: 'Set the offer aside (it waits as a "Boon ready" chip)' });
    this.el = h('section', { class: 'boon-offer', attrs: { role: 'region', 'aria-label': 'Boon offer' } },
      this.cards, this.detail,
      h('div', { class: 'bo-foot' }, this.heading, this.take, this.reroll, this.decline, collapse));
    this.el.hidden = true;
    this.chip = button([icon('boon', 'ico tiny'), 'Boon ready', this.chipQueue], () => this.setCollapsed(false), { class: 'btn ctl boon-chip', label: 'A boon offer is waiting: show it' });
    this.chip.hidden = true;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.publishHeight());
      this.ro.observe(this.el);
    }
  }

  /** Is an offer pending (shown or set aside)? */
  get pending(): boolean { return this.offer.length > 0; }

  /** Show a set-aside offer again (Build tab, chip). */
  expand(): void { this.setCollapsed(false); }

  update(ui: UiState): void {
    const r = ui.run;
    const offer = r.boonOffer && r.boonOffer.length ? r.boonOffer : [];
    const seq = r.boonOfferSeq ?? 0;
    if (seq !== this.seq || offer.join() !== this.offer.join()) {
      // a new offer always shows itself; a reroll keeps the collapse state but clears the selection
      if (seq !== this.seq) this.collapsed = false;
      this.seq = seq;
      if (!this.selected || !offer.includes(this.selected)) this.selected = null;
      this.offer = [...offer];
    }
    const active = r.boons ?? [];
    if (this.replace && !active.includes(this.replace)) this.replace = null;
    const cost = r.boonRerollCost ?? 1;
    const key = JSON.stringify([offer, this.selected, this.collapsed, active, r.boonCap, r.cores >= cost, cost, r.boonQueueLength, r.boonOfferKind, this.replace, ui.build.hardpoints, ui.build.attunements]);
    if (key === this.key) return;
    this.key = key;
    const has = offer.length > 0;
    show(this.el, has && !this.collapsed);
    show(this.chip, has && this.collapsed);
    document.body.classList.toggle('boon-open', has && !this.collapsed);
    text(this.chipQueue, r.boonQueueLength > 0 ? `+${r.boonQueueLength}` : '');
    if (!has) { this.publishHeight(); return; }
    this.render(ui, offer, active, cost);
    this.publishHeight();
  }

  private render(ui: UiState, offer: BoonId[], active: BoonId[], cost: number): void {
    const r = ui.run, cap = r.boonCap || 4;
    clear(this.cards);
    for (const id of offer) {
      const v = boonView(id, needsBuild(ui));
      const on = id === this.selected;
      const card = button([
        categoryTag(v, true),
        h('span', { class: 'bo-name', text: v.name }),
        h('span', { class: 'bo-short', text: v.short }),
        needTags(v),
        on ? h('span', { class: 'bo-sel' }, icon('check', 'ico tiny')) : null,
      ], () => this.select(id), { class: `bo-card cat-${v.category} r-${v.rarity}${on ? ' on' : ''}` });
      attr(card, 'aria-pressed', on ? 'true' : 'false');
      attr(card, 'aria-label', `${v.name}. ${v.categoryLabel}, ${v.rarityLabel}. ${v.desc}${v.needs.filter((n) => !n.have).map((n) => ` Needs ${n.label}.`).join('')}${on ? ' Selected: press Take to pick it.' : ' Tap to select.'}`);
      this.cards.appendChild(card);
    }
    // detail: the selected card's full text, and what it replaces at the cap
    clear(this.detail);
    const sel = this.selected ? boonView(this.selected, needsBuild(ui)) : null;
    const drop = replacedBy(active, cap, this.replace);
    show(this.detail, !!sel || active.length >= cap);
    const change = (name: string): HTMLButtonElement => button('Change', () => this.chooseReplace(ui), { class: 'btn ctl bo-change', label: `Choose which active boon to replace (now ${name})` });
    const replaceText = (name: string): string => (this.replace ? `Replaces ${name}` : `Replace the oldest: ${name}`);
    if (sel) {
      // one paragraph: the full description, then (at the cap) what it replaces
      this.detail.appendChild(h('p', { class: 'bo-desc' }, h('b', { text: `${sel.name}: ` }), sel.desc,
        drop ? h('span', { class: 'bo-rep-inline', text: ` ${replaceText(boonName(drop))}.` }) : null, drop ? change(boonName(drop)) : null));
    } else if (drop) {
      const name = boonName(drop);
      this.detail.appendChild(h('p', { class: 'bo-replace' }, icon('info', 'ico tiny'), h('span', { text: replaceText(name) }), change(name)));
    }
    // footer
    const head = offerHeading(r.boonOfferKind ?? 'start', r.boonQueueLength ?? 0);
    text(this.title, head.title);
    text(this.queue, head.sub);
    show(this.heading, !sel);
    show(this.take, !!sel);
    if (sel) attr(this.take, 'aria-label', drop ? `Take ${sel.name}, replacing ${boonName(drop)}` : `Take ${sel.name}`);
    const rr = rerollState(r.cores, cost);
    this.rerollCost.replaceChildren(icon('cores', 'ico tiny'), String(rr.cost));
    this.reroll.disabled = !rr.can;
    attr(this.reroll, 'aria-label', rr.label);
    this.reroll.title = rr.can ? `Three new cards for ${rr.cost} Core${rr.cost === 1 ? '' : 's'}` : `Needs ${rr.cost} Core${rr.cost === 1 ? '' : 's'}`;
  }

  private select(id: BoonId): void {
    this.selected = this.selected === id ? null : id;
    this.key = '';
    const ui = this.ctx.state();
    if (ui) this.update(ui);
  }

  private confirm(): void {
    const ui = this.ctx.state();
    if (!ui || !this.selected) return;
    const active = ui.run.boons ?? [];
    this.send(pickCommand(this.selected, active, ui.run.boonCap || 4, this.replace));
  }

  private chooseReplace(ui: UiState): void {
    const active = ui.run.boons ?? [];
    const list = h('div', { class: 'boon-list' });
    const m = openModal({ title: 'Replace which boon?', body: list, className: 'boon-modal' });
    active.forEach((id, i) => {
      list.appendChild(boonRowEl(boonView(id, needsBuild(ui)), i === 0 ? 'Oldest' : null,
        [button(id === (this.replace ?? active[0]) ? 'Chosen' : 'Replace this', () => { this.replace = id; m.close(); this.key = ''; const s = this.ctx.state(); if (s) this.update(s); }, { class: `btn small${id === (this.replace ?? active[0]) ? ' primary' : ''}` })]));
    });
  }

  private send(cmd: Command): void {
    this.selected = null; this.replace = null; this.key = '';
    this.ctx.host.send(cmd);
  }

  private setCollapsed(on: boolean): void {
    this.collapsed = on;
    this.key = '';
    const ui = this.ctx.state();
    if (ui) this.update(ui);
  }

  /** The card's height as --boon-h (the arena overlays keep clear of it). */
  private publishHeight(): void {
    const hgt = this.el.hidden ? 0 : Math.ceil(this.el.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--boon-h', `${hgt}px`);
  }
}
