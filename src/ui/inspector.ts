/**
 * Kill-Chain Inspector (design §16): pausing freezes the field (no tick budget) and overlays a
 * list of the last ~15 s of deaths. Tapping a death asks the worker for its cause chain and shows
 * it as a sentence plus a vertical diagram (event → cause → cause …) with `src` chips.
 */
import '../styles/inspector.css';
import { Ev, type SimEvent, type UiState } from '@sim/core/types';
import { button, h, text, clear } from './dom';
import { icon } from './icons';
import { srcCategory } from './content';
import { titleCase } from './format';
import { openModal, type ModalHandle } from './modal';
import type { UiCtx } from './ctx';

export const EV_NAMES = [
  'Wave start', 'Wave clear', 'Boss phase', 'Boss tell', 'Boss counter', 'Boss killed',
  'Spawn', 'Hit', 'Kill', 'Explosion', 'Status', 'Status tick', 'Fusion', 'Triad', 'Linkage', 'Infusion', 'Anomaly',
  'Tower hit', 'Tower death', 'Barrier break', 'Second Core', 'Cast', 'Counter scored', 'Heal',
  'Purchase', 'Doctrine chosen', 'Mounted', 'Attuned', 'Anomaly picked', 'Core drop', 'Scrap gain',
  'Checkpoint', 'Attempt start', 'Prestige', 'Ascend', 'Fx', 'Codex', 'Chain',
] as const;
export const EV_KILL: number = Ev.Kill;
const WINDOW_TICKS = 15 * 60;
const MAX_KILLS = 400;

export function evName(t: number): string { return EV_NAMES[t] ?? `Event ${t}`; }

/** StateBit (core/events.ts): Frozen 1, Chilled 2, Burning 4, Poisoned 8, Shocked 16, Elite 32, Boss 64, Clump 128. */
export function victimLabel(bits: number): string {
  const who = bits & 64 ? 'Boss' : bits & 32 ? 'Elite' : bits & 128 ? 'Clump' : 'Enemy';
  const adj = bits & 1 ? 'frozen ' : bits & 4 ? 'burning ' : bits & 8 ? 'poisoned ' : bits & 16 ? 'shocked ' : bits & 2 ? 'chilled ' : '';
  return adj ? `${adj}${who.toLowerCase()}` : who;
}

export function srcChip(src: string): HTMLElement {
  return h('span', { class: `chip-src c-${srcCategory(src)}`, text: src ? titleCase(src.replace(/\./g, ' ').replace(/\+/g, ' + ')) : 'unknown' , title: src });
}

/** Ring of recent Kill events, trimmed to the last 15 s of sim time. */
export class KillRing {
  kills: SimEvent[] = [];
  push(events: readonly SimEvent[]): void {
    for (const e of events) if (e.type === EV_KILL) this.kills.push(e);
    if (!this.kills.length) return;
    const newest = this.kills[this.kills.length - 1].tick;
    let i = 0;
    while (i < this.kills.length && (this.kills[i].tick < newest - WINDOW_TICKS || this.kills.length - i > MAX_KILLS)) i++;
    if (i) this.kills.splice(0, i);
  }
  clear(): void { this.kills.length = 0; }
}

export class Inspector {
  readonly ring = new KillRing();
  private modal: ModalHandle | null = null;
  private readonly list = h('div', { class: 'insp-list', attrs: { role: 'list' } });
  private readonly detail = h('div', { class: 'insp-detail', attrs: { 'aria-live': 'polite' } });
  private readonly records = h('div', { class: 'insp-records' });
  private selected: HTMLElement | null = null;
  onPauseChange: ((p: boolean) => void) | null = null;

  constructor(private readonly ctx: UiCtx) {}

  get isOpen(): boolean { return !!this.modal?.open; }

  toggle(): void { if (this.isOpen) this.modal?.close(); else this.open(); }

  open(): void {
    if (this.isOpen) return;
    this.ctx.host.setPaused(true);
    this.onPauseChange?.(true);
    const ui = this.ctx.state();
    this.renderList(ui);
    clear(this.detail);
    this.detail.appendChild(h('p', { class: 'dim', text: 'Tap a death to trace why it happened.' }));
    const resume = button([icon('play'), 'Resume'], () => this.modal?.close(), { class: 'btn primary' });
    this.modal = openModal({
      title: 'Kill-Chain Inspector', variant: 'overlay', className: 'inspector-modal',
      body: h('div', { class: 'inspector' }, this.records, h('div', { class: 'insp-cols' }, this.list, this.detail)),
      footer: h('div', { class: 'row between' }, h('span', { class: 'dim small', text: 'Paused. Space resumes.' }), resume),
      onClose: () => { this.modal = null; this.ctx.host.setPaused(false); this.onPauseChange?.(false); },
    });
  }

  private renderList(ui: UiState | null): void {
    text(this.records, ui ? `Longest chain this run: ${ui.run.longestChain} · Record: ${ui.meta.records.longestChain}` : '');
    clear(this.list);
    const kills = this.ring.kills.slice().reverse();
    if (!kills.length) { this.list.appendChild(h('p', { class: 'dim', text: 'No deaths in the last 15 seconds.' })); return; }
    const now = ui?.tick ?? kills[0].tick;
    for (const k of kills) {
      const ago = Math.max(0, (now - k.tick) / 60);
      const kind = typeof k.data?.kind === 'string' ? titleCase(k.data.kind) : victimLabel(k.c ?? 0);
      const b = button([
        h('span', { class: 'insp-who', text: kind }),
        srcChip(k.src),
        h('span', { class: 'insp-ago', text: `${ago.toFixed(1)}s ago` }),
      ], () => { this.selected?.classList.remove('selected'); b.classList.add('selected'); this.selected = b; void this.trace(k); }, { class: 'insp-item' });
      b.setAttribute('role', 'listitem');
      this.list.appendChild(b);
    }
  }

  private async trace(k: SimEvent): Promise<void> {
    clear(this.detail);
    this.detail.appendChild(h('p', { class: 'dim', text: 'Tracing…' }));
    const r = await this.ctx.host.inspect(k.a, k.b);
    clear(this.detail);
    const chain = r.chain.length ? r.chain : [k];
    this.detail.append(
      h('p', { class: 'insp-sentence', text: r.sentence || `${victimLabel(k.c ?? 0)} killed by ${k.src}.` }),
      h('div', { class: 'insp-chain-len dim small', text: `${chain.length} link${chain.length === 1 ? '' : 's'}` }));
    const diagram = h('ol', { class: 'chain' });
    for (const e of chain) {
      diagram.appendChild(h('li', { class: `chain-step${e.type === Ev.Kill ? ' kill' : ''}` },
        h('span', { class: 'cs-type', text: evName(e.type) }), srcChip(e.src),
        h('span', { class: 'cs-meta dim small', text: `#${e.id} · t${(e.tick / 60).toFixed(1)}s` })));
    }
    this.detail.appendChild(diagram);
  }
}
