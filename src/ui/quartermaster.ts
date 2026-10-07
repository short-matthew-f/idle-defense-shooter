/**
 * Quartermaster card (feature id 'quartermaster'; sim: src/sim/directives/quartermaster.ts, docs/QUARTERMASTER.md).
 * A compact, phone-first card: master switch, its Bank (amount and what flows in per second), the "Share of income"
 * segmented control (10/25/50/75/100%), one switch per tree with the ranks it bought this run, and one plain sentence.
 * Before the first Prestige it is a single teaser line.
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
import { fmtAmount, fmtRate } from './format';
import { RateMeter } from './hud';
import type { UiCtx } from './ctx';

/** The share choices the sim accepts (directives/quartermaster.ts QM_SHARES). */
export const QM_SHARE_CHOICES = [10, 25, 50, 75, 100] as const;
export const QM_EXPLAIN = 'It banks a share of everything you earn and spends only that. Your own Scrap is never touched. It never makes choices for you.';
export const QM_TEASER = 'Unlocks after your first Prestige';
export const QM_IDLE = 'Nothing left to buy: all your income is yours';
export const QM_BUYS_WHEN = 'Buys when it can afford the cheapest enabled stat';

/** One-line status under the switches ("Bought 12 ranks this run · 3.4K Scrap"). Pure (tests). */
export function qmSummary(q: Pick<QuartermasterUi, 'on' | 'boughtThisRun' | 'scrapSpentThisRun'>): string {
  if (q.boughtThisRun <= 0) return q.on ? 'Nothing bought yet this run.' : 'Off. Switch it on to let it buy.';
  return `Bought ${q.boughtThisRun} rank${q.boughtThisRun === 1 ? '' : 's'} this run · ${fmtAmount(q.scrapSpentThisRun)} Scrap`;
}

/** Label for the share control ("Quartermaster takes 50% of new Scrap"). Pure (tests). */
export function qmShareLabel(share: number): string {
  return share >= 100 ? 'Quartermaster takes all new Scrap' : `Quartermaster takes ${share}% of new Scrap`;
}

export class QuartermasterPanel {
  readonly el: HTMLElement;
  private readonly teaser = h('p', { class: 'qm-teaser' }, icon('lock', 'ico'), h('span', { text: QM_TEASER }));
  private readonly body = h('div', { class: 'qm-body' });
  private readonly master = h('input', { attrs: { type: 'checkbox', 'aria-label': 'Quartermaster on' } }) as HTMLInputElement;
  private readonly bankVal = h('span', { class: 'qm-bank-val' });
  private readonly bankRate = h('span', { class: 'qm-bank-rate' });
  private readonly bankNote = h('p', { class: 'qm-note qm-bank-note' });
  private readonly bank = h('div', { class: 'qm-bank', attrs: { role: 'status', 'aria-live': 'off' } },
    icon('bank', 'ico qm-bank-ico'),
    h('span', { class: 'qm-bank-stack' }, h('span', { class: 'qm-bank-label', text: 'Bank' }), h('span', { class: 'qm-bank-line' }, this.bankVal, this.bankRate)));
  private readonly seg = h('div', { class: 'qm-seg', attrs: { role: 'radiogroup', 'aria-label': 'Share of income' } });
  private readonly segBtns: HTMLButtonElement[] = [];
  private readonly shareNote = h('p', { class: 'qm-note' });
  private readonly trees = h('ul', { class: 'qm-trees' });
  private readonly summary = h('p', { class: 'qm-note' });
  private treeKey = '';
  private readonly rows = new Map<TreeId, { input: HTMLInputElement; count: HTMLElement; row: HTMLElement }>();
  /** What flows into the bank per play second (increases only: its buys and releases do not count). */
  private rate = new RateMeter();

  constructor(private readonly ctx: UiCtx) {
    this.master.addEventListener('change', () => this.ctx.host.send({ type: 'set_quartermaster', on: this.master.checked }));
    for (const r of QM_SHARE_CHOICES) {
      const b = button(`${r}%`, () => this.ctx.host.send({ type: 'set_quartermaster', share: r }), { class: 'qm-seg-btn' });
      b.setAttribute('role', 'radio');
      this.segBtns.push(b);
      this.seg.appendChild(b);
    }
    this.body.append(
      h('p', { class: 'qm-explain', text: QM_EXPLAIN }),
      this.bank, this.bankNote,
      h('div', { class: 'qm-label', text: 'Share of income' }), this.seg, this.shareNote,
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
    this.el.classList.toggle('idle', q.on && q.idle);
    text(this.bankVal, fmtAmount(q.bank));
    const rate = this.rate.push(ui.run.playSeconds, q.bank);
    text(this.bankRate, q.on && !q.idle && rate > 0 ? fmtRate(rate) : '');
    text(this.bankNote, !q.on ? 'Off: all your income is yours.' : q.idle ? QM_IDLE : QM_BUYS_WHEN);
    attr(this.bank, 'aria-label', `Quartermaster bank: ${fmtAmount(q.bank)} Scrap`);
    QM_SHARE_CHOICES.forEach((r, i) => {
      const b = this.segBtns[i];
      b.classList.toggle('active', r === q.share);
      attr(b, 'aria-checked', r === q.share ? 'true' : 'false');
    });
    text(this.shareNote, qmShareLabel(q.share));
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
