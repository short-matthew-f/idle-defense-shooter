/** The renderer's CPU frame (graphics pass): flag decoding, Detail LOD, part transforms, sort, cues. */
import { describe, expect, it } from 'vitest';
import { FX_FLOATS, FxKind, INST_FLAG_SCALE, INSTANCE_FLOATS, InstFlag, Shape, type RenderSnapshot } from '../../src/sim/core/types';
import { FramePrep, DEFAULT_FRAME_OPTIONS } from '../../src/render/frame-prep';
import { motionScales, TIERS } from '../../src/render/quality';
import { Showcase, SHOWCASE_PAGES, parseDevHash, DevHarness } from '../../src/app/dev-harness';

function snap(rows: number[][], fx: number[][] = [], tick = 1): RenderSnapshot {
  const inst = new Float32Array(Math.max(1, rows.length) * INSTANCE_FLOATS);
  rows.forEach((r, i) => inst.set(r, i * INSTANCE_FLOATS));
  const f = new Float32Array(Math.max(1, fx.length) * FX_FLOATS);
  fx.forEach((r, i) => f.set(r, i * FX_FLOATS));
  return { tick, instances: inst, instanceCount: rows.length, fx: f, fxCount: fx.length, cameraShake: 0, clarity: 0 };
}
const still = { ...DEFAULT_FRAME_OPTIONS, motion: motionScales(true, true) };

describe('FramePrep', () => {
  it('decodes flags into layers, keeps them for the shader, and sorts by layer', () => {
    const p = new FramePrep(10);
    const s = snap([
      [0, 0, 5, 0, Shape.Circle, 1, 1, 1, 1, 7, 0, 0],
      [0, 0, 5, 0, Shape.Circle, 1, 1, 1, 1, 4 + INST_FLAG_SCALE * (InstFlag.Part | InstFlag.Detail), 0, 2],
      [0, 0, 5, 0, Shape.Circle, 1, 1, 1, 1, 4, 1, 0],
    ]);
    const n = p.frame(s, 0, still);
    expect(n).toBe(3);
    expect(Array.from(p.starts)).toEqual([0, 0, 0, 0, 0, 2, 2, 2, 3]);
    expect(p.sorted[9]).toBe(4 + INST_FLAG_SCALE * (InstFlag.Part | InstFlag.Detail));
    expect(p.sorted[2 * INSTANCE_FLOATS + 9]).toBe(7);
    expect(p.enemies).toBe(1);
  });

  it('drops Detail parts at the Low tier and above the tier enemy count (one frame of lag)', () => {
    const body = [0, 0, 8, 0, Shape.Hex, 1, 1, 1, 1, 4, 1, 0];
    const detail = [9, 0, 2, 0, Shape.Circle, 1, 1, 1, 1, 4 + INST_FLAG_SCALE * (InstFlag.Part | InstFlag.Detail), 0, 0];
    const p = new FramePrep(10);
    p.frame(snap([body, detail]), 0, { ...still, detail: TIERS.low.detail });
    expect(p.partsDrawn).toBe(0);
    expect(p.partsDropped).toBe(1);
    p.frame(snap([body, detail], [], 2), 0, { ...still, detailMaxEnemies: 0 });   // 1 enemy > 0
    expect(p.partsDrawn).toBe(0);
    p.frame(snap([body, detail], [], 3), 0, still);
    expect(p.partsDrawn).toBe(1);
  });

  it('enlarges parts with their body to the minimum on-screen size, around the body centre', () => {
    const p = new FramePrep(10);
    const s = snap([
      [100, 50, 4, 0, Shape.Circle, 1, 1, 1, 1, 4, 1, 0],
      [104, 50, 1, 0, Shape.Circle, 1, 1, 1, 1, 4 + INST_FLAG_SCALE * InstFlag.Part, 0, 0],
    ]);
    p.frame(s, 0, { ...still, minR: 8 });   // body drawn at 8 (x2): the part moves out to +8 and doubles
    const o = INSTANCE_FLOATS;
    expect(p.sorted[o]).toBeCloseTo(108, 4);
    expect(p.sorted[o + 1]).toBeCloseTo(50, 4);
    expect(p.sorted[o + 2]).toBeCloseTo(2, 4);
  });

  it('fades composite parts that would be under ~1 px on screen (phone scale), never bodies', () => {
    const p = new FramePrep(10);
    const s = snap([
      [0, 0, 10, 0, Shape.Circle, 1, 1, 1, 1, 4, 1, 0],
      [2, 0, 3, 0, Shape.Circle, 1, 1, 1, 1, 4 + INST_FLAG_SCALE * InstFlag.Part, 0, 0],
    ]);
    p.frame(s, 0, { ...still, pxPerUnit: 0.25 });   // part 0.75 px: gone; body untouched
    expect(p.sorted[8]).toBe(1);
    expect(p.sorted[INSTANCE_FLOATS + 8]).toBe(0);
    p.frame({ ...s, tick: 2 }, 0, { ...still, pxPerUnit: 2 });   // part 6 px: fully drawn
    expect(p.sorted[INSTANCE_FLOATS + 8]).toBe(1);
  });

  it('routes cue fx to the juice (not particles) exactly once per snapshot', () => {
    const p = new FramePrep(100);
    const s = snap([], [[FxKind.Punch, 0, 0, 1, 1, 1, 1, 1], [FxKind.Shake, 0, 0, 1, 1, 1, 0.5, 1], [FxKind.Spark, 0, 0, 1, 1, 1, 3, 3]]);
    p.frame(s, 1 / 60, DEFAULT_FRAME_OPTIONS);
    expect(p.juice.punch).toBeGreaterThan(0);
    expect(p.juice.shake).toBeCloseTo(0.5, 5);
    const sparks = p.particles.count;
    expect(sparks).toBeGreaterThan(0);
    p.juice.shake = 0;
    p.frame(s, 1 / 60, DEFAULT_FRAME_OPTIONS);   // same tick redrawn: no new cues or particles
    expect(p.juice.shake).toBe(0);
    expect(p.particles.count).toBeLessThanOrEqual(sparks);
  });
});

