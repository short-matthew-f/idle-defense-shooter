/**
 * Pure logic for the UI shell (no DOM): layout mode per viewport, the tab list, tab badges, the
 * checkpoint-cycle progress bar, camera insets for the Battle screen, and the navigation model that
 * mirrors the browser history stack (so the iOS swipe-back and the Android back button return to
 * Battle).
 */
import type { UiState } from '@sim/core/types';
import type { Features } from './progression';

export type TabId = 'battle' | 'upgrades' | 'build' | 'prestige' | 'more';
export type ShellLayout = 'phone' | 'rail' | 'desktop';

export const TABS: readonly { id: TabId; label: string; icon: string; hint: string }[] = [
  { id: 'battle', label: 'Battle', icon: 'target', hint: 'The arena' },
  { id: 'upgrades', label: 'Upgrades', icon: 'upgrade', hint: 'Spend Scrap' },
  { id: 'build', label: 'Build', icon: 'blueprint', hint: 'Frame, slots, Doctrines, Anomalies, Cores' },
  { id: 'prestige', label: 'Prestige', icon: 'prestige', hint: 'Forecast, Prestige upgrades, Ascension' },
  { id: 'more', label: 'More', icon: 'more', hint: 'Inspector, Codex, Automation, Trials, Settings' },
];

/** Viewport width from which the arena and a side panel sit side by side. */
export const DESKTOP_MIN_WIDTH = 900;
/** Desktop side panel width (px). */
export const PANEL_WIDTH = 380;
/** Width of the navigation rail on a landscape phone (px, before the safe-area inset). */
export const RAIL_WIDTH = 84;

/**
 * phone: portrait (or narrow) — full-screen tabs with a bottom tab bar.
 * rail: a phone on its side (short landscape) — the same tabs on a left rail, so the arena keeps the height.
 * desktop: ≥ 900 px — the arena on the left, the non-Battle screens as tabs in a side panel.
 */
export function shellLayout(width: number, height: number): ShellLayout {
  if (width >= DESKTOP_MIN_WIDTH) return 'desktop';
  if (height < 500 && width > height && width >= 600) return 'rail';
  return 'phone';
}

export interface Insets { top: number; right: number; bottom: number; left: number }

/**
 * Camera insets for the Battle screen. The arena gets the whole area between the top bar and the
 * tab bar; the ability buttons float over it (phone) or sit in a column beside it (rail).
 *   top: top bar height (incl. safe area) · tabBar: tab bar height (incl. safe area) on phones
 *   rail: rail width on landscape phones · abilities: height of the ability row (desktop) or width of the ability column (rail)
 */
export function battleInsets(layout: ShellLayout, m: { top: number; tabBar: number; rail: number; abilities: number; panel: number; dock?: number }): Insets {
  if (layout === 'desktop') return { top: m.top, right: m.panel, bottom: m.abilities, left: 0 };
  if (layout === 'rail') return { top: m.top, right: 0, bottom: 0, left: m.rail + m.abilities };
  return { top: m.top, right: 0, bottom: m.tabBar + (m.dock ?? 0), left: 0 };
}

/** Phone: the arena rides above the middle of the spare room (see Camera.vBias). */
export const PHONE_ARENA_BIAS = 0.3;
/** Phone: height of the first-session Upgrade button plus its hint line (px); the room under the arena is this plus the gap below it. */
export const STARTER_CONTENT = 104;
/** Phone: breathing room kept between the arena and the controls floating over its lower edge (px). */
export const DOCK_GAP = 8;

// ---------------------------------------------------------------- badges

export interface Badge { text: string; kind: 'alert' | 'new'; label: string; /** a newly revealed tab (pulses until visited) */ fresh?: boolean }
export type BadgeState = Pick<UiState, 'shop' | 'forecast'> & {
  /** `boonOffer`: Boons (optional so older call sites and tests need not set it). */
  run: Pick<UiState['run'], 'pendingDraft' | 'hardpointSlotsOpen' | 'attunementSlotsOpen' | 'deepestCleared'> & Partial<Pick<UiState['run'], 'boonOffer'>>;
  build: Pick<UiState['build'], 'hardpoints' | 'attunements' | 'doctrines'> & Partial<Pick<UiState['build'], 'secondDoctrines'>>;
  meta: Pick<UiState['meta'], 'ascension'>;
};

/** Scrap upgrades the player can buy right now (what the Upgrades badge counts). */
export function affordableCount(shop: UiState['shop']): number {
  let n = 0;
  for (const e of shop) if (e.affordable && !e.locked && e.currency === 'scrap' && e.kind !== 'doctrine' && e.rank < e.maxRank) n++;
  return n;
}

/** Open slots with nothing in them (hardpoints + attunements). */
export function emptySlots(s: BadgeState): number {
  let n = 0;
  for (let i = 0; i < s.run.hardpointSlotsOpen; i++) if (!s.build.hardpoints[i]) n++;
  for (let i = 0; i < s.run.attunementSlotsOpen; i++) if (!s.build.attunements[i]) n++;
  return n;
}

