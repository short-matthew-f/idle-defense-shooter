import { describe, it, expect } from 'vitest';
import type { Sim } from '../../src/sim/index';
import type { TargetingProfile } from '../../src/sim/core/ids';
import { TARGETING_PROFILES, pickDesignation, GroupFinder } from '../../src/sim/directives/targeting-profiles';
import { arena, dummy, tick, cmd } from './helpers';

function pick(sim: Sim, profile: TargetingProfile, x = 0, y = 0, range = 500): number {
  sim.world.rebuildSpatial();
  return sim.world.nearestEnemy(x, y, range, profile, 'primary');
}

describe('Targeting Profiles', () => {
  it('lists the eight profiles', () => { expect(TARGETING_PROFILES.length).toBe(8); });

  it('nearest: the closest enemy to the shooter', () => {
    const sim = arena();
    const a = dummy(sim, 100, 0); dummy(sim, 200, 0);
    expect(pick(sim, 'nearest')).toBe(a);
  });

  it('closest_to_tower: the enemy nearest the tower, not the shooter', () => {
    const sim = arena();
    dummy(sim, 250, 0); const b = dummy(sim, 100, 0);
    expect(pick(sim, 'nearest', 300, 0)).not.toBe(b);
    expect(pick(sim, 'closest_to_tower', 300, 0)).toBe(b);
  });

  it('lowest_hp', () => {
    const sim = arena();
    dummy(sim, 100, 0, 'grunt', 100); const b = dummy(sim, 200, 0, 'grunt', 5);
    expect(pick(sim, 'lowest_hp')).toBe(b);
  });

  it('highest_hp', () => {
    const sim = arena();
    dummy(sim, 100, 0, 'grunt', 5); const b = dummy(sim, 200, 0, 'grunt', 100);
    expect(pick(sim, 'highest_hp')).toBe(b);
  });

  it('elites first', () => {
    const sim = arena();
    dummy(sim, 100, 0); const el = dummy(sim, 250, 0, 'grunt', 10, ['swift']);
    expect(pick(sim, 'elites')).toBe(el);
  });

  it('support enemies first (healers, wardens)', () => {
    const sim = arena();
    dummy(sim, 100, 0); const h = dummy(sim, 250, 0, 'healer');
    expect(pick(sim, 'support')).toBe(h);
  });

  it('fastest first', () => {
    const sim = arena();
    const a = dummy(sim, 100, 0); const r = dummy(sim, 250, 0, 'runner');
    sim.world.enemies.speed[a] = 40; sim.world.enemies.speed[r] = 90;
    expect(pick(sim, 'fastest')).toBe(r);
  });

  it('designated: the designated enemy, else nearest', () => {
    const sim = arena();
    const a = dummy(sim, 100, 0); const far = dummy(sim, 300, 0);
    expect(pick(sim, 'designated')).toBe(a);
    tick(sim);
    cmd(sim, { type: 'designate', enemy: far });
    expect(pick(sim, 'designated')).toBe(far);
  });

  it('set_targeting stores the profile that Ballistics reads', () => {
    const sim = arena();
    cmd(sim, { type: 'set_targeting', system: 'primary', profile: 'highest_hp' });
    expect(sim.world.build.targeting.primary).toBe('highest_hp');
  });
});

describe('Directive pickers', () => {
  it('designation pickers find healers, wardens, kamikazes and the highest threat', () => {
    const sim = arena();
    dummy(sim, 60, 0);
    const heal = dummy(sim, 300, 0, 'healer');
    const ward = dummy(sim, -300, 0, 'warden');
    const kam = dummy(sim, 0, 300, 'kamikaze');
    const boss = dummy(sim, 0, -400, 'boss', 1);
    const w = sim.world;
    expect(pickDesignation(w, 'healer')).toBe(heal);
    expect(pickDesignation(w, 'warden')).toBe(ward);
    expect(pickDesignation(w, 'nearest_kamikaze')).toBe(kam);
    expect(pickDesignation(w, 'highest_threat')).toBe(boss);
    expect(pickDesignation(w, 'weak_point')).toBe(-1);
  });

  it('GroupFinder returns the densest cluster and its centroid', () => {
    const sim = arena();
    for (let k = 0; k < 8; k++) dummy(sim, 100 + k * 4, -200);
    for (let k = 0; k < 3; k++) dummy(sim, -200, 100 + k * 5);
    sim.world.rebuildSpatial();
    const out = new Float32Array(2);
    expect(new GroupFinder().largest(sim.world, 60, out)).toBe(8);
    expect(out[0]).toBeCloseTo(114, 0);
    expect(out[1]).toBeCloseTo(-200, 0);
  });
});
