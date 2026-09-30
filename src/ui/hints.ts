/**
 * Pointer hints: which control the pointer ring (pointer.ts) lands on right now. Pure, no DOM.
 *
 * The coach banners (coach.ts) say what is new in one sentence; a hint SHOWS where: a ring on the exact control, with
 * at most a few words attached ("Tap here"). One ring at a time, chosen here by priority:
 *
 *   - a hint shows only while its condition holds (`when`), then retires (prefs.hintsDone, via the driver in pointer.ts);
 *   - a hint tied to a coach banner waits for that banner to show (or to have been read); while a banner is ON SCREEN
 *     (for its first BANNER_HOLD_MS) and some hint belongs to it, only that hint may point, so the sentence and the ring
 *     agree. A hidden banner (a phone tab covers Battle), an old one, or an info-only one (no hint of its own) holds
 *     nothing back. "Got it" snoozes the banner's own ring; it returns until the hint really completes;
 *   - when the control sits on another screen the hint CHAINS: tab button → category chip → the control, one step per
 *     navigation (`final` marks the last step: tapping it retires the hint);
 *   - nothing points while a modal, draft or death card is open, or while an ability is armed (except the one-time
 *     "tap the field" nudge, which exists for exactly that moment);
 *   - with Unlock everything on, only hints for genuinely new things (an opened slot, an offer, a recommendation) fire.
 *
 * Targets are `data-hint` keys (pointer.ts resolves them, with a selector / resolver registry for controls owned by
 * other modules). `registerHint` lets other layers add hints without this file depending on them.
 */
import type { FeatureId, Features } from './progression';

/** The part of UiState hints read (small, so tests stay small). */
export interface HintUi {
  run: { attunementSlotsOpen: number; hardpointSlotsOpen: number; boonOffer?: readonly unknown[] | null; pendingDraft?: readonly unknown[] | null };
  build: { attunements: readonly (string | null)[]; hardpoints: readonly (string | null)[]; abilities: readonly (string | null)[]; ranks: Readonly<Record<string, number>> };
  meta: { prestigeCount: number };
  forecast?: { recommended: boolean } | null;
  quartermaster?: { unlocked: boolean; on: boolean } | null;
}

export type HintScreen = 'upgrades' | 'build' | 'prestige' | 'more';

/** Everything else a hint depends on (the driver in pointer.ts gathers it from the live UI). */
export interface HintCtx {
  /** Features as shown (with Unlock everything, all on). */
  f: Features;
  /** Settings → "Show pointer hints". */
  enabled: boolean;
  unlockAll: boolean;
  /** prefs.hintsDone. */
  done: ReadonlySet<string>;
  /** prefs.tabsVisited. */
  visited: ReadonlySet<string>;
  /**
   * The coach banner that is current (shown, or waiting on Battle while a phone tab covers it), the ones read, whether
   * the current one is on screen now (default true) and for how long it has been on screen (ms, default 0).
   */
  coach: { current: string | null; seen: ReadonlySet<string>; visible?: boolean; visibleMs?: number };
  /** Hints snoozed by "Got it" on their banner (they come back once the banner is gone; see the driver). */
  snoozed?: ReadonlySet<string>;
  /** The screen on show (null: none) and whether the Battle arena is visible (always on desktop). */
  nav: { screen: HintScreen | null; battle: boolean };
  /** The Upgrades screen's category and tree chip (slot chips are `slot:<i>`). */
  shop: { cat: string; tree: string };
  /** A modal, draft or death card is open (or the touch test runs). */
  blocked: boolean;
  /** An ability is armed (waiting for a field tap). */
  armed: boolean;
  live: {
    /** The big Upgrade button can buy now. */
    starterReady: boolean;
    /** Starter-stat ranks owned (Damage + Fire Rate + Hull). */
    starterOwned: number;
    /** Enough CE for the first ability slot (its ability, or the cheapest one when empty). */
    ceReady: boolean;
    /** The boon offer was set aside: the "Boon ready" chip shows. */
    boonChip: boolean;
    /** An Anomaly draft was set aside with "Later". */
    draftWaiting: boolean;
    /** Upgrades: the Suggested card's "Buy all" shows. */
    buyAll?: boolean;
    /** Anything else a registered hint wants (e.g. `overchargeReady`). */
    [k: string]: boolean | number | undefined;
  };
}

export interface HintStep { target: string; text?: string; final: boolean }
export interface Hint extends HintStep { id: string }

export interface HintDef {
  id: string;
  /** Lower first. */
  prio: number;
  /**
   * The coach banner this hint belongs to (a coach.ts id, or an extra line's id such as 'qm-on'): the hint waits for
   * it, and "Got it" on it retires the hint while it points.
   */
  coach?: string;
  /** The feature whose reveal this hint explains (an existing save past it starts with the hint retired). */
  feature?: FeatureId;
  /** 'reveal': explains a stage reveal (skipped with Unlock everything). 'event': something genuinely new happened. */
  kind: 'reveal' | 'event';
  /** Shows only while an ability is armed (every other hint waits then). */
  whileArmed?: boolean;
  /** The condition: the hint applies (ignores prefs.hintsDone and navigation). */
  when(ui: HintUi, c: HintCtx): boolean;
  /** Where to point from the current screen (null: nowhere from here). */
  step(ui: HintUi, c: HintCtx): HintStep | null;
}

