import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { Ev } from '../../src/sim/core/types';
import { computeForecast, forecastRecommends, isRecommended, sampleRate } from '../../src/sim/economy/forecast';
import { codexHints, codexMultiplier } from '../../src/sim/economy/codex';
import { combatTick } from '../core/helpers';
import { calmSim } from './helpers';

/** History sampled at each checkpoint with the given Echo rates (per hour). */
function history(rates: [wave: number, rate: number][]): { seconds: number; echoes: number; wave: number }[] {
  return rates.map(([wave, rate]) => { const seconds = wave * 120; return { seconds, echoes: (rate * seconds) / 3600, wave }; });
}

describe('Prestige Forecast', () => {
  it('recommends once the rate sits ≥15% below its peak for a full checkpoint cycle', () => {
    const base: [number, number][] = [[20, 100], [25, 130], [30, 150]];
    expect(isRecommended(history(base), 30)).toBe(false);
    const h1 = history([...base, [35, 127]]);
    expect(sampleRate(h1[3])).toBeLessThan(0.85 * 150);
    expect(isRecommended(h1, 35)).toBe(false);                        // below for 0 waves
    expect(isRecommended(history([...base, [35, 127], [40, 126]]), 40)).toBe(true);
    expect(isRecommended(history([...base, [35, 140], [40, 136]]), 40)).toBe(false);   // only ~10% below
    expect(isRecommended(history([...base, [35, 127], [40, 140]]), 40)).toBe(false);   // recovered
    expect(isRecommended(history([[10, 100], [15, 80], [19, 60]]), 19)).toBe(false);   // before wave 20
  });

  it('fills UiState.forecast from simulated time and records', () => {
    const sim = new Sim(null, 5);
    const w = sim.world;
    w.meta.codex = {};
    w.run.deepestCleared = 30; w.run.playSeconds = 3600;
    const f = computeForecast(w);
    expect(f.echoesNow).toBe(61);
    expect(f.echoRate).toBeCloseTo(61, 6);
    expect(f.nextBossEchoes).toBe(Math.floor(10 * 1.2 ** 15));
    expect(f.reclimbSeconds).toBeCloseTo(0.35 * 3600, 6);
    w.meta.lastRunCheckpointSeconds = [0, 0, 0, 0, 0, 0, 2000];
    expect(computeForecast(w).reclimbSeconds).toBeCloseTo(600, 6);
    const ui = sim.uiState();
    expect(ui.forecast).not.toBeNull();
    expect(ui.forecast!.echoesNow).toBe(61);
    // Directive probe
    w.run.echoRateHistory = history([[20, 100], [25, 130], [30, 150], [35, 127], [40, 126]]);
    w.run.deepestCleared = 40;
    w.run.playSeconds = 40 * 120;              // current rate would be a new peak
    expect(forecastRecommends(w)).toBe(false);
    w.run.playSeconds = 40000;                 // current rate far below the wave-30 peak
    expect(forecastRecommends(w)).toBe(true);
    expect(computeForecast(w).recommended).toBe(true);
  });

  it('samples the Echo rate at checkpoints and every 60 s of play', () => {
    const sim = new Sim(null, 6);
    const w = sim.world;
    sim.run(60 * 60 + 2);
    expect(w.run.echoRateHistory.length).toBeGreaterThanOrEqual(1);
    w.emit(Ev.Checkpoint, 'run', 5, 1, 0, 0, -1);
    sim.step();
    expect(w.run.checkpointSeconds?.[1]).toBeGreaterThan(0);
  });
});

describe('Chain Codex', () => {
  it('registers a Fusion src and a 3-link chain, and the bonus applies', () => {
    const sim = calmSim();
    const w = sim.world;
    const pow = w.stats.get('combat.power_mul'), scrap = w.stats.get('economy.scrap_mul');
    w.emit(Ev.Fusion, 'fusion.plasma', 0, 0, 0, 0, -1);
    const e = w.spawnEnemy('grunt', 100, 0, { cause: -1 });
    const a = w.emit(Ev.Hit, 'ballistics', e, 1, 100, 0, -1);
    const b = w.emit(Ev.StatusApply, 'burn', e, 1, 100, 0, a);
    w.damage(e, 1e9, { source: 'fusion', srcTag: 'fusion.thermal_shock', cause: b });
    combatTick(sim);
    expect(w.meta.codex['fusion.plasma']).toBe(1);
    expect(w.meta.codex['chain.3']).toBe(1);
    expect(sim.events.recent(0).some((ev) => ev.type === Ev.Codex && ev.src === 'fusion.plasma')).toBe(true);
    const n = Object.keys(w.meta.codex).length;
    expect(codexMultiplier(w.meta)).toBeCloseTo(1 + 0.0025 * n, 9);
    expect(w.stats.get('combat.power_mul')).toBeCloseTo(pow * (1 + 0.0025 * n), 9);
    expect(w.stats.get('economy.scrap_mul')).toBeCloseTo(scrap * (1 + 0.0025 * n), 9);
    // registered once
    w.emit(Ev.Fusion, 'fusion.plasma', 0, 0, 0, 0, -1);
    combatTick(sim);
    expect(sim.events.recent(0).filter((ev) => ev.type === Ev.Codex && ev.src === 'fusion.plasma').length).toBe(1);
  });

  it('hints at undiscovered interactions near the build; milestones unlock palettes', () => {
    const sim = calmSim();
    const w = sim.world;
    w.build.attunements.push('lightning', 'frost');
    w.rebuildStats();
    expect(codexHints(w).some((h) => h.includes('lightning meets a frozen enemy'))).toBe(true);
    for (let k = 0; k < 10; k++) w.emit(Ev.Anomaly, `anomaly.test_${k}`, 0, 0, 0, 0, -1);
    combatTick(sim);
    expect(w.meta.palettes).toContain('palette.10');
  });
});
