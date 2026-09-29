/**
 * Anomaly draft: three cards (name, rarity by shape + label + colour, desc, "needs" tags);
 * Pick / Skip (+1 Core) / Reroll (1 Core). When sockets are full, picking asks which socketed
 * Anomaly to replace.
 */
import '../styles/draft.css';
import type { AnomalyId, AnomalyRarity } from '@sim/core/ids';
import type { UiState } from '@sim/core/types';
import { button, h, text } from './dom';
import { rarityIcon } from './icons';
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

/** The sim auto-picks the first offer after 30 s in the draft phase (run/machine.ts PHASE_TICKS.draftAuto). */
export const DRAFT_AUTO_TICKS = 30 * 60;

/** Seconds left before the auto-pick (pure). `draftStart` = tick the draft phase began, or null if not yet. */
export function draftSecondsLeft(tick: number, draftStart: number | null): number {
  if (draftStart === null) return DRAFT_AUTO_TICKS / 60;
  return Math.max(0, Math.ceil((DRAFT_AUTO_TICKS - (tick - draftStart)) / 60));
}

export class DraftModal {
  private modal: ModalHandle | null = null;
  private key = '';
  private draftStart: number | null = null;
  private readonly countdown = h('p', { class: 'draft-timer', attrs: { 'aria-live': 'off' } });
  constructor(private readonly ctx: UiCtx) {}

  update(ui: UiState): void {
    const d = ui.run.pendingDraft;
    // Unattended towers never stall: say so, with the time left, instead of silently auto-picking.
    if (!d) this.draftStart = null;
    else if (ui.run.phase === 'draft' && this.draftStart === null) this.draftStart = ui.tick;
    if (d && d.length) {
      const first = ANOMALY_BY_ID.get(d[0])?.name ?? titleCase(d[0]);
      text(this.countdown, `If you don't choose, ${first} is picked automatically in ${draftSecondsLeft(ui.tick, this.draftStart)}s.`);
    }
    const key = d ? d.join(',') + `|${ui.run.cores}|${ui.build.anomalies.join(',')}` : '';
    if (key === this.key && (!!this.modal?.open === !!d)) return;
    this.key = key;
    this.modal?.close();
    this.modal = null;
    if (d && d.length) this.show(ui, d);
  }

  private show(ui: UiState, offers: AnomalyId[]): void {
    const full = ui.build.anomalies.length >= ui.build.anomalySockets;
    const cards = h('div', { class: 'draft-cards' });
    for (const id of offers) {
      cards.appendChild(anomalyCard(id, ui, button('Pick', () => (full ? this.replace(id) : this.pick(id)), { class: 'btn primary' })));
    }
    const skip = button('Skip (+1 Core)', () => this.ctx.host.send({ type: 'pick_anomaly', anomaly: null }), { class: 'btn' });
    const reroll = button('Reroll (1 Core)', () => this.ctx.host.send({ type: 'reroll_anomaly' }), { class: 'btn', disabled: ui.run.cores < 1 });
    if (ui.run.cores < 1) reroll.title = 'Needs 1 Core';
    const body = h('div', { class: 'draft' },
      h('p', { class: 'dim', text: `Anomalies bend the rules for this Prestige. Sockets: ${ui.build.anomalies.length}/${ui.build.anomalySockets}${full ? ' (full: picking replaces one)' : ''}.` }),
      cards, this.countdown);
    this.modal = openModal({ title: 'Anomaly draft', body, footer: h('div', { class: 'row end gap' }, reroll, skip), dismissable: false, variant: 'wide', className: 'draft-modal' });
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
