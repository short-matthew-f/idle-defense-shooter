/**
 * Modal layer: stacked dialogs over the battlefield (the field stays visible behind a dim
 * backdrop). Escape / backdrop tap close dismissable dialogs. Phase 3 (A-04): while a dialog is open the rest of the
 * app is `inert` (and lower dialogs in the stack), Tab cycles inside the top dialog, initial focus goes to the title
 * (confirmDialog: the safe Cancel), and focus returns to the opener on close.
 */
import '../styles/modal.css';
import { button, h } from './dom';
import { icon } from './icons';

export interface ModalOptions {
  title: string;
  body: HTMLElement;
  footer?: HTMLElement;
  className?: string;
  dismissable?: boolean;
  /** 'center' (default), 'wide', 'overlay' (translucent side sheet that keeps the field readable) or 'sheet' (bottom sheet: info.ts). */
  variant?: 'center' | 'wide' | 'overlay' | 'sheet';
  onClose?: () => void;
  /** A balance line under the title for a dialog that spends ("You have ◆ 12 Cores": wallet.ts walletChip). */
  wallet?: HTMLElement;
}

export interface ModalHandle { el: HTMLElement; close(): void; readonly open: boolean; setTitle(t: string): void }

let layer: HTMLElement | null = null;
const stack: { handle: ModalHandle; opts: ModalOptions; opener: Element | null; wrap: HTMLElement }[] = [];
/** Elements made inert while dialogs are open (restored when the last one closes). */
let inerted: HTMLElement[] = [];

/** Everything outside `keep`'s ancestor chain (up to <body>) that a dialog must make inert (live regions stay live). */
export function inertTargets(keep: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let el: HTMLElement | null = keep; el && el !== document.body; el = el.parentElement) {
    const parent: HTMLElement | null = el.parentElement;
    if (!parent) break;
    for (const sib of Array.from(parent.children) as Element[]) {
      if (sib === el || !(sib instanceof HTMLElement) || sib.inert || sib.classList.contains('sr-live')) continue;
      if (sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE') continue;
      out.push(sib);
    }
  }
  return out;
}

function syncInert(): void {
  if (!layer) return;
  if (stack.length && !inerted.length) { inerted = inertTargets(layer); for (const el of inerted) el.inert = true; }
  else if (!stack.length && inerted.length) { for (const el of inerted) el.inert = false; inerted = []; }
  stack.forEach((s, i) => { s.wrap.inert = i < stack.length - 1; });
}

/** The keyboard-focusable elements inside a dialog card, in order. */
function focusables(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((e) => !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0);
}

/** Tab / Shift+Tab wrap inside the top dialog (pure index rule). */
export function trapIndex(current: number, count: number, back: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return back ? count - 1 : 0;
  return back ? (current - 1 + count) % count : (current + 1) % count;
}

export function mountModalLayer(root: HTMLElement): void {
  layer = h('div', { class: 'modal-layer', attrs: { 'aria-live': 'off' } });
  layer.hidden = true;
  root.appendChild(layer);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack.length) return;
    const top = stack[stack.length - 1];
    if (top.opts.dismissable !== false) { e.preventDefault(); e.stopPropagation(); top.handle.close(); }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !stack.length) return;
    const card = stack[stack.length - 1].handle.el;
    const list = focusables(card);
    if (!list.length) { e.preventDefault(); return; }
    const i = list.indexOf(document.activeElement as HTMLElement);
    // inside the list and not at an end: let the browser move focus normally
    if (i > 0 && i < list.length - 1) return;
    if (i === 0 && !e.shiftKey && list.length > 1) return;
    if (i === list.length - 1 && e.shiftKey && list.length > 1) return;
    e.preventDefault();
    list[trapIndex(i, list.length, e.shiftKey)]?.focus();
  }, true);
}

export function anyModalOpen(): boolean { return stack.length > 0; }
/** The shell's Back guard (shell.ts): called when a dialog opens / the last one closes, so Back closes the dialog. */
export const modalHooks: { opened: (() => void) | null; emptied: (() => void) | null } = { opened: null, emptied: null };
/**
 * Back (history pop) with dialogs open: a dismissable top dialog closes, a non-dismissable one stays; either way the
 * screen underneath must not change. Pure rule + the action.
 */
