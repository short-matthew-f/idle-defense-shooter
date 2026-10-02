import { describe, expect, it } from 'vitest';
import { GAIN_FLASH_GAP_MS, coresRevealed, echoesAfter, flashKind, qmBank, walletCurrencies, walletFigure, type WalletState } from '../../src/ui/wallet';
import { allFeatures, features } from '../../src/ui/progression';

const state = (o: { scrap?: number; cores?: number; echoes?: number; stars?: number; qm?: WalletState['quartermaster'] } = {}): WalletState => ({
  run: { scrap: o.scrap ?? 1234, cores: o.cores ?? 0 },
  meta: { echoes: o.echoes ?? 0, stars: o.stars ?? 0 },
  quartermaster: o.qm,
});
const ALL = allFeatures();
/** Stage 1 (first boss cleared): tab bar and Upgrades, no Cores / Prestige yet. */
const EARLY = features({ run: { deepestCleared: 5 }, meta: { deepestEver: 5, prestigeCount: 0 } });

describe('wallet: which balances a screen shows', () => {
  it('Upgrades shows Scrap; Cores join once there are any, or on the Cores category', () => {
    expect(walletCurrencies({ tab: 'upgrades', shopCat: 'chassis' }, state(), ALL)).toEqual(['scrap']);
    expect(walletCurrencies({ tab: 'upgrades', shopCat: 'chassis' }, state({ cores: 2 }), ALL)).toEqual(['scrap', 'cores']);
    expect(walletCurrencies({ tab: 'upgrades', shopCat: 'cores' }, state({ cores: 0 }), ALL)).toEqual(['scrap', 'cores']);
  });
  it('progressive reveal: no Cores before they matter, no Echoes or Stars before the Prestige tab', () => {
    expect(EARLY.cores || EARLY.boons || EARLY.prestigeTab).toBe(false);
    expect(coresRevealed(state(), EARLY)).toBe(false);
    expect(walletCurrencies({ tab: 'upgrades', shopCat: 'chassis' }, state(), EARLY)).toEqual(['scrap']);
    // the first boss drops a Core: it shows (as on the HUD)
    expect(walletCurrencies({ tab: 'upgrades', shopCat: 'chassis' }, state({ cores: 1 }), EARLY)).toEqual(['scrap', 'cores']);
    expect(walletCurrencies({ tab: 'build' }, state(), EARLY)).toEqual([]);
    expect(walletCurrencies({ tab: 'prestige', prestigeSeg: 'layers' }, state({ echoes: 50 }), EARLY)).toEqual([]);
  });
  it('Build shows Cores; Prestige shows Echoes (and Stars on Ascension); More only on Automation', () => {
    expect(walletCurrencies({ tab: 'build' }, state(), ALL)).toEqual(['cores']);
    expect(walletCurrencies({ tab: 'prestige', prestigeSeg: 'forecast' }, state(), ALL)).toEqual(['echoes']);
    expect(walletCurrencies({ tab: 'prestige', prestigeSeg: 'layers' }, state(), ALL)).toEqual(['echoes']);
    expect(walletCurrencies({ tab: 'prestige', prestigeSeg: 'ascension' }, state(), ALL)).toEqual(['echoes', 'stars']);
    expect(walletCurrencies({ tab: 'more', sub: 'automation' }, state(), ALL)).toEqual(['scrap']);
    expect(walletCurrencies({ tab: 'more', sub: 'automation' }, state(), { ...ALL, automation: false })).toEqual([]);
    expect(walletCurrencies({ tab: 'more', sub: null }, state(), ALL)).toEqual([]);
    expect(walletCurrencies({ tab: 'more', sub: 'settings' }, state(), ALL)).toEqual([]);
    expect(walletCurrencies({ tab: 'battle' }, state(), ALL)).toEqual([]);
    expect(walletCurrencies({ tab: null }, state(), ALL)).toEqual([]);
  });
});

describe('wallet: figures', () => {
  it('is exact below a million (a small buy visibly changes it), then formats like the HUD (fmtNum)', () => {
    const f = walletFigure(state({ scrap: 1234.7 }), 'scrap');
    expect(f.text).toBe('1,234');
    expect(f.exact).toBe('1,234');
    expect(f.label).toBe('1,234 Scrap');
    expect(walletFigure(state({ scrap: 52345 }), 'scrap').text).not.toBe(walletFigure(state({ scrap: 52333 }), 'scrap').text);
    expect(walletFigure(state({ scrap: 999999.9 }), 'scrap').text).toBe('999,999');
    expect(walletFigure(state({ scrap: 1234567 }), 'scrap').text).toBe('1.2M');
    expect(walletFigure(state({ cores: 1 }), 'cores').label).toBe('1 Core');
    expect(walletFigure(state({ cores: 12 }), 'cores').label).toBe('12 Cores');
    expect(walletFigure(state({ echoes: 3.4e6 }), 'echoes').text).toBe('3.4M');
    expect(walletFigure(state({ stars: 1 }), 'stars').label).toBe('1 Star');
  });
  it('shows the Quartermaster bank beside Scrap only while it is on', () => {
    const on = state({ scrap: 1234, qm: { unlocked: true, on: true, bank: 321 } });
    expect(qmBank(on)).toBe(321);
    expect(walletFigure(on, 'scrap').bankText).toBe('QM 321');
    expect(walletFigure(on, 'scrap').label).toBe('1,234 Scrap, Quartermaster bank 321');
    expect(walletFigure(on, 'cores').bank).toBeNull();
    expect(qmBank(state({ qm: { unlocked: true, on: false, bank: 321 } }))).toBeNull();
    expect(qmBank(state({ qm: { unlocked: true, on: true } }))).toBeNull();   // a sim without the bank field
    expect(qmBank(state())).toBeNull();
  });
  it('the Prestige dialogs say what the player keeps', () => {
    expect(echoesAfter(45)(state({ echoes: 120 }))).toBe('+45 → 165 after this Prestige');
    expect(echoesAfter(61)(state({ echoes: 3000 }))).toBe('+61 → 3,061 after this Prestige');   // never rounded away
    expect(echoesAfter(0)(state({ echoes: 120 }))).toBe('');
  });
});

describe('wallet: change flash', () => {
  it('flashes amber on any spend and green on news, never on the Scrap trickle', () => {
    expect(flashKind(null, 10, 'scrap')).toBeNull();
    expect(flashKind(10, 10, 'scrap')).toBeNull();
    expect(flashKind(1000, 990, 'scrap')).toBe('spend');
    expect(flashKind(3, 2, 'cores')).toBe('spend');
    expect(flashKind(1000, 1020, 'scrap')).toBeNull();             // 2%: income
    expect(flashKind(1000, 1500, 'scrap')).toBe('gain');           // a refund, an offline credit
    expect(flashKind(0, 3, 'scrap')).toBe('gain');
    expect(flashKind(2, 3, 'cores')).toBe('gain');                  // every Core is news
    expect(flashKind(2, 3, 'cores', GAIN_FLASH_GAP_MS - 1)).toBeNull();   // not twice in a row
    expect(flashKind(5, 4, 'echoes', 0)).toBe('spend');             // a spend always shows
  });
});
