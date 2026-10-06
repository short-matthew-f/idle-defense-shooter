/**
 * Active-edge HUD widgets (docs/ACTIVE.md; sim: systems/active.ts, numbers: data/active.ts).
 *
 *  - Overcharge button (bottom-right of the arena, clear of the ability row): a ring shows the meter; when full it
 *    glows. Press and hold to charge: an arc sweeps around the button over the hold and the timing window is drawn
 *    on the ring; release inside it for the full volley (outside still fires, weaker). One thumb. Holding the tower
 *    itself does the same (app/game.ts → hold()). Hidden until Overcharge unlocks.
 *  - Salvage floaters: "+Scrap" rising from a collected crate (×chain on chains). No toasts.
 *
 * The charge arc follows the sim's hold (UiState, ≤ 10 Hz, extrapolated between updates by at most 0.15 s), so on a
 * slow device where the sim lags the wall clock the button and the in-world ring still agree with what the sim times.
 */
import '../styles/active.css';
import { ACTIVE } from '@sim/data/active';
import { Ev, type SimEvent, type UiState } from '@sim/core/types';
import { h, show, styleVar, attr, text } from './dom';
import { fmtNum } from './format';
import { markCoachSeen } from './coach';
import type { UiCtx } from './ctx';
import { prefs } from './prefs';
import { buzz } from './decision-hold';
import { gameAudio } from '../audio/index';
import { autoReleaseDue, bandEntered, GLOW_PULSE_MS } from './assist-cues';

const O = ACTIVE.overcharge;

/**
 * Overcharge unlocked by the ladder rule (progression feature `overcharge`, UNLOCKS.overcharge.wave; the sim's own rule in
 * systems/active.ts, reported as UiState.active.overcharge.unlocked). tests/app/active-tap.test.ts keeps the two equal.
 * The coach lines for the active edge live in coach.ts ('salvage', 'overcharge').
 */
export function overchargeUnlocked(ui: Pick<UiState, 'meta' | 'run'>): boolean {
  return Math.max(ui.meta.deepestEver | 0, ui.run.deepestCleared | 0) >= O.unlockWave;
}

/**
 * The button shows when the sim has unlocked Overcharge AND the ladder reveals it (ctx.features().overcharge). They agree
 * by wave; "Unlock everything" reveals the feature early, but a button the sim would ignore stays hidden until wave 12.
 */
