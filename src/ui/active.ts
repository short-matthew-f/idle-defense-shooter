/**
 * Active-edge HUD widgets (docs/ACTIVE.md; sim: systems/active.ts, numbers: data/active.ts).
 *
 *  - Overcharge button (bottom-right of the arena, clear of the ability row): a ring shows the meter; when full it
 *    glows. Press and hold to charge: an arc sweeps around the button over the hold and the timing window is drawn
 *    on the ring; release inside it for the full volley (outside still fires, weaker). One thumb. Holding the tower
 *    itself does the same (app/game.ts → hold()). Hidden until Overcharge unlocks.
 *  - Salvage floaters: "+Scrap" rising from a collected crate (×chain on chains). No toasts.
 *
 * The charge arc animates locally from the press time (the sim counts the hold in real seconds, so the two agree);
 * UiState (≤ 10 Hz) only says whether the meter is ready and how full it is.
 */
import '../styles/active.css';
import { ACTIVE } from '@sim/data/active';
import { Ev, type SimEvent, type UiState } from '@sim/core/types';
import { h, show, styleVar, attr, text } from './dom';
import { fmtNum } from './format';
import type { UiCtx } from './ctx';

const O = ACTIVE.overcharge;

/** Coach lines (the coach is wired elsewhere; these are the strings). */
export const COACH_OVERCHARGE_UNLOCK = 'Overcharge online: your shots fill the ring. When it glows, press and hold, then let go as the arc reaches the bright band.';
export const COACH_OVERCHARGE_READY = 'Overcharge ready: hold the button (or the tower) and release in the bright band.';
export const COACH_SALVAGE = 'Salvage crates drift to the tower. Tap them for a Scrap burst; quick taps chain up to ×3. Missed crates still pay a little.';
export const COACH_ASSIST = 'Tap an enemy: the tower fires a bonus shot at it.';

/** Overcharge unlocked for the UI (progression feature `overcharge`): the same rule as the sim (systems/active.ts). */
export function overchargeUnlocked(ui: UiState): boolean {
  return Math.max(ui.meta.deepestEver | 0, ui.run.deepestCleared | 0) >= O.unlockWave;
}

/** Where the hold is relative to the window: 'early' | 'perfect' | 'late' (pure; tests). */
export function holdZone(seconds: number): 'early' | 'perfect' | 'late' {
  return seconds < O.perfectFrom ? 'early' : seconds <= O.perfectTo ? 'perfect' : 'late';
}

