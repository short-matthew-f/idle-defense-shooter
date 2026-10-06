/**
 * The Constellation (design §15): STAR_NODES as a hand-drawn SVG graph — majors large on a
 * hexagon, Bridges as edges with a node at their midpoint, minors small on an outer ring.
 * Tap a node for details and `buy_star`. The Ascend button appears once wave 100 is cleared.
 */
import '../styles/constellation.css';
import type { UiState } from '@sim/core/types';
import type { StarNodeDef } from '@sim/data/schema';
import { button, h, text, disable, show } from './dom';
import { icon } from './icons';
import { fmtNum, nextRankCost } from './format';
import { STAR_NODES } from './content';
import { confirmDialog } from './modal';
import type { UiCtx } from './ctx';
import { fmtExactish, walletChip } from './wallet';

const SVGNS = 'http://www.w3.org/2000/svg';
const SYS = ['primary', 'ordnance', 'drones', 'blade', 'laser', 'gravitics'];

export interface StarPos { x: number; y: number; r: number }

/** The smallest touch target (css px) and the smallest node name (css px) on the map (N-14). */
export const STAR_HIT_PX = 44;
export const STAR_NAME_PX = 14;

/** Which node a tap at (x, y) picks: the nearest centre within `hit` of the point, else null. Pure. */
export function nearestStar(points: ReadonlyMap<string, { x: number; y: number }>, x: number, y: number, hit: number): string | null {
  let best: string | null = null, bd = hit * hit;
  for (const [id, p] of points) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d <= bd) { bd = d; best = id; } }
  return best;
}

/** Deterministic layout for the graph (pure; exported for reuse). */
export function layoutStars(nodes: readonly StarNodeDef[]): Map<string, StarPos> {
  const pos = new Map<string, StarPos>();
  const majors = nodes.filter((n) => n.kind2 === 'major');
  majors.forEach((n, i) => {
    const sys = n.id.split('.').pop() ?? '';
    const k = SYS.indexOf(sys) >= 0 ? SYS.indexOf(sys) : i;
    const ring = 110 + 70 * n.region;
    const a = -Math.PI / 2 + (k / Math.max(6, majors.length)) * Math.PI * 2;
    pos.set(n.id, { x: Math.cos(a) * ring, y: Math.sin(a) * ring, r: 17 });
  });
  for (const n of nodes.filter((x) => x.kind2 === 'bridge')) {
    const [a, b] = (n.requires ?? []).map((id) => pos.get(id));
    if (a && b) {
      let x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      if (Math.hypot(x, y) < 12) { x += 26; y += 14; }   // opposite majors meet at the centre: nudge
      pos.set(n.id, { x, y, r: 10 });
    } else pos.set(n.id, { x: 0, y: 0, r: 10 });
  }
  const minors = nodes.filter((x) => x.kind2 === 'minor');
  minors.forEach((n, i) => {
    const a = -Math.PI / 2 + Math.PI / 6 + (i / Math.max(1, minors.length)) * Math.PI * 2;
    const ring = 176 + 50 * n.region;
    pos.set(n.id, { x: Math.cos(a) * ring, y: Math.sin(a) * ring, r: 7 });
  });
  return pos;
}

export class ConstellationPanel {
  shown = false;
  private readonly svg: SVGSVGElement;
  private readonly nodeEls = new Map<string, SVGGElement>();
  private readonly hitEls: SVGCircleElement[] = [];
  private readonly nameEls: SVGTextElement[] = [];
  private readonly centres = new Map<string, { x: number; y: number }>();
  private scale = 0;
  private readonly detail = h('div', { class: 'star-detail' });
  private readonly dName = h('div', { class: 'sd-name' });
  private readonly dDesc = h('p', { class: 'sd-desc' });
  private readonly dRank = h('span', { class: 'node-rank' });
  private readonly dBuy: HTMLButtonElement;
  private readonly ascendWrap = h('div', { class: 'ascend' });
  private readonly ascendText = h('p', { class: 'dim' });
  private readonly ascendBtn: HTMLButtonElement;
  private selected: StarNodeDef | null = null;
  readonly el: HTMLElement;
  private readonly lockCard = h('div', { class: 'locked-card' }, icon('lock', 'ico'), h('p', { text: 'Ascension opens after beating The Crown at wave 100. It resets the climb for Stars, which buy Constellation nodes: new rules that last forever. You can explore the map now.' }));

