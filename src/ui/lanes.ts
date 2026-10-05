/**
 * Overlay lanes: one place decides where every transient overlay on Battle goes, so none covers the tower (its hold
 * zone: a touch there charges Overcharge), the dock (the Upgrade button and its line, the ability buttons and the armed
 * hint, Overcharge), the HUD, or another overlay. The regions ("slots") are measured from the live layout and the arena
 * the camera drew (UiHost.arena):
 *
 *   phone, desktop   B  the band under the tower's hold zone and above the dock (stacked from the bottom: thumb first)
 *                    T  the band under the arena-top column (boss bar, run controls, boon chip, death card) and above the
 *                       tower's hold zone (stacked from the top)
 *   landscape phone  S  the side lane left of the arena, beside or above the left control column (from the bottom)
 *                    T  above the tower, right of S;   B  under the tower, right of S and left of Overcharge
 *
 * The arena-top column always ends above the tower (the death card shrinks and scrolls inside it). The boon offer card
 * takes B (S on a landscape phone) and scrolls when taller than the room (never under MIN_OFFER). Then, in priority
 * order: the armed hint on a landscape phone (T), the coach banner (its whole sentence where it fits, else one line,
 * else it waits), the toasts (as many as fit, in the slot that fits most; the rest wait their turn in the Feed). While the
 * attention plan gives the death card the lane (attention.ts: death first, the offer held as its chip) the card goes
 * whole into the roomiest slot before the coach. Every
 * overlay keeps its own look; only its position, width cap and height cap are written, and only when they change.
 * Off Battle (a phone tab covers the arena) nothing is managed: the CSS defaults put the toasts above the tab bar.
 *
 * planLanes is the pure part (tests/ui/lanes.test.ts). tests/e2e/overlap.mjs checks the result in a real browser.
 */
import type { ArenaGeom } from './host';
import type { ShellLayout } from './shell-logic';
import type { CoachBanner } from './coach';
import type { DeathCard } from './death';
import { FEED_MAX_SHOWN, type Feed } from './feed';
import { attr, h, styleVar } from './dom';

// ---------------------------------------------------------------- pure planning

/** Space between stacked overlays and between an overlay and what it keeps clear of (px). */
export const LANE_GAP = 8;
/** The boon offer is never squeezed below this (it scrolls instead): it is the player's pending decision. */
export const MIN_OFFER = 96;
/** The death card shows whole (scrolling) only with room for its headline, the line under it and one suggestion. */
export const MIN_DEATH = 140;

export interface LaneSlot { id: string; room: number }
/** `minH`: a scrollable card that fits with at least this much room (it is then capped at the room). */
export interface LaneOpt { slot: string; h: number; compact?: boolean; minH?: number }
export type LaneItem =
  /** One box: the first option with room wins; with a `floor` it is always placed (in opts[0], capped, scrolling). */
  | { id: string; kind: 'card'; opts: LaneOpt[]; floor?: number }
  /** A list (toasts): as many as fit, in order, in the slot (of `slots`) that fits the most; ties go to the first. */
  | { id: string; kind: 'stack'; slots: string[]; hs: Readonly<Record<string, readonly number[]>> };
export interface LanePlacement { slot: string; h: number; compact: boolean; count: number }

/** How many of `hs` (in order) stack into `room` with `gap` between them. */
export function fitCount(hs: readonly number[], room: number, gap: number): number {
  let used = 0, n = 0;
  for (const x of hs) {
    const need = used + (n ? gap : 0) + x;
    if (need > room + 0.5) break;
    used = need; n++;
  }
  return n;
}

/**
 * Place `items` (highest priority first) into `slots`. Each placement uses its height plus a gap of the slot's room.
 * Returns, per item id, where it goes (null: it waits).
 */
