import { describe, expect, it } from 'vitest';
import { features, type Features } from '../../src/ui/progression';
import { HINTS, HINT_LABEL_MAX_WORDS, allHints, finishedHints, initialHintsDone, nextHint, registerHint, type HintCtx, type HintUi } from '../../src/ui/hints';
import { QM_COACH } from '../../src/ui/pointer';

const feats = (best: number, prestige = 0, unlockAll = false): Features =>
  features({ run: { deepestCleared: best }, meta: { deepestEver: best, prestigeCount: prestige } }, { unlockAll });

const ui = (over: Partial<{ att: (string | null)[]; hp: (string | null)[]; attOpen: number; hpOpen: number; abilities: (string | null)[]; boon: boolean; draft: boolean; recommended: boolean; prestige: number; qm: { unlocked: boolean; on: boolean } }> = {}): HintUi => ({
  run: { attunementSlotsOpen: over.attOpen ?? 0, hardpointSlotsOpen: over.hpOpen ?? 0, boonOffer: over.boon ? ['x'] : null, pendingDraft: over.draft ? ['y'] : null },
  build: { attunements: over.att ?? [], hardpoints: over.hp ?? [], abilities: over.abilities ?? [null, null], ranks: {} },
  meta: { prestigeCount: over.prestige ?? 0 },
  forecast: { recommended: !!over.recommended },
  quartermaster: over.qm ?? null,
});

const ctx = (f: Features, over: Partial<Omit<HintCtx, 'live'>> & { live?: Partial<HintCtx['live']> } = {}): HintCtx => ({
  f, enabled: true, unlockAll: f.unlockAll, done: new Set(), visited: new Set(['upgrades', 'build', 'prestige', 'more']),
  coach: { current: null, seen: new Set(['start', 'checkpoint', 'elements', 'build', 'abilities', 'boons', 'anomalies', 'bulk', 'prestige', 'machine', 'overcharge', QM_COACH]) },
  nav: { screen: null, battle: true }, shop: { cat: 'chassis', tree: 'ballistics' }, blocked: false, armed: false,
  ...over,
  live: { starterReady: false, starterOwned: 5, ceReady: false, boonChip: false, draftWaiting: false, ...over.live },
});

describe('pointer hints: the stage-0 Upgrade button', () => {
  const f0 = feats(0);
  it('points at the Upgrade button while it can buy and nothing is owned, with a short label', () => {
    const c = ctx(f0, { coach: { current: 'start', seen: new Set() }, live: { starterReady: true, starterOwned: 0 } });
    expect(nextHint(ui(), c)).toEqual({ id: 'start', target: 'upgrade', text: 'Tap to upgrade', final: true });
  });
  it('waits while it cannot buy, and retires after the first purchase ("buy again" once more when affordable)', () => {
    expect(nextHint(ui(), ctx(f0, { live: { starterReady: false, starterOwned: 0 } }))).toBeNull();
    const again = nextHint(ui(), ctx(f0, { live: { starterReady: true, starterOwned: 1 } }));
    expect(again?.id).toBe('start-again');
    expect(again?.target).toBe('upgrade');
    expect(nextHint(ui(), ctx(f0, { live: { starterReady: true, starterOwned: 2 } }))).toBeNull();
    // shown, then bought: the condition ended, so it retires
    expect(finishedHints(['start'], ui(), ctx(f0, { live: { starterReady: false, starterOwned: 1 } }))).toEqual(['start']);
    expect(finishedHints(['start'], ui(), ctx(f0, { live: { starterReady: true, starterOwned: 0 } }))).toEqual([]);
  });
  it('waits for its banner: nothing before the "start" line has shown, and another banner keeps it back', () => {
    const live = { starterReady: true, starterOwned: 0 };
    expect(nextHint(ui(), ctx(f0, { coach: { current: null, seen: new Set() }, live }))).toBeNull();
    expect(nextHint(ui(), ctx(f0, { coach: { current: 'boons', seen: new Set(['start']) }, live }))).toBeNull();
    expect(nextHint(ui(), ctx(f0, { coach: { current: null, seen: new Set(['start']) }, live }))?.id).toBe('start');
  });
  it('none while blocked (modal, draft, death card), switched off, retired, or an ability is armed', () => {
    const live = { starterReady: true, starterOwned: 0 };
    expect(nextHint(ui(), ctx(f0, { blocked: true, live }))).toBeNull();
    expect(nextHint(ui(), ctx(f0, { enabled: false, live }))).toBeNull();
    expect(nextHint(ui(), ctx(f0, { done: new Set(['start']), live }))).toBeNull();
    expect(nextHint(ui(), ctx(f0, { armed: true, live }))?.id).toBe('abilities-field');   // only the "tap the field" nudge
  });
  it('from another tab it points back to Battle first', () => {
    const c = ctx(feats(5), { nav: { screen: 'upgrades', battle: false }, live: { starterReady: true, starterOwned: 0 } });
    expect(nextHint(ui(), c)).toMatchObject({ id: 'start', target: 'tab-battle', final: false });
  });
});

