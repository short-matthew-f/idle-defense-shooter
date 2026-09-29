/** Per-device UI preferences (not part of the save): localStorage, fail-safe. */
import type { TrialId } from '@sim/core/ids';

export interface Prefs {
  onboarded: boolean;
  bloom: boolean;
  affordableFirst: boolean;
  sheetSnap: 'peek' | 'half' | 'full';
  panelOpen: boolean;
  shopCategory: string;
  shopTree: string;
  /** The Trial the player started (UiState does not report the active Trial; see report). */
  activeTrial: TrialId | null;
}

const KEY = 'citadel.prefs.v1';
const DEFAULTS: Prefs = { onboarded: false, bloom: true, affordableFirst: false, sheetSnap: 'peek', panelOpen: true, shopCategory: 'chassis', shopTree: 'ballistics', activeTrial: null };

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