describe('#dev:showcase', () => {
  it('parses showcase pages', () => {
    expect(parseDevHash('#dev:showcase')?.showcase).toBe('enemies');
    expect(parseDevHash('#dev:showcase=bosses')?.showcase).toBe('bosses');
    expect(parseDevHash('#dev:showcase=nope')?.showcase).toBe('enemies');
    expect(new DevHarness({ showcase: 'towers' }).step(3).instanceCount).toBeGreaterThan(100);
  });
  it('every page writes finite, in-range instances and fx for many frames', () => {
    for (const page of SHOWCASE_PAGES) {
      const sc = new Showcase(page);
      for (const frame of [0, 1, 7, 59, 60, 90, 181, 240, 1000]) {
        const s = sc.step(frame);
        expect(s.instanceCount).toBeGreaterThan(0);
        for (let i = 0; i < s.instanceCount * INSTANCE_FLOATS; i++) expect(Number.isFinite(s.instances[i])).toBe(true);
        for (let i = 0; i < s.instanceCount; i++) {
          const L = Math.round(s.instances[i * INSTANCE_FLOATS + 9]);
          expect(L & 7).toBeLessThanOrEqual(7);
          expect(s.instances[i * INSTANCE_FLOATS + 4]).toBeLessThanOrEqual(Shape.Drop);
        }
        for (let i = 0; i < s.fxCount * FX_FLOATS; i++) expect(Number.isFinite(s.fx[i])).toBe(true);
      }
    }
  });
  it('shows all 21 families (plain, elite, active) and all 21 bosses', () => {
    const count = (page: 'enemies' | 'bosses'): number => {
      const s = new Showcase(page).step(10);
      let n = 0;
      for (let i = 0; i < s.instanceCount; i++) if (s.instances[i * INSTANCE_FLOATS + 9] === 4) n++;
      return n;
    };
    expect(count('enemies')).toBe((21 + 4) * 3);
    expect(count('bosses')).toBe(21);
  });
});
