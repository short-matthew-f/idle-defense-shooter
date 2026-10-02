/**
 * Doctrine forks (Upgrades tree view, Cores → Doctrines, Build screen): one card per Doctrine with what the player
 * can do with it right now. The model is pure (tests/ui/doctrine.test.ts); `doctrineFork` draws it.
 *
 * Rules mirrored from the sim (economy/shop.doctrineChoice, run/commands.ts):
 *  - the first Doctrine of a tree is free; changing it costs 1 Core and only at a checkpoint;
 *  - a tree that may run a second Doctrine (UiState.secondDoctrine: Spare Barrel, Dual Doctrine, Monolith, Bulwark,
 *    Singularity Core) fills it for free once the first is chosen ("Choose as 2nd", at the strength the source gives);
 *    while that slot is empty any new pick fills it, so the first can only be changed once both are chosen;
 *  - a chosen second Doctrine can be replaced or cleared (1 Core, at a checkpoint); Dual Doctrine covers one tree, the
 *    first that takes a second Doctrine, so clearing it frees Dual Doctrine for another tree.
 */
import type { DoctrineId, TreeId } from '@sim/core/ids';
import type { Command, SecondDoctrineSource, ShopEntry, UiState } from '@sim/core/types';
import { button, h } from './dom';
import { icon } from './icons';
import { NODE_BY_ID, TREE_BY_ID, TREE_LABEL } from './content';
import { confirmDialog } from './modal';
import { walletChip } from './wallet';
import type { UiCtx } from './ctx';

/** 1 Core: changing or clearing a chosen Doctrine (economy/curves CORE_COSTS.doctrine). */
export const DOCTRINE_CHANGE_CORES = 1;

export const SECOND_SOURCE_LABEL: Record<SecondDoctrineSource, string> = {
  monolith: 'Monolith Frame', bulwark: 'Bulwark Frame', singularity_core: 'Singularity Core Frame', dual_doctrine: 'Dual Doctrine', spare_barrel: 'Spare Barrel',
};

export type ForkActionKind = 'choose' | 'second' | 'change1' | 'change2' | 'clear2';
export interface ForkAction {
  kind: ForkActionKind;
  label: string;
  /** Cores it costs (0 = free). */
  cost: number;
  /** Why it cannot be done now, or null. */
  blocked: string | null;
  cmd: Command;
}
export interface ForkCard {
  doctrine: DoctrineId;
  name: string;
  identity: string;
  capstone: string | null;
  state: 'first' | 'second' | 'open';
  /** "2nd · 60%" for a chosen second Doctrine. */
  tag: string | null;
  actions: ForkAction[];
}
export interface ForkModel { tree: TreeId; name: string; cards: ForkCard[]; note: string | null }

type ForkUi = Pick<UiState, 'build' | 'shop' | 'run' | 'secondDoctrine' | 'meta'>;

/** "60%" / "full strength". */
export function strengthLabel(s: number): string { return s >= 1 ? 'full strength' : `${Math.round(s * 100)}%`; }
const pct = strengthLabel;
/** Between waves right after a boss (the only moment a Doctrine can be changed). */
export function atCheckpoint(run: Pick<UiState['run'], 'phase' | 'wave' | 'checkpoint'>): boolean { return run.phase === 'between' && run.wave - 1 === run.checkpoint; }

/** The tree Dual Doctrine is used by (its second Doctrine), or null. */
function dualTree(ui: ForkUi): TreeId | null {
  if ((ui.meta.prestigeRanks['prestige.dual_doctrine'] | 0) <= 0) return null;
  const t = Object.keys(ui.build.secondDoctrines).find((k) => ui.build.secondDoctrines[k as TreeId]);
  return (t as TreeId | undefined) ?? null;
}

/** One line on the fork explaining the second Doctrine (or why this tree has none). */
export function secondNote(ui: ForkUi, tree: TreeId): string | null {
  const sd = ui.secondDoctrine?.[tree];
  const name = TREE_LABEL[tree] ?? tree;
  if (!sd) {
    const used = dualTree(ui);
    return used && used !== tree ? `Dual Doctrine is in use on ${TREE_LABEL[used] ?? used}: one tree only. Clear that second Doctrine (1 Core, at a checkpoint) to move it here.` : null;
  }
  const src = SECOND_SOURCE_LABEL[sd.source];
  const at = pct(sd.strength);
  const base = sd.source === 'dual_doctrine'
    ? `Dual Doctrine: one tree runs a second Doctrine at ${at}. The first tree you give a second Doctrine keeps it.`
    : `${src}: ${name} can run a second Doctrine at ${at}.`;
  if (!sd.allowed) return `${base} It no longer applies here.`;
  if (!ui.build.doctrines[tree]) return `${base} Choose your first Doctrine, then a second.`;
  if (!ui.build.secondDoctrines[tree]) return `${base} Pick it below (free).`;
  return base;
}

