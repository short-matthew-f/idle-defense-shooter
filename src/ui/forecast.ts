/**
 * Prestige Forecast (design §3): Echoes now, Echo rate with its peak, next boss projection,
 * reclimb estimate, wall gauge, a hand-drawn SVG of the rate curve with the peak marked, the
 * "Prestige recommended" banner, and the Prestige button.
 */
import '../styles/forecast.css';
import type { UiState } from '@sim/core/types';
import { button, h, show, text, attr } from './dom';
import { icon } from './icons';
import { echoesFor, fmtDuration, fmtNum } from './format';
import { chartGeometry } from './chart';
import type { UiCtx } from './ctx';

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

interface Readout { el: HTMLElement; val: HTMLElement; sub: HTMLElement }
function readout(label: string, hint: string): Readout {
  const val = h('div', { class: 'ro-val' }), sub = h('div', { class: 'ro-sub' });
  return { el: h('div', { class: 'readout', title: hint }, h('div', { class: 'ro-label', text: label }), val, sub), val, sub };
}

export class ForecastPanel {
  /** Set by the shell while the Prestige screen shows the Forecast. */
  shown = false;
  private readonly bannerText = h('span', { text: 'Prestige recommended: your Echo rate has passed its peak.' });
  private readonly banner = h('div', { class: 'recommend', attrs: { role: 'status' } }, icon('prestige', 'ico'), this.bannerText);
  private readonly locked = h('p', { class: 'note' });
  private readonly echoesNow = readout('Echoes now', 'Echoes if you Prestige this second');
  private readonly rate = readout('Echo rate', 'Echoes now ÷ hours since this Prestige began');
  private readonly next = readout('Next boss', 'Projected Echoes and rate after the next checkpoint');
  private readonly reclimb = readout('Reclimb', 'Time a new Prestige would need to reach this depth');
  private readonly wall = readout('Wall gauge', 'Time until the next affordable behaviour-changing unlock at current income');
  private readonly chart = svg('svg', { viewBox: '0 0 320 120', class: 'fc-chart', role: 'img', 'aria-label': 'Echo rate over time' });
  private readonly line = svg('path', { class: 'fc-line' });
  private readonly area = svg('path', { class: 'fc-area' });
  private readonly peakDot = svg('circle', { r: '4', class: 'fc-peak' });
  private readonly peakLbl = svg('text', { class: 'fc-peak-lbl' });
  private readonly nowDot = svg('circle', { r: '3', class: 'fc-now' });
  private readonly axis = h('div', { class: 'fc-axis' });
  private readonly prestigeBtn: HTMLButtonElement;
  private chartKey = '';
  private readonly chartWrap: HTMLElement;
  readonly el: HTMLElement;

  constructor(private readonly ctx: UiCtx) {
    this.chart.append(svg('line', { x1: '6', y1: '114', x2: '314', y2: '114', class: 'fc-base' }), this.area, this.line, this.peakDot, this.peakLbl, this.nowDot);
    this.chartWrap = h('div', { class: 'fc-chart-wrap' }, this.chart, this.axis);
    this.prestigeBtn = button([icon('prestige'), 'Prestige…'], () => ctx.open('prestige'), { class: 'btn primary wide' });
    this.el = h('div', { class: 'forecast' },
      this.banner, this.locked,
      h('div', { class: 'readouts' }, this.echoesNow.el, this.rate.el, this.next.el, this.reclimb.el, this.wall.el),
      this.chartWrap,
      h('p', { class: 'dim small', text: 'Lifetime Echoes are maximized by resetting when the rate curve peaks. Nothing decays if you stay.' }),
      this.prestigeBtn);
  }

  get isOpen(): boolean { return this.shown; }
  setShown(on: boolean): void {
    this.shown = on;
    const ui = this.ctx.state();
    if (on && ui) this.update(ui);
  }

