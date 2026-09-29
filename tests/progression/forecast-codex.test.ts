import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { Ev } from '../../src/sim/core/types';
import { computeForecast, forecastRecommends, isRecommended, sampleRate } from '../../src/sim/economy/forecast';
import { codexHints, codexMultiplier, FIRING_ANOMALIES } from '../../src/sim/economy/codex';
import { ANOMALIES, BOSSES, CHASSIS_LINKAGES, FUSIONS, INFUSIONS, TRIADS, WEAPON_LINKAGES } from '../../src/sim/data/index';
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

  it('recommends at a real wall: no waves cleared, but a checkpoint cycle of play time below the peak', () => {
    // peak at wave 30 after 3600 s; then stuck on wave 30 while time passes
    const h = [{ seconds: 3000, echoes: 30, wave: 25 }, { seconds: 3600, echoes: 61, wave: 30 }];
    const at = (s: number) => [...h, { seconds: 3600 + 700, echoes: 61, wave: 30 }, { seconds: s, echoes: 61, wave: 30 }];
    expect(isRecommended(at(4400), 30, 600)).toBe(false);    // below since 4300 s: only 100 s
    expect(isRecommended(at(4900), 30, 600)).toBe(true);     // 600 s below the peak with no progress
    expect(isRecommended(at(4900), 30, 1200)).toBe(false);   // a longer checkpoint cycle waits longer
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

  it('peakRate is the peak of the curve it is drawn with (UX review S5)', () => {
    const sim = new Sim(null, 7);
    const w = sim.world;
    w.meta.codex = {};
    // samples up to 3600 s, then the current point sets a new peak (the case the review saw: 34.6K vs 25K)
    w.run.echoRateHistory = history([[20, 100], [25, 130], [30, 150]]);
    w.run.deepestCleared = 40; w.run.playSeconds = 4000;
    let f = computeForecast(w);
    expect(f.echoRate).toBeGreaterThan(150);
    expect(f.peakRate).toBe(Math.max(...f.curve.map((c) => c.rate)));
    expect(f.curve[f.curve.length - 1]).toEqual({ seconds: 4000, rate: f.echoRate });
    // and when an older sample is the peak
    w.run.playSeconds = 40000;
    f = computeForecast(w);
    expect(f.peakRate).toBe(Math.max(...f.curve.map((c) => c.rate)));
    expect(f.peakRate).toBeCloseTo(150, 6);
    // a live run
    const live = new Sim(null, 8);
    live.run(3 * 60 * 60);
    const g = live.uiState().forecast!;
    expect(g.curve.length).toBeGreaterThan(0);
    expect(g.peakRate).toBe(Math.max(...g.curve.map((c) => c.rate)));
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

  it('keeps hints whenever the build can reach an undiscovered entry (UX review S6)', () => {
    const sim = calmSim();
    const w = sim.world;
    // the wave-62 shape the review played: full slots, three Anomalies, every Fusion / Linkage / chain found
    w.build.hardpoints.push('ordnance', 'drones', 'laser');
    w.build.attunements.push('fire', 'lightning', 'frost');
    w.build.anomalies.push('loaded_dice', 'cold_iron', 'tithe');
    w.run.deepestCleared = 62;
    w.rebuildStats();
    const all: string[] = [
      ...FUSIONS.map((f) => f.node.id), ...TRIADS.map((t) => t.node.id), ...WEAPON_LINKAGES.map((l) => l.node.id),
      ...CHASSIS_LINKAGES.map((l) => l.node.id), ...INFUSIONS.map((i) => i.node.id), ...ANOMALIES.map((a) => `anomaly.${a.id}`),
      ...BOSSES.map((b) => `counter.boss.${b.id}`), 'chain.3', 'chain.5', 'chain.8', 'chain.12',
    ];
    const only = (missing: string[]): string[] => {
      w.meta.codex = {};
      for (const id of all) if (!missing.includes(id)) w.meta.codex[id] = 1;
      return codexHints(w);
    };
    // what the review saw: Fusions, weapon Linkages and chains all found, the rest open → hints now appear
    w.meta.codex = {};
    for (const id of [...FUSIONS.map((f) => f.node.id), ...WEAPON_LINKAGES.map((l) => l.node.id), 'chain.3', 'chain.5', 'chain.8', 'chain.12']) w.meta.codex[id] = 1;
    expect(codexHints(w).length).toBeGreaterThan(0);
    expect(only([])).toEqual([]);
    expect(only(['infuse.ordnance.fire'])).toEqual(['The missiles could carry fire.']);
    expect(only(['chassis.bastion+laser']).length).toBe(1);
    expect(only(['anomaly.loaded_dice'])).toEqual(['Loaded Dice has not shown what it can do yet.']);
    expect(only(['counter.boss.chronophage'])[0]).toMatch(/^The Chronophage can be answered/);
    expect(only(['link.ordnance+drones']).length).toBe(1);
    expect(only(['chain.12'])[0]).toMatch(/12 different things/);
    // out of reach: a stat-shaped Anomaly never fires, a boss not yet met, a system not mounted
    expect(only(['anomaly.cold_iron'])).toEqual([]);
    expect(only(['counter.boss.crown'])).toEqual([]);
    expect(only(['infuse.blade.fire'])).toEqual(['An element can ride a weapon system.']);   // generic group fallback
    // the UI's counter id is accepted too
    w.meta.codex = {}; for (const id of all) w.meta.codex[id] = 1;
    delete w.meta.codex['counter.boss.breaker']; w.meta.codex['counter.breaker'] = 1;
    expect(codexHints(w)).toEqual([]);
    // nothing in reach but entries remain: fall back to the nearest group
    const fresh = calmSim(2).world;
    fresh.build.abilities = [null, null];
    fresh.meta.codex = {}; for (const b of BOSSES) fresh.meta.codex[`counter.boss.${b.id}`] = 1;
    fresh.meta.codex['chain.3'] = fresh.meta.codex['chain.5'] = fresh.meta.codex['chain.8'] = fresh.meta.codex['chain.12'] = 1;
    expect(codexHints(fresh).length).toBeGreaterThan(0);
    expect(codexHints(fresh).length).toBeLessThanOrEqual(3);
    // every Anomaly the hints name really exists
    for (const id of FIRING_ANOMALIES) expect(ANOMALIES.some((a) => a.id === id)).toBe(true);
  });
});
