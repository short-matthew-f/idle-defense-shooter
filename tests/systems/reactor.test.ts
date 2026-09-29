import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { Ev } from '../../src/sim/core/types';
import type { ReactorSystem } from '../../src/sim/systems/reactor';
import { quietSim, setup, plugin, events, ticks, grunt } from './wp2-helpers';

const NO_GUN = { 'ballistics.range': 1 };

describe('Reactor', () => {
  it('Overdrive Core: every 30 s, 5 s of +50% speed for every system', () => {
    const sim = setup(quietSim(), { doctrines: { reactor: 'overclock' }, ranks: { 'reactor.overclock.overdrive_core': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const at = (t: number): number => { w.run.attemptTick = t; ticks(sim, 1); return w.dynamicSpeedMul; };
    expect(at(0)).toBe(1);
    expect(at(1799)).toBe(1);
    expect(at(1800)).toBeCloseTo(1.5, 9);
    expect(events(sim, (e) => e.type === Ev.Fx && e.src === 'reactor.overdrive_core').length).toBe(1);
    expect(at(2099)).toBeCloseTo(1.5, 9);
    expect(at(2100)).toBeCloseTo(1, 9);
    expect(at(3600 + 10)).toBeCloseTo(1.5, 9);
    expect(at(3600 + 400)).toBeCloseTo(1, 9);
  });

  it('Overdrive composes with other speed contributors and speeds up the primary', () => {
    const sim = setup(quietSim(), { doctrines: { reactor: 'overclock' }, ranks: { 'reactor.overclock.overdrive_core': 1 } });
    const w = sim.world;
    grunt(sim, 100, 0);
    const shots = (): number => events(sim, (e) => e.type === Ev.Hit && e.src === 'ballistics').length;
    w.run.attemptTick = 1800;
    const n0 = shots();
    for (let k = 0; k < 290; k++) { w.run.attemptTick = 1800 + k; ticks(sim, 1); }
    const fast = shots() - n0;
    const n1 = shots();
    for (let k = 0; k < 290; k++) { w.run.attemptTick = 2200 + k; ticks(sim, 1); }
    const slow = shots() - n1;
    expect(fast).toBeGreaterThan(slow);
  });

  it('Synchronization: two distinct systems within the window combo; Harmonic Lock at 4 systems', () => {
    const sim = setup(quietSim(), { doctrines: { reactor: 'synchronization' }, ranks: { 'reactor.sync.combo': 5, 'reactor.sync.harmonic_lock': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const i = grunt(sim, 300, 300);
    const hit = (source: 'primary' | 'blade' | 'laser' | 'drones', tag: string): number => w.damage(i, 100, { source, srcTag: tag, cause: -1 }).damage;
    const base = hit('primary', 'ballistics');
    expect(hit('primary', 'ballistics')).toBeCloseTo(base, 6);
    hit('blade', 'blade');
    expect(hit('primary', 'ballistics')).toBeCloseTo(base * 1.2, 4);       // 2 systems: +0.2 per extra system
    ticks(sim, 40);                                                          // window (0.5 s) expires
    expect(hit('primary', 'ballistics')).toBeCloseTo(base, 4);
    hit('blade', 'blade'); hit('laser', 'laser');
    expect(events(sim, (e) => e.src === 'reactor.harmonic_lock').length).toBe(0);
    hit('drones', 'drones');
    expect(events(sim, (e) => e.type === Ev.Fx && e.src === 'reactor.harmonic_lock').length).toBe(1);
    expect(hit('primary', 'ballistics')).toBeCloseTo(base * (1 + 0.2 * 3) * 1.5, 3);
    ticks(sim, 40);
    expect(hit('primary', 'ballistics')).toBeCloseTo(base * 1.5, 3);       // lock outlives the combo window
    ticks(sim, 181);
    expect(hit('primary', 'ballistics')).toBeCloseTo(base, 3);
  });

  it('Critical Mass: every system speeds up while many enemies are alive', () => {
    const sim = setup(quietSim(), { ranks: { 'reactor.critical_mass': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const r = plugin<ReactorSystem>(sim, 'reactor');
    for (let k = 0; k < 25; k++) grunt(sim, 300, -200 + k * 10);
    ticks(sim, 1);
    expect(w.dynamicSpeedMul).toBe(1);
    for (let k = 0; k < 5; k++) grunt(sim, -300, -200 + k * 10);
    ticks(sim, 1);
    expect(r.speedFactor).toBeCloseTo(1.1, 9);
    expect(w.dynamicSpeedMul).toBeCloseTo(1.1, 9);
    for (let k = 0; k < 40; k++) grunt(sim, -350, -200 + k * 10);
    ticks(sim, 1);
    expect(w.dynamicSpeedMul).toBeCloseTo(1.4, 9);                          // capped at +40%
  });

  it('Salvage: Boss Scavenging raises elite Scrap, Strip Mine sets ×4 first clears, Checkpoint Dividend pays once', () => {
    const kill = (salvage: boolean): number => {
      const sim = setup(quietSim(), salvage
        ? { doctrines: { reactor: 'salvage' }, ranks: { 'reactor.salvage.income': 1, 'reactor.salvage.boss_scavenging': 5 }, overrides: NO_GUN }
        : { overrides: NO_GUN });
      const w = sim.world;
      const i = w.spawnEnemy('grunt', 300, 300, { hpScale: 1, elite: ['hardened'] });
      const s0 = w.run.scrap;
      w.damage(i, 1e9, { source: 'ability', srcTag: 'x', cause: -1, trueDamage: true });
      return w.run.scrap - s0;
    };
    expect(kill(true) / kill(false)).toBeCloseTo(1.35 * 1.5, 4);
    const sim = setup(quietSim(), { doctrines: { reactor: 'salvage' }, ranks: { 'reactor.salvage.income': 1, 'reactor.salvage.strip_mine': 1, 'reactor.salvage.checkpoint_dividend': 1 }, overrides: NO_GUN });
    const w = sim.world;
    expect(w.stats.get('economy.first_clear_mul')).toBe(4);
    const r = plugin<ReactorSystem>(sim, 'reactor');
    w.run.wave = 5; w.run.checkpoint = 5; w.waveScrap = 200;
    const cp = w.emit(Ev.Checkpoint, 'run', 5, 1, 0, 0, -1);
    const s0 = w.run.scrap;
    r.onWaveEnd(w);
    expect(w.run.scrap - s0).toBeCloseTo(100, 6);
    const div = events(sim, (e) => e.type === Ev.ScrapGain && e.src === 'reactor.checkpoint_dividend')[0];
    expect(div.cause).toBe(cp);
    r.onWaveEnd(w);
    expect(w.run.scrap - s0).toBeCloseTo(100, 6);                           // first reach only
  });

  it('Command: Capacitor Array raises the CE cap after a rebuild; Energy Recycling resolves', () => {
    const sim = setup(quietSim(), { doctrines: { reactor: 'command' }, ranks: { 'reactor.command.ce_cap': 2, 'reactor.energy_recycling': 2 } });
    expect(sim.world.tower.ceCap).toBe(120);
    expect(sim.world.stats.get('reactor.energy_recycling')).toBeCloseTo(0.1, 9);
  });

  it('determinism: two fresh Sims with each Reactor doctrine and Critical Mass hash identically', () => {
    for (const d of ['overclock', 'salvage', 'synchronization', 'command'] as const) {
      const run = (): number => {
        const sim = new Sim(null, 31);
        setup(sim, { doctrines: { reactor: d }, ranks: {
          'reactor.overclock.overdrive_core': 1, 'reactor.salvage.income': 1, 'reactor.salvage.checkpoint_dividend': 1, 'reactor.sync.combo': 5,
          'reactor.sync.harmonic_lock': 1, 'reactor.command.ce_cap': 2, 'reactor.critical_mass': 1 }, overrides: { 'bastion.max_hp': 1e7 } });
        sim.world.run.checkpoint = 15; sim.machine.startAttempt(false);
        sim.run(2400);
        return sim.events.hash();
      };
      expect(run()).toBe(run());
    }
  });
});