/** Longest attached label, in words (the banner keeps the full sentence). */
export const HINT_LABEL_MAX_WORDS = 8;

const emptySlot = (list: readonly (string | null)[], open: number): number => {
  for (let i = 0; i < open; i++) if (!list[i]) return i;
  return -1;
};

/** Upgrades → category → control. */
function viaUpgrades(c: HintCtx, cat: string | null, last: HintStep): HintStep {
  if (c.nav.screen !== 'upgrades') return { target: 'tab-upgrades', text: 'Open Upgrades', final: false };
  if (cat && c.shop.cat !== cat) return { target: `cat-${cat}`, text: 'Tap here', final: false };
  return last;
}
/** Build → control. */
function viaBuild(c: HintCtx, last: HintStep): HintStep {
  return c.nav.screen !== 'build' ? { target: 'tab-build', text: 'Open Build', final: false } : last;
}
/** Battle → control (phones: a full-screen tab hides the arena). */
function viaBattle(c: HintCtx, last: HintStep): HintStep {
  return c.nav.battle ? last : { target: 'tab-battle', text: 'Back to Battle', final: false };
}

const TAB_COACH: Record<HintScreen, string | undefined> = { upgrades: 'checkpoint', build: 'build', prestige: 'prestige', more: undefined };
const TAB_FEATURE: Record<HintScreen, FeatureId> = { upgrades: 'upgradesTab', build: 'buildTab', prestige: 'prestigeTab', more: 'moreTab' };
const TAB_LABEL: Record<HintScreen, string> = { upgrades: 'New: Upgrades', build: 'New: Build', prestige: 'New: Prestige', more: 'New: More' };

const tabReveal = (tab: HintScreen, prio: number): HintDef => ({
  id: `tab-${tab}`, prio, coach: TAB_COACH[tab], feature: TAB_FEATURE[tab], kind: 'reveal',
  when: (_ui, c) => c.f[TAB_FEATURE[tab]] && !c.visited.has(tab) && c.nav.screen !== tab,
  step: () => ({ target: `tab-${tab}`, text: TAB_LABEL[tab], final: true }),
});

/** The built-in hints, in priority order. */
export const HINTS: readonly HintDef[] = [
  // stage 0 only (the Upgrades tab takes over from the first boss on)
  {
    id: 'start', prio: 10, coach: 'start', feature: 'tapAssist', kind: 'reveal',
    when: (_ui, c) => !c.f.upgradesTab && c.live.starterOwned === 0 && c.live.starterReady,
    step: (_ui, c) => viaBattle(c, { target: 'upgrade', text: 'Tap to upgrade', final: true }),
  },
  {
    id: 'start-again', prio: 11, coach: 'start', feature: 'tapAssist', kind: 'reveal',
    when: (_ui, c) => !c.f.upgradesTab && c.live.starterOwned === 1 && c.live.starterReady,
    step: (_ui, c) => viaBattle(c, { target: 'upgrade', text: 'Buy again', final: true }),
  },
  {
    // the first real choice: point at the picker, never at an option (the choice is the player's)
    id: 'elements', prio: 20, coach: 'elements', feature: 'elements', kind: 'event',
    when: (ui, c) => c.f.elements && emptySlot(ui.build.attunements, ui.run.attunementSlotsOpen) >= 0,
    step: (ui, c) => {
      const slot = emptySlot(ui.build.attunements, ui.run.attunementSlotsOpen);
      return viaUpgrades(c, 'elements', c.shop.tree === `slot:${slot}`
        ? { target: 'slot-picker', text: 'Choose one', final: true }
        : { target: 'slot-chip', text: 'Empty slot', final: false });
    },
  },
  {
    id: 'build', prio: 21, coach: 'build', feature: 'hardpoints', kind: 'event',
    when: (ui, c) => c.f.hardpoints && c.f.buildTab && emptySlot(ui.build.hardpoints, ui.run.hardpointSlotsOpen) >= 0,
    step: (_ui, c) => viaBuild(c, { target: 'build-mount', text: 'Mount a weapon', final: true }),
  },
  tabReveal('upgrades', 30),
  tabReveal('build', 31),
  tabReveal('prestige', 32),
  tabReveal('more', 33),
  {
    id: 'abilities', prio: 40, coach: 'abilities', feature: 'abilities', kind: 'reveal',
    when: (_ui, c) => c.f.abilities && c.live.ceReady,
    step: (ui, c) => viaBattle(c, { target: 'ability-0', text: ui.build.abilities[0] ? 'Tap to use' : 'Choose an ability', final: true }),
  },
  {
    id: 'abilities-field', prio: 41, kind: 'event', feature: 'abilities', whileArmed: true,
    when: (_ui, c) => c.armed,
    step: (_ui, c) => (c.nav.battle ? { target: 'field', text: 'Now tap the field', final: false } : null),
  },
  {
    id: 'anomaly', prio: 50, coach: 'anomalies', feature: 'anomalies', kind: 'event',
    when: (ui, c) => c.live.draftWaiting && !!ui.run.pendingDraft?.length,
    step: (_ui, c) => viaBuild(c, { target: 'draft', text: 'Your draft waits here', final: true }),
  },
  {
    id: 'boon', prio: 51, coach: 'boons', feature: 'boons', kind: 'event',
    when: (ui, c) => c.live.boonChip && !!ui.run.boonOffer?.length,
    step: (_ui, c) => (c.nav.battle ? { target: 'boon-chip', text: 'Your boon waits here', final: true }
      : viaBuild(c, { target: 'build-boon', text: 'Your boon waits here', final: true })),
  },
  {
    // only on Upgrades (a ring on the tab for this would nag): Buy all when it shows, else the quantity selector
    id: 'bulk', prio: 60, coach: 'bulk', feature: 'bulk', kind: 'reveal',
    when: (_ui, c) => c.f.bulk,
    step: (_ui, c) => (c.nav.screen === 'upgrades' ? { target: c.live.buyAll ? 'buy-all' : 'qty', text: c.live.buyAll ? 'Buy every suggestion' : '×10 or Max per tap', final: true } : null),
  },
  {
    id: 'prestige', prio: 70, feature: 'forecast', kind: 'event',
    when: (ui, c) => c.f.prestigeTab && !!ui.forecast?.recommended && c.nav.screen !== 'prestige',
    step: () => ({ target: 'tab-prestige', text: 'Rebuilding pays off now', final: true }),
  },
];

