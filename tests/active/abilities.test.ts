import { describe, it, expect } from 'vitest';
import { Ev, EnemyFlag, ProjKind, TICK_RATE } from '../../src/sim/core/types';
import type { AbilityId } from '../../src/sim/core/ids';
import { ABILITY_IDS, abilityCost, abilitySlotCount } from '../../src/sim/systems/abilities';
import { abilityDef } from '../../src/sim/core/content';
import { arena, slot, dummy, cmd, tick, casts, events, unlock, setTrial } from './helpers';

const cast = (ability: AbilityId, x = 200, y = 0, target?: number) => ({ type: 'cast' as const, ability, x, y, ...(target !== undefined ? { target } : {}) });

describe('tactical abilities: cast, CE, cooldown, Ev.Cast', () => {
  it('all ten abilities exist', () => { expect(ABILITY_IDS.length).toBe(10); });

  for (const id of ABILITY_IDS) {
    it(`${id} casts, spends CE, respects its cooldown and emits Ev.Cast`, () => {
      const sim = arena();
      const w = sim.world;
      slot(sim, id);
      const target = dummy(sim, 200, 0);
      dummy(sim, 90, 20);
      tick(sim);
      w.tower.hp = w.tower.maxHp * 0.5;
      const cost = abilityCost(w, id);
      expect(cost).toBe(abilityDef(id)!.cost);
      w.tower.ce = 100;
      expect(cmd(sim, cast(id, 200, 0, target))).toBeNull();
      const cs = casts(sim, id);
      expect(cs.length).toBe(1);
      expect(cs[0].b).toBeCloseTo(cost);
      expect(w.tower.ce).toBeCloseTo(100 - cost, 5);
      // still on cooldown, even with CE refilled
      w.tower.ce = 100;
      tick(sim, 2);
      expect(cmd(sim, cast(id, 200, 0, target))).toBe('On cooldown');
      expect(casts(sim, id).length).toBe(1);
      tick(sim, Math.ceil(abilityDef(id)!.cooldown * TICK_RATE));
      w.tower.ce = 100;
      const t2 = w.alive(target) ? target : dummy(sim, 200, 0);
      tick(sim);
      expect(cmd(sim, cast(id, 200, 0, t2))).toBeNull();
      expect(casts(sim, id).length).toBe(2);
    });
  }

  it('rejects unslotted abilities, insufficient CE, and casts outside combat', () => {
    const sim = arena();
    const w = sim.world;
    slot(sim, 'bombardment');
    expect(cmd(sim, cast('emp'))).toBe('Ability not slotted');
    w.tower.ce = 10;
    expect(cmd(sim, cast('bombardment'))).toBe('Not enough Command Energy');
    w.tower.ce = 100;
    w.run.phase = 'between';
    expect(cmd(sim, cast('bombardment'))).toBe('Only in combat');
    expect(casts(sim).length).toBe(0);
  });

  it('slots: 2 at start, 3 with Third Tactical Slot, 4 with the Command capstone', () => {
    const sim = arena();
    const w = sim.world;
    expect(abilitySlotCount(w)).toBe(2);
    expect(cmd(sim, { type: 'set_ability_slot', slot: 2, ability: 'emp' })).toBe('No such slot');
    unlock(sim, 'prestige.third_tactical_slot');
    expect(abilitySlotCount(w)).toBe(3);
    expect(cmd(sim, { type: 'set_ability_slot', slot: 2, ability: 'emp' })).toBeNull();
    expect(w.build.abilities[2]).toBe('emp');
    w.build.doctrines.reactor = 'command';
    w.build.ranks['reactor.command.fourth_slot'] = 1;
    w.rebuildStats();
    expect(abilitySlotCount(w)).toBe(4);
    expect(cmd(sim, { type: 'set_ability_slot', slot: 3, ability: 'overdrive' })).toBeNull();
    w.tower.ce = 100;
    expect(cmd(sim, cast('overdrive'))).toBeNull();
  });

  it('Commander trial halves costs; Blackout trial rejects casts, designation and manual aim', () => {
    const sim = arena();
    const w = sim.world;
    slot(sim, 'bombardment');
    setTrial(sim, 'commander');
    expect(abilityCost(w, 'bombardment')).toBe(20);
    setTrial(sim, 'blackout');
    const e = dummy(sim, 100, 0);
    tick(sim);
    expect(cmd(sim, cast('bombardment'))).toMatch(/Blackout/);
    expect(cmd(sim, { type: 'designate', enemy: e })).toMatch(/Blackout/);
    expect(cmd(sim, { type: 'manual_aim', active: true, angle: 1 })).toMatch(/Blackout/);
    expect(casts(sim).length).toBe(0);
    setTrial(sim, null);
    expect(cmd(sim, cast('bombardment'))).toBeNull();
  });
});

