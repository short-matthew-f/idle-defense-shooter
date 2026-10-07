/**
 * The first-session Upgrade button (progressive reveal, stages 0–3): one big glowing button on Battle that
 * buys the next stat of the three basic ones (Damage, Fire Rate, Hull) and says why in one line
 * (progression.ts starterPick). After the first purchase the three stats appear under it as a small list,
 * each tappable. It gives way to the ability bar at stage 4; by then Upgrades has everything.
 */
import '../styles/starter.css';
import type { ShopEntry, UiState } from '@sim/core/types';
import { button, h, show, text, attr, disable, holdRepeat } from './dom';
import { icon } from './icons';
import { fmtDuration, fmtNum, fmtStatChange } from './format';
import { STARTER_NODES, contentPool, poolShop, starterPick, type Features, type StarterPick, type StarterState } from './progression';
import { nextPurchase } from './advice';
import { cheapestAffordable, statLine } from './shop';
import type { UiCtx } from './ctx';

/** Visible while the ability bar is not (and never with Unlock everything). */
export function starterVisible(f: Pick<Features, 'abilities' | 'unlockAll'>): boolean {
  return !f.abilities && !f.unlockAll;
}

/** The starter button's second line: "Damage 13 → 15" (sim before → after), else "Damage · Lv 2". Pure. */
export function starterWhat(p: Pick<StarterPick, 'label' | 'entry'>): string {
  const e = p.entry, next = e.statAfter?.[0];
  if (e.statNow === undefined || next === undefined) return `${p.label} · Lv ${e.rank + 1}`;
  return `${p.label} ${fmtStatChange(e.statNow, next, e.statUnit ?? '', { digits: 0, rel: false })}`;
}

export class StarterPanel {
  readonly el: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private readonly what = h('span', { class: 'st-what' });
  private readonly price = h('span', { class: 'price scrap' });
  private readonly why = h('p', { class: 'st-why' });
  private readonly list = h('div', { class: 'st-list', attrs: { role: 'group', 'aria-label': 'Upgrades' } });
  private readonly rows = new Map<string, { b: HTMLButtonElement; rank: HTMLSpanElement; price: HTMLSpanElement }>();
  private pick: StarterPick | null = null;
  private key = '';

  constructor(private readonly ctx: UiCtx, private readonly rate: () => number) {
    this.btn = button([h('span', { class: 'st-main' }, icon('upgrade', 'ico'), h('span', { class: 'st-label', text: 'Upgrade' })), h('span', { class: 'st-sub' }, this.what, this.price)],
      () => {}, { class: 'btn primary st-btn' });
    this.btn.dataset.hint = 'upgrade';   // pointer hints (hints.ts)
    // tap buys one; holding keeps buying (the same touch rules as every Buy button: a swipe never buys)
    holdRepeat(this.btn, () => this.buy());
    for (const s of STARTER_NODES) {
      const rank = h('span', { class: 'st-rank' });
      const price = h('span', { class: 'price scrap' });
      const b = button([h('span', { class: 'st-name', text: s.label }), rank, price], () => {}, { class: 'btn st-item' });
      holdRepeat(b, () => { const e = this.ctx.state()?.shop.find((x) => x.node === s.node); if (e && e.affordable && !e.locked && e.rank < e.maxRank) this.ctx.host.send({ type: 'buy', node: e.node }); });
      this.rows.set(s.node, { b, rank, price });
      this.list.appendChild(b);
    }
    this.el = h('div', { class: 'starter' }, this.btn, this.why, this.list);
    this.el.hidden = true;
  }

  private buy(): void {
    const p = this.pick;
    if (p && p.affordable) this.ctx.host.send({ type: 'buy', node: p.entry.node });
  }

