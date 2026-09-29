/**
 * Prestige layers shop (design §14): four layers from PRESTIGE_NODES, opening at deepest-ever
 * waves 20 / 40 / 60 / 80, priced in Echoes (×1.5 per rank), bought with `buy_prestige`.
 */
import '../styles/prestige.css';
import type { UiState } from '@sim/core/types';
import type { PrestigeNodeDef } from '@sim/data/schema';
import { button, h, holdRepeat, text, disable, show, attr } from './dom';
import { icon } from './icons';
import { fmtNum, nextRankCost } from './format';
import { PRESTIGE_NODES } from './content';
import { openModal, type ModalHandle } from './modal';
import type { UiCtx } from './ctx';

export const LAYERS: { layer: 1 | 2 | 3 | 4; name: string; wave: number; blurb: string }[] = [
  { layer: 1, name: 'Prestige I: Inheritance', wave: 20, blurb: 'Compress content you have mastered.' },
  { layer: 2, name: 'Prestige II: Arsenal Memory', wave: 40, blurb: 'Plan builds instead of rebuilding them.' },
  { layer: 3, name: 'Prestige III: Command Network', wave: 60, blurb: 'Program the machine.' },
  { layer: 4, name: 'Prestige IV: Evolution', wave: 80, blurb: 'Build strange engines.' },
];

interface Row { def: PrestigeNodeDef; el: HTMLElement; rank: HTMLElement; btn: HTMLButtonElement; price: HTMLElement }

export class PrestigeShop {
  private modal: ModalHandle | null = null;
  private readonly echoes = h('span', { class: 'echo-val' });
  private readonly rows: Row[] = [];
  private readonly layerEls: { el: HTMLElement; lock: HTMLElement; wave: number }[] = [];
  private readonly body: HTMLElement;

  constructor(private readonly ctx: UiCtx) {
    this.body = h('div', { class: 'pshop' }, h('div', { class: 'pr-gain' }, icon('echo', 'ico'), this.echoes, h('span', { class: 'dim', text: ' Echoes' })));
    for (const L of LAYERS) {
      const lock = h('p', { class: 'node-lock', text: `Opens when your deepest-ever wave reaches ${L.wave}.` });
      const sec = h('section', { class: 'player' }, h('h3', { class: 'sec-title' }, L.name, h('span', { class: 'sec-sub', text: L.blurb })), lock);
      for (const def of PRESTIGE_NODES.filter((n) => n.layer === L.layer)) {
        const rank = h('span', { class: 'node-rank' });
        const price = h('span', { class: 'price echo' });
        const btn = h('button', { type: 'button', class: 'btn buy' }, price);
        holdRepeat(btn, () => ctx.host.send({ type: 'buy_prestige', node: def.id }));
        const el = h('div', { class: 'node' }, h('div', { class: 'node-main' }, h('div', { class: 'node-head' }, h('span', { class: 'node-name', text: def.name }), rank), h('p', { class: 'node-desc', text: def.desc })), btn);
        sec.appendChild(el);
        this.rows.push({ def, el, rank, btn, price });
      }
      this.layerEls.push({ el: sec, lock, wave: L.wave });
      this.body.appendChild(sec);
    }
  }

  get isOpen(): boolean { return !!this.modal?.open; }
  open(): void {
    if (this.isOpen) return;
    this.modal = openModal({ title: 'Prestige upgrades', body: this.body, variant: 'wide', className: 'pshop-modal', onClose: () => { this.modal = null; } });
    const ui = this.ctx.state(); if (ui) this.update(ui);
  }

  update(ui: UiState): void {
    if (!this.isOpen) return;
    const m = ui.meta;
    text(this.echoes, fmtNum(m.echoes));
    for (const L of this.layerEls) { const open = m.deepestEver >= L.wave; show(L.lock, !open); L.el.classList.toggle('closed', !open); }
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
      r.el.classList.toggle('maxed', maxed);
      attr(r.btn, 'aria-label', maxed ? `${r.def.name}: max rank` : `Buy ${r.def.name} for ${fmtNum(cost)} Echoes`);
    }
  }
}