  update(ui: UiState): void {
    if (!this.isOpen) return;
    const f = ui.forecast;
    show(this.banner, !!f?.recommended);
    // Onboarding pass (docs/BALANCE.md): name the wall. Past the Frontier enemies harden fast; a Prestige moves it.
    text(this.bannerText, f?.frontier !== undefined && f.nextFrontier !== undefined && ui.run.deepestCleared >= f.frontier - 2
      ? `Prestige recommended: past wave ${f.frontier} (the Frontier) enemies harden fast. Prestige for ${fmtNum(f.echoesNow)} Echoes and the Frontier moves to wave ${f.nextFrontier}.`
      : 'Prestige recommended: your Echo rate has passed its peak.');
    const early = ui.run.deepestCleared < 20;
    show(this.locked, !f || early);
    show(this.chartWrap, !!f && f.curve.length > 1);
    const est = echoesFor(ui.run.deepestCleared, ui.run.threatDial);
    text(this.locked, early ? `Echoes are paid from wave 20 on: the Forecast becomes meaningful once you clear wave 20 (deepest this Prestige: ${ui.run.deepestCleared}).` : 'Forecast data is not available yet.');
    text(this.echoesNow.val, fmtNum(f?.echoesNow ?? est));
    text(this.echoesNow.sub, `Deepest cleared: wave ${ui.run.deepestCleared}${f?.frontier !== undefined && f.frontier <= 100 ? ` · Frontier: wave ${f.frontier}` : ''}`);
    text(this.rate.val, f ? `${fmtNum(f.echoRate)}/h` : '—');
    text(this.rate.sub, f ? `Peak ${fmtNum(f.peakRate)}/h` : '');
    text(this.next.val, f ? `+${fmtNum(Math.max(0, f.nextBossEchoes - f.echoesNow))}` : '—');
    text(this.next.sub, f ? `${fmtNum(f.nextBossEchoes)} total · ${fmtNum(f.nextBossRate)}/h` : '');
    text(this.reclimb.val, f ? fmtDuration(f.reclimbSeconds) : '—');
    text(this.reclimb.sub, f ? `vs ${fmtDuration(ui.run.playSeconds)} this run` : '');
    const wg = f?.wallGaugeSeconds ?? ui.wallGaugeSeconds;
    text(this.wall.val, wg === null || wg === undefined ? 'None in reach' : fmtDuration(wg));
    text(this.wall.sub, wg === null || wg === undefined ? 'Only stat ranks remain' : 'to the next new behaviour');
    this.wall.el.classList.toggle('warn', wg === null || wg === undefined);

    const curve = f?.curve ?? [];
    const key = curve.length + ':' + (curve[curve.length - 1]?.rate ?? 0);
    if (key !== this.chartKey) {
      this.chartKey = key;
      const g = chartGeometry(curve, 320, 120);
      attr(this.line, 'd', g.d || 'M0,0');
      attr(this.area, 'd', g.area || 'M0,0');
      const on = !!g.peak;
      this.peakDot.style.display = on ? '' : 'none';
      this.nowDot.style.display = on ? '' : 'none';
      this.peakLbl.style.display = on ? '' : 'none';
      if (g.peak && g.last) {
        attr(this.peakDot, 'cx', String(g.peak.x)); attr(this.peakDot, 'cy', String(g.peak.y));
        attr(this.nowDot, 'cx', String(g.last.x)); attr(this.nowDot, 'cy', String(g.last.y));
        // anchor the label away from the chart edge it is near, so "peak 25K/h" is never clipped
        const right = g.peak.x > 200;
        attr(this.peakLbl, 'x', String(right ? Math.min(314, g.peak.x - 6) : Math.max(8, g.peak.x + 6)));
        attr(this.peakLbl, 'text-anchor', right ? 'end' : 'start');
        attr(this.peakLbl, 'y', String(Math.max(12, g.peak.y - 8)));
        this.peakLbl.textContent = `peak ${fmtNum(g.peak.rate)}/h`;
      }
      text(this.axis, curve.length ? `0 → ${fmtDuration(g.maxSeconds)} · max ${fmtNum(g.maxRate)}/h` : 'The rate curve appears after wave 20.');
    }
    this.prestigeBtn.classList.toggle('pulse', !!f?.recommended);
  }
}
