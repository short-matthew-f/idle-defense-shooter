/**
 * Pointer layer: a soft pulsing ring that lands on the exact control the current coach banner is about (the banner
 * TELLS in a sentence, the ring SHOWS where). Mounted once in the UI root, above the screens and the tab bar, below
 * modals; `pointer-events: none`, so it never takes a tap.
 *
 *   Pointer      point(target, opts) / clear(). The target is a `data-hint` key (or an element); it is re-resolved and
 *                re-measured on resize, scroll, relayout and every UI tick (rAF-throttled, following a moving control for
 *                a few frames), and the ring hides while the target is not displayed or is covered. A short label may
 *                ride on the ring and fades after a few seconds. Reduced motion (the OS or Settings → Graphics): a static,
 *                thicker ring, no pulse.
 *   ringBox      pure: target rect → ring box (≥ 44 px, inside the safe area); labelBox places the label (tested).
 *   HintDriver   glue: gathers the hint context from the live UI each tick, asks hints.ts `nextHint`, points, and
 *                retires hints (prefs.hintsDone) when their condition ends, their final target is tapped, or "Got it"
 *                is tapped on their banner.
 */
import '../styles/pointer.css';
import type { UiState } from '@sim/core/types';
import { gfxSettings, onGfxChange, reducedMotion, systemReducedMotion } from '@render/quality';
import { h } from './dom';
import { prefs, setPref } from './prefs';
import { ABILITIES, ABILITY_BY_ID } from './content';
import { STARTER_NODES, features as featuresOf, stageOf, starterPick, type Features } from './progression';
import { starterVisible } from './starter';
import { allHints, finishedHints, initialHintsDone, nextHint, registerHint, type Hint, type HintCtx, type HintScreen } from './hints';

// ---------------------------------------------------------------- pure geometry

export interface Rect { left: number; top: number; width: number; height: number }
export interface Insets { top: number; right: number; bottom: number; left: number }
export interface RingBox { left: number; top: number; width: number; height: number; radius: number }
export interface LabelBox { left: number; top: number; side: 'above' | 'below' | 'inside' }

/** Smallest ring (a touch target's size), and the gap between a control and its ring (the ring never covers it). */
export const RING_MIN = 44;
export const RING_PAD = 6;

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The ring for a target rect in a vw × vh viewport: the rect grown by `pad` on every side, at least `min` square,
 * centred on the target, clipped to the safe area (then grown back to `min` away from the edge it touches).
 * null when the target has no size or lies wholly off screen.
 */
export function ringBox(r: Rect, vw: number, vh: number, safe: Insets, o: { pad?: number; min?: number; radius?: number } = {}): RingBox | null {
  const pad = o.pad ?? RING_PAD, min = o.min ?? RING_MIN;
  if (!(r.width > 0) || !(r.height > 0)) return null;
  if (r.left + r.width <= 0 || r.top + r.height <= 0 || r.left >= vw || r.top >= vh) return null;
  let aL = safe.left, aR = vw - safe.right, aT = safe.top, aB = vh - safe.bottom;
  if (aR - aL < min) { aL = 0; aR = vw; }
  if (aB - aT < min) { aT = 0; aB = vh; }
  const axis = (start: number, size: number, lo: number, hi: number): [number, number] => {
    const c = start + size / 2, s = Math.max(size + 2 * pad, min);
    let a = Math.max(c - s / 2, lo), b = Math.min(c + s / 2, hi);
    if (b - a < min) { if (a <= lo + 0.5) b = Math.min(hi, a + min); else a = Math.max(lo, b - min); }
    return [a, b];
  };
  const [L, R] = axis(r.left, r.width, aL, aR);
  const [T, B] = axis(r.top, r.height, aT, aB);
  const w = R - L, hh = B - T;
  const radius = Math.min((o.radius ?? 12) + pad, Math.min(w, hh) / 2);
  return { left: r1(L), top: r1(T), width: r1(w), height: r1(hh), radius: r1(radius) };
}

