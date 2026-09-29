/**
 * Event feed: small transient toasts (Checkpoint, Core drop, Anomaly draft ready, Counter scored,
 * Codex discovery, Prestige recommended). At most 4 at once; announced politely to screen readers.
 */
import '../styles/feed.css';
import { Ev, type SimEvent, type UiState } from '@sim/core/types';
import { h } from './dom';
import { icon } from './icons';
import { titleCase } from './format';
import type { ToastKind } from './ctx';

const ICON: Record<ToastKind, string> = { info: 'info', good: 'check', warn: 'info', core: 'cores', codex: 'codex' };

export class Feed {
  readonly el = h('div', { class: 'feed', attrs: { 'aria-live': 'polite', role: 'status' } });
  private lastDraft = '';
  private lastRec = false;
  private lastGate = false;
  private lastSlots: { hp: number; at: number } | null = null;

  toast(msg: string, kind: ToastKind = 'info', ms = 3600): void {
    const t = h('div', { class: `toast t-${kind}` }, icon(ICON[kind], 'ico tiny'), h('span', { text: msg }));
    this.el.appendChild(t);
    while (this.el.children.length > 4) this.el.firstElementChild?.remove();
    window.setTimeout(() => { t.classList.add('out'); window.setTimeout(() => t.remove(), 300); }, ms);
  }

  /** Worker event batches (non-Hit/Spawn events since the last batch). */
  onEvents(events: readonly SimEvent[]): void {
    let cores = 0;
    for (const e of events) {
      if (e.type === Ev.Checkpoint) this.toast(`Checkpoint: wave ${e.a} cleared`, 'good');
      else if (e.type === Ev.CoreDrop) cores += e.a || 1;
      else if (e.type === Ev.CounterScored) this.toast('Counter! Weak point open', 'good');
      else if (e.type === Ev.Codex) this.toast(`Codex: ${titleCase(e.src)}`, 'codex');
      else if (e.type === Ev.BossKilled) this.toast('Boss destroyed', 'good');
      else if (e.type === Ev.Prestige) this.toast('Prestige complete: a new machine begins', 'good');
      else if (e.type === Ev.Ascend) this.toast('Ascension complete', 'good');
    }
    if (cores > 0) this.toast(`+${cores} Core${cores > 1 ? 's' : ''}`, 'core');
  }

  /** State edges: draft ready, Prestige recommended. */
  update(ui: UiState): void {
    const d = ui.run.pendingDraft ? ui.run.pendingDraft.join(',') : '';
    if (d && d !== this.lastDraft) this.toast('Anomaly draft ready', 'info');
    this.lastDraft = d;
    // A new slot is the biggest power step in the early game and nothing else announces it.
    const hp = ui.run.hardpointSlotsOpen, at = ui.run.attunementSlotsOpen;
    if (this.lastSlots) {
      if (at > this.lastSlots.at && ui.build.attunements.filter(Boolean).length < at) this.toast('Attunement slot open: attune an element (Build or Upgrades)', 'good', 6000);
      if (hp > this.lastSlots.hp && ui.build.hardpoints.filter(Boolean).length < hp) this.toast('Hardpoint slot open: mount a weapon system (Build or Upgrades)', 'good', 6000);
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
