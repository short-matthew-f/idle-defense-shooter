/**
 * Build screen (design §4, "why did my build converge"): every commitment of this Prestige, one section page at a time.
 * Pinned (under the shell's top row with the Cores balance): one breadcrumb line "Section ▾ ⓘ … Frame ▸".
 *   Section ▾ lists the revealed sections in one order (BUILD_SECS: Hardpoints, Attunements, Abilities, Doctrines,
 *   Boons, Anomalies, Cores, Frame), each with a cheap status ("2 empty", "1/4") and a dot + "New" where a decision
 *   waits (an empty open slot, a free Doctrine fork, a boon offer, an Anomaly draft: what the tab badge counts). The ⓘ
 *   explains the section on show (info.ts; the section's rule rides along as `data-info-more`). The right-end chip
 *   names the Frame ("Standard ▸") and opens its page.
 * A swipe left / right on the page (or ← / →) steps along the sections (crumbs.ts). Opening the tab lands on the
 * section that needs attention (buildAttention, in the tab badge's order), else on the last section viewed
 * (prefs.buildSection).
 * It reuses the shop's slot pickers, Refit dialog, Doctrine fork cards (by opening the tree in Upgrades) and Cores page
 * rather than duplicating them. A pending Anomaly draft shows as a banner above every section.
 * Progressive reveal (progression.ts): each section shows once its feature is earned.
 * Calm by default: locked slots fold into one row, trees without a Doctrine into one "N trees …" line that opens on tap
 * (per session), empty Anomaly sockets into one card.
 */
import '../styles/build.css';
import type { DoctrineId, TreeId } from '@sim/core/ids';
import type { UiState } from '@sim/core/types';
import { button, h, clear, attr, text } from './dom';
import { abilityIcon, icon } from './icons';
import { ABILITY_BY_ID, CHASSIS, ELEMENT_BLURB, FRAME_BY_ID, HARDPOINT_BLURB, NODE_BY_ID, TREE_BY_ID, TREE_LABEL } from './content';
import { anomalyCard } from './draft';
import { autocastOn, setAutocast } from './abilities';
import { BOONS_RULE, boonsSection } from './boons';
import { SECOND_SOURCE_LABEL, atCheckpoint, strengthLabel } from './doctrine';
import { openModal } from './modal';
import type { Shop } from './shop';
import type { AbilityBar } from './abilities';
import type { DraftModal } from './draft';
import type { UiCtx } from './ctx';
import { markInfo } from './info';
import { nodeTier } from './echo-tiers';
import { prefs, setPref } from './prefs';
import { openForkCount } from './shell-logic';
import type { Features } from './progression';
import { CrumbMenu, crumbButton, crumbGap, crumbLine, paintCrumb, slideIn, stepId, wireSwipe, type Crumb } from './crumbs';

const REFIT_CORES = 3;
/** Tag a control for the pointer hints (hints.ts). */
const hint = <T extends HTMLElement>(el: T, key: string): T => { el.dataset.hint = key; return el; };

// ---------------------------------------------------------------- sections (pure)

export type BuildSec = 'hardpoints' | 'attunements' | 'abilities' | 'doctrines' | 'boons' | 'anomalies' | 'cores' | 'frame';
/** The Build sections in swipe / menu order, with their info.ts key. */
export const BUILD_SECS: readonly { id: BuildSec; label: string; info: string }[] = [
  { id: 'hardpoints', label: 'Hardpoints', info: 'hardpoints' },
  { id: 'attunements', label: 'Attunements', info: 'attunements' },
  { id: 'abilities', label: 'Abilities', info: 'abilities' },
  { id: 'doctrines', label: 'Doctrines', info: 'doctrines' },
  { id: 'boons', label: 'Boons', info: 'boons' },
  { id: 'anomalies', label: 'Anomalies', info: 'anomalies' },
  { id: 'cores', label: 'Cores', info: 'cores' },
  { id: 'frame', label: 'Frame', info: 'frame' },
];

