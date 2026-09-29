/**
 * Segment geometry shared by hardpoints (beams, blades), hazards (plasma lines) and boss scripts
 * (walls, sweeps). Pure arithmetic plus Math.sqrt: deterministic across engines.
 */

/** Parameter t ∈ [0,1] of P's projection on segment AB (0 for a degenerate segment). */
export function segParam(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t;
}

/** Squared distance from point P to segment AB. */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const qx = px - (ax + dx * t), qy = py - (ay + dy * t);
  return qx * qx + qy * qy;
}

/** Distance from point P to segment AB. */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(segDist2(px, py, ax, ay, bx, by));
}

/** Do segments p0→p1 and q0→q1 intersect (inclusive; parallel segments never do)? */
export function segmentsCross(p0x: number, p0y: number, p1x: number, p1y: number, q0x: number, q0y: number, q1x: number, q1y: number): boolean {
  const d1x = p1x - p0x, d1y = p1y - p0y, d2x = q1x - q0x, d2y = q1y - q0y;
  const den = d1x * d2y - d1y * d2x;
  if (den === 0) return false;
  const ex = q0x - p0x, ey = q0y - p0y;
  const t = (ex * d2y - ey * d2x) / den, u = (ex * d1y - ey * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
