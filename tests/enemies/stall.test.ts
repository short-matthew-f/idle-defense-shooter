import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { EnemyFlag, Ev, TICK_RATE } from '../../src/sim/core/types';

/**
 * Regression for the stall the owner hit deep in the game: knockback carried Shielded enemies out of the weapons' reach,
 * their shields regenerated before they walked back, and the wave never ended. Now the governor caps the push, regeneration
 * pauses outside range, and the anti-stall Rush (run/stall.ts) guarantees an end.
 */
function waveOf(kind: string, elite: string[] | null, knockback: boolean, seed = 1) {
  const sim = new Sim(null, seed);
  const w = sim.world, e = w.enemies, s = w.stats;
  w.meta.echoes = 1e18;
  s.override('bastion.max_hp', 1e15);
  s.override('ballistics.damage', 3e6);
  s.override('ballistics.attack_speed', 1.5);
  s.override('ballistics.range', 340);
  if (knockback) s.override('ballistics.heavy.base_knockback', 400);
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  w.clearCombat();
  w.run.wave = 62; w.run.checkpoint = 61;
  sim.machine.startWave();
  for (const sp of w.wave!.spawns) { if (sp.kind === 'boss') continue; sp.kind = kind as typeof sp.kind; if (elite) sp.elite = [...elite] as NonNullable<typeof sp.elite>; }
  let t = 0;
  while (t < 20 * 60 * TICK_RATE) {
    if (knockback && t % (5 * TICK_RATE) === 0) {   // push everything outward, hard, every 5 s (Repulsor Pulse)
      for (let i = 0; i < e.count; i++) if (!(e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally))) w.knockback(i, e.x[i], e.y[i], 900);
    }
    sim.step(); t++;
    if (w.run.phase !== 'combat') break;
  }
  return { cleared: w.run.phase !== 'combat', seconds: t / TICK_RATE, sim };
}

describe('knockback cannot stall a wave', () => {
  it('a knockback-heavy build clears a Shielded wave about as fast as one with no knockback', () => {
    const plain = waveOf('shielded', null, false);
    const push = waveOf('shielded', null, true);
    expect(plain.cleared).toBe(true);
    expect(push.cleared).toBe(true);
    expect(push.seconds).toBeLessThanOrEqual(plain.seconds * 1.6 + 10);
  }, 120_000);

  it('the anti-stall Rush starts for a straggler nothing can reach, with one explained event', () => {
    const sim = new Sim(null, 3);
    const w = sim.world, e = w.enemies;
    w.clearCombat();
    w.wave = null;
    sim.machine.setPhase('combat');
    w.run.wave = 30;
    w.stats.override('bastion.max_hp', 1e15);
    w.stats.override('ballistics.damage', 0);
    w.stats.override('ballistics.range', 100);
    w.rebuildStats();
    w.tower.hp = w.tower.maxHp;
    const i = w.spawnEnemy('grunt', 480, 0, { cause: -1 });
    e.speed[i] = 0;   // it stands off at the rim: out of range and not approaching
    let t = 0;
    while (t < 9 * TICK_RATE) { sim.step(); t++; }
    expect(sim.machine.stall.rushing).toBe(false);   // not before wave.stall_seconds (10 s)
    while (t < 14 * TICK_RATE) { sim.step(); t++; }
    expect(sim.machine.stall.rushing).toBe(true);
    let rush = 0;
    w.events.forEachSince(0, (ev) => { if (ev.type === Ev.Rush) rush++; });
    expect(rush).toBe(1);
    expect(e.rushT[i]).toBeGreaterThan(0);
  });

  /** The mechanism behind the report: shields punish low damage inside the weapons' reach, never distance. */
  describe('regeneration gate', () => {
    function shieldedArena(range: number): { sim: Sim; i: number; gen: number } {
      const sim = new Sim(null, 5);
      const w = sim.world;
      w.clearCombat();
      w.wave = null;
      sim.machine.setPhase('combat');
      w.run.wave = 40;
      w.stats.override('bastion.max_hp', 1e15);
      w.stats.override('ballistics.damage', 0);
      w.stats.override('ballistics.range', range);
      w.stats.override('wave.stall_seconds', 1e6);   // isolate the gate from the Rush
      w.rebuildStats();
      w.tower.hp = w.tower.maxHp;
      const i = w.spawnEnemy('shielded', 480, 0, { cause: -1 });
      w.enemies.speed[i] = 0;
      w.damage(i, w.enemies.maxShield[i] * 0.8, { source: 'primary', srcTag: 'test', cause: -1 });
      return { sim, i, gen: w.enemies.gen[i] };
    }
    it('a shield does not regenerate while its owner is outside the primary range', () => {
      const { sim, i } = shieldedArena(300);
      const low = sim.world.enemies.shield[i];
      sim.run(8 * TICK_RATE);
      expect(sim.world.enemies.shield[i]).toBeCloseTo(low, 3);
    });
    it('the same shield regenerates inside the range (the rule still punishes low damage)', () => {
      const { sim, i } = shieldedArena(600);
      const low = sim.world.enemies.shield[i];
      sim.run(8 * TICK_RATE);
      expect(sim.world.enemies.shield[i]).toBeGreaterThan(low);
    });
    it('a shield does not regenerate for 3 s after a push, even inside the range', () => {
      const { sim, i } = shieldedArena(600);
      const w = sim.world, low = w.enemies.shield[i];
      sim.run(4 * TICK_RATE);   // regeneration started
      expect(w.enemies.shield[i]).toBeGreaterThan(low);
      w.knockback(i, 1, 0, 10);
      const after = w.enemies.shield[i];
      sim.run(2 * TICK_RATE);
      expect(w.enemies.shield[i]).toBeCloseTo(after, 3);
    });
  });
});