const RING_R = 25;
const CIRC = 2 * Math.PI * RING_R;
const MAX_FLOATERS = 8;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Arc of the ring from fraction a to b (0 = top, clockwise) as a stroke-dasharray / offset pair. */
function arc(el: SVGCircleElement, a: number, b: number): void {
  const len = Math.max(0, Math.min(1, b) - Math.max(0, a)) * CIRC;
  el.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${CIRC.toFixed(2)}`);
  el.setAttribute('stroke-dashoffset', (-Math.max(0, a) * CIRC).toFixed(2));
}

export class ActiveWidget {
  /** Mounted in the battle layer (a small box: the battle layer passes pointer events to its children). */
  readonly el: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private readonly meter: SVGCircleElement;
  private readonly window: SVGCircleElement;
  private readonly charge: SVGCircleElement;
  private readonly label: HTMLSpanElement;
  private floaters: HTMLElement | null = null;
  private live = 0;
  private charging = false;
  private chargeStart = 0;
  private raf = 0;
  private ready = false;
  private unlocked = false;

  constructor(private readonly ctx: UiCtx) {
    const s = svg('svg', { viewBox: '0 0 64 64', class: 'oc-ring', 'aria-hidden': 'true' });
    const track = svg('circle', { cx: 32, cy: 32, r: RING_R, class: 'oc-track' });
    this.meter = svg('circle', { cx: 32, cy: 32, r: RING_R, class: 'oc-meter' });
    // the hold maps onto the ring: a full turn = maxHold seconds; the window is its bright band
    this.window = svg('circle', { cx: 32, cy: 32, r: RING_R, class: 'oc-window' });
    this.charge = svg('circle', { cx: 32, cy: 32, r: RING_R, class: 'oc-charge' });
    arc(this.window, O.perfectFrom / O.maxHoldSeconds, O.perfectTo / O.maxHoldSeconds);
    arc(this.charge, 0, 0);
    arc(this.meter, 0, 0);
    s.append(track, this.meter, this.window, this.charge);
    this.label = h('span', { class: 'oc-label', text: 'OC' });
    this.btn = h('button', { class: 'btn oc-btn', attrs: { type: 'button', 'aria-label': 'Overcharge: hold, release in the bright band' } }, s, this.label);
    this.el = h('div', { class: 'oc-wrap' }, this.btn);
    this.el.hidden = true;
    const b = this.btn;
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      this.start();
    });
    b.addEventListener('pointerup', () => this.end(false));
    b.addEventListener('pointercancel', () => this.end(true));
    b.addEventListener('lostpointercapture', () => this.end(true));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === 'o') && !e.repeat) { e.preventDefault(); this.start(); } });
    b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === 'o') { e.preventDefault(); this.end(false); } });
  }

  update(ui: UiState): void {
    const a = ui.active;
    this.unlocked = !!a && overchargeUnlocked(ui);
    show(this.el, this.unlocked);
    if (!a || !this.unlocked) return;
    const oc = a.overcharge;
    this.ready = oc.ready;
    const f = oc.meterMax > 0 ? Math.max(0, Math.min(1, oc.meter / oc.meterMax)) : 0;
    if (!this.charging) arc(this.meter, 0, f);
    styleVar(this.btn, '--oc', f.toFixed(3));
    this.btn.classList.toggle('ready', oc.ready);
    this.btn.classList.toggle('filling', !oc.ready && f < 1);
    attr(this.btn, 'aria-disabled', oc.ready || this.charging ? 'false' : 'true');
    if (!this.charging) text(this.label, oc.ready ? 'HOLD' : `${Math.floor(f * 100)}%`);
    // the sim may end a charge on its own (auto-release after maxHold, wave end): follow it
    if (this.charging && !oc.charging && performance.now() - this.chargeStart > 400) this.stopAnim();
  }

  /** The tower hold started (true) or ended (false) a charge (app/game.ts sends the commands). */
  hold(on: boolean): void { if (on) this.begin(); else this.stopAnim(); }

  private start(): void {
    if (!this.unlocked || !this.ready || this.charging) return;
    this.ctx.host.send({ type: 'overcharge', action: 'charge' });
    this.begin();
  }

  private end(cancelled: boolean): void {
    if (!this.charging) return;
    this.ctx.host.send({ type: 'overcharge', action: cancelled ? 'cancel' : 'release' });
    this.stopAnim();
  }

  private begin(): void {
    this.charging = true;
    this.chargeStart = performance.now();
    this.btn.classList.add('charging');
    arc(this.meter, 0, 1);
    const tick = (): void => {
      if (!this.charging) return;
      const secs = (performance.now() - this.chargeStart) / 1000;
      arc(this.charge, 0, secs / O.maxHoldSeconds);
      const zone = holdZone(secs);
      this.btn.dataset.zone = zone;
      text(this.label, zone === 'perfect' ? 'NOW' : zone === 'late' ? 'LATE' : '…');
      if (secs >= O.maxHoldSeconds) { this.stopAnim(); return; }   // the sim releases on its own
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopAnim(): void {
    this.charging = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.btn.classList.remove('charging');
    delete this.btn.dataset.zone;
    arc(this.charge, 0, 0);
  }

  /** Salvage floaters for collected crates (tap: bright, with the chain; passive: small and dim). */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type !== Ev.SalvageCollect || !(e.a > 0)) continue;
      const tap = e.src === 'salvage.tap';
      this.floater(e.x, e.y, `+${fmtNum(e.a)}${tap && e.b >= 2 ? ` ×${(Math.min(ACTIVE.salvage.chainMax, 1 + ACTIVE.salvage.chainStep * (e.b - 1))).toFixed(1).replace(/\.0$/, '')}` : ''}`, tap);
    }
  }

  private floater(wx: number, wy: number, label: string, tap: boolean): void {
    if (this.live >= MAX_FLOATERS || this.ctx.host.isPaused()) return;
    if (!this.floaters) {
      this.floaters = h('div', { class: 'salvage-floaters', attrs: { 'aria-hidden': 'true' } });
      (document.getElementById('ui') ?? document.body).appendChild(this.floaters);
    }
    let p: { x: number; y: number };
    try { p = this.ctx.host.touch.toClient(wx, wy); } catch { return; }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const el = h('span', { class: `salvage-floater${tap ? '' : ' passive'}`, text: label });
    el.style.left = `${p.x.toFixed(1)}px`;
    el.style.top = `${p.y.toFixed(1)}px`;
    this.floaters.appendChild(el);
    this.live++;
    let gone = false;
    const done = (): void => { if (gone) return; gone = true; el.remove(); this.live--; };
    el.addEventListener('animationend', done);
    window.setTimeout(done, 1300);   // reduced motion (no animation) or a hidden tab
  }
}
