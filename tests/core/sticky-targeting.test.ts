import { describe, it, expect } from 'vitest';
import { quietSim } from './helpers';
import { NO_ENTITY } from '../../src/sim/core/types';

/** Two enemies at (nearly) the same distance must not make the turret flip-flop. */
describe('sticky targeting', () => {
  it('keeps the current target when the alternative is not materially closer', () => {
    const sim = quietSim(3);
    const w = sim.world;
    const a = w.spawnEnemy('grunt', 200, 0);
    const b = w.spawnEnemy('grunt', -200, 0.5);   // effectively equidistant
    w.rebuildSpatial();
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary')).toBe(a);           // no memory: lower index wins
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary', b)).toBe(b);        // memory of b: keep b
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary', a)).toBe(a);
    // jitter the distances slightly: still sticky
    w.enemies.x[a] = 196; w.rebuildSpatial();
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary', b)).toBe(b);
    // a materially closer enemy (20%+) does take over
    w.enemies.x[a] = 150; w.rebuildSpatial();
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary', b)).toBe(a);
  });
  it('drops a remembered target that died or left range, and always prefers the designated enemy', () => {
    const sim = quietSim(4);
    const w = sim.world;
    const a = w.spawnEnemy('grunt', 100, 0);
    const b = w.spawnEnemy('grunt', 0, 100);
    w.rebuildSpatial();
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary', b)).toBe(b);
    w.enemies.x[b] = 0; w.enemies.y[b] = 900; w.rebuildSpatial();            // out of range → switch
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary', b)).toBe(a);
    w.enemies.y[b] = 100; w.rebuildSpatial();
    w.tower.designated = a; w.tower.designatedGen = w.enemies.gen[a];
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary', b)).toBe(a);      // designator wins over memory
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary', NO_ENTITY)).toBe(a);
  });
  it('the primary weapon holds one target across ticks with equidistant enemies', () => {
    const sim = quietSim(5);
    const w = sim.world;
    w.stats.override('ballistics.damage', 0.001); w.rebuildStats();          // never kills, so targets persist
    for (let i = 0; i < 6; i++) w.spawnEnemy('grunt', 250 * Math.cos(i), 250 * Math.sin(i));
    w.run.phase = 'combat';
    let changes = 0, last = -1;
    for (let t = 0; t < 240; t++) {
      sim.step();
      const aim = w.tower.aimAngle;
      const q = Math.round(aim * 100);
      if (last >= 0 && Math.abs(q - last) > 2 && t > 60) changes++;   // after settling, the aim must not jump
      last = q;
    }
    expect(changes).toBeLessThanOrEqual(2);
  });
});
