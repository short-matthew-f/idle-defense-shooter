/**
 * UX Phase 1 (docs/reviews/HANDBOOK-EVAL.md), sim half: the boss-clear hold, ladder-aware offers, the boss-wave
 * stall rule (the boss steps in before anything Rushes) and the threshold the sim shares with the unlock ladder.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { EnemyFlag, Ev, TICK_RATE } from '../../src/sim/core/types';
import type { BoonId } from '../../src/sim/core/ids';
import { BOSS_HOLD_TICKS, PHASE_TICKS } from '../../src/sim/run/machine';
import { applyCommand } from '../../src/sim/run/commands';
import { validateCommand } from '../../src/sim/run/validate';
import { rollBoons } from '../../src/sim/run/boons';
import { rollDraft } from '../../src/sim/run/draft';
import { offerRevealed } from '../../src/sim/run/reveal';
import { BOONS } from '../../src/sim/data/boons';
import { ANOMALIES } from '../../src/sim/data/anomalies';
import { ABILITIES_REVEAL_PRESTIGE, ABILITIES_REVEAL_WAVE, CONTENT_POOL as SIM_POOL } from '../../src/sim/data/content-pool';
import { CONTENT_POOL as UI_POOL, UNLOCKS } from '../../src/ui/progression';
import { buildUiState } from '../../src/sim/core/ui-state';
import { strongSim, runUntil } from './helpers';

const MIN = 3600;

describe('boss-clear hold', () => {
  /** Strong tower, run until the wave-5 boss is cleared (its boon offer opens). */
  function atFirstBossClear(seed = 2): Sim {
    const sim = strongSim(seed);
    runUntil(sim, () => sim.world.run.deepestCleared >= 5, 12 * MIN);
    expect(sim.world.run.boonOffer?.length).toBe(3);
    return sim;
  }

  it('holds `between` while a decision is pending, capped at 15 s of sim time from the clear', () => {
    const sim = atFirstBossClear();
    const m = sim.machine, run = sim.world.run;
    expect(BOSS_HOLD_TICKS).toBe(15 * TICK_RATE);
    expect(m.holdTicksLeft).toBeGreaterThan(BOSS_HOLD_TICKS - 5);
    expect(buildUiState(sim.world, m).run.holdTicksLeft).toBe(m.holdTicksLeft);
    const ticks = runUntil(sim, () => run.phase === 'combat', 30 * TICK_RATE);
    expect(ticks).toBeGreaterThan(BOSS_HOLD_TICKS - 10);
    expect(ticks).toBeLessThanOrEqual(BOSS_HOLD_TICKS + 2);
    expect(m.holdTicksLeft).toBe(0);
    expect(run.boonOffer?.length).toBe(3);   // never auto-picked
    expect(sim.world.build.boons).toEqual([]);
  });

  it('release_hold ends it early (the offer stays pending); deciding ends it too', () => {
    const sim = atFirstBossClear(3);
    const m = sim.machine, run = sim.world.run;
    expect(validateCommand({ type: 'release_hold' })).toBeNull();
    sim.command({ type: 'release_hold' });
    sim.step();
    expect(m.holdTicksLeft).toBe(0);
    expect(run.boonOffer?.length).toBe(3);
    const t1 = runUntil(sim, () => run.phase === 'combat', 30 * TICK_RATE);
    expect(t1).toBeLessThanOrEqual(PHASE_TICKS.wave_clear + PHASE_TICKS.between + 2);

    const sim2 = atFirstBossClear(3);
    expect(applyCommand(sim2.machine, { type: 'decline_boon' })).toBeNull();
    sim2.step();
    expect(sim2.machine.holdTicksLeft).toBe(0);
  });

  it('an agent that decides at once spends no time held; Patrol and non-boss clears never hold', () => {
    const sim = strongSim(4);
    const run = sim.world.run;
    let held = 0;
    for (let n = 0; n < 15 * MIN && run.deepestCleared < 15; n++) {
      if (run.boonOffer?.length) applyCommand(sim.machine, { type: 'decline_boon' });
      if (run.pendingDraft?.length) applyCommand(sim.machine, { type: 'pick_anomaly', anomaly: null });
      sim.step();
      if (sim.machine.holdTicksLeft > 0) held++;
    }
    expect(run.deepestCleared).toBeGreaterThanOrEqual(15);
    expect(held).toBeLessThanOrEqual(3);   // at most the clear tick itself per boss (1/60 s); the next tick's decision ends it
    applyCommand(sim.machine, { type: 'set_mode', mode: 'patrol' });
    expect(sim.machine.holdTicksLeft).toBe(0);
  });
});

