/**
 * Tiny DOM helpers. Everything that updates at UI rate goes through `text` / `attr` / `style`
 * setters that compare first, so an unchanged value never touches the DOM.
 */
import { HoldGesture, type HoldAction } from './hold';

type Child = Node | string | number | null | undefined | false;
export interface Props {
  class?: string;
  text?: string;
  title?: string;
  aria?: Record<string, string>;
  attrs?: Record<string, string>;
  data?: Record<string, string>;
  style?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: never) => void>>;
  type?: string;
  disabled?: boolean;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.title) el.title = props.title;
    if (props.type) el.setAttribute('type', props.type);
    if (props.disabled) (el as HTMLButtonElement).disabled = true;
    if (props.aria) for (const k in props.aria) el.setAttribute(`aria-${k}`, props.aria[k]);
    if (props.attrs) for (const k in props.attrs) el.setAttribute(k, props.attrs[k]);
    if (props.data) for (const k in props.data) el.dataset[k] = props.data[k];
    if (props.style) for (const k in props.style) el.style.setProperty(k, props.style[k]);
    if (props.on) for (const k in props.on) el.addEventListener(k, props.on[k as keyof HTMLElementEventMap] as EventListener);
  }
  for (const c of children) append(el, c);
  return el;
}

export function append(el: Node, c: Child): void {
  if (c === null || c === undefined || c === false) return;
  el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
}

/** `<button type="button">`; icon-only buttons must pass `label` for aria-label. */
export function button(content: Child | Child[], onClick: (e: MouseEvent) => void, opts: { class?: string; label?: string; title?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', class: opts.class ?? 'btn', title: opts.title, disabled: opts.disabled });
  if (opts.label) b.setAttribute('aria-label', opts.label);
  for (const c of Array.isArray(content) ? content : [content]) append(b, c);
  b.addEventListener('click', onClick);
  return b;
}

export function text(el: Element, v: string): void { if (el.textContent !== v) el.textContent = v; }
export function attr(el: Element, name: string, v: string | null): void {
  if (v === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
  else if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}
export function styleVar(el: HTMLElement, name: string, v: string): void {
  if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v);
}
export function show(el: HTMLElement, on: boolean): void { if (el.hidden === on) el.hidden = !on; }
export function disable(el: HTMLButtonElement | HTMLInputElement | HTMLSelectElement, off: boolean): void { if (el.disabled !== off) el.disabled = off; }
export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }

/**
 * Press-and-hold repeat for Buy buttons (gesture rules in hold.ts): mouse fires on press and repeats
 * after 380 ms, speeding up; touch fires on a tap, repeats only after holding still, and never fires
 * when the finger scrolls the list. Keyboard activation (click with detail 0) fires once.
 */
export function holdRepeat(btn: HTMLButtonElement, fire: () => void): void {
  const g = new HoldGesture();
  let timer = 0;
  const clearTimer = (): void => { if (timer) { clearTimeout(timer); timer = 0; } };
  const detach = (): void => {
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
  };
  const run = (a: HoldAction): void => {
    clearTimer();
    if (a.kind === 'stop') { detach(); return; }
    if (a.kind === 'none') return;
    if (a.kind === 'fire') fire();
    // The button may be re-rendered or removed while held (e.g. a quick-buy chip that became unaffordable):
    // without a pointerup it would repeat forever, so each tick checks it is still connected and enabled.
    timer = window.setTimeout(() => run(g.tick(btn.isConnected && !btn.disabled)), a.next);
  };
  const onUp = (): void => run(g.up());
  const onCancel = (): void => run(g.cancel());
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || btn.disabled) return;
    run(g.stop());
    run(g.down(e.pointerType, e.clientX, e.clientY));
    // Listen on the window (capture) so releasing over another element, or after the button was replaced, still stops it.
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
  });
  btn.addEventListener('pointermove', (e) => { if (g.pressed) run(g.move(e.clientX, e.clientY)); });
  btn.addEventListener('pointercancel', onCancel);
  for (const ev of ['pointerup', 'pointerleave', 'blur'] as const) btn.addEventListener(ev, () => { if (g.pressed) onUp(); });
  btn.addEventListener('click', (e) => { if (g.click(e.detail) && !btn.disabled) fire(); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** Long-press detector (ms); returns true from `consumed()` right after a long press so the click can be ignored. */
export function longPress(el: HTMLElement, ms: number, onLong: () => void): { consumed(): boolean } {
  let timer = 0, fired = false, sx = 0, sy = 0;
  const cancel = (): void => { if (timer) { clearTimeout(timer); timer = 0; } };
  el.addEventListener('pointerdown', (e) => {
    fired = false; sx = e.clientX; sy = e.clientY; cancel();
    timer = window.setTimeout(() => { timer = 0; fired = true; onLong(); }, ms);
  });
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 12) cancel(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) el.addEventListener(ev, cancel);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) { cancel(); fired = true; onLong(); } });
  return { consumed(): boolean { const f = fired; fired = false; return f; } };
}

/** A labelled horizontal bar (fill 0..1) with a text overlay. */
export class Bar {
  readonly el: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly extra: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private last = -1; private lastExtra = -1;
  constructor(cls: string, ariaLabel: string) {
    this.fill = h('div', { class: 'bar-fill' });
    this.extra = h('div', { class: 'bar-extra' });
    this.label = h('span', { class: 'bar-label' });
    this.el = h('div', { class: `bar ${cls}`, attrs: { role: 'meter', 'aria-label': ariaLabel, 'aria-valuemin': '0', 'aria-valuemax': '100' } }, this.fill, this.extra, this.label);
  }
  set(frac: number, label: string, extraFrac = 0): void {
    const f = Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10;
    if (f !== this.last) { this.last = f; this.fill.style.width = `${f}%`; this.el.setAttribute('aria-valuenow', String(Math.round(f))); }
    const x = Math.round(Math.max(0, Math.min(1, extraFrac)) * 1000) / 10;
    if (x !== this.lastExtra) { this.lastExtra = x; this.extra.style.width = `${x}%`; this.extra.style.left = `${f}%`; }
    text(this.label, label);
  }
}

/** Keyed children: reuse row elements by key, append in the given order, drop the rest. */
export class Keyed<T, R extends { el: HTMLElement }> {
  readonly rows = new Map<string, R>();
  constructor(private readonly host: HTMLElement, private readonly make: (item: T) => R, private readonly upd: (row: R, item: T) => void) {}
  sync(items: readonly T[], key: (item: T) => string): void {
    const keep = new Set<string>();
    let prev: Element | null = null;
    for (const it of items) {
      const k = key(it);
      keep.add(k);
      let row = this.rows.get(k);
      if (!row) { row = this.make(it); this.rows.set(k, row); }
      this.upd(row, it);
      const want: Element | null = prev ? prev.nextElementSibling : this.host.firstElementChild;
      if (want !== row.el) this.host.insertBefore(row.el, want);
      prev = row.el;
    }
    for (const [k, row] of this.rows) if (!keep.has(k)) { row.el.remove(); this.rows.delete(k); }
  }
}
