/**
 * The breadcrumb navigation shared by Upgrades, Build and Prestige (one pinned line over a scrolling list):
 *   - the crumb line (`crumbLine`) and its crumb buttons ("Label ▾" with an optional quiet count and an attention dot);
 *   - popover menus (`CrumbMenu`: modal.ts variant 'popover', so Esc, Back, a tap outside and a choice close them and
 *     focus returns to the crumb) built from 48 px rows (`CrumbMenu.row`): a label, indented section jump links, a quiet
 *     count, ★, a status hint, a lock with its reason, and a dot + "New" where a decision waits;
 *   - the list swipe (`wireSwipe`): one finger, ≥ 50 px and mostly sideways, never from within 24 px of the left edge (the
 *     system's swipe back) and never starting on a control; the tap that ends a swipe never also acts;
 *   - the short slide of the new view (`slideIn`; none with reduced motion: crumbs.css);
 *   - sticky section headers (`.sec-head` in crumbs.css);
 *   - the stop-walking helpers (`stepStop`, `stepId`: pure, no wrap).
 */
import '../styles/crumbs.css';
import { button, h, attr, show, text, type Child } from './dom';
import { icon } from './icons';
import { openModal, type ModalHandle } from './modal';

/** Minimum horizontal travel (px) for a swipe on the list, and how much more horizontal than vertical it must be. */
export const SWIPE_MIN_DX = 50;
export const SWIPE_RATIO = 1.5;
/** Touches that start this close to the left edge belong to the system's swipe-back (→ Battle). */
export const SWIPE_EDGE = 24;

/** Is a touch from (x0, y0) to (x1, y1) a list swipe? -1 / +1 (previous / next) or 0. Pure. */
export function swipeDir(x0: number, y0: number, x1: number, y1: number): -1 | 0 | 1 {
  if (x0 < SWIPE_EDGE) return 0;
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) <= SWIPE_RATIO * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** One stop of a two-level swipe order: a tree of a page, or a whole page (`tree` empty). */
export interface NavStop<C extends string = string> { cat: C; tree: string }

/** The stop `dir` steps from (cat, tree), or null at either end (no wrap). A page's unknown tree counts as the page. Pure. */
export function stepStop<S extends NavStop>(stops: readonly S[], cat: string, tree: string, dir: -1 | 1): S | null {
  let i = stops.findIndex((s) => s.cat === cat && (s.tree === '' || s.tree === tree));
  if (i < 0) i = stops.findIndex((s) => s.cat === cat);
  if (i < 0) return stops[0] ?? null;
  return stops[i + dir] ?? null;
}

/** The id `dir` steps from `cur` along `ids`, or null at either end (no wrap; an unknown `cur` steps to the first). Pure. */
export function stepId<T>(ids: readonly T[], cur: T, dir: -1 | 1): T | null {
  const i = ids.indexOf(cur);
  if (i < 0) return ids[0] ?? null;
  return ids[i + dir] ?? null;
}

// ---------------------------------------------------------------- the crumb line

export interface Crumb {
  btn: HTMLButtonElement;
  label: HTMLElement;
  count: HTMLElement;
  dot: HTMLElement;
  caret: HTMLElement;
}

/**
 * "Label [count] [dot] ▾". `dotCls` keeps each screen's dot class (Upgrades: `cat-dot` on the page crumb, `chip-dot`
 * on the tree crumb).
 */
export function crumbButton(onTap: () => void, o: { cls: string; hint?: string; dotCls?: string; count?: boolean }): Crumb {
  const label = h('span', { class: 'crumb-label' });
  const count = h('span', { class: 'crumb-count', attrs: { 'aria-hidden': 'true' } });
  const dot = h('span', { class: o.dotCls ?? 'cat-dot', attrs: { 'aria-hidden': 'true' } });
  const caret = h('span', { class: 'crumb-caret', text: '▾', attrs: { 'aria-hidden': 'true' } });
  const btn = button(o.count ? [label, count, dot, caret] : [label, dot, caret], onTap, { class: `btn ghost crumb ${o.cls}` });
  if (o.hint) btn.dataset.hint = o.hint;
  attr(btn, 'aria-haspopup', 'menu');
  dot.hidden = true;
  return { btn, label, count, dot, caret };
}

/** Paint a crumb: its label, whether it opens a menu, its count and dot, and its accessible name. */
export function paintCrumb(c: Crumb, o: { label: string; menuable: boolean; count?: number; dot?: boolean; aria: string }): void {
  text(c.label, o.label);
  c.btn.classList.toggle('static', !o.menuable);
  show(c.caret, o.menuable);
  text(c.count, o.count ? String(o.count) : '');
  show(c.dot, !!o.dot);
  attr(c.btn, 'aria-label', o.aria);
  c.btn.tabIndex = o.menuable ? 0 : -1;
}

/** The "›" between two crumbs. */
export function crumbSep(): HTMLElement { return h('span', { class: 'crumb-sep', text: '›', attrs: { 'aria-hidden': 'true' } }); }
/** The flexible gap that pushes what follows to the right end of the line. */
export function crumbGap(): HTMLElement { return h('span', { class: 'crumb-gap' }); }
/** The crumb line (`nav.crumbs`). */
export function crumbLine(label: string, ...kids: (HTMLElement | null)[]): HTMLElement {
  return h('nav', { class: 'crumbs', attrs: { 'aria-label': label } }, ...kids);
}

