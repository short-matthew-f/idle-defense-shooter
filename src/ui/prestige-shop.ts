/**
 * Echo tiers shop (design §14; the code still says layers): four tiers from PRESTIGE_NODES, opening at deepest-ever
 * waves 20 / 40 / 60 / 80, priced in Echoes (×1.5 per rank), bought with `buy_prestige`.
 * Calm like Upgrades: each row shows its headline effect on one line (the row body unfolds the rest); a layer not
 * open yet folds into one line ("9 upgrades · opens at deepest wave 60"), and an open layer's maxed rows into "N maxed".
 */
import '../styles/prestige.css';
import type { UiState } from '@sim/core/types';
import type { PrestigeNodeDef } from '@sim/data/schema';
import { button, h, holdRepeat, text, disable, show, attr } from './dom';
import { icon } from './icons';
import { fmtNum, nextRankCost, splitDesc } from './format';
import { PRESTIGE_NODES } from './content';
import type { UiCtx } from './ctx';
import { ECHO_GUIDE_TEXT, echoGuideDone, echoGuideOn, echoGuidePicks, endEchoGuide } from './ceremony';
import { markCoachSeen } from './coach';
import { ECHO_TIERS, tierLabel } from './echo-tiers';

/** The four Echo tiers (echo-tiers.ts is the data; the shop lists them with their full names). */
export const LAYERS: { layer: 1 | 2 | 3 | 4; name: string; wave: number; blurb: string }[] =
  ECHO_TIERS.map((t) => ({ layer: t.layer, name: tierLabel(t.layer, true), wave: t.wave, blurb: t.blurb }));

interface Row { def: PrestigeNodeDef; el: HTMLElement; rank: HTMLElement; btn: HTMLButtonElement; price: HTMLElement; maxed: boolean }
interface Layer { layer: number; el: HTMLElement; wave: number; rows: Row[]; fold: HTMLButtonElement; label: HTMLElement; act: HTMLElement; chev: HTMLElement; open: boolean; key: string }

export class PrestigeShop {
  shown = false;
  private readonly rows: Row[] = [];
  private readonly layerEls: Layer[] = [];
  /** First-Prestige guide (ceremony.ts): an inline coach line; the affordable Layer I picks get the class `guide`. */
  private readonly guide: HTMLElement;
  readonly el: HTMLElement;

  constructor(private readonly ctx: UiCtx) {
    const ok = button('Got it', () => { endEchoGuide(); markCoachSeen(['echoes']); const ui = this.ctx.state(); if (ui) this.update(ui); }, { class: 'btn small coach-ok' });
    this.guide = h('div', { class: 'coach-banner ps-guide', attrs: { role: 'status', 'aria-live': 'polite' } },
      h('span', { class: 'coach-ico' }, icon('echo', 'ico')), h('span', { class: 'coach-text', text: ECHO_GUIDE_TEXT }), ok);
    this.guide.hidden = true;
    // the Echoes balance is in the wallet bar pinned above the screen (wallet.ts)
    this.el = h('div', { class: 'pshop' }, this.guide);
    for (const L of LAYERS) {
      const sec = h('section', { class: 'player' }, h('h3', { class: 'sec-title' }, L.name, h('span', { class: 'sec-sub', text: L.blurb })));
      const rows: Row[] = [];
      for (const def of PRESTIGE_NODES.filter((n) => n.layer === L.layer)) {
        const rank = h('span', { class: 'node-rank' });
        const price = h('span', { class: 'price echo' });
        const btn = h('button', { type: 'button', class: 'btn buy' }, price);
        holdRepeat(btn, () => ctx.host.send({ type: 'buy_prestige', node: def.id }));
        const d = splitDesc(def.desc);
        const desc = h('p', { class: 'node-desc', text: d.headline });
        const chev = icon('down', 'ico tiny node-chev');
        const main = h('div', { class: 'node-main' }, h('div', { class: 'node-head' }, h('span', { class: 'node-name', text: def.name }), rank, chev), desc);
        const el = h('div', { class: 'node' }, main, btn);
        // the headline on one line; the row body (never the Buy button) unfolds the full description
        const expandable = d.more || d.headline.length > 64;
        el.classList.toggle('expandable', expandable);
        if (!expandable) (chev as unknown as HTMLElement).style.display = 'none';
        else {
          const toggle = (): void => { const open = !el.classList.contains('open'); el.classList.toggle('open', open); desc.textContent = open ? def.desc : d.headline; main.setAttribute('aria-expanded', open ? 'true' : 'false'); };
          main.setAttribute('role', 'button'); main.tabIndex = 0; main.setAttribute('aria-expanded', 'false'); main.setAttribute('aria-label', `${def.name}: ${def.desc}`);
          main.addEventListener('click', toggle);
          main.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        }
        sec.appendChild(el);
        const row = { def, el, rank, btn, price, maxed: false };
        rows.push(row);
        this.rows.push(row);
      }
      const label = h('span', { class: 'fold-label' }), act = h('span', { class: 'fold-act' }), chev = h('span', { class: 'qmf-chev' });
      const layer: Layer = { layer: L.layer, el: sec, wave: L.wave, rows, label, act, chev, open: false, key: '',
        fold: button([icon('lock', 'ico tiny'), label, act, chev], () => { layer.open = !layer.open; layer.key = ''; const ui = this.ctx.state(); if (ui) this.update(ui); }, { class: 'btn fold-btn ps-fold' }) };
      sec.appendChild(layer.fold);
      this.layerEls.push(layer);
      this.el.appendChild(sec);
    }
  }

