import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { EnemyFlag, Ev, TICK_RATE } from '../../src/sim/core/types';
import type { SimEvent } from '../../src/sim/core/types';
import { generateWave } from '../../src/sim/enemies/generator';
import { MOD } from '../../src/sim/enemies/elites';

function arena(seed = 1, wave = 30): Sim {
  const sim = new Sim(null, seed);
  const w = sim.world;
  w.clearCombat();
  w.wave = null;
  sim.machine.setPhase('combat');
  w.run.wave = wave;
  w.stats.override('bastion.max_hp', 1e12);
  w.stats.override('ballistics.damage', 0);
  w.stats.override('ballistics.range', 0);
  w.stats.override('wave.stall_seconds', 1e6);   // behaviors in isolation: nothing here damages them, which is not a stall
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  return sim;
}

/** Shield / HP regeneration and outward knockback only work inside the primary's range (enemies/recovery.ts, core/forces.ts). */
function reach(sim: Sim, range = 600): void { sim.world.stats.override('ballistics.range', range); sim.world.rebuildStats(); }
function find(sim: Sim, gen: number): number {
  const e = sim.world.enemies;
  for (let i = 0; i < e.count; i++) if (e.gen[i] === gen && !(e.flags[i] & EnemyFlag.Dead)) return i;
  return -1;
}
function since(sim: Sim, from: number, type: number): SimEvent[] {
  const out: SimEvent[] = [];
  sim.events.forEachSince(from, (e) => { if (e.type === type) out.push({ ...e }); });
  return out;
}