/** The revealed sections, in order (the gates are the ones the one-page screen had; Doctrines always shows). Pure. */
export function buildStops(f: Pick<Features, 'hardpoints' | 'elements' | 'abilities' | 'boons' | 'anomalies' | 'cores' | 'frame'>, threatDial = false): BuildSec[] {
  const on: Record<BuildSec, boolean> = { hardpoints: f.hardpoints, attunements: f.elements, abilities: f.abilities, doctrines: true, boons: f.boons, anomalies: f.anomalies, cores: f.cores, frame: f.frame || threatDial };
  return BUILD_SECS.map((s) => s.id).filter((id) => on[id]);
}

/** What waits on Build (the tab badge's signals). */
export interface BuildWaiting { draft: boolean; boon: boolean; hardpoints: number; attunements: number; forks: number }

/** The section that needs attention, in the tab badge's order (draft, boon offer, empty slot, open fork), among `stops`. Pure. */
export function buildAttention(w: BuildWaiting, stops: readonly BuildSec[]): BuildSec | null {
  const want: [boolean, BuildSec][] = [[w.draft, 'anomalies'], [w.boon, 'boons'], [w.hardpoints > 0, 'hardpoints'], [w.attunements > 0, 'attunements'], [w.forks > 0, 'doctrines']];
  for (const [on, sec] of want) if (on && stops.includes(sec)) return sec;
  return null;
}

/** Where the tab opens: the section needing attention, else the last one viewed, else the first. Pure. */
export function buildLanding(stops: readonly BuildSec[], attention: BuildSec | null, last: string): BuildSec | null {
  if (attention && stops.includes(attention)) return attention;
  if (stops.includes(last as BuildSec)) return last as BuildSec;
  return stops[0] ?? null;
}

/** What waits on Build in this state. */
export function buildWaiting(ui: UiState): BuildWaiting {
  let hp = 0, at = 0;
  for (let i = 0; i < ui.run.hardpointSlotsOpen; i++) if (!ui.build.hardpoints[i]) hp++;
  for (let i = 0; i < ui.run.attunementSlotsOpen; i++) if (!ui.build.attunements[i]) at++;
  return { draft: !!ui.run.pendingDraft?.length, boon: !!ui.run.boonOffer?.length, hardpoints: hp, attunements: at, forks: openForkCount(ui) };
}

function row(ico: Node, name: string | Node, sub: string | Node | null, actions: (HTMLElement | null)[] = [], cls = ''): HTMLElement {
  return h('div', { class: `bs-row ${cls}` },
    h('span', { class: 'bs-ico' }, ico),
    h('div', { class: 'bs-main' }, h('div', { class: 'bs-name' }, name), sub ? h('div', { class: 'bs-sub' }, sub) : null),
    actions.some(Boolean) ? h('div', { class: 'bs-act' }, ...actions) : null);
}

