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
  /** The Suggested line at the top of the Upgrades list is expanded to its chips (collapsed to one line by default). */
  suggestExpanded: boolean;
  /** Sound (audio pass): slider values 0..1 (gain = value², see src/audio/engine.ts), mute, music switch. */
  soundMaster: number;
  soundSfx: number;
  soundMusic: number;
  soundMuted: boolean;
  musicOn: boolean;
  /** Tap calibration (More → Help → Touch test); null = identity. Validated with parseCal on use. */
  touchCal: TouchCal | null;
  /**
   * Progressive reveal master switch (progression.ts `unlockAll`, alias showEverything): Settings → "Unlock everything
   * (for experienced players)". Every tab, control and content id, as before the unlock ladder. Survives reloads.
   */
  unlockAll: boolean;
  /** Coach banners already read (coach.ts ids). Presentation only: never decides what is revealed. */
  coachSeen: string[];
  /** Tabs opened at least once (a newly revealed tab carries a "New" badge until then). */
  tabsVisited: string[];
  /** The reveal bookkeeping was initialised on this device (an existing save starts with what it has marked read). */
  revealInit: boolean;
  /** Content-pool ids (progression.ts CONTENT_POOL) already seen in a picker: a later one reads "New" until then. */
  contentSeen: string[];
  /** The content-pool bookkeeping was initialised on this device (what an existing save already offers counts as seen). */
  contentInit: boolean;
  /** First-Prestige ceremony (ceremony.ts): the guided first Echo spend is running on the Prestige tab. */
  echoGuide: boolean;
  /** Pointer hints (pointer.ts / hints.ts): Settings → "Show pointer hints". */
  pointerHints: boolean;
  /** Pointer hints retired (hints.ts ids). Presentation only. */
  hintsDone: string[];
  /** The hint bookkeeping was initialised on this device (an existing save starts with its passed stages retired). */
  hintsInit: boolean;
  /** The first Core earned on this device got its one-line explainer toast (feed.ts). */
  coreExplained: boolean;
  /** Phase 2: the full Quartermaster card was shown once (unlocked); from then on Upgrades folds it to one line. */
  qmSeen: boolean;
  /** Phase 3 (accessibility): text size, percent of the base root size (100 / 115 / 130). */
  textScale: 100 | 115 | 130;
  /** Phase 3: left-hand layout: thumb controls (abilities, Overcharge, quick-buy) mirror to the left edge. */
  leftHand: boolean;
  /** Phase 3 (tap intent): ms a finger must rest before a press on the field becomes a hold/steer (0 = the default). */
  holdDelayMs: number;
  /** Phase 3 (timing assists): Overcharge releases itself at the top of the perfect band. */
  overchargeAssist: boolean;
  /** Phase 3 (timing assists): boss tell windows last longer (sent to the sim as a setting; deterministic). */
  tellAssist: boolean;
  /** Phase 3: optional vibration on tells and on low HP (only offered where the browser supports vibration). */
  hapticCues: boolean;
  /** Phase 3: announce boss start, tells and deaths to a screen reader (aria-live). */
  srAnnounce: boolean;
}

const KEY = 'citadel.prefs.v1';
const DEFAULTS: Prefs = { onboarded: false, bloom: true, affordableFirst: false, panelOpen: true, shopCategory: 'chassis', shopTree: 'ballistics', activeTrial: null, buyCoach: 0, buyQty: 1, suggestExpanded: false,
  soundMaster: 0.71, soundSfx: 0.8, soundMusic: 0.55, soundMuted: false, musicOn: true, touchCal: null,
  unlockAll: false, coachSeen: [], tabsVisited: [], revealInit: false, contentSeen: [], contentInit: false, echoGuide: false,
  pointerHints: true, hintsDone: [], hintsInit: false, coreExplained: false, qmSeen: false,
  textScale: 100, leftHand: false, holdDelayMs: 0, overchargeAssist: false, tellAssist: false, hapticCues: false, srAnnounce: true };

let cache: Prefs | null = null;

export function prefs(): Prefs {
  if (cache) return cache;
  let stored: Partial<Prefs> = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>; } catch { /* private mode / blocked */ }
  cache = { ...DEFAULTS, ...stored };
  for (const k of ['coachSeen', 'tabsVisited', 'contentSeen', 'hintsDone'] as const) if (!Array.isArray(cache[k])) cache[k] = [];
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