export function planLanes(slots: readonly LaneSlot[], items: readonly LaneItem[], gap = LANE_GAP): Record<string, LanePlacement | null> {
  const room = new Map(slots.map((s) => [s.id, Math.max(0, s.room)]));
  const use = (slot: string, hh: number): void => { room.set(slot, Math.max(0, (room.get(slot) ?? 0) - hh - gap)); };
  const out: Record<string, LanePlacement | null> = {};
  for (const it of items) {
    if (it.kind === 'card') {
      const o = it.opts.find((x) => room.has(x.slot) && Math.min(x.h, x.minH ?? x.h) <= (room.get(x.slot) ?? 0) + 0.5);
      if (o) { const hh = Math.min(o.h, room.get(o.slot) ?? 0); out[it.id] = { slot: o.slot, h: hh, compact: !!o.compact, count: 1 }; use(o.slot, hh); continue; }
      const first = it.opts.find((x) => room.has(x.slot));
      if (it.floor !== undefined && first) {
        const hh = Math.min(first.h, Math.max(room.get(first.slot) ?? 0, it.floor));
        out[it.id] = { slot: first.slot, h: hh, compact: !!first.compact, count: 1 };
        use(first.slot, hh);
        continue;
      }
      out[it.id] = null;
    } else {
      let best: { slot: string; n: number; used: number } | null = null;
      for (const s of it.slots) {
        if (!room.has(s)) continue;
        const hs = it.hs[s] ?? [];
        const n = fitCount(hs, room.get(s) ?? 0, gap);
        if (!best || n > best.n) best = { slot: s, n, used: hs.slice(0, n).reduce((a, b) => a + b, 0) + Math.max(0, n - 1) * gap };
      }
      if (!best) { out[it.id] = null; continue; }
      out[it.id] = { slot: best.slot, h: best.used, compact: false, count: best.n };
      if (best.n) use(best.slot, best.used);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the DOM driver

interface Box { l: number; t: number; r: number; b: number }
interface Slot extends Box { id: 'B' | 'T' | 'S'; from: 'top' | 'bottom' }

export interface LaneParts {
  battle: HTMLElement;
  arenaTop: HTMLElement;
  death: DeathCard;
  offer: HTMLElement;
  coach: CoachBanner;
  feed: Feed;
  starter: HTMLElement;
  row: HTMLElement;
  armHint: HTMLElement;
  oc: HTMLElement;
}
export interface LaneSources {
  arena(): ArenaGeom | null;
  layout(): ShellLayout;
  /** The arena is on screen (phone: the Battle tab; desktop: always). */
  battleVisible(): boolean;
}

const shown = (el: Element): boolean => !el.closest('[hidden]') && el.getClientRects().length > 0 && el.getBoundingClientRect().height > 0;
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
const px = (v: number): string => `${Math.round(v)}px`;

export class OverlayLanes {
  private raf = 0;
  private readonly probe = h('div', { class: 'lane-probe', attrs: { 'aria-hidden': 'true' } });
  /** The last placement (tests and the e2e overlap check read it). */
  plan: Record<string, LanePlacement | null> = {};

  constructor(private readonly p: LaneParts, private readonly src: LaneSources) {
    p.battle.appendChild(this.probe);
    p.feed.onChange = () => this.schedule();
    p.coach.onChange = () => this.schedule();
    p.death.onChange = () => this.schedule();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.schedule());
      for (const el of [p.offer, p.death.el, p.starter, p.row, p.armHint, p.oc, p.arenaTop]) ro.observe(el);
    }
    window.addEventListener('resize', () => this.schedule(), { passive: true });
  }

  /** Re-fit on the next frame (a toast, a banner, a resize). */
  schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.apply(true); });
  }

  private lastSig = '';

  /** What the placement depends on, read without writing (the 10 Hz refresh skips the measuring when it is unchanged). */
  private signature(): string {
    const P = this.p, r = (el: Element): string => { const b = el.getBoundingClientRect(); return `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)},${Math.round(b.height)}`; };
    const a = this.src.arena();
    return [this.src.layout(), this.src.battleVisible(), innerWidth, innerHeight, r(P.battle), a ? `${Math.round(a.cx)},${Math.round(a.cy)},${Math.round(a.r)}` : '-',
      P.offer.hidden ? '-' : P.offer.scrollHeight, P.coach.el.hidden ? '-' : `${P.coach.el.dataset.coach}|${P.coach.shrunk}|${P.coach.el.textContent?.length}`,
      P.death.el.hidden ? '-' : `${P.death.folded}|${P.death.wantFull}|${P.death.first}|${P.death.el.scrollHeight}`, P.feed.el.childElementCount,
      r(P.row), r(P.starter), r(P.oc), r(P.armHint), ...[...P.arenaTop.children].map(r)].join(';');
  }

  private safe(): { top: number; right: number; bottom: number; left: number } {
    const s = getComputedStyle(this.probe);
    const v = (x: string): number => parseFloat(x) || 0;
    return { top: v(s.paddingTop), right: v(s.paddingRight), bottom: v(s.paddingBottom), left: v(s.paddingLeft) };
  }

  /** Nothing managed: every overlay falls back to its CSS position (off Battle on phones). */
  private reset(): void {
    const { arenaTop, offer, coach, feed, armHint } = this.p;
    for (const k of ['bottom']) styleVar(arenaTop, k, '');
    for (const el of [offer, coach.el, feed.el, armHint, this.p.death.el]) for (const k of ['top', 'bottom', 'left', 'right', 'width', 'max-width', 'max-height', 'position', 'transform']) styleVar(el, k, '');
    coach.el.classList.remove('lane-wait', 'compact');
    this.p.death.el.classList.remove('lane-wait', 'lane-folded', 'dc-tight');
    offer.classList.remove('narrow', 'thin');
    feed.fit(FEED_MAX_SHOWN);
    this.plan = {};
  }

  /** Place everything (`force`: even when nothing it depends on seems to have changed). */
  apply(force = false): void {
    const sig = this.signature();
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    const P = this.p;
    const L = this.src.layout();
    const bb = P.battle.getBoundingClientRect();
    if (!this.src.battleVisible() || !(bb.height > 0) || !(bb.width > 0)) { this.reset(); return; }
    const G = LANE_GAP, M = 8, vh = window.innerHeight, vw = window.innerWidth;
    const safe = this.safe();
    const cl = Math.max(bb.left, safe.left) + M, cr = Math.min(bb.right, vw - safe.right) - M;
    const cb = Math.min(bb.bottom, vh - safe.bottom) - M;
    const a = this.src.arena();
    const hasArena = !!a && a.r > 0 && a.cy > bb.top && a.cy < bb.bottom;
    const holdT = hasArena ? a!.cy - a!.hold - G : bb.top + bb.height * 0.45;
    const holdB = hasArena ? a!.cy + a!.hold + G : holdT;

    // 1. the arena-top column (boss bar, run controls + boon chip) ends above the tower when its content allows
    const kids = [...P.arenaTop.children].filter((c) => shown(c));
    let need = 8;
    kids.forEach((c, i) => { need += c.getBoundingClientRect().height + (i ? G : 0); });
    styleVar(P.arenaTop, 'bottom', px(bb.bottom - Math.max(holdT, bb.top + need)));

    // 2. the dock and the slots
    const row = shown(P.row) ? boxOf(P.row) : null;
    const st = shown(P.starter) ? boxOf(P.starter.querySelector('.st-btn') ?? P.starter) : null;
    const stAll = shown(P.starter) ? boxOf(P.starter) : null;
    const oc = shown(P.oc) ? boxOf(P.oc) : null;
    const hint = shown(P.armHint) ? boxOf(P.armHint) : null;
    /** The lowest edge of the arena-top column's content (the boss bar, each run control) inside the x-range [l, r]. */
    const tops = kids.flatMap((c) => (c.classList.contains('arena-strip') ? [...c.querySelectorAll(':scope > *, .battle-controls > *')].filter((x) => !x.matches('.battle-controls') && shown(x)) : [c]));
    const topEdge = (l: number, r: number): number => {
      let y = bb.top + M;
      for (const c of tops) { const b = boxOf(c); if (b.r > l && b.l < r) y = Math.max(y, b.b); }
      return y + G;
    };
    const slots: Slot[] = [];
    if (L === 'rail') {
      const ax = hasArena ? a!.cx - a!.r - G : cl + (cr - cl) * 0.3;
      let s: Box;
      if (stAll) s = { l: cl, r: Math.max(ax, stAll.r), t: 0, b: stAll.t - G };          // above the Upgrade panel
      else s = { l: row ? row.r + G : cl, r: ax, t: 0, b: cb };                         // beside the ability column
      s.t = topEdge(s.l, s.r);
      slots.push({ id: 'S', ...s, from: 'bottom' });
      const l2 = Math.max(cl, s.r + G);
      slots.push({ id: 'T', l: l2, r: cr, t: topEdge(l2, cr), b: holdT, from: 'top' });
      slots.push({ id: 'B', l: l2, r: oc ? Math.min(cr, oc.l - G) : cr, t: holdB, b: cb, from: 'bottom' });
    } else {
      const dockTop = Math.min(cb + G, ...[row, st, hint, oc].filter((x): x is Box => !!x).map((x) => x.t));
      slots.push({ id: 'B', l: cl, r: cr, t: holdB, b: dockTop - G, from: 'bottom' });
      slots.push({ id: 'T', l: cl, r: cr, t: topEdge(cl, cr), b: holdT, from: 'top' });
    }
    const slot = (id: string): Slot | undefined => slots.find((x) => x.id === id);
    const width = (x: Slot): number => Math.max(0, x.r - x.l);

    // 3. measure each overlay at the width of each slot it may take
    const measure = (el: HTMLElement, w: number, prep?: () => void): number => {
      styleVar(el, 'max-width', px(w));
      prep?.();
      return el.offsetHeight;
    };
    const items: LaneItem[] = [];
    const offerOn = !P.offer.hidden;
    const offerSlot = L === 'rail' ? 'S' : 'B';
    if (offerOn) {
      const s = slot(offerSlot)!;
      // a landscape phone's side lane is narrower than the usual wide card: the phone layout (foot under the cards), and
      // one card per row when it is very narrow
      P.offer.classList.toggle('narrow', L === 'rail' && width(s) < 560);
      P.offer.classList.toggle('thin', width(s) < 300);
      if (L === 'rail') { styleVar(P.offer, 'width', px(Math.min(620, width(s)))); styleVar(P.offer, 'left', px(s.l - bb.left)); }
      else styleVar(P.offer, 'width', '');
      styleVar(P.offer, 'max-height', '');
      const hh = measure(P.offer, width(s)) || P.offer.scrollHeight;
      items.push({ id: 'offer', kind: 'card', opts: [{ slot: offerSlot, h: Math.max(hh, P.offer.scrollHeight + 2) }], floor: MIN_OFFER });
    }
    // a landscape phone's armed hint would run out of the ability column over the arena: it takes a lane, under the
    // tower first (near the thumbs)
    const railHint = L === 'rail' && !!hint;
    if (railHint) {
      styleVar(P.armHint, 'position', 'fixed');
      const ids = ['B', 'T', 'S'].filter((id) => slot(id) && !(id === 'S' && offerOn));
      items.push({ id: 'arm', kind: 'card', opts: ids.map((id) => ({ slot: id, h: measure(P.armHint, width(slot(id)!)) })), floor: 0 });
    }
    const coachOn = !P.coach.el.hidden;
    if (coachOn) {
      const ce = P.coach.el;
      ce.classList.remove('lane-wait');
      const opts: LaneOpt[] = [];
      const order = L === 'rail' ? ['T', 'S', 'B'] : ['B', 'T'];
      const busy = (id: string): boolean => id === offerSlot && offerOn && L === 'rail';   // the offer fills S
      for (const compact of P.coach.shrunk ? [true] : [false, true]) {
        // the whole sentence in lane order; one line in the widest lane first (a narrow one would cut it to a word)
        const ids = compact ? [...order].sort((x, y) => (slot(y) ? width(slot(y)!) : 0) - (slot(x) ? width(slot(x)!) : 0)) : order;
        for (const id of ids) {
          const s = slot(id);
          if (!s || busy(id)) continue;
          opts.push({ slot: id, compact, h: measure(ce, Math.min(420, width(s)), () => ce.classList.toggle('compact', compact)) });
        }
      }
      items.push({ id: 'coach', kind: 'card', opts });
    }
    // the death card: whole (capped, scrolling) where there is room for it, else its headline, else it waits
    const D = P.death, de = D.el, deathOn = !de.hidden;
    if (deathOn) {
      de.classList.remove('lane-wait');
      const ids = (L === 'rail' ? ['T', 'S', 'B'] : ['B', 'T']).filter((id) => !(L === 'rail' && id === 'S' && offerOn) && slot(id));
      const full = (id: string): number => { de.classList.remove('lane-folded'); styleVar(de, 'max-height', 'none'); styleVar(de, 'max-width', px(width(slot(id)!))); return de.scrollHeight + 2; };
      const folded = (id: string): number => { styleVar(de, 'max-width', px(width(slot(id)!))); de.classList.add('lane-folded'); const v = de.offsetHeight; de.classList.remove('lane-folded'); return v; };
      const opts: LaneOpt[] = [];
      if (D.folded) for (const id of ids) opts.push({ slot: id, h: folded(id), compact: true });
      else {
        // asked for in full, or the card owns the lane (death first, attention.ts): the roomiest slot, whatever it holds
        const whole = D.wantFull || D.first;
        // the card owns the lane but the roomiest slot is short: drop the restart / cause lines so the buys show whole
        de.classList.remove('dc-tight');
        if (whole && ids.length) {
          const roomiest = Math.max(...ids.map((id) => slot(id)!.b - slot(id)!.t));
          if (Math.max(...ids.map((id) => full(id))) > roomiest && Math.min(...ids.map((id) => full(id))) > roomiest) de.classList.add('dc-tight');
        }
        const ranked = whole ? [...ids].sort((x, y) => (slot(y)!.b - slot(y)!.t) - (slot(x)!.b - slot(x)!.t)) : ids;
        for (const id of ranked) opts.push({ slot: id, h: full(id), minH: MIN_DEATH });
        // no room for the whole card even in its tight form: its headline (never over the tower or the HUD)
        if (!D.wantFull) for (const id of ids) opts.push({ slot: id, h: folded(id), compact: true });
      }
      items.push({ id: 'death', kind: 'card', opts, floor: D.wantFull ? MIN_DEATH : undefined });
    }
    const order = (L === 'rail' ? ['T', 'S', 'B'] : ['B', 'T']).filter((id) => !(L === 'rail' && id === 'S' && offerOn));
    const hs: Record<string, number[]> = {};
    for (const id of order) { styleVar(P.feed.el, 'max-width', px(width(slot(id)!))); hs[id] = P.feed.heights(); }
    items.push({ id: 'toasts', kind: 'stack', slots: order, hs });

    const rooms = slots.map((s) => ({ id: s.id, room: s.b - s.t }));
    if (deathOn && (D.first || D.wantFull)) {
      // the card owns the lane: it is placed before the coach banner (held then anyway) and the toasts
      const d = items.findIndex((x) => x.id === 'death'), c = items.findIndex((x) => x.id === 'coach');
      if (c >= 0 && d > c) { const [it] = items.splice(d, 1); items.splice(c, 0, it); }
    }
    let plan = planLanes(rooms, items, G);
    if (deathOn && !plan.death) {
      // no room left for even the death card's headline: it goes before the coach banner (which can still shrink or wait)
      const d = items.findIndex((x) => x.id === 'death'), c = items.findIndex((x) => x.id === 'coach');
      if (c >= 0 && d > c) { const [it] = items.splice(d, 1); items.splice(c, 0, it); plan = planLanes(rooms, items, G); }
    }
    this.plan = plan;
    this.lastSig = '';   // re-read after the writes below (they move what the signature measures)

    // 4. write: each slot fills from its anchor edge
    const cursor = new Map<string, number>(slots.map((s) => [s.id, s.from === 'top' ? s.t : s.b]));
    const place = (el: HTMLElement, id: string, hh: number, rel: Box | null, centre = true): void => {
      const s = slot(id)!;
      const at = cursor.get(id)!;
      const y = s.from === 'top' ? at : at - hh;
      cursor.set(id, s.from === 'top' ? at + hh + G : at - hh - G);
      const ox = rel ? rel.l : 0, oy = rel ? rel.t : 0;
      styleVar(el, 'max-width', px(width(s)));
      if (centre) { styleVar(el, 'left', px((s.l + s.r) / 2 - ox)); styleVar(el, 'transform', 'translateX(-50%)'); }
      if (s.from === 'top' || !rel) { styleVar(el, 'top', px(y - oy)); styleVar(el, 'bottom', 'auto'); }
      else { styleVar(el, 'bottom', px((rel.b) - (y + hh))); styleVar(el, 'top', 'auto'); }
    };
    const battleBox: Box = { l: bb.left, t: bb.top, r: bb.right, b: bb.bottom };
    if (offerOn && plan.offer) {
      styleVar(P.offer, 'max-height', px(plan.offer.h));
      place(P.offer, plan.offer.slot, plan.offer.h, battleBox, L !== 'rail');
      if (L === 'rail') styleVar(P.offer, 'transform', 'none');
    }
    if (railHint && plan.arm) place(P.armHint, plan.arm.slot, plan.arm.h, null);
    else if (!railHint) for (const k of ['top', 'bottom', 'left', 'max-width', 'position', 'transform']) styleVar(P.armHint, k, '');
    if (coachOn) {
      const c = plan.coach;
      P.coach.el.classList.toggle('lane-wait', !c);
      P.coach.el.classList.toggle('compact', !!c?.compact);
      const msg = P.coach.el.querySelector('.coach-text');
      if (msg) { attr(msg, 'role', c?.compact ? 'button' : null); attr(msg, 'tabindex', c?.compact ? '0' : null); }
      if (c) place(P.coach.el, c.slot, c.h, null);
    }
    if (deathOn) {
      const d = plan.death;
      de.classList.toggle('lane-wait', !d);
      de.classList.toggle('lane-folded', !!d?.compact && !D.folded);
      if (d) { styleVar(de, 'max-height', px(d.h)); place(de, d.slot, d.h, battleBox); }
    }
    const t = plan.toasts;
    P.feed.fit(t ? t.count : 0);
    if (t && t.count) place(P.feed.el, t.slot, t.h, null);
  }
}
