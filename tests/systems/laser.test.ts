import { describe, it, expect } from 'vitest';
import { Ev } from '../../src/sim/core/types';
import { hpSim, rankTree, ring, ticks, share, evs, fxCount, setRanks, hitDamage } from './hardpoint-helpers';

/** Laser sim with a fixed (non-rotating) polygon: node k at angle k·2π/n. */
function fixedLaser(extra: Record<string, number> = {}) {
  const sim = hpSim(['laser']);
  sim.world.stats.override('laser.rotation', 0);
  setRanks(sim, extra);
  return sim;
}

describe('Laser Polygon', () => {
  it('two nodes join one beam that damages enemies it crosses', () => {
    const sim = fixedLaser();
    const w = sim.world;
    const on = w.spawnEnemy('grunt', 40, 0, { hpScale: 1000 });
    const off = w.spawnEnemy('grunt', 0, 60, { hpScale: 1000 });
    ticks(sim, 120);
    expect(w.shared.laserNodeCount).toBe(2);
    expect(w.shared.laserBeamCount).toBe(1);
    expect(hitDamage(sim, 'laser', on)).toBeGreaterThan(0);
    expect(hitDamage(sim, 'laser', off)).toBe(0);
    expect(share(sim, 'laser')).toBeGreaterThan(0);
  });

  it('more nodes form a ring polygon with an interior', () => {
    const sim = fixedLaser({ 'laser.nodes': 3 });
    ticks(sim, 2);
    const sh = sim.world.shared;
    expect(sh.laserNodeCount).toBe(5);
    expect(sh.laserBeamCount).toBe(5);
    expect(sh.laserInterior).toBeGreaterThan(50);
  });

  it('Refractor: the beam stops at it and it takes 70% less beam damage', () => {
    const sim = fixedLaser();
    const w = sim.world;
    const behind = w.spawnEnemy('grunt', -50, 0, { hpScale: 1000 });
    const refr = w.spawnEnemy('refractor', 50, 0, { hpScale: 1000 });
    ticks(sim, 120);
    expect(hitDamage(sim, 'laser', behind)).toBe(0);
    const perHitR = evs(sim, Ev.Hit, 'laser').filter((e) => e.a === refr)[0].b;
    const sim2 = fixedLaser();
    const g = sim2.world.spawnEnemy('grunt', 50, 0, { hpScale: 1000 });
    ticks(sim2, 120);
    const perHitG = evs(sim2, Ev.Hit, 'laser').filter((e) => e.a === g)[0].b;
    const armorR = 100 / (100 + sim.world.enemies.armor[refr]);
    expect(perHitR / armorR).toBeCloseTo(perHitG * 0.3, 3);
  });

  it('nodes take contact damage, drop their beams, and rebuild', () => {
    const sim = fixedLaser();
    const w = sim.world;
    const b = w.spawnEnemy('brute', 110, 0, { hpScale: 1e5 });
    ticks(sim, 300);
    expect(fxCount(sim, 'laser.node_down')).toBeGreaterThan(0);
    w.killEnemy(b, -1, 'test');
    const downAt = evs(sim, Ev.Fx, 'laser.node_down')[0].tick;
    ticks(sim, Math.max(1, downAt + 4 * 60 + 5 - w.tick));
    expect(w.shared.laserNodeCount).toBe(2);
    expect(w.shared.laserBeamCount).toBe(1);
  });

  it('Pulse widens beams periodically; Vertex Blast fires outward beams', () => {
    const sim = fixedLaser({ 'laser.pulse': 1, 'laser.vertex_blast': 1 });
    const w = sim.world;
    w.spawnEnemy('grunt', 200, 0, { hpScale: 1000 });
    let maxW = 0, minW = Infinity;
    for (let t = 0; t < 400; t++) { ticks(sim, 1); maxW = Math.max(maxW, w.shared.laserBeamWidth); minW = Math.min(minW, w.shared.laserBeamWidth); }
    expect(maxW).toBeCloseTo(minW * 3, 3);
    expect(fxCount(sim, 'laser.vertex_blast')).toBeGreaterThan(0);
    expect(share(sim, 'laser')).toBeGreaterThan(0);   // the grunt at 200 is only reachable by vertex blasts
  });

  it('Expansion: 8 nodes with a star; Mandala adds an inner star', () => {
    const sim = fixedLaser();
    rankTree(sim, 'laser', 'expansion', false);
    ticks(sim, 2);
    const sh = sim.world.shared;
    expect(sh.laserNodeCount).toBe(16);   // mandala: outer ring 8 + inner 8
    expect(sh.laserBeamCount).toBe(16);
  });

  it('Resonance: enemies in two beams take bonus damage, get Shocked, and Standing Wave compounds', () => {
    const sim = fixedLaser({ 'laser.nodes': 3 });
    rankTree(sim, 'laser', 'resonance', false);
    const w = sim.world;
    w.stats.override('laser.node_durability', 1e9); w.stats.override('laser.rotation', 0); w.rebuildStats();
    const R = w.stats.get('laser.radius');
    const e = w.spawnEnemy('brute', R * 0.93, 0, { hpScale: 1e6 });
    ticks(sim, 200);
    expect(fxCount(sim, 'laser.resonance.standing_wave')).toBeGreaterThan(0);
    expect(evs(sim, Ev.StatusApply, 'laser').filter((x) => x.a === e).length).toBeGreaterThan(1);
    const hits = evs(sim, Ev.Hit, 'laser').filter((h) => h.a === e);
    expect(hits[hits.length - 1].b).toBeGreaterThan(hits[0].b * 1.2);
  });

  it('Containment slows the interior; Crush contracts and pulls; Dynamic Geometry stretches', () => {
    const sim = fixedLaser({ 'laser.nodes': 3 });
    rankTree(sim, 'laser', 'containment', false);
    const w = sim.world;
    w.stats.override('laser.node_durability', 1e9); w.rebuildStats();
    const inside = w.spawnEnemy('grunt', 30, 30, { hpScale: 1e6 });
    ring(sim, 20, 170, 'grunt', 1e6);
    ticks(sim, 30);
    expect(w.enemies.fieldSlow[inside]).toBeGreaterThan(0);
    ticks(sim, 90);   // Dynamic Geometry pulls the radius toward the ring at 170 (before the first Crush)
    const R = w.stats.get('laser.radius');
    expect(w.shared.laserInterior).toBeLessThan(R * Math.cos(Math.PI / 5) - 10);
    ticks(sim, 8 * 60);
    expect(fxCount(sim, 'laser.containment.crush')).toBeGreaterThan(0);
  });
});
