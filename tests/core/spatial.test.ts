import { describe, it, expect } from 'vitest';
import { createEnemyPool, allocEnemy, freeEnemy } from '../../src/sim/core/pools';
import { SpatialHash } from '../../src/sim/core/spatial';
import { Prng } from '../../src/sim/math/prng';
import { EnemyFlag } from '../../src/sim/core/types';

function world(n: number, seed: number) {
  const p = createEnemyPool(n);
  const r = new Prng(seed);
  for (let i = 0; i < n; i++) { const k = allocEnemy(p, i + 1); p.x[k] = r.range(-700, 700); p.y[k] = r.range(-700, 700); p.radius[k] = r.range(4, 20); }
  return { p, r };
}

describe('spatial hash', () => {
  it('queryRadius matches brute force (as a set) and is deterministic', () => {
    const { p, r } = world(1200, 7);
    for (let i = 0; i < 1200; i += 17) freeEnemy(p, i);
    const h = new SpatialHash(p);
    h.rebuild();
    const out = new Int32Array(2048);
    for (let q = 0; q < 200; q++) {
      const x = r.range(-800, 800), y = r.range(-800, 800), rad = r.range(0, 250);
      const n = h.queryRadius(x, y, rad, out);
      const got = Array.from(out.subarray(0, n)).sort((a, b) => a - b);
      const want: number[] = [];
      for (let i = 0; i < p.count; i++) {
        if (p.flags[i] & EnemyFlag.Dead) continue;
        const dx = p.x[i] - x, dy = p.y[i] - y, rr = rad + p.radius[i];
        if (dx * dx + dy * dy <= rr * rr) want.push(i);
      }
      expect(got).toEqual(want);
      const n2 = h.queryRadius(x, y, rad, out);
      expect(n2).toBe(n);
    }
  });

  it('nearest matches brute force with lowest-index ties and honors exclusions', () => {
    const { p, r } = world(600, 11);
    const h = new SpatialHash(p);
    h.rebuild();
    const ex = new Int32Array(4);
    for (let q = 0; q < 200; q++) {
      const x = r.range(-600, 600), y = r.range(-600, 600), rad = r.range(10, 400);
      let best = -1, bd = Infinity;
      for (let i = 0; i < p.count; i++) {
        const dx = p.x[i] - x, dy = p.y[i] - y, d = dx * dx + dy * dy, rr = rad + p.radius[i];
        if (d > rr * rr) continue;
        if (d < bd) { bd = d; best = i; }
      }
      const got = h.nearest(x, y, rad);
      expect(got).toBe(best);
      if (best >= 0) { ex[0] = best; const second = h.nearest(x, y, rad, ex, 1); expect(second).not.toBe(best); }
    }
  });

  it('ring-search nearest equals brute force: sparse/dense layouts, grid ties, intangibles, exclusions, off-grid points and enemies', () => {
    const INTANG = EnemyFlag.Dead | EnemyFlag.Phased | EnemyFlag.Burrowed | EnemyFlag.Ally;
    for (const [n, span, seed] of [[5, 700, 1], [40, 600, 2], [300, 900, 3], [1400, 700, 4], [60, 1500, 5]] as const) {
      const p = createEnemyPool(n);
      const r = new Prng(seed);
      for (let i = 0; i < n; i++) {
        const k = allocEnemy(p, i + 1);
        // snap a third of the enemies to a 48-unit lattice so exact distance ties and cell-boundary positions occur
        const snap = i % 3 === 0;
        p.x[k] = snap ? Math.round(r.range(-span, span) / 48) * 48 - 1056 % 48 : r.range(-span, span);
        p.y[k] = snap ? Math.round(r.range(-span, span) / 48) * 48 : r.range(-span, span);
        p.radius[k] = r.range(3, 40);
        if (i % 11 === 0) p.flags[k] |= EnemyFlag.Phased;
        if (i % 13 === 0) p.flags[k] |= EnemyFlag.Dead;
      }
      const h = new SpatialHash(p);
      h.rebuild();
      const excl = new Int32Array(8);
      for (let q = 0; q < 400; q++) {
        const x = q % 7 === 0 ? r.range(-1400, 1400) : Math.round(r.range(-600, 600));
        const y = q % 7 === 0 ? r.range(-1400, 1400) : Math.round(r.range(-600, 600));
        const maxR = r.range(0, 700);
        const ex = q % 4 === 0 ? Math.min(8, 1 + (q % 5)) : 0;
        for (let k = 0; k < ex; k++) excl[k] = r.int(0, n - 1);
        let best = -1, bestD = Infinity;
        for (let i = 0; i < p.count; i++) {
          if (p.flags[i] & INTANG) continue;
          let skip = false; for (let k = 0; k < ex; k++) if (excl[k] === i) skip = true;
          if (skip) continue;
          const dx = p.x[i] - x, dy = p.y[i] - y, rr = maxR + p.radius[i], d = dx * dx + dy * dy;
          if (d > rr * rr) continue;
          if (d < bestD || (d === bestD && i < best)) { best = i; bestD = d; }
        }
        expect(h.nearest(x, y, maxR, excl, ex)).toBe(best);
      }
    }
  });
});
