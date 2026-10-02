/**
 * Prestige modal: choose the next Frame (caps + trait), an optional Blueprint, the Threat Dial
 * (Prestige III), a Keepsake Anomaly (Prestige II) and a Branch Discount tree, then confirm.
 */
import '../styles/prestige.css';
import type { AnomalyId, FrameId, TreeId } from '@sim/core/ids';
import type { Command, UiState } from '@sim/core/types';
import { button, h, text } from './dom';
import { icon } from './icons';
import { echoesFor, fmtNum } from './format';
import { ANOMALY_BY_ID, FRAME_BY_ID, FRAMES, TREES, TREE_LABEL } from './content';
import type { FrameDef } from '@sim/data/schema';
import { confirmDialog, openModal } from './modal';
import type { UiCtx } from './ctx';
import { openCeremony, useCeremony } from './ceremony';
import { blueprintInPool } from './progression';
import { echoesAfter, walletChip } from './wallet';

type PrestigeCmd = Extract<Command, { type: 'prestige' }>;

export function prestigeRank(ui: UiState, id: string): number { return ui.meta.prestigeRanks[`prestige.${id}`] | 0; }

export function openPrestige(ctx: UiCtx): void {
  const ui = ctx.state();
  if (!ui) return;
  // Reachability: the sim refuses a Prestige during a Trial; say so instead of a dialog that fails
  if (ui.activeTrial) { ctx.toast('Finish or leave the Trial first (More → Trials, or End on the Battle screen)', 'warn'); return; }
  // the first Prestige is a story beat, not a form (ceremony.ts); later ones use this modal unchanged
  if (useCeremony(ui, ctx.features().unlockAll)) { openCeremony(ctx); return; }
  const echoes = ui.forecast?.echoesNow ?? echoesFor(ui.run.deepestCleared, ui.run.threatDial);
  const frames = (ui.meta.unlockedFrames.length ? ui.meta.unlockedFrames : ['standard' as FrameId]);
  let frame: FrameId = frames.includes(ui.build.frame) ? ui.build.frame : frames[0];
  let blueprint: number | undefined;
  let dial = ui.run.threatDial;
  let keepsake: AnomalyId | undefined;
  let discount: TreeId | undefined;

  const frameCards = h('div', { class: 'frame-cards', attrs: { role: 'radiogroup', 'aria-label': 'Frame' } });
  // Reachability: Frames not yet unlocked are listed (disabled) with how to unlock them
  const locked = FRAMES.filter((f) => !frames.includes(f.id));
  const renderFrames = (): void => {
    frameCards.replaceChildren(...frames.map((id) => {
      const f = FRAME_BY_ID.get(id);
      const b = button([
        h('span', { class: 'fr-name', text: f?.name ?? id }),
        h('span', { class: 'fr-caps', text: f ? frameCapsText(f, ui) : '' }),
        h('span', { class: 'fr-trait', text: f?.trait ?? '' }),
      ], () => { frame = id; renderFrames(); }, { class: `frame-card${id === frame ? ' selected' : ''}` });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', id === frame ? 'true' : 'false');
      return b;
    }), ...locked.map((f) => h('div', { class: 'frame-card locked', attrs: { 'aria-disabled': 'true' } },
      h('span', { class: 'fr-name' }, icon('lock', 'ico tiny'), f.name),
      h('span', { class: 'fr-caps', text: `Unlock: ${f.unlock}` }),
      h('span', { class: 'fr-trait', text: f.trait }))));
  };
  renderFrames();

  const sections: HTMLElement[] = [
    h('div', { class: 'pr-gain' }, icon('echo', 'ico'), h('span', { text: `+${fmtNum(echoes)} Echoes` }), h('span', { class: 'dim', text: ` (deepest cleared: wave ${ui.run.deepestCleared})` })),
    h('p', { class: 'dim', text: 'Prestige resets the wave, Scrap, upgrades, Cores and Anomalies. Echoes, Prestige upgrades, the Codex and unlocked Frames stay.' }),
    h('h3', { class: 'sec-title', text: 'Frame' }), frameCards,
  ];

  if (ui.meta.blueprints.length) {
    const sel = h('select', { class: 'select', attrs: { 'aria-label': 'Blueprint' } }, h('option', { attrs: { value: '' }, text: 'No blueprint' }),
      // content pool (progression.ts): a Blueprint naming a system the next Prestige does not offer yet cannot be loaded
      ...ui.meta.blueprints.map((b, i) => {
        const ok = blueprintInPool(b, (ui.meta.prestigeCount | 0) + 1, { unlockAll: ctx.features().unlockAll });
        return h('option', { attrs: { value: String(i), ...(ok ? {} : { disabled: '' }) }, text: `${b.name} (${FRAME_BY_ID.get(b.frame)?.name ?? b.frame})${ok ? '' : ' · needs a later Prestige'}` });
      }));
    sel.addEventListener('change', () => {
      blueprint = sel.value === '' ? undefined : Number(sel.value);
      const bp = blueprint !== undefined ? ui.meta.blueprints[blueprint] : null;
      if (bp && frames.includes(bp.frame)) { frame = bp.frame; renderFrames(); }
    });
    sections.push(h('h3', { class: 'sec-title', text: 'Blueprint' }), sel, h('p', { class: 'dim small', text: 'Mounts, attunements, Doctrines, Targeting Profiles and the Upgrade Queue follow the plan as slots open.' }));
  }

  if (prestigeRank(ui, 'threat_dial') > 0) {
    const max = ui.meta.ascension >= 4 ? 20 : 10;
    const val = h('span', { class: 'dial-val' });
    const range = h('input', { attrs: { type: 'range', min: '0', max: String(max), step: '1', value: String(Math.min(max, dial)), 'aria-label': 'Threat Dial' } }) as HTMLInputElement;
    const sync = (): void => { dial = Number(range.value); text(val, `Level ${dial}: enemy HP +${dial * 12}%, speed +${dial * 3}% · Echoes +${dial * 10}%, Scrap +${dial * 5}%`); };
    range.addEventListener('input', sync);
    sync();
    sections.push(h('h3', { class: 'sec-title', text: 'Threat Dial' }), range, val);
  }

  if (prestigeRank(ui, 'keepsake') > 0 && ui.build.anomalies.length) {
    const sel = h('select', { class: 'select', attrs: { 'aria-label': 'Keepsake' } }, h('option', { attrs: { value: '' }, text: 'Keep nothing' }),
      ...ui.build.anomalies.map((a) => h('option', { attrs: { value: a }, text: ANOMALY_BY_ID.get(a)?.name ?? a })));
    sel.addEventListener('change', () => { keepsake = (sel.value || undefined) as AnomalyId | undefined; });
    sections.push(h('h3', { class: 'sec-title', text: 'Keepsake' }), sel);
  }

  if (prestigeRank(ui, 'dual_doctrine') > 0) {
    sections.push(h('h3', { class: 'sec-title', text: 'Dual Doctrine' }),
      h('p', { class: 'dim small', text: 'The first tree you give a second Doctrine this Prestige runs it at 60% (choose it on that tree\'s Doctrine fork once its first Doctrine is chosen).' }));
  }

  if (prestigeRank(ui, 'branch_discount') > 0) {
    const sel = h('select', { class: 'select', attrs: { 'aria-label': 'Branch Discount tree' } }, h('option', { attrs: { value: '' }, text: 'No discount' }),
      ...TREES.map((t) => h('option', { attrs: { value: t.id }, text: `${t.name} (−25%)` })));
    sel.addEventListener('change', () => { discount = (sel.value || undefined) as TreeId | undefined; });
    sections.push(h('h3', { class: 'sec-title', text: 'Branch Discount' }), sel);
  }

  const go = button([icon('prestige'), 'Prestige'], async () => {
    const ok = await confirmDialog('Prestige now?', `You gain ${fmtNum(echoes)} Echoes and start over at wave 1 as a ${FRAME_BY_ID.get(frame)?.name ?? frame}.`, 'Prestige', { danger: echoes <= 0, wallet: walletChip(['echoes'], ctx.state(), echoesAfter(echoes)) });
    if (!ok) return;
    const cmd: PrestigeCmd = { type: 'prestige', frame };
    if (blueprint !== undefined) cmd.blueprint = blueprint;
    if (prestigeRank(ui, 'threat_dial') > 0) cmd.threatDial = dial;
    if (keepsake) cmd.keepsake = keepsake;
    if (discount) cmd.discountTree = discount;
    ctx.host.send(cmd);
    ctx.host.saveNow();
    m.close();
  }, { class: 'btn primary wide' });
  const m = openModal({ title: 'Prestige', body: h('div', { class: 'prestige' }, ...sections), footer: go, variant: 'wide', className: 'prestige-modal', wallet: walletChip(['echoes'], ui, echoesAfter(echoes)) });
}

/** Hardpoint / attunement caps of a Frame for this player (Expanded Frame, Third Attunement; at most four systems). */
export function frameCapsText(f: FrameDef, ui: Pick<UiState, 'meta'>): string {
  const pr = (id: string): boolean => (ui.meta.prestigeRanks[`prestige.${id}`] | 0) > 0;
  let hc = f.hardpointCap + (pr('expanded_frame') && f.id !== 'monolith' ? 1 : 0);
  hc = Math.max(0, Math.min(hc, 4 - (f.freeMount ? 1 : 0)));
  const ac = f.attunementCap + (pr('third_attunement') ? 1 : 0);
  return `${hc}${f.freeMount ? ` + ${TREE_LABEL[f.freeMount]} (free)` : ''} hardpoint${hc === 1 && !f.freeMount ? '' : 's'} · ${ac} attunement${ac === 1 ? '' : 's'}`;
}
