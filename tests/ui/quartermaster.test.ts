import { describe, expect, it } from 'vitest';
import { QM_BUYS_WHEN, QM_EXPLAIN, QM_IDLE, QM_SHARE_CHOICES, QM_TEASER, qmShareLabel, qmSummary } from '../../src/ui/quartermaster';
import { qmBankChip } from '../../src/ui/hud';
import { QM_SHARES } from '../../src/sim/directives/quartermaster';
import type { QuartermasterUi } from '../../src/sim/core/types';

const ui = (over: Partial<QuartermasterUi>): QuartermasterUi => ({
  unlocked: true, on: true, share: 50, bank: 0, idle: false, trees: [], order: [], boughtThisRun: 0, scrapSpentThisRun: 0, ...over,
});

describe('Quartermaster card (pure parts)', () => {
  it('offers exactly the shares the sim accepts', () => {
    expect([...QM_SHARE_CHOICES]).toEqual([...QM_SHARES]);
  });
  it('says what it does in plain lines, and when it unlocks', () => {
    expect(QM_EXPLAIN).toBe('It banks a share of everything you earn and spends only that. Your own Scrap is never touched. It never makes choices for you.');
    expect(QM_TEASER).toBe('Unlocks after your first Prestige');
    expect(QM_IDLE).toBe('Nothing left to buy: all your income is yours');
    expect(QM_BUYS_WHEN).toBe('Buys when it can afford the cheapest enabled stat');
  });
  it('labels the share and summarizes the run', () => {
    expect(qmShareLabel(50)).toBe('Quartermaster takes 50% of new Scrap');
    expect(qmShareLabel(10)).toBe('Quartermaster takes 10% of new Scrap');
    expect(qmShareLabel(100)).toBe('Quartermaster takes all new Scrap');
    expect(qmSummary({ on: false, boughtThisRun: 0, scrapSpentThisRun: 0 })).toMatch(/Off/);
    expect(qmSummary({ on: true, boughtThisRun: 0, scrapSpentThisRun: 0 })).toMatch(/Nothing bought yet/);
    expect(qmSummary({ on: true, boughtThisRun: 1, scrapSpentThisRun: 950 })).toBe('Bought 1 rank this run · 950 Scrap');
    expect(qmSummary({ on: true, boughtThisRun: 12, scrapSpentThisRun: 3456 })).toBe('Bought 12 ranks this run · 3,456 Scrap');
  });
  it('the HUD bank chip shows only while it is unlocked, on and holding Scrap', () => {
    expect(qmBankChip(ui({ bank: 3456 }))).toBe('3.4K');
    expect(qmBankChip(ui({ bank: 0 }))).toBeNull();
    expect(qmBankChip(ui({ bank: 0.4 }))).toBeNull();
    expect(qmBankChip(ui({ bank: 500, on: false }))).toBeNull();
    expect(qmBankChip(ui({ bank: 500, unlocked: false }))).toBeNull();
    expect(qmBankChip(undefined)).toBeNull();
  });
});
