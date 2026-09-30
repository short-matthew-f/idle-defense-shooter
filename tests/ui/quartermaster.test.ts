import { describe, expect, it } from 'vitest';
import { QM_EXPLAIN, QM_RESERVE_CHOICES, QM_TEASER, qmReserveLabel, qmSummary } from '../../src/ui/quartermaster';
import { QM_RESERVES } from '../../src/sim/directives/quartermaster';

describe('Quartermaster card (pure parts)', () => {
  it('offers exactly the reserves the sim accepts', () => {
    expect([...QM_RESERVE_CHOICES]).toEqual([...QM_RESERVES]);
  });
  it('says what it does in one plain line, and when it unlocks', () => {
    expect(QM_EXPLAIN).toBe('Keeps your repeatable stats topped up. It never makes choices for you.');
    expect(QM_TEASER).toBe('Unlocks after your first Prestige');
  });
  it('summarizes the run', () => {
    expect(qmSummary({ on: false, boughtThisRun: 0, scrapSpentThisRun: 0 })).toMatch(/Off/);
    expect(qmSummary({ on: true, boughtThisRun: 0, scrapSpentThisRun: 0 })).toMatch(/Nothing bought yet/);
    expect(qmSummary({ on: true, boughtThisRun: 1, scrapSpentThisRun: 950 })).toBe('Bought 1 rank this run · 950 Scrap');
    expect(qmSummary({ on: true, boughtThisRun: 12, scrapSpentThisRun: 3456 })).toBe('Bought 12 ranks this run · 3.4K Scrap');
    expect(qmReserveLabel(0)).toMatch(/all spare/);
    expect(qmReserveLabel(50)).toMatch(/50%/);
  });
});
