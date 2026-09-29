/**
 * Settings: Clarity slider, bloom, Auto-Prestige, export / import save, hard reset (double
 * confirm), install PWA, keyboard shortcuts, about.
 */
import '../styles/settings.css';
import type { UiState } from '@sim/core/types';
import { button, h } from './dom';
import { icon } from './icons';
import { confirmDialog, openModal } from './modal';
import { maybeOnboard } from './onboard';
import { setPref } from './prefs';
import type { UiCtx } from './ctx';

export const SHORTCUTS: [string, string][] = [
  ['Space', 'Pause and open the Kill-Chain Inspector'],
  ['1 – 4', 'Arm ability slot'],
  ['Esc', 'Cancel an armed ability / close a panel'],
  ['P', 'Toggle Push / Patrol'],
  ['B', 'Show / hide the upgrades panel'],
  ['F', 'Prestige Forecast'],
];

function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('span', { text: label }), hint ? h('span', { class: 'dim small', text: hint }) : null), control);
}

function toggle(label: string, on: boolean, change: (v: boolean) => void): HTMLLabelElement {
  const input = h('input', { attrs: { type: 'checkbox', 'aria-label': label } }) as HTMLInputElement;
  input.checked = on;
  input.addEventListener('change', () => change(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'slider' }));
}

export function openSettings(ctx: UiCtx): void {
  const ui: UiState | null = ctx.state();
  const clarity = ui?.meta.settings.clarity ?? 0.5;
  const val = h('span', { class: 'dim small', text: '' });
  const slider = h('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.05', value: String(clarity), 'aria-label': 'Clarity: Spectacle to Clarity' } }) as HTMLInputElement;
  let t = 0;
  const label = (v: number): string => (v < 0.2 ? 'Spectacle' : v > 0.8 ? 'Clarity' : 'Balanced');
  val.textContent = label(clarity);
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    val.textContent = label(v);
    ctx.host.setClarity(v);
    clearTimeout(t);
    t = window.setTimeout(() => ctx.host.send({ type: 'set_setting', key: 'clarity', value: v }), 200);
  });

  const exportArea = h('textarea', { class: 'save-text', attrs: { readonly: '', rows: '3', 'aria-label': 'Exported save string' } }) as HTMLTextAreaElement;
  exportArea.hidden = true;
  const exportBtn = button('Export save', async () => {
    const s = await ctx.host.exportSave();
    exportArea.value = s; exportArea.hidden = false; exportArea.select();
    try { await navigator.clipboard.writeText(s); ctx.toast('Save copied to clipboard', 'good'); } catch { ctx.toast('Select the text to copy it', 'info'); }
  }, { class: 'btn' });
  const downloadBtn = button('Download', async () => {
    const s = await ctx.host.exportSave();
    const a = h('a', { attrs: { href: URL.createObjectURL(new Blob([s], { type: 'text/plain' })), download: `citadel-save-${new Date().toISOString().slice(0, 10)}.txt` } });
    document.body.appendChild(a); a.click(); a.remove();
  }, { class: 'btn' });

  const importArea = h('textarea', { class: 'save-text', attrs: { rows: '3', placeholder: 'Paste a save string (CITADEL1:…)', 'aria-label': 'Save string to import' } }) as HTMLTextAreaElement;
  const importBtn = button('Import', async () => {
    const s = importArea.value.trim();
    if (!s) return;
    if (!(await confirmDialog('Import this save?', 'Your current progress is replaced. Export it first if you want to keep it.', 'Import', { danger: true }))) return;
    try { await ctx.host.importSave(s); } catch (e) { ctx.toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 'warn'); }
  }, { class: 'btn' });

  const reset = button('Hard reset…', async () => {
    if (!(await confirmDialog('Erase all progress?', 'Every Prestige, Echo, Star, Codex entry and setting on this device is deleted.', 'Erase', { danger: true }))) return;
    if (!(await confirmDialog('Are you absolutely sure?', 'This cannot be undone.', 'Yes, erase everything', { danger: true }))) return;
    await ctx.host.hardReset();
  }, { class: 'btn danger' });

  const install = button([icon('prestige'), 'Install app'], async () => { const ok = await ctx.host.install(); if (ok) install.hidden = true; }, { class: 'btn' });
  install.hidden = !ctx.host.canInstall();

  const autonomy = ((ui?.meta.prestigeRanks['prestige.autonomy'] ?? 0) | 0) > 0;
  const body = h('div', { class: 'settings' },
    row('Clarity', h('div', { class: 'range-wrap' }, slider, val), 'Spectacle ↔ Clarity: player effects fade, enemies never do'),
    row('Bloom', toggle('Bloom', ctx.host.bloomOn(), (v) => { ctx.host.setBloom(v); setPref('bloom', v); })),
    row('Auto-Prestige', toggle('Auto-Prestige', !!ui?.meta.settings.autoPrestige, (v) => ctx.host.send({ type: 'set_setting', key: 'autoPrestige', value: v })), autonomy ? 'Lets a Prestige Directive fire' : 'Needs Autonomy (Prestige IV) and a Prestige Directive'),
    h('h3', { class: 'sec-title', text: 'Save' }),
    h('p', { class: 'dim small', text: 'Autosaves to this device every 30 s and at every checkpoint.' }),
    h('div', { class: 'row gap wrap' }, exportBtn, downloadBtn), exportArea,
    importArea, h('div', { class: 'row gap wrap' }, importBtn),
    h('h3', { class: 'sec-title', text: 'Keyboard' }),
    h('dl', { class: 'keys' }, ...SHORTCUTS.flatMap(([k, d]) => [h('dt', null, h('kbd', { text: k })), h('dd', { text: d })])),
    h('h3', { class: 'sec-title', text: 'About' }),
    h('p', { class: 'dim small', text: 'Project Citadel: an idle tower-defense game where the tower is the character and each Prestige is a new machine. No dailies, no streaks, nothing decays.' }),
    h('div', { class: 'row gap wrap' }, install, button('Replay intro', () => maybeOnboard(true), { class: 'btn ghost' }), reset));
  openModal({ title: 'Settings', body, className: 'settings-modal' });
}
