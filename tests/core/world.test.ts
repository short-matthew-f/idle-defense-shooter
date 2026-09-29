import { describe, it, expect } from 'vitest';
import { Ev, EnemyFlag } from '../../src/sim/core/types';
import { quietSim, combatTick } from './helpers';
import { scrapPerKill } from '../../src/sim/economy/curves';

describe('World combat primitives', () => {
  it('damage: armor formula, shields first, Hit/Kill events, Scrap ×3 on first clear, CE', () => {
    const sim = quietSim();
    const w = sim.world;
    const i = w.spawnEnemy('grunt', 100, 0, { hpScale: 100 });
    w.enemies.armor[i] = 100; w.enemies.shield[i] = 20;
    const hp0 = w.enemies.hp[i];
    const h = w.damage(i, 100, { source: 'primary', srcTag: 'ballistics', cause: -1 });
    expect(h.damage).toBeCloseTo(50, 5);
    expect(w.enemies.shield[i]).toBe(0);
    expect(w.enemies.hp[i]).toBeCloseTo(hp0 - 30, 4);
    expect(w.events.byId(h.eventId)!.type).toBe(Ev.Hit);
    const scrap0 = w.run.scrap;
    const k = w.damage(i, 1e9, { source: 'primary', srcTag: 'ballistics', cause: -1, trueDamage: true });
    expect(k.killed).toBe(true);
    expect(w.enemies.flags[i] & EnemyFlag.Dead).toBeTruthy();
    expect(w.run.scrap - scrap0).toBeCloseTo(scrapPerKill(w.run.wave, 1) * 3, 6);
    expect(w.tower.ce).toBe(1);   // balance pass: ordinary kill CE 2 → 1
    const kill = w.events.recent(0).find((e) => e.type === Ev.Kill)!;
    expect(kill.cause).toBe(k.eventId);
    // dead enemies take no damage; compaction removes them at end of tick
    expect(w.damage(i, 10, { source: 'primary', srcTag: 'x', cause: -1 }).damage).toBe(0);
    w.endTick();
    expect(w.enemies.count).toBe(0);
  });

  it('applyStatus respects caps (+Overflow +20%/rank) and chains DoT kills to the StatusApply', () => {
    const sim = quietSim();
    const w = sim.world;
    const i = w.spawnEnemy('grunt', 100, 0, { hpScale: 50 });
    w.applyStatus(i, 'burn', 15, 600, 'fire', -1, 1);
    expect(w.enemies.burn[i]).toBe(10);
    w.applyStatus(i, 'chill', 9, 600, 'frost', -1);
    expect(w.enemies.chill[i]).toBe(5);
    w.meta.prestigeRanks['prestige.overflow'] = 1; w.rebuildStats();
    expect(w.statusCap('chill')).toBe(6);            // floor(5 × 1.2)
    expect(w.statusCap('burn')).toBe(12);            // floor(10 × 1.2)
    w.meta.prestigeRanks['prestige.overflow'] = 5; w.rebuildStats();
    expect(w.statusCap('chill')).toBe(10);           // 5 × 2.0
    expect(w.statusCap('brittle')).toBe(6);          // 3 × 2.0
    w.meta.prestigeRanks['prestige.overflow'] = 1; w.rebuildStats();
    expect(w.statusCap('marked')).toBe(2);           // min +1 at rank 1 (floor(1.2) = 1)
    w.applyStatus(i, 'chill', 9, 600, 'frost', -1);
    expect(w.enemies.chill[i]).toBe(6);
    combatTick(sim);
    expect(w.enemies.speedMul[i]).toBeGreaterThan(0);
    expect(w.enemies.speedMul[i]).toBeLessThan(0.5);
    // poison until death: kill cause is the latest poison StatusApply
    w.applyStatus(i, 'poison', 20, 60000, 'poison', -1, w.enemies.maxHp[i] / 20);
    const applyId = w.enemies.poisonCause[i];
    let ticks = 0;
    while (w.alive(i) && ticks++ < 600) combatTick(sim);
    const kill = w.events.recent(0).find((e) => e.type === Ev.Kill)!;
    expect(kill).toBeTruthy();
    expect([applyId, w.enemies.burnCause[i]]).toContain(kill.cause);
    const statusTicks = w.events.recent(0).filter((e) => e.type === Ev.StatusTick && e.src === 'poison');
    expect(statusTicks.length).toBeLessThanOrEqual(Math.ceil(ticks / 60) + 1);
  });

  it('explode damages with falloff; knockback skips Immovable; freeze stops movement', () => {
    const sim = quietSim();
    const w = sim.world;
    const a = w.spawnEnemy('grunt', 0, 200, { hpScale: 100 });
    const b = w.spawnEnemy('grunt', 0, 280, { hpScale: 100 });
    w.rebuildSpatial();
    const ha = w.enemies.hp[a], hb = w.enemies.hp[b];
    w.explode(0, 200, 100, 100, { source: 'ability', srcTag: 'ability.bombardment', cause: -1 });
    expect(ha - w.enemies.hp[a]).toBeCloseTo(100, 4);
    expect(hb - w.enemies.hp[b]).toBeGreaterThan(40);
    expect(hb - w.enemies.hp[b]).toBeLessThan(100);
    w.knockback(a, 0, 1, 30);
    expect(w.enemies.y[a]).toBeCloseTo(230, 4);
    w.enemies.flags[b] |= EnemyFlag.Immovable;
    w.knockback(b, 0, 1, 30);
    expect(w.enemies.y[b]).toBeCloseTo(280, 4);
    w.freeze(b, 60, 'frost', -1);
    expect(w.enemies.frozenT[b]).toBe(0);            // Immovable is immune to freeze
    w.freeze(a, 60, 'frost', -1);
    combatTick(sim);
    expect(w.enemies.speedMul[a]).toBe(0);
  });

  it('damageTower: armor/resistance, shields first, Second Core once per wave', () => {
    const sim = quietSim();
    const w = sim.world, t = w.tower;
    w.stats.override('bastion.armor', 100);
    w.rebuildStats();
    t.hp = 100; t.shield = 10;
    w.damageTower(40, -1, -1);
    expect(t.shield).toBe(0);
    expect(t.hp).toBeCloseTo(90, 5);
    w.build.ranks['bastion.second_core'] = 1; w.rebuildStats();
    w.damageTower(1e9, -1, -1);
    expect(t.hp).toBe(1);
    expect(t.invulnT).toBe(180);
    w.damageTower(1e9, -1, -1);
    expect(t.hp).toBe(1);                              // invulnerable
    t.invulnT = 0;
    w.damageTower(1e9, -1, -1);
    expect(t.hp).toBe(0);
  });
});