const registered: HintDef[] = [];

/**
 * Extension point: add a hint from another layer (the Quartermaster card, the active edge). Its target is a
 * `data-hint` key; pointer.ts `registerHintTarget` can map the key to a selector when the owner has no attribute.
 * Registering an id again replaces it.
 */
export function registerHint(def: HintDef): void {
  const i = registered.findIndex((d) => d.id === def.id);
  if (i >= 0) registered[i] = def; else registered.push(def);
}

/** Built-in and registered hints, by priority (stable). */
export function allHints(): HintDef[] {
  return [...HINTS, ...registered].map((d, i) => ({ d, i })).sort((a, b) => a.d.prio - b.d.prio || a.i - b.i).map((x) => x.d);
}

/** How long a banner on screen keeps other hints back (after that, one the player ignores no longer starves them). */
export const BANNER_HOLD_MS = 12_000;

/**
 * Does the current banner hold other hints back? Only while it is on screen, for its first BANNER_HOLD_MS, and only
 * if some hint belongs to it (an info-only line never does).
 */
export function bannerHolds(c: Pick<HintCtx, 'coach'>): boolean {
  const cur = c.coach.current;
  if (cur === null || c.coach.visible === false || (c.coach.visibleMs ?? 0) > BANNER_HOLD_MS) return false;
  return allHints().some((d) => d.coach === cur);
}

/** May `d` point now (global rules: switch, Unlock everything, armed, banners)? Ignores prefs.hintsDone. */
function gateOpen(d: HintDef, c: HintCtx): boolean {
  if (c.armed) return !!d.whileArmed;
  if (d.whileArmed) return false;
  if (c.unlockAll && d.kind === 'reveal') return false;
  if (bannerHolds(c)) return d.coach === c.coach.current;                       // its sentence is on screen: its ring only
  if (d.coach && !c.unlockAll && d.coach !== c.coach.current && !c.coach.seen.has(d.coach)) return false;   // wait for the banner to show
  return true;
}

/**
 * The ring to show now, or null: the first hint (by priority) that is not retired, whose gate is open, whose
 * condition holds and that has somewhere to point from the current screen. `visible` (the driver: is that target on
 * screen?) lets a hint whose control is not displayed give way to the next one.
 */
export function nextHint(ui: HintUi, c: HintCtx, visible: (target: string) => boolean = () => true): Hint | null {
  if (!c.enabled || c.blocked) return null;
  for (const d of allHints()) {
    if (c.done.has(d.id) || c.snoozed?.has(d.id) || !gateOpen(d, c) || !d.when(ui, c)) continue;
    const s = d.step(ui, c);
    if (s && visible(s.target)) return { id: d.id, ...s };
  }
  return null;
}

/** Of the hints shown this session, the ones whose condition no longer holds: they are retired (never shown again). */
export function finishedHints(shown: Iterable<string>, ui: HintUi, c: HintCtx): string[] {
  const out: string[] = [];
  const byId = new Map(allHints().map((d) => [d.id, d]));
  for (const id of shown) {
    const d = byId.get(id);
    if (d && !c.done.has(id) && !d.when(ui, c)) out.push(id);
  }
  return out;
}

/**
 * First run of hints on this device: an existing save past a stage starts with that stage's hints retired (no ring
 * on things the player already knows); a brand-new game (stage 0) and Unlock everything start with none retired.
 */
export function initialHintsDone(f: Features, stage: number): string[] {
  if (stage === 0 || f.unlockAll) return [];
  return allHints().filter((d) => d.feature && f[d.feature]).map((d) => d.id);
}
