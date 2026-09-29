import { describe, it, expect } from 'vitest';
import type { Sim } from '../../src/sim/index';
import { Ev, EnemyFlag, ProjFlag, ProjKind, ARENA_RADIUS } from '../../src/sim/core/types';
import { combatTick } from '../core/helpers';
import { calmSim, cmd, eventsSrc, socket } from './helpers';
import { betweenWaveHeal } from '../../src/sim/systems/tower';
import { doctrineChoice } from '../../src/sim/economy/shop';
import { treeDef } from '../../src/sim/core/content';
import { ANOMALIES } from '../../src/sim/data/anomalies';

function tough(sim: Sim, x: number, y: number, hp = 1e9): number {
  const w = sim.world;
  const i = w.spawnEnemy('grunt', x, y, { cause: -1 });
  w.enemies.hp[i] = w.enemies.maxHp[i] = hp;
  w.enemies.armor[i] = 0; w.enemies.shield[i] = 0;
  w.rebuildSpatial();
  return i;
}
function bullet(sim: Sim, x: number, y: number, vx: number, vy: number, extra: Record<string, number> = {}): number {
  return sim.world.spawnProjectile({ kind: ProjKind.Bullet, source: 0, srcTag: 'ballistics', x, y, vx, vy, damage: 10, radius: 3, life: 120, cause: -1, ...extra });
}
function ticks(sim: Sim, n: number): void { for (let k = 0; k < n; k++) combatTick(sim); }

describe('Anomaly stat effects resolve through the StatResolver', () => {
  const cases: [string, string, (base: number) => number][] = [
    ['mirror_node', 'laser.damage', (b) => b * 0.6],
    ['cold_iron', 'frost.chill_armor_shred', (b) => b + 0.01],
    ['heavy_water', 'poison.damage', (b) => b * 1.5],
    ['overcharged_capacitor', 'economy.ce_cap', (b) => b * 1.5],
    ['glass_cannon', 'combat.power_mul', (b) => b * 1.8],
    ['unstable_isotope', 'combat.blast_radius_mul', (b) => b + 0.5],
    ['tithe', 'economy.boss_cores', (b) => b + 1],
    ['hungry_core', 'bastion.kill_heal', (b) => b + 0.01],
    ['smolder', 'poison.duration', (b) => b * 1.4],
    ['martyr_plating', 'bastion.thorns.retaliation_mul', (b) => b + 2],
    ['feedback_loop', 'economy.ce_cap', (b) => b * 0.6],
  ];
  for (const [id, key, f] of cases) {
    it(`${id} → ${key}`, () => {
      const sim = calmSim();
      const base = sim.world.stats.get(key);
      socket(sim, id as never);
      expect(sim.world.stats.get(key)).toBeCloseTo(f(base), 6);
    });
  }
  it('all 25 anomalies exist in data', () => { expect(ANOMALIES.length).toBe(25); });
});

describe('Paradox anomalies bend commitment rules', () => {
  it('Spare Barrel: a second Barrel Doctrine at 50%', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'spare_barrel');
    w.build.doctrines.ballistics = 'piercing';
    w.build.secondDoctrines.ballistics = 'ricochet';
    w.rebuildStats();
    expect(w.stats.doctrineStrength('ballistics', 'ricochet')).toBe(0.5);
    expect(w.stats.hasDoctrine('ballistics', 'ricochet')).toBe(true);
  });
  it('Borrowed Blade: the blade is mounted without a slot, tier 1 only, no Doctrines', () => {
    const sim = calmSim();
    const w = sim.world;
    expect(w.stats.mounted('blade')).toBe(false);
    socket(sim, 'borrowed_blade');
    expect(w.stats.mounted('blade')).toBe(true);
    expect(w.stats.borrowed('blade')).toBe(true);
    expect(w.build.hardpoints.includes('blade')).toBe(false);
    const t = treeDef('blade')!;
    for (const n of t.shared) w.build.ranks[n.id] = 1;
    w.rebuildStats();
    expect(doctrineChoice(w, 'blade', t.doctrines[0].id).locked).toMatch(/Borrowed/);
    expect(w.stats.rank(t.exotic.id)).toBe(0);
  });
  it('Recursive Warhead: Cluster Warheads without the Exotic', () => {
    const sim = calmSim();
    const w = sim.world;
    w.build.hardpoints.push('ordnance');
    w.rebuildStats();
    expect(w.stats.has('ordnance.cluster_warheads')).toBe(false);
    socket(sim, 'recursive_warhead');
    expect(w.stats.has('ordnance.cluster_warheads')).toBe(true);
  });
});

