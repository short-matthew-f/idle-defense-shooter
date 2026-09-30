import { describe, expect, it } from 'vitest';
import type { ShopEntry } from '../../src/sim/core/types';
import {
  BULK_ROWS, BULK_ROWS_MIN_WAVE, CONTENT_POOL, FEATURE_IDS, STAGE_WAVES, STAGE7_WAVE, STARTER_NODES, UNLOCKS, affordableRows, allFeatures, bestWave, contentPool, features,
  stageOf, stageOfFeature, starterPick, type FeatureId, type Features, type ProgressState, type StarterState,
} from '../../src/ui/progression';
import { COACH, initialSeen, pendingCoach, staleWith, unlockedCoach } from '../../src/ui/coach';
import { tabBadges, tabReachable, tabsShown, type BadgeState } from '../../src/ui/shell-logic';
import { ELEMENTS, HARDPOINTS } from '../../src/ui/content';

const entry = (node: string, over: Partial<ShopEntry> = {}): ShopEntry => ({
  node: node as ShopEntry['node'], tree: node.split('.')[0] as ShopEntry['tree'], name: node, desc: '', rank: 0, maxRank: 60,
  cost: 10, currency: 'scrap', affordable: false, kind: 'stat', tier: 0, nextCosts: [], affordableRanks: 0, affordableTotal: 0, ...over,
});

const state = (best: number, over: Partial<ProgressState> & { prestige?: number } = {}): ProgressState => ({
  run: { deepestCleared: best, pendingDraft: null, boonOffer: null, boons: [], ...over.run },
  meta: { deepestEver: best, prestigeCount: over.prestige ?? 0, prestigeRanks: {}, directives: [], ...over.meta },
  build: { hardpoints: [], attunements: [], anomalies: [], frame: 'standard', ...over.build },
  shop: over.shop ?? [], extraSystems: over.extraSystems ?? [], forecast: over.forecast ?? null, activeTrial: over.activeTrial ?? null,
});

const on = (f: Features): FeatureId[] => FEATURE_IDS.filter((id) => f[id]);