// ---------------------------------------------------------------- menus

export interface MenuRowOpts {
  label: string;
  /** An indented jump link to a section of the view on show. */
  sub?: boolean;
  current?: boolean;
  /** A quiet count (e.g. affordable nodes). */
  count?: number;
  /** Holds a ★ Suggested row. */
  star?: boolean;
  /** A decision waits there: a dot + "New" (the text is its accessible reason). */
  dot?: string | null;
  /** A short status after the label ("2 empty", "0/4"). */
  status?: string | null;
  /** Locked: the row shows a lock and this reason, and cannot be picked. */
  lock?: string | null;
  /** Pointer-hint key (hints.ts / pointer.ts). */
  hint?: string;
  /** An empty-slot row (quieter). */
  empty?: boolean;
  onPick: () => void;
}

/** The one breadcrumb menu of a screen (a popover; at most one open). */
export class CrumbMenu {
  private m: ModalHandle | null = null;
  get isOpen(): boolean { return !!this.m; }

  close(): void { const m = this.m; this.m = null; m?.close(); }

  open(anchor: HTMLButtonElement, title: string, rows: HTMLElement[], cls: string): void {
    this.close();
    const body = h('div', { class: `crumb-menu-list ${cls}`, attrs: { role: 'menu', 'aria-label': title } }, ...rows);
    attr(anchor, 'aria-expanded', 'true');
    const m = openModal({ title, body, variant: 'popover', className: 'crumb-menu', anchor, returnFocus: anchor,
      onClose: () => { attr(anchor, 'aria-expanded', 'false'); if (this.m === m) this.m = null; } });
    this.m = m;
    (body.querySelector<HTMLElement>('[aria-current="true"]') ?? body.querySelector<HTMLElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
  }

  /** One 48 px menu row (picking it closes the menu first). */
  row(o: MenuRowOpts): HTMLButtonElement {
    const parts: Child[] = [];
    if (o.lock) parts.push(icon('lock', 'ico tiny cm-lock'));
    parts.push(h('span', { class: 'cm-label', text: o.label }));
    if (o.count) parts.push(h('span', { class: 'cm-count', text: String(o.count), attrs: { 'aria-hidden': 'true' } }));
    if (o.status) parts.push(h('span', { class: 'cm-status', text: o.status, attrs: { 'aria-hidden': 'true' } }));
    if (o.star) parts.push(h('span', { class: 'cm-star', text: '★', attrs: { 'aria-hidden': 'true' } }));
    if (o.dot) parts.push(h('span', { class: 'cm-new' }, h('span', { class: 'cat-dot', attrs: { 'aria-hidden': 'true' } }), h('span', { text: 'New' })));
    if (o.lock) parts.push(h('span', { class: 'cm-why', text: o.lock }));
    const b = button(parts, () => { if (o.lock) return; this.close(); o.onPick(); },
      { class: `btn ghost cm-row${o.sub ? ' sub' : ''}${o.current ? ' current' : ''}${o.empty ? ' empty' : ''}${o.lock ? ' locked' : ''}` });
    b.setAttribute('role', 'menuitem');
    if (o.lock) attr(b, 'aria-disabled', 'true');
    if (o.current) attr(b, 'aria-current', 'true');
    if (o.hint) b.dataset.hint = o.hint;
    attr(b, 'aria-label', `${o.label}${o.count ? `, ${o.count} affordable` : ''}${o.status ? `, ${o.status}` : ''}${o.star ? ', has a suggested upgrade' : ''}${o.dot ? ` (${o.dot})` : ''}${o.lock ? ` (locked: ${o.lock})` : ''}`);
    return b;
  }
}

// ---------------------------------------------------------------- swipe and slide

/**
 * Horizontal swipes on `el` call `step(dir)` (not from the left edge: that is the system's swipe back to Battle; not
 * from a control). When `step` moved, the click that ends the touch is swallowed.
 */
export function wireSwipe(el: HTMLElement, step: (dir: -1 | 1) => boolean, ignore = 'button, input, label, select, .pick-card, .fork-cards'): void {
  let s: { x: number; y: number; id: number } | null = null;
  let swallowUntil = 0;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const tgt = e.target as Element | null;
    s = e.touches.length === 1 && t && !tgt?.closest(ignore) ? { x: t.clientX, y: t.clientY, id: t.identifier } : null;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const st = s;
    s = null;
    if (!st) return;
    const t = [...e.changedTouches].find((x) => x.identifier === st.id);
    if (!t) return;
    const d = swipeDir(st.x, st.y, t.clientX, t.clientY);
    if (d && step(d)) swallowUntil = performance.now() + 400;
  }, { passive: true });
  el.addEventListener('touchcancel', () => { s = null; }, { passive: true });
  // the tap that ended a swipe never also acts
  el.addEventListener('click', (e) => { if (performance.now() < swallowUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
}

/** Slide `el`'s new content in from the side of `dir` (none with reduced motion: crumbs.css). */
export function slideIn(el: HTMLElement, dir: -1 | 0 | 1): void {
  if (!dir) return;
  const cls = dir > 0 ? 'slide-next' : 'slide-prev';
  el.classList.remove('slide-next', 'slide-prev');
  void el.offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), 260);
}
