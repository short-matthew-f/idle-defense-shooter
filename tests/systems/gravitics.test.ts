import { describe, it, expect } from 'vitest';
import { Ev, ProjFlag, ProjKind } from '../../src/sim/core/types';
import { hpSim, rankTree, ticks, share, evs, fxCount, setRanks, combatTick } from './hardpoint-helpers';

function cluster(sim: ReturnType<typeof hpSim>, x: number, y: number, n: number, kind = 'grunt', hpScale = 1e5): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(sim.world.spawnEnemy(kind, x + (k % 3) * 25 - 25, y + Math.floor(k / 3) * 25 - 25, { hpScale }));
  return out;
}

describe('Gravitics', () => {
  it('spawns a well where it catches the most enemies, pulls them in, then collapses on a cooldown', () => {
    const sim = hpSim(['gravitics']);
    const w = sim.world;
    w.spawnEnemy('grunt', -250, 0, { hpScale: 1e5 });
    const c = cluster(sim, 250, 0, 9);
    const g0 = w.enemies.gen[c[8]];
    ticks(sim, 2);
    const wells = evs(sim, Ev.Fx, 'gravitics.well');
    expect(wells.length).toBe(1);
    expect(wells[0].x).toBeGreaterThan(150);
    expect(w.shared.wellCount).toBe(1);
    const i0 = w.resolveEnemy(c[8], g0);
    const d0 = Math.hypot(w.enemies.x[i0] - wells[0].x, w.enemies.y[i0] - wells[0].y);
    ticks(sim, 30);
    const i1 = w.resolveEnemy(c[8], g0);
    expect(Math.hypot(w.enemies.x[i1] - wells[0].x, w.enemies.y[i1] - wells[0].y)).toBeLessThan(d0);
    ticks(sim, 3 * 60);
    expect(fxCount(sim, 'gravitics.collapse')).toBe(1);
    expect(w.shared.wellCount).toBe(0);
    ticks(sim, 8 * 60 + 5);
    expect(evs(sim, Ev.Fx, 'gravitics.well').length).toBe(2);
  });

  it('Anchors ignore the pull', () => {
    const sim = hpSim(['gravitics']);
    const w = sim.world;
    cluster(sim, 250, 0, 8);
    const a = w.spawnEnemy('anchor', 250, 60, { hpScale: 1e5 });
    const x = w.enemies.x[a], y = w.enemies.y[a];
    ticks(sim, 60);
    expect(w.enemies.x[a]).toBe(x);
    expect(w.enemies.y[a]).toBe(y);
  });

  it('Collapse implodes for damage scaled by captives; Chain Collapse spawns smaller wells; Mass Driver flings', () => {
    const sim = hpSim(['gravitics']);
    rankTree(sim, 'gravitics', 'collapse');
    const w = sim.world;
    w.stats.override('gravitics.wells', 1); w.rebuildStats();
    cluster(sim, 250, 0, 9);
    const R = w.stats.get('gravitics.radius');
    for (let k = 0; k < 24; k++) { const a = (k / 24) * 6.2832; w.spawnEnemy('grunt', 250 + Math.cos(a) * (R + 22), Math.sin(a) * (R + 22), { hpScale: 1e5 }); }
    ticks(sim, Math.ceil(w.stats.get('gravitics.duration') * 60) + 120);
    expect(evs(sim, Ev.Explosion, 'gravitics').length).toBeGreaterThan(0);
    expect(fxCount(sim, 'gravitics.collapse.chain_collapse')).toBeGreaterThan(0);
    expect(fxCount(sim, 'gravitics.mass_driver')).toBeGreaterThan(0);
    expect(share(sim, 'gravitics')).toBeGreaterThan(0);
  });

  it('Lensing bends and boosts projectiles passing a well; Focal Point converges them', () => {
    const sim = hpSim(['gravitics']);
    rankTree(sim, 'gravitics', 'lensing', false);
    const w = sim.world;
    cluster(sim, 200, 0, 9);
    ticks(sim, 2);
    const wx = w.shared.wells[0], wy = w.shared.wells[1];
    const i = w.spawnProjectile({ kind: ProjKind.Bullet, source: 0, srcTag: 'ballistics', x: wx - 20, y: wy + 60, vx: 0, vy: -200, damage: 10, radius: 3, life: 200 });
    const gen = w.projectiles.gen[i];
    ticks(sim, 1);
    const p = w.projectiles;
    let seen = false;
    for (let j = 0; j < p.count; j++) if (p.gen[j] === gen) {
      seen = true;
      expect(p.flags[j] & ProjFlag.Lensed).toBeTruthy();
      expect(p.damage[j]).toBeGreaterThan(10);
      expect(p.vx[j]).toBeGreaterThan(0);   // bent toward the center
    }
    expect(seen).toBe(true);
    expect(fxCount(sim, 'gravitics.lensing.focal_point')).toBeGreaterThan(0);
  });

  it('Tidal wells drift toward the tower; Orbit Lock flings captives into orbit', () => {
    const sim = hpSim(['gravitics']);
    rankTree(sim, 'gravitics', 'tidal', false);
    const w = sim.world;
    cluster(sim, 300, 0, 9);
    ticks(sim, 2);
    const x0 = Math.hypot(w.shared.wells[0], w.shared.wells[1]);
    ticks(sim, 60);
    const x1 = Math.hypot(w.shared.wells[0], w.shared.wells[1]);
    expect(x1).toBeLessThan(x0 - 30);
    let orbiting = false;
    for (let t = 0; t < 400 && !orbiting; t++) {
      combatTick(sim);
      if (fxCount(sim, 'gravitics.tidal.orbit_lock') > 0) orbiting = true;
    }
    expect(orbiting).toBe(true);
    ticks(sim, 20);
    let near = 0;
    for (let i = 0; i < w.enemies.count; i++) { const d = Math.hypot(w.enemies.x[i], w.enemies.y[i]); if (Math.abs(d - 70) < 5) near++; }
    expect(near).toBeGreaterThan(3);
  });
});