  update(ui: UiState, f: Features): void {
    const on = starterVisible(f);
    show(this.el, on);
    document.body.classList.toggle('starter-on', on);
    if (!on) return;
    const p = starterPick(ui, this.rate());
    this.pick = p;
    show(this.btn, !!p);
    const eta = p && !p.affordable && p.eta ? ` ~${fmtDuration(p.eta)}` : '';
    const key = p ? `${p.entry.node}|${p.entry.rank}|${p.entry.cost}|${p.affordable}|${p.why}|${eta}|${starterWhat(p)}` : '';
    if (key !== this.key) {
      this.key = key;
      if (p) {
        text(this.what, starterWhat(p));
        this.price.replaceChildren(icon('scrap', 'ico tiny'), fmtNum(p.entry.cost), eta);
        text(this.why, p.why);
        this.btn.classList.toggle('ready', p.affordable);
        disable(this.btn, !p.affordable);
        attr(this.btn, 'aria-label', p.affordable ? `Upgrade ${p.label} to ${p.entry.rank + 1} for ${fmtNum(p.entry.cost)} Scrap. ${p.why}` : `Upgrade: ${p.label} costs ${fmtNum(p.entry.cost)} Scrap${eta ? `, in about ${fmtDuration(p.eta ?? 0)}` : ''}`);
      } else text(this.why, '');
    }
    // the three stats, once the first one is bought
    let owned = 0;
    for (const s of STARTER_NODES) owned += ui.build.ranks[s.node] | 0;
    const listOn = owned > 0 && !f.upgradesTab;
    show(this.list, listOn);
    if (!listOn) return;
    for (const s of STARTER_NODES) {
      const r = this.rows.get(s.node)!;
      const e = ui.shop.find((x) => x.node === s.node);
      show(r.b, !!e);
      if (!e) continue;
      const maxed = e.rank >= e.maxRank;
      text(r.rank, String(e.rank));
      const pk = maxed ? 'max' : String(e.cost);
      if (r.price.dataset.v !== pk) { r.price.dataset.v = pk; r.price.replaceChildren(...(maxed ? ['Max'] : [icon('scrap', 'ico tiny'), fmtNum(e.cost)])); }
      r.b.classList.toggle('affordable', e.affordable && !maxed);
      disable(r.b, maxed || !!e.locked || !e.affordable);
      attr(r.b, 'aria-label', maxed ? `${s.label}: max` : `${s.label} rank ${e.rank}: buy rank ${e.rank + 1} for ${fmtNum(e.cost)} Scrap`);
    }
  }
}

/** Chip-width names (about 8 characters fit beside a two-slot ability row at 375 px): the long stat labels, shortened. */
export const CHIP_LABELS: Readonly<Record<string, string>> = {
  'Shot speed': 'Shot spd', 'Crit chance': 'Crit %', 'Crit damage': 'Crit dmg', 'Shield recharge': 'Shld rchg',
  'All fire rate': 'All rate', 'Cooldown cut': 'CD cut', 'Scrap gain': 'Scrap +', 'Resistance': 'Resist',
};
export const chipLabel = (label: string): string => CHIP_LABELS[label] ?? label;

/** What the Battle dock's quick-buy chip offers (pure): an affordable starter stat first (it knows about pressure and
 * hull), else the cheapest affordable Scrap upgrade in the pool, else the next thing to save for. */
export function quickPick(ui: StarterState, pooled: readonly ShopEntry[]): { entry: ShopEntry; label: string; affordable: boolean } | null {
  const sp = starterPick(ui);
  if (sp?.affordable) return { entry: sp.entry, label: sp.label, affordable: true };
  const c = cheapestAffordable(pooled, 1)[0];
  if (c) return { entry: c, label: c.statLabel ?? c.name, affordable: true };
  if (sp) return { entry: sp.entry, label: sp.label, affordable: false };
  const n = nextPurchase(pooled, ui.run.scrap, 0);
  return n ? { entry: n.entry, label: n.entry.statLabel ?? n.entry.name, affordable: false } : null;
}

/**
 * Quick-buy chip in the Battle dock (stage 4 on, where the big Upgrade button gives way to the ability bar): the next
 * suggested buy and its price; one tap buys one rank, holding keeps buying. Lives inside the dock (abilities.ts),
 * left of the ability row, so it never takes an overlay lane.
 */
export class QuickBuyChip {
  readonly el: HTMLButtonElement;
  private readonly name = h('span', { class: 'qb-name' });
  private readonly price = h('span', { class: 'price scrap' });
  private pick: ReturnType<typeof quickPick> = null;
  private key = '';

  constructor(private readonly ctx: UiCtx) {
    this.el = button([h('span', { class: 'qb-text' }, this.name, this.price)], () => {}, { class: 'btn quick-buy' });
    this.el.dataset.hint = 'quick-buy';
    holdRepeat(this.el, () => { const p = this.pick; if (p && p.affordable) this.ctx.host.send({ type: 'buy', node: p.entry.node }); });
    this.el.hidden = true;
  }

  update(ui: UiState, f: Features): void {
    const on = f.abilities && !starterVisible(f);
    const p = on ? quickPick(ui, poolShop(ui.shop, contentPool(ui, { content: f.allContent }))) : null;
    this.pick = p;
    show(this.el, !!p);
    if (!p) return;
    const e = p.entry;
    const key = `${e.node}|${e.rank}|${e.cost}|${p.affordable}|${p.label}`;
    if (key === this.key) return;
    this.key = key;
    text(this.name, chipLabel(p.label));
    this.price.replaceChildren(icon('scrap', 'ico tiny'), fmtNum(e.cost));
    this.el.classList.toggle('ready', p.affordable);
    disable(this.el, !p.affordable);
    const change = statLine(e, 1);
    attr(this.el, 'aria-label', p.affordable ? `Quick buy ${e.name}${change ? `: ${change}` : ''} for ${fmtNum(e.cost)} Scrap` : `Next buy: ${e.name}, ${fmtNum(e.cost)} Scrap (not enough yet)`);
  }
}
