/**
 * Wallet: how much of each currency the player has, wherever they can spend it.
 *
 *   WalletBar    one slim bar pinned at the top of the tab screens, under the status strip on a phone (or at the top
 *                of the desktop side panel). It lives in the shell's `.screens` column OUTSIDE each screen's scroller,
 *                so it never scrolls away (no position: sticky, which overflow containers and iOS standalone break).
 *                It shows only what the screen in view spends (walletCurrencies): Upgrades Scrap (+ Cores),
 *                Build Cores, Prestige Echoes (+ Stars on Ascension), More → Automation Scrap (the Upgrade Queue).
 *                While it shows Scrap the status strip drops its own Scrap figure (body.wallet-scrap): one place.
 *   walletChip   "You have ◆ 12 Cores" for the header of a dialog that spends (draft, Refit, Doctrine change,
 *                Prestige / Ascend confirmations). Live: updateLiveWallets(ui) refreshes every chip on screen.
 *
 * Figures are exact below a million ("52,333": a 12-Scrap buy must visibly change the number), then fmtNum like
 * the HUD ("3.4M"; the exact figure is in the tooltip). A change flashes the number briefly
 * (green on a gain, amber on a spend; never with reduced motion); a steady Scrap trickle does not flash.
 * The pure parts (which currencies, the figures, the flash) come first: tests/ui/wallet.test.ts.
 */
import '../styles/wallet.css';
import type { UiState } from '@sim/core/types';
import { gfxSettings, reducedMotion, systemReducedMotion } from '@render/quality';
import { h, show, text, attr } from './dom';
import { icon } from './icons';
import { fmtNum } from './format';
import type { Features } from './progression';
import type { TabId } from './shell-logic';

export type Currency = 'scrap' | 'cores' | 'echoes' | 'stars';
export const CURRENCIES: Readonly<Record<Currency, { icon: string; one: string; many: string; hint: string }>> = {
  scrap: { icon: 'scrap', one: 'Scrap', many: 'Scrap', hint: 'Scrap: spend it on upgrades' },
  cores: { icon: 'cores', one: 'Core', many: 'Cores', hint: 'Cores: Exotics, Refits, Doctrine changes, rerolls' },
  echoes: { icon: 'echo', one: 'Echo', many: 'Echoes', hint: 'Echoes: Prestige upgrades (kept across Prestiges)' },
  stars: { icon: 'star', one: 'Star', many: 'Stars', hint: 'Stars: Constellation nodes (kept across Ascensions)' },
};

/** What the wallet reads (a slice of UiState, so tests stay small). */
export interface WalletState {
  run: Pick<UiState['run'], 'scrap' | 'cores'>;
  meta: Pick<UiState['meta'], 'echoes' | 'stars'>;
  quartermaster?: (Pick<NonNullable<UiState['quartermaster']>, 'on' | 'unlocked'> & { bank?: number }) | null;
}

/** Where the player is: the tab on screen (null: none, e.g. Battle), the More sub-screen, the shop category, the Prestige segment. */
export interface WalletView { tab: TabId | null; sub?: string | null; shopCat?: string; prestigeSeg?: string }

type WalletFeatures = Pick<Features, 'cores' | 'boons' | 'runControls' | 'prestigeTab' | 'automation'>;

/** Cores are part of the player's world once they matter (as the HUD's Cores figure: hud.ts). */
export function coresRevealed(ui: WalletState, f: WalletFeatures): boolean {
  return f.cores || f.boons || (ui.run.cores > 0 && f.runControls);
}

/** The currencies the screen in view can spend, in display order ([] = no wallet). Pure. */
export function walletCurrencies(v: WalletView, ui: WalletState, f: WalletFeatures): Currency[] {
  const cores = coresRevealed(ui, f);
  switch (v.tab) {
    case 'upgrades': return ['scrap', ...(cores && (v.shopCat === 'cores' || ui.run.cores > 0) ? ['cores' as const] : [])];
    case 'build': return cores ? ['cores'] : [];
    case 'prestige': return f.prestigeTab ? ['echoes', ...(v.prestigeSeg === 'ascension' ? ['stars' as const] : [])] : [];
    case 'more': return v.sub === 'automation' && f.automation ? ['scrap'] : [];
    default: return [];
  }
}