describe('elite modifiers', () => {
  it('spawn-time modifiers: hardened, swift, shielded_elite, anchored, jamming, refracting; larger radius', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    const plain = w.spawnEnemy('grunt', 480, 0, { cause: -1 });
    const i = w.spawnEnemy('grunt', -480, 0, { cause: -1, elite: ['hardened', 'swift', 'shielded_elite', 'anchored', 'jamming', 'refracting'] });
    const gen = e.gen[i], pgen = e.gen[plain];
    const r0 = e.radius[i], sp0 = e.speed[i];
    sim.step();
    const j = find(sim, gen), p = find(sim, pgen);
    expect(e.flags[j] & EnemyFlag.Elite).toBeTruthy();
    expect(e.hp[j]).toBeCloseTo(e.hp[p] * 2.5, 0);
    expect(e.radius[j]).toBeCloseTo(r0 * 1.2, 4);
    expect(e.armor[j]).toBeGreaterThanOrEqual(40);
    expect(e.speed[j]).toBeCloseTo(sp0 * 1.4, 4);
    expect(e.shield[j]).toBeCloseTo(e.maxHp[j] * 0.6, 0);
    const f = e.flags[j];
    expect(f & EnemyFlag.Immovable).toBeTruthy();
    expect(f & EnemyFlag.Jams).toBeTruthy();
    expect(f & EnemyFlag.Refracts).toBeTruthy();
    expect(e.flags[p] & (EnemyFlag.Elite | EnemyFlag.Immovable)).toBe(0);
  });

  it('regenerating heals when not hit; phasing blinks', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    reach(sim);
    const i = w.spawnEnemy('brute', 480, 0, { cause: -1, elite: ['regenerating', 'phasing'] });
    const gen = e.gen[i];
    w.damage(i, e.maxHp[i] * 0.5, { source: 'primary', srcTag: 'test', cause: -1 });
    const low = e.hp[i];
    let phased = 0;
    for (let t = 0; t < 240; t++) { sim.step(); if (e.flags[find(sim, gen)] & EnemyFlag.Phased) phased++; }
    expect(e.hp[find(sim, gen)]).toBeGreaterThan(low);
    expect(phased).toBeGreaterThan(60);
    expect(phased).toBeLessThan(120);
  });

  it('volatile explodes on death near the tower; splitting leaves two fragments caused by the kill', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    const i = w.spawnEnemy('grunt', 60, 0, { cause: -1, elite: ['volatile', 'splitting'] });
    const from = sim.events.nextId;
    w.damage(i, 1e15, { source: 'primary', srcTag: 'test', cause: -1 });
    const kill = since(sim, from, Ev.Kill)[0];
    const boom = since(sim, from, Ev.Explosion).find((x) => x.src === 'enemy');
    expect(boom).toBeDefined();
    expect(boom!.cause).toBe(kill.id);
    expect(since(sim, from, Ev.TowerHit).some((h) => h.cause === boom!.id)).toBe(true);
    const frags = since(sim, from, Ev.Spawn).filter((s) => s.src === 'splitter_fragment');
    expect(frags.length).toBe(2);
    for (const f of frags) expect(f.cause).toBe(kill.id);
    void e;
  });

  it('vampiric heals when it hits the tower', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    const i = w.spawnEnemy('brute', 45, 0, { cause: -1, elite: ['vampiric'] });
    const gen = e.gen[i];
    w.damage(i, e.maxHp[i] * 0.6, { source: 'primary', srcTag: 'test', cause: -1 });
    const low = e.hp[i];
    const from = sim.events.nextId;
    sim.run(2 * TICK_RATE);
    expect(since(sim, from, Ev.TowerHit).length).toBeGreaterThan(0);
    expect(since(sim, from, Ev.Heal).some((h) => h.src === 'vampiric')).toBe(true);
    expect(e.hp[find(sim, gen)]).toBeGreaterThan(low);
  });

  it('commanding speeds up nearby enemies', () => {
    const sim = arena();
    const w = sim.world, e = w.enemies;
    w.spawnEnemy('grunt', 480, 0, { cause: -1, elite: ['commanding'] });
    const g = w.spawnEnemy('grunt', 480, 40, { cause: -1 });
    const far = w.spawnEnemy('grunt', -480, 0, { cause: -1 });
    const gg = e.gen[g], fg = e.gen[far];
    sim.step();
    expect(e.speedMul[find(sim, gg)]).toBeCloseTo(1.2, 5);
    expect(e.speedMul[find(sim, fg)]).toBeCloseTo(1, 5);
  });

  it('elite kills pay more CE and roll Core drops', () => {
    const sim = arena();
    const w = sim.world;
    w.stats.override('economy.core_drop_chance', 1); w.rebuildStats();
    w.tower.ce = 0;
    const cores = w.run.cores;
    const i = w.spawnEnemy('grunt', 480, 0, { cause: -1, elite: ['hardened'] });
    const from = sim.events.nextId;
    w.damage(i, 1e15, { source: 'primary', srcTag: 'test', cause: -1, trueDamage: true });
    expect(w.tower.ce).toBeGreaterThanOrEqual(10);
    expect(w.run.cores).toBe(cores + 1);
    expect(since(sim, from, Ev.CoreDrop).length).toBe(1);
  });

  it('generator elites arrive with their modifier bits applied', () => {
    let found = false;
    for (let wave = 30; wave <= 60 && !found; wave++) {
      const def = generateWave(3, wave, 0, 0);
      if (!def.spawns.some((s) => s.elite.length > 0)) continue;
      const sim = new Sim(null, 3);
      const w = sim.world;
      w.stats.override('bastion.max_hp', 1e12); w.stats.override('ballistics.damage', 0); w.rebuildStats(); w.tower.hp = w.tower.maxHp;
      w.run.wave = wave;
      sim.machine.startWave();
      for (let t = 0; t < def.durationTicks + 5 && !found; t++) {
        sim.step();
        const e = w.enemies;
        for (let i = 0; i < e.count; i++) if ((e.flags[i] & EnemyFlag.Elite) && e.eliteMods[i] !== 0 && e.aiI[i] !== -1) found = true;
      }
    }
    expect(found).toBe(true);
    expect(MOD.commanding).toBe(1 << 11);
  });
});