describe('ladder-aware offers', () => {
  const abilityBoons: BoonId[] = ['quick_hands', 'deep_reserves', 'reckless', 'overclocked'];
  const abilityAnomalies = ['overcharged_capacitor', 'second_opinion', 'feedback_loop'];

  it('the sim threshold and content pool are the unlock ladder\'s (one source)', () => {
    expect(UNLOCKS.abilities.wave).toBe(ABILITIES_REVEAL_WAVE);
    expect(UNLOCKS.abilities.prestige).toBe(ABILITIES_REVEAL_PRESTIGE);
    expect(UI_POOL).toBe(SIM_POOL);
  });

  it('CE / ability boons and anomalies carry the abilities gate', () => {
    for (const id of abilityBoons) expect(BOONS.find((b) => b.id === id)?.reveal).toContain('abilities');
    for (const id of abilityAnomalies) expect(ANOMALIES.find((a) => a.id === id)?.reveal).toContain('abilities');
  });

  it('before wave 12 (no Prestige) no offer or reroll names abilities / CE; afterwards they can appear', () => {
    const sim = new Sim(null, 7);
    const w = sim.world;
    w.run.boonsSeenFirst = true;
    w.meta.deepestEver = 11; w.run.deepestCleared = 11;
    const seen = new Set<string>();
    for (let r = 0; r < 300; r++) for (const id of rollBoons(w, 10, 1, r, 'boss', false)) seen.add(id);
    for (let r = 0; r < 300; r++) for (const id of rollDraft(w, 10, r)) seen.add(id);
    for (const id of [...abilityBoons, ...abilityAnomalies]) expect(seen.has(id), id).toBe(false);
    w.meta.deepestEver = 12;
    const later = new Set<string>();
    for (let r = 0; r < 300; r++) for (const id of rollBoons(w, 15, 1, r, 'boss', false)) later.add(id);
    expect(abilityBoons.some((id) => later.has(id))).toBe(true);
  });

  it('elements / hardpoints outside the content pool are never offered unless owned', () => {
    const sim = new Sim(null, 8);
    const w = sim.world;
    w.run.boonsSeenFirst = true;
    w.meta.deepestEver = 40; w.meta.prestigeCount = 0;
    const outside = (needs: readonly string[] = [], reveal: readonly string[] = []): boolean =>
      [...needs, ...reveal].some((n) => ((SIM_POOL.elements as Record<string, number>)[n] ?? (SIM_POOL.hardpoints as Record<string, number>)[n] ?? 0) > 0);
    const seen = new Set<string>();
    for (let r = 0; r < 300; r++) for (const id of rollBoons(w, 20, 1, r, 'boss', false)) seen.add(id);
    for (let r = 0; r < 300; r++) for (const id of rollDraft(w, 20, r)) seen.add(id);
    for (const b of BOONS) if (outside(b.needs, b.reveal)) expect(seen.has(b.id), b.id).toBe(false);
    for (const a of ANOMALIES) if (outside(a.needs, a.reveal)) expect(seen.has(a.id), a.id).toBe(false);
    expect(offerRevealed(w, { needs: ['frost'] })).toBe(false);
    w.meta.prestigeCount = 1;
    expect(offerRevealed(w, { needs: ['frost'] })).toBe(true);
    w.meta.prestigeCount = 0;
    w.build.attunements[0] = 'frost'; w.rebuildStats();   // owned: always offered
    expect(offerRevealed(w, { needs: ['frost'] })).toBe(true);
  });

  it('the boon "Overcharge" is named Hot Barrel (id unchanged)', () => {
    expect(BOONS.find((b) => b.id === 'overcharge')?.name).toBe('Hot Barrel');
  });
});

describe('boss-wave stall: the boss steps in before anything Rushes', () => {
  function bossStall(seed = 3): Sim {
    const sim = new Sim(null, seed);
    const w = sim.world;
    w.stats.override('bastion.max_hp', 1e15);
    w.stats.override('ballistics.damage', 0);   // nothing ever damages the boss
    w.rebuildStats();
    w.tower.hp = w.tower.maxHp;
    w.clearCombat();
    w.run.wave = 10; w.run.checkpoint = 5;
    sim.machine.startWave();
    expect(w.wave!.isBoss).toBe(true);
    return sim;
  }
  const bossIdx = (sim: Sim): number => sim.machine.boss();

  it('steps the boss in (boss-only Rush), then Rushes the wave only if it still makes no progress', () => {
    const sim = bossStall();
    const w = sim.world, e = w.enemies, st = sim.machine.stall;
    runUntil(sim, () => st.bossStepped, 5 * MIN);
    expect(st.bossStepped).toBe(true);
    expect(st.rushing).toBe(false);
    expect(st.stalled()).toBe('boss');
    expect(buildUiState(w, sim.machine).wave.stalled).toBe('boss');
    const b = bossIdx(sim);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(e.rushT[b]).toBeGreaterThan(0);
    for (let i = 0; i < e.count; i++) if (!(e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally | EnemyFlag.Boss))) expect(e.rushT[i]).toBe(0);   // no brood swarm
    let steps = 0;
    w.events.forEachSince(0, (ev) => { if (ev.type === Ev.Rush && ev.src === 'boss.step_in') steps++; });
    expect(steps).toBe(1);
    // the boss walks in toward contact
    const d0 = Math.hypot(e.x[b], e.y[b]);
    sim.run(12 * TICK_RATE);
    const b2 = bossIdx(sim);
    if (b2 >= 0) expect(Math.hypot(e.x[b2], e.y[b2])).toBeLessThan(Math.max(d0, 161));
    // still no progress: the whole wave Rushes (the guarantee that every wave ends)
    runUntil(sim, () => st.rushing || w.run.phase !== 'combat', 5 * MIN);
    expect(st.rushing || w.run.phase !== 'combat').toBe(true);
  }, 60_000);

  it('a non-boss wave still Rushes directly (unchanged)', () => {
    const sim = new Sim(null, 3);
    const w = sim.world, e = w.enemies;
    w.clearCombat(); w.wave = null;
    sim.machine.setPhase('combat');
    w.run.wave = 30;
    w.stats.override('bastion.max_hp', 1e15);
    w.stats.override('ballistics.damage', 0);
    w.stats.override('ballistics.range', 100);
    w.rebuildStats();
    const i = w.spawnEnemy('grunt', 480, 0, { cause: -1 });
    e.speed[i] = 0;
    sim.run(14 * TICK_RATE);
    expect(sim.machine.stall.rushing).toBe(true);
    expect(sim.machine.stall.bossStepped).toBe(false);
    expect(sim.machine.stall.stalled()).toBe('wave');
  });
});