/** Where a lw × lh label sits: above the ring if it fits in the safe area, else below, else inside its top edge. */
export function labelBox(ring: RingBox, lw: number, lh: number, vw: number, vh: number, safe: Insets, gap = 6): LabelBox {
  const aL = safe.left + 4, aR = vw - safe.right - 4, aT = safe.top, aB = vh - safe.bottom;
  const left = Math.max(aL, Math.min(aR - lw, ring.left + ring.width / 2 - lw / 2));
  const above = ring.top - gap - lh;
  if (above >= aT) return { left: r1(left), top: r1(above), side: 'above' };
  const below = ring.top + ring.height + gap;
  if (below + lh <= aB) return { left: r1(left), top: r1(below), side: 'below' };
  return { left: r1(left), top: r1(ring.top + gap), side: 'inside' };
}

// ---------------------------------------------------------------- targets

type Resolver = string | (() => Element | Rect | null);
/**
 * Targets owned by other modules, by key: a selector (tried after `[data-hint="key"]`) or a function returning an
 * element or a client rect (a rect is drawn as is, with no cover test: e.g. a spot on the canvas).
 */
const TARGETS = new Map<string, Resolver>([
  ['upgrade', '.starter .st-btn'],
  ['boon-chip', '.boon-chip'],
  ['build-boon', '.screen.s-build .boon-waiting'],
  ['overcharge', '.oc-btn'],
  ['quartermaster-toggle', '.qm-card .qm-master'],
  ['field', fieldSpot],
]);

/** Map a hint key to a selector or resolver (for controls whose module has no `data-hint`). */
export function registerHintTarget(key: string, r: Resolver): void { TARGETS.set(key, r); }

/** "Tap the field": a spot in the upper-middle of the arena (clear of the tower at its centre). */
function fieldSpot(): Rect | null {
  const b = document.querySelector('.battle-layer')?.getBoundingClientRect();
  if (!b || b.width <= 0 || b.height <= 0) return null;
  const s = 72;
  return { left: b.left + b.width / 2 - s / 2, top: b.top + b.height * 0.28 - s / 2, width: s, height: s };
}

const isRect = (v: unknown): v is Rect => !!v && typeof (v as Rect).width === 'number' && !(v instanceof Element);

/** Displayed and not covered: some sample point of its box hit-tests to it (the ring and label never hit-test). */
function onScreen(el: Element): DOMRect | null {
  if (!el.isConnected || el.closest('[hidden]')) return null;
  const b = el.getBoundingClientRect();
  if (b.width <= 0 || b.height <= 0) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]]) {
    const x = b.left + b.width * fx, y = b.top + b.height * fy;
    if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) return b;
  }
  return null;
}

/** The visible element (or rect) for a hint key, or null. */
export function resolveTarget(key: string): { el: Element | null; rect: Rect } | null {
  const cands: Element[] = [...document.querySelectorAll(`[data-hint="${CSS.escape(key)}"]`)];
  const r = TARGETS.get(key);
  if (typeof r === 'string') cands.push(...document.querySelectorAll(r));
  for (const el of cands) { const b = onScreen(el); if (b) return { el, rect: b }; }
  if (typeof r === 'function') {
    const v = r();
    if (v instanceof Element) { const b = onScreen(v); return b ? { el: v, rect: b } : null; }
    if (isRect(v)) return { el: null, rect: v };
  }
  return null;
}

// ---------------------------------------------------------------- the ring

export interface PointOpts { text?: string; id?: string }

/** How long the attached label stays before it fades (the banner keeps the full sentence). */
export const LABEL_MS = 4500;

