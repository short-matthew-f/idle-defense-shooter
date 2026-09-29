import { describe, it, expect } from 'vitest';
import { Ev, ProjFlag, ProjKind, TICK_RATE } from '../../src/sim/core/types';
import { arena, dummy, cmd, tick, events } from './helpers';

describe('Command Energy', () => {
  it('fills on kills (+1) and elite kills (+12) and caps at economy.ce_cap', () => {   // balance pass: ordinary kills were +2
    const sim = arena();
    const w = sim.world, t = w.tower;
    t.ce = 0;
    const a = dummy(sim, 200, 0, 'grunt', 1);
    w.damage(a, 1e9, { source: 'primary', srcTag: 'test', cause: -1 });
    expect(t.ce).toBeCloseTo(1);
    const el = dummy(sim, 200, 50, 'grunt', 1, ['hardened']);
    w.damage(el, 1e9, { source: 'primary', srcTag: 'test', cause: -1 });
    expect(t.ce).toBeCloseTo(13);
    t.ce = t.ceCap - 1;
    const b = dummy(sim, 200, 90, 'grunt', 1);
    w.damage(b, 1e9, { source: 'primary', srcTag: 'test', cause: -1 });
    expect(t.ce).toBe(t.ceCap);
  });

  it('fills +1/s while the tower is below 25% HP, only in combat', () => {
    const sim = arena();
    const t = sim.world.tower;
    t.ce = 0; t.hp = t.maxHp * 0.2;
    tick(sim, TICK_RATE);
    expect(t.ce).toBeCloseTo(1, 3);
    t.hp = t.maxHp * 0.5;
    tick(sim, TICK_RATE);
    expect(t.ce).toBeCloseTo(1, 3);
    sim.world.run.phase = 'between';
    t.hp = t.maxHp * 0.2;
    tick(sim, TICK_RATE);
    expect(t.ce).toBeCloseTo(1, 3);
  });

  it('boss phase changes pay +15', () => {
    const sim = arena();
    const w = sim.world;
    const boss = dummy(sim, 300, 0, 'boss', 1);
    tick(sim);
    w.tower.ce = 0;
    w.enemies.bossPhase[boss] = 1;
    w.emit(Ev.BossPhase, 'breaker', boss, 1, 0, 0, -1);
    tick(sim);
    expect(w.tower.ce).toBeCloseTo(15);
    tick(sim, 10);
    expect(w.tower.ce).toBeCloseTo(15);
  });

  it('Command doctrine: Capacitor Array raises the cap, Trickle Charge regenerates', () => {
    const sim = arena();
    const w = sim.world, t = w.tower;
    w.build.doctrines.reactor = 'command';
    w.build.ranks['reactor.command.ce_cap'] = 2;
    w.build.ranks['reactor.command.ce_regen'] = 4;
    w.rebuildStats();
    expect(t.ceCap).toBe(120);
    t.ce = 0;
    tick(sim, 2 * TICK_RATE);
    expect(t.ce).toBeCloseTo(2, 2);
  });

  it('empties on death (new attempt)', () => {
    const sim = arena();
    const w = sim.world, t = w.tower;
    t.ce = 60;
    t.hp = 1;
    w.damageTower(1e9, -1, -1);
    sim.run(3 * TICK_RATE);
    expect(w.run.attempts).toBeGreaterThanOrEqual(2);
    expect(t.ce).toBeLessThan(5);
  });
});

describe('Target Designator and manual aim', () => {
  it('every weapon prefers the designated enemy, including a boss with an open weak point', () => {
    const sim = arena(1, { primary: true });
    const w = sim.world;
    const near = dummy(sim, 80, 0, 'grunt', 1e5);
    const boss = dummy(sim, -200, 0, 'boss', 1);
    tick(sim);
    expect(cmd(sim, { type: 'designate', enemy: boss })).toBeNull();
    expect(w.tower.designated).toBe(boss);
    expect(w.nearestEnemy(0, 0, 300, 'nearest', 'primary')).toBe(boss);
    tick(sim, 3 * TICK_RATE);
    const hits = events(sim, Ev.Hit, 'ballistics');
    expect(hits.some((h) => h.a === boss)).toBe(true);
    expect(hits.some((h) => h.a === near)).toBe(false);
  });

  it('slot 1 fills the second designator only with Second Opinion or the Commander reward', () => {
    const sim = arena();
    const w = sim.world;
    const a = dummy(sim, 100, 0), b = dummy(sim, -100, 0);
    tick(sim);
    expect(cmd(sim, { type: 'designate', enemy: a, slot: 1 })).toBe('No second designator');
    expect(w.tower.designated2).toBe(-1);
    w.build.anomalies.push('second_opinion');
    w.rebuildStats();
    expect(cmd(sim, { type: 'designate', enemy: a, slot: 1 })).toBeNull();
    expect(w.tower.designated2).toBe(a);
    w.build.anomalies.length = 0;
    w.meta.trials.commander = 1;
    w.rebuildStats();
    expect(cmd(sim, { type: 'designate', enemy: b, slot: 1 })).toBeNull();
    expect(w.tower.designated2).toBe(b);
  });

  it('manual aim steers the primary (+Manual flag) and automatic fire resumes on release', () => {
    const sim = arena(1, { primary: true });
    const w = sim.world;
    const e = dummy(sim, 150, 0, 'grunt', 1e5);
    const shots: { flags: number; vy: number }[] = [];
    const orig = w.spawnProjectile.bind(w);
    w.spawnProjectile = (i) => { if (i.kind === ProjKind.Bullet) shots.push({ flags: i.flags ?? 0, vy: i.vy ?? 0 }); return orig(i); };
    cmd(sim, { type: 'manual_aim', active: true, angle: Math.PI / 2 });
    tick(sim, 2 * TICK_RATE);
    expect(shots.length).toBeGreaterThan(2);
    const late = shots.slice(-2);
    expect(late.every((s) => (s.flags & ProjFlag.Manual) !== 0 && s.vy > 0)).toBe(true);
    expect(events(sim, Ev.Hit, 'ballistics').filter((h) => h.a === e).length).toBe(0);
    cmd(sim, { type: 'manual_aim', active: false, angle: 0 });
    shots.length = 0;
    tick(sim, 2 * TICK_RATE);
    expect(shots.length).toBeGreaterThan(2);
    expect(shots.every((s) => (s.flags & ProjFlag.Manual) === 0)).toBe(true);
    expect(events(sim, Ev.Hit, 'ballistics').filter((h) => h.a === e).length).toBeGreaterThan(0);
  });
});
