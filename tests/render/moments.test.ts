/**
 * UX Phase 4 (render/moments.ts): tell markers and the fade near the boss (C-18), the hull's Prestige mark and the
 * first-Prestige rebuild beat (C-19). Pure CPU side (no GL).
 */
import { describe, expect, it } from 'vitest';
import { INSTANCE_FLOATS, Shape, type RenderSnapshot } from '../../src/sim/core/types';
import { HULL_MARK_CAP, Moments, REBUILD_REDUCED_S, REBUILD_S, TELL_FADE, tellMarkerFor } from '../../src/render/moments';
import { FramePrep, DEFAULT_FRAME_OPTIONS } from '../../src/render/frame-prep';
import { BOSSES } from '../../src/sim/data/bosses';

const F = INSTANCE_FLOATS;
function snap(inst: number[][]): RenderSnapshot {
  const a = new Float32Array(inst.length * F);
  inst.forEach((v, i) => a.set(v, i * F));
  return { tick: 1, instances: a, instanceCount: inst.length, fx: new Float32Array(8), fxCount: 0, cameraShake: 0, clarity: 0 };
}
// x, y, r, rot, shape, r, g, b, a, layer, aux0, aux1
const body = (x: number, y: number, r: number): number[] => [x, y, r, 0, Shape.Hex, 1, 0, 0, 1, 4, 0, 0];
const fx = (x: number, y: number, layer: number): number[] => [x, y, 6, 0, Shape.Circle, 1, 1, 1, 1, layer, 0, 0];
const hull = (x: number, y: number): number[] => [x, y, 20, 0, Shape.Hex, 0.5, 0.6, 0.8, 1, 0, 0, 0];
const opts = { reduced: false, clarity: 0, pxPerUnit: 1 };
const layersOf = (m: Moments): number[] => Array.from({ length: m.count }, (_, i) => m.buf[i * F + 9]);

describe('tell markers (C-18)', () => {
  it('every boss tell maps to one marker kind', () => {
    for (const b of BOSSES) expect(tellMarkerFor(b.tell.counter), b.id).not.toBeNull();
    expect(tellMarkerFor('repulsor_pulse')).toBe('ring');
    expect(tellMarkerFor('time_field')).toBe('cone');
    expect(tellMarkerFor('emp')).toBe('line');
    expect(tellMarkerFor('bombardment')).toBe('target');
    expect(tellMarkerFor(null)).toBeNull();
  });

  it('draws the marker on layer 7 at the largest body, only while a tell is live', () => {
    const m = new Moments();
    const s = snap([body(10, 10, 8), body(200, -100, 40), body(-50, 30, 12)]);
    expect(m.build(s, 1 / 60, opts)).toBe(0);
    for (const c of ['repulsor_pulse', 'time_field', 'emp', 'bombardment', 'hunter_mark']) {
      m.setTell(c);
      const n = m.build(s, 1 / 60, opts);
      expect(n, c).toBeGreaterThan(0);
      expect(layersOf(m).every((l) => l === 7), c).toBe(true);
      expect(m.marker.x).toBe(200);
      expect(m.marker.y).toBe(-100);
    }
    m.setTell(null);
    expect(m.build(s, 1 / 60, opts)).toBe(0);
  });

  it('fades player effects near the boss (layers 1–3), not far ones, enemies or the tower', () => {
    const p = new FramePrep(64);
    const s = snap([hull(0, 0), body(200, 0, 40), fx(205, 5, 2), fx(190, 0, 1), fx(-300, 0, 3)]);
    const o = { ...DEFAULT_FRAME_OPTIONS, pxPerUnit: 1 };
    const alphaAt = (x: number, layer: number): number => {
      for (let i = 0; i < p.total; i++) if (p.sorted[i * F] === x && p.sorted[i * F + 9] === layer) return p.sorted[i * F + 8];
      return NaN;
    };
    p.frame(s, 1 / 60, o);
    expect(alphaAt(205, 2)).toBe(1);
    p.moments.setTell('repulsor_pulse');
    for (let k = 0; k < 20; k++) p.frame(s, 1 / 60, o);
    expect(alphaAt(205, 2)).toBeCloseTo(TELL_FADE, 3);
    expect(alphaAt(190, 1)).toBeCloseTo(TELL_FADE, 3);
    expect(alphaAt(-300, 3)).toBe(1);
    expect(alphaAt(200, 4)).toBe(1);
    expect(alphaAt(0, 0)).toBe(1);
    // Clarity fades further
    p.frame(s, 1 / 60, { ...o, clarity: 1 });
    p.frame(s, 1 / 60, { ...o, clarity: 1 });
    expect(alphaAt(205, 2)).toBeCloseTo(TELL_FADE * 0.5, 3);
  });

  it('holds still under reduced motion', () => {
    const m = new Moments();
    const s = snap([body(200, 0, 40)]);
    m.setTell('repulsor_pulse');
    m.build(s, 0.1, { ...opts, reduced: true });
    const r1 = m.marker.r;
    m.build(s, 0.4, { ...opts, reduced: true });
    expect(m.marker.r).toBe(r1);
    m.build(s, 0.4, opts);
    const r2 = m.marker.r;
    m.build(s, 0.3, opts);
    expect(m.marker.r).not.toBe(r2);
  });
});