export class Pointer {
  readonly el: HTMLElement;
  private readonly ring = h('div', { class: 'hint-ring', attrs: { 'aria-hidden': 'true' } });
  private readonly label = h('div', { class: 'hint-label', attrs: { 'aria-hidden': 'true' } });
  private readonly probe = h('div', { class: 'hint-probe' });
  private key: string | Element | null = null;
  private opts: PointOpts = {};
  private raf = 0;
  private follow = 0;
  private last = '';
  private labelTimer = 0;
  /** The element the ring is on (null: none, or a rect target). */
  targetEl: Element | null = null;
  /** The ring is on screen. */
  visible = false;
  /** Called once each time a hint's ring appears (the driver counts it as shown). */
  onShown: ((id: string) => void) | null = null;

  constructor() {
    this.el = h('div', { class: 'hint-layer' }, this.probe, this.ring, this.label);
    this.ring.hidden = true;
    this.label.hidden = true;
    const sched = (): void => this.schedule();
    window.addEventListener('resize', sched, { passive: true });
    document.addEventListener('scroll', sched, { passive: true, capture: true });
    window.visualViewport?.addEventListener('resize', sched, { passive: true });
    const motion = (): void => { this.el.classList.toggle('still', reducedMotion(gfxSettings().motion, systemReducedMotion())); };
    motion();
    onGfxChange(motion);
    try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', motion); } catch { /* old Safari */ }
  }

  /** Point at a `data-hint` key or an element. Same target and label: only re-measures. */
  point(target: string | Element, opts: PointOpts = {}): void {
    const same = target === this.key && opts.id === this.opts.id && opts.text === this.opts.text;
    this.key = target;
    this.opts = opts;
    if (!same) {
      this.last = '';
      this.ring.dataset.hintId = opts.id ?? '';
      this.ring.dataset.hintTarget = typeof target === 'string' ? target : '';
      this.label.textContent = opts.text ?? '';
      this.label.classList.remove('faded');
      clearTimeout(this.labelTimer);
      if (opts.text) this.labelTimer = window.setTimeout(() => this.label.classList.add('faded'), LABEL_MS);
      this.visible = false;
      // replay the entrance for a new target
      this.ring.classList.remove('in'); void this.ring.offsetWidth; this.ring.classList.add('in');
    }
    this.schedule();
  }

  clear(): void {
    this.key = null;
    this.opts = {};
    this.targetEl = null;
    this.visible = false;
    this.last = '';
    clearTimeout(this.labelTimer);
    this.ring.hidden = true;
    this.label.hidden = true;
    delete this.ring.dataset.hintId;
  }

  get pointing(): boolean { return this.key !== null; }

  /** Re-measure on the next frame (resize, scroll, relayout, UI tick). */
  schedule(): void {
    if (this.raf || !this.key) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.measure(); });
  }

  private safe(): Insets {
    const s = getComputedStyle(this.probe);
    const px = (v: string): number => parseFloat(v) || 0;
    return { top: px(s.paddingTop), right: px(s.paddingRight), bottom: px(s.paddingBottom), left: px(s.paddingLeft) };
  }

  private measure(): void {
    const k = this.key;
    if (!k) return;
    const t = typeof k === 'string' ? resolveTarget(k) : (() => { const b = onScreen(k); return b ? { el: k, rect: b } : null; })();
    const vw = window.innerWidth, vh = window.innerHeight, safe = this.safe();
    let radius = 12;
    if (t?.el) { const br = parseFloat(getComputedStyle(t.el).borderTopLeftRadius); if (Number.isFinite(br)) radius = Math.min(br, 999); }
    const box = t ? ringBox(t.rect, vw, vh, safe, { radius }) : null;
    this.targetEl = t?.el ?? null;
    if (!box) {
      this.ring.hidden = true; this.label.hidden = true; this.visible = false; this.last = '';
      return;
    }
    const key = `${box.left},${box.top},${box.width},${box.height}`;
    const moved = key !== this.last;
    this.last = key;
    const rs = this.ring.style;
    rs.transform = `translate(${box.left}px, ${box.top}px)`;
    rs.width = `${box.width}px`;
    rs.height = `${box.height}px`;
    rs.borderRadius = `${box.radius}px`;
    this.ring.hidden = false;
    if (this.opts.text) {
      this.label.hidden = false;
      const lb = labelBox(box, this.label.offsetWidth, this.label.offsetHeight, vw, vh, safe);
      this.label.style.transform = `translate(${lb.left}px, ${lb.top}px)`;
      this.label.dataset.side = lb.side;
    } else this.label.hidden = true;
    if (!this.visible) { this.visible = true; if (this.opts.id) this.onShown?.(this.opts.id); }
    // follow a moving control (a sliding screen, a list settling) for a few frames
    if (moved && this.follow < 30) { this.follow++; this.schedule(); } else if (!moved) this.follow = 0;
  }
}

