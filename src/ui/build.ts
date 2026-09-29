/**
 * Build screen (design §4, "why did my build converge"): every commitment of this Prestige on one
 * page — Frame, Hardpoint and Attunement slots, the Doctrine per tree, Anomaly sockets, ability
 * slots, and the Cores balance with what Cores buy. It reuses the shop's slot pickers, Refit dialog,
 * Doctrine fork cards (by opening the tree in Upgrades) and Cores tab rather than duplicating them.
 */
import '../styles/build.css';
import type { DoctrineId, TreeId } from '@sim/core/ids';
import type { UiState } from '@sim/core/types';
import { button, h, clear } from './dom';
import { abilityIcon, icon } from './icons';
import { fmtNum } from './format';
import { ABILITY_BY_ID, CHASSIS, ELEMENT_BLURB, FRAME_BY_ID, HARDPOINT_BLURB, NODE_BY_ID, TREE_BY_ID, TREE_LABEL } from './content';
import { anomalyCard } from './draft';
import { openModal } from './modal';
import type { Shop } from './shop';
import type { AbilityBar } from './abilities';
import type { DraftModal } from './draft';
import type { UiCtx } from './ctx';

const REFIT_CORES = 3;

function row(ico: Node, name: string | Node, sub: string | Node | null, actions: (HTMLElement | null)[] = [], cls = ''): HTMLElement {
  return h('div', { class: `bs-row ${cls}` },
    h('span', { class: 'bs-ico' }, ico),
    h('div', { class: 'bs-main' }, h('div', { class: 'bs-name' }, name), sub ? h('div', { class: 'bs-sub' }, sub) : null),
    actions.some(Boolean) ? h('div', { class: 'bs-act' }, ...actions) : null);
}

function section(title: string, sub: string | null, ...rows: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'bs-section' }, h('h3', { class: 'sec-title' }, title, sub ? h('span', { class: 'sec-sub', text: sub }) : null), h('div', { class: 'bs-list' }, ...rows));
}

/** Build-screen key: rebuild only when a commitment (or what can be afforded for it) changes. */
export function buildKey(ui: UiState): string {
  const b = ui.build, r = ui.run;
  const docs = ui.shop.filter((e) => e.kind === 'doctrine').map((e) => `${e.node}:${e.cost}:${e.affordable ? 1 : 0}:${e.locked ?? ''}`).join(',');
  return JSON.stringify([b.frame, b.hardpoints, b.attunements, b.doctrines, b.secondDoctrines, b.anomalies, b.anomalySockets, b.abilities,
    r.hardpointSlotsOpen, r.attunementSlotsOpen, ui.nextHardpointWave, ui.nextAttunementWave, r.cores, r.pendingDraft, docs,
    CHASSIS.map((t) => sharedOwned(ui, t))]);
}

/** Core (shared) nodes of `tree` with at least one rank. */
function sharedOwned(ui: UiState, tree: TreeId): number {
  const t = TREE_BY_ID.get(tree);
  return t ? t.shared.filter((n) => (ui.build.ranks[n.id] | 0) > 0).length : 0;
}

export class BuildScreen {
  readonly el = h('div', { class: 'build' });
  shown = false;
  private key = '';

  constructor(private readonly ctx: UiCtx, private readonly shop: Shop, private readonly abilities: AbilityBar, private readonly draft: DraftModal) {}

  setShown(on: boolean): void {
    this.shown = on;
    if (on) { this.key = ''; const ui = this.ctx.state(); if (ui) this.update(ui); }
  }

  update(ui: UiState): void {
    if (!this.shown) return;
    const key = buildKey(ui);
    if (key === this.key) return;
    this.key = key;
    const y = this.el.parentElement?.scrollTop ?? 0;
    clear(this.el);
    if (this.draft.pending) this.el.append(button([icon('info', 'ico'), h('span', { class: 'bs-name', text: 'An Anomaly draft is waiting: choose one' }), icon('right', 'ico tiny chev')], () => this.draft.open(), { class: 'btn bs-draft top' }));
    this.el.append(this.frame(ui), this.hardpoints(ui), this.attunements(ui), this.doctrines(ui), this.anomalies(ui), this.abilitySlots(ui), this.cores(ui));
    if (this.el.parentElement) this.el.parentElement.scrollTop = y;
  }

