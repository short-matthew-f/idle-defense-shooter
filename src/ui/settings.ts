/**
 * Settings (a More sub-screen): Clarity slider, bloom, Auto-Prestige, Unlock everything (progressive reveal
 * master switch), export / import save, Start over (hard reset, double confirm), install PWA. Help (another
 * sub-screen): gestures, keyboard shortcuts, the coach tips unlocked so far (and replay them), about.
 */
import '../styles/settings.css';
import { BUILD, checkForUpdate } from '@app/pwa';
import type { UiState } from '@sim/core/types';
import { button, h } from './dom';
import { icon } from './icons';
import { confirmDialog } from './modal';
import { unlockedCoach } from './coach';
import { prefs, setPref } from './prefs';
import { graphicsSettings } from './graphics-settings';
import { soundSettings } from '../audio/ui';
import type { UiCtx } from './ctx';
import { openTouchTest } from './touch-test';
import { replayHints } from './pointer';

export const SHORTCUTS: [string, string][] = [
  ['Space', 'Pause and open the Kill-Chain Inspector'],
  ['1 – 4', 'Arm ability slot'],
  ['Esc', 'Cancel an armed ability / close a dialog / back to Battle'],
  ['P', 'Toggle Push / Patrol'],
  ['B', 'Upgrades (phone) · show or hide the side panel (desktop)'],
  ['F', 'Prestige Forecast'],
  ['Q', 'Buy quantity: ×1 → ×10 → Max (Upgrades)'],
];

export const GESTURES: [string, string][] = [
  ['Tap an enemy', 'Designate it: every weapon prefers it. Tap it again to clear. With two designators, a third tap replaces the older'],
  ['Hold on the field', 'Steer the main gun toward your finger'],
  ['Tap an ability', 'Arm it, then tap the field (or an enemy) to cast'],
  ['Hold an ability', 'Change what is in that slot'],
  ['Tap a price', 'Buy one rank; hold to keep buying'],
  ['Swipe back', 'Return to Battle from any screen'],
];

function row(label: string, control: HTMLElement, hint?: string, stack = false): HTMLElement {
  return h('div', { class: `set-row${stack ? ' stack' : ''}` }, h('div', { class: 'set-label' }, h('span', { text: label }), hint ? h('span', { class: 'dim small', text: hint }) : null), control);
}

function toggle(label: string, on: boolean, change: (v: boolean) => void): HTMLLabelElement {
  const input = h('input', { attrs: { type: 'checkbox', 'aria-label': label } }) as HTMLInputElement;
  input.checked = on;
  input.addEventListener('change', () => change(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'slider' }));
}

/** The Settings sub-screen's content (built fresh each time it opens, so it shows current values). */
export function settingsPanel(ctx: UiCtx): HTMLElement {
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

  const reset = button('Start over (new game)…', async () => {
    if (!(await confirmDialog('Start over?', 'Every Prestige, Echo, Star, Codex entry and setting on this device is deleted. The game starts again from wave 1, tips included.', 'Erase and start over', { danger: true }))) return;
    if (!(await confirmDialog('Are you absolutely sure?', 'This cannot be undone.', 'Yes, erase everything', { danger: true }))) return;
    await ctx.host.hardReset();
  }, { class: 'btn danger' });

  const install = button([icon('prestige'), 'Install app'], async () => { const ok = await ctx.host.install(); if (ok) install.hidden = true; }, { class: 'btn' });
  install.hidden = !ctx.host.canInstall();

  const autonomy = ((ui?.meta.prestigeRanks['prestige.autonomy'] ?? 0) | 0) > 0;
  // the progressive reveal's master switch (progression.ts unlockAll); GameUi applies it on the next UiState
  const unlock = toggle('Unlock everything', prefs().unlockAll, (v) => {
    setPref('unlockAll', v);
    ctx.toast(v ? 'Everything unlocked: every tab and control shows' : 'Unlocks follow your progress again', 'info');
  });
  const body = h('div', { class: 'settings' },
    row('Clarity', h('div', { class: 'range-wrap' }, slider, val), 'Spectacle ↔ Clarity: player effects fade, enemies never do', true),
    row('Unlock everything', unlock, 'For experienced players: every tab, control and choice from the start, instead of one at a time as you climb.'),
    row('Show pointer hints', toggle('Show pointer hints', prefs().pointerHints !== false, (v) => setPref('pointerHints', v)), 'A soft ring on the control a tip is about'),
    row('Auto-Prestige', toggle('Auto-Prestige', !!ui?.meta.settings.autoPrestige, (v) => ctx.host.send({ type: 'set_setting', key: 'autoPrestige', value: v })), autonomy ? 'Lets a Prestige Directive fire' : 'Needs Autonomy (Prestige IV) and a Prestige Directive'),
    ...graphicsSettings(ctx, row, toggle),
    ...soundSettings(row, toggle),
    h('h3', { class: 'sec-title', text: 'Save' }),
    h('p', { class: 'dim small', text: 'Autosaves to this device every 30 s and at every checkpoint.' }),
    h('div', { class: 'row gap wrap' }, exportBtn, downloadBtn), exportArea,
    importArea, h('div', { class: 'row gap wrap' }, importBtn),
    h('h3', { class: 'sec-title', text: 'App' }),
    h('div', { class: 'row gap wrap' }, install),
    h('p', { class: 'dim small', text: 'Start over erases this device\'s progress and plays the opening again from the beginning, one unlock at a time.' }),
    h('div', { class: 'row gap wrap' }, reset));
  return body;
}

