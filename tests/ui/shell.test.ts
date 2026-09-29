import { describe, expect, it } from 'vitest';
import type { ShopEntry } from '../../src/sim/core/types';
import {
  BATTLE, NavModel, PANEL_WIDTH, affordableCount, battleInsets, cycleBar, emptySlots, readNavState, shellLayout, tabBadges, writeNavState,
  type BadgeState, type NavOp, type NavState,
} from '../../src/ui/shell-logic';
import { speedCycle } from '../../src/ui/hud';

/** A browser history stand-in: entries + index; `back` fires popstate asynchronously like the real one. */
class FakeHistory {
  entries: (NavState | null)[] = [null];
  index = 0;
  private queued: number[] = [];
  constructor(private readonly model: NavModel) {
    this.entries[0] = writeNavState(BATTLE);
  }
  get state(): NavState | null { return readNavState(this.entries[this.index]); }
  apply(ops: NavOp[]): void {
    for (const o of ops) {
      if ('n' in o) this.queued.push(o.n);
      else if (o.op === 'push') { this.entries.length = this.index + 1; this.entries.push(writeNavState(o.state)); this.index++; }
      else this.entries[this.index] = writeNavState(o.state);
    }
  }
  /** Deliver pending `history.go(-n)` calls (each ends in one popstate). */
  flush(): NavState {
    while (this.queued.length) {
      const n = this.queued.shift()!;
      this.index = Math.max(0, this.index - n);
      this.apply(this.model.pop(this.state).ops);
    }
    return this.model.current;
  }
  /** The user presses Back (iOS swipe-back). */
  userBack(): NavState {
    this.index = Math.max(0, this.index - 1);
    const r = this.model.pop(this.state);
    this.apply(r.ops);
    return r.show;
  }
  userForward(): NavState {
    this.index = Math.min(this.entries.length - 1, this.index + 1);
    const r = this.model.pop(this.state);
    this.apply(r.ops);
    return r.show;
  }
  go(tab: NavState['tab'], sub: string | null = null): NavState { this.apply(this.model.go({ tab, sub })); return this.flush(); }
  get tabs(): string[] { return this.entries.slice(0, this.index + 1).map((e) => { const s = readNavState(e); return s ? (s.sub ? `${s.tab}/${s.sub}` : s.tab) : '?'; }); }
}

const setup = (): { m: NavModel; h: FakeHistory } => { const m = new NavModel(); return { m, h: new FakeHistory(m) }; };

describe('shell layout', () => {
  it('picks phone, rail (landscape phone) and desktop', () => {
    expect(shellLayout(390, 844)).toBe('phone');
    expect(shellLayout(360, 740)).toBe('phone');
    expect(shellLayout(430, 932)).toBe('phone');
    expect(shellLayout(844, 390)).toBe('rail');
    expect(shellLayout(740, 360)).toBe('rail');
    expect(shellLayout(560, 320)).toBe('phone');      // too narrow for a rail
    expect(shellLayout(820, 1180)).toBe('phone');     // tablet portrait
    expect(shellLayout(900, 600)).toBe('desktop');
    expect(shellLayout(1280, 800)).toBe('desktop');
  });
  it('gives the Battle arena everything between the top bar and the tab bar', () => {
    expect(battleInsets('phone', { top: 80, tabBar: 60, rail: 0, abilities: 70, panel: 0 })).toEqual({ top: 80, right: 0, bottom: 60, left: 0 });
    expect(battleInsets('rail', { top: 80, tabBar: 0, rail: 84, abilities: 72, panel: 0 })).toEqual({ top: 80, right: 0, bottom: 0, left: 156 });
    expect(battleInsets('desktop', { top: 80, tabBar: 0, rail: 0, abilities: 84, panel: PANEL_WIDTH })).toEqual({ top: 80, right: PANEL_WIDTH, bottom: 84, left: 0 });
    // the arena keeps ≥ 60% of a 390×844 phone
    const i = battleInsets('phone', { top: 80, tabBar: 60, rail: 0, abilities: 70, panel: 0 });
    expect((844 - i.top - i.bottom) / 844).toBeGreaterThan(0.6);
  });
});

