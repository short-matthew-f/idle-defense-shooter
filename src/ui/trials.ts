/** Trials (design §16): list with constraint, reward and tiers done; Start / End. */
import '../styles/trials.css';
import type { TrialId } from '@sim/core/ids';
import type { UiState } from '@sim/core/types';
import { button, h, clear } from './dom';
import { icon } from './icons';
import { TRIALS } from '@sim/data/index';
import { confirmDialog } from './modal';
import { prefs, setPref } from './prefs';
import type { UiCtx } from './ctx';
import { nodeGate } from './echo-tiers';

/** The active Trial (UiState.activeTrial = meta.activeTrial); before the first UiState, what this device started. */
export function activeTrial(ui: UiState | null): TrialId | null {
  if (ui) return ui.activeTrial ?? ui.meta.activeTrial ?? null;
  return prefs().activeTrial;
}
export function trialName(id: TrialId | null): string | null { return id ? TRIALS.find((t) => t.id === id)?.name ?? id : null; }

/** The text of the collapsed card: "10 Trials unlock at: Reach wave 40 · buy Trials (120 Echoes)". Pure (tests). */
export function lockedTrialsText(n: number, deepestEver: number): string {
  return `${n} Trial${n === 1 ? '' : 's'} unlock at: ${nodeGate('trials', deepestEver)?.text ?? 'a later Echo upgrade'}.`;
}

function lockedTrialsCard(deepestEver: number): HTMLElement {
  return h('div', { class: 'locked-card trials-locked' }, icon('lock', 'ico'),
    h('div', null,
      h('p', { class: 'tl-head', text: lockedTrialsText(TRIALS.length, deepestEver) }),
      h('p', { class: 'dim small', text: 'A Trial is a separate run slot: your main run pauses and is preserved. Each has a constraint and a permanent reward.' }),
      h('p', { class: 'dim small', text: TRIALS.map((t) => t.name).join(' · ') })));
}

export class TrialsPanel {
  shown = false;
  readonly el = h('div', { class: 'trials' });
  /** After a Trial starts: go back to Battle (the shell wires it). */
  onStarted: (() => void) | null = null;
  private key = '';
  constructor(private readonly ctx: UiCtx) {}
  get isOpen(): boolean { return this.shown; }

  setShown(on: boolean): void {
    this.shown = on;
    if (!on) return;
    this.key = '';
    const ui = this.ctx.state(); if (ui) this.update(ui);
  }

  update(ui: UiState): void {
    if (!this.isOpen) return;
    const unlocked = (ui.meta.prestigeRanks['prestige.trials'] | 0) > 0;
    const act = activeTrial(ui);
    const key = JSON.stringify([unlocked, act, ui.meta.trials, unlocked ? 0 : ui.meta.deepestEver >= (nodeGate('trials', 0)?.wave ?? 0)]);
    if (key === this.key) return;
    this.key = key;
    clear(this.el);
    this.el.appendChild(h('p', { class: 'dim small', text: 'Three tiers each: reach waves 30, 60 and 90 under the constraint. Echo upgrades apply.' }));
    if (!unlocked) {
      // one card instead of a dim Start button per Trial
      this.el.appendChild(lockedTrialsCard(ui.meta.deepestEver));
      return;
    }
    for (const t of TRIALS) {
      const done = ui.meta.trials[t.id] ?? 0;
      const pips = h('div', { class: 'tiers', attrs: { 'aria-label': `${done} of 3 tiers complete` } },
        ...t.tiers.map((w, i) => h('span', { class: `tier${i < done ? ' done' : ''}` }, i < done ? icon('check', 'ico tiny') : null, `W${w}`)));
      const isAct = act === t.id;
      const btn = isAct
        ? button('End trial', async () => { if (await confirmDialog('End this Trial?', 'Progress is recorded and the main run resumes.', 'End trial')) { this.ctx.host.send({ type: 'end_trial' }); setPref('activeTrial', null); } }, { class: 'btn danger' })
        : button('Start', async () => {
          if (!(await confirmDialog(`Start ${t.name}?`, `${t.constraint} Your main run pauses and is preserved until you end the Trial.`, 'Start'))) return;
          this.ctx.host.send({ type: 'start_trial', trial: t.id });
          setPref('activeTrial', t.id);
          this.onStarted?.();
        }, { class: 'btn primary', disabled: !unlocked || act !== null });
      this.el.appendChild(h('div', { class: `trial${isAct ? ' active' : ''}${done >= 3 ? ' complete' : ''}` },
        h('div', { class: 'trial-main' }, h('div', { class: 'trial-name', text: t.name }),
          h('p', { class: 'trial-c' }, h('b', { text: 'Constraint: ' }), t.constraint),
          h('p', { class: 'trial-r' }, h('b', { text: `Reward (first tier, wave ${t.tiers[0]}): ` }), t.reward, done > 0 ? h('span', { class: 'trial-got', text: ' · earned' }) : null), pips),
        btn));
    }
  }
}
