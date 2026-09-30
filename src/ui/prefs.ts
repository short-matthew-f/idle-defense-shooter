/** Per-device UI preferences (not part of the save): localStorage, fail-safe. */
import type { TrialId } from '@sim/core/ids';
import type { TouchCal } from '@app/touch-cal';

export interface Prefs {
  /** Legacy (the old intro cards); the progressive reveal (progression.ts, coach.ts) replaced them. */
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
  /** Sound (audio pass): slider values 0..1 (gain = value², see src/audio/engine.ts), mute, music switch. */
  soundMaster: number;
  soundSfx: number;
  soundMusic: number;
  soundMuted: boolean;
  musicOn: boolean;
  /** Tap calibration (More → Help → Touch test); null = identity. Validated with parseCal on use. */
  touchCal: TouchCal | null;
  /** Progressive reveal (progression.ts): Settings → Show everything (every tab and control, as before the ladder). */
  showEverything: boolean;
  /** Coach banners already read (coach.ts ids). Presentation only: never decides what is revealed. */
  coachSeen: string[];
  /** Tabs opened at least once (a newly revealed tab carries a "New" badge until then). */
  tabsVisited: string[];
  /** The reveal bookkeeping was initialised on this device (an existing save starts with what it has marked read). */
  revealInit: boolean;
}

const KEY = 'citadel.prefs.v1';
const DEFAULTS: Prefs = { onboarded: false, bloom: true, affordableFirst: false, panelOpen: true, shopCategory: 'chassis', shopTree: 'ballistics', activeTrial: null, buyCoach: 0, buyQty: 1, suggestOpen: true,
  soundMaster: 0.71, soundSfx: 0.8, soundMusic: 0.55, soundMuted: false, musicOn: true, touchCal: null,
  showEverything: false, coachSeen: [], tabsVisited: [], revealInit: false };

let cache: Prefs | null = null;

export function prefs(): Prefs {
  if (cache) return cache;
  let stored: Partial<Prefs> = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>; } catch { /* private mode / blocked */ }
  cache = { ...DEFAULTS, ...stored };
  for (const k of ['coachSeen', 'tabsVisited'] as const) if (!Array.isArray(cache[k])) cache[k] = [];
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
