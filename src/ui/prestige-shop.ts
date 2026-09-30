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
import type { UiCtx } from './ctx';
import { ECHO_GUIDE_TEXT, echoGuideDone, echoGuideOn, echoGuidePicks, endEchoGuide } from './ceremony';
import { markCoachSeen } from './coach';

export const LAYERS: { layer: 1 | 2 | 3 | 4; name: string; wave: number; blurb: string }[] = [
  { layer: 1, name: 'Prestige I: Inheritance', wave: 20, blurb: 'Compress content you have mastered.' },
  { layer: 2, name: 'Prestige II: Arsenal Memory', wave: 40, blurb: 'Plan builds instead of rebuilding them.' },
  { layer: 3, name: 'Prestige III: Command Network', wave: 60, blurb: 'Program the machine.' },
  { layer: 4, name: 'Prestige IV: Evolution', wave: 80, blurb: 'Build strange engines.' },
];

interface Row { def: PrestigeNodeDef; el: HTMLElement; rank: HTMLElement; btn: HTMLButtonElement; price: HTMLElement }

export class PrestigeShop {
  shown = false;
  private readonly echoes = h('span', { class: 'echo-val' });
  private readonly rows: Row[] = [];
  private readonly layerEls: { el: HTMLElement; lock: HTMLElement; wave: number }[] = [];
  /** First-Prestige guide (ceremony.ts): an inline coach line; the affordable Layer I picks get the class `guide`. */
  private readonly guide: HTMLElement;
  readonly el: HTMLElement;

  constructor(private readonly ctx: UiCtx) {
    const ok = button('Got it', () => { endEchoGuide(); markCoachSeen(['echoes']); const ui = this.ctx.state(); if (ui) this.update(ui); }, { class: 'btn small coach-ok' });
    this.guide = h('div', { class: 'coach-banner ps-guide', attrs: { role: 'status', 'aria-live': 'polite' } },
      h('span', { class: 'coach-ico' }, icon('echo', 'ico')), h('span', { class: 'coach-text', text: ECHO_GUIDE_TEXT }), ok);
    this.guide.hidden = true;
    this.el = h('div', { class: 'pshop' }, this.guide, h('div', { class: 'pr-gain' }, icon('echo', 'ico'), this.echoes, h('span', { class: 'dim', text: ' Echoes' })));
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
    text(this.echoes, fmtNum(m.echoes));
    for (const L of this.layerEls) { const open = m.deepestEver >= L.wave; show(L.lock, !open); L.el.classList.toggle('closed', !open); }
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
      attr(r.btn, 'aria-label', maxed ? `${r.def.name}: max rank` : `Buy ${r.def.name} for ${fmtNum(cost)} Echoes`);
    }
  }
}