export function backOnModal(open: boolean, dismissable: boolean): 'navigate' | 'close' | 'stay' {
  return !open ? 'navigate' : dismissable ? 'close' : 'stay';
}
export function handleBackWithModal(): 'navigate' | 'close' | 'stay' {
  const top = stack[stack.length - 1];
  const r = backOnModal(!!top, top?.opts.dismissable !== false);
  if (r === 'close') top.handle.close();
  return r;
}
export function topModalClass(): string | undefined { return stack[stack.length - 1]?.opts.className; }

export function openModal(opts: ModalOptions): ModalHandle {
  if (!layer) throw new Error('modal layer not mounted');
  const titleEl = h('h2', { class: 'modal-title', text: opts.title });
  const id = `m${Math.random().toString(36).slice(2, 8)}`;
  titleEl.id = id;
  titleEl.tabIndex = -1;   // initial focus lands here (never on a confirm or destructive action)
  const head = h('div', { class: 'modal-head' }, opts.wallet ? h('div', { class: 'modal-titles' }, titleEl, opts.wallet) : titleEl);
  let isOpen = true;
  const handle: ModalHandle = {
    el: null as unknown as HTMLElement,
    get open() { return isOpen; },
    close() {
      if (!isOpen) return;
      isOpen = false;
      wrap.remove();
      const i = stack.findIndex((s) => s.handle === handle);
      const entry = i >= 0 ? stack.splice(i, 1)[0] : null;
      if (layer && !stack.length) layer.hidden = true;
      syncInert();
      opts.onClose?.();
      if (!stack.length) modalHooks.emptied?.();
      const opener = entry?.opener as HTMLElement | null;
      if (opener && document.contains(opener)) opener.focus?.({ preventScroll: true });
    },
    setTitle(t: string) { titleEl.textContent = t; },
  };
  if (opts.dismissable !== false) head.appendChild(button(icon('close'), () => handle.close(), { class: 'btn icon-btn ghost', label: 'Close' }));
  const card = h('div', { class: `modal-card ${opts.variant ?? 'center'} ${opts.className ?? ''}`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id } },
    head, h('div', { class: 'modal-body' }, opts.body), opts.footer ? h('div', { class: 'modal-foot' }, opts.footer) : null);
  const backdrop = h('div', { class: 'modal-backdrop' });
  if (opts.dismissable !== false) backdrop.addEventListener('click', () => handle.close());
  const wrap = h('div', { class: `modal-wrap ${opts.variant ?? 'center'}` }, backdrop, card);
  handle.el = card;
  layer.hidden = false;
  layer.appendChild(wrap);
  const prevTop = stack[stack.length - 1];
  // a dialog opened from another one returns focus to its control; one opened from inert app content to the element
  // that had focus before (the opener)
  stack.push({ handle, opts, opener: prevTop && !prevTop.handle.el.contains(document.activeElement) ? prevTop.handle.el.querySelector('.modal-title') : document.activeElement, wrap });
  syncInert();
  modalHooks.opened?.();
  titleEl.focus({ preventScroll: true });
  return handle;
}

/** Yes/no confirmation; resolves false on dismiss. */
export function confirmDialog(title: string, message: string | HTMLElement, confirmLabel = 'Confirm', opts: { danger?: boolean; cancelLabel?: string; wallet?: HTMLElement } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const body = typeof message === 'string' ? h('p', { class: 'confirm-msg', text: message }) : message;
    const ok = button(confirmLabel, () => { result = true; m.close(); }, { class: `btn ${opts.danger ? 'danger' : 'primary'}` });
    const cancel = button(opts.cancelLabel ?? 'Cancel', () => m.close(), { class: 'btn' });
    const m = openModal({ title, body, footer: h('div', { class: 'row end gap' }, cancel, ok), className: 'confirm', wallet: opts.wallet, onClose: () => resolve(result) });
    cancel.focus();
  });
}
