/** Main menu: a list of screens, each with its lock state. */
import '../styles/menu.css';
import type { UiState } from '@sim/core/types';
import { button, h } from './dom';
import { icon } from './icons';
import { openModal } from './modal';
import type { ScreenId, UiCtx } from './ctx';

interface Item { id: ScreenId; label: string; icon: string; hint: string; lock?: (ui: UiState) => string | null }
const pr = (ui: UiState, id: string): number => ui.meta.prestigeRanks[`prestige.${id}`] | 0;

export const MENU_ITEMS: Item[] = [
  { id: 'forecast', label: 'Prestige Forecast', icon: 'forecast', hint: 'When to reset', lock: (ui) => (ui.run.deepestCleared < 20 && ui.meta.prestigeCount === 0 ? 'Opens at wave 20' : null) },
  { id: 'prestige_shop', label: 'Prestige upgrades', icon: 'echo', hint: 'Spend Echoes', lock: (ui) => (ui.meta.deepestEver < 20 ? 'Reach wave 20' : null) },
  { id: 'constellation', label: 'Ascension', icon: 'ascension', hint: 'Constellation and Stars', lock: (ui) => (ui.meta.ascension === 0 && ui.run.deepestCleared < 100 ? 'Beat wave 100' : null) },
  { id: 'codex', label: 'Chain Codex', icon: 'codex', hint: 'Discovered interactions' },
  { id: 'directives', label: 'Directives', icon: 'directives', hint: 'Rules, targeting, Upgrade Queue', lock: (ui) => (pr(ui, 'directives') ? null : 'Prestige III') },
  { id: 'blueprints', label: 'Blueprints', icon: 'blueprint', hint: 'Saved builds', lock: (ui) => (pr(ui, 'blueprint_slots') ? null : 'Prestige II') },
  { id: 'trials', label: 'Trials', icon: 'trials', hint: 'Constraint runs', lock: (ui) => (pr(ui, 'trials') ? null : 'Prestige II') },
  { id: 'inspector', label: 'Kill-Chain Inspector', icon: 'inspector', hint: 'Pause and trace deaths' },
  { id: 'settings', label: 'Settings', icon: 'settings', hint: 'Clarity, saves, install' },
];

export function openMenu(ctx: UiCtx): void {
  const ui = ctx.state();
  const list = h('nav', { class: 'menu-list', attrs: { 'aria-label': 'Menu' } });
  const m = openModal({ title: 'Menu', body: list, className: 'menu-modal', variant: 'center' });
  for (const it of MENU_ITEMS) {
    const lock = ui && it.lock ? it.lock(ui) : null;
    list.appendChild(button([
      icon(it.icon, 'ico'),
      h('span', { class: 'mi-main' }, h('span', { class: 'mi-label', text: it.label }), h('span', { class: 'mi-hint', text: it.hint })),
      lock ? h('span', { class: 'mi-lock' }, icon('lock', 'ico tiny'), lock) : null,
    ], () => { m.close(); ctx.open(it.id); }, { class: `menu-item${lock ? ' locked' : ''}` }));
  }
}
