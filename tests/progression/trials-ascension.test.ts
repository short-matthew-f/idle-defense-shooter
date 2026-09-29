import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import type { Command } from '../../src/sim/core/types';
import { hardpointCap } from '../../src/sim/run/slots';
import { updateSlots } from '../../src/sim/run/slots';
import { trialWave } from '../../src/sim/run/trials';
import { generateWave } from '../../src/sim/enemies/generator';
import { starsFor } from '../../src/sim/economy/curves';
import { strongSim, runUntil } from '../core/helpers';
import { cmd } from './helpers';

describe('Trials', () => {
  it('need the Trials node; start parks the main run and end restores it exactly', () => {
    const sim = strongSim(21);
    const w = sim.world;
    expect(cmd(sim, { type: 'start_trial', trial: 'bare_metal' })).toMatch(/locked/);
    w.meta.prestigeRanks['prestige.trials'] = 1;
    runUntil(sim, () => w.run.deepestCleared >= 6, 12 * 3600);
    cmd(sim, { type: 'restart_checkpoint' });
    const before = JSON.stringify(sim.save().run);
    expect(cmd(sim, { type: 'start_trial', trial: 'bare_metal' })).toBeNull();
    expect(w.trial).toBe('bare_metal');
    expect(w.meta.parkedRun).toBeDefined();
    expect(w.run.wave).toBe(1);
    expect(w.run.deepestCleared).toBe(0);
    expect(cmd(sim, { type: 'start_trial', trial: 'poverty' })).toMatch(/already/);
    expect(cmd(sim, { type: 'prestige', frame: 'standard' })).toMatch(/Trial/);
    sim.run(900);
    expect(cmd(sim, { type: 'end_trial' })).toBeNull();
    expect(w.trial).toBeNull();
    expect(w.meta.parkedRun).toBeUndefined();
    expect(JSON.stringify(sim.save().run)).toBe(before);
    expect(cmd(sim, { type: 'end_trial' })).toMatch(/No Trial/);
  });

  it('Bare Metal caps hardpoints at 0; reaching wave 30 completes tier 1 and unlocks Monolith', () => {
    const sim = new Sim(null, 4);
    const w = sim.world;
    w.meta.prestigeRanks['prestige.trials'] = 1;
    cmd(sim, { type: 'start_trial', trial: 'bare_metal' });
    expect(hardpointCap(w)).toBe(0);
    w.run.deepestCleared = 80;
    updateSlots(w);
    expect(w.run.hardpointSlotsOpen).toBe(0);
    expect(cmd(sim, { type: 'mount_hardpoint', slot: 0, system: 'drones' })).not.toBeNull();
    sim.step();
    expect(w.meta.trials.bare_metal).toBe(2);
    expect(w.meta.unlockedFrames).toContain('monolith');
  });

  it('Pacifist Core: weapons deal no damage; statuses do', () => {
    const sim = new Sim(null, 4);
    const w = sim.world;
    w.meta.prestigeRanks['prestige.trials'] = 1;
    cmd(sim, { type: 'start_trial', trial: 'pacifist_core' });
    const e = w.spawnEnemy('grunt', 100, 0, { cause: -1 });
    const hp = w.enemies.hp[e];
    w.damage(e, 5, { source: 'primary', srcTag: 'ballistics', cause: -1 });
    w.damage(e, 5, { source: 'ordnance', srcTag: 'ordnance', cause: -1 });
    expect(w.enemies.hp[e]).toBe(hp);
    w.damage(e, 5, { source: 'status', srcTag: 'burn', cause: -1 });
    expect(w.enemies.hp[e]).toBeLessThan(hp);
  });

  it('Hive Mind disables the primary; Monochrome caps attunements at 1; Swarmstorm ×5 at 20% HP; Poverty −75%', () => {
    const sim = new Sim(null, 4);
    const w = sim.world;
    w.meta.prestigeRanks['prestige.trials'] = 1;
    const scrap = w.stats.get('economy.scrap_mul');
    cmd(sim, { type: 'start_trial', trial: 'hive_mind' });
    expect(w.stats.mounted('primary')).toBe(false);
    expect(cmd(sim, { type: 'mount_hardpoint', slot: 0, system: 'laser' })).toMatch(/Trial/);
    cmd(sim, { type: 'end_trial' });
    expect(w.stats.mounted('primary')).toBe(true);
    cmd(sim, { type: 'start_trial', trial: 'monochrome' });
    w.run.deepestCleared = 50; updateSlots(w);
    expect(w.run.attunementSlotsOpen).toBe(1);
    cmd(sim, { type: 'end_trial' });
    cmd(sim, { type: 'start_trial', trial: 'swarmstorm' });
    const base = generateWave(w.run.prestigeSeed, 7, 0, 0);
    const swarm = trialWave(w, base);
    expect(swarm.spawns.length).toBe(base.spawns.length * 5);
    expect(swarm.spawns[0].hpScale).toBeCloseTo(base.spawns[0].hpScale * 0.2, 9);
    cmd(sim, { type: 'end_trial' });
    cmd(sim, { type: 'start_trial', trial: 'poverty' });
    expect(w.stats.get('economy.scrap_mul')).toBeCloseTo(scrap * 0.25, 9);
  });
});

