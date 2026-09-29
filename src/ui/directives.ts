/**
 * Automation editor (design §11): Directives (WHEN condition AND … → DO action, priority order,
 * drag / arrow reordering, enable toggles), Targeting Profiles per system, the Upgrade Queue and
 * Blueprints. Directives are edited on a local draft and sent with `set_directives` on Save.
 */
import '../styles/directives.css';
import type { NodeId, TargetingProfile, TreeId, WeaponSystemId } from '@sim/core/ids';
import type { Blueprint, Directive, DirectiveAction, DirectiveCondition, UiState, UpgradeRule } from '@sim/core/types';
import { button, h, text, clear, disable } from './dom';
import { icon } from './icons';
import { ACTIONS, ACT_KINDS, CONDITIONS, COND_KINDS, MAX_CONDITIONS, SYSTEM_LABELS, TARGETING_PROFILES, defaultAction, defaultCondition, describeDirective, describeUpgradeRule, directiveSlots, moveItem, newDirective, serializeDirectives, type ActKind, type CondKind, type ParamSpec } from './directive-model';
import { FRAME_BY_ID, TREE_LABEL, nodeName } from './content';
import { confirmDialog } from './modal';
import type { UiCtx } from './ctx';

export type AutoTab = 'directives' | 'targeting' | 'queue' | 'blueprints';
const TABS: { id: AutoTab; label: string }[] = [
  { id: 'directives', label: 'Directives' }, { id: 'targeting', label: 'Targeting' }, { id: 'queue', label: 'Upgrade Queue' }, { id: 'blueprints', label: 'Blueprints' },
];

function rank(ui: UiState, id: string): number { return ui.meta.prestigeRanks[`prestige.${id}`] | 0; }
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

function paramInput(spec: ParamSpec, value: unknown, onChange: (v: string | number) => void, labelPrefix: string): HTMLElement {
  const label = `${labelPrefix} ${spec.label}`;
  if (spec.type === 'enum') {
    const sel = h('select', { class: 'select', attrs: { 'aria-label': label } }, ...(spec.options ?? []).map((o) => h('option', { attrs: { value: o.value }, text: o.label })));
    sel.value = String(value);
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  const inp = h('input', { class: 'num', attrs: { type: 'number', inputmode: 'numeric', min: String(spec.min ?? 0), max: String(spec.max ?? 9999), step: String(spec.step ?? 1), value: String(value), 'aria-label': label } }) as HTMLInputElement;
  inp.addEventListener('input', () => { const n = Number(inp.value); if (Number.isFinite(n)) onChange(Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, Math.round(n)))); });
  return h('label', { class: 'num-wrap' }, h('span', { class: 'dim small', text: spec.type === 'pct' ? '%' : spec.label }), inp);
}

export class DirectivesPanel {
  shown = false;
  private tab: AutoTab = 'directives';
  private readonly tabRow = h('div', { class: 'tabs', attrs: { role: 'tablist' } });
  private readonly content = h('div', { class: 'auto-content' });
  private draft: Directive[] = [];
  private savedKey = '';
  private editing = -1;
  private queue: UpgradeRule[] = [];
  private queueKey = '';
  private dragFrom = -1;

  readonly el: HTMLElement;
  constructor(private readonly ctx: UiCtx) { this.el = h('div', { class: 'automation' }, this.tabRow, this.content); }

  get isOpen(): boolean { return this.shown; }

  setShown(on: boolean): void { this.shown = on; }

  /** Show a tab with fresh drafts of the live Directives and Upgrade Queue (the screen is being opened). */
  open(tab: AutoTab = 'directives'): void {
    const ui = this.ctx.state();
    if (!ui) return;
    this.tab = tab;
    this.draft = clone(ui.meta.directives);
    this.savedKey = serializeDirectives(this.draft);
    this.queue = clone(ui.meta.upgradeQueue);
    this.queueKey = JSON.stringify(this.queue);
    this.editing = -1;
    this.render();
  }

  update(ui: UiState): void {
    if (!this.isOpen) return;
    // Targeting and Blueprints mirror live state; editors keep their drafts.
    if (this.tab === 'targeting' || this.tab === 'blueprints') {
      const key = JSON.stringify([ui.build.targeting, ui.build.hardpoints, ui.meta.blueprints.length]);
      if (key !== this.content.dataset.key) this.render();
    }
  }