describe('Rare / Common / Cursed mechanics', () => {
  it('Loaded Dice re-rolls failed crits', () => {
    const sim = calmSim(4);
    socket(sim, 'loaded_dice');
    tough(sim, 120, 0);
    for (let k = 0; k < 60; k++) bullet(sim, 20, 0, 400, 0, { critChance: 0.3 });
    ticks(sim, 30);
    expect(eventsSrc(sim, 'anomaly.loaded_dice')).toBeGreaterThan(0);
  });

  it('Seventh Shot turns every 7th primary shot into a burning Fireball', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'seventh_shot');
    const e = tough(sim, 150, 0);
    const ids: number[] = [];
    for (let k = 0; k < 7; k++) ids.push(bullet(sim, 20, 0, 400, 0));
    combatTick(sim);
    const p = w.projectiles;
    let fireballs = 0;
    for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.Fireball && p.blast[i] > 0) fireballs++;
    expect(fireballs).toBe(1);
    expect(eventsSrc(sim, 'anomaly.seventh_shot')).toBeGreaterThan(0);
    ticks(sim, 40);
    expect(w.enemies.burn[e] > 0 || sim.events.recent(0).some((ev) => ev.type === Ev.StatusApply && ev.src === 'anomaly.seventh_shot')).toBe(true);
  });

  it('Pinball rebounds bouncing shots off the arena edge', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'pinball');
    const i = bullet(sim, ARENA_RADIUS - 2, 0, 400, 0, { bounces: 2, life: 200 });
    combatTick(sim);
    expect(w.projectiles.vx[i]).toBeLessThan(0);
    expect(w.projectiles.bounces[i]).toBe(2);
    expect(eventsSrc(sim, 'anomaly.pinball')).toBe(1);
  });

  it('Stormglass: lightning on a frozen enemy arcs at double range', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'stormglass');
    const a = tough(sim, 100, 0), b = tough(sim, 100, 180);
    w.freeze(a, 600, 'frost', -1);
    const hp = w.enemies.hp[b];
    w.damage(a, 100, { source: 'element', srcTag: 'lightning', element: 'lightning', cause: -1 });
    expect(w.enemies.hp[b]).toBeLessThan(hp);
    expect(eventsSrc(sim, 'anomaly.stormglass')).toBe(1);
  });

  it('Clockwork Blade reverses every 6 s with a knockback shockwave', () => {
    const sim = calmSim();
    const w = sim.world;
    w.build.hardpoints.push('blade');
    socket(sim, 'clockwork_blade');
    const e = tough(sim, 60, 0);
    w.run.attemptTick = 6 * 60;
    combatTick(sim);
    expect(w.signals.bladeDir).toBe(-1);
    expect(w.enemies.x[e]).toBeGreaterThan(60);
    expect(eventsSrc(sim, 'anomaly.clockwork_blade')).toBeGreaterThan(0);
  });

  it('Ghost Protocol: drone kills fight for the tower', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'ghost_protocol');
    const victim = w.spawnEnemy('grunt', 200, 0, { cause: -1 });
    tough(sim, 230, 0);
    w.damage(victim, 1e9, { source: 'drones', srcTag: 'drones', cause: -1 });
    ticks(sim, 60);
    expect(sim.events.recent(0).some((ev) => ev.type === Ev.Hit && ev.src === 'anomaly.ghost_protocol')).toBe(true);
  });

  it('Rogue Moon: orbiting mass with contact damage and a weak pull', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'rogue_moon');
    w.run.phase = 'combat'; w.run.attemptTick = 0;
    const e = tough(sim, 380, 0, 1e6);
    const far = tough(sim, 380, 100, 1e6);
    combatTick(sim);
    expect(w.enemies.hp[e]).toBeLessThan(1e6);
    expect(w.enemies.y[far]).toBeLessThan(100);
    expect(sim.snapshot().instanceCount).toBeGreaterThan(0);
  });

  it('Second Opinion grants the second designator', () => {
    const sim = calmSim();
    const e = tough(sim, 100, 0);
    expect(cmd(sim, { type: 'designate', enemy: e, slot: 1 })).not.toBeNull();
    socket(sim, 'second_opinion');
    expect(cmd(sim, { type: 'designate', enemy: e, slot: 1 })).toBeNull();
    expect(sim.world.tower.designated2).toBe(e);
  });

  it('Unstable Isotope: some explosions detonate on the tower', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'unstable_isotope');
    w.stats.override('anomaly.unstable_isotope.self_chance', 1);
    w.rebuildStats();
    const hp = w.tower.hp;
    w.explode(200, 0, 40, 100, { source: 'ordnance', srcTag: 'ordnance', cause: -1 });
    combatTick(sim);
    expect(w.tower.hp).toBeLessThan(hp);
    expect(eventsSrc(sim, 'anomaly.unstable_isotope')).toBe(1);
  });

  it('Tithe: no heal between waves; Hungry Core: kills heal, nothing else does', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'tithe');
    w.tower.hp = 50;
    betweenWaveHeal(w);
    expect(w.tower.hp).toBe(50);
    const sim2 = calmSim();
    const w2 = sim2.world;
    socket(sim2, 'hungry_core');
    w2.tower.hp = 50;
    w2.healTower(30, -1);
    expect(w2.tower.hp).toBe(50);
    const v = w2.spawnEnemy('grunt', 100, 0, { cause: -1 });
    w2.damage(v, 1e9, { source: 'primary', srcTag: 'ballistics', cause: -1 });
    expect(w2.tower.hp).toBeCloseTo(50 + w2.tower.maxHp * 0.01, 6);
  });

  it('Afterimage Round: primary shots fire again 0.4 s later', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'afterimage_round');
    bullet(sim, 20, 0, 400, 0, { life: 200 });
    ticks(sim, 30);
    let echoes = 0;
    for (let i = 0; i < w.projectiles.count; i++) if (w.projectiles.flags[i] & ProjFlag.Echo) echoes++;
    expect(echoes).toBe(1);
    expect(eventsSrc(sim, 'anomaly.afterimage_round')).toBe(1);
  });

  it('Echo Chamber: explosions repeat 0.5 s later', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'echo_chamber');
    w.explode(200, 0, 40, 100, { source: 'ordnance', srcTag: 'ordnance', cause: -1 });
    ticks(sim, 35);
    const ex = sim.events.recent(0).filter((e) => e.type === Ev.Explosion && e.src === 'anomaly.echo_chamber');
    expect(ex.length).toBe(1);
    expect(ex[0].a).toBeCloseTo(28, 3);
  });

  it('Feedback Loop: a cast repeats its damage at 50% one second later', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'feedback_loop');
    const e = tough(sim, 100, 0, 1e6);
    const cast = w.emit(Ev.Cast, 'ability.bombardment', 3, 0, 100, 0, -1);
    combatTick(sim);
    w.damage(e, 1000, { source: 'ability', srcTag: 'ability.bombardment', cause: cast });
    const after = w.enemies.hp[e];
    ticks(sim, 62);
    expect(after - w.enemies.hp[e]).toBeGreaterThan(0);
    expect(sim.events.recent(0).some((ev) => ev.type === Ev.Hit && ev.src === 'anomaly.feedback_loop')).toBe(true);
  });

  it('Rot Bloom: poisoned deaths leave a poisoning cloud', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'rot_bloom');
    const v = w.spawnEnemy('grunt', 150, 0, { cause: -1 });
    const n = tough(sim, 170, 0);
    w.applyStatus(v, 'poison', 1, 300, 'poison', -1);
    w.damage(v, 1e9, { source: 'primary', srcTag: 'ballistics', cause: -1 });
    ticks(sim, 65);
    expect(sim.events.recent(0).some((ev) => ev.type === Ev.StatusApply && ev.src === 'anomaly.rot_bloom')).toBe(true);
    let poisoned = 0;
    for (let i = 0; i < w.enemies.count; i++) poisoned += w.enemies.poison[i];
    expect(n).toBeGreaterThanOrEqual(0);
    expect(poisoned).toBeGreaterThan(0);
  });

  it('Martyr Plating: tower hits retaliate even without Thorns', () => {
    const sim = calmSim();
    const w = sim.world;
    socket(sim, 'martyr_plating');
    expect(w.stats.get('bastion.armor')).toBe(0);
    const e = tough(sim, 30, 0, 1e6);
    w.damageTower(10, e, -1);
    expect(w.enemies.hp[e]).toBeLessThan(1e6);
    expect(sim.events.recent(0).some((ev) => ev.type === Ev.Hit && ev.src === 'anomaly.martyr_plating')).toBe(true);
  });
});