describe('Ascension and the Constellation', () => {
  it('pays Stars, resets the run, keeps Echoes, unlocks Echo Engine and a socket', () => {
    const sim = new Sim(null, 9);
    const w = sim.world;
    w.meta.echoes = 500;
    w.run.deepestCleared = 99;
    expect(cmd(sim, { type: 'ascend' })).toMatch(/100/);
    w.run.deepestCleared = 100; w.run.scrap = 1e6; w.build.anomalies.push('tithe');
    expect(cmd(sim, { type: 'ascend' })).toBeNull();
    expect(w.meta.stars).toBe(starsFor(100, 0));
    expect(w.meta.ascension).toBe(1);
    expect(w.meta.echoes).toBe(500);
    expect(w.run.wave).toBe(1);
    expect(w.run.scrap).toBe(0);
    expect(w.build.anomalies).toEqual([]);
    expect(w.build.anomalySockets).toBe(4);
    expect(w.meta.unlockedFrames).toContain('echo_engine');
    expect(cmd(sim, { type: 'prestige', frame: 'echo_engine' })).toBeNull();
    expect(w.build.frame).toBe('echo_engine');
  });

  it('buy_star needs both majors before a bridge; respec refunds on the next Ascension', () => {
    const sim = new Sim(null, 9);
    const w = sim.world;
    w.meta.stars = 30;
    expect(cmd(sim, { type: 'buy_star', node: 'star.major.primary' })).toMatch(/Ascension 1/);
    w.meta.ascension = 1;
    expect(cmd(sim, { type: 'buy_star', node: 'star.bridge.primary+laser' })).toMatch(/Requires/);
    expect(cmd(sim, { type: 'buy_star', node: 'star.major.primary' })).toBeNull();
    expect(cmd(sim, { type: 'buy_star', node: 'star.bridge.primary+laser' })).toMatch(/Requires/);
    expect(cmd(sim, { type: 'buy_star', node: 'star.major.laser' })).toBeNull();
    expect(cmd(sim, { type: 'buy_star', node: 'star.bridge.primary+laser' })).toBeNull();
    expect(w.meta.stars).toBe(30 - 2 - 2 - 10);
    expect(w.stats.get('star.bridge.primary+laser')).toBe(1);
    w.run.deepestCleared = 100;
    cmd(sim, { type: 'ascend' });
    expect(w.meta.constellation).toEqual({});
    expect(w.meta.stars).toBe(30 + starsFor(100, 1));
    expect(w.meta.ascension).toBe(2);
  });
});

describe('Progression determinism', () => {
  function play(seed: number): Sim {
    const sim = strongSim(seed);
    sim.world.meta.echoes = 200;
    const script = (t: number): Command[] => {
      if (t === 10) return [{ type: 'buy_prestige', node: 'prestige.seed_capital' }];
      if (t === 2500) return [{ type: 'prestige', frame: 'standard' }];
      if (t === 2600) return [{ type: 'buy', node: 'ballistics.damage' }];
      return [];
    };
    for (let t = 0; t < 5000; t++) {
      if (t === 5) sim.world.meta.deepestEver = 25;
      for (const c of script(t)) sim.command(c);
      sim.step();
    }
    return sim;
  }
  it('two Sims through a Prestige with the same commands → identical hashes', () => {
    const a = play(31), b = play(31);
    expect(a.world.meta.prestigeCount).toBe(1);
    expect(a.events.hash()).toBe(b.events.hash());
    expect(a.world.run.prestigeSeed).toBe(b.world.run.prestigeSeed);
    expect(JSON.stringify(a.save())).toBe(JSON.stringify(b.save()));
  });
});
