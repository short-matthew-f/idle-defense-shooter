/** UX Phase 2 item 5: the Prestige decision (verdict, summary, the one suggested first pick). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sim } from '../../src/sim/index';
import { importString } from '../../src/sim/save/serialize';
import type { UiState } from '../../src/sim/core/types';
import { prestigeSummary, prestigeVerdict } from '../../src/ui/prestige';
import { echoGuidePicks, echoGuideSuggested, echoGuideSuggestedText } from '../../src/ui/ceremony';

const fc = (o: Partial<NonNullable<UiState['forecast']>>): Pick<UiState, 'forecast' | 'run'> => ({
  forecast: { echoesNow: 43, echoRate: 118, peakRate: 118, nextBossEchoes: 55, nextBossRate: 120, reclimbSeconds: 0, wallGaugeSeconds: null, recommended: false, curve: [], frontier: 28, nextFrontier: 38, ...o },
  run: { deepestCleared: 28, playSeconds: 1308 } as UiState['run'],
});

describe('prestigeVerdict', () => {
  it('recommended: leads with "Recommended now", the next boss and the Frontier move', () => {
    expect(prestigeVerdict(fc({ recommended: true }))).toEqual({ recommended: true, headline: 'Recommended now', nextBoss: 'Next boss (wave 30): +12 Echoes', frontier: 'Frontier: wave 28 → 38', bossWave: 30 });
  });
  it('not yet: "Waiting ~N min likely adds +X Echoes" from the next-boss rate', () => {
    // 55 Echoes at 120/h → reached at 1650 s of play; now 1308 s → ~6 min
    expect(prestigeVerdict(fc({})).headline).toBe('Waiting ~6 min likely adds +12 Echoes');
    expect(prestigeVerdict({ forecast: null, run: { deepestCleared: 3, playSeconds: 9 } as UiState['run'] }).headline).toBe('No Forecast yet');
  });
  it("the owner's save: the verdict and Frontier line come from the live Forecast", () => {
    const sim = new Sim(importString(readFileSync(join(__dirname, '../fixtures/owner-save-w28.txt'), 'utf8').trim()), 1);
    const v = prestigeVerdict(sim.uiState());
    expect(v.frontier).toBe('Frontier: wave 28 → 38');
    expect(v.recommended).toBe(false);
    expect(v.headline).toMatch(/^Waiting ~\d+ min likely adds \+\d+ Echoes$/);
  });
});

describe('prestigeSummary', () => {
  it('names every choice the modal shows', () => {
    expect(prestigeSummary({ echoes: 400, frame: 'Arsenal', keepsake: null, dial: 2, discount: 'Ballistics', dual: true })).toBe(
      'You gain 400 Echoes and start over at wave 1 with the Arsenal Frame. Keepsake: none (every Anomaly is lost). Threat Dial: level 2. Branch Discount: Ballistics −25%. Dual Doctrine: available on the first tree you give a second Doctrine.');
    expect(prestigeSummary({ echoes: 5, frame: 'Standard' })).toBe('You gain 5 Echoes and start over at wave 1 with the Standard Frame.');
  });
});

describe('Echo guide: one suggested pick', () => {
  it('suggests the affordable behaviour-changing pick (Accelerated Clearing) while every affordable pick stays listed', () => {
    const meta = { deepestEver: 28, echoes: 43, prestigeRanks: {} } as unknown as UiState['meta'];
    const picks = echoGuidePicks({ meta });
    expect(picks.length).toBeGreaterThan(1);
    expect(echoGuideSuggested({ meta })).toBe('prestige.accelerated_clearing');
    expect(echoGuideSuggestedText({ meta })).toBe('Suggested: Accelerated Clearing');
    // once it is owned the suggestion falls to the cheapest stat pick
    const after = { ...meta, echoes: 33, prestigeRanks: { 'prestige.accelerated_clearing': 1 } } as unknown as UiState['meta'];
    expect(echoGuideSuggested({ meta: after })).toBe('prestige.seed_capital');
    expect(echoGuideSuggested({ meta: { ...meta, echoes: 0 } })).toBeNull();
  });
});
