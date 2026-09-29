import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import type { Command } from '../../src/sim/core/types';

function script(sim: Sim, t: number): Command[] {
  const out: Command[] = [];
  if (t === 100) out.push({ type: 'set_targeting', system: 'primary', profile: 'lowest_hp' });
  if (t % 300 === 0) out.push({ type: 'buy', node: 'ballistics.damage' }, { type: 'buy', node: 'ballistics.attack_speed' }, { type: 'buy', node: 'bastion.max_hp' });
  if (t === 1500) out.push({ type: 'manual_aim', active: true, angle: 1.0 });
  if (t === 1700) out.push({ type: 'manual_aim', active: false, angle: 0 });
  if (t === 2000 && sim.world.enemies.count > 0) out.push({ type: 'designate', enemy: 0 });
  if (t === 2500) out.push({ type: 'set_targeting', system: 'primary', profile: 'closest_to_tower' });
  return out;
}

function play(seed: number, ticks: number): Sim {
  const sim = new Sim(null, seed);
  for (let t = 0; t < ticks; t++) { for (const c of script(sim, t)) sim.command(c); sim.step(); }
  return sim;
}

describe('determinism', () => {
  it('same seed + same command script → identical event hash after 3600 ticks', () => {
    const a = play(42, 3600), b = play(42, 3600);
    expect(a.events.nextId).toBeGreaterThan(100);
    expect(a.events.hash()).toBe(b.events.hash());
    expect(a.world.run.scrap).toBe(b.world.run.scrap);
    expect(a.world.enemies.count).toBe(b.world.enemies.count);
  });
  it('a different seed diverges', () => {
    expect(play(42, 1800).events.hash()).not.toBe(play(43, 1800).events.hash());
  });
});