/**
 * Trees where a Doctrine can be chosen for free: an open fork with no Doctrine yet, or (Reachability) an empty
 * second-Doctrine slot (Spare Barrel, Dual Doctrine, Monolith, Bulwark, Singularity Core). Changes cost Cores: not counted.
 */
export function openForkCount(s: BadgeState): number {
  const seen = new Set<string>();
  for (const e of s.shop) {
    if (e.kind !== 'doctrine' || e.locked || !e.affordable || e.cost > 0) continue;
    const t = e.tree as keyof typeof s.build.doctrines;
    if (s.build.doctrines[t] && (s.build.secondDoctrines ?? {})[t]) continue;
    seen.add(e.tree);
  }
  return seen.size;
}

/**
 * Badge per tab (null = none). Badges are the only UI text allowed under 14 px. `fresh` names tabs revealed by the
 * unlock ladder but never opened: they read "New" (an alert still wins).
 *
 * A badge marks a NEW DECISION or an unseen unlock that clears when the player acts: an Anomaly draft or Boon offer, an
 * empty slot, an open Doctrine fork, Prestige recommended, the first Ascension, a tab not yet opened. It is never a
 * standing count: the old Upgrades "N affordable" badge sat at 19 all game and told the player nothing (HANDBOOK-EVAL B-20).
 */
export function tabBadges(s: BadgeState, fresh: ReadonlySet<TabId> = new Set()): Record<TabId, Badge | null> {
  const slots = emptySlots(s);
  const forks = openForkCount(s);
  const draft = !!s.run.pendingDraft && s.run.pendingDraft.length > 0;
  const boon = !!s.run.boonOffer && s.run.boonOffer.length > 0;
  const build: Badge | null = draft ? { text: '!', kind: 'alert', label: 'Anomaly draft waiting' }
    : boon ? { text: '!', kind: 'alert', label: 'Boon offer waiting' }
    : slots > 0 ? { text: '+', kind: 'new', label: slots === 1 ? 'New slot open' : `${slots} slots open` }
    : forks > 0 ? { text: '+', kind: 'new', label: forks === 1 ? 'Doctrine fork open' : `${forks} Doctrine forks open` }
    : null;
  // only the FIRST Ascension is a new decision; later ones are routine and would badge Prestige for good
  const ascend = s.run.deepestCleared >= 100 && s.meta.ascension === 0;
  const prestige: Badge | null = s.forecast?.recommended ? { text: '!', kind: 'alert', label: 'Prestige recommended' }
    : ascend ? { text: '!', kind: 'alert', label: 'Ascension open' } : null;
  const out: Record<TabId, Badge | null> = {
    battle: null,
    upgrades: null,
    build,
    prestige,
    more: null,
  };
  for (const t of fresh) if (t !== 'battle' && out[t]?.kind !== 'alert') out[t] = { text: 'New', kind: 'new', label: 'New: not opened yet', fresh: true };
  return out;
}

// ---------------------------------------------------------------- progressive reveal

/**
 * Tabs in the bar for these features (progression.ts). Battle is always there; the bar itself shows only when
 * some other tab is (stage 0 has no tab bar at all).
 */
export function tabsShown(f: Pick<Features, 'upgradesTab' | 'buildTab' | 'prestigeTab' | 'moreTab'>): Record<TabId, boolean> {
  return { battle: true, upgrades: f.upgradesTab, build: f.buildTab, prestige: f.prestigeTab, more: f.moreTab };
}

/** Tabs that can be navigated to: the ones in the bar, plus More (Settings and Help stay reachable from a Battle chip). */
export function tabReachable(f: Pick<Features, 'upgradesTab' | 'buildTab' | 'prestigeTab' | 'moreTab'>, tab: TabId): boolean {
  return tab === 'more' || tabsShown(f)[tab];
}

// ---------------------------------------------------------------- checkpoint cycle bar

export interface CycleTick { at: number; wave: number; boss: boolean; done: boolean; current: boolean }

/**
 * One thin bar for the whole checkpoint cycle (waves checkpoint+1 … checkpoint+5, the fifth is the
 * boss): the fill is the position inside the cycle including the current wave's progress, and each
 * wave boundary is a tick (the checkpoint pips of the old HUD, drawn on the bar).
 */
export function cycleBar(wave: number, checkpoint: number, progress: number): { frac: number; ticks: CycleTick[] } {
  const idx = Math.max(0, Math.min(4, wave - checkpoint - 1));
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const frac = Math.max(0, Math.min(1, (idx + p) / 5));
  const ticks: CycleTick[] = [];
  for (let i = 1; i <= 5; i++) {
    const wv = checkpoint + i;
    ticks.push({ at: i / 5, wave: wv, boss: wv % 5 === 0, done: wv < wave, current: wv === wave });
  }
  return { frac, ticks };
}

// ---------------------------------------------------------------- navigation / history

