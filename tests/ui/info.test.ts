import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ShopEntry } from '../../src/sim/core/types';
import { INFO, INFO_KEYS, glossary } from '../../src/ui/info';
import { ECHO_TIERS, earliestGate, gateText, nodeGate, nodeTier, tierLabel } from '../../src/ui/echo-tiers';
import { allFeatures, features, type ProgressState } from '../../src/ui/progression';
import { wallGaugeLines, wallTarget } from '../../src/ui/forecast';
import { MORE_ITEMS, PRESTIGE_SEGS } from '../../src/ui/screens';
import { lockedTrialsText } from '../../src/ui/trials';
import { affordableNow, fmtHours, offlineCapSeconds, summarizeOffline } from '../../src/ui/offline';
import { LAYERS } from '../../src/ui/prestige-shop';

const UI_DIR = join(__dirname, '..', '..', 'src', 'ui');
const sources = readdirSync(UI_DIR).filter((f) => f.endsWith('.ts')).map((f) => ({ f, s: readFileSync(join(UI_DIR, f), 'utf8') }));

describe('info table', () => {
  it('every entry has a title and one or two plain sentences', () => {
    for (const k of INFO_KEYS) {
      const e = INFO[k];
      expect(e.title.length, k).toBeGreaterThan(1);
      expect(e.text.length, k).toBeGreaterThan(20);
      expect((e.text.match(/[.!?](\s|$)/g) ?? []).length, k).toBeLessThanOrEqual(4);
    }
  });
  it('every key used in the UI code has text', () => {
    const used = new Set<string>();
    for (const { s } of sources) {
      for (const m of s.matchAll(/(?:markInfo|infoOnHold)\([^,]+,\s*'([^']+)'\)/g)) used.add(m[1]);
      for (const m of s.matchAll(/data:\s*\{\s*info:\s*'([^']+)'/g)) used.add(m[1]);
      for (const m of s.matchAll(/readout\([^)]*?,\s*'(fc\.[a-zA-Z]+)'\)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(10);
    for (const k of used) expect(INFO[k], `data-info "${k}" has no text`).toBeTruthy();
  });
  it('the five Forecast readouts each have an entry', () => {
    for (const k of ['fc.echoesNow', 'fc.rate', 'fc.next', 'fc.reclimb', 'fc.wall']) expect(INFO[k]).toBeTruthy();
    expect(INFO.scrap && INFO.cores && INFO.mode).toBeTruthy();
  });
  it('the glossary lists only what the player has been shown', () => {
    const base = (best: number): ProgressState => ({ run: { deepestCleared: best }, meta: { deepestEver: best, prestigeCount: 0 } });
    const early = glossary(features(base(5))).map((g) => g.key);
    expect(early).toContain('scrap');
    expect(early).toContain('mode');
    for (const hidden of ['cores', 'echoes', 'fc.wall', 'frame', 'boons', 'anomalies', 'ce']) expect(early, hidden).not.toContain(hidden);
    const mid = glossary(features(base(20))).map((g) => g.key);
    expect(mid).toContain('fc.wall');
    expect(mid).toContain('echoTiers');
    expect(mid).not.toContain('frame');
    expect(glossary(allFeatures()).length).toBe(INFO_KEYS.length);
  });
});

describe('Echo tier naming and real gates', () => {
  it('tiers are called Echo tier I to IV and match the shop layers', () => {
    expect(ECHO_TIERS.map((t) => tierLabel(t.layer))).toEqual(['Echo tier I', 'Echo tier II', 'Echo tier III', 'Echo tier IV']);
    expect(LAYERS.map((l) => l.name)).toEqual(['Echo tier I: Inheritance', 'Echo tier II: Arsenal Memory', 'Echo tier III: Command Network', 'Echo tier IV: Evolution']);
    expect(LAYERS.map((l) => l.wave)).toEqual([20, 40, 60, 80]);
    expect(nodeTier('third_tactical_slot')).toBe('Echo tier III');
    expect(nodeTier('prestige.autonomy')).toBe('Echo tier IV');
  });
  it('a lock states the wave and the purchase, from the data', () => {
    expect(nodeGate('trials', 25)?.text).toBe('Reach wave 40 · buy Trials (120 Echoes)');
    expect(nodeGate('trials', 40)?.text).toBe('Buy Trials in Prestige → Echo tiers (120 Echoes)');
    expect(nodeGate('directives', 0)?.text).toContain('Reach wave 60');
    expect(nodeGate('nope', 0)).toBeNull();
    expect(gateText('trials', 0, 1)).toBeNull();   // owned: no lock
    expect(earliestGate(['directives', 'blueprint_slots'], 0)?.name).toBe('Blueprint Slots');
  });
  it('no lock or segment still says "Prestige II/III/IV"', () => {
    const ui = { meta: { prestigeRanks: {}, deepestEver: 25 }, run: { deepestCleared: 25 } } as never;
    const locks = MORE_ITEMS.map((i) => i.lock?.(ui) ?? '').concat(PRESTIGE_SEGS.map((s) => s.lock(ui) ?? ''));
    expect(locks.some((l) => /Prestige (I|II|III|IV)\b/.test(l))).toBe(false);
    expect(locks.join('|')).toContain('Reach wave 40 · buy Trials (120 Echoes)');
  });
  it('the player-facing UI source never names an Echo tier "Prestige I–IV"', () => {
    // the files this pass owns (other screens are renamed by their own owners)
    const mine = ['hud', 'forecast', 'build', 'settings', 'coach', 'progression', 'prestige-shop', 'screens', 'directives', 'trials', 'offline', 'info', 'echo-tiers'];
    for (const { f, s } of sources.filter((x) => mine.includes(x.f.replace('.ts', '')))) {
      const code = s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, f).not.toMatch(/Prestige (II|III|IV)\b/);
    }
  });
  it('the collapsed Trials card counts the locked Trials', () => {
    expect(lockedTrialsText(10, 25)).toBe('10 Trials unlock at: Reach wave 40 · buy Trials (120 Echoes).');
  });
});

describe('Wall gauge names its unlock', () => {
  const e = (name: string, over: Partial<ShopEntry>): ShopEntry => ({ node: name as never, tree: 'ballistics', name, desc: '', rank: 0, maxRank: 1, cost: 150, currency: 'scrap', affordable: false, kind: 'mechanic', tier: 0, nextCosts: [], affordableRanks: 0, affordableTotal: 0, ...over });
  it('picks the cheapest unowned behaviour change, like the sim', () => {
    const shop = [e('Execution', { cost: 150 }), e('Pierce', { cost: 90, locked: 'x' }), e('Damage', { kind: 'stat', cost: 5 }), e('Done', { cost: 20, rank: 1 }), e('Arc', { cost: 400, kind: 'fusion' })];
    expect(wallTarget(shop)).toEqual({ name: 'Execution', tree: 'Ballistics', cost: 150 });
    expect(wallTarget([e('Damage', { kind: 'stat' })])).toBeNull();
  });
  it('reads "Now" / "In 3m" with the name, or says nothing is in reach', () => {
    const t = { name: 'Execution', tree: 'Ballistics', cost: 150 };
    expect(wallGaugeLines(0, t)).toEqual({ val: 'Now', sub: 'Execution (Ballistics) ◆150', warn: false });
    expect(wallGaugeLines(180, t).val).toBe('In 3m');
    expect(wallGaugeLines(null, null)).toMatchObject({ val: 'None in reach', warn: true });
    expect(wallGaugeLines(null, t).val).toBe('No income');
  });
});

describe('offline return card', () => {
  const ui = (rank: number, shop: ShopEntry[], checkpoint = 35) => ({ shop, run: { checkpoint }, meta: { prestigeRanks: { 'prestige.long_patrol': rank } } }) as never;
  const ent = (name: string, kind: ShopEntry['kind'], cost: number): ShopEntry => ({ node: name as never, tree: 'ballistics', name, desc: '', rank: 0, maxRank: 5, cost, currency: 'scrap', affordable: true, kind, tier: 0, nextCosts: [], affordableRanks: 1, affordableTotal: cost });
  it('time counted against the cap', () => {
    expect(offlineCapSeconds(0)).toBe(8 * 3600);
    expect(offlineCapSeconds(4)).toBe(24 * 3600);
    expect(summarizeOffline(11 * 3600, 500, ui(4, [])).counted).toBe('Counted 11 h of your 24 h cap');
    const over = summarizeOffline(30 * 3600, 500, ui(4, []));
    expect(over.capped).toBe(true);
    expect(over.counted).toBe('Counted 24 h of your 24 h cap (you were away 1d 6h)');
    expect(fmtHours(2700)).toBe('45 min');
  });
  it('names the top two affordable buys (behaviour first), the next boss, and no zero note', () => {
    const shop = [ent('Damage', 'stat', 100), ent('Execution', 'mechanic', 300), ent('Pierce', 'mechanic', 200), ent('Fire Rate', 'stat', 50)];
    expect(affordableNow(shop)).toEqual({ names: ['Execution', 'Pierce'], more: 2 });
    const s = summarizeOffline(3600, 900, ui(0, shop));
    expect(s.now).toEqual(['Execution', 'Pierce']);
    expect(s.boss).toBe('Next boss: wave 40');
    expect(s.zero).toBeNull();
  });
  it('zero income says how to earn while away', () => {
    const s = summarizeOffline(7200, 0, ui(0, [ent('Damage', 'stat', 1)]));
    expect(s.zero).toBe('Patrol earned nothing while you were away. Switch to Patrol before you leave to earn while away.');
    expect(s.now).toEqual([]);
  });
});
