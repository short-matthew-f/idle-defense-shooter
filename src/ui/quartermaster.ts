/**
 * Quartermaster card (feature id 'quartermaster'; sim: src/sim/directives/quartermaster.ts, docs/QUARTERMASTER.md).
 * A compact, phone-first card: master switch, reserve segmented control (0/25/50/75%), one switch per tree with the
 * ranks it bought this run, and one plain sentence. Before the first Prestige it is a single teaser line.
 *
 * Mount: `const qm = new QuartermasterPanel(ctx); parent.appendChild(qm.el);` and call `qm.update(ui)` on every
 * UiState (it only touches the DOM when something changed). Every control sends `set_quartermaster` (a partial patch).
 */
import '../styles/quartermaster.css';
import type { TreeId } from '@sim/core/ids';
import type { QuartermasterUi, UiState } from '@sim/core/types';
import { attr, button, clear, h, show, text } from './dom';
import { icon } from './icons';
import { TREE_LABEL } from './content';
import { fmtNum } from './format';
import type { UiCtx } from './ctx';

/** The reserve choices the sim accepts (directives/quartermaster.ts QM_RESERVES). */
export const QM_RESERVE_CHOICES = [0, 25, 50, 75] as const;
export const QM_EXPLAIN = 'Keeps your repeatable stats topped up. It never makes choices for you.';
export const QM_TEASER = 'Unlocks after your first Prestige';

/** One-line status under the switches ("Bought 12 ranks this run · 3.4K Scrap"). Pure (tests). */
export function qmSummary(q: Pick<QuartermasterUi, 'on' | 'boughtThisRun' | 'scrapSpentThisRun'>): string {
  if (q.boughtThisRun <= 0) return q.on ? 'Nothing bought yet this run.' : 'Off. Switch it on to let it buy.';
  return `Bought ${q.boughtThisRun} rank${q.boughtThisRun === 1 ? '' : 's'} this run · ${fmtNum(q.scrapSpentThisRun)} Scrap`;
}

/** Label for the reserve control ("Keep 25% of Scrap for you"). Pure (tests). */
export function qmReserveLabel(reserve: number): string {
  return reserve <= 0 ? 'Spends all spare Scrap' : `Keeps ${reserve}% of your Scrap for your own picks`;
}

export class QuartermasterPanel {
  readonly el: HTMLElement;
  private readonly teaser = h('p', { class: 'qm-teaser' }, icon('lock', 'ico'), h('span', { text: QM_TEASER }));
  private readonly body = h('div', { class: 'qm-body' });
  private readonly master = h('input', { attrs: { type: 'checkbox', 'aria-label': 'Quartermaster on' } }) as HTMLInputElement;
  private readonly seg = h('div', { class: 'qm-seg', attrs: { role: 'radiogroup', 'aria-label': 'Scrap to keep for you' } });
  private readonly segBtns: HTMLButtonElement[] = [];
  private readonly reserveNote = h('p', { class: 'qm-note' });
  private readonly trees = h('ul', { class: 'qm-trees' });
  private readonly summary = h('p', { class: 'qm-note' });
  private treeKey = '';
  private readonly rows = new Map<TreeId, { input: HTMLInputElement; count: HTMLElement; row: HTMLElement }>();

  constructor(private readonly ctx: UiCtx) {
    this.master.addEventListener('change', () => this.ctx.host.send({ type: 'set_quartermaster', on: this.master.checked }));
    for (const r of QM_RESERVE_CHOICES) {
      const b = button(`${r}%`, () => this.ctx.host.send({ type: 'set_quartermaster', reserve: r }), { class: 'qm-seg-btn' });
      b.setAttribute('role', 'radio');
      this.segBtns.push(b);
      this.seg.appendChild(b);
    }
    this.body.append(
      h('p', { class: 'qm-explain', text: QM_EXPLAIN }),
      h('div', { class: 'qm-label', text: 'Keep for you' }), this.seg, this.reserveNote,
      this.trees, this.summary);
    this.el = h('section', { class: 'qm-card', attrs: { 'aria-label': 'Quartermaster' } },
      h('div', { class: 'qm-head' },
        h('span', { class: 'qm-title' }, icon('blueprint', 'ico'), 'Quartermaster'),
        h('label', { class: 'switch qm-master', data: { hint: 'quartermaster-toggle' } }, this.master, h('span', { class: 'slider' }))),
      this.teaser, this.body);
    show(this.body, false);
  }

  update(ui: UiState): void {
    const q = ui.quartermaster;
    const unlocked = !!q?.unlocked;
    show(this.teaser, !unlocked);
    show(this.body, unlocked);
    this.el.classList.toggle('locked', !unlocked);
    this.master.disabled = !unlocked;
    if (!q || !unlocked) { this.master.checked = false; return; }
    if (this.master.checked !== q.on) this.master.checked = q.on;
    this.el.classList.toggle('off', !q.on);
    QM_RESERVE_CHOICES.forEach((r, i) => {
      const b = this.segBtns[i];
      b.classList.toggle('active', r === q.reserve);
      attr(b, 'aria-checked', r === q.reserve ? 'true' : 'false');
    });
    text(this.reserveNote, qmReserveLabel(q.reserve));
    this.syncTrees(q);
    text(this.summary, qmSummary(q));
  }

  private syncTrees(q: QuartermasterUi): void {
    const key = q.trees.map((t) => t.tree).join(',');
    if (key !== this.treeKey) {
      this.treeKey = key;
      clear(this.trees);
      this.rows.clear();
      for (const t of q.trees) {
        const name = TREE_LABEL[t.tree] ?? t.tree;
        const input = h('input', { attrs: { type: 'checkbox', 'aria-label': `Quartermaster buys ${name} stats` } }) as HTMLInputElement;
        input.addEventListener('change', () => this.ctx.host.send({ type: 'set_quartermaster', trees: { [t.tree]: input.checked } }));
        const count = h('span', { class: 'qm-count' });
        const row = h('li', { class: 'qm-tree' }, h('span', { class: 'qm-tree-name', text: name }), count, h('label', { class: 'switch' }, input, h('span', { class: 'slider' })));
        this.rows.set(t.tree, { input, count, row });
        this.trees.appendChild(row);
      }
    }
    for (const t of q.trees) {
      const r = this.rows.get(t.tree);
      if (!r) continue;
      if (r.input.checked !== t.on) r.input.checked = t.on;
      r.row.classList.toggle('off', !t.on);
      text(r.count, t.bought > 0 ? `${t.bought} bought` : '');
    }
  }
}