export function overchargeShown(a: UiState['active'], featureOn: boolean): boolean {
  return !!a && a.overcharge.unlocked && featureOn;
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
  private collected = false;
  /** The sim's hold (s) at the last UiState while charging, and when it arrived: the arc follows the sim, not the wall clock. */
  private simHold = -1;
  private simHoldAt = 0;
  /** Phase 3: when the meter became ready (the glow pulses GLOW_PULSE_MS, then holds steady: class `steady`). */
  private readyAt = -1;
  private steadyTimer = 0;

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
    // a tap collect happened (only those build a chain): retire the salvage coach line even if the event batch dropped it
    if (a && a.chain > 0 && !this.collected) { this.collected = true; markCoachSeen(['salvage']); }
    this.unlocked = overchargeShown(a, this.ctx.features().overcharge);
    show(this.el, this.unlocked);
    if (!a || !this.unlocked) { if (this.charging) this.stopAnim(); return; }
    const oc = a.overcharge;
    this.ready = oc.ready;
    const f = oc.meterMax > 0 ? Math.max(0, Math.min(1, oc.meter / oc.meterMax)) : 0;
    if (!this.charging) arc(this.meter, 0, f);
    styleVar(this.btn, '--oc', f.toFixed(3));
    this.btn.classList.toggle('ready', oc.ready);
    if (oc.ready && this.readyAt < 0) {
      this.readyAt = performance.now();
      this.btn.classList.remove('steady');
      this.steadyTimer = window.setTimeout(() => { this.steadyTimer = 0; this.btn.classList.add('steady'); }, GLOW_PULSE_MS);
    } else if (!oc.ready && this.readyAt >= 0) {
      this.readyAt = -1;
      if (this.steadyTimer) { clearTimeout(this.steadyTimer); this.steadyTimer = 0; }
      this.btn.classList.remove('steady');
    }
    this.btn.classList.toggle('filling', !oc.ready && f < 1);
    attr(this.btn, 'aria-disabled', oc.ready || this.charging ? 'false' : 'true');
    if (!this.charging) text(this.label, oc.ready ? 'HOLD' : `${Math.floor(f * 100)}%`);
    // the sim may end a charge on its own (auto-release after maxHold, wave end): follow it
    if (this.charging && oc.charging) { this.simHold = oc.hold; this.simHoldAt = performance.now(); }
    if (this.charging && !oc.charging && performance.now() - this.chargeStart > 400) this.stopAnim();
  }

  /** The hold (s) the arc shows now: what the player sees when letting go (sent with the release). */
  heldSeconds(): number {
    const now = performance.now();
    return this.simHold >= 0 ? this.simHold + Math.min(0.15, (now - this.simHoldAt) / 1000) : (now - this.chargeStart) / 1000;
  }

  /** A charge is running in this widget (false once auto-release, the sim or a lift ended it). */
  get isCharging(): boolean { return this.charging; }

  /** The tower hold started (true) or ended (false) a charge (app/game.ts sends the commands). */
  hold(on: boolean): void { if (on) this.begin(); else { if (this.charging) markCoachSeen(['overcharge']); this.stopAnim(); } }

  private start(): void {
    if (!this.unlocked || !this.ready || this.charging) return;
    this.ctx.host.send({ type: 'overcharge', action: 'charge' });
    this.begin();
  }

  private end(cancelled: boolean): void {
    if (!this.charging) return;
    this.ctx.host.send(cancelled ? { type: 'overcharge', action: 'cancel' } : { type: 'overcharge', action: 'release', hold: this.heldSeconds() });
    if (!cancelled) markCoachSeen(['overcharge']);   // the player found it (also on Ev.Overcharge below)
    this.stopAnim();
  }

  private begin(): void {
    this.charging = true;
    this.chargeStart = performance.now();
    this.simHold = -1;
    this.btn.classList.add('charging');
    arc(this.meter, 0, 1);
    let prev = 0;
    const tick = (): void => {
      if (!this.charging) return;
      // the sim's hold (UiState, 10 Hz) extrapolated by at most 0.15 s, so a slow device's lagging sim and the arc agree;
      // before the first UiState of this charge, the time since the press
      const secs = this.heldSeconds();
      arc(this.charge, 0, secs / O.maxHoldSeconds);
      // Phase 3 timing cues: a tick (and a short vibration where supported) on entering the bright band; the optional
      // auto-release lets go at the top of the band through the normal release command
      if (bandEntered(prev, secs)) { gameAudio()?.director.onUiTap('toggle'); buzz(15); }
      prev = secs;
      if (autoReleaseDue(secs, prefs().overchargeAssist)) { this.end(false); return; }
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
      // doing the thing retires its coach line (coach.ts 'salvage' / 'overcharge')
      if (e.type === Ev.Overcharge) {
        markCoachSeen(['overcharge']);
        this.floater(0, -40, e.a > 0 ? 'PERFECT' : 'WEAK', true, e.a > 0 ? 'oc-perfect' : 'oc-weak');   // Phase 3: release verdict
        continue;
      }
      if (e.type !== Ev.SalvageCollect || !(e.a > 0)) continue;
      const tap = e.src === 'salvage.tap';
      if (tap) markCoachSeen(['salvage']);
      this.floater(e.x, e.y, `+${fmtNum(e.a)}${tap && e.b >= 2 ? ` ×${(Math.min(ACTIVE.salvage.chainMax, 1 + ACTIVE.salvage.chainStep * (e.b - 1))).toFixed(1).replace(/\.0$/, '')}` : ''}`, tap);
    }
  }

  private floater(wx: number, wy: number, label: string, tap: boolean, cls = ''): void {
    if (this.live >= MAX_FLOATERS || this.ctx.host.isPaused()) return;
    if (!this.floaters) {
      this.floaters = h('div', { class: 'salvage-floaters', attrs: { 'aria-hidden': 'true' } });
      (document.getElementById('ui') ?? document.body).appendChild(this.floaters);
    }
    let p: { x: number; y: number };
    try { p = this.ctx.host.touch.toClient(wx, wy); } catch { return; }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const el = h('span', { class: `salvage-floater${tap ? '' : ' passive'}${cls ? ` ${cls}` : ''}`, text: label });
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