export function balanceOf(ui: WalletState, c: Currency): number {
  switch (c) {
    case 'scrap': return ui.run.scrap;
    case 'cores': return ui.run.cores;
    case 'echoes': return ui.meta.echoes;
    case 'stars': return ui.meta.stars;
  }
}

/** The Quartermaster's bank (Scrap set aside for its automatic buys) while it is on, else null (older sims: no field). */
export function qmBank(ui: WalletState): number | null {
  const q = ui.quartermaster;
  return q && q.unlocked && q.on && typeof q.bank === 'number' && Number.isFinite(q.bank) ? q.bank : null;
}

export interface WalletFigure { currency: Currency; value: number; text: string; label: string; exact: string; bank: number | null; bankText: string }

/** "1,234" (the tooltip's exact figure). */
export function exactNum(n: number): string { return Math.floor(n).toLocaleString('en-US'); }
export function currencyName(c: Currency, n: number): string { return Math.floor(n) === 1 ? CURRENCIES[c].one : CURRENCIES[c].many; }

/** What one wallet entry says. Pure. */
export function walletFigure(ui: WalletState, c: Currency): WalletFigure {
  const value = balanceOf(ui, c);
  const bank = c === 'scrap' ? qmBank(ui) : null;
  const name = currencyName(c, value);
  return {
    currency: c, value, text: fmtExactish(value), exact: exactNum(value), bank, bankText: bank === null ? '' : `QM ${fmtExactish(bank)}`,
    label: `${fmtExactish(value)} ${name}${bank === null ? '' : `, Quartermaster bank ${fmtExactish(bank)}`}`,
  };
}

/** Exact below a million ("3,061"), else fmtNum: a dialog's "after" figure must not round a small gain away. */
export function fmtExactish(n: number): string { return Math.abs(n) < 1e6 ? exactNum(n) : fmtNum(n); }

/** "+61 → 3,061 after this Prestige": what the player keeps once a Prestige pays `gain` Echoes. */
export function echoesAfter(gain: number): (ui: WalletState) => string {
  return (ui) => (gain > 0 ? `+${fmtNum(gain)} → ${fmtExactish(ui.meta.echoes + gain)} after this Prestige` : '');
}

/** Scrap gains smaller than this share of the balance are income, not news (no flash). */
export const GAIN_FLASH_SHARE = 0.1;
/** At most one gain flash per this many ms (spends always flash). */
export const GAIN_FLASH_GAP_MS = 1200;

/** Should a change from `prev` to `next` flash? 'spend' on any drop; 'gain' on a rise that is news, not the Scrap trickle. Pure. */
export function flashKind(prev: number | null, next: number, c: Currency, msSinceGainFlash = Infinity): 'gain' | 'spend' | null {
  if (prev === null || !Number.isFinite(prev) || !Number.isFinite(next) || next === prev) return null;
  if (next < prev) return 'spend';
  if (msSinceGainFlash < GAIN_FLASH_GAP_MS) return null;
  if (c === 'scrap' && next - prev < Math.max(1, prev * GAIN_FLASH_SHARE)) return null;
  return 'gain';
}

// ---------------------------------------------------------------- DOM

function motionOk(): boolean {
  try { return !reducedMotion(gfxSettings().motion, systemReducedMotion()); } catch { return true; }
}

