/**
 * Event feed: small transient toasts (Checkpoint, Core drop, Anomaly draft ready, Counter scored,
 * Codex discovery, Prestige recommended, a stalled wave's Rush). A queue: at most `limit` toasts show at once (4, or as many as the overlay
 * lane has room for on Battle: lanes.ts); the rest wait their turn, and a toast's time on screen only runs while it
 * shows. Announced politely to screen readers.
 */
import '../styles/feed.css';
import { Ev, type SimEvent, type UiState } from '@sim/core/types';
import { h } from './dom';
import { icon } from './icons';
import { titleCase } from './format';
import { boonName } from './boons';
import type { ToastKind } from './ctx';
import type { Features } from './progression';
import { prefs, setPref } from './prefs';

const ICON: Record<ToastKind, string> = { info: 'info', good: 'check', warn: 'info', core: 'cores', codex: 'codex' };

/** Toasts on screen at once when nothing limits them. */
export const FEED_MAX_SHOWN = 4;
/** Toasts kept at all (showing + waiting); past it the oldest waiting one is dropped. */
export const FEED_MAX_QUEUED = 6;
/** A toast that waited this long without ever showing is stale and dropped (ms). */
export const FEED_MAX_WAIT_MS = 20000;
/** "Stragglers rush the tower" (Ev.Rush, run/stall.ts) shows at most once per this long (ms). */
export const RUSH_TOAST_GAP_MS = 60000;

/** Boss-clear news (boss down, checkpoint, Cores, a slot opening) arriving within this long merges into ONE summary toast (ms). */
export const SUMMARY_MS = 3000;
/** The summary's time on screen (ms). */
export const SUMMARY_SHOW_MS = 5000;
/** The first Core's explainer waits this long after the boss-clear beat (ms), so the beat stays one item. */
export const CORE_EXPLAIN_DELAY_MS = 2200;
export const CORE_EXPLAINER = 'Cores: rare. Spend them on rerolls and refits later.';

/** The summary line from its parts in arrival order (duplicates dropped). */
export function summaryText(parts: readonly string[]): string {
  return [...new Set(parts)].join(' · ');
}

interface Item { el: HTMLElement; left: number; queuedAt: number; shownAt: number; timer: number; leaving: boolean }

export class Feed {
  readonly el = h('div', { class: 'feed', attrs: { 'aria-live': 'polite', role: 'status' } });
  /** Called when a toast arrives or leaves (the overlay lanes re-fit). */
  onChange: (() => void) | null = null;
  private items: Item[] = [];
  private limit = FEED_MAX_SHOWN;
  private lastDraft = '';
  private lastRec = false;
  private lastGate = false;
  private lastSlots: { hp: number; at: number } | null = null;
  private lastRush = -Infinity;
  /** The boss-clear summary toast (and until when news merges into it). */
  private summary: { item: Item; parts: string[]; until: number } | null = null;
  /** performance.now() of the last boss kill (the attention plan's celebration beat, attention.ts); -Infinity: none. */
  bossClearAt = -Infinity;

  toast(msg: string, kind: ToastKind = 'info', ms = 3600): void { this.push(msg, kind, ms); }

  private push(msg: string, kind: ToastKind, ms: number): Item {
    const t = h('div', { class: `toast t-${kind}` }, icon(ICON[kind], 'ico tiny'), h('span', { text: msg }));
    t.hidden = true;
    this.el.appendChild(t);
    const item: Item = { el: t, left: ms, queuedAt: performance.now(), shownAt: 0, timer: 0, leaving: false };
    this.items.push(item);
    while (this.items.length > FEED_MAX_QUEUED) {
      const i = this.items.findIndex((x) => !x.shownAt);
      this.drop(i >= 0 && i < this.items.length - 1 ? i : 0);
    }
    this.flush();
    this.onChange?.();
    return item;
  }

  /** Is the boss-clear summary still taking news? */
  private summaryOpen(now = performance.now()): boolean {
    return !!this.summary && now < this.summary.until && this.items.includes(this.summary.item) && !this.summary.item.leaving;
  }

  /** Merge `parts` into the boss-clear summary toast (a new one when none is open). */
  private summarize(parts: readonly string[]): void {
    if (!parts.length) return;
    const now = performance.now();
    if (this.summaryOpen(now)) {
      const s = this.summary!;
      s.parts.push(...parts);
      const span = s.item.el.querySelector('span:last-child');
      if (span) span.textContent = summaryText(s.parts);
      this.onChange?.();
      return;
    }
    const item = this.push(summaryText(parts), 'good', SUMMARY_SHOW_MS);
    this.summary = { item, parts: [...parts], until: now + SUMMARY_MS };
  }

  /** Show at most `n` toasts (the overlay lanes' room; FEED_MAX_SHOWN when unmanaged). */
  fit(n: number): void {
    const v = Math.max(0, Math.min(FEED_MAX_SHOWN, Math.floor(n)));
    if (v === this.limit) return;
    this.limit = v;
    this.flush();
  }

  /** Heights (px) of the queued toasts in display order, as they would show at the feed's current width. */
  heights(): number[] {
    const hid = this.items.filter((x) => x.el.hidden);
    for (const x of hid) x.el.hidden = false;
    const out = this.items.map((x) => x.el.offsetHeight);
    for (const x of hid) x.el.hidden = true;
    return out;
  }

  /** Toasts showing now. */
  get shown(): number { return this.items.filter((x) => !x.el.hidden).length; }

