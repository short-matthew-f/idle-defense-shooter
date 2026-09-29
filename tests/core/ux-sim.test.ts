/**
 * Sim-side follow-ups from the UX review (docs/reviews/UX-REVIEW.md S1–S3, S9) and the wave-100 gate
 * (docs/reviews/CODE-HEALTH.md M2).
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { Ev, INSTANCE_FLOATS, RETICLE_MARK, Shape } from '../../src/sim/core/types';
import { DEFAULT_ABILITIES } from '../../src/sim/run/state';
import { PHASE_TICKS } from '../../src/sim/run/machine';
import { strongSim, runUntil, quietSim } from './helpers';

/** Layer-7 reticle instances in the current snapshot: [x, y, radius][]. */
function reticles(sim: Sim): [number, number, number][] {
  const s = sim.snapshot(), out: [number, number, number][] = [];
  for (let i = 0; i < s.instanceCount; i++) {
    const o = i * INSTANCE_FLOATS, f = s.instances;
    if (f[o + 9] === 7 && f[o + 4] === Shape.Ring && f[o + 11] === RETICLE_MARK) out.push([f[o], f[o + 1], f[o + 2]]);
  }
  return out;
}

describe('S1: designation reticle in the snapshot', () => {
  it('marks each live designated enemy (gen-checked) and Hunter-marked enemies, and nothing else', () => {
    const sim = quietSim(11);
    const w = sim.world;
    const a = w.spawnEnemy('brute', 200, 0, { cause: -1 });
    const b = w.spawnEnemy('grunt', -150, 40, { elite: ['hardened'], cause: -1 });
    w.spawnEnemy('grunt', 0, 300, { cause: -1 });
    expect(reticles(sim)).toEqual([]);
    w.tower.designated = a; w.tower.designatedGen = w.enemies.gen[a];
    w.tower.designated2 = b; w.tower.designated2Gen = w.enemies.gen[b];
    const r = reticles(sim);
    expect(r.length).toBe(2);
    expect(r[0][0]).toBeCloseTo(200); expect(r[0][2]).toBeGreaterThan(w.enemies.radius[a]);
    expect(r[1][0]).toBeCloseTo(-150);   // a designated elite is marked too (its outline colour is elite gold)
    // a stale generation (slot recycled) draws nothing
    w.tower.designatedGen = 999_999;
    expect(reticles(sim).length).toBe(1);
    // Hunter Mark (markedT) counts as marked
    w.enemies.markedT[2] = 60;
    expect(reticles(sim).length).toBe(2);
  });
});

describe('S2: drafts never auto-pick; the run continues and later drafts queue', () => {
  it('keeps the offer pending across waves, queues the next draft wave, and rerolls the pending wave', () => {
    const sim = strongSim(21);
    const run = sim.world.run;
    runUntil(sim, () => run.deepestCleared >= 10 && run.phase === 'between', 60 * 60 * 20);
    expect(run.pendingDraft?.length).toBe(3);
    expect(run.draftWave).toBe(10);
    const offersAt10 = [...run.pendingDraft!];
    // The run does not wait: waves keep clearing with the draft still pending.
    runUntil(sim, () => run.deepestCleared >= 20 && run.phase === 'between', 60 * 60 * 30);
    expect(run.pendingDraft).toEqual(offersAt10);
    expect(run.draftQueue).toEqual([20]);
    // Resolving the wave-10 draft brings up the wave-20 offer.
    sim.command({ type: 'pick_anomaly', anomaly: null });
    sim.step();
    expect(run.draftWave).toBe(20);
    expect(run.pendingDraft?.length).toBe(3);
    expect(run.draftQueue).toEqual([]);
    // A reroll re-rolls the pending wave's offer, not the current wave's.
    run.cores += 1;
    const before = [...run.pendingDraft!];
    sim.command({ type: 'reroll_anomaly' });
    sim.step();
    expect(run.draftWave).toBe(20);
    expect(run.pendingDraft).not.toEqual(before);
    sim.command({ type: 'pick_anomaly', anomaly: run.pendingDraft![0] });
    sim.step();
    expect(run.pendingDraft).toBeNull();
    expect(sim.world.build.anomalies.length).toBe(1);
  });
  it('a pending draft and its queue survive save and load', () => {
    const sim = strongSim(22);
    const run = sim.world.run;
    runUntil(sim, () => run.deepestCleared >= 20 && run.phase === 'between', 60 * 60 * 40);
    expect(run.pendingDraft?.length).toBe(3);
    const loaded = new Sim(sim.save());
    expect(loaded.world.run.pendingDraft).toEqual(run.pendingDraft);
    expect(loaded.world.run.draftWave).toBe(run.draftWave);
    expect(loaded.world.run.draftQueue).toEqual(run.draftQueue);
  });
});