describe('navigation history', () => {
  it('pushes one entry per tab and replaces it on tab switches, so Back returns to Battle', () => {
    const { m, h } = setup();
    h.go('upgrades');
    expect(h.tabs).toEqual(['battle', 'upgrades']);
    h.go('build');
    h.go('prestige');
    expect(h.tabs).toEqual(['battle', 'prestige']);
    expect(m.current.tab).toBe('prestige');
    expect(h.userBack()).toEqual(BATTLE);
    expect(m.depth).toBe(0);
  });
  it('walks a More sub-screen back to the list, then to Battle', () => {
    const { m, h } = setup();
    h.go('more');
    h.go('more', 'codex');
    expect(h.tabs).toEqual(['battle', 'more', 'more/codex']);
    expect(h.userBack()).toEqual({ tab: 'more', sub: null });
    expect(h.userBack()).toEqual(BATTLE);
    expect(m.depth).toBe(0);
  });
  it('switches sub-screens in place and opens one straight from Battle with its list underneath', () => {
    const { h } = setup();
    h.go('more', 'settings');
    expect(h.tabs).toEqual(['battle', 'more', 'more/settings']);
    h.go('more', 'help');
    expect(h.tabs).toEqual(['battle', 'more', 'more/help']);
    h.go('more');                      // the list: a Back
    expect(h.tabs).toEqual(['battle', 'more']);
  });
  it('collapses a sub-screen when another tab is chosen (after the async Back lands)', () => {
    const { m, h } = setup();
    h.go('more', 'codex');
    expect(h.go('upgrades')).toEqual({ tab: 'upgrades', sub: null });
    expect(h.tabs).toEqual(['battle', 'upgrades']);
    h.go('more', 'trials');            // tab → another tab's sub-screen
    expect(h.tabs).toEqual(['battle', 'more', 'more/trials']);
    h.go('build');
    expect(h.tabs).toEqual(['battle', 'build']);
    expect(m.current).toEqual({ tab: 'build', sub: null });
    expect(h.userBack()).toEqual(BATTLE);
  });
  it('goes to Battle from anywhere in one step', () => {
    const { m, h } = setup();
    h.go('more', 'codex');
    expect(m.go(BATTLE)).toEqual([{ op: 'back', n: 2 }]);
    h.apply([{ op: 'back', n: 2 }]);
    expect(h.flush()).toEqual(BATTLE);
    expect(h.index).toBe(0);
    expect(m.go(BATTLE)).toEqual([]);  // already there
  });
  it('follows Forward and ignores foreign history states', () => {
    const { h } = setup();
    h.go('build');
    h.userBack();
    expect(h.userForward()).toEqual({ tab: 'build', sub: null });
    expect(readNavState({ tab: 'build' })).toBeNull();
    expect(readNavState({ citadel: 1, tab: 'nope' })).toBeNull();
    expect(readNavState(null)).toBeNull();
    const m2 = new NavModel();
    m2.go({ tab: 'prestige', sub: null });
    expect(m2.pop(null).show).toEqual(BATTLE);    // a pre-app entry counts as Battle
  });
});

const entry = (node: string, cost: number, extra: Partial<ShopEntry> = {}): ShopEntry => ({
  node, tree: 'ballistics', name: node, desc: '', rank: 0, maxRank: 10, cost, currency: 'scrap', affordable: true, kind: 'stat', tier: 0, ...extra,
});
const badgeState = (over: Partial<BadgeState> = {}): BadgeState => ({
  shop: [],
  forecast: null,
  run: { pendingDraft: null, hardpointSlotsOpen: 0, attunementSlotsOpen: 0, deepestCleared: 12 },
  build: { hardpoints: [], attunements: [], doctrines: {} },
  meta: { ascension: 0 },
  ...over,
});