  private frame(ui: UiState): HTMLElement {
    const f = FRAME_BY_ID.get(ui.build.frame);
    const caps = f ? `${f.hardpointCap}${f.freeMount ? ` + ${TREE_LABEL[f.freeMount]}` : ''} hardpoints · ${f.attunementCap} attunements` : '';
    return h('section', { class: 'bs-frame' },
      h('div', { class: 'bs-frame-head' }, icon('shield', 'ico big'),
        h('div', null, h('div', { class: 'bs-frame-label', text: 'Frame' }), h('div', { class: 'bs-frame-name', text: f?.name ?? ui.build.frame }))),
      h('p', { class: 'bs-frame-trait', text: f?.trait ?? '' }),
      h('p', { class: 'bs-frame-caps' }, caps, h('span', { class: 'dim', text: ' · a new Frame is chosen at Prestige' })));
  }

  private slotRows(ui: UiState, isEl: boolean): HTMLElement[] {
    const f = FRAME_BY_ID.get(ui.build.frame);
    const list = isEl ? ui.build.attunements : ui.build.hardpoints;
    const open = isEl ? ui.run.attunementSlotsOpen : ui.run.hardpointSlotsOpen;
    const cap = f ? (isEl ? f.attunementCap : f.hardpointCap + (f.freeMount ? 1 : 0)) : open;
    const next = isEl ? ui.nextAttunementWave : ui.nextHardpointWave;
    const total = Math.max(cap, list.length, open);
    const out: HTMLElement[] = [];
    for (let i = 0; i < total; i++) {
      const id = list[i];
      if (id) {
        const name = TREE_LABEL[id as TreeId] ?? id;
        const doc = ui.build.doctrines[id as TreeId];
        const docName = doc ? TREE_BY_ID.get(id as TreeId)?.doctrines.find((d) => d.id === doc)?.name : null;
        const blurb = isEl ? ELEMENT_BLURB[id as never] : HARDPOINT_BLURB[id as never];
        out.push(row(h('span', { class: 'bs-num', text: String(i + 1) }), name,
          docName ? h('span', null, h('span', { class: 'bs-doc', text: `${docName} Doctrine` }), h('br'), blurb) : blurb,
          [button(['Tree', icon('right', 'ico tiny chev')], () => this.shop.jumpTo(id), { class: 'btn small', label: `Open the ${name} tree` })],
          `filled ${id}`));
      } else if (i < open) {
        out.push(row(icon('plus', 'ico'), 'Empty slot', isEl ? 'Attune an element: it opens its tree, Infusions and Fusions.' : 'Mount a weapon system for the rest of this Prestige.',
          [button(isEl ? 'Attune' : 'Mount', () => this.pick(isEl, i), { class: 'btn primary' })], 'open'));
      } else {
        const first = i === open;
        const when = first && next !== null ? (next <= 0 ? 'Opens now' : `Opens after clearing wave ${next}`) : 'Opens deeper in the climb';
        out.push(row(icon('lock', 'ico'), 'Locked slot', when, [], 'locked'));
      }
    }
    if (!total) out.push(row(icon('lock', 'ico'), 'No slots', isEl ? 'This Frame or Trial has no attunement slots.' : 'This Frame or Trial has no hardpoint slots.', [], 'locked'));
    return out;
  }

  private pick(isEl: boolean, slot: number): void {
    const m = openModal({ title: isEl ? `Attune slot ${slot + 1}` : `Mount slot ${slot + 1}`, body: h('div', null), variant: 'wide', className: 'pick-modal' });
    m.el.querySelector('.modal-body')?.replaceChildren(this.shop.slotPicker(isEl, slot, () => m.close()));
  }

  private hardpoints(ui: UiState): HTMLElement {
    return section('Hardpoints', 'Weapon systems. Mounts lock for this Prestige; a Refit costs 3 Cores.', ...this.slotRows(ui, false));
  }

  private attunements(ui: UiState): HTMLElement {
    return section('Attunements', 'Elements. Each opens a tree, Infusions with your weapons and Fusions with other elements.', ...this.slotRows(ui, true));
  }

