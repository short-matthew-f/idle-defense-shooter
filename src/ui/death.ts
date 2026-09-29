/**
 * Death card (design pillar 3, "failure creates progress"): when the tower falls it says where and
 * what happens next, and offers three purchases that could help (open slot, Doctrine fork, best
 * affordable buys, or what you are saving toward with an ETA). Non-modal: the machine restarts on
 * its own; the card stays until dismissed, the next wave is cleared, or the next death replaces it.
 */
import '../styles/death.css';
import type { UiState } from '@sim/core/types';
import { button, h, text, clear } from './dom';
import { icon } from './icons';
import { fmtDuration, fmtNum } from './format';
import { deathHeadline, suggestPurchases, type Category, type Suggestion } from './advice';
import { BOSS_BY_ID, TREE_LABEL } from './content';
import type { UiCtx } from './ctx';

export class DeathCard {
  readonly el: HTMLElement;
  private readonly title = h('div', { class: 'dc-title' });
  private readonly sub = h('p', { class: 'dc-sub' });
  private readonly lead = h('p', { class: 'dc-lead' });
  private readonly list = h('div', { class: 'dc-list' });
  private key = '';
  private bought = new Set<string>();
  /** Open the upgrades panel at a category / tree. */
  reveal: (cat: Category, tree?: string) => void = () => {};

  constructor(private readonly ctx: UiCtx, private readonly rate: () => number) {
    const close = button(icon('close'), () => this.hide(), { class: 'btn icon-btn ghost dc-close', label: 'Dismiss' });
    this.el = h('section', { class: 'death-card', attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Tower destroyed' } },
      h('div', { class: 'dc-head' }, icon('skull', 'ico'), this.title, close), this.sub, this.lead, this.list);
    this.el.hidden = true;
  }

  get visible(): boolean { return !this.el.hidden; }

  /** Ev.TowerDeath: `wave` is where the tower fell. */
  show(wave: number, ui: UiState): void {
    const boss = ui.wave.isBoss && ui.wave.bossId ? BOSS_BY_ID.get(ui.wave.bossId)?.name ?? null : null;
    const hd = deathHeadline(wave, ui.run.checkpoint, boss);
    text(this.title, hd.title);
    text(this.sub, hd.sub);
    this.bought.clear();
    this.key = '';
    this.el.hidden = false;
    this.update(ui);
  }

  hide(): void { this.el.hidden = true; }

  update(ui: UiState): void {
    if (this.el.hidden) return;
    const sugg = suggestPurchases(ui, this.rate(), 3);
    text(this.lead, sugg.length ? `You have ${fmtNum(ui.run.scrap)} Scrap. These could help:` : `You have ${fmtNum(ui.run.scrap)} Scrap.`);
    // Rebuild only when the suggestions change (never under a finger at 10 Hz); ETAs refresh with them.
    const key = sugg.map((s) => s.kind === 'slot' ? `slot:${s.cat}` : `${s.entry.node}:${s.entry.rank}:${s.entry.affordable}:${s.kind === 'buy' && s.eta !== null ? Math.ceil(s.eta / 5) : ''}`).join(',');
    if (key === this.key) return;
    this.key = key;
    clear(this.list);
    for (const s of sugg) this.list.appendChild(this.row(s));
    this.list.appendChild(button('Open upgrades', () => this.reveal('chassis'), { class: 'btn ghost small dc-more' }));
  }

  private row(s: Suggestion): HTMLElement {
    if (s.kind === 'slot') {
      const el = s.cat === 'elements';
      return button([icon('plus', 'ico'), h('span', { class: 'dc-name', text: el ? 'Attune an element' : 'Mount a weapon system' }), h('span', { class: 'dc-why', text: el ? 'New slot open' : 'New hardpoint open' })],
        () => { this.reveal(s.cat, `slot:${s.slot}`); this.hide(); }, { class: 'btn dc-item slot' });
    }
    if (s.kind === 'doctrine') {
      const tree = TREE_LABEL[s.tree as keyof typeof TREE_LABEL] ?? s.tree;
      return button([icon('check', 'ico'), h('span', { class: 'dc-name', text: `Choose a ${tree} Doctrine` }), h('span', { class: 'dc-why', text: 'Fork open' })],
        () => { this.reveal(catOf(s.tree), s.tree); this.hide(); }, { class: 'btn dc-item' });
    }
    const e = s.entry;
    const done = this.bought.has(e.node);
    const price = h('span', { class: 'price scrap' }, icon('scrap', 'ico tiny'), fmtNum(e.cost));
    const why = s.affordable ? price : h('span', { class: 'dc-why' }, price, s.eta !== null ? ` in ~${fmtDuration(s.eta)}` : '');
    const label = e.rank > 0 && e.maxRank > 1 ? `${e.name} ${e.rank + 1}` : e.name;
    const b = button([done ? icon('check', 'ico') : null, h('span', { class: 'dc-name', text: label }), why], () => {
      if (!s.affordable) { this.reveal(catOf(e.tree), e.tree); return; }
      this.ctx.host.send({ type: 'buy', node: e.node });
      this.bought.add(e.node);
    }, { class: `btn dc-item${s.affordable ? ' affordable' : ''}` });
    b.setAttribute('aria-label', s.affordable ? `Buy ${e.name} for ${fmtNum(e.cost)} Scrap` : `${e.name}: ${fmtNum(e.cost)} Scrap${s.eta !== null ? `, affordable in about ${fmtDuration(s.eta)}` : ''}`);
    return b;
  }
}

function catOf(tree: string): Category {
  if (tree === 'fire' || tree === 'lightning' || tree === 'poison' || tree === 'frost') return 'elements';
  if (tree === 'ordnance' || tree === 'drones' || tree === 'blade' || tree === 'laser' || tree === 'gravitics') return 'hardpoints';
  if (tree === 'link' || tree === 'infuse' || tree === 'fusion') return 'cross';
  return 'chassis';
}