describe('pointer hints: tab reveals', () => {
  it('a newly revealed tab until it is first opened', () => {
    const f1 = feats(5);
    expect(nextHint(ui(), ctx(f1, { visited: new Set() }))).toMatchObject({ id: 'tab-upgrades', target: 'tab-upgrades', final: true });
    expect(nextHint(ui(), ctx(f1, { visited: new Set(['upgrades']) }))).toBeNull();
    expect(nextHint(ui(), ctx(f1, { visited: new Set(), nav: { screen: 'upgrades', battle: false } }))).toBeNull();
  });
  it('Build before More (one ring at a time)', () => {
    const f3 = feats(10);
    expect(nextHint(ui(), ctx(f3, { visited: new Set(['upgrades']) }))?.id).toBe('tab-build');
    expect(nextHint(ui(), ctx(f3, { visited: new Set(['upgrades', 'build']) }))?.id).toBe('tab-more');
  });
  it('Unlock everything: no reveal hints', () => {
    expect(nextHint(ui(), ctx(feats(0, 0, true), { visited: new Set() }))).toBeNull();
  });
});

describe('pointer hints: chains (tab → category → control)', () => {
  const f2 = feats(6);
  const u = ui({ attOpen: 1, att: [] });
  it('Elements: Upgrades tab → Elements chip → empty slot chip → the picker (never an option)', () => {
    expect(nextHint(u, ctx(f2))).toMatchObject({ id: 'elements', target: 'tab-upgrades', final: false });
    const up = { screen: 'upgrades' as const, battle: false };
    expect(nextHint(u, ctx(f2, { nav: up }))).toMatchObject({ target: 'cat-elements', final: false });
    expect(nextHint(u, ctx(f2, { nav: up, shop: { cat: 'elements', tree: 'fire' } }))).toMatchObject({ target: 'slot-chip', final: false });
    expect(nextHint(u, ctx(f2, { nav: up, shop: { cat: 'elements', tree: 'slot:0' } }))).toMatchObject({ target: 'slot-picker', final: true });
    for (const d of HINTS) for (const s of [d.step(u, ctx(f2, { nav: up, shop: { cat: 'elements', tree: 'slot:0' } }))]) expect(s?.target ?? '').not.toMatch(/fire|lightning|poison|frost/);
  });
  it('Elements retires once the slot is filled', () => {
    const filled = ui({ attOpen: 1, att: ['fire'] });
    expect(nextHint(filled, ctx(f2))).toBeNull();
    expect(finishedHints(['elements'], filled, ctx(f2))).toEqual(['elements']);
  });
  it('Build: Build tab → the empty hardpoint slot\'s Mount', () => {
    const f3 = feats(10), h = ui({ hpOpen: 1, hp: [] });
    expect(nextHint(h, ctx(f3))).toMatchObject({ id: 'build', target: 'tab-build' });
    expect(nextHint(h, ctx(f3, { nav: { screen: 'build', battle: false } }))).toMatchObject({ target: 'build-mount', final: true });
  });
  it('a hint whose control is not on screen gives way to the next one', () => {
    const h = ui({ hpOpen: 1, hp: [] });
    const c = ctx(feats(10), { visited: new Set(['upgrades']) });
    expect(nextHint(h, c, (t) => t !== 'tab-build')?.id).toBe('tab-more');
  });
  it('Unlock everything: an opened slot is genuinely new and still points', () => {
    expect(nextHint(u, ctx(feats(6, 0, true), { coach: { current: null, seen: new Set() } }))?.id).toBe('elements');
  });
});

