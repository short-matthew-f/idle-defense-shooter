import { describe, it, expect } from 'vitest';
import { Ev, ProjFlag, ProjKind } from '../../src/sim/core/types';
import { hpSim, rankTree, ring, ticks, share, evs, fxCount, setRanks, combatTick } from './hardpoint-helpers';

function countKind(sim: ReturnType<typeof hpSim>, kind: number): number {
  const p = sim.world.projectiles;
  let n = 0;
  for (let i = 0; i < p.count; i++) if (p.kind[i] === kind && !(p.flags[i] & ProjFlag.Dead)) n++;
  return n;
}

describe('Drones', () => {
  it('orbit the tower, publish their geometry and shoot enemies in range', () => {
    const sim = hpSim(['drones']);
    setRanks(sim, { 'drones.count': 3 });
    ring(sim, 8, 200);
    let shots = 0;
    for (let t = 0; t < 600; t++) { combatTick(sim); shots += countKind(sim, ProjKind.DroneShot); }
    const sh = sim.world.shared;
    expect(sh.droneCount).toBe(4);
    const d = Math.hypot(sh.drones[0], sh.drones[1]);
    expect(d).toBeGreaterThan(20);
    expect(shots).toBeGreaterThan(0);
    expect(share(sim, 'drones')).toBeGreaterThan(0);
  });

  it('count is capped by drones.cap; the Hive frame mounts drones free with a ×1.5 cap', () => {
    const sim = hpSim(['drones']);
    sim.world.stats.override('drones.cap', 3);
    setRanks(sim, { 'drones.count': 5 });
    ticks(sim, 2);
    expect(sim.world.shared.droneCount).toBe(3);
    sim.world.build.frame = 'hive'; sim.world.build.hardpoints = [];
    sim.world.rebuildStats();
    expect(sim.world.stats.mounted('drones')).toBe(true);
    ticks(sim, 2);
    expect(sim.world.shared.droneCount).toBe(4);   // floor(3 × 1.5)
  });

  it('Jammer: drones inside its aura lose targeting and stop firing', () => {
    const sim = hpSim(['drones']);
    setRanks(sim, { 'drones.count': 3 });
    sim.world.spawnEnemy('jammer', 0, 0, { hpScale: 1000 });
    ring(sim, 6, 150);
    let shots = 0;
    for (let t = 0; t < 400; t++) { combatTick(sim); shots += countKind(sim, ProjKind.DroneShot); }
    expect(shots).toBe(0);
    expect(share(sim, 'drones')).toBe(0);
  });

  it('Payload drops bombs on the densest spot', () => {
    const sim = hpSim(['drones']);
    setRanks(sim, { 'drones.payload': 1 });
    for (let k = 0; k < 6; k++) sim.world.spawnEnemy('grunt', 95 + k * 4, 5, { hpScale: 1000 });
    let bombs = 0;
    for (let t = 0; t < 700; t++) { combatTick(sim); bombs += countKind(sim, ProjKind.Bomb); }
    expect(fxCount(sim, 'drones.payload')).toBeGreaterThan(0);
    expect(bombs).toBeGreaterThan(0);
  });

  it('Wing: interceptors hunt kamikazes first; Sortie detaches drones to pursue', () => {
    const sim = hpSim(['drones']);
    rankTree(sim, 'drones', 'wing', false);
    const w = sim.world;
    w.spawnEnemy('grunt', 110, 0, { hpScale: 1000 });
    const kami = w.spawnEnemy('kamikaze', 380, 60, { hpScale: 1000 });
    let sawKami = false, far = 0;
    for (let t = 0; t < 300; t++) {
      combatTick(sim);
      const sh = w.shared;
      if (sh.drones[2] === kami) sawKami = true;
      for (let k = 0; k < sh.droneCount; k++) far = Math.max(far, Math.hypot(sh.drones[k * 3], sh.drones[k * 3 + 1]));
    }
    expect(sawKami).toBe(true);
    expect(far).toBeGreaterThan(w.stats.get('drones.orbit_radius') + 30);
    expect(fxCount(sim, 'drones.wing.sortie')).toBeGreaterThan(0);
  });

  it('Arc links damage enemies crossing them; Faraday Web meshes every drone', () => {
    const sim = hpSim(['drones']);
    rankTree(sim, 'drones', 'arc', false);
    sim.world.stats.override('drones.targeting', 1);   // no shots: isolate the links
    sim.world.rebuildStats();
    ring(sim, 24, 60);
    ticks(sim, 300);
    expect(share(sim, 'drones')).toBeGreaterThan(0);
    expect(fxCount(sim, 'drones.arc.faraday_web')).toBeGreaterThan(0);
  });

  it('Carrier releases microdrones; Brood gives them the infusion element', () => {
    const sim = hpSim(['drones'], ['fire']);
    rankTree(sim, 'drones', 'carrier', false);
    setRanks(sim, { 'infuse.drones.fire': 1 });
    ring(sim, 6, 180);
    let micro = 0, fiery = 0;
    for (let t = 0; t < 400; t++) {
      combatTick(sim);
      const p = sim.world.projectiles;
      for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.Microdrone) { micro++; if (p.element[i] === 1) fiery++; }
    }
    expect(micro).toBeGreaterThan(0);
    expect(fiery).toBeGreaterThan(0);
    expect(fxCount(sim, 'drones.carrier.brood')).toBeGreaterThan(0);
  });

  it('Support: medics heal, shield drones add capacity, Aegis Wing intercepts hostile shots', () => {
    const sim = hpSim(['drones']);
    const cap0 = sim.world.tower.maxShield;
    rankTree(sim, 'drones', 'support', false);
    const w = sim.world;
    expect(w.tower.maxShield).toBeGreaterThan(cap0);
    w.tower.hp = w.tower.maxHp * 0.5;
    ticks(sim, 130);
    expect(evs(sim, Ev.Heal).length).toBeGreaterThan(0);
    const sh = w.shared;
    const x = sh.drones[0], y = sh.drones[1];
    w.spawnProjectile({ kind: ProjKind.EnemyShot, flags: ProjFlag.Hostile, x: x + 8, y, vx: -x, vy: -y, damage: 5, radius: 3, life: 200 });
    ticks(sim, 3);
    expect(fxCount(sim, 'drones.support.aegis_wing')).toBeGreaterThan(0);
  });
});