  private doctrines(ui: UiState): HTMLElement {
    const trees = [...CHASSIS, ...ui.build.attunements.filter(Boolean), ...ui.build.hardpoints.filter(Boolean)] as TreeId[];
    const rows = trees.map((tree) => {
      const t = TREE_BY_ID.get(tree);
      if (!t) return null;
      const chosen = [ui.build.doctrines[tree], ui.build.secondDoctrines[tree]].filter(Boolean) as DoctrineId[];
      const open = (): void => this.shop.jumpTo(tree, true);
      if (chosen.length) {
        const names = chosen.map((d) => t.doctrines.find((x) => x.id === d)?.name ?? d).join(' + ');
        const cap = chosen.map((d) => NODE_BY_ID.get(t.doctrines.find((x) => x.id === d)?.capstone ?? '')?.name).filter(Boolean).join(', ');
        return row(icon('check', 'ico'), h('span', null, h('span', { class: 'bs-tree', text: `${t.name}: ` }), names), cap ? `Capstone: ${cap}` : null,
          [button(['Change', h('span', { class: 'price cores' }, '1', icon('cores', 'ico tiny'))], open, { class: 'btn small', label: `Change the ${t.name} Doctrine (1 Core, at a checkpoint)` })], 'chosen');
      }
      const entries = ui.shop.filter((e) => e.kind === 'doctrine' && e.tree === tree);
      const avail = entries.some((e) => !e.locked && e.affordable);
      if (avail) return row(icon('plus', 'ico'), h('span', null, h('span', { class: 'bs-tree', text: `${t.name}: ` }), 'fork open'), `Choose one of ${t.doctrines.length} paths: ${t.doctrines.map((d) => d.name).join(', ')}.`,
        [button('Choose', open, { class: 'btn primary' })], 'open');
      const have = t.shared.filter((n) => (ui.build.ranks[n.id] | 0) > 0).length;
      return row(icon('lock', 'ico'), h('span', null, h('span', { class: 'bs-tree', text: `${t.name}: ` }), 'no Doctrine yet'), `The fork opens after ${t.forkRequirement} core nodes (${Math.min(have, t.forkRequirement)}/${t.forkRequirement} owned).`,
        [button('Tree', open, { class: 'btn small ghost', label: `Open the ${t.name} tree` })], 'locked');
    });
    return section('Doctrines', 'One path per tree, locked for this Prestige. Changing one costs 1 Core, only at a checkpoint.', ...rows);
  }

  private anomalies(ui: UiState): HTMLElement {
    const b = ui.build;
    const rows: (HTMLElement | null)[] = [];
    const cards = h('div', { class: 'bs-anomalies' }, ...b.anomalies.map((a) => anomalyCard(a, ui)));
    for (let i = b.anomalies.length; i < b.anomalySockets; i++) cards.appendChild(h('div', { class: 'bs-socket', text: 'Empty socket: Anomaly drafts follow boss kills' }));
    rows.push(cards);
    return section('Anomalies', `${b.anomalies.length}/${b.anomalySockets} sockets. Anomalies bend the rules for this Prestige.`, ...rows);
  }

  private abilitySlots(ui: UiState): HTMLElement {
    const rows = ui.build.abilities.map((id, i) => {
      const def = id ? ABILITY_BY_ID.get(id) : null;
      return row(id ? abilityIcon(id, 'ico') : icon('plus', 'ico'), def ? def.name : 'Empty ability slot', def ? `${def.cost} CE · ${def.cooldown}s cooldown · ${def.desc}` : 'Abilities spend Command Energy (CE).',
        [button(def ? 'Change' : 'Choose', () => this.abilities.openPicker(i), { class: def ? 'btn small' : 'btn primary' })], def ? 'filled' : 'open');
    });
    return section('Abilities', 'Tactical slots on the Battle screen. Hold an ability there to change it too.', ...rows);
  }

  private cores(ui: UiState): HTMLElement {
    const c = ui.run.cores;
    const go = (label: string, cost: string, sub: string, onTap: () => void, can: boolean): HTMLElement =>
      button([h('span', { class: 'bs-main' }, h('span', { class: 'bs-name', text: label }), h('span', { class: 'bs-sub', text: sub })),
        h('span', { class: `price cores${can ? '' : ' short'}` }, icon('cores', 'ico tiny'), cost), icon('right', 'ico tiny chev')], onTap, { class: 'btn bs-core-row' });
    return h('section', { class: 'bs-section' },
      h('h3', { class: 'sec-title' }, 'Cores', h('span', { class: 'sec-sub', text: 'Commitment currency: bosses drop them; they reset at Prestige.' })),
      h('div', { class: 'bs-cores-bal' }, icon('cores', 'ico big'), h('span', { class: 'bs-cores-val', text: fmtNum(c) }), h('span', { class: 'dim', text: c === 1 ? ' Core' : ' Cores' })),
      h('div', { class: 'bs-list' },
        go('Exotics', '2', 'One per tree, once its Doctrine fork is reached', () => this.shop.open('cores', 'exotic'), c >= 2),
        go('Refit', String(REFIT_CORES), 'Swap a mounted hardpoint (60% of its Scrap back)', () => this.shop.open('cores', 'refit'), c >= REFIT_CORES),
        go('Doctrine change', '1', 'Switch a chosen path, at a checkpoint', () => this.shop.open('cores', 'doctrine'), c >= 1),
        go('Reroll a draft', '1', this.draft.pending ? 'An Anomaly draft is waiting' : 'During an Anomaly draft', () => { if (this.draft.pending) this.draft.open(); else this.ctx.toast('Rerolls happen in an Anomaly draft (after a boss).', 'info'); }, c >= 1)));
  }
}