// ---------------------------------------------------------------- extensions: Quartermaster, Overcharge

/** The Quartermaster coach line's id (ceremony.ts QM_COACH_ID; a string here so hints need no import of it). */
export const QM_COACH = 'qm-on';
registerHintTarget('qm-turn-on', `.coach-banner[data-coach="${QM_COACH}"] .coach-act`);
/**
 * After the first Prestige, while the Quartermaster is off: its banner's "Turn on" on Battle, else the switch on its
 * card (top of Upgrades). The phase-2 card may carry `data-hint="quartermaster-toggle"`; `.qm-card .qm-master` otherwise.
 */
registerHint({
  id: 'quartermaster', prio: 80, coach: QM_COACH, feature: 'quartermaster', kind: 'event',
  when: (ui) => (ui.meta.prestigeCount | 0) >= 1 && !!ui.quartermaster?.unlocked && !ui.quartermaster.on,
  step: (_ui, c) => (c.nav.battle && c.coach.current === QM_COACH ? { target: 'qm-turn-on', text: 'Tap to turn it on', final: true }
    : c.nav.screen === 'upgrades' ? { target: 'quartermaster-toggle', text: 'Turn on the Quartermaster', final: true }
    : { target: 'tab-upgrades', text: 'Open Upgrades', final: false }),
});
/** Overcharge full (its banner is up, or read): the button. Salvage crates are drawn on the canvas: no DOM target (see report). */
registerHint({
  id: 'overcharge', prio: 90, coach: 'overcharge', feature: 'overcharge', kind: 'reveal',
  when: (_ui, c) => c.f.overcharge && !!c.live.overchargeReady,
  step: (_ui, c) => (c.nav.battle ? { target: 'overcharge', text: 'Hold, release in the bright band', final: true } : null),
});

// ---------------------------------------------------------------- the driver

/** What the driver reads from the live UI (GameUi wires these). */
export interface HintSources {
  nav(): { screen: HintScreen | null; battle: boolean };
  shop(): { cat: string; tree: string };
  /** The coach banner that is current (coach.ts CoachBanner.current). */
  coach(): string | null;
  /** A modal, draft or death card is open. */
  blocked(): boolean;
  armed(): boolean;
  boonChip(): boolean;
  draftWaiting(): boolean;
}

const MIN_ABILITY_COST = Math.min(...ABILITIES.map((a) => a.cost));

function markDone(ids: readonly string[]): void {
  try {
    const done = new Set(prefs().hintsDone);
    const n = done.size;
    for (const id of ids) done.add(id);
    if (done.size !== n) setPref('hintsDone', [...done]);
  } catch { /* prefs unavailable: hints simply show again */ }
}

let liveDriver: HintDriver | null = null;

/** Help → "Replay hints": every hint may point again (where its condition still holds). */
export function replayHints(): void {
  try { setPref('hintsDone', []); setPref('hintsInit', true); } catch { /* ignore */ }
  liveDriver?.replay();
}