  private render(): void {
    const ui = this.ctx.state();
    if (!ui) return;
    clear(this.tabRow);
    for (const t of TABS) {
      const b = button(t.label, () => { this.tab = t.id; this.render(); }, { class: `tab${t.id === this.tab ? ' active' : ''}` });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', t.id === this.tab ? 'true' : 'false');
      this.tabRow.appendChild(b);
    }
    clear(this.content);
    this.content.dataset.key = JSON.stringify([ui.build.targeting, ui.build.hardpoints, ui.meta.blueprints.length]);
    if (this.tab === 'directives') this.renderDirectives(ui);
    else if (this.tab === 'targeting') this.renderTargeting(ui);
    else if (this.tab === 'queue') this.renderQueue(ui);
    else this.renderBlueprints(ui);
  }

  private locked(msg: string): void { this.content.appendChild(h('div', { class: 'locked-card' }, icon('lock', 'ico'), h('p', { text: msg }))); }

  // ------------------------------------------------------------ Directives
  private renderDirectives(ui: UiState): void {
    const r = rank(ui, 'directives');
    if (r <= 0) { this.locked('Directives unlock with the Prestige III node "Directives" (deepest-ever wave 60). Rules read WHEN condition AND condition → DO action, checked in priority order.'); return; }
    const slots = directiveSlots(r);
    const autonomy = rank(ui, 'autonomy') > 0;
    const list = h('ol', { class: 'rules' });
    this.draft.forEach((d, i) => list.appendChild(this.ruleCard(d, i, autonomy)));
    const dirty = serializeDirectives(this.draft) !== this.savedKey;
    const add = button([icon('plus'), 'Add rule'], () => { this.draft.push(newDirective()); this.editing = this.draft.length - 1; this.render(); }, { class: 'btn', disabled: this.draft.length >= slots });
    const save = button('Save', () => { this.ctx.host.send({ type: 'set_directives', directives: clone(this.draft) }); this.savedKey = serializeDirectives(this.draft); this.editing = -1; this.ctx.toast('Directives saved', 'good'); this.render(); }, { class: 'btn primary', disabled: !dirty });
    const revert = button('Revert', () => { const u = this.ctx.state(); if (u) this.draft = clone(u.meta.directives); this.editing = -1; this.render(); }, { class: 'btn ghost', disabled: !dirty });
    this.content.append(
      h('p', { class: 'dim small', text: `${this.draft.length}/${slots} rule slots. Checked top to bottom; the first rule whose conditions all hold acts (0.6 s reaction delay).${autonomy ? '' : ' Adept conditions and the Prestige action need Autonomy (Prestige IV).'}` }),
      this.draft.length ? list : h('p', { class: 'note', text: 'No rules yet. Example: WHEN 5 enemies in the inner ring → Repulsor Pulse.' }),
      h('div', { class: 'row gap wrap' }, add, h('span', { class: 'grow' }), revert, save));
  }

