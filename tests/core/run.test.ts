import { describe, it, expect } from 'vitest';
import { Ev } from '../../src/sim/core/types';
import { strongSim, runUntil } from './helpers';
import { patrolEstimate, PATROL_ESTIMATE_CLEARS } from '../../src/sim/run/machine';
import { offlineScrap } from '../../src/sim/economy/curves';

const MIN = 3600;

describe('run state machine', () => {
  it('clears waves 1–6, sets checkpoint 5, and restarts at wave 6 on death', () => {
    const sim = strongSim(1);
    const run = sim.world.run;
    runUntil(sim, () => run.deepestCleared >= 6, 12 * MIN);
    expect(run.deepestCleared).toBeGreaterThanOrEqual(6);
    expect(run.checkpoint).toBe(5);
    expect(sim.events.recent(0).some((e) => e.type === Ev.Checkpoint && e.a === 5) || run.checkpoint === 5).toBe(true);
    expect(run.cores).toBeGreaterThanOrEqual(1);                   // boss first kill paid a Core
    // die during wave 7
    runUntil(sim, () => run.phase === 'combat' && run.wave === 7, 2 * MIN);
    expect(run.wave).toBe(7);
    const attempts = run.attempts;
    sim.world.damageTower(1e12, -1, -1);
    sim.step();
    expect(run.phase).toBe('dead');
    runUntil(sim, () => run.phase === 'between', 200);
    expect(run.wave).toBe(6);
    expect(run.attempts).toBe(attempts + 1);
    expect(sim.world.tower.hp).toBe(sim.world.tower.maxHp);
    expect(sim.world.tower.ce).toBe(0);
    expect(sim.world.enemies.count).toBe(0);
  });

  it('pays the first-clear ×3 bonus only once per wave', () => {
    const sim = strongSim(2);
    const run = sim.world.run;
    runUntil(sim, () => run.deepestCleared >= 1, 4 * MIN);
    const first = sim.events.recent(0).find((e) => e.type === Ev.ScrapGain && e.a === 1)!;
    expect(first.src).toBe('first_clear');
    // die on wave 2 → replay wave 1 (checkpoint 0)
    runUntil(sim, () => run.phase === 'combat' && run.wave === 2, MIN);
    sim.world.damageTower(1e12, -1, -1);
    runUntil(sim, () => run.wave === 1 && run.phase === 'combat', 400);
    const mark = sim.events.nextId;
    runUntil(sim, () => run.phase === 'wave_clear', 4 * MIN);
    const replay = sim.events.since(mark).find((e) => e.type === Ev.ScrapGain && e.a === 1)!;
    expect(replay.src).toBe('wave');
    expect(first.b / replay.b).toBeCloseTo(3, 3);
  });

  it('Patrol loops checkpoint+1..checkpoint+4 and never runs a boss wave', () => {
    const sim = strongSim(3);
    const run = sim.world.run;
    runUntil(sim, () => run.checkpoint === 5 && run.phase === 'between', 12 * MIN);
    expect(run.checkpoint).toBe(5);
    sim.command({ type: 'set_mode', mode: 'patrol' });
    const seen = new Set<number>();
    let bossSeen = false, loops = 0, prev = run.wave;
    for (let t = 0; t < 20 * MIN; t++) {
      sim.step();
      if (run.phase === 'combat') { seen.add(run.wave); if (run.wave % 5 === 0 || sim.world.wave?.isBoss) bossSeen = true; }
      if (run.wave < prev) loops++;
      prev = run.wave;
    }
    expect(bossSeen).toBe(false);
    expect([...seen].every((w) => w >= 6 && w <= 9)).toBe(true);
    expect(loops).toBeGreaterThanOrEqual(1);
    expect(run.checkpoint).toBe(5);
    expect(run.patrolScrapPerSecond).toBeGreaterThan(0);
    expect(run.patrolMeasured).toBe(true);
    // offline return pays patrol rate × time × 40%
    const scrap = run.scrap;
    sim.command({ type: 'offline_return', elapsedSeconds: 3600 });
    sim.step();
    expect(run.scrap - scrap).toBeGreaterThanOrEqual(Math.floor(run.patrolScrapPerSecond * 3600 * 0.4) - 1);
    // a measured Patrol rate is not overwritten by later Push clears (and survives a save)
    const measured = run.patrolScrapPerSecond;
    sim.command({ type: 'set_mode', mode: 'push' });
    runUntil(sim, () => run.deepestCleared >= 11, 12 * MIN);
    expect(run.patrolScrapPerSecond).toBe(measured);
    expect(sim.save().run.patrolMeasured).toBe(true);
  });

  it('estimates the Patrol rate from recent Push clears for players who never Patrol (UX review S7)', () => {
    const sim = strongSim(6);
    const run = sim.world.run;
    runUntil(sim, () => run.deepestCleared >= 1 && run.phase !== 'combat', 4 * MIN);
    const wave1Rate = run.patrolScrapPerSecond;
    expect(wave1Rate).toBeGreaterThan(0);
    runUntil(sim, () => run.deepestCleared >= 13, 20 * MIN);
    expect(run.patrolMeasured).toBeFalsy();
    const log = run.recentClears!;
    expect(log.length).toBe(PATROL_ESTIMATE_CLEARS);
    expect(log.every((c) => c.wave % 5 !== 0 && c.scrap > 0 && c.seconds > 0)).toBe(true);
    expect(log.map((c) => c.wave)).toEqual([9, 11, 12, 13]);           // the most recent non-boss clears
    expect(run.patrolScrapPerSecond).toBeCloseTo(patrolEstimate(log), 9);
    // it follows progress instead of freezing at the first clear (the review saw 1.13/s at wave 62)
    expect(run.patrolScrapPerSecond).toBeGreaterThan(wave1Rate * 1.5);
    // replays are not first clears: the ×3 first-clear bonus is taken out of the estimate
    const wave13 = sim.events.recent(0).filter((e) => e.type === Ev.ScrapGain && e.a === 13).pop()!;
    expect(wave13.src).toBe('first_clear');
    expect(log[3].scrap).toBeCloseTo(wave13.b / sim.world.stats.get('economy.first_clear_mul'), 6);
    // offline pays at most 40% of that rate and never clears a boss
    const scrap = run.scrap, cp = run.checkpoint, deepest = run.deepestCleared;
    sim.command({ type: 'offline_return', elapsedSeconds: 3600 });
    sim.step();
    const paid = run.scrap - scrap;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBe(offlineScrap(run.patrolScrapPerSecond, 3600, false));
    expect(paid).toBeLessThanOrEqual(run.patrolScrapPerSecond * 3600 * 0.4 + 1);
    expect(run.checkpoint).toBe(cp);
    expect(run.deepestCleared).toBe(deepest);
  });

  it('switching to Patrol on a boss wave returns to checkpoint+1 without an attempt', () => {
    const sim = strongSim(4);
    const run = sim.world.run;
    runUntil(sim, () => run.wave === 5 && run.phase === 'combat', 10 * MIN);
    const attempts = run.attempts;
    sim.command({ type: 'set_mode', mode: 'patrol' });
    sim.step();
    expect(run.wave).toBe(1);
    expect(run.attempts).toBe(attempts);
  });

  it('opens the first attunement slot at wave 5 and validates commands', () => {
    const sim = strongSim(5);
    const run = sim.world.run;
    runUntil(sim, () => run.deepestCleared >= 5, 10 * MIN);
    expect(run.attunementSlotsOpen).toBe(1);
    expect(run.hardpointSlotsOpen).toBe(0);
    sim.command({ type: 'attune', slot: 0, element: 'fire' });
    sim.command({ type: 'mount_hardpoint', slot: 0, system: 'drones' });
    sim.step();
    expect(sim.world.build.attunements[0]).toBe('fire');
    expect(sim.world.build.hardpoints.length).toBe(0);
    expect(sim.machine.lastError).toMatch(/not open/);
    sim.command({ type: 'set_threat_dial', level: 3 });
    sim.step();
    expect(run.threatDial).toBe(0);
  });
});
