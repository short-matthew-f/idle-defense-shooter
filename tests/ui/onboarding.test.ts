/**
 * Onboarding pass, UI side (docs/ONBOARDING.md): the content pool across Prestiges (monotone, complete by
 * POOL_COMPLETE_AT, Unlock everything), the Fusion / Linkage / Infusion filter, "New" bookkeeping, the first-Prestige
 * ceremony's facts and Echo guide, and Quartermaster buys kept out of the player's purchase feedback.
 */
import { describe, expect, it } from 'vitest';
import { Ev, type ShopEntry, type SimEvent, type UiState } from '../../src/sim/core/types';
import { CHASSIS_LINKAGES, FUSIONS, INFUSIONS, TRIADS, WEAPON_LINKAGES } from '../../src/sim/data/index';
import {
  CONTENT_POOL, POOL_COMPLETE_AT, STARTER_ELEMENTS, STARTER_HARDPOINTS, blueprintInPool, contentPool, newInPool, poolAddedAt, poolAllows, poolShop,
  type ProgressState,
} from '../../src/ui/progression';
import { ELEMENTS, HARDPOINTS } from '../../src/ui/content';
import { CEREMONY_KEEPS, CEREMONY_RESETS, ceremonyFacts, echoGuideDone, echoGuidePicks, newContentCoach, useCeremony } from '../../src/ui/ceremony';
import { bulkToast } from '../../src/ui/bulk';

const st = (pc: number, build: ProgressState['build'] = {}, extra: ProgressState['extraSystems'] = []): ProgressState => ({
  run: { deepestCleared: 0 }, meta: { deepestEver: 0, prestigeCount: pc }, build, extraSystems: extra,
});
const entry = (node: string, rank = 0): Pick<ShopEntry, 'node' | 'rank'> => ({ node: node as ShopEntry['node'], rank });

describe('content pool across Prestiges', () => {
  it('starts with the starters and adds one system per early Prestige, all by POOL_COMPLETE_AT (4–5)', () => {
    expect(contentPool(st(0))).toEqual({ elements: [...STARTER_ELEMENTS], hardpoints: [...STARTER_HARDPOINTS] });
    expect(POOL_COMPLETE_AT).toBeGreaterThanOrEqual(4);
    expect(POOL_COMPLETE_AT).toBeLessThanOrEqual(5);
    const all = contentPool(st(POOL_COMPLETE_AT));
    expect(all).toEqual({ elements: [...ELEMENTS], hardpoints: [...HARDPOINTS] });
    for (let pc = 1; pc <= POOL_COMPLETE_AT; pc++) expect(poolAddedAt(pc).length, `P${pc}`).toBeGreaterThanOrEqual(1);
    for (let pc = 1; pc <= POOL_COMPLETE_AT; pc++) expect(poolAddedAt(pc).length, `P${pc}`).toBeLessThanOrEqual(2);
    expect(poolAddedAt(0)).toEqual([]);
    expect(poolAddedAt(POOL_COMPLETE_AT + 1)).toEqual([]);
    expect(poolAddedAt(1)).toEqual(['frost']);
  });

  it('is monotone in prestigeCount (nothing offered is ever taken back) and adds exactly poolAddedAt', () => {
    for (let pc = 0; pc < 8; pc++) {
      const a = contentPool(st(pc)), b = contentPool(st(pc + 1));
      for (const e of a.elements) expect(b.elements).toContain(e);
      for (const h of a.hardpoints) expect(b.hardpoints).toContain(h);
      const added = [...b.elements, ...b.hardpoints].filter((id) => ![...a.elements, ...a.hardpoints].includes(id as never));
      expect(added).toEqual(poolAddedAt(pc + 1));
    }
    // every id has a threshold, and the starters are exactly the Prestige-0 ids
    expect(Object.entries(CONTENT_POOL.elements).filter(([, n]) => n === 0).map(([id]) => id)).toEqual([...STARTER_ELEMENTS]);
    expect(Object.entries(CONTENT_POOL.hardpoints).filter(([, n]) => n === 0).map(([id]) => id)).toEqual([...STARTER_HARDPOINTS]);
  });

  it('always offers what is owned: attuned, mounted, a Frame free mount or a borrowed system (existing saves)', () => {
    const p = contentPool(st(0, { attunements: ['frost', null], hardpoints: ['laser', null] }, [{ system: 'gravitics', via: 'frame' }] as never));
    expect(p.elements).toContain('frost');
    expect(p.hardpoints).toEqual(['ordnance', 'drones', 'laser', 'gravitics']);
  });

  it('Unlock everything offers every id at Prestige 0, and every Blueprint', () => {
    expect(contentPool(st(0), { unlockAll: true })).toEqual({ elements: [...ELEMENTS], hardpoints: [...HARDPOINTS] });
    expect(contentPool(st(0), { showEverything: true })).toEqual({ elements: [...ELEMENTS], hardpoints: [...HARDPOINTS] });
    const bp = { hardpoints: ['gravitics'], attunements: ['frost'] };
    expect(blueprintInPool(bp, 1)).toBe(false);
    expect(blueprintInPool(bp, POOL_COMPLETE_AT)).toBe(true);
    expect(blueprintInPool(bp, 1, { unlockAll: true })).toBe(true);
    expect(blueprintInPool({ hardpoints: ['drones'], attunements: ['fire'] }, 1)).toBe(true);
  });
});

