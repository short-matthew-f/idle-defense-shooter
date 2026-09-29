import { describe, it, expect } from 'vitest';
import { Prng, hashString, waveSeed } from '../src/sim/math/prng';
import { sin, cos, atan2, ipow, growth, exp, log, pow, PI, TAU } from '../src/sim/math/lut';

describe('Prng', () => {
  it('is deterministic for equal seeds and diverges for different ones', () => {
    const a = new Prng(12345), b = new Prng(12345), c = new Prng(12346);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    const sc = Array.from({ length: 8 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });
  it('produces floats in [0,1) and ints in range', () => {
    const r = new Prng('seed');
    for (let i = 0; i < 10000; i++) { const f = r.next(); expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(1); const n = r.int(3, 7); expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(7); }
  });
  it('has a golden value so cross-engine drift is caught', () => {
    const r = new Prng(0xC17ADE1);
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toMatchSnapshot();
    expect(hashString('citadel')).toMatchSnapshot();
    expect(waveSeed(42, 17)).toMatchSnapshot();
  });
});

describe('lut', () => {
  it('sin/cos approximate Math within table error', () => {
    for (let a = -10; a < 10; a += 0.01) { expect(Math.abs(sin(a) - Math.sin(a))).toBeLessThan(0.0003); expect(Math.abs(cos(a) - Math.cos(a))).toBeLessThan(0.0003); }
  });
  it('atan2 approximates Math.atan2', () => {
    for (let i = 0; i < 2000; i++) { const a = (i / 2000) * TAU - PI; const x = Math.cos(a) * 3, y = Math.sin(a) * 3; expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(2e-5); }
  });
  it('ipow/growth/exp/log/pow agree with Math closely', () => {
    expect(ipow(1.13, 20)).toBeCloseTo(Math.pow(1.13, 20), 9);
    expect(growth(1.13, 100)).toBeCloseTo(Math.pow(1.13, 100), 6);
    expect(growth(1.2, 5)).toBeCloseTo(Math.pow(1.2, 5), 9);
    expect(exp(1.5)).toBeCloseTo(Math.exp(1.5), 9);
    expect(log(7.3)).toBeCloseTo(Math.log(7.3), 9);
    expect(pow(2.5, 1.7)).toBeCloseTo(Math.pow(2.5, 1.7), 7);
  });
});