/** A section page: its rows (the title is the breadcrumb; the rule rides on the ⓘ). */
function section(id: BuildSec, ...rows: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'bs-section', data: { sec: id } }, h('div', { class: 'bs-list' }, ...rows));
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
  /** The screen: the pinned breadcrumb line over its own scroller (the shell's top row holds the Cores balance). */
  readonly el: HTMLElement;
  /** The section page on show (the rows). */
  private readonly page = h('div', { class: 'build crumb-page-body' });
  private readonly body: HTMLElement;
  private readonly secC: Crumb;
  private readonly info: HTMLButtonElement;
  private readonly frameLabel = h('span', { class: 'crumb-label' });
  private readonly frameChip: HTMLButtonElement;
  private readonly menu = new CrumbMenu();
  shown = false;
  private key = '';
  private cur: BuildSec | null = null;
  private stops: BuildSec[] = [];
  private slide: -1 | 0 | 1 = 0;
  /** The "N trees without a Doctrine yet" line is open (this session). */
  private docsOpen = false;

  constructor(private readonly ctx: UiCtx, private readonly shop: Shop, private readonly abilities: AbilityBar, private readonly draft: DraftModal,
    /** Boons: show the pending offer on Battle. */
    private readonly openBoonOffer: () => void = () => {}) {
    this.secC = crumbButton(() => this.openMenu(), { cls: 'crumb-page', hint: 'build-menu', count: true });
    this.info = button(icon('info', 'ico info-mark'), () => {}, { class: 'btn ghost crumb-info' });
    this.frameChip = button([this.frameLabel, h('span', { class: 'crumb-caret', text: '▸', attrs: { 'aria-hidden': 'true' } })], () => this.go('frame'), { class: 'btn ghost crumb-chip' });
    this.frameChip.dataset.hint = 'bsec-frame';
    const head = h('div', { class: 'crumb-head' }, crumbLine('Build: section', this.secC.btn, this.info, crumbGap(), this.frameChip));
    this.body = h('div', { class: 'crumb-body' }, this.page);
    this.el = h('div', { class: 'crumb-screen build-screen', attrs: { 'aria-label': 'Build' } }, head, this.body);
    wireSwipe(this.body, (d) => this.step(d));
  }

  /** The section on show (pointer hints chain through it). */
  get section(): BuildSec | null { return this.cur; }

  setShown(on: boolean): void {
    const opening = on && !this.shown;
    this.shown = on;
    if (!on) { this.menu.close(); return; }
    const ui = this.ctx.state();
    if (opening && ui) {
      // land on what needs attention, else where the player left off
      this.stops = this.stopsOf(ui);
      const land = buildLanding(this.stops, buildAttention(buildWaiting(ui), this.stops), prefs().buildSection);
      if (land !== this.cur) { this.cur = land; this.body.scrollTop = 0; }
    }
    this.key = '';
    if (ui) this.update(ui);
  }

  private stopsOf(ui: UiState): BuildSec[] {
    return buildStops(this.ctx.features(), (ui.meta.prestigeRanks['prestige.threat_dial'] | 0) > 0);
  }

  /** Show a section (the menu, the Frame chip, a swipe, ← / →, a pointer hint). */
  go(sec: BuildSec, dir: -1 | 0 | 1 = 0): void {
    this.menu.close();
    if (!this.stops.includes(sec)) return;
    if (sec !== this.cur) { this.cur = sec; this.slide = dir; this.body.scrollTop = 0; }
    setPref('buildSection', sec);
    this.key = '';
    const ui = this.ctx.state();
    if (ui) this.update(ui);
  }

  /** Next (+1) / previous (-1) section (swipe on the page, ← / →). False at either end. */
  step(dir: -1 | 1): boolean {
    if (!this.cur) return false;
    const next = stepId(this.stops, this.cur, dir);
    if (!next) return false;
    this.go(next, dir);
    return true;
  }

  /** Status per section for the menu ("2 empty", "1/4"), and why a dot shows (a decision waits). */
  private status(ui: UiState, sec: BuildSec, w: BuildWaiting): { status: string | null; dot: string | null } {
    const b = ui.build, r = ui.run;
    switch (sec) {
      case 'hardpoints': return w.hardpoints ? { status: `${w.hardpoints} empty`, dot: 'empty hardpoint slot' } : { status: `${b.hardpoints.filter(Boolean).length + (ui.extraSystems?.length ?? 0)} mounted`, dot: null };
      case 'attunements': return w.attunements ? { status: `${w.attunements} empty`, dot: 'empty attunement slot' } : { status: `${b.attunements.filter(Boolean).length} attuned`, dot: null };
      case 'abilities': { const n = ui.abilitySlots ?? b.abilities.length; return { status: `${b.abilities.slice(0, n).filter(Boolean).length}/${n}`, dot: null }; }
      case 'doctrines': return w.forks ? { status: `${w.forks} to choose`, dot: w.forks === 1 ? 'Doctrine fork open' : 'Doctrine forks open' } : { status: `${Object.values(b.doctrines).filter(Boolean).length} chosen`, dot: null };
      case 'boons': return { status: `${(r.boons ?? []).length}/${r.boonCap || 4}`, dot: w.boon ? 'boon offer waiting' : null };
      case 'anomalies': return { status: `${b.anomalies.length}/${b.anomalySockets}`, dot: w.draft ? 'Anomaly draft waiting' : null };
      case 'cores': return { status: null, dot: null };
      case 'frame': return { status: FRAME_BY_ID.get(b.frame)?.name ?? null, dot: null };
    }
  }

  private openMenu(): void {
    const ui = this.ctx.state();
    if (!ui || this.stops.length < 2) return;
    const w = buildWaiting(ui);
    const rows = this.stops.map((id) => {
      const st = this.status(ui, id, w);
      return this.menu.row({ label: BUILD_SECS.find((s) => s.id === id)!.label, current: id === this.cur, status: st.status, dot: st.dot, hint: `bsec-${id}`, onPick: () => this.go(id) });
    });
    this.menu.open(this.secC.btn, 'Build sections', rows, 'build-menu');
  }

  /** The section's rule (the old grey note under its title), shown under the ⓘ entry. */
  private rule(ui: UiState, sec: BuildSec): string | null {
    const f = this.ctx.features();
    switch (sec) {
      case 'hardpoints': return f.prestigeTab ? `Mounts lock for this Prestige.${f.cores ? ` A Refit costs ${REFIT_CORES} Cores.` : ''}` : 'A mount stays once chosen.';
      case 'attunements': return f.prestigeTab ? 'Attunements lock for this Prestige.' : 'An attunement stays once chosen.';
      case 'abilities': {
        const n = ui.abilitySlots ?? ui.build.abilities.length;
        const auto = (ui.meta.prestigeRanks['prestige.autocast'] | 0) > 0;
        const more = !f.prestigeTab || n >= 4 ? '' : n === 2 ? ` More slots: Third Tactical Slot (${nodeTier('third_tactical_slot')}), the Command capstone (Reactor).` : ' A fourth: the Command capstone (Reactor) or Third Tactical Slot.';
        return `Keys 1–${n} on Battle.${more}${auto ? ' Autocast fires each when affordable and useful.' : ''}`;
      }
      case 'doctrines': {
        const rule = f.cores ? (f.prestigeTab ? 'Locked for this Prestige; a change costs 1 Core, at a checkpoint.' : 'A change costs 1 Core, at a checkpoint.') : 'A chosen path stays.';
        const seconds = Object.keys(ui.secondDoctrine ?? {}).length > 0;
        return `${rule}${seconds ? ' Trees marked 2nd run a second Doctrine.' : ''}`;
      }
      case 'boons': return BOONS_RULE;
      case 'anomalies': return `${ui.build.anomalies.length}/${ui.build.anomalySockets} sockets${f.prestigeTab ? ', for this Prestige' : ''}.`;
      case 'cores': return 'Bosses drop them; they reset at Prestige.';
      case 'frame': return null;
    }
  }

  /** The breadcrumb line: the section (a dot when a decision waits in another one), its ⓘ, the Frame chip. */
  private paintCrumbs(ui: UiState, w: BuildWaiting): void {
    const cur = this.cur;
    const def = BUILD_SECS.find((s) => s.id === cur);
    const label = def?.label ?? 'Build';
    const st = cur ? this.status(ui, cur, w) : null;
    const frac = cur === 'boons' || cur === 'anomalies' || cur === 'abilities' ? st?.status ?? null : null;
    const others = this.stops.filter((s) => s !== cur).map((s) => this.status(ui, s, w).dot).filter(Boolean);
    const menuable = this.stops.length > 1;
    this.secC.btn.dataset.pages = this.stops.join(',');   // the revealed sections (tests, and the menu's source)
    this.secC.btn.dataset.sec = cur ?? '';
    paintCrumb(this.secC, { label, menuable, dot: others.length > 0, aria: `Section: ${label}${frac ? ` ${frac}` : ''}${menuable ? '. Choose a section' : ''}${others.length ? ` (${others[0]} in another section)` : ''}` });
    // a fraction reads as part of the name ("Boons 1/4"); counts elsewhere live in the menu
    text(this.secC.count, frac ?? '');
    this.info.hidden = !def;
    if (def) {
      this.info.dataset.info = def.info;
      const more = this.rule(ui, def.id);
      if (more) this.info.dataset.infoMore = more; else delete this.info.dataset.infoMore;
      attr(this.info, 'aria-label', `About ${label}`);
    }
    const frameOn = this.stops.includes('frame');
    this.frameChip.hidden = !frameOn;
    if (frameOn) {
      const name = FRAME_BY_ID.get(ui.build.frame)?.name ?? ui.build.frame;
      text(this.frameLabel, name);
      this.frameChip.classList.toggle('current', cur === 'frame');
      attr(this.frameChip, 'aria-label', `Frame: ${name}. Open the Frame page`);
    }
  }

  update(ui: UiState): void {
    if (!this.shown) return;
    const f = this.ctx.features();
    this.stops = this.stopsOf(ui);
    if (!this.cur || !this.stops.includes(this.cur)) this.cur = buildLanding(this.stops, null, prefs().buildSection);
    const w = buildWaiting(ui);
    this.paintCrumbs(ui, w);
    const key = buildKey(ui) + `|${f.frame}${f.boons}${f.hardpoints}${f.elements}${f.anomalies}${f.abilities}${f.cores}${f.prestigeTab}${f.cross}|${this.docsOpen}|${this.cur}|${this.draft.pending}`;
    if (key === this.key) return;
    this.key = key;
    const y = this.body.scrollTop;
    clear(this.page);
    if (this.draft.pending) this.page.append(hint(button([icon('info', 'ico'), h('span', { class: 'bs-name', text: 'An Anomaly draft is waiting: choose one' }), icon('right', 'ico tiny chev')], () => this.draft.open(), { class: 'btn bs-draft top' }), 'draft'));
    const sec = this.render(ui);
    if (sec) this.page.append(sec);
    this.body.scrollTop = y;
    slideIn(this.page, this.slide);
    this.slide = 0;
  }

  /** The page of the section on show. */
  private render(ui: UiState): HTMLElement | null {
    switch (this.cur) {
      case 'hardpoints': return this.hardpoints(ui);
      case 'attunements': return this.attunements(ui);
      case 'abilities': return this.abilitySlots(ui);
      case 'doctrines': return this.doctrines(ui);
      case 'boons': return boonsSection(ui, this.openBoonOffer);
      case 'anomalies': return this.anomalies(ui);
      case 'cores': return this.cores(ui);
      case 'frame': {
        const page = h('div', { class: 'bs-frame-page', data: { sec: 'frame' } });
        if (this.ctx.features().frame) page.append(this.frame(ui));
        const dial = this.threatDial(ui);
        if (dial) page.append(dial);
        return page;
      }
      default: return null;
    }
  }

  private frame(ui: UiState): HTMLElement {
    const f = FRAME_BY_ID.get(ui.build.frame);
    const hc = ui.slotCaps?.hardpoint ?? f?.hardpointCap ?? 0, ac = ui.slotCaps?.attunement ?? f?.attunementCap ?? 0;
    const caps = f ? `${hc}${f.freeMount ? ` + ${TREE_LABEL[f.freeMount]}` : ''} hardpoints · ${ac} attunements` : '';
    return markInfo(h('section', { class: 'bs-frame', title: 'A new Frame is chosen at Prestige' },
      h('div', { class: 'bs-frame-head' }, icon('shield', 'ico'),
        h('div', { class: 'bs-frame-id' }, h('span', { class: 'bs-frame-label', text: 'Frame' }), h('span', { class: 'bs-frame-name', text: f?.name ?? ui.build.frame }))),
      h('p', { class: 'bs-frame-trait', text: f?.trait ?? '' }),
      caps ? h('p', { class: 'bs-frame-caps', text: caps }) : null), 'frame');
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
    let locked = 0;
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
          `filled slot ${id}`));
      } else if (i < open) {
        out.push(row(icon('plus', 'ico'), 'Empty slot', isEl ? (this.ctx.features().cross ? 'Opens its tree, Infusions and Fusions' : 'Opens its upgrade tree') : (this.ctx.features().prestigeTab ? 'One weapon system for the rest of this Prestige' : 'One weapon system, kept once mounted'),
          [hint(button(isEl ? 'Attune' : 'Mount', () => this.pick(isEl, i), { class: 'btn primary' }), isEl ? 'build-attune' : 'build-mount')], 'open'));
      } else locked++;
    }
    // the slots still locked: one row ("2 locked slots · the next opens after clearing wave 55")
    if (locked) {
      const when = next !== null ? (next <= 0 ? 'The next opens now' : `The next opens after clearing wave ${next}`) : 'They open deeper in the climb';
      const one = next === null ? 'Opens deeper in the climb' : next <= 0 ? 'Opens now' : `Opens after clearing wave ${next}`;
      out.push(row(icon('lock', 'ico'), locked === 1 ? 'Locked slot' : `${locked} locked slots`, locked === 1 ? one : when, [], 'locked'));
    }
    if (!total) out.push(row(icon('lock', 'ico'), 'No slots', isEl ? 'This Frame or Trial has no attunement slots.' : 'This Frame or Trial has no hardpoint slots.', [], 'locked'));
    return out;
  }

  private pick(isEl: boolean, slot: number): void {
    const m = openModal({ title: isEl ? `Attune slot ${slot + 1}` : `Mount slot ${slot + 1}`, body: h('div', null), variant: 'wide', className: 'pick-modal' });
    m.el.querySelector('.modal-body')?.replaceChildren(this.shop.slotPicker(isEl, slot, () => m.close()));
  }

  private hardpoints(ui: UiState): HTMLElement {
    return section('hardpoints', ...this.slotRows(ui, false), ...this.extraRows(ui));
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
    return section('attunements', ...this.slotRows(ui, true));
  }

  private doctrines(ui: UiState): HTMLElement {
    const frameMounted = (ui.extraSystems ?? []).filter((x) => x.via === 'frame').map((x) => x.system);
    const trees = [...CHASSIS, ...ui.build.attunements.filter(Boolean), ...ui.build.hardpoints.filter(Boolean), ...frameMounted] as TreeId[];
    const waiting: HTMLElement[] = [];
    const rows = trees.map((tree) => {
      const t = TREE_BY_ID.get(tree);
      if (!t) return null;
      const first = ui.build.doctrines[tree], second = ui.build.secondDoctrines[tree];
      const sd = ui.secondDoctrine?.[tree];
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
      // not a decision yet: folded under one line (below)
      waiting.push(row(icon('lock', 'ico'), h('span', null, h('span', { class: 'bs-tree', text: `${t.name}: ` }), 'no Doctrine yet'), `The fork opens after ${t.forkRequirement} core nodes (${Math.min(have, t.forkRequirement)}/${t.forkRequirement} owned).`,
        [button('Tree', open, { class: 'btn small ghost', label: `Open the ${t.name} tree` })], 'locked'));
      return null;
    });
    if (waiting.length) {
      const n = waiting.length;
      const fold = button([icon('lock', 'ico tiny'), h('span', { class: 'fold-label', text: `${n} tree${n === 1 ? '' : 's'} without a Doctrine yet` }), h('span', { class: 'fold-act', text: this.docsOpen ? 'Hide' : 'Show' }), icon(this.docsOpen ? 'up' : 'down', 'ico tiny chev')],
        () => { this.docsOpen = !this.docsOpen; this.key = ''; const s = this.ctx.state(); if (s) this.update(s); }, { class: 'btn fold-btn bs-fold' });
      fold.setAttribute('aria-expanded', this.docsOpen ? 'true' : 'false');
      rows.push(fold, ...(this.docsOpen ? waiting : []));
    }
    return section('doctrines', ...rows);
  }

  private anomalies(ui: UiState): HTMLElement {
    const b = ui.build;
    const rows: (HTMLElement | null)[] = [];
    const cards = h('div', { class: 'bs-anomalies' }, ...b.anomalies.map((a) => anomalyCard(a, ui)));
    const empty = b.anomalySockets - b.anomalies.length;
    if (empty > 0) cards.appendChild(h('div', { class: 'bs-socket', text: `${empty === 1 ? 'An empty socket' : `${empty} empty sockets`}: Anomaly drafts follow boss kills` }));
    rows.push(cards);
    return section('anomalies', ...rows);
  }

  private abilitySlots(ui: UiState): HTMLElement {
    const n = ui.abilitySlots ?? ui.build.abilities.length;
    const auto = (ui.meta.prestigeRanks['prestige.autocast'] | 0) > 0;
    const mask = ui.meta.settings.autocastOff ?? 0;
    const rows = ui.build.abilities.map((id, i) => {
      const def = id ? ABILITY_BY_ID.get(id) : null;
      const inactive = i >= n;
      const acts: HTMLElement[] = [];
      // Reachability: Autocast (an Echo upgrade) can be switched off per ability
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
    return section('abilities', ...rows);
  }

  /** Reachability: the Threat Dial can be lowered mid-run (never raised; Echoes pay at the lowest level used). */
  private threatDial(ui: UiState): HTMLElement | null {
    if ((ui.meta.prestigeRanks['prestige.threat_dial'] | 0) <= 0) return null;
    const lvl = ui.run.threatDial, low = ui.run.minThreatDial ?? lvl;
    const sub = lvl > 0
      ? `Enemy HP +${lvl * 12}%, speed +${lvl * 3}% · Echoes +${low * 10}% (they pay at the lowest level used this Prestige: ${low}). Lowering is permanent for this Prestige.`
      : 'Level 0. Choose a level when you Prestige.';
    return h('section', { class: 'bs-section bs-dial' }, h('h3', { class: 'sec-title', text: 'Threat Dial' }), h('div', { class: 'bs-list' }, row(icon('skull', 'ico'), `Level ${lvl}`, sub,
      [lvl > 0 ? button('Lower…', () => this.lowerDial(lvl), { class: 'btn small', label: `Lower the Threat Dial from level ${lvl}` }) : null])));
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
    return h('section', { class: 'bs-section', data: { sec: 'cores' } },
      h('div', { class: 'bs-list' },
        go('Exotics', '2', 'One per tree, once its Doctrine fork is reached', () => this.shop.open('cores', 'exotic'), c >= 2),
        go('Refit', String(REFIT_CORES), 'Swap a mounted hardpoint (60% of its Scrap back)', () => this.shop.open('cores', 'refit'), c >= REFIT_CORES),
        go('Doctrine change', '1', 'Switch a chosen path, at a checkpoint', () => this.shop.open('cores', 'doctrine'), c >= 1),
        go('Reroll a draft', '1', this.draft.pending ? 'An Anomaly draft is waiting' : 'During an Anomaly draft', () => { if (this.draft.pending) this.draft.open(); else this.ctx.toast('Rerolls happen in an Anomaly draft (after a boss).', 'info'); }, c >= 1)));
  }
}