describe('pointer hints: abilities, offers, bulk, Prestige', () => {
  it('the first ability slot when CE allows it; the one-time field nudge only while armed', () => {
    const f4 = feats(12);
    expect(nextHint(ui(), ctx(f4, { live: { ceReady: false } }))).toBeNull();
    expect(nextHint(ui(), ctx(f4, { live: { ceReady: true } }))).toMatchObject({ id: 'abilities', target: 'ability-0', text: 'Choose an ability' });
    expect(nextHint(ui(), ctx(f4, { armed: true }))).toMatchObject({ id: 'abilities-field', target: 'field' });
    expect(nextHint(ui(), ctx(f4, { armed: true, done: new Set(['abilities-field']) }))).toBeNull();
    expect(finishedHints(['abilities-field'], ui(), ctx(f4, { armed: false }))).toEqual(['abilities-field']);
  });
  it('a set-aside boon: the chip on Battle, the Build tab elsewhere; a set-aside draft: Build → its button', () => {
    const f5 = feats(15);
    expect(nextHint(ui({ boon: true }), ctx(f5, { live: { boonChip: true } }))).toMatchObject({ id: 'boon', target: 'boon-chip' });
    expect(nextHint(ui({ boon: true }), ctx(f5, { nav: { screen: 'upgrades', battle: false }, live: { boonChip: true } }))).toMatchObject({ target: 'tab-build' });
    expect(nextHint(ui({ boon: true }), ctx(f5, { live: { boonChip: false } }))).toBeNull();
    expect(nextHint(ui({ draft: true }), ctx(f5, { live: { draftWaiting: true } }))).toMatchObject({ id: 'anomaly', target: 'tab-build' });
    expect(nextHint(ui({ draft: true }), ctx(f5, { nav: { screen: 'build', battle: false }, live: { draftWaiting: true } }))).toMatchObject({ target: 'draft', final: true });
  });
  it('bulk: only on Upgrades, Buy all when it shows, else the quantity selector', () => {
    const f5 = feats(15);
    expect(nextHint(ui(), ctx(f5))).toBeNull();
    expect(nextHint(ui(), ctx(f5, { nav: { screen: 'upgrades', battle: false }, live: { buyAll: true } }))).toMatchObject({ id: 'bulk', target: 'buy-all' });
    expect(nextHint(ui(), ctx(f5, { nav: { screen: 'upgrades', battle: false } }))).toMatchObject({ id: 'bulk', target: 'qty' });
  });
  it('Prestige: the tab when the Forecast first recommends it; retires on opening it', () => {
    const f6 = feats(20);
    expect(nextHint(ui({ recommended: true }), ctx(f6))).toMatchObject({ id: 'prestige', target: 'tab-prestige' });
    expect(nextHint(ui({ recommended: false }), ctx(f6))).toBeNull();
    expect(finishedHints(['prestige'], ui({ recommended: true }), ctx(f6, { nav: { screen: 'prestige', battle: false } }))).toEqual(['prestige']);
  });
  it('Quartermaster (registered by pointer.ts): the banner\'s "Turn on", else its switch on Upgrades', () => {
    const f7 = feats(30, 1);
    const q = ui({ prestige: 1, qm: { unlocked: true, on: false } });
    expect(nextHint(q, ctx(f7, { coach: { current: QM_COACH, seen: new Set() } }))).toMatchObject({ id: 'quartermaster', target: 'qm-turn-on', final: true });
    expect(nextHint(q, ctx(f7, { nav: { screen: 'upgrades', battle: false }, done: new Set(['bulk']) }))).toMatchObject({ target: 'quartermaster-toggle' });
    expect(nextHint(ui({ prestige: 1, qm: { unlocked: true, on: true } }), ctx(f7))).toBeNull();
  });
});

describe('pointer hints: bookkeeping and the extension point', () => {
  it('an existing save past a stage starts with those hints retired; a new game with none', () => {
    expect(initialHintsDone(feats(0), 0)).toEqual([]);
    expect(initialHintsDone(feats(40, 0, true), 7)).toEqual([]);
    const at3 = initialHintsDone(feats(10), 3);
    for (const id of ['start', 'start-again', 'elements', 'build', 'tab-upgrades', 'tab-build', 'tab-more']) expect(at3).toContain(id);
    for (const id of ['abilities', 'bulk', 'tab-prestige', 'prestige', 'boon']) expect(at3).not.toContain(id);
  });
  it('every built-in label is short (the banner keeps the sentence)', () => {
    const states: [HintUi, HintCtx][] = [];
    for (const nav of [{ screen: null, battle: true }, { screen: 'upgrades', battle: false }, { screen: 'build', battle: false }] as HintCtx['nav'][]) {
      for (const tree of ['slot:0', 'fire']) states.push([ui({ attOpen: 1, hpOpen: 1, boon: true, draft: true, recommended: true, prestige: 1, qm: { unlocked: true, on: false } }), ctx(feats(30, 1), { nav, shop: { cat: 'elements', tree }, live: { buyAll: true, boonChip: true } })]);
    }
    for (const d of allHints()) for (const [u, c] of states) {
      const t = d.step(u, c)?.text;
      if (t) expect(t.split(/\s+/).length, `${d.id}: ${t}`).toBeLessThanOrEqual(HINT_LABEL_MAX_WORDS);
    }
  });
  it('registerHint adds (or replaces) a hint in priority order', () => {
    registerHint({ id: 'test-x', prio: 1, kind: 'event', when: () => true, step: () => ({ target: 'x', final: true }) });
    expect(nextHint(ui(), ctx(feats(0)))?.id).toBe('test-x');
    registerHint({ id: 'test-x', prio: 1, kind: 'event', when: () => false, step: () => ({ target: 'x', final: true }) });
    expect(allHints().filter((d) => d.id === 'test-x')).toHaveLength(1);
    expect(nextHint(ui(), ctx(feats(0)))).toBeNull();
  });
});