/** Cards and actions for `tree`'s Doctrine fork. */
export function forkModel(ui: ForkUi, tree: TreeId): ForkModel | null {
  const t = TREE_BY_ID.get(tree);
  if (!t) return null;
  const cur = ui.build.doctrines[tree], second = ui.build.secondDoctrines[tree];
  const sd = ui.secondDoctrine?.[tree];
  const canSecond = !!sd?.allowed;
  const cp = atCheckpoint(ui.run);
  const entry = (d: DoctrineId): ShopEntry | undefined => ui.shop.find((s) => s.node === `${tree}.${d}`);
  const cores = ui.run.cores;
  const coreBlock = (cost: number): string | null => (cost > 0 && cores < cost ? `Needs ${cost} Core${cost === 1 ? '' : 's'}` : null);
  const cards: ForkCard[] = t.doctrines.map((d) => {
    const cap = NODE_BY_ID.get(d.capstone)?.name ?? null;
    const base = { doctrine: d.id, name: d.name, identity: d.identity, capstone: cap };
    if (cur === d.id) return { ...base, state: 'first', tag: second ? '1st' : null, actions: [] };
    if (second === d.id) {
      const clearBlock = !cp ? 'Change only at a checkpoint' : coreBlock(DOCTRINE_CHANGE_CORES);
      return { ...base, state: 'second', tag: `2nd · ${sd ? pct(sd.strength) : '60%'}`,
        actions: [{ kind: 'clear2', label: 'Clear 2nd', cost: DOCTRINE_CHANGE_CORES, blocked: clearBlock, cmd: { type: 'clear_second_doctrine', tree } }] };
    }
    const e = entry(d.id);
    const lock = e?.locked ?? (e ? null : 'Not available');
    const actions: ForkAction[] = [];
    if (!cur) actions.push({ kind: 'choose', label: 'Choose', cost: 0, blocked: lock, cmd: { type: 'choose_doctrine', tree, doctrine: d.id } });
    else if (canSecond && !second) actions.push({ kind: 'second', label: `Choose as 2nd · ${sd ? pct(sd.strength) : ''}`, cost: 0, blocked: lock, cmd: { type: 'choose_doctrine', tree, doctrine: d.id, second: true } });
    else {
      const cost = e?.cost || DOCTRINE_CHANGE_CORES;
      const blk = lock ?? coreBlock(cost);
      actions.push({ kind: 'change1', label: second ? 'Replace 1st' : 'Change', cost, blocked: blk, cmd: { type: 'choose_doctrine', tree, doctrine: d.id } });
      if (second && canSecond) actions.push({ kind: 'change2', label: 'Replace 2nd', cost, blocked: blk, cmd: { type: 'choose_doctrine', tree, doctrine: d.id, second: true } });
    }
    return { ...base, state: 'open', tag: null, actions };
  });
  return { tree, name: t.name, cards, note: secondNote(ui, tree) };
}

/** Confirm-dialog copy for an action. */
export function confirmText(ui: ForkUi, tree: TreeId, card: ForkCard, a: ForkAction): { title: string; body: string; ok: string; danger?: boolean } {
  const t = TREE_BY_ID.get(tree);
  const tn = t?.name ?? tree;
  const nameOf = (d: DoctrineId | undefined): string => t?.doctrines.find((x) => x.id === d)?.name ?? String(d);
  const cur = ui.build.doctrines[tree], second = ui.build.secondDoctrines[tree];
  const sd = ui.secondDoctrine?.[tree];
  const core = (n: number): string => `${n} Core${n === 1 ? '' : 's'}`;
  switch (a.kind) {
    case 'choose': return { title: `Choose ${card.name}?`, body: `${card.identity} Doctrines lock for this Prestige; changing later costs 1 Core at a checkpoint.`, ok: 'Choose' };
    case 'second': {
      const dual = sd?.source === 'dual_doctrine' ? ` Dual Doctrine covers one tree: this makes ${tn} that tree.` : '';
      return { title: `Choose ${card.name} as your second ${tn} Doctrine?`, body: `It runs at ${sd ? pct(sd.strength) : '60%'} alongside ${nameOf(cur)} (from ${sd ? SECOND_SOURCE_LABEL[sd.source] : 'your build'}). Free now; replacing or clearing it later costs 1 Core at a checkpoint.${dual}`, ok: 'Choose as 2nd' };
    }
    case 'change1': return { title: `Change ${tn} Doctrine?`, body: `Switch from ${nameOf(cur)} to ${card.name} for ${core(a.cost)}. Nodes bought in the old Doctrine stop working.`, ok: 'Change' };
    case 'change2': return { title: `Replace your second ${tn} Doctrine?`, body: `Switch the second Doctrine from ${nameOf(second)} to ${card.name} for ${core(a.cost)}. ${nameOf(cur)} stays your first. Nodes bought in the old one stop working.`, ok: 'Replace' };
    case 'clear2': return { title: `Clear the second ${tn} Doctrine?`, body: `${card.name} stops running (its nodes stop working; nothing is refunded) for ${core(a.cost)}.${sd?.source === 'dual_doctrine' ? ' Dual Doctrine is then free for another tree.' : ''}`, ok: 'Clear', danger: true };
  }
}