describe('hull mark (C-19)', () => {
  const marks = (pc: number): { pips: number; lines: number } => {
    const m = new Moments();
    m.prestigeCount = pc;
    const n = m.build(snap([]), 1 / 60, opts);
    let pips = 0, lines = 0;
    for (let i = 0; i < n; i++) {
      const sh = m.buf[i * F + 4];
      if (sh === Shape.Diamond) pips++;
      if (sh === Shape.Line) lines++;
    }
    return { pips, lines };
  };
  it('one pip per Prestige up to the cap, then one pip and a numeral', () => {
    expect(marks(0)).toEqual({ pips: 0, lines: 0 });
    expect(marks(1).pips).toBe(1);
    expect(marks(3).pips).toBe(3);
    expect(marks(HULL_MARK_CAP).pips).toBe(HULL_MARK_CAP);
    const big = marks(12);
    expect(big.pips).toBe(1);
    expect(big.lines).toBeGreaterThan(0);   // "12" in seven segments (with under-strokes)
  });
});

describe('rebuild beat (C-19)', () => {
  it('copies the old tower, dissolves it, assembles the live hull, and ends on time', () => {
    const p = new FramePrep(64);
    const old = snap([hull(0, 0), hull(30, 0), body(300, 0, 10)]);
    const fresh = snap([hull(0, 0)]);
    const o = { ...DEFAULT_FRAME_OPTIONS, pxPerUnit: 1 };
    expect(p.moments.startRebuild(old, false)).toBe(REBUILD_S * 1000);
    p.frame(fresh, 0.01, o);
    // early: the ghost is drawn (2 copied tower instances), the live hull is hidden
    const liveAlpha = (): number => p.sorted[8];   // the snapshot's layer-0 instance sorts first
    expect(p.moments.count).toBeGreaterThanOrEqual(2);
    expect(liveAlpha()).toBe(0);
    for (let t = 0; t < 1.6; t += 0.1) p.frame(fresh, 0.1, o);
    expect(liveAlpha()).toBeGreaterThan(0);
    for (let t = 0; t < 1.2; t += 0.1) p.frame(fresh, 0.1, o);
    expect(p.moments.rebuilding).toBe(false);
    expect(liveAlpha()).toBe(1);
  });

  it('is a short crossfade under reduced motion, and can be cut short', () => {
    const m = new Moments();
    expect(m.startRebuild(snap([hull(0, 0)]), true)).toBe(REBUILD_REDUCED_S * 1000);
    m.build(snap([]), 0.1, opts);
    expect(m.rebuilding).toBe(true);
    m.endRebuild();
    expect(m.rebuilding).toBe(false);
  });
});
