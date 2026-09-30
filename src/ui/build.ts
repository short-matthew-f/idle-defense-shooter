/**
 * Build screen (design §4, "why did my build converge"): every commitment of this Prestige on one
 * page — Frame, this attempt's active Boons (and a pending boon offer), Hardpoint and Attunement slots, the
 * Doctrine per tree, Anomaly sockets, ability slots, and the Cores balance with what Cores buy. It reuses the shop's slot pickers, Refit dialog,
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
import { autocastOn, setAutocast } from './abilities';
import { boonsSection } from './boons';
import { SECOND_SOURCE_LABEL, atCheckpoint, strengthLabel } from './doctrine';
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
    r.hardpointSlotsOpen, r.attunementSlotsOpen, ui.nextHardpointWave, ui.nextAttunementWave, r.cores, r.pendingDraft, docs, r.boons, r.boonOffer, r.mode,
    CHASSIS.map((t) => sharedOwned(ui, t)),
    // Reachability additions
    ui.extraSystems, ui.secondDoctrine, ui.abilitySlots, ui.slotCaps, ui.mountBlocked, r.threatDial, ui.meta.settings.autocastOff ?? 0,
    ui.meta.prestigeRanks['prestige.autocast'] | 0, ui.meta.prestigeRanks['prestige.threat_dial'] | 0, atCheckpoint(r)]);
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

  constructor(private readonly ctx: UiCtx, private readonly shop: Shop, private readonly abilities: AbilityBar, private readonly draft: DraftModal,
    /** Boons: show the pending offer on Battle. */
    private readonly openBoonOffer: () => void = () => {}) {}

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
    this.el.append(this.frame(ui), boonsSection(ui, this.openBoonOffer), this.hardpoints(ui), this.attunements(ui), this.doctrines(ui), this.anomalies(ui), this.abilitySlots(ui), this.cores(ui));
    const dial = this.threatDial(ui);
    if (dial) this.el.append(dial);
    if (this.el.parentElement) this.el.parentElement.scrollTop = y;
  }

  private frame(ui: UiState): HTMLElement {
    const f = FRAME_BY_ID.get(ui.build.frame);
    const hc = ui.slotCaps?.hardpoint ?? f?.hardpointCap ?? 0, ac = ui.slotCaps?.attunement ?? f?.attunementCap ?? 0;
    const caps = f ? `${hc}${f.freeMount ? ` + ${TREE_LABEL[f.freeMount]}` : ''} hardpoints · ${ac} attunements` : '';
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
    // slotCaps: Frame + Expanded Frame / Third Attunement + Trial rules (a Frame's free mount is listed separately, never as a slot)
    const cap = ui.slotCaps ? (isEl ? ui.slotCaps.attunement : ui.slotCaps.hardpoint) : f ? (isEl ? f.attunementCap : f.hardpointCap) : open;
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
    return section('Hardpoints', 'Weapon systems. Mounts lock for this Prestige; a Refit costs 3 Cores.', ...this.slotRows(ui, false), ...this.extraRows(ui));
  }

  /** Systems that run without a slot: a Frame's free mount, or a Borrowed Blade from an Anomaly. */
  private extraRows(ui: UiState): HTMLElement[] {
    return (ui.extraSystems ?? []).map((x) => {
      const name = TREE_LABEL[x.system as TreeId] ?? x.system;
      const doc = ui.build.doctrines[x.system as TreeId];
      const docName = doc ? TREE_BY_ID.get(x.system as TreeId)?.doctrines.find((d) => d.id === doc)?.name : null;
      const via = x.via === 'borrowed' ? 'Borrowed by an Anomaly: base upgrades only, no Doctrines.' : 'Mounted free by your Frame.';
      return row(icon('check', 'ico'), name,
        h('span', null, docName ? h('span', { class: 'bs-doc', text: `${docName} Doctrine` }) : null, docName ? h('br') : null, via, h('br'), HARDPOINT_BLURB[x.system as never]),
        [button(['Tree', icon('right', 'ico tiny chev')], () => this.shop.jumpTo(x.system), { class: 'btn small', label: `Open the ${name} tree` })],
        `filled ${x.system}`);
    });
  }

  private attunements(ui: UiState): HTMLElement {
    return section('Attunements', 'Elements. Each opens a tree, Infusions with your weapons and Fusions with other elements.', ...this.slotRows(ui, true));
  }

  private doctrines(ui: UiState): HTMLElement {
    const frameMounted = (ui.extraSystems ?? []).filter((x) => x.via === 'frame').map((x) => x.system);
    const trees = [...CHASSIS, ...ui.build.attunements.filter(Boolean), ...ui.build.hardpoints.filter(Boolean), ...frameMounted] as TreeId[];
    let seconds = false;
    const rows = trees.map((tree) => {
      const t = TREE_BY_ID.get(tree);
      if (!t) return null;
      const first = ui.build.doctrines[tree], second = ui.build.secondDoctrines[tree];
      const sd = ui.secondDoctrine?.[tree];
      if (sd) seconds = true;
      const nameOf = (d: DoctrineId): string => t.doctrines.find((x) => x.id === d)?.name ?? d;
      const capOf = (d: DoctrineId): string | undefined => NODE_BY_ID.get(t.doctrines.find((x) => x.id === d)?.capstone ?? '')?.name;
      const open = (): void => this.shop.jumpTo(tree, true);
      if (first) {
        // Reachability: both Doctrines on the row, and an empty second slot is an action, not a footnote
        const secondFree = !!sd?.allowed && !second;
        const name = h('span', null, h('span', { class: 'bs-tree', text: `${t.name}: ` }), nameOf(first),
          second ? h('span', null, ' + ', nameOf(second), ' ', h('span', { class: 'tag doc-tag', text: `2nd · ${sd ? strengthLabel(sd.strength) : '60%'}` })) : null);
        const caps = [first, second].filter((d): d is DoctrineId => !!d).map(capOf).filter(Boolean).join(', ');
        const sub = secondFree && sd
          ? `Second Doctrine open (${SECOND_SOURCE_LABEL[sd.source]}, ${strengthLabel(sd.strength)}): choose it free.${caps ? ` Capstone: ${caps}` : ''}`
          : caps ? `Capstone: ${caps}` : null;
        const act = secondFree
          ? button('Choose 2nd', open, { class: 'btn primary', label: `Choose a second ${t.name} Doctrine (free)` })
          : button(['Change', h('span', { class: 'price cores' }, '1', icon('cores', 'ico tiny'))], open, { class: 'btn small', label: `Change the ${t.name} Doctrine${second ? 's' : ''} (1 Core, at a checkpoint)` });
        return row(icon(secondFree ? 'plus' : 'check', 'ico'), name, sub, [act], secondFree ? 'open' : 'chosen');
      }
      const entries = ui.shop.filter((e) => e.kind === 'doctrine' && e.tree === tree);
      const avail = entries.some((e) => !e.locked && e.affordable);
      if (avail) return row(icon('plus', 'ico'), h('span', null, h('span', { class: 'bs-tree', text: `${t.name}: ` }), 'fork open'), `Choose one of ${t.doctrines.length} paths: ${t.doctrines.map((d) => d.name).join(', ')}.${sd ? ` A second runs at ${strengthLabel(sd.strength)} (${SECOND_SOURCE_LABEL[sd.source]}).` : ''}`,
        [button('Choose', open, { class: 'btn primary' })], 'open');
      const have = t.shared.filter((n) => (ui.build.ranks[n.id] | 0) > 0).length;
      return row(icon('lock', 'ico'), h('span', null, h('span', { class: 'bs-tree', text: `${t.name}: ` }), 'no Doctrine yet'), `The fork opens after ${t.forkRequirement} core nodes (${Math.min(have, t.forkRequirement)}/${t.forkRequirement} owned).`,
        [button('Tree', open, { class: 'btn small ghost', label: `Open the ${t.name} tree` })], 'locked');
    });
    return section('Doctrines', `One path per tree, locked for this Prestige. Changing one costs 1 Core, only at a checkpoint.${seconds ? ' Trees marked 2nd run a second Doctrine.' : ''}`, ...rows);
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
    const n = ui.abilitySlots ?? ui.build.abilities.length;
    const auto = (ui.meta.prestigeRanks['prestige.autocast'] | 0) > 0;
    const mask = ui.meta.settings.autocastOff ?? 0;
    const rows = ui.build.abilities.map((id, i) => {
      const def = id ? ABILITY_BY_ID.get(id) : null;
      const inactive = i >= n;
      const acts: HTMLElement[] = [];
      // Reachability: Autocast (Prestige II) can be switched off per ability
      if (auto && id && !inactive) {
        const on = autocastOn(mask, id);
        const t = button(on ? 'Auto on' : 'Auto off', () => this.ctx.host.send({ type: 'set_setting', key: 'autocastOff', value: setAutocast(mask, id, !on) }),
          { class: `btn small toggle autocast${on ? ' on' : ''}`, label: `Autocast ${def?.name ?? id}: ${on ? 'on' : 'off'}. Tap to switch ${on ? 'off' : 'on'}` });
        t.setAttribute('aria-pressed', on ? 'true' : 'false');
        acts.push(t);
      }
      acts.push(button(def ? 'Change' : 'Choose', () => this.abilities.openPicker(i), { class: def ? 'btn small' : 'btn primary' }));
      const sub = inactive ? 'Inactive: this slot came from the Command capstone, which no longer applies. Move the ability to an active slot.'
        : def ? `${def.cost} CE · ${def.cooldown}s cooldown · ${def.desc}` : 'Abilities spend Command Energy (CE).';
      return row(id ? abilityIcon(id, 'ico') : icon('plus', 'ico'), h('span', null, h('span', { class: 'bs-num-inline', text: `${i + 1} · ` }), def ? def.name : 'Empty ability slot'), sub, acts, inactive ? 'locked' : def ? 'filled' : 'open');
    });
    const more = n >= 4 ? '' : n === 2 ? ' A third slot comes with the Prestige III node Third Tactical Slot, a fourth with the Command Doctrine capstone (Reactor).' : ' A fourth slot comes with the Command Doctrine capstone (Reactor) or the Third Tactical Slot node.';
    return section('Abilities', `${n} tactical slots on the Battle screen (keys 1–${n}). Hold an ability there to change it too.${more}${auto ? ' Autocast fires each ability when it is affordable and useful; switch it off per ability.' : ''}`, ...rows);
  }

  /** Reachability: the Threat Dial can be lowered mid-run (never raised; Echoes pay at the lowest level used). */
  private threatDial(ui: UiState): HTMLElement | null {
    if ((ui.meta.prestigeRanks['prestige.threat_dial'] | 0) <= 0) return null;
    const lvl = ui.run.threatDial, low = ui.run.minThreatDial ?? lvl;
    const sub = lvl > 0
      ? `Enemy HP +${lvl * 12}%, speed +${lvl * 3}% · Echoes +${low * 10}% (they pay at the lowest level used this Prestige: ${low}). Lowering is permanent for this Prestige.`
      : 'Level 0. Choose a level when you Prestige.';
    return section('Threat Dial', null, row(icon('skull', 'ico'), `Level ${lvl}`, sub,
      [lvl > 0 ? button('Lower…', () => this.lowerDial(lvl), { class: 'btn small', label: `Lower the Threat Dial from level ${lvl}` }) : null]));
  }

  private lowerDial(cur: number): void {
    let v = cur - 1;
    const val = h('span', { class: 'dial-val' });
    const range = h('input', { attrs: { type: 'range', min: '0', max: String(cur - 1), step: '1', value: String(v), 'aria-label': 'New Threat Dial level' } }) as HTMLInputElement;
    const sync = (): void => { v = Number(range.value); val.textContent = `Level ${v}: enemy HP +${v * 12}%, speed +${v * 3}% · Echoes +${v * 10}%, Scrap +${v * 5}%`; };
    range.addEventListener('input', sync);
    sync();
    const ok = button('Lower', () => { this.ctx.host.send({ type: 'set_threat_dial', level: v }); m.close(); }, { class: 'btn primary wide' });
    const m = openModal({ title: 'Lower the Threat Dial', body: h('div', { class: 'prestige' }, h('p', { class: 'dim', text: 'Lowering makes the climb easier now, but this Prestige\'s Echoes then pay at the lower level. It cannot be raised again until you Prestige.' }), range, val), footer: ok });
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