export class HintDriver {
  readonly pointer = new Pointer();
  private readonly shown = new Set<string>();
  private cur: Hint | null = null;
  private ui: UiState | null = null;
  private f: Features | null = null;
  private raf = 0;

  constructor(root: HTMLElement, private readonly src: HintSources) {
    root.appendChild(this.pointer.el);
    liveDriver = this;
    this.pointer.onShown = (id) => this.shown.add(id);
    document.addEventListener('click', (e) => this.onClick(e), true);
  }

  /** Every UiState (≤ 10 Hz) with the features as shown. */
  update(ui: UiState, f: Features): void {
    this.ui = ui;
    this.f = f;
    this.run();
  }

  /** Recompute on the next frame (navigation, a banner closed). */
  refresh(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.run(); });
  }

  /** Help → "Replay hints" (replayHints): forget this session's shown hints and point again. */
  replay(): void {
    this.shown.clear();
    this.refresh();
  }

  private ctx(ui: UiState, f: Features): HintCtx {
    let owned = 0;
    for (const s of STARTER_NODES) owned += ui.build.ranks[s.node] | 0;
    const ab = ui.build.abilities[0];
    const cost = ab ? (ui.abilities.find((a) => a.id === ab)?.cost ?? ABILITY_BY_ID.get(ab)?.cost ?? 0) : MIN_ABILITY_COST;
    const p = prefs();
    return {
      f, enabled: p.pointerHints !== false, unlockAll: f.unlockAll,
      done: new Set(p.hintsDone), visited: new Set(p.tabsVisited),
      coach: { current: this.src.coach(), seen: new Set(p.coachSeen) },
      nav: this.src.nav(), shop: this.src.shop(),
      blocked: this.src.blocked() || document.body.classList.contains('touch-testing'),
      armed: this.src.armed(),
      live: {
        starterReady: starterVisible(f) && !!starterPick(ui)?.affordable,
        starterOwned: owned,
        ceReady: ui.tower.ce >= cost && cost > 0,
        boonChip: this.src.boonChip(),
        draftWaiting: this.src.draftWaiting(),
        buyAll: !!resolveTarget('buy-all'),
        overchargeReady: !!ui.active?.overcharge.ready,
      },
    };
  }

  private run(): void {
    const ui = this.ui, f = this.f;
    if (!ui || !f) return;
    try {
      if (!prefs().hintsInit) {
        // first run on this device: an existing save starts with the hints of what it already has retired
        setPref('hintsInit', true);
        markDone(initialHintsDone(featuresOf(ui), stageOf(ui)));
      }
      let c = this.ctx(ui, f);
      const over = finishedHints(this.shown, ui, c);
      if (over.length) { markDone(over); for (const id of over) this.shown.delete(id); c = { ...c, done: new Set(prefs().hintsDone) }; }
      const next = nextHint(ui, c, (t) => !!resolveTarget(t));
      this.cur = next;
      if (!next) { this.pointer.clear(); return; }
      this.pointer.point(next.target, { text: next.text, id: next.id });
    } catch {
      this.pointer.clear();
    }
  }

  private onClick(e: Event): void {
    const t = e.target instanceof Element ? e.target : null;
    const cur = this.cur;
    if (!t) return;
    const ok = t.closest('.coach-banner .coach-ok');
    if (ok && cur) {
      // "Got it" on a banner clears its ring (the hint pointing for it retires)
      const coach = (ok.closest('.coach-banner') as HTMLElement | null)?.dataset.coach;
      if (coach && allHints().find((d) => d.id === cur.id)?.coach === coach) { markDone([cur.id]); this.pointer.clear(); this.cur = null; }
    } else if (cur && this.pointer.targetEl && this.pointer.targetEl.contains(t)) {
      // tapping the target clears the ring at once; the last step of a chain retires the hint
      if (cur.final) markDone([cur.id]);
      this.pointer.clear();
      this.cur = null;
    }
    this.refresh();
  }
}
