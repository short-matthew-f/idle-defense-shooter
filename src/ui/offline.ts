/** Offline return: "You were away 3h 12m: Patrol earned N Scrap". */
import { h } from './dom';
import { icon } from './icons';
import { fmtDuration, fmtNum } from './format';
import { openModal } from './modal';

export function showOfflineReturn(seconds: number, scrap: number, estimated: boolean): void {
  const body = h('div', { class: 'offline' },
    h('div', { class: 'pr-gain' }, icon('scrap', 'ico'), h('span', { text: `+${fmtNum(scrap)} Scrap` })),
    h('p', { text: `You were away ${fmtDuration(seconds)}. Patrol earned ${fmtNum(scrap)} Scrap${estimated ? ' (estimated from your measured Patrol rate)' : ''}.` }),
    h('p', { class: 'dim small', text: 'Offline income is your measured Patrol Scrap per second × time away × efficiency, capped at 8 hours (24 with Long Patrol). Bosses are never cleared offline.' }));
  openModal({ title: 'Welcome back', body, className: 'offline-modal' });
}