/** One currency's figure: icon, number (flashes on change), name, and the Quartermaster bank for Scrap. */
class Figure {
  readonly el: HTMLElement;
  private readonly val = h('span', { class: 'wl-val' });
  private readonly name = h('span', { class: 'wl-name' });
  private readonly bank = h('span', { class: 'wl-bank' });
  private prev: number | null = null;
  private gainAt = -Infinity;
  private timer = 0;
  constructor(readonly currency: Currency) {
    const c = CURRENCIES[currency];
    this.el = h('span', { class: `wl-item ${currency}`, attrs: { role: 'img' }, data: { currency } }, icon(c.icon, 'ico wl-ico'), this.val, this.name, this.bank);
    this.bank.hidden = true;
  }
  update(ui: WalletState): void {
    const f = walletFigure(ui, this.currency);
    text(this.val, f.text);
    text(this.name, currencyName(this.currency, f.value));
    this.el.dataset.value = String(f.value);
    show(this.bank, f.bank !== null);
    text(this.bank, f.bankText);
    attr(this.el, 'aria-label', f.label);
    this.el.title = `${f.exact} ${currencyName(this.currency, f.value)}${f.bank === null ? '' : ` · Quartermaster bank ${exactNum(f.bank)}`}. ${CURRENCIES[this.currency].hint}`;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const k = flashKind(this.prev, f.value, this.currency, now - this.gainAt);
    this.prev = f.value;
    if (k && motionOk()) this.flash(k, now);
  }
  private flash(k: 'gain' | 'spend', now: number): void {
    if (k === 'gain') this.gainAt = now;
    this.val.classList.remove('flash-gain', 'flash-spend');
    void this.val.offsetWidth;   // restart the animation
    this.val.classList.add(`flash-${k}`);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.val.classList.remove('flash-gain', 'flash-spend'), 700);
  }
}

/** The pinned bar on the tab screens (Shell puts it under the status strip, outside every scroller). */
export class WalletBar {
  readonly el: HTMLElement;
  private readonly figs = new Map<Currency, Figure>();
  private key = '';
  constructor() {
    this.el = h('div', { class: 'wallet-bar', attrs: { role: 'group', 'aria-label': 'Your balance' } });
    for (const c of Object.keys(CURRENCIES) as Currency[]) {
      const f = new Figure(c);
      f.el.hidden = true;
      this.figs.set(c, f);
      this.el.appendChild(f.el);
    }
    this.el.hidden = true;
  }
  /** The currencies on show (tests, e2e). */
  get shown(): Currency[] { return [...this.figs.values()].filter((f) => !f.el.hidden).map((f) => f.currency); }
  update(ui: WalletState, v: WalletView, f: WalletFeatures): void {
    const list = walletCurrencies(v, ui, f);
    const key = list.join(',');
    if (key !== this.key) {
      this.key = key;
      for (const [c, fig] of this.figs) show(fig.el, list.includes(c));
      show(this.el, list.length > 0);
      document.body.classList.toggle('wallet-scrap', list.includes('scrap'));
    }
    for (const c of list) this.figs.get(c)!.update(ui);
  }
}

// ---------------------------------------------------------------- dialogs

interface LiveChip { el: HTMLElement; figs: Figure[]; after: HTMLElement; afterFn?: (ui: WalletState) => string; seen: boolean; born: number }
const live = new Set<LiveChip>();

/**
 * "You have ◆ 12 Cores" for a dialog header (modal.ts `wallet`). `after` adds a computed tail, e.g. the Echoes a
 * Prestige leaves you with. Stays live while it is in the document (updateLiveWallets).
 */
export function walletChip(currencies: readonly Currency[], ui: WalletState | null, after?: (ui: WalletState) => string): HTMLElement {
  const figs = currencies.map((c) => new Figure(c));
  const tail = h('span', { class: 'wc-after' });
  const el = h('p', { class: 'wallet-chip', attrs: { role: 'status' } }, h('span', { class: 'wc-lead', text: 'You have' }), ...figs.map((f) => f.el), tail);
  const chip: LiveChip = { el, figs, after: tail, afterFn: after, seen: false, born: Date.now() };
  live.add(chip);
  if (ui) paintChip(chip, ui);
  return el;
}

function paintChip(c: LiveChip, ui: WalletState): void {
  for (const f of c.figs) f.update(ui);
  const t = c.afterFn ? c.afterFn(ui) : '';
  text(c.after, t);
  show(c.after, t !== '');
}

/** Refresh every dialog wallet on screen (GameUi, every UiState); chips whose dialog closed are dropped. */
export function updateLiveWallets(ui: WalletState): void {
  for (const c of live) {
    // closed (or never shown within a few seconds of being made): forget it
    if (!c.el.isConnected) { if (c.seen || Date.now() - c.born > 5000) live.delete(c); continue; }
    c.seen = true;
    paintChip(c, ui);
  }
}
