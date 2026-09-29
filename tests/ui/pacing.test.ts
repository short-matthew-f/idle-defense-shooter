import { describe, expect, it } from 'vitest';
import { TickPacer, offlineSecondsOnReturn } from '../../src/app/pacing';
import { nearestEnemy } from '../../src/app/pick';
import { INSTANCE_FLOATS } from '../../src/sim/core/types';

describe('tick pacing', () => {
  it('runs one tick per 60 Hz frame at ×1 and carries fractions', () => {
    const p = new TickPacer();
    let total = 0;
    for (let i = 0; i < 60; i++) total += p.step(1 / 60, 1);
    expect(total).toBeGreaterThanOrEqual(59);
    expect(total).toBeLessThanOrEqual(60);
    const q = new TickPacer();
    let t2 = 0;
    for (let i = 0; i < 144; i++) t2 += q.step(1 / 144, 1);   // 144 Hz display
    expect(t2).toBeGreaterThanOrEqual(59);
    expect(t2).toBeLessThanOrEqual(60);
  });
  it('scales with speed', () => {
    const p = new TickPacer();
    let total = 0;
    for (let i = 0; i < 60; i++) total += p.step(1 / 60, 4);
    expect(total).toBeGreaterThanOrEqual(239);
    expect(total).toBeLessThanOrEqual(240);
  });
  it('caps a long frame and drops the backlog', () => {
    const p = new TickPacer();
    expect(p.step(0.2, 1)).toBe(8);
    expect(p.acc).toBe(0);
    expect(p.step(5, 8)).toBe(64);
    expect(p.step(1 / 60, 1, true)).toBe(0);
    expect(p.step(0, 1)).toBe(0);
  });
  it('credits offline time only after 60 s hidden', () => {
    expect(offlineSecondsOnReturn(0, 59_000)).toBe(0);
    expect(offlineSecondsOnReturn(0, 61_000)).toBe(61);
  });
});

describe('tap → nearest enemy', () => {
  function stream(items: [number, number, number, number][]): Float32Array {
    const a = new Float32Array(items.length * INSTANCE_FLOATS);
    items.forEach(([x, y, r, layer], i) => { const o = i * INSTANCE_FLOATS; a[o] = x; a[o + 1] = y; a[o + 2] = r; a[o + 9] = layer; });
    return a;
  }
  const inst = stream([
    [0, 0, 22, 0],       // tower
    [100, 0, 5, 3],      // projectile (ignored)
    [100, 0, 8, 4],      // enemy 0
    [200, 50, 8, 4],     // enemy 1
    [205, 50, 10, 5],    // outline (ignored)
    [-80, -80, 20, 4],   // enemy 2 (big)
  ]);
  it('finds the nearest layer-4 instance and its ordinal', () => {
    expect(nearestEnemy(inst, 6, 104, 3)?.index).toBe(0);
    expect(nearestEnemy(inst, 6, 210, 55)?.index).toBe(1);
    expect(nearestEnemy(inst, 6, -80, -120)?.index).toBe(2);   // 40 away, radius 20 → 20 ≤ 24
  });
  it('returns null when nothing is within reach', () => {
    expect(nearestEnemy(inst, 6, 400, 400)).toBeNull();
    expect(nearestEnemy(inst, 6, 150, 0)).toBeNull();
    expect(nearestEnemy(inst, 2, 100, 0)).toBeNull();   // count limits the scan
  });
});