describe('ability effects', () => {
  it('Bombardment detonates after its fuse with srcTag ability.bombardment', () => {
    const sim = arena();
    slot(sim, 'bombardment');
    const a = dummy(sim, 200, 0), b = dummy(sim, 230, 10);
    tick(sim);
    cmd(sim, cast('bombardment', 210, 0));
    const castId = casts(sim)[0].id;
    tick(sim, 30);
    expect(events(sim, Ev.Hit, 'ability.bombardment').length).toBe(0);
    tick(sim, 10);
    const hits = events(sim, Ev.Hit, 'ability.bombardment');
    expect(new Set(hits.map((h) => h.a))).toEqual(new Set([a, b]));
    const ex = events(sim, Ev.Explosion, 'ability.bombardment');
    expect(ex.length).toBe(1);
    expect(ex[0].cause).toBe(castId);
    expect(hits[0].cause).toBe(ex[0].id);
  });

  it('Time Field slows enemies inside to 20% and leaves others alone', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    slot(sim, 'time_field');
    const inside = w.spawnEnemy('grunt', 300, 0, { hpScale: 100 });
    const outside = w.spawnEnemy('grunt', -300, 0, { hpScale: 100 });
    tick(sim);
    cmd(sim, cast('time_field', 300, 0));
    expect(w.hazards.some((h) => h.kind === 'time_field')).toBe(true);
    tick(sim, 2);
    expect(e.speedMul[inside]).toBeCloseTo(0.2, 5);
    expect(e.speedMul[outside]).toBe(1);
    // and in the full tick loop enemies really move slower
    const x0 = e.x[inside], x1 = -e.x[outside];
    sim.run(60);
    const movedIn = x0 - e.x[inside], movedOut = x1 + e.x[outside];
    expect(movedOut).toBeGreaterThan(10);
    expect(movedIn).toBeLessThan(movedOut * 0.35);
    // expires after its duration
    sim.run(6 * 60);
    tick(sim, 2);
    expect(e.speedMul[inside]).toBe(1);
  });

  it('EMP strips shields and interrupts elites and bosses', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    slot(sim, 'emp');
    const sh = dummy(sim, 150, 0, 'shielded');
    const el = dummy(sim, 0, 150, 'grunt', 10, ['hardened']);
    const far = dummy(sim, 400, 0, 'shielded');
    tick(sim);
    expect(e.shield[sh]).toBeGreaterThan(0);
    cmd(sim, cast('emp', 0, 0));
    expect(e.shield[sh]).toBe(0);
    expect(e.shield[far]).toBeGreaterThan(0);
    expect(e.flags[el] & EnemyFlag.Elite).toBeTruthy();
    expect(e.staggerT[el]).toBeGreaterThanOrEqual(3 * TICK_RATE - 1);
  });

  it('Repulsor Pulse pushes nearby enemies away from the tower', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    slot(sim, 'repulsor_pulse');
    const a = dummy(sim, 80, 0), b = dummy(sim, 0, -100), far = dummy(sim, 400, 0);
    tick(sim);
    cmd(sim, cast('repulsor_pulse', 0, 0));
    expect(e.x[a]).toBeGreaterThan(200);
    expect(e.y[b]).toBeLessThan(-200);
    expect(e.x[far]).toBe(400);
  });

  it('Overdrive doubles the primary fire rate', () => {
    const count = (od: boolean): number => {
      const sim = arena(1, { primary: true });
      slot(sim, 'overdrive');
      const w = sim.world;
      dummy(sim, 150, 0, 'grunt', 1e6);
      tick(sim, 90);   // turret settles
      if (od) cmd(sim, cast('overdrive', 0, 0));
      let n = 0;
      const orig = w.spawnProjectile.bind(w);
      w.spawnProjectile = (i) => { if (i.kind === ProjKind.Bullet && i.srcTag === 'ballistics') n++; return orig(i); };
      tick(sim, 2 * TICK_RATE);
      return n;
    };
    const base = count(false), fast = count(true);
    expect(base).toBeGreaterThanOrEqual(3);
    expect(fast).toBeGreaterThanOrEqual(base * 2 - 1);
    expect(fast).toBeLessThanOrEqual(base * 2 + 1);
  });

  it('Overdrive wears off', () => {
    const sim = arena();
    slot(sim, 'overdrive');
    cmd(sim, cast('overdrive', 0, 0));
    tick(sim);
    expect(sim.world.dynamicSpeedMul).toBe(2);
    tick(sim, 5 * TICK_RATE);
    expect(sim.world.dynamicSpeedMul).toBe(1);
  });

  it('Emergency Repair restores 30% max HP', () => {
    const sim = arena();
    const t = sim.world.tower;
    slot(sim, 'emergency_repair');
    t.hp = t.maxHp * 0.4;
    cmd(sim, cast('emergency_repair', 0, 0));
    expect(t.hp / t.maxHp).toBeCloseTo(0.7, 5);
    const heal = events(sim, Ev.Heal);
    expect(heal[heal.length - 1].cause).toBe(casts(sim)[0].id);
  });

  it('Hunter Mark designates and marks one enemy; the designation ends with the mark', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    slot(sim, 'hunter_mark');
    dummy(sim, 100, 0);
    const far = dummy(sim, 300, 0);
    tick(sim);
    cmd(sim, cast('hunter_mark', 300, 0, far));
    expect(w.tower.designated).toBe(far);
    expect(e.markedT[far]).toBeGreaterThan(0);   // contract: elements read markedT > 0 for +50% status application
    tick(sim, 8 * TICK_RATE + 2);
    expect(e.markedT[far]).toBe(0);
    expect(w.tower.designated).toBe(-1);
  });

  it('Singularity Bomb pulls enemies together, then explodes', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    slot(sim, 'singularity_bomb');
    const a = dummy(sim, 200, 100), b = dummy(sim, 200, -100);
    tick(sim);
    cmd(sim, cast('singularity_bomb', 200, 0));
    tick(sim, 60);
    expect(Math.abs(e.y[a])).toBeLessThan(40);
    expect(Math.abs(e.y[b])).toBeLessThan(40);
    expect(events(sim, Ev.Explosion, 'ability.singularity_bomb').length).toBe(0);
    tick(sim, 70);
    const hits = events(sim, Ev.Hit, 'ability.singularity_bomb');
    expect(new Set(hits.map((h) => h.a))).toEqual(new Set([a, b]));
  });

  it('Missile Storm and Drone Surge launch homing ability projectiles that hit as source "ability"', () => {
    for (const id of ['missile_storm', 'drone_surge'] as const) {
      const sim = arena();
      slot(sim, id);
      const target = dummy(sim, 220, 0, 'grunt', 1e5);
      tick(sim);
      const seen: string[] = [];
      sim.world.systems.push({ id: 'spy', init() {}, rebuild() {}, update() {}, onHit: (_w, h) => { if (h.srcTag === `ability.${id}`) seen.push(h.source); } });
      (sim.world as unknown as { setSystems(s: unknown[]): void }).setSystems(sim.world.systems);
      cmd(sim, cast(id, 220, 0));
      tick(sim, 4 * TICK_RATE + 60);
      const hits = events(sim, Ev.Hit, `ability.${id}`).filter((h) => h.a === target);
      expect(hits.length).toBeGreaterThan(id === 'missile_storm' ? 12 : 4);
      expect(seen.every((s) => s === 'ability')).toBe(true);
    }
  });
});