describe('tab badges', () => {
  it('counts affordable Scrap upgrades (not locked, maxed, Cores or Doctrine picks)', () => {
    const shop = [entry('a', 5), entry('b', 5, { affordable: false }), entry('c', 5, { locked: 'x' }), entry('d', 5, { rank: 10 }), entry('e', 1, { currency: 'cores' }), entry('f', 0, { kind: 'doctrine' }), entry('g', 9)];
    expect(affordableCount(shop)).toBe(2);
    expect(tabBadges(badgeState({ shop })).upgrades).toMatchObject({ text: '2', kind: 'count' });
    expect(tabBadges(badgeState()).upgrades).toBeNull();
    const many = Array.from({ length: 120 }, (_, i) => entry(`n${i}`, 1));
    expect(tabBadges(badgeState({ shop: many })).upgrades?.text).toBe('99+');
  });
  it('flags a waiting draft, a new slot and an open Doctrine fork on Build', () => {
    expect(tabBadges(badgeState()).build).toBeNull();
    const slot = badgeState({ run: { pendingDraft: null, hardpointSlotsOpen: 1, attunementSlotsOpen: 1, deepestCleared: 12 }, build: { hardpoints: ['ordnance'], attunements: [null], doctrines: {} } });
    expect(emptySlots(slot)).toBe(1);
    expect(tabBadges(slot).build).toMatchObject({ kind: 'new', label: 'New slot open' });
    const draft = badgeState({ ...slot, run: { ...slot.run, pendingDraft: ['loaded_dice'] as never } });
    expect(tabBadges(draft).build).toMatchObject({ kind: 'alert', label: 'Anomaly draft waiting' });
    const fork = badgeState({ shop: [entry('ballistics.multishot', 0, { kind: 'doctrine' })] });
    expect(tabBadges(fork).build).toMatchObject({ kind: 'new', label: 'Doctrine fork open' });
    const chosen = badgeState({ shop: fork.shop, build: { hardpoints: [], attunements: [], doctrines: { ballistics: 'multishot' as never } } });
    expect(tabBadges(chosen).build).toBeNull();
  });
  it('flags Prestige recommended and an open Ascension', () => {
    const f = { echoesNow: 1, echoRate: 1, peakRate: 1, nextBossEchoes: 1, nextBossRate: 1, reclimbSeconds: 1, wallGaugeSeconds: null, recommended: true, curve: [] };
    expect(tabBadges(badgeState({ forecast: f })).prestige).toMatchObject({ kind: 'alert', label: 'Prestige recommended' });
    expect(tabBadges(badgeState({ forecast: { ...f, recommended: false } })).prestige).toBeNull();
    expect(tabBadges(badgeState({ run: { pendingDraft: null, hardpointSlotsOpen: 0, attunementSlotsOpen: 0, deepestCleared: 100 } })).prestige?.label).toBe('Ascension open');
    expect(tabBadges(badgeState()).battle).toBeNull();
    expect(tabBadges(badgeState()).more).toBeNull();
  });
});

describe('checkpoint cycle bar', () => {
  it('spans checkpoint+1 … checkpoint+5 with the wave progress inside it', () => {
    const a = cycleBar(11, 10, 0);
    expect(a.frac).toBe(0);
    expect(a.ticks.map((t) => t.wave)).toEqual([11, 12, 13, 14, 15]);
    expect(a.ticks[4]).toMatchObject({ boss: true, at: 1 });
    expect(a.ticks[0].current).toBe(true);
    const b = cycleBar(13, 10, 0.5);
    expect(b.frac).toBeCloseTo(0.5);
    expect(b.ticks.filter((t) => t.done).map((t) => t.wave)).toEqual([11, 12]);
    expect(cycleBar(15, 10, 1).frac).toBe(1);
    expect(cycleBar(99, 10, 0.5).frac).toBe(0.9);          // clamped to the boss wave
    expect(cycleBar(11, 10, Number.NaN).frac).toBe(0);
  });
});

describe('speed chip', () => {
  it('cycles only through the allowed speeds', () => {
    expect(speedCycle(1, 1)).toBe(1);
    expect(speedCycle(1, 2)).toBe(2);
    expect(speedCycle(2, 2)).toBe(1);
    expect(speedCycle(2, 8)).toBe(4);
    expect(speedCycle(8, 8)).toBe(1);
    expect(speedCycle(4, 2)).toBe(1);                       // above the allowance: back to ×1
  });
});