  private ruleCard(d: Directive, i: number, autonomy: boolean): HTMLElement {
    const sentence = h('span', { class: 'rule-text', text: describeDirective(d) });
    const toggle = h('input', { attrs: { type: 'checkbox', 'aria-label': `Enable rule ${i + 1}` } }) as HTMLInputElement;
    toggle.checked = d.enabled;
    toggle.addEventListener('change', () => { d.enabled = toggle.checked; this.render(); });
    const n = this.draft.length;
    const card = h('li', { class: `rule${d.enabled ? '' : ' off'}${this.editing === i ? ' editing' : ''}`, attrs: { draggable: 'true' } },
      h('div', { class: 'rule-head' },
        h('span', { class: 'grip', attrs: { 'aria-hidden': 'true' } }, icon('grip', 'ico tiny')),
        h('span', { class: 'rule-num', text: String(i + 1) }),
        h('label', { class: 'switch' }, toggle, h('span', { class: 'slider' })),
        sentence,
        button(icon('up'), () => { this.draft = moveItem(this.draft, i, -1); this.editing = -1; this.render(); }, { class: 'btn icon-btn ghost', label: `Move rule ${i + 1} up`, disabled: i === 0 }),
        button(icon('down'), () => { this.draft = moveItem(this.draft, i, 1); this.editing = -1; this.render(); }, { class: 'btn icon-btn ghost', label: `Move rule ${i + 1} down`, disabled: i === n - 1 }),
        button(this.editing === i ? 'Done' : 'Edit', () => { this.editing = this.editing === i ? -1 : i; this.render(); }, { class: 'btn small' }),
        button(icon('trash'), () => { this.draft.splice(i, 1); this.editing = -1; this.render(); }, { class: 'btn icon-btn ghost', label: `Delete rule ${i + 1}` })));
    card.addEventListener('dragstart', (e) => { this.dragFrom = i; e.dataTransfer?.setData('text/plain', String(i)); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop'); });
    card.addEventListener('dragleave', () => card.classList.remove('drop'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = this.dragFrom; this.dragFrom = -1;
      if (from < 0 || from === i) { card.classList.remove('drop'); return; }
      const out = this.draft.slice(); const [x] = out.splice(from, 1); out.splice(i, 0, x);
      this.draft = out; this.editing = -1; this.render();
    });
    if (this.editing === i) card.appendChild(this.builder(d, autonomy, () => text(sentence, describeDirective(d))));
    return card;
  }

  private builder(d: Directive, autonomy: boolean, changed: () => void): HTMLElement {
    const wrap = h('div', { class: 'builder' });
    const conds = h('div', { class: 'conds' });
    const renderConds = (): void => {
      clear(conds);
      d.conditions.forEach((c, j) => {
        const kindSel = h('select', { class: 'select', attrs: { 'aria-label': `Condition ${j + 1}` } },
          ...COND_KINDS.map((k) => h('option', { attrs: { value: k, ...(CONDITIONS[k].adept && !autonomy && c.kind !== k ? { disabled: '' } : {}) }, text: CONDITIONS[k].label + (CONDITIONS[k].adept ? ' (Adept)' : '') })));
        kindSel.value = c.kind;
        kindSel.addEventListener('change', () => { d.conditions[j] = defaultCondition(kindSel.value as CondKind); renderConds(); changed(); });
        const params = CONDITIONS[c.kind].params.map((p) => paramInput(p, (c as unknown as Record<string, unknown>)[p.key], (v) => { (c as unknown as Record<string, unknown>)[p.key] = v; changed(); }, `Condition ${j + 1}`));
        conds.appendChild(h('div', { class: 'cond-row' },
          h('span', { class: 'kw', text: j === 0 ? 'WHEN' : 'AND' }), kindSel, ...params,
          button(icon('close'), () => { d.conditions.splice(j, 1); renderConds(); changed(); }, { class: 'btn icon-btn ghost', label: `Remove condition ${j + 1}` })));
      });
      if (!d.conditions.length) conds.appendChild(h('div', { class: 'cond-row' }, h('span', { class: 'kw', text: 'WHEN' }), h('span', { class: 'dim', text: 'always' })));
      const add = button([icon('plus'), 'AND condition'], () => { d.conditions.push(defaultCondition('ce_at_least') as DirectiveCondition); renderConds(); changed(); }, { class: 'btn small', disabled: d.conditions.length >= MAX_CONDITIONS });
      conds.appendChild(add);
    };
    renderConds();
    const act = h('div', { class: 'act-row' });
    const renderAct = (): void => {
      clear(act);
      const a = d.action;
      const kindSel = h('select', { class: 'select', attrs: { 'aria-label': 'Action' } },
        ...ACT_KINDS.map((k) => h('option', { attrs: { value: k, ...(ACTIONS[k].autonomy && !autonomy && a.kind !== k ? { disabled: '' } : {}) }, text: ACTIONS[k].label + (ACTIONS[k].autonomy ? ' (Autonomy)' : '') })));
      kindSel.value = a.kind;
      kindSel.addEventListener('change', () => { d.action = defaultAction(kindSel.value as ActKind) as DirectiveAction; renderAct(); changed(); });
      act.append(h('span', { class: 'kw do', text: 'DO' }), kindSel, ...ACTIONS[a.kind].params.map((p) => paramInput(p, (a as unknown as Record<string, unknown>)[p.key], (v) => { (a as unknown as Record<string, unknown>)[p.key] = v; changed(); }, 'Action')));
    };
    renderAct();
    wrap.append(conds, act);
    return wrap;
  }

  // ------------------------------------------------------------ Targeting
  private renderTargeting(ui: UiState): void {
    if (rank(ui, 'directives') <= 0) { this.locked('Targeting Profiles unlock with the Prestige III node "Directives".'); return; }
    const systems: WeaponSystemId[] = ['primary', ...ui.build.hardpoints.filter((x): x is NonNullable<typeof x> => !!x)];
    const grid = h('div', { class: 'targeting' });
    for (const sys of systems) {
      const sel = h('select', { class: 'select', attrs: { 'aria-label': `${SYSTEM_LABELS[sys]} targeting` } }, ...TARGETING_PROFILES.map((p) => h('option', { attrs: { value: p.value }, text: p.label })));
      sel.value = ui.build.targeting[sys] ?? 'nearest';
      sel.addEventListener('change', () => this.ctx.host.send({ type: 'set_targeting', system: sys, profile: sel.value as TargetingProfile }));
      grid.appendChild(h('label', { class: 'tg-row' }, h('span', { class: 'tg-name', text: SYSTEM_LABELS[sys] }), sel));
    }
    this.content.append(h('p', { class: 'dim small', text: 'Each system picks targets in this priority. "Designated" follows your tap designations first.' }), grid);
  }

  // ------------------------------------------------------------ Upgrade Queue
  private renderQueue(ui: UiState): void {
    if (rank(ui, 'directives') <= 0) { this.locked('The Upgrade Queue unlocks with the Prestige III node "Directives".'); return; }
    const buyable = ui.shop.filter((e) => e.currency === 'scrap' && e.kind !== 'doctrine');
    const byTree = new Map<string, typeof buyable>();
    for (const e of buyable) { const k = String(e.tree); if (!byTree.has(k)) byTree.set(k, []); byTree.get(k)!.push(e); }
    const nodeSelect = (value: string, label: string, includeNone = false): HTMLSelectElement => {
      const sel = h('select', { class: 'select', attrs: { 'aria-label': label } },
        includeNone ? h('option', { attrs: { value: '' }, text: 'No keep-pace rule' }) : null,
        ...[...byTree].map(([tree, list]) => h('optgroup', { attrs: { label: TREE_LABEL[tree as TreeId] ?? tree } }, ...list.map((e) => h('option', { attrs: { value: e.node }, text: e.name })))));
      if (value && !buyable.some((e) => e.node === value)) sel.appendChild(h('option', { attrs: { value }, text: nodeName(value) }));
      sel.value = value;
      return sel;
    };
    const list = h('ol', { class: 'rules queue' });
    this.queue.forEach((r, i) => {
      const summary = h('span', { class: 'rule-text', text: describeUpgradeRule(r, nodeName) });
      const upd = (): void => text(summary, describeUpgradeRule(r, nodeName));
      const max = h('input', { class: 'num', attrs: { type: 'number', min: '1', max: '999', placeholder: 'max', value: r.maxRank !== undefined ? String(r.maxRank) : '', 'aria-label': 'Max rank' } }) as HTMLInputElement;
      max.addEventListener('input', () => { const n = Number(max.value); if (max.value === '' || !(n > 0)) delete r.maxRank; else r.maxRank = Math.round(n); upd(); saveBtn.disabled = JSON.stringify(this.queue) === this.queueKey; });
      const of = nodeSelect(r.keepWithin?.of ?? '', 'Keep within ranks of', true);
      const within = h('input', { class: 'num', attrs: { type: 'number', min: '0', max: '99', value: String(r.keepWithin?.ranks ?? 3), 'aria-label': 'Ranks' } }) as HTMLInputElement;
      const syncKeep = (): void => { if (!of.value) delete r.keepWithin; else r.keepWithin = { of: of.value as NodeId, ranks: Math.max(0, Math.round(Number(within.value) || 0)) }; upd(); saveBtn.disabled = JSON.stringify(this.queue) === this.queueKey; };
      of.addEventListener('change', syncKeep); within.addEventListener('input', syncKeep);
      list.appendChild(h('li', { class: 'rule' },
        h('div', { class: 'rule-head' }, h('span', { class: 'rule-num', text: String(i + 1) }), summary,
          button(icon('up'), () => { this.queue = moveItem(this.queue, i, -1); this.render(); }, { class: 'btn icon-btn ghost', label: 'Move up', disabled: i === 0 }),
          button(icon('down'), () => { this.queue = moveItem(this.queue, i, 1); this.render(); }, { class: 'btn icon-btn ghost', label: 'Move down', disabled: i === this.queue.length - 1 }),
          button(icon('trash'), () => { this.queue.splice(i, 1); this.render(); }, { class: 'btn icon-btn ghost', label: 'Remove' })),
        h('div', { class: 'q-builder' }, h('label', { class: 'num-wrap' }, h('span', { class: 'dim small', text: 'Up to rank' }), max),
          h('span', { class: 'dim small', text: 'Keep within' }), within, h('span', { class: 'dim small', text: 'ranks of' }), of)));
    });
    const pick = nodeSelect(buyable[0]?.node ?? '', 'Node to queue');
    const add = button([icon('plus'), 'Add'], () => { if (pick.value) { this.queue.push({ node: pick.value as NodeId }); this.render(); } }, { class: 'btn', disabled: !buyable.length });
    const saveBtn = button('Save queue', () => { this.ctx.host.send({ type: 'set_upgrade_queue', rules: clone(this.queue) }); this.queueKey = JSON.stringify(this.queue); this.ctx.toast('Upgrade Queue saved', 'good'); this.render(); }, { class: 'btn primary' });
    disable(saveBtn, JSON.stringify(this.queue) === this.queueKey);
    this.content.append(
      h('p', { class: 'dim small', text: 'An ordered buy list: the first affordable rule is bought. Keep-pace rules hold a node within N ranks of another (e.g. Barrier within 3 of Armor).' }),
      this.queue.length ? list : h('p', { class: 'note', text: 'The queue is empty.' }),
      h('div', { class: 'row gap wrap' }, pick, add, h('span', { class: 'grow' }), saveBtn));
  }

  // ------------------------------------------------------------ Blueprints
  private renderBlueprints(ui: UiState): void {
    const slots = rank(ui, 'blueprint_slots');
    if (slots <= 0) { this.locked('Blueprints unlock with the Prestige II node "Blueprint Slots" (deepest-ever wave 40). A Blueprint saves Frame, Hardpoints, Attunements, Doctrines, Targeting Profiles and the Upgrade Queue, loadable at Prestige start.'); return; }
    const list = h('div', { class: 'bp-list' });
    ui.meta.blueprints.forEach((b) => list.appendChild(h('div', { class: 'bp' },
      h('div', { class: 'bp-name' }, icon('blueprint', 'ico tiny'), b.name),
      h('p', { class: 'dim small', text: `${FRAME_BY_ID.get(b.frame)?.name ?? b.frame} · ${b.hardpoints.map((x) => TREE_LABEL[x]).join(', ') || 'no hardpoints'} · ${b.attunements.map((x) => TREE_LABEL[x]).join(', ') || 'no elements'}` }),
      h('p', { class: 'dim small', text: `Doctrines: ${Object.entries(b.doctrines).map(([t, d]) => `${TREE_LABEL[t as TreeId]}: ${d}`).join(', ') || 'none'} · Queue: ${b.upgradeQueue.length} rules` }))));
    const name = h('input', { class: 'text-in', attrs: { type: 'text', maxlength: '32', placeholder: 'Blueprint name', 'aria-label': 'Blueprint name', value: `Build ${ui.meta.blueprints.length + 1}` } }) as HTMLInputElement;
    const full = ui.meta.blueprints.length >= slots;
    const save = button('Save current build', async () => {
      const u = this.ctx.state(); if (!u) return;
      if (full && !(await confirmDialog('Blueprint slots full', `You have ${slots} slot${slots > 1 ? 's' : ''}. The sim decides which Blueprint the new one replaces.`, 'Save anyway'))) return;
      const bp: Blueprint = {
        name: name.value.trim() || `Build ${u.meta.blueprints.length + 1}`, frame: u.build.frame,
        hardpoints: u.build.hardpoints.filter((x): x is NonNullable<typeof x> => !!x),
        attunements: u.build.attunements.filter((x): x is NonNullable<typeof x> => !!x),
        doctrines: clone(u.build.doctrines), targeting: clone(u.build.targeting), upgradeQueue: clone(u.meta.upgradeQueue),
      };
      this.ctx.host.send({ type: 'save_blueprint', blueprint: bp });
      this.ctx.toast(`Blueprint "${bp.name}" saved`, 'good');
    }, { class: 'btn primary' });
    this.content.append(
      h('p', { class: 'dim small', text: `${ui.meta.blueprints.length}/${slots} slots. Load a Blueprint from the Prestige screen.` }),
      ui.meta.blueprints.length ? list : h('p', { class: 'note', text: 'No Blueprints saved yet.' }),
      h('div', { class: 'row gap wrap' }, name, save));
  }
}