describe('S3: what killed the tower', () => {
  it('TowerDeath names the killer and the attempt ledger records damage by source', () => {
    const sim = strongSim(13);
    const w = sim.world, run = w.run;
    runUntil(sim, () => run.phase === 'combat', 400);
    w.clearCombat();
    const brute = w.spawnEnemy('brute', 40, 0, { cause: -1 });
    w.damageTower(100, brute, -1);
    w.damageTower(30, -1, -1, 'hazard');
    w.damageTower(10, -1, -1, 'self');
    const taken = sim.uiState().run.attemptDamageTaken;
    expect(Object.keys(taken).sort()).toEqual(['brute', 'hazard', 'self']);
    expect(taken.brute).toBeGreaterThan(taken.hazard);
    const mark = sim.events.nextId;
    w.damageTower(1e12, brute, -1);
    sim.step();
    const death = sim.events.since(mark).find((e) => e.type === Ev.TowerDeath)!;
    expect(death.data).toEqual({ killer: 'brute' });
    expect(run.phase).toBe('dead');
    runUntil(sim, () => run.phase === 'between', 200);
    expect(sim.uiState().run.attemptDamageTaken).toEqual({});           // reset for the new attempt
    expect(w.towerKiller).toBeNull();
  });

  it('a boss kill carries the boss id and phase; hazards and self-damage are named', () => {
    const sim = strongSim(14);
    const w = sim.world, run = w.run;
    runUntil(sim, () => run.phase === 'combat', 400);
    w.clearCombat();
    const boss = w.spawnEnemy('boss', 60, 0, { bossId: 'breaker', cause: -1 });
    w.enemies.bossPhase[boss] = 1;
    let mark = sim.events.nextId;
    w.damageTower(1e12, boss, -1);
    sim.step();
    expect(sim.events.since(mark).find((e) => e.type === Ev.TowerDeath)!.data).toEqual({ killer: 'breaker', boss: true, bossPhase: 1 });
    expect(Object.keys(w.run.attemptDamageTaken)).toEqual(['boss']);      // still the dead attempt's ledger
    runUntil(sim, () => run.phase === 'combat', 400);
    mark = sim.events.nextId;
    w.damageTower(1e12, -1, -1, 'hazard');
    sim.step();
    expect(sim.events.since(mark).find((e) => e.type === Ev.TowerDeath)!.data).toEqual({ killer: 'hazard' });
  });
});

describe('S9: default tactical loadout', () => {
  it('new games start with Repulsor Pulse and Hunter Mark; saves keep their own slots', () => {
    const sim = new Sim(null, 15);
    expect(sim.world.build.abilities).toEqual(['repulsor_pulse', 'hunter_mark']);
    expect([...DEFAULT_ABILITIES]).toEqual(['repulsor_pulse', 'hunter_mark']);
    expect(sim.uiState().abilities.map((a) => a.id)).toEqual(['repulsor_pulse', 'hunter_mark']);
    const save = sim.save();
    save.run.build.abilities = [null, null];
    expect(new Sim(save).world.build.abilities).toEqual([null, null]);
    save.run.build.abilities = ['emp', null];
    expect(new Sim(save).world.build.abilities).toEqual(['emp', null]);
  });
});

describe('M2: the wave-100 gate (Deep Waves open at Ascension V)', () => {
  /** Put the run on wave 100 (checkpoint 95) and clear it without fighting. */
  function clearWave100(sim: Sim): void {
    const w = sim.world, run = w.run, m = sim.machine;
    run.checkpoint = 95; run.deepestCleared = 99;
    m.startAttempt(false);
    run.wave = 100;
    m.startWave();
    w.clearCombat();
    m.cursor = w.wave!.spawns.length;
    sim.step();
    expect(run.phase).toBe('wave_clear');
    expect(run.deepestCleared).toBe(100);
    expect(run.checkpoint).toBe(100);
    runUntil(sim, () => run.phase === 'draft' || run.phase === 'between', 200);
    if (run.phase === 'draft') sim.command({ type: 'pick_anomaly', anomaly: null });
    runUntil(sim, () => run.phase === 'between', 10);
  }

  it('before Ascension V: holds at wave 100 in between, Patrol loops 96–99, and Ascend still works', () => {
    const sim = strongSim(16);
    const w = sim.world, run = w.run;
    w.stats.override('ballistics.damage', 1e10);   // wave-96 enemies die in one shot
    w.rebuildStats();
    clearWave100(sim);
    expect(run.wave).toBe(100);
    sim.run(20 * 60);                                   // far longer than the 2 s between phase
    expect(run.phase).toBe('between');
    expect(run.wave).toBe(100);
    expect(sim.uiState().run.deepestCleared).toBe(100);  // the HUD / Constellation Ascend prompt keys on this
    // a restart comes back to the same place, never to 101
    sim.command({ type: 'restart_checkpoint' });
    sim.run(5 * 60);
    expect(run.wave).toBe(100); expect(run.phase).toBe('between');
    // Patrol loops the last non-boss cycle below the gate
    sim.command({ type: 'set_mode', mode: 'patrol' });
    const seen = new Set<number>();
    for (let t = 0; t < 6 * 3600 && seen.size < 4; t++) { sim.step(); if (run.phase === 'combat') seen.add(run.wave); }
    expect([...seen].sort()).toEqual([96, 97, 98, 99]);
    expect(run.checkpoint).toBe(100);
    // Ascend pays and starts Ascension I at wave 1
    sim.command({ type: 'ascend' });
    sim.step();
    expect(w.meta.ascension).toBe(1);
    expect(w.run.wave).toBe(1);
  });

  it('from Ascension V: wave 101 follows wave 100', () => {
    const sim = strongSim(17);
    sim.world.meta.ascension = 5;
    clearWave100(sim);
    expect(sim.world.run.wave).toBe(101);
    runUntil(sim, () => sim.world.run.phase === 'combat', 400);
    expect(sim.world.run.wave).toBe(101);
  });
});
