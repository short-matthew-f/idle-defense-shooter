import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sim } from '../../src/sim/index';
import { importString, toSave } from '../../src/sim/save/serialize';
import { FRONTIER_FLAT, frontierRecommends, forecastRecommends } from '../../src/sim/economy/forecast';

// UX Phase 2 item 5 / BALANCE.md "Forecast at the Frontier": the rate rule lags the Frontier wall by minutes.
describe('Forecast: the Frontier rule', () => {
  it('recommends after a death past the Frontier, or once the Frontier is cleared and the rate stops rising', () => {
    expect(frontierRecommends(28, 29, 28, 100, 100)).toBe(true);           // died past it
    expect(frontierRecommends(28, 28, 28, 100, 100)).toBe(false);          // died ON it, rate still at its peak
    expect(frontierRecommends(28, 0, 28, 100 * (1 - FRONTIER_FLAT) - 0.01, 100)).toBe(true);   // cleared it, rate flat
    expect(frontierRecommends(27, 0, 28, 50, 100)).toBe(false);            // not there yet
    expect(frontierRecommends(19, 30, 18, 50, 100)).toBe(false);           // never before wave 20
    expect(frontierRecommends(40, 41, undefined, 50, 100)).toBe(false);    // Trials have no Frontier
  });

  it("the owner's save (deepest 28 = Frontier, 21.8 min) is not yet recommended on load, and is after the wall", () => {
    const save = importString(readFileSync(join(__dirname, '../fixtures/owner-save-w28.txt'), 'utf8').trim());
    const sim = new Sim(save, 1);
    const f0 = sim.uiState().forecast!;
    expect(f0.frontier).toBe(28);
    expect(sim.world.run.deepestCleared).toBe(28);
    expect(f0.recommended).toBe(false);
    let died = false;
    for (let i = 0; i < 60 * 60 * 10 && !died; i++) { sim.step(); died = sim.world.run.phase === 'dead'; }
    expect(died).toBe(true);
    expect(sim.world.run.deepestDeath).toBeGreaterThanOrEqual(28);
    expect(sim.uiState().forecast!.recommended).toBe(true);
    expect(forecastRecommends(sim.world)).toBe(true);
    // a death strictly past the Frontier alone is enough (whatever the rate does)
    sim.world.run.deepestDeath = 29;
    expect(sim.uiState().forecast!.recommended).toBe(true);
    // saved and restored
    expect(toSave(sim).run.deepestDeath).toBe(29);
  });
});
