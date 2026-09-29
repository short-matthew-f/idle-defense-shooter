import { describe, it, expect } from 'vitest';
import { Ev, ProjFlag, ProjKind } from '../../src/sim/core/types';
import { hpSim, rankTree, ring, ticks, share, evs, fxCount, setRanks, combatTick } from './hardpoint-helpers';

describe('Orbital Blade', () => {
  it('sweeps around the tower, hits each enemy at most once per 0.25 s, and knocks enemies outward', () => {
    const sim = hpSim(['blade']);
    const w = sim.world;
    const e = w.spawnEnemy('grunt', 50, 0, { hpScale: 1000 });
    const gen = w.enemies.gen[e];
    ticks(sim, 180);
    const hits = evs(sim, Ev.Hit, 'blade');
    expect(hits.length).toBeGreaterThan(0);
    const ts = hits.map((h) => h.tick);
    for (let k = 1; k < ts.length; k++) expect(ts[k] - ts[k - 1]).toBeGreaterThanOrEqual(15);
    const i = w.resolveEnemy(e, gen);
    expect(Math.hypot(w.enemies.x[i], w.enemies.y[i])).toBeGreaterThan(55);
    expect(share(sim, 'blade')).toBeGreaterThan(0);
    const sh = w.shared;
    expect(sh.bladeCount).toBe(1);
    expect(sh.bladeLens[0]).toBeCloseTo(60, 3);
  });

  it('Serration applies Bleed; Deflection destroys hostile projectiles in the sweep', () => {
    const sim = hpSim(['blade']);
    sim.world.stats.override('blade.serration', 1);
    setRanks(sim, { 'blade.deflection': 1 });
    const w = sim.world;
    ring(sim, 6, 50);
    for (let k = 0; k < 8; k++) {
      const a = k * 0.785;
      w.spawnProjectile({ kind: ProjKind.EnemyShot, flags: ProjFlag.Hostile, x: Math.cos(a) * 60, y: Math.sin(a) * 60, vx: 0, vy: 0, damage: 5, radius: 3, life: 600 });
    }
    ticks(sim, 180);
    expect(evs(sim, Ev.StatusApply, 'blade').length).toBeGreaterThan(0);
    expect(fxCount(sim, 'blade.deflection')).toBeGreaterThan(0);
  });

  it('Twinning: up to 4 blades at distinct radii; Gyre counter-rotates alternate blades', () => {
    const sim = hpSim(['blade']);
    rankTree(sim, 'blade', 'twinning', false);
    const sh = sim.world.shared;
    ticks(sim, 1);
    expect(sh.bladeCount).toBe(4);
    const inner = [0, 1, 2, 3].map((k) => sh.bladeInner[k]);
    expect(new Set(inner).size).toBe(4);
    const a0 = sh.bladeAngles[0], a1 = sh.bladeAngles[1];
    ticks(sim, 5);
    const d0 = sh.bladeAngles[0] - a0, d1 = sh.bladeAngles[1] - a1;
    expect(Math.sign(d0)).not.toBe(Math.sign(d1));
  });

  it('Greatblade: longer blade; Sunder permanently strips armor', () => {
    const sim = hpSim(['blade']);
    rankTree(sim, 'blade', 'greatblade', false);
    const w = sim.world;
    ticks(sim, 1);
    expect(w.shared.bladeLens[0]).toBeGreaterThan(w.stats.get('blade.length') * 1.4);
    w.stats.override('blade.knockback', 0); w.rebuildStats();
    const e = w.spawnEnemy('armored', 60, 0, { hpScale: 1e5 });
    const armor0 = w.enemies.armor[e];
    ticks(sim, 240);
    expect(w.enemies.armor[e]).toBeLessThan(armor0);
    expect(fxCount(sim, 'blade.greatblade.sunder')).toBeGreaterThan(0);
  });

  it('Tempest: Momentum speeds the blade, Afterimage trails hit, Cyclone throws cutting arcs at max stacks', () => {
    const sim = hpSim(['blade']);
    rankTree(sim, 'blade', 'tempest', false);
    const w = sim.world;
    w.stats.override('blade.knockback', 0); w.rebuildStats();
    ring(sim, 30, 60, 'grunt', 1e5);
    let arcs = 0;
    for (let t = 0; t < 600; t++) {
      combatTick(sim);
      const p = w.projectiles;
      for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.CuttingArc) arcs++;
    }
    expect(fxCount(sim, 'blade.tempest.cyclone')).toBeGreaterThan(0);
    expect(arcs).toBeGreaterThan(0);
    // afterimage hits are recorded as blade hits beyond the solid blade's own cadence
    expect(evs(sim, Ev.Hit, 'blade').length).toBeGreaterThan(30);
  });
});