/** The Help sub-screen: gestures, keyboard shortcuts, the tips unlocked so far (and replaying them), about. */
export function helpPanel(ctx: UiCtx): HTMLElement {
  const tips = unlockedCoach(ctx.features());
  return h('div', { class: 'settings help' },
    h('h3', { class: 'sec-title', text: 'Tips' }),
    h('ul', { class: 'tips' }, ...tips.map((m) => h('li', { text: m.text }))),
    h('div', { class: 'row gap wrap' }, button('Replay hints', () => { replayHints(); ctx.toast('Hints will point again where they still apply', 'info'); }, { class: 'btn' })),
    h('h3', { class: 'sec-title', text: 'Touch' }),
    h('dl', { class: 'keys' }, ...GESTURES.flatMap(([k, d]) => [h('dt', { text: k }), h('dd', { text: d })])),
    h('h3', { class: 'sec-title', text: 'Keyboard' }),
    h('dl', { class: 'keys' }, ...SHORTCUTS.flatMap(([k, d]) => [h('dt', null, h('kbd', { text: k })), h('dd', { text: d })])),
    h('h3', { class: 'sec-title', text: 'About' }),
    h('p', { class: 'dim small', text: 'Project Citadel: an idle tower-defense game where the tower is the character and each Prestige is a new machine. No dailies, no streaks, nothing decays.' }),
    h('p', { class: 'dim small build-id', text: `Build ${BUILD}` }),
    h('div', { class: 'row gap wrap' }, updateButton()),
    h('h3', { class: 'sec-title', text: 'Tap accuracy' }),
    h('p', { class: 'dim small', text: 'Taps landing off target? The touch test shows where the browser reads each touch and where the game acts on it, and can calibrate taps for this device.' }),
    h('div', { class: 'row gap wrap' }, button('Touch test', () => openTouchTest(ctx), { class: 'btn' })),
    h('h3', { class: 'sec-title', text: 'Layout diagnostics' }),
    diagnostics());
}

/** Viewport, safe-area and bar measurements as the browser reports them (for layout bug reports). */
function diagnostics(): HTMLElement {
  const pre = h('pre', { class: 'diag' });
  const rect = (sel: string): string => {
    const e = document.querySelector(sel);
    if (!e) return `${sel}: none`;
    const b = e.getBoundingClientRect();
    return `${sel}: top ${b.top.toFixed(0)} bottom ${b.bottom.toFixed(0)} h ${b.height.toFixed(0)} w ${b.width.toFixed(0)}`;
  };
  const refresh = (): void => {
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const ps = getComputedStyle(probe);
    const sat = ps.paddingTop, sab = ps.paddingBottom;
    probe.remove();
    const vv = window.visualViewport;
    const nav = navigator as Navigator & { standalone?: boolean };
    pre.textContent = [
      `build ${BUILD}`,
      `inner ${innerWidth}×${innerHeight}  outer ${outerWidth}×${outerHeight}  dpr ${devicePixelRatio}`,
      `screen ${screen.width}×${screen.height}  avail ${screen.availWidth}×${screen.availHeight}`,
      `visualViewport ${vv ? `${vv.width.toFixed(0)}×${vv.height.toFixed(0)} off ${vv.offsetTop.toFixed(0)} scale ${vv.scale}` : 'n/a'}`,
      `html client ${document.documentElement.clientWidth}×${document.documentElement.clientHeight}  body h ${document.body.getBoundingClientRect().height.toFixed(0)}`,
      `safe-area top ${sat} bottom ${sab}  vars --safe-top ${cs.getPropertyValue('--safe-top').trim()} --top-h ${cs.getPropertyValue('--top-h').trim()} --tab-h ${cs.getPropertyValue('--tab-h').trim()}`,
      `standalone ${String(nav.standalone)}  display-mode ${matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'}`,
      rect('#app'), rect('#game'), rect('#ui'), rect('.topbar'), rect('.wave-num'), rect('.battle-layer'), rect('.tabbar'),
      `body classes ${document.body.className}`,
      navigator.userAgent,
    ].join('\n');
  };
  refresh();
  window.addEventListener('resize', refresh);
  return h('div', null, pre, h('div', { class: 'row gap wrap' }, button('Refresh', refresh, { class: 'btn' }), button('Copy', () => { void navigator.clipboard?.writeText(pre.textContent ?? ''); }, { class: 'btn' })));
}

/** "Check for updates": asks the service worker for a newer build and reports what happened. */
function updateButton(): HTMLElement {
  const status = h('span', { class: 'dim small' });
  const btn = button('Check for updates', async () => {
    btn.disabled = true; status.textContent = 'Checking…';
    const r = await checkForUpdate();
    status.textContent = r === 'waiting' || r === 'checking' ? 'Update found: it installs between waves.'
      : r === 'none' ? 'You have the latest version.'
      : 'Updates are checked when installed from the home screen or served over https.';
    btn.disabled = false;
  }, { class: 'btn' });
  return h('span', { class: 'row gap' }, btn, status);
}
