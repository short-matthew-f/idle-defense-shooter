/** Per-device UI preferences (not part of the save): localStorage, fail-safe. */
import type { TrialId } from '@sim/core/ids';

export interface Prefs {
  onboarded: boolean;
  bloom: boolean;
  affordableFirst: boolean;
  /** Desktop side panel shown (B toggles it). */
  panelOpen: boolean;
  shopCategory: string;
  shopTree: string;
  /** The Trial the player started (UiState does not report the active Trial; see report). */
  activeTrial: TrialId | null;
  /** Purchases made while the first-purchase coach was showing (it retires after 3). */
  buyCoach: number;
  /** Upgrades quantity selector: ranks per Buy tap (1, 10, 0 = Max). Q cycles it. */
  buyQty: 1 | 10 | 0;
  /** The Suggested card at the top of Upgrades is expanded. */
  suggestOpen: boolean;
}

const KEY = 'citadel.prefs.v1';
const DEFAULTS: Prefs = { onboarded: false, bloom: true, affordableFirst: false, panelOpen: true, shopCategory: 'chassis', shopTree: 'ballistics', activeTrial: null, buyCoach: 0, buyQty: 1, suggestOpen: true };

let cache: Prefs | null = null;

export function prefs(): Prefs {
  if (cache) return cache;
  let stored: Partial<Prefs> = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>; } catch { /* private mode / blocked */ }
  cache = { ...DEFAULTS, ...stored };
  return cache;
}

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
  const p = prefs();
  p[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function resetPrefs(): void {
  cache = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
