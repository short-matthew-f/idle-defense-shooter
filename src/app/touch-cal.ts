/**
 * Tap calibration (pure). A per-axis linear correction applied to canvas-local CSS pixels before they
 * are mapped into the camera:  x' = ax * x + bx,  y' = ay * y + by.
 *
 * Fitted from a few (tapped, drawn) pairs: the player taps the centre of rings the canvas draws at known
 * positions (More → Help → Touch test → Calibrate taps). The slope is least squares, clamped near 1 (a
 * phone's touch offset is a shift, perhaps a small stretch, never a large scale), and the intercept is
 * then refit for the clamped slope. It corrects any systematic offset between where the finger lands and
 * where the game reads it, whatever the cause (WebKit, the status bar, finger posture).
 */

export interface TouchCal { ax: number; bx: number; ay: number; by: number }

export const IDENTITY_CAL: Readonly<TouchCal> = { ax: 1, bx: 0, ay: 1, by: 0 };

/** Slope limits: y may stretch a little (a stale viewport height), x barely. */
export const CAL_Y_SLOPE = 0.12;
export const CAL_X_SLOPE = 0.05;
/** A fit whose correction stays within this many CSS px at every sample is "accurate": nothing is stored. */
export const CAL_ACCURATE_PX = 2;
/** Samples that miss the fitted line by more than this were mis-taps: ask again. */
export const CAL_MAX_RESIDUAL_PX = 14;
/** No correction may move a tap further than this (px): anything larger is not a calibration. */
export const CAL_MAX_SHIFT_PX = 150;

export interface CalPair {
  /** Where the tap was read (canvas-local CSS px, no calibration applied). */
  tapX: number; tapY: number;
  /** Where the target was drawn (canvas-local CSS px). */
  wantX: number; wantY: number;
}

export interface CalFit {
  cal: TouchCal;
  /** accurate: within CAL_ACCURATE_PX of identity (store nothing); ok: store `cal`; inconsistent / too_large: retry. */
  verdict: 'accurate' | 'ok' | 'inconsistent' | 'too_large';
  /** Largest |correction| at the samples (px). */
  maxShift: number;
  /** Largest residual after the fit (px). */
  maxResidual: number;
}

/** Least-squares y = a x + b with `a` clamped to [1 - lim, 1 + lim] (b refit for the clamped slope). */
export function fitAxis(got: readonly number[], want: readonly number[], lim: number): { a: number; b: number } {
  const n = Math.min(got.length, want.length);
  if (n === 0) return { a: 1, b: 0 };
  let mg = 0, mw = 0;
  for (let i = 0; i < n; i++) { mg += got[i]; mw += want[i]; }
  mg /= n; mw /= n;
  let sgg = 0, sgw = 0;
  for (let i = 0; i < n; i++) { const dg = got[i] - mg; sgg += dg * dg; sgw += dg * (want[i] - mw); }
  // too little spread to tell a slope from noise (< 40 px between samples): pure shift
  let a = sgg > n * 400 ? sgw / sgg : 1;
  if (!Number.isFinite(a)) a = 1;
  a = Math.max(1 - lim, Math.min(1 + lim, a));
  return { a, b: mw - a * mg };
}

export function applyCal(cal: Readonly<TouchCal> | null, x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
  if (!cal) { out.x = x; out.y = y; return out; }
  out.x = cal.ax * x + cal.bx;
  out.y = cal.ay * y + cal.by;
  return out;
}

/** Fit a calibration from (tapped, drawn) pairs; see CalFit for the verdicts. */
export function fitCalibration(pairs: readonly CalPair[]): CalFit {
  const fx = fitAxis(pairs.map((p) => p.tapX), pairs.map((p) => p.wantX), CAL_X_SLOPE);
  const fy = fitAxis(pairs.map((p) => p.tapY), pairs.map((p) => p.wantY), CAL_Y_SLOPE);
  const cal: TouchCal = { ax: fx.a, bx: fx.b, ay: fy.a, by: fy.b };
  let maxShift = 0, maxResidual = 0;
  const o = { x: 0, y: 0 };
  for (const p of pairs) {
    applyCal(cal, p.tapX, p.tapY, o);
    maxShift = Math.max(maxShift, Math.hypot(o.x - p.tapX, o.y - p.tapY));
    maxResidual = Math.max(maxResidual, Math.hypot(o.x - p.wantX, o.y - p.wantY));
  }
  const verdict: CalFit['verdict'] = pairs.length === 0 || maxResidual > CAL_MAX_RESIDUAL_PX ? 'inconsistent'
    : maxShift > CAL_MAX_SHIFT_PX ? 'too_large'
    : maxShift <= CAL_ACCURATE_PX ? 'accurate'
    : 'ok';
  return { cal, verdict, maxShift, maxResidual };
}

/** A stored calibration, validated (null when absent, malformed or out of range). */
export function parseCal(v: unknown): TouchCal | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const num = (k: string): number | null => (typeof c[k] === 'number' && Number.isFinite(c[k]) ? c[k] as number : null);
  const ax = num('ax'), bx = num('bx'), ay = num('ay'), by = num('by');
  if (ax === null || bx === null || ay === null || by === null) return null;
  if (Math.abs(ax - 1) > CAL_X_SLOPE + 1e-9 || Math.abs(ay - 1) > CAL_Y_SLOPE + 1e-9) return null;
  if (Math.abs(bx) > 1000 || Math.abs(by) > 1000) return null;
  return { ax, bx, ay, by };
}

/** "y' = 1.002·y − 38.1" style text for the fitted numbers. */
export function describeCal(cal: Readonly<TouchCal> | null): string {
  if (!cal) return 'none (identity)';
  const f = (a: number, b: number, v: string): string => `${v}' = ${a.toFixed(3)}·${v} ${b < 0 ? '−' : '+'} ${Math.abs(b).toFixed(1)}`;
  return `${f(cal.ax, cal.bx, 'x')},  ${f(cal.ay, cal.by, 'y')}`;
}
