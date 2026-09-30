/**
 * Anomaly draft: three cards (name, rarity by shape + label + colour, desc, "needs" tags);
 * Pick / Skip (+1 Core) / Reroll (1 Core). When sockets are full, picking asks which socketed
 * Anomaly to replace.
 */
import '../styles/draft.css';
import type { AnomalyId, AnomalyRarity } from '@sim/core/ids';
import type { UiState } from '@sim/core/types';
import { button, h } from './dom';
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
    // Reachability: a Frame's free mount or a Borrowed Blade counts too (ui.extraSystems)
    const have = !ui || n === 'primary' || ui.build.hardpoints.includes(n as never) || ui.build.attunements.includes(n as never) || (ui.extraSystems ?? []).some((x) => x.system === n);
    return h('span', { class: `tag${have ? '' : ' missing'}`, text: `${have ? '' : 'Needs '}${n === 'primary' ? 'Primary' : TREE_LABEL[n as keyof typeof TREE_LABEL] ?? titleCase(n)}`, title: have ? 'Your build has this' : 'Your build lacks this system' });
  });
  return h('div', { class: `anomaly-card r-${rarity}` },
    h('div', { class: 'an-rarity' }, rarityIcon(rarity, 'ico'), RARITY_LABEL[rarity]),
    h('div', { class: 'an-name', text: a?.name ?? titleCase(id) }),
    h('p', { class: 'an-desc', text: a?.desc ?? '' }),
    needs.length ? h('div', { class: 'an-needs' }, ...needs) : null,
    extra ?? null);
}

export class DraftModal {
  private modal: ModalHandle | null = null;
  private key = '';
  /** The draft the player set aside with "Later" (the Build tab badge and screen bring it back). */
  private laterKey = '';
  private offers = '';
  private readonly note = h('p', { class: 'draft-timer', text: 'The run keeps going while you decide. Nothing is picked for you: set it aside with Later and find it on the Build tab.' });
  constructor(private readonly ctx: UiCtx) {}

  update(ui: UiState): void {
    const d = ui.run.pendingDraft;
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
    const later = button('Later', () => { this.laterKey = this.offers; this.close(); }, { class: 'btn ghost', title: 'Decide later from the Build screen; the offer waits for you' });
    const reroll = button(['Reroll', h('span', { class: 'price cores' }, '1', icon('cores', 'ico tiny'))], () => this.ctx.host.send({ type: 'reroll_anomaly' }), { class: 'btn', disabled: ui.run.cores < 1, label: 'Reroll for 1 Core' });
    if (ui.run.cores < 1) reroll.title = 'Needs 1 Core';
    const body = h('div', { class: 'draft' },
      h('p', { class: 'dim', text: `Anomalies bend the rules for this Prestige. Sockets: ${ui.build.anomalies.length}/${ui.build.anomalySockets}${full ? ' (full: picking replaces one)' : ''}.` }),
      cards, this.note);
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
      const loss = replaceLoss(cur, ui);
      list.appendChild(anomalyCard(cur, ui, h('div', { class: 'an-replace' }, loss ? h('p', { class: 'node-lock', text: loss }) : null,
        button('Replace this', () => { m.close(); this.pick(id, i); }, { class: 'btn danger' }))));
    });
  }
}

/**
 * Reachability: what the player loses with an Anomaly that grants a capability (so a replace is never a silent loss), or null.
 */
export function replaceLoss(id: AnomalyId, ui: Pick<UiState, 'build' | 'extraSystems' | 'meta'>): string | null {
  const b = ui.build;
  switch (id) {
    case 'spare_barrel': return b.secondDoctrines.ballistics ? 'Your second Barrel Doctrine stops running.' : null;
    case 'borrowed_blade': return (ui.extraSystems ?? []).some((x) => x.via === 'borrowed') ? 'The borrowed Orbital Blade leaves (its ranks stop working).' : null;
    case 'second_opinion': return (ui.meta.trials.commander ?? 0) > 0 ? null : 'You lose the second Target Designator.';
    case 'recursive_warhead': return (b.ranks['ordnance.cluster_warheads'] | 0) > 0 ? null : 'Missiles stop splitting (Cluster Warheads was free from this Anomaly).';
    default: return null;
  }
}
