import { describe, it, expect } from 'vitest';
import { Ev } from '../../src/sim/core/types';
import { quietSim, combatTick } from './helpers';
import type { Sim } from '../../src/sim/index';

function line(sim: Sim, n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(sim.world.spawnEnemy('grunt', 80 + k * 30, 0, { hpScale: 1000 }));
  return out;
}
function hitsOn(sim: Sim, idx: number): number { return sim.world.events.recent(0).filter((e) => e.type === Ev.Hit && e.a === idx && e.src === 'ballistics').length; }

describe('Ballistics', () => {
  it('fires ~attack_speed shots per second at the nearest enemy', () => {
    const sim = quietSim();
    line(sim, 1);
    let shots = 0;
    const orig = sim.world.spawnProjectile.bind(sim.world);
    sim.world.spawnProjectile = (i) => { shots++; return orig(i); };
    for (let t = 0; t < 600; t++) combatTick(sim);
    expect(shots).toBeGreaterThanOrEqual(19);
    expect(shots).toBeLessThanOrEqual(21);
  });

  it('Piercing sends one shot through a column; Multishot fires a fan', () => {
    const sim = quietSim();
    const w = sim.world;
    w.build.doctrines.ballistics = 'piercing';
    w.build.ranks['ballistics.piercing.count'] = 2;
    w.rebuildStats();
    const [a, b, c] = line(sim, 3);
    for (let t = 0; t < 50; t++) combatTick(sim);   // first shot at ~30 ticks; one volley only
    expect(hitsOn(sim, a)).toBeGreaterThan(0);
    expect(hitsOn(sim, b)).toBeGreaterThan(0);
    expect(hitsOn(sim, c)).toBeGreaterThan(0);

    const s2 = quietSim();
    s2.world.build.doctrines.ballistics = 'multishot';
    s2.world.build.ranks['ballistics.multishot.count'] = 2;
    s2.world.rebuildStats();
    line(s2, 1);
    let shots = 0;
    const orig = s2.world.spawnProjectile.bind(s2.world);
    s2.world.spawnProjectile = (i) => { shots++; return orig(i); };
    for (let t = 0; t < 600; t++) combatTick(s2);
    expect(shots).toBeGreaterThanOrEqual(19 * 3);
  });

  it('Heavy Rounds fire slower and knock enemies back', () => {
    const sim = quietSim();
    const w = sim.world;
    w.build.doctrines.ballistics = 'heavy_rounds';
    w.rebuildStats();
    const [a] = line(sim, 1);
    let shots = 0;
    const orig = w.spawnProjectile.bind(w);
    w.spawnProjectile = (i) => { shots++; return orig(i); };
    const x0 = w.enemies.x[a];
    for (let t = 0; t < 600; t++) combatTick(sim);
    expect(shots).toBeGreaterThanOrEqual(11);
    expect(shots).toBeLessThanOrEqual(13);
    expect(w.enemies.x[0]).toBeGreaterThan(x0 + 50);
  });

  it('manual aim fires in the given direction even with no target', () => {
    const sim = quietSim();
    sim.world.tower.manualAim = true; sim.world.tower.manualAngle = Math.PI / 2;
    for (let t = 0; t < 60; t++) combatTick(sim);
    const p = sim.world.projectiles;
    expect(p.count).toBeGreaterThan(0);
    expect(p.vy[0]).toBeGreaterThan(Math.abs(p.vx[0]));
  });
});