export interface NavState { tab: TabId; sub: string | null }
export type NavOp = { op: 'push' | 'replace'; state: NavState } | { op: 'back'; n: number };

export const BATTLE: NavState = { tab: 'battle', sub: null };
const same = (a: NavState, b: NavState): boolean => a.tab === b.tab && (a.sub ?? null) === (b.sub ?? null);
const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

/** A history.state value written by the shell, or null. */
export function readNavState(v: unknown): NavState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { citadel?: unknown; tab?: unknown; sub?: unknown };
  if (o.citadel !== 1 || typeof o.tab !== 'string' || !TAB_IDS.has(o.tab)) return null;
  return { tab: o.tab as TabId, sub: typeof o.sub === 'string' ? o.sub : null };
}
export function writeNavState(s: NavState): { citadel: 1; tab: TabId; sub: string | null } {
  return { citadel: 1, tab: s.tab, sub: s.sub };
}

/**
 * Mirrors the browser history entries the shell owns: [Battle] · [Battle, tab] · [Battle, tab, sub-screen].
 * Battle is always the bottom entry, so Back from any tab lands on Battle and Back from a More
 * sub-screen lands on the More list. Switching tabs replaces the top entry instead of stacking
 * (Back never walks through every tab you visited). `go` returns the history operations to apply;
 * `pop` handles a popstate and returns the screen to show plus any follow-up operation.
 */
export class NavModel {
  stack: NavState[] = [BATTLE];
  /** A tab to replace the top entry with once a pending `back` lands (tab switch from a sub-screen). */
  private pending: NavState | null = null;

  get current(): NavState { return this.stack[this.stack.length - 1]; }
  get depth(): number { return this.stack.length - 1; }

  go(target: NavState): NavOp[] {
    const t: NavState = { tab: target.tab, sub: target.tab === 'battle' ? null : target.sub ?? null };
    if (same(t, this.current) && !this.pending) return [];
    if (t.tab === 'battle') {
      const n = this.depth;
      this.stack = [BATTLE];
      this.pending = null;
      return n > 0 ? [{ op: 'back', n }] : [];
    }
    if (this.depth === 0) {
      // Battle → a sub-screen: push its parent tab first so Back walks sub → tab → Battle
      if (t.sub) { this.stack = [BATTLE, { tab: t.tab, sub: null }, t]; return [{ op: 'push', state: { tab: t.tab, sub: null } }, { op: 'push', state: t }]; }
      this.stack = [BATTLE, t];
      return [{ op: 'push', state: t }];
    }
    const top = this.current;
    // drill into a sub-screen of the tab on screen
    if (t.sub && this.depth === 1 && top.tab === t.tab && !top.sub) { this.stack.push(t); return [{ op: 'push', state: t }]; }
    // sub-screen → its own tab list: that is a Back
    if (!t.sub && this.depth === 2 && this.stack[1].tab === t.tab) { this.stack.pop(); return [{ op: 'back', n: 1 }]; }
    // switching sub-screens inside the same tab
    if (t.sub && this.depth === 2 && this.stack[1].tab === t.tab) { this.stack[2] = t; return [{ op: 'replace', state: t }]; }
    // any other tab switch collapses to [Battle, t]
    const extra = this.depth - 1;
    if (t.sub) {
      // the push waits for the Back to land (history.go is asynchronous): `pop` returns it
      if (extra > 0) { this.stack = [BATTLE, { tab: t.tab, sub: null }, t]; this.pending = { tab: t.tab, sub: null }; return [{ op: 'back', n: extra }]; }
      this.stack = [BATTLE, { tab: t.tab, sub: null }, t];
      return [{ op: 'replace', state: { tab: t.tab, sub: null } }, { op: 'push', state: t }];
    }
    this.stack = [BATTLE, t];
    if (extra > 0) { this.pending = t; return [{ op: 'back', n: extra }]; }
    return [{ op: 'replace', state: t }];
  }

  /**
   * A popstate arrived with `state` (the entry now current). Returns what to show and the
   * operations still to apply (the replace that completes a tab switch from a sub-screen).
   */
  pop(state: NavState | null): { show: NavState; ops: NavOp[] } {
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      // the stack was already set by `go`; complete it: the landed entry becomes the new tab, then any sub-screen is pushed
      const ops: NavOp[] = [{ op: 'replace', state: p }];
      const top = this.current;
      if (!same(top, p)) ops.push({ op: 'push', state: top });
      return { show: top, ops };
    }
    const s = state ?? BATTLE;
    const i = this.stack.findIndex((x) => same(x, s));
    if (i >= 0) this.stack.length = i + 1;
    else if (s.tab === 'battle') this.stack = [BATTLE];
    else if (s.sub && this.depth === 1 && this.current.tab === s.tab) this.stack.push(s);   // Forward into a sub-screen
    else this.stack = s.sub ? [BATTLE, { tab: s.tab, sub: null }, s] : [BATTLE, s];
    return { show: this.current, ops: [] };
  }
}
