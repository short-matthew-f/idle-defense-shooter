import { describe, it, expect } from 'vitest';
import { StatResolver, baseStat } from '../../src/sim/core/stats';
import { newBuild, newMeta } from '../../src/sim/run/state';
import { nodeInfo } from '../../src/sim/core/content';
import type { StatEffect } from '../../src/sim/data/schema';

/** Expected value of `key` from a single node at `rank` under the resolver rule. */
function expected(key: string, effects: readonly StatEffect[], rank: number, strength = 1): number {
  let add = 0, mul = 0; let set: number | undefined;
  for (const e of effects) if (e.stat === key) { if (e.op === 'add') add += e.perRank * rank * strength; else if (e.op === 'mul') mul += e.perRank * rank * strength; else set = e.perRank; }
  return set ?? (baseStat(key) + add) * (1 + mul);
}

describe('stat resolver', () => {
  it('starts from base stats', () => {
    const s = new StatResolver(newBuild(), newMeta());
    expect(s.get('ballistics.damage')).toBe(10);
    expect(s.get('ballistics.attack_speed')).toBe(2);
    expect(s.get('bastion.max_hp')).toBe(100);
    expect(s.get('economy.scrap_mul')).toBe(1);
    expect(s.get('no.such.key')).toBe(0);
  });

  it('applies (base + Σadd)·(1 + Σmul) with perRank × rank', () => {
    const b = newBuild();
    b.ranks['ballistics.damage'] = 5;
    b.ranks['ballistics.range'] = 3;
    const s = new StatResolver(b, newMeta());
    const dmg = nodeInfo('ballistics.damage')!.def, rng = nodeInfo('ballistics.range')!.def;
    expect(s.get('ballistics.damage')).toBeCloseTo(expected('ballistics.damage', dmg.effects, 5), 9);
    expect(s.get('ballistics.range')).toBeCloseTo(expected('ballistics.range', rng.effects, 3), 9);
    expect(s.rank('ballistics.damage')).toBe(5);
    expect(s.has('ballistics.damage')).toBe(true);
    expect(s.has('ballistics.crit_chance')).toBe(false);
  });

  it('sums multipliers additively across sources and lets overrides win', () => {
    const b = newBuild();
    b.ranks['ballistics.damage'] = 2;
    const s = new StatResolver(b, newMeta());
    const before = s.get('ballistics.damage');
    s.override('ballistics.damage', 123);
    expect(s.get('ballistics.damage')).toBe(123);
    s.override('ballistics.damage', NaN);
    expect(s.get('ballistics.damage')).toBe(before);
  });

  it('gates doctrine nodes on the active doctrine and scales second doctrines', () => {
    const b = newBuild();
    b.ranks['ballistics.piercing.count'] = 2;
    const s = new StatResolver(b, newMeta());
    expect(s.rank('ballistics.piercing.count')).toBe(0);
    expect(s.get('ballistics.piercing.count')).toBe(baseStat('ballistics.piercing.count'));
    b.doctrines.ballistics = 'piercing';
    s.rebuild();
    expect(s.rank('ballistics.piercing.count')).toBe(2);
    expect(s.doctrineStrength('ballistics', 'piercing')).toBe(1);
    const def = nodeInfo('ballistics.piercing.count')!.def;
    expect(s.get('ballistics.piercing.count')).toBeCloseTo(expected('ballistics.piercing.count', def.effects, 2), 9);

    b.anomalies.push('spare_barrel');
    b.secondDoctrines.ballistics = 'ricochet';
    s.rebuild();
    expect(s.hasDoctrine('ballistics', 'ricochet')).toBe(true);
    expect(s.doctrineStrength('ballistics', 'ricochet')).toBe(0.5);
    const m = newMeta(); m.prestigeRanks['prestige.dual_doctrine'] = 1;
    s.bind(b, m);
    expect(s.doctrineStrength('ballistics', 'ricochet')).toBe(0.6);
    b.frame = 'monolith';
    s.rebuild();
    expect(s.doctrineStrength('ballistics', 'ricochet')).toBe(1);
    expect(s.doctrineStrength('ballistics', 'heavy_rounds')).toBe(0);
  });

  it('reports mounts and attunements; primary is always mounted', () => {
    const b = newBuild();
    b.hardpoints = ['drones', null]; b.attunements = ['fire'];
    const s = new StatResolver(b, newMeta());
    expect(s.mounted('primary')).toBe(true);
    expect(s.mounted('drones')).toBe(true);
    expect(s.mounted('laser')).toBe(false);
    expect(s.attuned('fire')).toBe(true);
    expect(s.attuned('frost')).toBe(false);
  });
});
