import { describe, it, expect } from 'vitest';
import { EnemyFlag, Ev, ProjKind } from '../../src/sim/core/types';
import { HB_SEEK, spawnSeeker, SRC_ORDNANCE } from '../../src/sim/systems/hardpoints/common';
import { hpSim, rankTree, ring, ticks, share, evs, fxCount, setRanks, combatTick } from './hardpoint-helpers';

describe('Ordnance', () => {
  it('launches steered missiles that explode on targets; damage is attributed to ordnance', () => {
    const sim = hpSim(['ordnance']);
    ring(sim, 6, 220);
    let seekers = 0;
    for (let t = 0; t < 400; t++) {
      combatTick(sim);
      const p = sim.world.projectiles;
      for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.Missile && (p.hpBits[i] & HB_SEEK)) seekers++;
    }
    expect(seekers).toBeGreaterThan(0);
    expect(evs(sim, Ev.Explosion, 'ordnance').length).toBeGreaterThanOrEqual(2);
    expect(share(sim, 'ordnance')).toBeGreaterThan(0);
  });

  it('Launchers fire one missile each per salvo; unmounted ordnance does nothing', () => {
    const off = hpSim([]);
    ring(off, 4, 200);
    ticks(off, 300);
    expect(share(off, 'ordnance')).toBe(0);
    const sim = hpSim(['ordnance']);
    setRanks(sim, { 'ordnance.launchers': 3 });   // 4 launchers
    ring(sim, 6, 200);
    let maxMissiles = 0;
    for (let t = 0; t < 200; t++) {
      combatTick(sim);
      let m = 0;
      const p = sim.world.projectiles;
      for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.Missile) m++;
      maxMissiles = Math.max(maxMissiles, m);
    }
    expect(maxMissiles).toBeGreaterThanOrEqual(4);
  });

  it('Overkill Guidance retargets a missile whose target dies in flight (+damage)', () => {
    const sim = hpSim(['ordnance']);
    setRanks(sim, { 'ordnance.overkill_guidance': 3 });
    const w = sim.world;
    const a = w.spawnEnemy('grunt', 330, 0, { hpScale: 1000 });
    const b = w.spawnEnemy('grunt', 330, 80, { hpScale: 1000 });
    const genB = w.enemies.gen[b];
    let m = -1;
    for (let t = 0; t < 200 && m < 0; t++) {
      combatTick(sim);
      const p = w.projectiles;
      for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.Missile && p.target[i] === a) { m = i; break; }
    }
    expect(m).toBeGreaterThanOrEqual(0);
    const dmg0 = w.projectiles.damage[m];
    const genM = w.projectiles.gen[m];
    w.killEnemy(a, -1, 'test');
    combatTick(sim);
    const p = w.projectiles;
    let found = false;
    for (let i = 0; i < p.count; i++) {
      if (p.gen[i] !== genM) continue;
      found = true;
      expect(w.enemies.gen[p.target[i]]).toBe(genB);
      expect(p.damage[i]).toBeGreaterThan(dmg0);
    }
    expect(found).toBe(true);
  });

  it('Jammer aura: missiles inside it fly straight (no steering)', () => {
    for (const jam of [false, true]) {
      const sim = hpSim(['ordnance']);
      const w = sim.world;
      const t = w.spawnEnemy('grunt', 0, 400, { hpScale: 1000 });
      if (jam) w.spawnEnemy('jammer', 60, 0, { hpScale: 1000 });
      const i = spawnSeeker(w, { kind: ProjKind.Missile, source: SRC_ORDNANCE, srcTag: 'ordnance', x: 40, y: 0, angle: 0, speed: 300, damage: 1, radius: 4, blast: 40, life: 300, target: t, element: null, cause: -1, bits: 0 });
      const gen = w.projectiles.gen[i];
      w.rebuildSpatial();
      for (let k = 0; k < 6; k++) combatTick(sim);
      const p = w.projectiles;
      for (let j = 0; j < p.count; j++) if (p.gen[j] === gen) {
        if (jam) expect(Math.abs(p.vy[j])).toBeLessThan(1e-3);
        else expect(p.vy[j]).toBeGreaterThan(10);
      }
    }
  });

  it('Cluster Warheads split into fragments just before impact', () => {
    const sim = hpSim(['ordnance']);
    setRanks(sim, { 'ordnance.cluster_warheads': 1 });
    ring(sim, 3, 250);
    let frags = 0;
    for (let t = 0; t < 400; t++) {
      combatTick(sim);
      const p = sim.world.projectiles;
      for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.Fragment) frags++;
    }
    expect(fxCount(sim, 'ordnance.cluster_warheads')).toBeGreaterThan(0);
    expect(frags).toBeGreaterThan(0);
  });

  it('Hunter prefers elites and Kill Order extends an open weak point', () => {
    const sim = hpSim(['ordnance']);
    rankTree(sim, 'ordnance', 'hunter', false);
    const w = sim.world;
    w.spawnEnemy('grunt', 100, 0, { hpScale: 1000 });
    const elite = w.spawnEnemy('grunt', -300, 0, { hpScale: 1000, elite: ['hardened'] });
    w.enemies.flags[elite] |= EnemyFlag.WeakPointOpen;   // the boss script's own exposure window
    let firstTarget = -1;
    for (let t = 0; t < 400 && fxCount(sim, 'ordnance.hunter.kill_order') === 0; t++) {
      combatTick(sim);
      const p = w.projectiles;
      if (firstTarget < 0) for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.Missile) { firstTarget = p.target[i]; break; }
    }
    expect(firstTarget).toBe(elite);
    expect(fxCount(sim, 'ordnance.hunter.kill_order')).toBeGreaterThan(0);
    const banked = w.enemies.weakPointT[elite];
    expect(banked).toBeGreaterThanOrEqual(60);
    expect(banked).toBeLessThanOrEqual(240);
    // the boss script closes its window: Kill Order holds the weak point open for the banked time, then closes it
    w.enemies.flags[elite] &= ~EnemyFlag.WeakPointOpen;
    combatTick(sim);
    expect(w.enemies.flags[elite] & EnemyFlag.WeakPointOpen).toBeTruthy();
    expect(fxCount(sim, 'ordnance.hunter.kill_order.hold')).toBe(1);
    w.stats.override('ordnance.damage', 0); w.rebuildStats();   // stop further extensions
    ticks(sim, 300);
    expect(w.enemies.flags[elite] & EnemyFlag.WeakPointOpen).toBeFalsy();
  });

  it('Swarm fires rocket pods that accelerate; Cascade launches follow-up rockets', () => {
    const sim = hpSim(['ordnance']);
    rankTree(sim, 'ordnance', 'swarm', false);
    ring(sim, 12, 220, 'grunt', 1e6);
    let rockets = 0, fast = 0;
    for (let t = 0; t < 900; t++) {
      combatTick(sim);
      const p = sim.world.projectiles;
      for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.Rocket) {
        rockets++;
        if (Math.hypot(p.vx[i], p.vy[i]) > 300) fast++;
      }
    }
    expect(rockets).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(0);
    expect(fxCount(sim, 'ordnance.swarm.cascade')).toBeGreaterThan(0);
    expect(share(sim, 'ordnance')).toBeGreaterThan(0);
  });

  it('Bombard lobs shells at the densest group; Carpet zones merge', () => {
    const sim = hpSim(['ordnance']);
    rankTree(sim, 'ordnance', 'bombard', false);
    const w = sim.world;
    w.spawnEnemy('grunt', -250, 0, { hpScale: 1e6 });
    for (let k = 0; k < 8; k++) w.spawnEnemy('grunt', 200 + (k % 3) * 8, (k - 4) * 6, { hpScale: 1e6 });
    ticks(sim, 900);
    const shells = evs(sim, Ev.Fx, 'ordnance.bombard.shell');
    expect(shells.length).toBeGreaterThan(0);
    expect(shells[0].x).toBeGreaterThan(100);   // the dense group, not the lone grunt
    expect(fxCount(sim, 'ordnance.bombard.carpet')).toBeGreaterThan(0);
    expect(share(sim, 'ordnance')).toBeGreaterThan(0);
  });
});