describe('unlock ladder: stages', () => {
  it('stageOf follows the table (best wave = max of deepestEver and deepestCleared)', () => {
    expect(STAGE_WAVES).toEqual([0, 5, 6, 10, 12, 15, 20]);
    const at = (w: number): number => stageOf(state(w));
    expect([0, 4, 5, 6, 9, 10, 11, 12, 14, 15, 19, 20, 24, 25, 90].map(at)).toEqual([0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
    expect(stageOf(state(0, { prestige: 1 }))).toBe(7);
    expect(bestWave({ run: { deepestCleared: 3 }, meta: { deepestEver: 40, prestigeCount: 0 } })).toBe(40);
    expect(bestWave({ run: { deepestCleared: 12 }, meta: { deepestEver: 7, prestigeCount: 0 } })).toBe(12);
    expect(stageOf({ run: { deepestCleared: 12 }, meta: { deepestEver: 0, prestigeCount: 0 } })).toBe(4);
  });

  it('every feature has one row in the table and a stage', () => {
    expect(Object.keys(UNLOCKS).sort()).toEqual([...FEATURE_IDS].sort());
    for (const id of FEATURE_IDS) expect(stageOfFeature(id)).not.toBeNull();
    expect(stageOfFeature('tapAssist')).toBe(0);
    expect(stageOfFeature('salvage')).toBe(1);
    expect(stageOfFeature('overcharge')).toBe(4);
    expect(stageOfFeature('quartermaster')).toBe(7);
  });

  it('a fresh save: the tower, one Upgrade button, nothing else', () => {
    const f = features(state(0));
    expect(on(f)).toEqual(['tapAssist']);
    expect(f.tabbar).toBe(false);
    expect(f.unlockAll).toBe(false);
    expect(f.showEverything).toBe(false);
  });

  it('the first boss (wave 5): tab bar with Battle + Upgrades, the whole Chassis', () => {
    const f = features(state(5));
    expect(on(f)).toEqual(['tapAssist', 'tabbar', 'upgradesTab', 'chassisAll', 'runControls', 'salvage']);
    expect(tabsShown(f)).toEqual({ battle: true, upgrades: true, build: false, prestige: false, more: false });
  });

  it('then one layer at a time', () => {
    const added = (a: number, b: number): FeatureId[] => { const x = features(state(a)), y = features(state(b)); return FEATURE_IDS.filter((id) => y[id] && !x[id]); };
    expect(added(5, 6)).toEqual(['elements']);
    expect(added(6, 10)).toEqual(['buildTab', 'hardpoints', 'moreTab']);
    expect(added(10, 12)).toEqual(['abilities', 'overcharge']);
    expect(added(12, 15)).toEqual(['boons', 'anomalies', 'bulk']);
    expect(added(15, 20)).toEqual(['prestigeTab', 'forecast', 'cross', 'inspector', 'codex']);
    expect(added(20, STAGE7_WAVE)).toEqual(['cores', 'frame']);
    expect(features(state(200)).automation).toBe(false);   // Automation and Trials wait for a Prestige
    expect(on(features(state(21, { prestige: 1 })))).toEqual([...FEATURE_IDS]);
  });

  it('a deep existing save (Prestige III, wave 62) has everything, and is NOT blanket-unlocked below that', () => {
    expect(on(features(state(62, { prestige: 3 })))).toEqual([...FEATURE_IDS]);
    // the owner's point: an existing save only gets what its progress earns
    expect(features(state(8)).buildTab).toBe(false);
  });
});

describe('unlock ladder: never hides what the player owns or has pending', () => {
  const at0 = (over: Partial<ProgressState>): Features => features(state(0, over));
  it('an attuned element, a mounted or Frame / borrowed system', () => {
    const el = at0({ build: { attunements: ['fire'] } });
    expect(el.elements && el.upgradesTab && el.tabbar && el.chassisAll).toBe(true);
    const hp = at0({ build: { hardpoints: [null, 'drones'] } });
    expect(hp.hardpoints && hp.buildTab && hp.upgradesTab && hp.moreTab && hp.tabbar).toBe(true);
    expect(at0({ extraSystems: [{ system: 'blade', via: 'borrowed' }] }).hardpoints).toBe(true);
    expect(at0({ build: { hardpoints: [null], attunements: [null] } }).hardpoints).toBe(false);   // an empty slot is not ownership
  });
  it('a pending Anomaly draft or socketed Anomaly, a boon offer or active boon', () => {
    const d = at0({ run: { deepestCleared: 0, pendingDraft: ['loaded_dice'] } });
    expect(d.anomalies && d.buildTab && d.tabbar).toBe(true);
    expect(at0({ build: { anomalies: ['tithe'] } }).anomalies).toBe(true);
    expect(at0({ run: { deepestCleared: 0, boonOffer: ['a', 'b', 'c'] as never } }).boons).toBe(true);
    expect(at0({ run: { deepestCleared: 0, boons: ['x'] as never } }).boons).toBe(true);
  });
  it('a Prestige alert, owned ability ranks / Cross nodes / Exotics, Automation and Trials', () => {
    const p = at0({ forecast: { recommended: true } });
    expect(p.prestigeTab && p.forecast && p.tabbar).toBe(true);
    expect(at0({ shop: [entry('ability.hunter_mark', { tree: 'ability', kind: 'ability', rank: 1 })] }).abilities).toBe(true);
    expect(at0({ shop: [entry('link.a+b', { tree: 'link', kind: 'linkage', rank: 1 })] }).cross).toBe(true);
    expect(at0({ shop: [entry('ballistics.exotic', { kind: 'exotic', currency: 'cores', rank: 1 })] }).cores).toBe(true);
    expect(at0({ meta: { deepestEver: 0, prestigeCount: 0, prestigeRanks: { 'prestige.directives': 1 } } }).automation).toBe(true);
    expect(at0({ activeTrial: 'poverty' }).trials).toBe(true);
    expect(at0({ build: { frame: 'arsenal' } }).frame).toBe(true);
    expect(at0({ shop: [entry('bastion.armor', { rank: 2 })] }).chassisAll).toBe(true);
    expect(at0({ shop: [entry('bastion.max_hp', { rank: 2 })] }).chassisAll).toBe(false);   // a starter stat is not "the whole Chassis"
  });
  it('bulk tools appear early (from BULK_ROWS_MIN_WAVE) once ≥ BULK_ROWS visible rows are affordable', () => {
    const rows = Array.from({ length: BULK_ROWS }, (_, i) => entry(`ballistics.n${i}`, { affordable: true }));
    expect(features(state(BULK_ROWS_MIN_WAVE, { shop: rows })).bulk).toBe(true);
    expect(features(state(BULK_ROWS_MIN_WAVE, { shop: rows.slice(1) })).bulk).toBe(false);
    expect(features(state(5, { shop: rows })).bulk).toBe(false);   // not at the first checkpoint: one layer at a time
    // at stage 0 only the three starter stats are visible rows
    expect(affordableRows(rows, { chassisAll: false, elements: false, hardpoints: false, cross: false })).toBe(0);
    expect(affordableRows([...rows, entry('link.x', { tree: 'link', affordable: true })], { chassisAll: true, elements: true, hardpoints: true, cross: false })).toBe(BULK_ROWS);
  });
});

describe('unlock ladder: monotone', () => {
  // pseudo-random owned/pending states: whatever else is true, raising the best wave or the Prestige count never hides a feature
  let seed = 7;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const extras = (): Partial<ProgressState> => ({
    build: { attunements: rnd() < 0.2 ? ['frost'] : [], hardpoints: rnd() < 0.2 ? ['laser'] : [], anomalies: rnd() < 0.1 ? ['tithe'] : [], frame: rnd() < 0.1 ? 'hive' : 'standard' },
    run: { deepestCleared: 0, pendingDraft: rnd() < 0.1 ? ['smolder'] : null, boonOffer: rnd() < 0.1 ? ['x'] as never : null },
    forecast: { recommended: rnd() < 0.1 },
    shop: Array.from({ length: Math.floor(rnd() * 20) }, (_, i) => entry(`bastion.n${i}`, { affordable: rnd() < 0.7 })),
  });
  it('features never disappear as the best wave (or Prestige count) rises', () => {
    const bad: string[] = [];
    for (let k = 0; k < 60; k++) {
      const ex = extras();
      for (const pc of [0, 1, 2]) {
        let prev: Features | null = null;
        for (let w = 0; w <= 120; w++) {
          const f = features(state(w, { ...ex, prestige: pc, run: { ...ex.run!, deepestCleared: w } }));
          if (prev) for (const id of FEATURE_IDS) if (prev[id] && !f[id]) bad.push(`${id} vanished at wave ${w} (prestige ${pc})`);
          if (pc > 0) { const lower = features(state(w, { ...ex, prestige: pc - 1, run: { ...ex.run!, deepestCleared: w } })); for (const id of FEATURE_IDS) if (lower[id] && !f[id]) bad.push(`${id} vanished at prestige ${pc} (wave ${w})`); }
          prev = f;
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('unlockAll (master switch; alias showEverything)', () => {
  it('turns every feature on at any progress, and offers every content id', () => {
    for (const s of [state(0), state(7), state(0, { prestige: 5 })]) {
      const a = features(s, { unlockAll: true }), b = features(s, { showEverything: true });
      expect(on(a)).toEqual([...FEATURE_IDS]);
      expect(on(b)).toEqual([...FEATURE_IDS]);
      expect(a.unlockAll && a.showEverything && b.unlockAll).toBe(true);
      expect(contentPool(s, { unlockAll: true })).toEqual({ elements: [...ELEMENTS], hardpoints: [...HARDPOINTS] });
    }
    expect(on(allFeatures())).toEqual([...FEATURE_IDS]);
  });
  it('contentPool: phase 1 offers everything; owned ids are always offered', () => {
    expect(Object.keys(CONTENT_POOL.elements).sort()).toEqual([...ELEMENTS].sort());
    expect(Object.keys(CONTENT_POOL.hardpoints).sort()).toEqual([...HARDPOINTS].sort());
    const p = contentPool(state(0, { build: { attunements: ['frost'], hardpoints: ['gravitics'] } }));
    expect(p.elements).toEqual([...ELEMENTS]);
    expect(p.hardpoints).toEqual([...HARDPOINTS]);
    expect(p.elements).toContain('frost');
    expect(p.hardpoints).toContain('gravitics');
  });
});

describe('the stage-0 Upgrade button', () => {
  const shop = (costs: [number, number, number], afford: [boolean, boolean, boolean]): ShopEntry[] =>
    STARTER_NODES.map((s, i) => entry(s.node, { cost: costs[i], affordable: afford[i] }));
  const st = (over: Partial<StarterState> & { hp?: number; alive?: number; scrap?: number; shop: ShopEntry[] }): StarterState => ({
    shop: over.shop, run: { scrap: over.scrap ?? 0, attemptDamageTaken: {}, phase: 'combat' },
    tower: { hp: over.hp ?? 100, maxHp: 100 }, wave: { enemiesAlive: over.alive ?? 2 },
  });
  it('explains itself in one line: Damage, then Fire Rate as it gets cheaper', () => {
    const p = starterPick(st({ shop: shop([10, 12, 10], [true, true, true]) }))!;
    expect(p.label).toBe('Damage');
    expect(p.why).toBe('Damage: every shot hits harder');
    const q = starterPick(st({ shop: shop([14, 12, 10], [true, true, true]) }))!;
    expect(q.label).toBe('Fire Rate');
    expect(q.why).toMatch(/^Fire Rate:/);
  });
  it('Fire Rate when enemies pile up; Hull when the tower is hurt', () => {
    expect(starterPick(st({ alive: 12, shop: shop([10, 12, 10], [true, true, true]) }))!.why).toBe('Fire Rate: enemies arrive faster than you kill them');
    expect(starterPick(st({ hp: 30, alive: 12, shop: shop([10, 12, 10], [true, true, true]) }))!.why).toBe('Hull: the tower is taking heavy hits');
  });
  it('buys what it can afford; otherwise saves for the cheapest with an ETA (advice.nextPurchase)', () => {
    const p = starterPick(st({ hp: 30, shop: shop([10, 12, 40], [true, true, false]) }))!;
    expect(p.affordable && p.label === 'Damage').toBe(true);
    const s = starterPick(st({ scrap: 4, shop: shop([10, 12, 40], [false, false, false]) }), 2)!;
    expect(s.affordable).toBe(false);
    expect(s.label).toBe('Damage');
    expect(s.eta).toBe(3);
    expect(s.why).toBe('Next: Damage. Kills earn the Scrap');
    expect(starterPick(st({ shop: [] }))).toBeNull();
  });
});

describe('coach banners', () => {
  it('one message per reveal, the newest stage first; a live boon offer or draft jumps the queue', () => {
    expect(pendingCoach(features(state(0)), new Set())?.id).toBe('start');
    expect(pendingCoach(features(state(5)), new Set(['start']))?.id).toBe('checkpoint');
    expect(pendingCoach(features(state(6)), new Set())?.id).toBe('elements');   // 'start' / 'checkpoint' unread: stale
    expect(staleWith('elements')).toEqual(['start', 'checkpoint', 'elements']);
    expect(staleWith('boons')).toEqual(['boons']);
    expect(pendingCoach(features(state(15)), new Set(staleWith('bulk')))?.id).toBe('boons');   // event explainers after the stage ones
    const offer = features(state(0, { run: { deepestCleared: 0, boonOffer: ['x'] as never } }));
    expect(pendingCoach(offer, new Set(), { boonOffer: true, draft: false })?.id).toBe('boons');
    expect(pendingCoach(features(state(5)), new Set(['start', 'checkpoint']))).toBeNull();
    expect(pendingCoach(allFeatures(), new Set())).toBeNull();   // Unlock everything: no tutorial
  });
  it('an existing save marks what it already has as read; a new game shows the first message', () => {
    expect(initialSeen(features(state(0)), 0)).toEqual([]);
    const deep = features(state(62, { prestige: 3 }));
    expect(initialSeen(deep, 7).sort()).toEqual(COACH.map((m) => m.id).sort());
    expect(unlockedCoach(features(state(6))).map((m) => m.id)).toEqual(['start', 'checkpoint', 'elements']);
  });
});

describe('tab bar under the ladder', () => {
  const base: BadgeState = {
    shop: [], forecast: null,
    run: { pendingDraft: null, hardpointSlotsOpen: 0, attunementSlotsOpen: 0, deepestCleared: 0 },
    build: { hardpoints: [], attunements: [], doctrines: {} }, meta: { ascension: 0 },
  };
  it('hidden tabs are unreachable except More (Settings / Help from a Battle chip)', () => {
    const f0 = features(state(0));
    expect(tabReachable(f0, 'battle') && tabReachable(f0, 'more')).toBe(true);
    expect(tabReachable(f0, 'upgrades') || tabReachable(f0, 'build') || tabReachable(f0, 'prestige')).toBe(false);
    expect(tabsShown(f0).more).toBe(false);
  });
  it('a newly revealed tab reads "New" until visited; an alert still wins', () => {
    const b = tabBadges(base, new Set(['upgrades']));
    expect(b.upgrades).toMatchObject({ text: 'New', kind: 'new', fresh: true });
    const d = tabBadges({ ...base, run: { ...base.run, pendingDraft: ['tithe'] } }, new Set(['build']));
    expect(d.build?.kind).toBe('alert');
    expect(tabBadges(base).upgrades).toBeNull();
  });
});
