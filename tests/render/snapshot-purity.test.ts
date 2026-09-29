/**
 * Graphics pass, hard rule: snapshot() is presentation only. The event hash, the combat PRNG, enemy
 * state and the tower after N ticks are identical whether snapshot() runs every tick, now and then,
 * or never, with a build that exercises every hardpoint's and element's render().
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/index';
import { Ev, InstFlag, INST_FLAG_SCALE, INSTANCE_FLOATS } from '../../src/sim/core/types';

function build(seed: number): Sim {
  const sim = new Sim(null, seed);
  const w = sim.world, s = w.stats;
  s.override('ballistics.damage', 40);
  s.override('ballistics.attack_speed', 6);
  s.override('ballistics.range', 700);
  s.override('bastion.max_hp', 1e9);
  w.run.hardpointSlotsOpen = 4;
  w.run.attunementSlotsOpen = 2;
  w.build.hardpoints = ['ordnance', 'drones', 'blade', 'laser'];
  w.build.attunements = ['fire', 'frost'];
  w.rebuildStats(); w.tower.hp = w.tower.maxHp;
  w.run.wave = 24; w.run.checkpoint = 20;
  sim.machine.startWave();
  return sim;
}

function run(seed: number, every: number, ticks: number): { sim: Sim; kinds: Set<number>; chains: number; parts: number } {
  const sim = build(seed);
  const kinds = new Set<number>();
  let chains = 0, parts = 0;
  for (let t = 0; t < ticks; t++) {
    sim.step();
    if (every > 0 && t % every === 0) {
      const snap = sim.snapshot();
      for (let i = 0; i < snap.instanceCount; i++) {
        const L = snap.instances[i * INSTANCE_FLOATS + 9];
        if (L >= INST_FLAG_SCALE) {
          const f = (L + 0.5) >> 3;
          if (f & InstFlag.Chain) chains++;
          if (f & InstFlag.Part) parts++;
        }
      }
      for (let i = 0; i < snap.fxCount; i++) kinds.add(snap.fx[i * 8]);
    }
  }
  return { sim, kinds, chains, parts };
}

describe('snapshot purity (graphics pass)', () => {
  it('events.hash(), PRNG, enemies and tower are identical with snapshot() every tick, every 7 ticks, or never', () => {
    const T = 2400;
    const never = run(5, 0, T);
    const every = run(5, 1, T);
    const some = run(5, 7, T);
    for (const r of [every, some]) {
      expect(r.sim.events.hash()).toBe(never.sim.events.hash());
      expect(r.sim.events.nextId).toBe(never.sim.events.nextId);
      expect(r.sim.world.prng.state()).toEqual(never.sim.world.prng.state());
      expect(r.sim.world.enemies.count).toBe(never.sim.world.enemies.count);
      expect(Array.from(r.sim.world.enemies.hp.subarray(0, r.sim.world.enemies.count))).toEqual(Array.from(never.sim.world.enemies.hp.subarray(0, never.sim.world.enemies.count)));
      expect(r.sim.world.tower.hp).toBe(never.sim.world.tower.hp);
      expect(r.sim.world.run.scrap).toBe(never.sim.world.run.scrap);
    }
    // the scenario really exercised the new presentation paths
    let kills = 0;
    never.sim.events.forEachSince(0, (e) => { if (e.type === Ev.Kill) kills++; });
    expect(kills).toBeGreaterThan(10);
    expect(every.parts).toBeGreaterThan(0);
    expect(every.kinds.size).toBeGreaterThan(3);
  }, 60_000);

  it('two snapshots of the same tick are identical (no hidden sim mutation between them)', () => {
    const sim = build(9);
    sim.run(900);
    const a = sim.snapshot();
    const copyA = Array.from(a.instances.subarray(0, a.instanceCount * INSTANCE_FLOATS));
    const hash = sim.events.hash();
    const b = sim.snapshot();
    expect(sim.events.hash()).toBe(hash);
    // bodies, outlines and parts are rebuilt identically; only frame-based fades (chain lines, flashes) may advance
    expect(b.instanceCount).toBeGreaterThan(0);
    let bodiesA = 0, bodiesB = 0;
    for (let i = 0; i < a.instanceCount; i++) if (copyA[i * INSTANCE_FLOATS + 9] === 4) bodiesA++;
    for (let i = 0; i < b.instanceCount; i++) if (b.instances[i * INSTANCE_FLOATS + 9] === 4) bodiesB++;
    expect(bodiesB).toBe(bodiesA);
    expect(bodiesA).toBe(sim.world.enemies.count - countDead(sim));
  });
});

function countDead(sim: Sim): number {
  const e = sim.world.enemies;
  let n = 0;
  for (let i = 0; i < e.count; i++) if (e.flags[i] & (1 << 15)) n++;
  return n;
}