  constructor(private readonly ctx: UiCtx) {
    const pos = layoutStars(STAR_NODES);
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('viewBox', '-240 -240 480 480');
    this.svg.setAttribute('class', 'const-svg');
    this.svg.setAttribute('role', 'group');
    this.svg.setAttribute('aria-label', 'Constellation');
    const edges = document.createElementNS(SVGNS, 'g');
    edges.setAttribute('class', 'edges');
    this.svg.appendChild(edges);
    for (const n of STAR_NODES) {
      const p = pos.get(n.id)!;
      if (n.kind2 === 'bridge') {
        for (const req of n.requires ?? []) {
          const q = pos.get(req);
          if (!q) continue;
          const l = document.createElementNS(SVGNS, 'line');
          l.setAttribute('x1', String(q.x)); l.setAttribute('y1', String(q.y)); l.setAttribute('x2', String(p.x)); l.setAttribute('y2', String(p.y));
          l.dataset.bridge = n.id;
          edges.appendChild(l);
        }
      }
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', `star ${n.kind2}`);
      g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', n.name);
      const shape = document.createElementNS(SVGNS, n.kind2 === 'bridge' ? 'rect' : 'circle');
      if (n.kind2 === 'bridge') { shape.setAttribute('x', String(-p.r)); shape.setAttribute('y', String(-p.r)); shape.setAttribute('width', String(p.r * 2)); shape.setAttribute('height', String(p.r * 2)); shape.setAttribute('transform', 'rotate(45)'); }
      else shape.setAttribute('r', String(p.r));
      // an invisible hit area, 44 css px across at any map size (fitScale); where two overlap the nearest centre wins
      const hit = document.createElementNS(SVGNS, 'circle');
      hit.setAttribute('r', String(Math.max(22, p.r + 8)));
      hit.setAttribute('class', 'hit');
      this.hitEls.push(hit);
      this.centres.set(n.id, { x: p.x, y: p.y });
      g.append(hit, shape);
      if (n.kind2 === 'major') {
        const t = document.createElementNS(SVGNS, 'text');
        t.dataset.r = String(p.r);
        t.setAttribute('y', String(p.r + 16));
        t.textContent = n.name;
        this.nameEls.push(t);
        g.appendChild(t);
      }
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(n); } });
      this.svg.appendChild(g);
      this.nodeEls.set(n.id, g);
    }
    // taps: the nearest node centre within its 44 px target (the per-node areas overlap on the dense outer ring); a click with
    // no pointer position (a screen reader's activate, Enter on the focused node) picks the node it landed on
    this.svg.addEventListener('click', (e) => {
      const g = (e.target as Element).closest?.('g.star') ?? null;
      const byEl = (): StarNodeDef | null => { for (const [id, el] of this.nodeEls) if (el === g) return STAR_NODES.find((x) => x.id === id) ?? null; return null; };
      if (e.detail === 0 || (e.clientX === 0 && e.clientY === 0)) { const n = byEl(); if (n) this.select(n); return; }
      const m = this.svg.getScreenCTM();
      if (!m) { const n = byEl(); if (n) this.select(n); return; }
      const pt = this.svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const q = pt.matrixTransform(m.inverse());
      const sc = this.scale || m.a || 1;
      const id = nearestStar(this.centres, q.x, q.y, STAR_HIT_PX / 2 / sc);
      const n = id ? STAR_NODES.find((x) => x.id === id) ?? null : null;
      if (n) this.select(n);
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.fitScale()).observe(this.svg);
    this.dBuy = button('Buy', () => { if (this.selected) ctx.host.send({ type: 'buy_star', node: this.selected.id }); }, { class: 'btn primary' });
    this.detail.append(h('div', { class: 'node-head' }, this.dName, this.dRank), this.dDesc, this.dBuy);
    this.ascendBtn = button([icon('ascension'), 'Ascend…'], async () => {
      const ui = ctx.state(); if (!ui) return;
      const gain = starsFor(ui.run.deepestCleared, ui.meta.ascension);
      const ok = await confirmDialog('Ascend?', `Ascension resets waves, Scrap, Cores, upgrades and Anomalies, and pays ${fmtNum(gain)} Stars. Echoes, Prestige upgrades, the Codex, Trial rewards, Frames and Stars stay; every Star spent in the Constellation is refunded (a free respec). Enemies grow stronger and new rules unlock.`, 'Ascend',
        { danger: true, wallet: walletChip(['stars'], ui, (u) => (gain > 0 ? `+${fmtNum(gain)} → ${fmtExactish(u.meta.stars + gain)} after Ascending` : '')) });
      if (ok) { ctx.host.send({ type: 'ascend' }); ctx.host.saveNow(); }
    }, { class: 'btn primary wide' });
    this.ascendWrap.append(this.ascendText, this.ascendBtn);
    // the Stars balance is in the wallet bar pinned above the screen (wallet.ts)
    this.el = h('div', { class: 'constellation' }, this.lockCard,
      h('div', { class: 'const-legend dim small' }, h('span', { class: 'lg major' }, '● Major: a system'), h('span', { class: 'lg bridge' }, '◆ Bridge: cross-system rule'), h('span', { class: 'lg minor' }, '• Minor: numbers')),
      this.svg, this.detail, this.ascendWrap);
    this.select(STAR_NODES[0] ?? null);
  }

  get isOpen(): boolean { return this.shown; }

  /** Size the hit areas and names in css px, whatever the map's width: the viewBox is 480 units across. */
  private fitScale(): void {
    const w = this.svg.getBoundingClientRect().width;
    if (!(w > 0)) return;
    const sc = w / 480;
    if (Math.abs(sc - this.scale) < 0.002) return;
    this.scale = sc;
    for (const c of this.hitEls) c.setAttribute('r', (STAR_HIT_PX / 2 / sc).toFixed(1));
    for (const t of this.nameEls) {
      t.setAttribute('style', `font-size:${(STAR_NAME_PX / sc).toFixed(1)}px;stroke-width:${(3 / sc).toFixed(1)}px`);
      t.setAttribute('y', ((Number(t.dataset.r) || 17) + (4 + STAR_NAME_PX) / sc).toFixed(1));
    }
  }

  setShown(on: boolean): void {
    this.shown = on;
    if (on) requestAnimationFrame(() => this.fitScale());
    const ui = this.ctx.state(); if (on && ui) this.update(ui);
  }

  private select(n: StarNodeDef | null): void {
    this.selected = n;
    for (const [id, g] of this.nodeEls) g.classList.toggle('selected', id === n?.id);
    const ui = this.ctx.state();
    if (ui) this.update(ui, true);
  }

  update(ui: UiState, force = false): void {
    if (!this.isOpen && !force) return;
    const m = ui.meta;
    for (const n of STAR_NODES) {
      const g = this.nodeEls.get(n.id)!;
      const rank = m.constellation[n.id] | 0;
      const reqOk = (n.requires ?? []).every((r) => (m.constellation[r] | 0) > 0);
      g.classList.toggle('owned', rank > 0);
      g.classList.toggle('maxed', rank >= n.maxRank);
      g.classList.toggle('reachable', reqOk);
      g.setAttribute('aria-label', `${n.name}, rank ${rank} of ${n.maxRank}`);
    }
    for (const l of this.svg.querySelectorAll<SVGLineElement>('line[data-bridge]')) l.classList.toggle('lit', (m.constellation[l.dataset.bridge!] | 0) > 0);
    const s = this.selected;
    show(this.detail, !!s);
    if (s) {
      const rank = m.constellation[s.id] | 0;
      const cost = nextRankCost(s.cost, rank);
      const maxed = rank >= s.maxRank;
      const reqOk = (s.requires ?? []).every((r) => (m.constellation[r] | 0) > 0);
      const region = regionLock(s, m.ascension);   // Reachability: the sim sells a region from Ascension region+1
      text(this.dName, s.name);
      text(this.dRank, `${rank}/${s.maxRank}`);
      text(this.dDesc, s.desc + (reqOk ? '' : ` Requires: ${(s.requires ?? []).map((r) => STAR_NODES.find((x) => x.id === r)?.name ?? r).join(' and ')}.`) + (region ? ` ${region}.` : ''));
      text(this.dBuy, maxed ? 'Maxed' : region ? 'Locked' : `Buy · ${fmtNum(cost)} Stars`);
      disable(this.dBuy, maxed || !reqOk || !!region || m.stars < cost);
    }
    const can = ui.run.deepestCleared >= 100;
    show(this.lockCard, !can && m.ascension === 0);
    text(this.ascendText, can ? `The Crown has fallen. Ascension ${m.ascension + 1} is open.` : `Ascension opens after beating The Crown at wave 100 (deepest this Prestige: ${ui.run.deepestCleared}). Ascensions so far: ${m.ascension}.`);
    show(this.ascendBtn, can);
  }
}

/** Why a Constellation node cannot be bought yet because of its region (revealed at Ascension region + 1), or null. */
export function regionLock(n: Pick<StarNodeDef, 'region'>, ascension: number): string | null {
  return n.region >= ascension ? `Region revealed at Ascension ${n.region + 1}` : null;
}

function starsFor(D: number, A: number): number { return Math.floor(4 * (1 + A) * Math.pow(1.1, D - 100)); }
