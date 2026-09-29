import { describe, it, expect } from 'vitest';
import { formationPosition, spawnPosition, FORMATION_MAX_R } from '../../src/sim/enemies/formations';
import { generateWave } from '../../src/sim/enemies/generator';
import { FORMATIONS } from '../../src/sim/data/formations';
import { ARENA_RADIUS } from '../../src/sim/core/types';
import type { WaveDef } from '../../src/sim/core/types';
import type { FormationId } from '../../src/sim/core/ids';

/** A generated wave that uses template `id` (searching seeds), so layouts match real use. */
function waveWith(id: FormationId): WaveDef {
  const f = FORMATIONS.find((x) => x.id === id)!;
  const asc = f.spatial ? 3 : 0;
  for (let seed = 1; seed < 4000; seed++) {
    for (const w of [Math.max(f.minWave, 30) + 1, Math.max(f.minWave, 70) + 2, f.minWave + 1]) {
      if (w % 5 === 0) continue;
      const d = generateWave(seed, w, 0, asc);
      if (d.formation === id) return d;
    }
  }
  // Fall back to forcing the template onto a generated wave.
  const d = generateWave(1, Math.max(f.minWave, 31), 0, asc);
  return { ...d, formation: id, params: { ...f.defaults } };
}

const SECONDS = 32;
const out = new Float32Array(2);

describe('formation scripts', () => {
  for (const f of FORMATIONS) {
    it(`${f.id}: continuous, bounded, and closing on the tower`, () => {
      const wave = waveWith(f.id);
      expect(wave.formation).toBe(f.id);
      const step = Math.max(1, Math.floor(wave.spawns.length / 12));
      let checked = 0;
      for (let i = 0; i < wave.spawns.length; i += step) {
        const s = wave.spawns[i];
        const speed = 40;
        formationPosition(wave, s, s.tick, speed, out);
        let px = out[0], py = out[1];
        const r0 = Math.hypot(px, py);
        let rMax = r0;
        expect(r0).toBeLessThanOrEqual(FORMATION_MAX_R + 1e-3);
        // Before the spawn tick the script holds the spawn point.
        formationPosition(wave, s, Math.max(0, s.tick - 30), speed, out);
        expect(out[0]).toBeCloseTo(px, 3); expect(out[1]).toBeCloseTo(py, 3);
        let problem = '';
        for (let tick = s.tick + 1; tick <= s.tick + SECONDS * 60 && !problem; tick++) {
          formationPosition(wave, s, tick, speed, out);
          const dx = out[0] - px, dy = out[1] - py;
          const moved = Math.sqrt(dx * dx + dy * dy);
          const r = Math.hypot(out[0], out[1]);
          if (!(moved < 3)) problem = `moved ${moved} at tick ${tick}`;
          else if (!(r <= ARENA_RADIUS + 60 + 1e-3)) problem = `r ${r} at tick ${tick}`;
          if (r > rMax) rMax = r;
          px = out[0]; py = out[1];
        }
        expect(problem, `${f.id} spawn ${i}`).toBe('');
        const rEnd = Math.hypot(px, py);
        if (f.id === 'artillery_ring' && s.lane === 1 && s.kind === 'artillery') {
          expect(rEnd).toBeGreaterThan(300);
          expect(rEnd).toBeLessThan(400);
        } else {
          expect(rEnd, `${f.id} spawn ${i} ends near the tower`).toBeLessThan(Math.min(r0 * 0.5, 120));
          // Escorts orbit their core, so they may swing outward by up to their orbit radius.
          if (!(f.id === 'escort' && s.lane === 1)) expect(rMax).toBeLessThanOrEqual(r0 + 5);
        }
        // Mid-course radius is below the start radius (the script closes in over time).
        formationPosition(wave, s, s.tick + 10 * 60, speed, out);
        if (!(f.id === 'artillery_ring' && s.lane === 1)) expect(Math.hypot(out[0], out[1])).toBeLessThan(r0);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('spawnPosition equals the script position at the spawn tick', () => {
    const wave = generateWave(11, 23, 0, 0);
    const a = new Float32Array(2), b = new Float32Array(2);
    for (const s of wave.spawns) {
      spawnPosition(wave, s, a);
      formationPosition(wave, s, s.tick, 40, b);
      expect(a[0]).toBeCloseTo(b[0], 3); expect(a[1]).toBeCloseTo(b[1], 3);
    }
  });

  it('boss escorts orbit the boss', () => {
    const wave = generateWave(4, 40, 0, 0);
    const boss = wave.spawns[0];
    const bp = new Float32Array(2), ep = new Float32Array(2);
    const tick = 20 * 60;
    formationPosition(wave, boss, tick, 10, bp);
    for (const s of wave.spawns.slice(1)) {
      formationPosition(wave, s, tick, 60, ep);
      expect(Math.hypot(ep[0] - bp[0], ep[1] - bp[1])).toBeLessThan(200);
    }
  });
});