describe('Fusions, Linkages and Infusions follow their parts', () => {
  const p0 = contentPool(st(0));
  it('a Fusion shows only when BOTH elements are in the pool', () => {
    const plasma = FUSIONS.find((f) => f.id === 'plasma')!;          // fire + lightning: starters
    const thermal = FUSIONS.find((f) => f.id === 'thermal_shock')!;  // fire + frost
    expect(poolAllows(entry(plasma.node.id), p0)).toBe(true);
    expect(poolAllows(entry(thermal.node.id), p0)).toBe(false);
    expect(poolAllows(entry(thermal.node.id), contentPool(st(1)))).toBe(true);
    for (const f of [...FUSIONS, ...TRIADS]) expect(poolAllows(entry(f.node.id), p0), f.id).toBe(f.elements.every((e) => (STARTER_ELEMENTS as string[]).includes(e)));
  });
  it('Linkages and Infusions need their hardpoint (and element) in the pool; a ranked entry always shows', () => {
    for (const l of WEAPON_LINKAGES) expect(poolAllows(entry(l.node.id), p0), l.id).toBe(l.pair.every((x) => x === 'primary' || (STARTER_HARDPOINTS as string[]).includes(x)));
    for (const l of CHASSIS_LINKAGES) expect(poolAllows(entry(l.node.id), p0), l.id).toBe((STARTER_HARDPOINTS as string[]).includes(l.pair[1]));
    for (const i of INFUSIONS) expect(poolAllows(entry(i.node.id), p0), i.id).toBe((STARTER_HARDPOINTS as string[]).includes(i.system) && (STARTER_ELEMENTS as string[]).includes(i.element));
    const cryo = FUSIONS.find((f) => f.id === 'cryotoxin')!;
    expect(poolAllows(entry(cryo.node.id, 1), p0)).toBe(true);
    // an owned element puts its Fusions back in the pool
    expect(poolAllows(entry(cryo.node.id), contentPool(st(0, { attunements: ['frost', 'poison'] })))).toBe(true);
  });
  it('poolShop keeps chassis and tree nodes, drops only out-of-pool cross entries; Unlock everything keeps all', () => {
    const shop = [entry('ballistics.damage'), entry('frost.chill'), entry(FUSIONS.find((f) => f.id === 'superconductivity')!.node.id), entry(FUSIONS.find((f) => f.id === 'plasma')!.node.id)];
    expect(poolShop(shop, p0).map((e) => e.node)).toEqual(['ballistics.damage', 'frost.chill', 'fusion.plasma']);
    expect(poolShop(shop, contentPool(st(0), { unlockAll: true }))).toHaveLength(4);
  });
});

describe('"New" callouts', () => {
  it('names what a Prestige added until it is seen in a picker; starters are never New', () => {
    expect(newInPool(contentPool(st(0)), new Set())).toEqual([]);
    expect(newInPool(contentPool(st(1)), new Set())).toEqual(['frost']);
    expect(newInPool(contentPool(st(2)), new Set(['frost']))).toEqual(['blade']);
    expect(newInPool(contentPool(st(POOL_COMPLETE_AT)), new Set(['frost', 'blade', 'laser', 'gravitics']))).toEqual([]);
  });
  it('the coach line names them and says where they appear', () => {
    expect(newContentCoach([])).toBeNull();
    const one = newContentCoach(['frost'])!;
    expect(one.text).toBe('New: Frost joins your arsenal. Look for the New tag when you attune.');
    expect(one.id).toBe('pool:frost');
    expect(newContentCoach(['frost', 'blade'])!.text).toMatch(/^New: Frost and Orbital Blade join your arsenal\. .* attune or mount\.$/);
    expect(newContentCoach(['laser'])!.text).toMatch(/when you mount\.$/);
  });
});

// ---------------------------------------------------------------- first-Prestige ceremony
const meta = (over: Partial<UiState['meta']> = {}): UiState['meta'] => ({
  prestigeCount: 0, deepestEver: 28, echoes: 0, prestigeRanks: {}, unlockedFrames: ['standard'], blueprints: [], ...over,
} as UiState['meta']);
const cState = (fc: Partial<NonNullable<UiState['forecast']>> | null, deepest = 28): Parameters<typeof ceremonyFacts>[0] => ({
  meta: meta(), run: { deepestCleared: deepest, threatDial: 0 } as UiState['run'], forecast: fc as UiState['forecast'],
});

