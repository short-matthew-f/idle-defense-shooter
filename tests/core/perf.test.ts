import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { ProjKind } from '../../src/sim/core/types';
import { cos, sin } from '../../src/sim/math/lut';

describe('performance smoke', () => {
  it('600 ticks with 800 enemies and 2000 projectiles run under 1.5 s', () => {
    const sim = new Sim(null, 5);
    const w = sim.world;
    w.stats.override('bastion.max_hp', 1e12);
    w.rebuildStats(); w.tower.hp = w.tower.maxHp;
    const r = w.prng;
    for (let i = 0; i < 800; i++) {
      const a = r.next() * 6.283, d = 150 + r.next() * 350;
      w.spawnEnemy(i % 3 === 0 ? 'swarm' : 'grunt', cos(a) * d, sin(a) * d, { hpScale: 1e6 });
    }
    for (let i = 0; i < 2000; i++) {
      const a = r.next() * 6.283, d = 60 + r.next() * 300, sp = 20 + r.next() * 15;
      w.spawnProjectile({ kind: ProjKind.Bullet, x: cos(a) * d, y: sin(a) * d, vx: cos(a + 1.5708) * sp, vy: sin(a + 1.5708) * sp, damage: 1, radius: 3, life: 2000, pierce: 255, critChance: 0.1 });
    }
    // warm up JIT a little, then time
    sim.run(30);
    const t0 = performance.now();
    sim.run(600);
    const ms = performance.now() - t0;
    expect(w.enemies.count).toBeGreaterThan(700);
    expect(w.projectiles.count).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(1500);
  });
});
