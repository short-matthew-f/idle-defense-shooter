import { describe, expect, it } from 'vitest';
import type { ShopEntry } from '../../src/sim/core/types';
import { deathHeadline, entryValue, etaSeconds, nextPurchase, openForks, openSlots, suggestPurchases, type AdviceState } from '../../src/ui/advice';
import { draftSecondsLeft, DRAFT_AUTO_TICKS } from '../../src/ui/draft';
import { tellPrompt } from '../../src/ui/hud';

const entry = (node: string, cost: number, extra: Partial<ShopEntry> = {}): ShopEntry => ({
  node, tree: node.split('.')[0] as ShopEntry['tree'], name: node, desc: '', rank: 0, maxRank: 10, cost, currency: 'scrap', affordable: false, kind: 'stat', tier: 0, ...extra,
});

function state(shop: ShopEntry[], scrap: number, extra: Partial<AdviceState['run']> = {}, build: Partial<AdviceState['build']> = {}): AdviceState {
  return { shop, run: { scrap, hardpointSlotsOpen: 0, attunementSlotsOpen: 0, ...extra }, build: { hardpoints: [], attunements: [], doctrines: {}, ...build } };
}

describe('purchase advice', () => {
  it('ETA at the current income', () => {
    expect(etaSeconds(100, 100, 0)).toBe(0);
    expect(etaSeconds(100, 40, 3)).toBe(20);
    expect(etaSeconds(100, 40, 0)).toBeNull();
  });

  it('"Nothing affordable" becomes the next purchase with its price and ETA', () => {
    const shop = [entry('ballistics.damage', 15), entry('ballistics.range', 12), entry('bastion.max_hp', 9, { locked: 'x' }), entry('reactor.x', 5, { currency: 'cores' }), entry('ballistics.maxed', 1, { rank: 10 })];
    const n = nextPurchase(shop, 2, 1);
    expect(n?.entry.node).toBe('ballistics.range');
    expect(n?.eta).toBe(10);
    expect(nextPurchase([entry('a.b', 5, { affordable: true })], 10, 1)).toBeNull();
  });

  it('values mechanics over core stats over other stats', () => {
    expect(entryValue(entry('ballistics.execution', 1, { kind: 'mechanic' }))).toBeGreaterThan(entryValue(entry('ballistics.damage', 1)));
    expect(entryValue(entry('ballistics.damage', 1))).toBeGreaterThan(entryValue(entry('ballistics.projectile_speed', 1)));
    expect(entryValue(entry('ability.x', 1, { kind: 'ability' }))).toBeLessThan(entryValue(entry('ballistics.projectile_speed', 1)));
  });

  it('suggests open slots first, then forks, then one buy per tree', () => {
    const shop = [
      entry('ballistics.damage', 15, { affordable: true }), entry('ballistics.attack_speed', 12, { affordable: true }),
      entry('bastion.max_hp', 20, { affordable: true }), entry('reactor.targeting_logic', 150, { affordable: true, kind: 'mechanic' }),
      entry('ballistics.piercing', 0, { affordable: true, kind: 'doctrine', currency: 'cores' }),
    ];
    const s = suggestPurchases(state(shop, 300, { attunementSlotsOpen: 1 }), 2, 3);
    expect(s.map((x) => x.kind)).toEqual(['slot', 'doctrine', 'buy']);
    expect(s[2].kind === 'buy' && s[2].entry.node).toBe('reactor.targeting_logic');
    const t = suggestPurchases(state(shop.slice(0, 3), 300), 2, 3);
    expect(t.map((x) => (x.kind === 'buy' ? x.entry.node : x.kind))).toEqual(['ballistics.attack_speed', 'bastion.max_hp']);
  });

  it('fills a short list with what you are saving toward', () => {
    const shop = [entry('ballistics.damage', 15, { affordable: true }), entry('bastion.max_hp', 40), entry('reactor.global_attack_speed', 90)];
    const s = suggestPurchases(state(shop, 20), 5, 3);
    expect(s.length).toBe(3);
    expect(s[1].kind === 'buy' && !s[1].affordable && s[1].eta).toBe(4);
  });

  it('finds open slots and open forks', () => {
    expect(openSlots(state([], 0, { attunementSlotsOpen: 2, hardpointSlotsOpen: 1 }, { attunements: ['fire'], hardpoints: [] }))).toEqual([{ cat: 'elements', slot: 1 }, { cat: 'hardpoints', slot: 0 }]);
    expect(openSlots(state([], 0, { attunementSlotsOpen: 1 }, { attunements: ['fire'] }))).toEqual([]);
    const fork = entry('ballistics.multishot', 0, { affordable: true, kind: 'doctrine' });
    expect(openForks(state([fork], 0)).length).toBe(1);
    expect(openForks(state([fork], 0, {}, { doctrines: { ballistics: 'piercing' } as AdviceState['build']['doctrines'] })).length).toBe(0);
  });

  it('death headline names the boss and the restart wave', () => {
    expect(deathHeadline(5, 0, 'The Breaker')).toEqual({ title: 'The Breaker destroyed the tower on wave 5', sub: 'Restarting at wave 1. Scrap and upgrades are kept.' });
    expect(deathHeadline(18, 15, null).sub).toContain('wave 16 (checkpoint 15)');
  });

  it('draft auto-pick countdown', () => {
    expect(draftSecondsLeft(1000, null)).toBe(DRAFT_AUTO_TICKS / 60);
    expect(draftSecondsLeft(1000 + 600, 1000)).toBe(20);
    expect(draftSecondsLeft(1000 + 5000, 1000)).toBe(0);
  });

  it('boss tell prompt: equip, wait or cast the Counter', () => {
    const base = { build: { abilities: [null, null] }, abilities: [], tower: { ce: 0 } } as unknown as Parameters<typeof tellPrompt>[1];
    expect(tellPrompt('repulsor_pulse', base).action).toBe('equip');
    const slotted = { build: { abilities: ['repulsor_pulse', null] }, abilities: [{ id: 'repulsor_pulse', cost: 30, cooldown: 0, ready: false }], tower: { ce: 10 } } as unknown as Parameters<typeof tellPrompt>[1];
    expect(tellPrompt('repulsor_pulse', slotted)).toEqual({ text: 'counter with Repulsor Pulse (needs 30 CE)', action: 'wait' });
    const ready = { ...slotted, abilities: [{ id: 'repulsor_pulse', cost: 30, cooldown: 0, ready: true }], tower: { ce: 50 } } as unknown as Parameters<typeof tellPrompt>[1];
    expect(tellPrompt('repulsor_pulse', ready).action).toBe('cast');
    expect(tellPrompt('designate', base).action).toBe('designate');
  });
});