  private drop(i: number): void {
    const x = this.items[i];
    if (!x) return;
    clearTimeout(x.timer);
    x.el.remove();
    this.items.splice(i, 1);
  }

  /** The first `limit` toasts show (their clocks run); the rest wait (clocks paused); stale waiting ones go. */
  private flush(): void {
    const now = performance.now();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const x = this.items[i];
      if (!x.shownAt && x.el.hidden && now - x.queuedAt > FEED_MAX_WAIT_MS) this.drop(i);
    }
    this.items.forEach((x, i) => {
      const on = i < this.limit || x.leaving;
      if (on && x.el.hidden) {
        x.el.hidden = false;
        x.shownAt = now;
        x.timer = window.setTimeout(() => this.expire(x), Math.max(300, x.left));
      } else if (!on && !x.el.hidden) {
        clearTimeout(x.timer);
        x.left = Math.max(1200, x.left - (now - x.shownAt));   // it comes back with what it had left (at least a glance)
        x.el.hidden = true;
      }
    });
  }

  private expire(x: Item): void {
    x.leaving = true;
    x.el.classList.add('out');
    window.setTimeout(() => {
      const i = this.items.indexOf(x);
      if (i >= 0) this.drop(i);
      this.flush();
      this.onChange?.();
    }, 300);
  }

  /** Worker event batches (non-Hit/Spawn events since the last batch). */
  onEvents(events: readonly SimEvent[]): void {
    let cores = 0;
    const beat: string[] = [];
    for (const e of events) {
      if (e.type === Ev.Checkpoint) beat.push(`Checkpoint: wave ${e.a}`);
      else if (e.type === Ev.CoreDrop) cores += e.a || 1;
      else if (e.type === Ev.CounterScored) this.toast('Counter! Weak point open', 'good');
      else if (e.type === Ev.Codex) this.toast(`Codex: ${e.src.startsWith('boon.') ? `${boonName(e.src)} (boon)` : titleCase(e.src)}`, 'codex');
      else if (e.type === Ev.BossKilled) { beat.unshift('Boss destroyed'); this.bossClearAt = performance.now(); }
      else if (e.type === Ev.Prestige) this.toast('Prestige complete: a new machine begins', 'good');
      else if (e.type === Ev.Ascend) this.toast('Ascension complete', 'good');
      else if (e.type === Ev.Rush) this.rush();
    }
    // one beat at a boss clear: boss down, checkpoint, Cores (and a slot opening, update()) in ONE line
    if (cores > 0) beat.push(`+${cores} Core${cores > 1 ? 's' : ''}`);
    this.summarize(beat);
    if (cores > 0 && !prefs().coreExplained) {
      setPref('coreExplained', true);
      window.setTimeout(() => this.toast(CORE_EXPLAINER, 'core', 6000), CORE_EXPLAIN_DELAY_MS);
    }
  }

  /** Anti-stall Rush (a stalled wave's enemies charge the tower): a subtle, rate-limited note. */
  private rush(): void {
    const now = performance.now();
    if (now - this.lastRush < RUSH_TOAST_GAP_MS) return;
    this.lastRush = now;
    this.toast('Stragglers rush the tower', 'info', 2800);
  }

  /** A slot opened: part of the boss-clear summary while it is open, else its own toast. */
  private slot(short: string, long: string): void {
    if (this.summaryOpen()) this.summarize([short]);
    else this.toast(long, 'good', 6000);
  }

  /** State edges: draft ready, Prestige recommended. Slot toasts wait for their category to be revealed (progression.ts). */
  update(ui: UiState, f?: Pick<Features, 'elements' | 'hardpoints'>): void {
    const d = ui.run.pendingDraft ? ui.run.pendingDraft.join(',') : '';
    // at a boss clear the draft presents itself after the beat (attention.ts): no separate toast then
    if (d && d !== this.lastDraft && !this.summaryOpen()) this.toast('Anomaly draft ready', 'info');
    this.lastDraft = d;
    // A new slot is the biggest power step in the early game and nothing else announces it.
    // Before its category is revealed the coach banner announces it instead (progression.ts, coach.ts).
    const hp = ui.run.hardpointSlotsOpen, at = ui.run.attunementSlotsOpen;
    if (this.lastSlots) {
      if (at > this.lastSlots.at && (!f || f.elements) && ui.build.attunements.filter(Boolean).length < at) this.slot('Attunement slot open', 'Attunement slot open: attune an element (Build or Upgrades)');
      if (hp > this.lastSlots.hp && (!f || f.hardpoints) && ui.build.hardpoints.filter(Boolean).length < hp) this.slot('Hardpoint slot open', 'Hardpoint slot open: mount a weapon system (Build or Upgrades)');
    }
    this.lastSlots = { hp, at };
    const rec = !!ui.forecast?.recommended;
    if (rec && !this.lastRec) this.toast('Prestige recommended: see the Prestige tab', 'warn', 6000);
    this.lastRec = rec;
    // The run machine parks Push at wave 100 until Ascension V opens the Deep Waves (run/machine.ts).
    const gate = ui.run.mode === 'push' && ui.run.wave >= 100 && ui.run.deepestCleared >= 100 && ui.meta.ascension < 5;
    if (gate && !this.lastGate) this.toast('Wave 100 cleared: the Deep Waves open at Ascension V. Ascend from Prestige → Ascension, or Patrol meanwhile.', 'warn', 9000);
    this.lastGate = gate;
  }
}
