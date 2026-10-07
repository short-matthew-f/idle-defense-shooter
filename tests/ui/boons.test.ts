import { describe, expect, it } from 'vitest';
import type { BoonId } from '../../src/sim/core/ids';
import { BOONS } from '../../src/sim/data/boons';
import {
  activeSummary, arrivesAsChip, attemptKey, boonName, needRevealed, boonNeeds, boonView, offerHeading, pickCommand, replacedBy, rerollState, CATEGORY_LABEL,
} from '../../src/ui/boons';
import { plainDesc } from '../../src/ui/format';
import { tabBadges, type BadgeState } from '../../src/ui/shell-logic';

const build = (o: Partial<{ hardpoints: string[]; attunements: string[]; ranks: Record<string, number> }> = {}) =>
  ({ hardpoints: [], attunements: [], ranks: {}, ...o }) as never;

describe('boon UI helpers', () => {
  it('boonView carries name, category and rarity labels, the short line and the description', () => {
    for (const b of BOONS) {
      const v = boonView(b.id, null);
      expect(v.name).toBe(b.name);
      expect(v.categoryLabel).toBe(CATEGORY_LABEL[b.category]);
      expect(v.rarityLabel).toMatch(/^(Common|Rare)$/);
      expect(v.short).toBe(b.short);
      expect(v.desc).toBe(plainDesc(b.desc));
    }
    expect(boonView('nope' as BoonId, null).name).toBe('Nope');
  });

  it('needs: met by a mounted hardpoint or attuned element; a Fusion needs a ranked fusion with both elements', () => {
    expect(boonNeeds('overcharge', build())).toEqual([]);
    expect(boonNeeds('rally_drones', build())).toEqual([{ label: 'Drones', have: false, id: 'drones' }]);
    expect(boonNeeds('rally_drones', build({ hardpoints: ['drones'] }))[0].have).toBe(true);
    expect(boonNeeds('static_field', build({ attunements: ['lightning'] }))[0].have).toBe(true);
    expect(boonNeeds('encore', build({ attunements: ['fire', 'lightning'] }))[0]).toEqual({ label: 'a Fusion', have: false, id: 'fusion' });
    expect(boonNeeds('encore', build({ attunements: ['fire', 'lightning'], ranks: { 'fusion.plasma': 1 } }))[0].have).toBe(true);
    expect(boonNeeds('encore', null)[0].have).toBe(true);   // no build known: no warning
  });

  it('needRevealed: a needs tag names a system only once its category is revealed (progressive reveal)', () => {
    const f = { elements: true, hardpoints: false, cross: false };
    expect(needRevealed('fire', f)).toBe(true);
    expect(needRevealed('drones', f)).toBe(false);
    expect(needRevealed('fusion', f)).toBe(false);
    expect(needRevealed('primary', f)).toBe(true);
    expect(needRevealed('drones', null)).toBe(true);
  });

  it('replacedBy: nothing below the cap, else the chosen active boon or the oldest', () => {
    const a: BoonId[] = ['overcharge', 'miser', 'stopwatch'];
    expect(replacedBy(a, 4)).toBeNull();
    const full: BoonId[] = [...a, 'windfall'];
    expect(replacedBy(full, 4)).toBe('overcharge');
    expect(replacedBy(full, 4, 'stopwatch')).toBe('stopwatch');
    expect(replacedBy(full, 4, 'berserk')).toBe('overcharge');   // not active: the oldest
  });

  it('pickCommand names the replacement only at the cap', () => {
    expect(pickCommand('berserk', ['miser'], 4, 'miser')).toEqual({ type: 'pick_boon', boon: 'berserk' });
    const full: BoonId[] = ['overcharge', 'miser', 'stopwatch', 'windfall'];
    expect(pickCommand('berserk', full, 4)).toEqual({ type: 'pick_boon', boon: 'berserk' });
    expect(pickCommand('berserk', full, 4, 'stopwatch')).toEqual({ type: 'pick_boon', boon: 'berserk', replace: 'stopwatch' });
  });

  it('heading, reroll and active summary', () => {
    expect(offerHeading('start', 0)).toEqual({ title: 'Pick a boon', sub: 'New attempt' });
    expect(offerHeading('boss', 2).sub).toBe('Boss cleared · +2 waiting');
    expect(rerollState(3, 1)).toMatchObject({ cost: 1, can: true });
    expect(rerollState(1, 2)).toMatchObject({ cost: 2, can: false });
    expect(rerollState(1, 2).label).toMatch(/2 Cores \(you have 1\)/);
    expect(activeSummary([], 4).count).toBe('0/4');
    const s = activeSummary(['overcharge', 'hunters_gambit'], 4);
    expect(s.count).toBe('2/4');
    expect(s.label).toContain("Hot Barrel, Hunter's Gambit");
    expect(boonName('boon.volatile_kills')).toBe('Volatile Kills');
  });

  it('the Build tab badges a pending boon offer (after an Anomaly draft)', () => {
    const base: BadgeState = {
      shop: [], forecast: null as never,
      run: { pendingDraft: null, hardpointSlotsOpen: 0, attunementSlotsOpen: 0, deepestCleared: 3, boonOffer: null },
      build: { hardpoints: [], attunements: [], doctrines: {} }, meta: { ascension: 0 },
    };
    expect(tabBadges(base).build).toBeNull();
    const withOffer = { ...base, run: { ...base.run, boonOffer: ['overcharge', 'miser', 'stopwatch'] as BoonId[] } };
    expect(tabBadges(withOffer).build).toMatchObject({ kind: 'alert', label: 'Boon offer waiting' });
    const both = { ...withOffer, run: { ...withOffer.run, pendingDraft: ['tithe'] as never } };
    expect(tabBadges(both).build?.label).toBe('Anomaly draft waiting');
  });
});

describe('set-aside memory (C-08)', () => {
  it('a later offer arrives as the chip only in the attempt the player set one aside in', () => {
    const k = attemptKey(2, 5);
    expect(arrivesAsChip({ key: k, aside: true }, k)).toBe(true);
    expect(arrivesAsChip({ key: k, aside: true }, attemptKey(2, 6))).toBe(false);   // a new attempt
    expect(arrivesAsChip({ key: k, aside: true }, attemptKey(3, 5))).toBe(false);   // a Prestige (attempts restart too)
    expect(arrivesAsChip({ key: k, aside: false }, k)).toBe(false);                 // nothing set aside
    expect(arrivesAsChip({ key: '', aside: false }, k)).toBe(false);
  });
});
