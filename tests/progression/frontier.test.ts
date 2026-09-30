import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import {
  echoDepthWave, echoesFor, frontierFor, frontierHpMul, FRONTIER_FIRST, FRONTIER_GROWTH, FRONTIER_STEP,
} from '../../src/sim/economy/curves';
import { frontierWave, lifetimeEchoes, prestigeNodePrice } from '../../src/sim/economy/prestige';
import { generateWave } from '../../src/sim/enemies/generator';
import { AC_PRICES } from '../../src/sim/data/prestige';
import { growth } from '../../src/sim/math/lut';
import { cmd } from './helpers';

// Onboarding pass (docs/BALANCE.md "Onboarding pass (first Prestige at wave ~28)").
describe('the Frontier', () => {
  it('sits at wave 28 before any Echoes, then STEP waves past the depth lifetime Echoes are worth', () => {
    expect(frontierFor(0)).toBe(FRONTIER_FIRST);
    expect(frontierFor(9)).toBe(FRONTIER_FIRST);
    expect(frontierFor(10)).toBe(20 + FRONTIER_STEP);   // one wave-20 payout
    expect(Math.round(echoDepthWave(echoesFor(28)))).toBe(28);
    expect(frontierFor(echoesFor(28))).toBe(28 + FRONTIER_STEP);
    expect(frontierFor(echoesFor(28) + echoesFor(38))).toBe(39 + FRONTIER_STEP);
    expect(frontierFor(1e12)).toBeGreaterThan(110);
  });

  it('hardens only waves past it, ×FRONTIER_GROWTH per wave', () => {
    expect(frontierHpMul(28, 28)).toBe(1);
    expect(frontierHpMul(10, 28)).toBe(1);
    expect(frontierHpMul(29, 28)).toBeCloseTo(FRONTIER_GROWTH, 9);
    expect(frontierHpMul(31, 28)).toBeCloseTo(growth(FRONTIER_GROWTH, 3), 6);
  });

  it('the generator scales every spawn (boss included) past the Frontier, and nothing without one', () => {
    for (const wave of [27, 29, 30]) {
      const plain = generateWave(123, wave, 0, 0);
      const front = generateWave(123, wave, 0, 0, { frontier: 28 });
      expect(front.spawns.length).toBe(plain.spawns.length);
      const mul = frontierHpMul(wave, 28);
      for (let i = 0; i < plain.spawns.length; i++) expect(front.spawns[i].hpScale).toBeCloseTo(plain.spawns[i].hpScale * mul, 9);
    }
  });

  it('lifetime Echoes count the bank plus everything spent, so spending never moves the Frontier', () => {
    const sim = new Sim(null, 5);
    const w = sim.world, meta = w.meta;
    meta.deepestEver = 30; meta.echoes = 42;
    expect(lifetimeEchoes(meta)).toBe(42);
    expect(frontierWave(meta)).toBe(38);
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.scrap_resonance' })).toBeNull();
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.hardened_core' })).toBeNull();
    expect(meta.echoes).toBe(22);
    expect(lifetimeEchoes(meta)).toBe(42);
    expect(frontierWave(meta)).toBe(38);
  });

  it('the machine hardens the live wave past the Frontier (fresh game: wave 28)', () => {
    const at = (wave: number, echoes: number): number => {
      const sim = new Sim(null, 11);
      const w = sim.world;
      w.meta.echoes = echoes;
      w.run.wave = wave; w.run.deepestCleared = wave - 1; w.run.checkpoint = Math.floor((wave - 1) / 5) * 5;
      sim.machine.startWave();
      return w.wave!.spawns.reduce((a, s) => a + s.hpScale, 0) / w.wave!.spawns.length;
    };
    expect(at(29, 0) / at(29, 1e9)).toBeCloseTo(FRONTIER_GROWTH, 6);
    expect(at(27, 0) / at(27, 1e9)).toBeCloseTo(1, 9);
  });
});

describe('first-Prestige Echo shop', () => {
  it('Accelerated Clearing is a flat ladder: rank 1 is a first-Prestige pick, ×4 / ×8 are late sinks', () => {
    const sim = new Sim(null, 2);
    const meta = sim.world.meta;
    meta.deepestEver = 28; meta.echoes = echoesFor(28);
    expect(prestigeNodePrice(meta, 'prestige.accelerated_clearing')).toBe(AC_PRICES[0]);
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.accelerated_clearing' })).toBeNull();
    expect(prestigeNodePrice(meta, 'prestige.accelerated_clearing')).toBe(AC_PRICES[1]);
    expect(AC_PRICES[1]).toBeGreaterThan(echoesFor(38) * 3);
  });

  it('a first Prestige (42 Echoes at wave 28) affords 3–6 layer-I picks', () => {
    const sim = new Sim(null, 2);
    const meta = sim.world.meta;
    meta.deepestEver = 28; meta.echoes = echoesFor(28);
    let picks = 0;
    for (let guard = 0; guard < 20; guard++) {
      let best: string | null = null, bestCost = Infinity;
      for (const id of ['prestige.seed_capital', 'prestige.memory_of_steel', 'prestige.memory_of_motion', 'prestige.accelerated_clearing',
        'prestige.boss_bounty', 'prestige.checkpoint_dividend', 'prestige.scrap_resonance', 'prestige.hardened_core']) {
        const c = prestigeNodePrice(meta, id)!;
        if (c <= meta.echoes && c < bestCost) { best = id; bestCost = c; }
      }
      if (!best) break;
      expect(cmd(sim, { type: 'buy_prestige', node: best })).toBeNull();
      picks++;
    }
    expect(picks).toBeGreaterThanOrEqual(3);
    expect(picks).toBeLessThanOrEqual(6);
  });

  it('Seed Capital / Memory bought before the run clears a wave apply to it at once (not in a Trial)', () => {
    const sim = new Sim(null, 4);
    const w = sim.world, meta = w.meta;
    meta.deepestEver = 28; meta.echoes = 100;
    const scrap0 = w.run.scrap;
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.seed_capital' })).toBeNull();
    expect(w.run.scrap).toBe(scrap0 + 400);
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.memory_of_steel' })).toBeNull();
    expect(w.build.ranks['ballistics.damage']).toBe(1);
    // once a wave is cleared, new ranks wait for the next Prestige
    w.run.deepestCleared = 1;
    const scrap1 = w.run.scrap;
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.seed_capital' })).toBeNull();
    expect(w.run.scrap).toBe(scrap1);
  });
});
