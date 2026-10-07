/**
 * Chain Codex (design §16): every distinct interaction is an entry. Groups: Fusions, Triads,
 * Linkages, Infusions, Anomalies, Counters, Chains, Boons (+ any other ids the sim records). Undiscovered
 * entries read "???" and the sim's hints are listed. Each entry: +0.25% damage and Scrap.
 *
 * Entry ids assumed (see report): fusion.<id>, triad.<id>, link.<a>+<b> / chassis.<x>+<hp>,
 * infuse.<system>.<element>, anomaly.<id>, counter.<boss> (sim: counter.boss.<boss>), chain.<n> for n in 3/5/8/12,
 * boon.<id> (docs/BOONS.md).
 */
import '../styles/codex.css';
import type { UiState } from '@sim/core/types';
import { h, text, clear } from './dom';
import { icon } from './icons';
import { ANOMALIES, BOONS, BOSSES, CHASSIS_LINKAGES, FUSIONS, INFUSIONS, TRIADS, WEAPON_LINKAGES } from './content';
import { plainDesc, titleCase } from './format';

export interface CodexEntry { id: string; name: string; desc: string; alt?: string[] }
export interface CodexGroup { name: string; entries: CodexEntry[] }

export const CODEX_BONUS_PER_ENTRY = 0.0025;

export function codexGroups(): CodexGroup[] {
  return [
    { name: 'Fusions', entries: FUSIONS.map((f) => ({ id: `fusion.${f.id}`, name: f.name, desc: plainDesc(f.desc) })) },
    { name: 'Triads', entries: TRIADS.map((f) => ({ id: `triad.${f.id}`, name: f.name, desc: plainDesc(f.desc) })) },
    { name: 'Linkages', entries: [...WEAPON_LINKAGES, ...CHASSIS_LINKAGES].map((l) => ({ id: l.id, name: l.name, desc: plainDesc(l.desc) })) },
    // the full node text (what the Upgrades row says, with its numbers), not the sim's one-to-four-word tag line
    { name: 'Infusions', entries: INFUSIONS.map((i) => ({ id: i.id, name: i.name, desc: plainDesc(i.node.desc || i.desc) })) },
    { name: 'Anomalies', entries: ANOMALIES.map((a) => ({ id: `anomaly.${a.id}`, name: a.name, desc: plainDesc(a.desc), alt: [a.id] })) },
    // the sim records a boss Counter under its Ev.BossCounter src: `counter.boss.<id>`
    { name: 'Counters', entries: BOSSES.map((b) => ({ id: `counter.${b.id}`, name: `Countered ${b.name.replace(/^The /, 'the ')}`, desc: plainDesc(b.tell.desc), alt: [`counter.boss.${b.id}`] })) },
    { name: 'Chains', entries: [3, 5, 8, 12].map((n) => ({ id: `chain.${n}`, name: `${n}-link chain`, desc: `A single kill caused by ${n} different effects in a row.` })) },
    // Boons: the first pick of each boon (or its first firing) records `boon.<id>`
    { name: 'Boons', entries: BOONS.map((b) => ({ id: `boon.${b.id}`, name: b.name, desc: plainDesc(b.desc) })) },
  ];
}

let nameIndex: Map<string, string> | null = null;
/** The display name of a Codex entry id for the discovery toast ("3-link chain", "Broodheart's counter"); a readable fallback for unknown ids. */
export function codexEntryName(id: string): string {
  if (!nameIndex) {
    nameIndex = new Map();
    for (const g of codexGroups()) for (const e of g.entries) { nameIndex.set(e.id, e.name); for (const a of e.alt ?? []) nameIndex.set(a, e.name); }
  }
  const hit = nameIndex.get(id);
  if (hit) return hit;
  if (id.startsWith('trial.')) return `${titleCase(id.slice(6))} trial`;
  return titleCase(id.replace(/^[a-z]+\./, ''));
}

export class CodexPanel {
  shown = false;
  readonly el: HTMLElement;
  private readonly groups = codexGroups();
  private readonly known = new Set(this.groups.flatMap((g) => g.entries.flatMap((e) => [e.id, ...(e.alt ?? [])])));
  private readonly summary = h('div', { class: 'codex-summary' });
  private readonly hints = h('div', { class: 'codex-hints' });
  private readonly list = h('div', { class: 'codex-groups' });
  private key = '';

  constructor() { this.el = h('div', { class: 'codex' }, this.summary, this.hints, this.list); }

  get isOpen(): boolean { return this.shown; }
  setShown(on: boolean, ui: UiState | null): void {
    this.shown = on;
    if (on) { this.key = ''; if (ui) this.update(ui); }
  }

  update(ui: UiState): void {
    if (!this.isOpen) return;
    const codex = ui.meta.codex;
    const key = Object.keys(codex).filter((k) => codex[k] > 0).sort().join(',') + '|' + ui.hints.join('|');
    if (key === this.key) return;
    this.key = key;
    const hit = (id: string): boolean => (codex[id] | 0) > 0;
    const found = (e: CodexEntry): boolean => hit(e.id) || (e.alt ?? []).some(hit);
    const other = Object.keys(codex).filter((k) => codex[k] > 0 && !this.known.has(k)).sort();
    const groups = other.length ? [...this.groups, { name: 'Other discoveries', entries: other.map((id) => ({ id, name: titleCase(id), desc: '' })) }] : this.groups;
    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    const disc = groups.reduce((n, g) => n + g.entries.filter(found).length, 0);
    text(this.summary, `${disc} / ${total} entries discovered · +${(disc * CODEX_BONUS_PER_ENTRY * 100).toFixed(2)}% damage and Scrap`);
    clear(this.hints);
    if (ui.hints.length) {
      this.hints.append(h('h3', { class: 'sec-title', text: 'Rumours' }), h('ul', { class: 'hint-list' }, ...ui.hints.map((t) => h('li', null, icon('info', 'ico tiny'), t))));
    }
    clear(this.list);
    for (const g of groups) {
      const n = g.entries.filter(found).length;
      const sec = h('details', { class: 'codex-group' }, h('summary', null, h('span', { text: g.name }), h('span', { class: 'count', text: `${n}/${g.entries.length}` })));
      if (n > 0 || g === groups[0]) (sec as HTMLDetailsElement).open = true;
      const grid = h('div', { class: 'codex-grid' });
      for (const e of g.entries) {
        const ok = found(e);
        grid.appendChild(h('div', { class: `codex-entry${ok ? ' found' : ''}` },
          h('div', { class: 'ce-name' }, ok ? icon('check', 'ico tiny') : icon('lock', 'ico tiny'), ok ? e.name : '???'),
          ok && e.desc ? h('p', { class: 'ce-desc', text: e.desc }) : null));
      }
      sec.appendChild(grid);
      this.list.appendChild(sec);
    }
  }
}
