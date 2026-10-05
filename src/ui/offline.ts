/**
 * Offline return card: what the time away was worth and what to do next. Time counted against the cap, Scrap gained
 * (gold, like every Scrap figure), the top two things that Scrap makes affordable now, the next boss wave, and one big
 * Continue button at the bottom. With no income the card says why and how to earn while away.
 */
import '../styles/offline.css';
import type { UiState } from '@sim/core/types';
import { button, h } from './dom';
import { icon } from './icons';
import { fmtDuration, fmtNum } from './format';
import { openModal } from './modal';

/** The offline cap in seconds from the Long Patrol rank (8 h, +4 h per rank: sim `offline.cap_hours`). */
export function offlineCapSeconds(longPatrolRank: number): number { return (8 + 4 * Math.max(0, longPatrolRank | 0)) * 3600; }

/** "11 h" / "45 min": a duration in the unit a player reads at this size. */
export function fmtHours(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  const hrs = seconds / 3600;
  return `${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)} h`;
}

export interface OfflineSummary {
  /** "Counted 11 h of your 24 h cap" (plus " (you were away 30 h)" past the cap). */
  counted: string;
  capped: boolean;
  scrap: number;
  /** The names of up to two things the Scrap can buy now, best first, and how many more. */
  now: string[];
  more: number;
  /** "Next boss: wave 40" (null: unknown). */
  boss: string | null;
  /** Why nothing was earned, when scrap is 0. */
  zero: string | null;
}

/** What Scrap-affordable entries to name: behaviour changes before stat ranks, the pricier first. */
export function affordableNow(shop: UiState['shop']): { names: string[]; more: number } {
  const ok = shop.filter((e) => e.affordable && !e.locked && e.currency === 'scrap' && e.kind !== 'doctrine' && e.rank < e.maxRank);
  ok.sort((a, b) => (a.kind === 'stat' ? 1 : 0) - (b.kind === 'stat' ? 1 : 0) || b.cost - a.cost);
  return { names: ok.slice(0, 2).map((e) => e.name), more: Math.max(0, ok.length - 2) };
}

/** Pure: the card's lines from the time away, the Scrap and the state the player returns to. */
export function summarizeOffline(seconds: number, scrap: number, ui: Pick<UiState, 'shop' | 'run' | 'meta'> | null): OfflineSummary {
  const rank = ui ? ui.meta.prestigeRanks['prestige.long_patrol'] | 0 : 0;
  const cap = offlineCapSeconds(rank);
  const counted = Math.min(seconds, cap);
  const capped = seconds > cap;
  const aff = ui && scrap > 0 ? affordableNow(ui.shop) : { names: [], more: 0 };
  return {
    counted: `Counted ${fmtHours(counted)} of your ${fmtHours(cap)} cap${capped ? ` (you were away ${fmtDuration(seconds)})` : ''}`,
    capped, scrap, now: aff.names, more: aff.more,
    boss: ui ? `Next boss: wave ${ui.run.checkpoint + 5}` : null,
    zero: scrap > 0 ? null : 'Patrol earned nothing while you were away. Switch to Patrol before you leave to earn while away.',
  };
}

export function showOfflineReturn(seconds: number, scrap: number, estimated: boolean, ui: UiState | null = null): void {
  const s = summarizeOffline(seconds, scrap, ui);
  const body = h('div', { class: 'offline' },
    h('div', { class: 'off-gain' }, icon('scrap', 'ico'), h('span', { class: 'off-val', text: `+${fmtNum(scrap)} Scrap` })),
    estimated && scrap > 0 ? h('p', { class: 'dim small off-est', text: 'Estimated from your Patrol rate.' }) : null,
    h('p', { class: 'off-counted', text: s.counted }),
    s.zero ? h('p', { class: 'off-zero', text: s.zero }) : null,
    s.now.length ? h('p', { class: 'off-now' }, h('b', { text: 'Now affordable: ' }), s.now.join(', '), s.more ? ` and ${s.more} more` : '') : null,
    s.boss ? h('p', { class: 'off-boss', text: s.boss }) : null,
    h('p', { class: 'dim small', text: 'Offline income is your Patrol Scrap per second × time away × efficiency. Bosses are never cleared while you are away.' }));
  const go = button('Continue', () => m.close(), { class: 'btn primary wide off-continue' });
  const m = openModal({ title: 'Welcome back', body, footer: go, className: 'offline-modal' });
}
