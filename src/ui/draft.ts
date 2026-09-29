/**
 * Anomaly draft: three cards (name, rarity by shape + label + colour, desc, "needs" tags);
 * Pick / Skip (+1 Core) / Reroll (1 Core). When sockets are full, picking asks which socketed
 * Anomaly to replace.
 */
import '../styles/draft.css';
import type { AnomalyId, AnomalyRarity } from '@sim/core/ids';
import type { UiState } from '@sim/core/types';
import { TICK_RATE } from '@sim/core/types';
import { button, h, text } from './dom';
import { icon, rarityIcon } from './icons';
import { ANOMALY_BY_ID, TREE_LABEL } from './content';
import { openModal, type ModalHandle } from './modal';
import { titleCase } from './format';
import type { UiCtx } from './ctx';

export const RARITY_LABEL: Record<AnomalyRarity, string> = { common: 'Common', rare: 'Rare', paradox: 'Paradox', cursed: 'Cursed' };

export function anomalyCard(id: AnomalyId, ui: UiState | null, extra?: HTMLElement): HTMLElement {
  const a = ANOMALY_BY_ID.get(id);
  const rarity = a?.rarity ?? 'common';
  const needs = (a?.needs ?? []).map((n) => {
    const have = !ui || n === 'primary' || ui.build.hardpoints.includes(n as never) || ui.build.attunements.includes(n as never);
    return h('span', { class: `tag${have ? '' : ' missing'}`, text: `${have ? '' : 'Needs '}${n === 'primary' ? 'Primary' : TREE_LABEL[n as keyof typeof TREE_LABEL] ?? titleCase(n)}`, title: have ? 'Your build has this' : 'Your build lacks this system' });
  });
  return h('div', { class: `anomaly-card r-${rarity}` },
    h('div', { class: 'an-rarity' }, rarityIcon(rarity, 'ico'), RARITY_LABEL[rarity]),
    h('div', { class: 'an-name', text: a?.name ?? titleCase(id) }),
    h('p', { class: 'an-desc', text: a?.desc ?? '' }),
    needs.length ? h('div', { class: 'an-needs' }, ...needs) : null,
    extra ?? null);
}

/** Whole seconds left before the sim auto-picks (pure), from UiState.run.draftTicksLeft; null = no countdown running. */
export function draftSecondsLeft(ticksLeft: number | null): number | null {
  return ticksLeft === null ? null : Math.max(0, Math.ceil(ticksLeft / TICK_RATE));
}

export class DraftModal {
  private modal: ModalHandle | null = null;
  private key = '';
  /** The draft the player set aside with "Later" (the Build tab badge and screen bring it back). */
  private laterKey = '';
  private offers = '';
  private readonly countdown = h('p', { class: 'draft-timer', attrs: { 'aria-live': 'off' } });
  constructor(private readonly ctx: UiCtx) {}

  update(ui: UiState): void {
    const d = ui.run.pendingDraft;
    // Unattended towers never stall: say so, with the time left (the sim's own deadline), instead of silently auto-picking.
    if (d && d.length) {
      const first = ANOMALY_BY_ID.get(d[0])?.name ?? titleCase(d[0]);
      const secs = draftSecondsLeft(ui.run.draftTicksLeft);
      text(this.countdown, secs === null
        ? `If you don't choose, ${first} is picked automatically 30s after the current wave ends.`
        : `If you don't choose, ${first} is picked automatically in ${secs}s.`);
    }
    const key = d ? d.join(',') + `|${ui.run.cores}|${ui.build.anomalies.join(',')}` : '';
    const offers = d ? d.join(',') : '';
    if (offers !== this.offers) { this.offers = offers; this.laterKey = ''; }   // a new draft always shows itself
    const later = !!offers && this.laterKey === offers;
    if (key === this.key && (!!this.modal?.open === (!!d && !later))) return;
    this.key = key;
    this.close();
    if (d && d.length && !later) this.show(ui, d);
  }

  get pending(): boolean { return !!this.offers; }

  /** Bring a set-aside draft back (Build screen, tab badge). */
  open(): void {
    this.laterKey = '';
    this.key = '';
    const ui = this.ctx.state();
    if (ui) this.update(ui);
  }

  private close(): void {
    const m = this.modal;
    this.modal = null;
    m?.close();
  }

  private show(ui: UiState, offers: AnomalyId[]): void {
    const full = ui.build.anomalies.length >= ui.build.anomalySockets;
    const cards = h('div', { class: 'draft-cards' });
    for (const id of offers) {
      cards.appendChild(anomalyCard(id, ui, button('Pick', () => (full ? this.replace(id) : this.pick(id)), { class: 'btn primary' })));
    }
    const skip = button(['Skip', h('span', { class: 'price cores' }, '+1', icon('cores', 'ico tiny'))], () => this.ctx.host.send({ type: 'pick_anomaly', anomaly: null }), { class: 'btn', label: 'Skip: gain 1 Core' });
    const later = button('Later', () => { this.laterKey = this.offers; this.close(); }, { class: 'btn ghost', title: 'Decide from the Build screen; the draft still auto-picks when its timer runs out' });
    const reroll = button(['Reroll', h('span', { class: 'price cores' }, '1', icon('cores', 'ico tiny'))], () => this.ctx.host.send({ type: 'reroll_anomaly' }), { class: 'btn', disabled: ui.run.cores < 1, label: 'Reroll for 1 Core' });
    if (ui.run.cores < 1) reroll.title = 'Needs 1 Core';
    const body = h('div', { class: 'draft' },
      h('p', { class: 'dim', text: `Anomalies bend the rules for this Prestige. Sockets: ${ui.build.anomalies.length}/${ui.build.anomalySockets}${full ? ' (full: picking replaces one)' : ''}.` }),
      cards, this.countdown);
    this.modal = openModal({ title: 'Anomaly draft', body, footer: h('div', { class: 'draft-foot' }, later, reroll, skip), variant: 'wide', className: 'draft-modal',
      onClose: () => { if (this.modal) { this.modal = null; this.laterKey = this.offers; } } });
  }

  private pick(id: AnomalyId, replace?: number): void {
    this.ctx.host.send(replace === undefined ? { type: 'pick_anomaly', anomaly: id } : { type: 'pick_anomaly', anomaly: id, replace });
  }

  private replace(id: AnomalyId): void {
    const ui = this.ctx.state();
    if (!ui) return;
    const list = h('div', { class: 'draft-cards replace' });
    const m = openModal({ title: `Replace which Anomaly with ${ANOMALY_BY_ID.get(id)?.name ?? id}?`, body: list, variant: 'wide' });
    ui.build.anomalies.forEach((cur, i) => {
      list.appendChild(anomalyCard(cur, ui, button('Replace this', () => { m.close(); this.pick(id, i); }, { class: 'btn danger' })));
    });
  }
}
