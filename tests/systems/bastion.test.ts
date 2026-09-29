import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { Ev, ProjFlag, ProjKind } from '../../src/sim/core/types';
import { quietSim, setup, events, ticks, grunt } from './wp2-helpers';

const NO_GUN = { 'ballistics.range': 1 };

describe('Bastion: Aegis', () => {
  it('Outer Barrier absorbs damage before shields and HP, and holds enemies at its ring', () => {
    const sim = setup(quietSim(), { doctrines: { bastion: 'aegis' }, ranks: { 'bastion.aegis.barrier': 5 }, overrides: NO_GUN });
    const w = sim.world, t = w.tower;
    expect(t.maxBarrier).toBe(100);
    expect(t.barrier).toBe(100);
    const hp = t.hp;
    w.damageTower(60, -1, -1);
    expect(t.barrier).toBeCloseTo(40, 5);
    expect(t.hp).toBe(hp);
    const i = grunt(sim, 40, 0);
    ticks(sim, 1);
    expect(w.enemies.x[i]).toBeGreaterThanOrEqual(70);                    // pushed back to the ring
    w.enemies.attackT[i] = 0;
    const before = t.barrier;
    ticks(sim, 1);
    expect(t.barrier).toBeLessThan(before);                                // its contact attack struck the barrier
    expect(t.hp).toBe(hp);
  });

  it('Shockwave Shield pushes enemies and damages them when the barrier breaks', () => {
    const sim = setup(quietSim(), { doctrines: { bastion: 'aegis' }, ranks: { 'bastion.aegis.barrier': 5, 'bastion.aegis.shockwave_shield': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const i = grunt(sim, 100, 0);
    w.rebuildSpatial();
    const hp = w.enemies.hp[i];
    w.damageTower(500, i, -1);
    const brk = events(sim, (e) => e.type === Ev.BarrierBreak)[0];
    expect(brk).toBeTruthy();
    expect(w.enemies.x[i]).toBeCloseTo(160, 3);
    const boom = events(sim, (e) => e.type === Ev.Explosion && e.src === 'bastion.shockwave')[0];
    expect(boom.cause).toBe(brk.id);
    expect(hp - w.enemies.hp[i]).toBeCloseTo(50, 3);
  });

  it('absorbs hostile shots; Mirror Aegis reflects them at the shooter', () => {
    const sim = setup(quietSim(), { doctrines: { bastion: 'aegis' }, ranks: { 'bastion.aegis.barrier': 5 }, overrides: NO_GUN });
    const w = sim.world;
    const shooter = grunt(sim, 200, 0);
    const p = w.spawnProjectile({ kind: ProjKind.EnemyShot, flags: ProjFlag.Hostile, x: 72, y: 0, vx: -170, vy: 0, damage: 10, radius: 5, life: 600, target: shooter, srcTag: 'enemy' });
    ticks(sim, 2);
    expect(w.tower.barrier).toBeCloseTo(90, 4);
    expect(w.projectiles.count).toBe(0);
    const s2 = setup(quietSim(), { doctrines: { bastion: 'aegis' }, ranks: { 'bastion.aegis.barrier': 5, 'bastion.aegis.mirror_aegis': 1 }, overrides: NO_GUN });
    const w2 = s2.world;
    const sh = grunt(s2, 200, 0);
    w2.spawnProjectile({ kind: ProjKind.EnemyShot, flags: ProjFlag.Hostile, x: 72, y: 0, vx: -170, vy: 0, damage: 10, radius: 5, life: 600, target: sh, srcTag: 'enemy' });
    ticks(s2, 2);
    expect(w2.projectiles.flags[0] & ProjFlag.Hostile).toBe(0);
    expect(w2.projectiles.vx[0]).toBeGreaterThan(0);
    expect(w2.tower.barrier).toBe(100);
    ticks(s2, 90);
    expect(events(s2, (e) => e.type === Ev.Hit && e.src === 'bastion.mirror_aegis' && e.a === sh).length).toBe(1);
    expect(p).toBeGreaterThanOrEqual(0);
  });
});

describe('Bastion: Thorns', () => {
  it('Retaliation damages attackers (+armor), Reactive Armor stacks, Spite chains to a second enemy', () => {
    const sim = setup(quietSim(), { doctrines: { bastion: 'thorns' },
      ranks: { 'bastion.thorns.retaliation': 2, 'bastion.thorns.reactive_armor': 1, 'bastion.thorns.spite': 1, 'bastion.armor': 5 }, overrides: NO_GUN });
    const w = sim.world;
    const a = grunt(sim, 40, 0), b = grunt(sim, 100, 0);
    w.rebuildSpatial();
    const ha = w.enemies.hp[a], hb = w.enemies.hp[b];
    w.damageTower(100, a, -1);
    const taken = events(sim, (e) => e.type === Ev.TowerHit)[0].b;
    const expected = taken * 0.3 + 10;
    expect(ha - w.enemies.hp[a]).toBeCloseTo(expected, 3);
    const thorns = events(sim, (e) => e.type === Ev.Hit && e.src === 'bastion.thorns')[0];
    const spite = events(sim, (e) => e.type === Ev.Hit && e.src === 'bastion.spite')[0];
    expect(spite.cause).toBe(thorns.id);
    expect(hb - w.enemies.hp[b]).toBeCloseTo(expected * 0.6, 3);
    ticks(sim, 1);
    expect(w.towerArmorMul).toBeCloseTo(1.1, 6);
    w.damageTower(1, a, -1); w.damageTower(1, a, -1);
    ticks(sim, 1);
    expect(w.towerArmorMul).toBeCloseTo(1.3, 6);
    ticks(sim, 200);
    expect(w.towerArmorMul).toBeCloseTo(1, 6);
  });

  it('Bulwark: Retaliation scales with armor', () => {
    const sim = quietSim();
    sim.world.build.frame = 'bulwark';
    setup(sim, { doctrines: { bastion: 'thorns' }, ranks: { 'bastion.thorns.retaliation': 2, 'bastion.armor': 25 }, overrides: NO_GUN });
    const w = sim.world;
    const a = grunt(sim, 40, 0);
    const ha = w.enemies.hp[a];
    w.damageTower(100, a, -1);
    const taken = events(sim, (e) => e.type === Ev.TowerHit)[0].b;
    expect(ha - w.enemies.hp[a]).toBeCloseTo((taken * 0.3 + 50) * 1.5, 3);
  });
});

describe('Bastion: Phoenix and Fortress', () => {
  it('Last Stand damage grows as HP falls; Ember Heart speeds every system below 25% HP', () => {
    const sim = setup(quietSim(), { doctrines: { bastion: 'phoenix' }, ranks: { 'bastion.phoenix.last_stand': 5, 'bastion.phoenix.ember_heart': 1 }, overrides: NO_GUN });
    const w = sim.world, t = w.tower;
    const i = grunt(sim, 300, 300);
    ticks(sim, 1);
    expect(w.dynamicPowerMul).toBe(1);
    const full = w.damage(i, 100, { source: 'primary', srcTag: 'ballistics', cause: -1 }).damage;
    t.hp = t.maxHp * 0.55;
    ticks(sim, 1);
    expect(w.dynamicPowerMul).toBeCloseTo(1 + 0.1 * 4, 6);
    expect(w.damage(i, 100, { source: 'primary', srcTag: 'ballistics', cause: -1 }).damage / full).toBeCloseTo(1.4, 5);
    expect(w.dynamicSpeedMul).toBe(1);
    t.hp = t.maxHp * 0.2;
    ticks(sim, 1);
    expect(w.dynamicPowerMul).toBeCloseTo(1.8, 6);
    expect(w.dynamicSpeedMul).toBeCloseTo(1.3, 6);
    t.hp = t.maxHp;
    ticks(sim, 1);
    expect(w.dynamicPowerMul).toBeCloseTo(1, 9);
    expect(w.dynamicSpeedMul).toBeCloseTo(1, 9);
  });

  it('Rekindle heals once per wave below 50% HP', () => {
    const sim = setup(quietSim(), { doctrines: { bastion: 'phoenix' }, ranks: { 'bastion.phoenix.rekindle': 1 }, overrides: NO_GUN });
    const w = sim.world, t = w.tower;
    w.run.phase = 'combat';
    t.hp = t.maxHp * 0.4;
    ticks(sim, 250);
    expect(t.hp).toBeCloseTo(t.maxHp * 0.48, 3);
    t.hp = t.maxHp * 0.4;
    ticks(sim, 250);
    expect(t.hp).toBeCloseTo(t.maxHp * 0.4, 3);
  });

  it('Fortification builds temp HP at full health; Keep turns overflow healing into barrier', () => {
    const sim = setup(quietSim(), { doctrines: { bastion: 'fortress' }, ranks: { 'bastion.fortress.fortification': 1, 'bastion.fortress.keep': 1 }, overrides: NO_GUN });
    const w = sim.world, t = w.tower;
    ticks(sim, 600);
    expect(t.tempHp).toBeCloseTo(0.1 * t.maxHp, 5);
    w.healTower(10, -1);
    ticks(sim, 1);
    expect(t.barrier).toBeCloseTo(10, 5);
    w.healTower(1000, -1);
    ticks(sim, 1);
    expect(t.barrier).toBeCloseTo(0.25 * t.maxHp, 5);
  });

  it('Second Core: once per wave, lethal damage leaves 1 HP with 3 s invulnerability', () => {
    const sim = new Sim(null, 3);
    const w = sim.world, t = w.tower;
    w.build.ranks['bastion.second_core'] = 1; w.rebuildStats();
    sim.machine.startWave();
    expect(t.secondCoreUsed).toBe(false);
    w.damageTower(1e6, -1, -1);
    expect(t.hp).toBe(1);
    expect(t.invulnT).toBe(180);
    expect(events(sim, (e) => e.type === Ev.SecondCore).length).toBe(1);
    w.damageTower(1e6, -1, -1);
    expect(t.hp).toBe(1);                                                  // invulnerable
    t.invulnT = 0;
    w.damageTower(1e6, -1, -1);
    expect(t.hp).toBe(0);                                                  // once per wave
    t.hp = t.maxHp;
    sim.machine.startWave();
    w.damageTower(1e6, -1, -1);
    expect(t.hp).toBe(1);
    expect(events(sim, (e) => e.type === Ev.SecondCore).length).toBe(2);
  });
});

describe('Bastion: determinism', () => {
  it('two fresh Sims with each Bastion doctrine hash identically', () => {
    for (const d of ['fortress', 'aegis', 'thorns', 'phoenix'] as const) {
      const run = (): number => {
        const sim = new Sim(null, 21);
        setup(sim, { doctrines: { bastion: d }, ranks: {
          'bastion.fortress.fortification': 2, 'bastion.fortress.keep': 1, 'bastion.aegis.barrier': 5, 'bastion.aegis.shockwave_shield': 2, 'bastion.aegis.mirror_aegis': 1,
          'bastion.thorns.retaliation': 5, 'bastion.thorns.reactive_armor': 2, 'bastion.thorns.spite': 1, 'bastion.phoenix.last_stand': 5, 'bastion.phoenix.rekindle': 2, 'bastion.phoenix.ember_heart': 1,
          'bastion.second_core': 1 } });
        sim.world.run.checkpoint = 15; sim.machine.startAttempt(false);
        sim.run(2400);
        return sim.events.hash();
      };
      expect(run()).toBe(run());
    }
  });
});
