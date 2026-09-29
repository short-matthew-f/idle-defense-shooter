import { describe, expect, it } from 'vitest';
import { Admission, RateLimiter, speedDensity, TokenBucket, VoiceAllocator } from '../../src/audio/mixer';

describe('audio mixer: rate limiting', () => {
  it('RateLimiter spaces plays of the same id and keeps ids independent', () => {
    const r = new RateLimiter(3);
    expect(r.allow(0, 0, 0.1)).toBe(true);
    expect(r.allow(0, 0.05, 0.1)).toBe(false);
    expect(r.allow(1, 0.05, 0.1)).toBe(true);
    expect(r.allow(0, 0.1, 0.1)).toBe(true);
    let n = 0;
    for (let t = 0; t < 10; t += 0.001) if (r.allow(2, t, 0.1)) n++;
    expect(n).toBeGreaterThanOrEqual(99);
    expect(n).toBeLessThanOrEqual(101);
  });

  it('TokenBucket refills at its rate up to its burst', () => {
    const b = new TokenBucket(10, 3);
    expect(b.take(0, 3)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.take(0.1)).toBe(true);
    expect(b.available(100)).toBe(3);
  });
});

describe('audio mixer: voice allocator', () => {
  it('never exceeds the cap; frees voices at their end time', () => {
    const v = new VoiceAllocator(4);
    for (let i = 0; i < 4; i++) expect(v.acquire(1, 0, 1)).not.toBeNull();
    expect(v.active(0)).toBe(4);
    expect(v.acquire(1, 0.1, 1)).toBeNull();      // equal priority, victims too young
    expect(v.dropped).toBe(1);
    expect(v.active(1.01)).toBe(0);
    expect(v.acquire(1, 1.01, 1)?.wasBusy).toBe(false);
  });

  it('higher priority steals the lowest-priority, oldest voice; lower priority is dropped', () => {
    const v = new VoiceAllocator(3);
    v.acquire(5, 0, 2); v.acquire(1, 0.1, 2); v.acquire(1, 0.2, 2);
    const s = v.acquire(8, 0.3, 1);
    expect(s?.wasBusy).toBe(true);
    expect(s?.slot).toBe(1);                         // priority 1, started first
    expect(v.acquire(0, 0.4, 1)).toBeNull();
    expect(v.stolen).toBe(1);
    expect(v.peak).toBe(3);
  });

  it('equal priority may take over a voice past half its life', () => {
    const v = new VoiceAllocator(1);
    v.acquire(3, 0, 1);
    expect(v.acquire(3, 0.4, 1)).toBeNull();
    expect(v.acquire(3, 0.6, 1)?.wasBusy).toBe(true);
  });
});

describe('audio mixer: sim speed density', () => {
  it('thins sounds monotonically with speed: wider intervals, smaller budget, lower gain', () => {
    const a = [1, 2, 4, 8].map(speedDensity);
    expect(a[0]).toEqual({ interval: 1, budget: 1, gain: 1 });
    for (let i = 1; i < a.length; i++) {
      expect(a[i].interval).toBeGreaterThan(a[i - 1].interval);
      expect(a[i].budget).toBeLessThan(a[i - 1].budget);
      expect(a[i].gain).toBeLessThan(a[i - 1].gain);
    }
    expect(20 * Math.log10(a[3].gain)).toBeCloseTo(-4.5, 5);   // −1.5 dB per doubling
  });

  it('Admission applies the speed to ordinary sounds but never to priority ≥ 8', () => {
    const count = (speed: number, priority: number): number => {
      const ad = new Admission(1, 24);
      ad.setSpeed(speed);
      let n = 0;
      for (let t = 0; t < 10; t += 1 / 120) if (ad.admit({ id: 0, priority, minInterval: 0.1, dur: 0.01 }, t)) n++;
      return n;
    };
    expect(count(8, 3)).toBeLessThan(count(1, 3) / 3);
    expect(count(8, 9)).toBe(count(1, 9));
  });
});