  get isOpen(): boolean { return this.shown; }
  setShown(on: boolean): void {
    this.shown = on;
    const ui = this.ctx.state(); if (on && ui) this.update(ui);
  }

  update(ui: UiState): void {
    if (!this.isOpen) return;
    const m = ui.meta;
    for (const L of this.layerEls) L.el.classList.toggle('closed', m.deepestEver < L.wave);
    // guided first Echo spend: never buys, only points (ends on Got it, or once nothing in Layer I is affordable)
    if (echoGuideOn() && (echoGuideDone(ui) || this.ctx.features().unlockAll)) { endEchoGuide(); markCoachSeen(['echoes']); }
    const guideOn = echoGuideOn();
    const picks = new Set(guideOn ? echoGuidePicks(ui) : []);
    show(this.guide, guideOn);
    for (const r of this.rows) {
      const rank = m.prestigeRanks[r.def.id] | 0;
      const open = m.deepestEver >= (LAYERS[r.def.layer - 1]?.wave ?? 0);
      const maxed = rank >= r.def.maxRank;
      const cost = nextRankCost(r.def.cost, rank);
      text(r.rank, r.def.maxRank > 1 ? `${rank}/${r.def.maxRank}` : rank > 0 ? 'Owned' : '');
      const label = maxed ? 'Max' : fmtNum(cost);
      if (r.price.dataset.v !== label) { r.price.dataset.v = label; r.price.replaceChildren(icon(maxed ? 'check' : 'echo', 'ico tiny'), label); }
      const can = open && !maxed && m.echoes >= cost;
      disable(r.btn, !can);
      r.el.classList.toggle('affordable', can);
      r.el.classList.toggle('guide', picks.has(r.def.id));
      r.el.classList.toggle('maxed', maxed);
      r.maxed = maxed;
      attr(r.btn, 'aria-label', maxed ? `${r.def.name}: max rank` : `Buy ${r.def.name} for ${fmtNum(cost)} Echoes`);
    }
    // folds: a layer not open yet shows one line; an open layer folds its maxed rows (the guided picks never fold)
    for (const L of this.layerEls) {
      const closed = m.deepestEver < L.wave;
      const maxed = L.rows.filter((r) => r.maxed && !picks.has(r.def.id));
      const n = closed ? L.rows.length : maxed.length;
      const key = `${closed}|${n}|${L.open}|${maxed.map((r) => r.def.id).join()}`;
      if (key === L.key) continue;
      L.key = key;
      show(L.fold, n > 0);
      for (const r of L.rows) show(r.el, L.open || (closed ? false : !maxed.includes(r)));
      text(L.label, closed ? `${n} upgrades · reach wave ${L.wave} to open ${tierLabel(L.layer)}` : `${n} maxed`);
      text(L.act, L.open ? 'Hide' : 'Show');
      L.chev.replaceChildren(icon(L.open ? 'up' : 'down', 'ico tiny chev'));
      L.fold.classList.toggle('closed', closed);
      (L.fold.firstElementChild as HTMLElement | null)?.replaceWith(icon(closed ? 'lock' : 'check', 'ico tiny'));
      attr(L.fold, 'aria-expanded', L.open ? 'true' : 'false');
      L.el.appendChild(L.fold);   // the fold line closes the layer (after any rows it opened)
    }
  }
}
