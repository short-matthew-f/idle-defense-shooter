/**
 * Modal layer: stacked dialogs over the battlefield (the field stays visible behind a dim
 * backdrop). Escape / backdrop tap close dismissable dialogs; focus moves into the dialog and
 * returns to the opener on close.
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
  /** 'center' (default), 'wide', or 'overlay' (translucent side sheet that keeps the field readable). */
  variant?: 'center' | 'wide' | 'overlay';
  onClose?: () => void;
  /** A balance line under the title for a dialog that spends ("You have ◆ 12 Cores": wallet.ts walletChip). */
  wallet?: HTMLElement;
}

export interface ModalHandle { el: HTMLElement; close(): void; readonly open: boolean; setTitle(t: string): void }

let layer: HTMLElement | null = null;
const stack: { handle: ModalHandle; opts: ModalOptions; opener: Element | null }[] = [];

export function mountModalLayer(root: HTMLElement): void {
  layer = h('div', { class: 'modal-layer', attrs: { 'aria-live': 'off' } });
  layer.hidden = true;
  root.appendChild(layer);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack.length) return;
    const top = stack[stack.length - 1];
    if (top.opts.dismissable !== false) { e.preventDefault(); e.stopPropagation(); top.handle.close(); }
  }, true);
}

export function anyModalOpen(): boolean { return stack.length > 0; }
export function topModalClass(): string | undefined { return stack[stack.length - 1]?.opts.className; }

export function openModal(opts: ModalOptions): ModalHandle {
  if (!layer) throw new Error('modal layer not mounted');
  const titleEl = h('h2', { class: 'modal-title', text: opts.title });
  const id = `m${Math.random().toString(36).slice(2, 8)}`;
  titleEl.id = id;
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
      opts.onClose?.();
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
  stack.push({ handle, opts, opener: document.activeElement });
  const focusable = card.querySelector<HTMLElement>('.modal-body button:not([disabled]), .modal-body input, .modal-body select, .modal-foot button:not([disabled])');
  (focusable ?? card.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
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
