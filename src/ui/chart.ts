/** Hand-drawn SVG line-chart geometry (pure; no libraries). */
export interface ChartGeom { d: string; area: string; peak: { x: number; y: number; rate: number; seconds: number } | null; last: { x: number; y: number } | null; maxRate: number; maxSeconds: number }

export function chartGeometry(curve: readonly { seconds: number; rate: number }[], w: number, h: number, pad = 6): ChartGeom {
  const pts = curve.filter((p) => Number.isFinite(p.seconds) && Number.isFinite(p.rate));
  if (pts.length === 0) return { d: '', area: '', peak: null, last: null, maxRate: 0, maxSeconds: 0 };
  let maxR = 0, maxS = 0, minS = Infinity, pk = pts[0];
  for (const p of pts) { if (p.rate > maxR) { maxR = p.rate; pk = p; } if (p.seconds > maxS) maxS = p.seconds; if (p.seconds < minS) minS = p.seconds; }
  const spanS = Math.max(1e-9, maxS - minS), spanR = maxR > 0 ? maxR * 1.1 : 1;
  const X = (s: number): number => pad + ((s - minS) / spanS) * (w - 2 * pad);
  const Y = (r: number): number => h - pad - (Math.max(0, r) / spanR) * (h - 2 * pad);
  const f = (v: number): string => (Math.round(v * 10) / 10).toString();
  const coords = pts.map((p) => `${f(pts.length === 1 ? w / 2 : X(p.seconds))},${f(Y(p.rate))}`);
  const d = 'M' + coords.join(' L');
  const x0 = pts.length === 1 ? w / 2 : X(pts[0].seconds), x1 = pts.length === 1 ? w / 2 : X(pts[pts.length - 1].seconds);
  const area = `${d} L${f(x1)},${f(h - pad)} L${f(x0)},${f(h - pad)} Z`;
  const lp = pts[pts.length - 1];
  return {
    d, area,
    peak: { x: pts.length === 1 ? w / 2 : X(pk.seconds), y: Y(pk.rate), rate: pk.rate, seconds: pk.seconds },
    last: { x: x1, y: Y(lp.rate) },
    maxRate: maxR, maxSeconds: maxS,
  };
}