describe('first-Prestige ceremony', () => {
  it('replaces the modal only for a plain first Prestige without Unlock everything', () => {
    expect(useCeremony({ meta: meta() }, false)).toBe(true);
    expect(useCeremony({ meta: meta() }, true)).toBe(false);
    expect(useCeremony({ meta: meta({ prestigeCount: 1 }) }, false)).toBe(false);
    expect(useCeremony({ meta: meta({ unlockedFrames: ['standard', 'arsenal'] }) }, false)).toBe(false);
  });
  it('says the exact Forecast Echoes, what resets, what stays and where the Frontier moves', () => {
    const f = ceremonyFacts(cState({ echoesNow: 42, frontier: 28, nextFrontier: 38 }));
    expect(f.gain).toBe('+42 Echoes');
    expect(f.cta).toBe('Prestige for 42 Echoes');
    expect(f.frontier).toBe('The Frontier moves from wave 28 to wave 38.');
    expect(f.resets).toBe(CEREMONY_RESETS);
    expect(f.keeps).toBe(CEREMONY_KEEPS);
    expect(CEREMONY_RESETS).toMatch(/Scrap, upgrades and the wave/);
    expect(CEREMONY_KEEPS).toMatch(/Echoes, the Codex, your records/);
    // no Forecast yet: the Echo formula, no Frontier line
    const g = ceremonyFacts(cState(null, 28));
    expect(g.echoes).toBeGreaterThan(0);
    expect(g.frontier).toBeNull();
    expect(ceremonyFacts(cState(null, 10)).gain).toBe('No Echoes yet');
  });
  it('the Echo guide points at affordable Layer I picks (never buys) and ends once nothing is affordable', () => {
    expect(echoGuidePicks({ meta: meta({ echoes: 0 }) })).toEqual([]);
    const rich = echoGuidePicks({ meta: meta({ prestigeCount: 1, echoes: 42 }) });
    expect(rich.length).toBeGreaterThan(0);
    expect(rich.every((id) => id.startsWith('prestige.'))).toBe(true);
    expect(echoGuidePicks({ meta: meta({ prestigeCount: 1, echoes: 42, deepestEver: 10 }) })).toEqual([]);   // Layer I closed
    expect(echoGuideDone({ meta: meta({ prestigeCount: 0, echoes: 0 }) })).toBe(false);   // the Prestige has not landed yet
    expect(echoGuideDone({ meta: meta({ prestigeCount: 1, echoes: 42 }) })).toBe(false);
    expect(echoGuideDone({ meta: meta({ prestigeCount: 1, echoes: 1 }) })).toBe(true);
  });
});

describe('Quartermaster buys are not player feedback', () => {
  const buy = (via?: string): SimEvent => ({ id: 1, tick: 0, type: Ev.Purchase, cause: -1, src: 'ballistics.damage', a: 3, b: 100, x: 0, y: 0, ...(via ? { data: { via } } : {}) } as SimEvent);
  it('the bulk summary toast ignores them', () => {
    expect(bulkToast([buy('quartermaster'), buy('quartermaster'), buy('quartermaster')], null)).toBeNull();
    expect(bulkToast([buy(), buy(), buy('quartermaster')], null)).toBe('Bought 2 ranks for ♦200');
  });
});

describe('merged post-Prestige card (UX Phase 4, C-19)', async () => {
  const { postPrestigeDigest } = await import('../../src/ui/coach');
  const { features } = await import('../../src/ui/progression');
  it('lists the lines a first Prestige reveals in one card, keeps reveal rules, and carries the QM action', () => {
    const f = features({ run: { deepestCleared: 28 }, meta: { deepestEver: 28, prestigeCount: 1 } }, { unlockAll: false });
    const before = features({ run: { deepestCleared: 28 }, meta: { deepestEver: 28, prestigeCount: 0 } }, { unlockAll: false });
    // everything the wave-28 player had already read
    const seen = new Set<string>(['start', 'checkpoint', 'elements', 'patrol', 'build', 'doctrines', 'abilities', 'boons', 'anomalies', 'bulk', 'prestige', 'cross', 'inspector', 'cores', 'salvage', 'overcharge']);
    const qm = { id: 'qm-on', icon: 'blueprint', text: 'long', short: 'QM short', action: { label: 'Turn on', run: () => {} } };
    const d = postPrestigeDigest(f, seen, [qm]);
    expect(d).not.toBeNull();
    expect(d!.ids).toEqual(expect.arrayContaining(['frame', 'exotics', 'machine', 'qm-on']));
    expect(d!.items).toContain('QM short');
    expect(d!.action?.label).toBe('Turn on');
    // a single line is not merged; nothing before the reveal; Unlock everything shows none
    expect(postPrestigeDigest(f, new Set([...seen, 'frame', 'exotics', 'machine']), [qm])).toBeNull();
    expect(postPrestigeDigest(before, seen, [])?.ids.includes('machine') ?? false).toBe(false);
    expect(postPrestigeDigest({ ...f, unlockAll: true }, seen, [qm])).toBeNull();
  });
});
