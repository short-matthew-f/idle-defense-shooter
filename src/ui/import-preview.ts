/**
 * Import preview (HANDBOOK-EVAL A-21): what a pasted save string holds, shown before "Import this save?" so the player can see
 * it is the save they meant (and not an empty one). Pure rows from a parsed save; the parse itself is the game's own import code
 * (host.parseSave), which reads and migrates but stores nothing.
 */
import type { SaveState } from '@sim/core/types';
import { h } from './dom';
import { fmtAmount } from './format';

export interface PreviewRow { label: string; value: string }

/** "5 Jan 2026, 14:03", or "unknown" for a save without a time. */
export function fmtSavedAt(ms: number): string {
  if (!(ms > 0)) return 'unknown';
  try { return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return 'unknown'; }
}

/** The four facts: Prestiges, deepest wave, Echoes, saved date. */
export function savePreviewRows(s: Pick<SaveState, 'savedAtMs'> & { meta: Pick<SaveState['meta'], 'prestigeCount' | 'deepestEver' | 'echoes'> }): PreviewRow[] {
  return [
    { label: 'Prestiges', value: fmtAmount(s.meta.prestigeCount | 0) },
    { label: 'Deepest wave', value: fmtAmount(s.meta.deepestEver | 0) },
    { label: 'Echoes', value: fmtAmount(s.meta.echoes || 0) },
    { label: 'Saved', value: fmtSavedAt(s.savedAtMs) },
  ];
}

/** The confirm dialog's body: the preview rows, then the warning. */
export function importConfirmBody(rows: readonly PreviewRow[]): HTMLElement {
  return h('div', { class: 'import-preview' },
    h('dl', { class: 'ip-rows' }, ...rows.flatMap((r) => [h('dt', { text: r.label }), h('dd', { text: r.value })])),
    h('p', { class: 'confirm-msg', text: 'Your current progress is replaced. Export it first if you want to keep it. Time between this save and now is not credited as offline progress.' }));
}