/** The fork as DOM: cards with their buttons (every press confirms first). */
export function doctrineFork(ctx: UiCtx, ui: UiState, tree: TreeId, opts: { title?: boolean } = {}): HTMLElement {
  const model = forkModel(ui, tree);
  const wrap = h('div', { class: 'fork', attrs: { role: 'group', 'aria-label': `${model?.name ?? tree} Doctrine` } });
  if (!model) return wrap;
  if (opts.title) wrap.appendChild(h('div', { class: 'fork-title', text: model.name }));
  if (model.note) wrap.appendChild(h('p', { class: 'fork-note' }, icon('info', 'ico tiny'), model.note));
  const cards = h('div', { class: 'fork-cards' });
  wrap.appendChild(cards);
  for (const c of model.cards) {
    const chosen = c.state !== 'open';
    const card = h('div', { class: `doctrine${chosen ? ' chosen' : ''}${c.state === 'second' ? ' second' : ''}`, data: { doctrine: c.doctrine } },
      h('div', { class: 'doc-name' }, chosen ? icon('check', 'ico tiny') : null, c.name, c.tag ? h('span', { class: 'tag doc-tag', text: c.tag }) : null),
      h('p', { class: 'doc-id', text: c.identity }),
      c.capstone ? h('p', { class: 'doc-cap' }, h('b', { text: 'Capstone: ' }), c.capstone) : null);
    if (chosen) card.appendChild(h('span', { class: 'doc-state', text: c.state === 'second' ? 'Chosen (2nd)' : 'Chosen' }));
    let reason: string | null = null;
    for (const a of c.actions) {
      const b = button([a.label, a.cost > 0 ? h('span', { class: 'price cores' }, String(a.cost), icon('cores', 'ico tiny')) : null], async () => {
        const cur = ctx.state() ?? ui;
        const t = confirmText(cur, tree, c, a);
        // a change that costs Cores shows the balance in the dialog
        const wallet = a.cost > 0 ? walletChip(['cores'], cur) : undefined;
        if (!(await confirmDialog(t.title, t.body, t.ok, { ...(t.danger ? { danger: true } : {}), ...(wallet ? { wallet } : {}) }))) return;
        ctx.host.send(a.cmd);
      }, { class: `btn small ${a.kind === 'clear2' ? 'ghost' : 'primary'}`, disabled: !!a.blocked, label: `${a.label} ${c.name}${a.cost ? ` for ${a.cost} Core` : ''}${a.blocked ? ` (${a.blocked})` : ''}` });
      if (a.blocked) b.title = a.blocked;
      b.dataset.action = a.kind;
      card.appendChild(b);
      reason = reason ?? a.blocked;
    }
    if (reason) card.appendChild(h('p', { class: 'node-lock', text: reason }));
    cards.appendChild(card);
  }
  return wrap;
}

/** Re-render key for a fork (everything forkModel reads). */
export function forkKey(ui: ForkUi, tree: TreeId): string {
  const t = TREE_BY_ID.get(tree);
  if (!t) return tree;
  const e = t.doctrines.map((d) => { const x = ui.shop.find((s) => s.node === `${tree}.${d.id}`); return x ? `${x.cost}${x.affordable}${x.locked ?? ''}` : '-'; }).join(';');
  return `${tree}:${ui.build.doctrines[tree] ?? ''}:${ui.build.secondDoctrines[tree] ?? ''}:${e}:${JSON.stringify(ui.secondDoctrine?.[tree] ?? null)}:${atCheckpoint(ui.run)}:${Math.min(ui.run.cores, 2)}:${dualTree(ui) ?? ''}`;
}

/** Trees where a Doctrine can be chosen for free right now: an open fork with no first Doctrine, or an empty second slot. */
export function freeDoctrineTrees(ui: Pick<UiState, 'shop' | 'build'>): string[] {
  const seen = new Set<string>();
  for (const e of ui.shop) {
    if (e.kind !== 'doctrine' || e.locked || !e.affordable || e.cost > 0) continue;
    const tree = e.tree as TreeId;
    if (ui.build.doctrines[tree] && ui.build.secondDoctrines[tree]) continue;
    seen.add(e.tree);
  }
  return [...seen];
}