describe('Prestige IV combat nodes', () => {
  it('Duplication copies primary shots; Held Open keeps weak points exposed', () => {
    const sim = calmSim();
    const w = sim.world;
    w.meta.prestigeRanks['prestige.duplication'] = 10;
    w.stats.override('prestige.duplication', 1);
    w.rebuildStats();
    bullet(sim, 20, 0, 400, 0);
    combatTick(sim);
    let dups = 0;
    for (let i = 0; i < w.projectiles.count; i++) if (w.projectiles.flags[i] & ProjFlag.Duplicate) dups++;
    expect(dups).toBe(1);

    w.meta.prestigeRanks['prestige.held_open'] = 2;
    w.rebuildStats();
    const b = w.spawnEnemy('boss', 300, 0, { bossId: 'breaker', cause: -1 });
    w.enemies.flags[b] |= EnemyFlag.WeakPointOpen;
    combatTick(sim);
    w.enemies.flags[b] &= ~EnemyFlag.WeakPointOpen;   // the boss script closes it
    combatTick(sim);
    expect(w.enemies.flags[b] & EnemyFlag.WeakPointOpen).not.toBe(0);
    ticks(sim, 60);
    expect(w.enemies.flags[b] & EnemyFlag.WeakPointOpen).toBe(0);
  });
});
