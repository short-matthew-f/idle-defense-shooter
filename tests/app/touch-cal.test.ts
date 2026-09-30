import { describe, expect, it } from 'vitest';
import {
  CAL_X_SLOPE, CAL_Y_SLOPE, IDENTITY_CAL, applyCal, describeCal, fitAxis, fitCalibration, parseCal, type CalPair,
} from '../../src/app/touch-cal';

/** Rings at the touch test's positions on a 393×793 canvas; `read` maps where the finger is to where it is read. */
function pairs(read: (x: number, y: number) => [number, number], jitter: [number, number][] = [[0, 0], [0, 0], [0, 0]]): CalPair[] {
  const want: [number, number][] = [[0.64 * 393, 0.24 * 793], [0.3 * 393, 0.5 * 793], [0.66 * 393, 0.76 * 793]];
  return want.map(([x, y], i) => { const [tx, ty] = read(x, y); return { tapX: tx + jitter[i][0], tapY: ty + jitter[i][1], wantX: x, wantY: y }; });
}

describe('fitAxis', () => {
  it('recovers a line exactly', () => {
    const f = fitAxis([100, 300, 500], [60, 262, 464], 0.2);
    expect(f.a).toBeCloseTo(1.01, 9);
    expect(f.b).toBeCloseTo(-41, 9);
  });
  it('clamps the slope and refits the intercept', () => {
    const f = fitAxis([100, 300, 500], [0, 400, 800], 0.1);   // true slope 2
    expect(f.a).toBeCloseTo(1.1, 9);
    expect(f.b).toBeCloseTo(400 - 1.1 * 300, 9);             // passes through the means
  });
  it('treats samples with little spread as a pure shift', () => {
    const f = fitAxis([200, 205, 210], [240, 243, 252], 0.1);
    expect(f.a).toBe(1);
    expect(f.b).toBeCloseTo((240 + 243 + 252 - 615) / 3, 9);
  });
  it('is identity with no samples', () => { expect(fitAxis([], [], 0.1)).toEqual({ a: 1, b: 0 }); });
});

describe('fitCalibration', () => {
  it('removes a 40 px downward offset (taps read below the finger)', () => {
    const fit = fitCalibration(pairs((x, y) => [x, y + 40]));
    expect(fit.verdict).toBe('ok');
    expect(fit.cal.ay).toBeCloseTo(1, 9);
    expect(fit.cal.by).toBeCloseTo(-40, 9);
    expect(fit.cal.ax).toBeCloseTo(1, 9);
    expect(fit.cal.bx).toBeCloseTo(0, 9);
    expect(fit.maxShift).toBeCloseTo(40, 6);
    expect(fit.maxResidual).toBeLessThan(1e-6);
  });

  it('removes a stale-viewport stretch (read = y · 852/793)', () => {
    const k = 852 / 793;
    const fit = fitCalibration(pairs((x, y) => [x, y * k]));
    expect(fit.verdict).toBe('ok');
    expect(fit.cal.ay).toBeCloseTo(1 / k, 6);
    expect(fit.maxResidual).toBeLessThan(1e-6);
    const o = applyCal(fit.cal, 100, 700 * k, { x: 0, y: 0 });
    expect(o.y).toBeCloseTo(700, 6);
  });

  it('keeps x near identity even when the samples suggest a stretch', () => {
    const fit = fitCalibration(pairs((x, y) => [x * 1.3, y + 30]));
    expect(Math.abs(fit.cal.ax - 1)).toBeLessThanOrEqual(CAL_X_SLOPE + 1e-12);
  });

  it('says "accurate" within 2 px of identity (nothing to store)', () => {
    const fit = fitCalibration(pairs((x, y) => [x, y], [[1, -1], [-0.5, 1.2], [0.4, -0.3]]));
    expect(fit.verdict).toBe('accurate');
    expect(fit.maxShift).toBeLessThanOrEqual(2);
  });

  it('rejects inconsistent taps (a mis-tap on one ring)', () => {
    const fit = fitCalibration(pairs((x, y) => [x, y + 40], [[0, 0], [60, -50], [0, 0]]));
    expect(fit.verdict).toBe('inconsistent');
  });

  it('rejects corrections too large to be a calibration', () => {
    expect(fitCalibration(pairs((x, y) => [x, y + 300])).verdict).toBe('too_large');
  });

  it('tolerates realistic finger jitter around a 35 px offset', () => {
    const fit = fitCalibration(pairs((x, y) => [x + 3, y + 35], [[2, -3], [-3, 2], [1, 3]]));
    expect(fit.verdict).toBe('ok');
    const mid = applyCal(fit.cal, 120, 400 + 35, { x: 0, y: 0 });   // a tap read at the middle of the screen
    expect(mid.y).toBeGreaterThan(395);
    expect(mid.y).toBeLessThan(405);
    expect(Math.abs(fit.cal.ay - 1)).toBeLessThanOrEqual(CAL_Y_SLOPE);
  });
});

describe('parseCal / applyCal / describeCal', () => {
  it('accepts a valid calibration and rejects junk', () => {
    expect(parseCal({ ax: 1, bx: 0.5, ay: 0.98, by: -38 })).toEqual({ ax: 1, bx: 0.5, ay: 0.98, by: -38 });
    for (const bad of [null, undefined, 3, 'x', {}, { ax: 1, bx: 0, ay: 1 }, { ax: 2, bx: 0, ay: 1, by: 0 }, { ax: 1, bx: 0, ay: 1.5, by: 0 }, { ax: 1, bx: NaN, ay: 1, by: 0 }]) {
      expect(parseCal(bad)).toBeNull();
    }
  });
  it('identity and null leave points alone', () => {
    expect(applyCal(null, 12, 34, { x: 0, y: 0 })).toEqual({ x: 12, y: 34 });
    expect(applyCal(IDENTITY_CAL, 12, 34, { x: 0, y: 0 })).toEqual({ x: 12, y: 34 });
  });
  it('prints the fitted numbers', () => {
    expect(describeCal(null)).toContain('none');
    expect(describeCal({ ax: 1, bx: 0, ay: 1.002, by: -38.14 })).toBe("x' = 1.000·x + 0.0,  y' = 1.002·y − 38.1");
  });
});
