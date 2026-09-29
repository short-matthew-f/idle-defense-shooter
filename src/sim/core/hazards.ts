/**
 * Hazard zones (fire zones, toxic clouds, plasma lines, enemy hazards...). `Hazard.life` is in
 * SECONDS; `dps` is damage per second, applied in 4 Hz pulses (every 15 ticks) so the event log
 * stays small. Player hazards damage enemies inside (circle, or a capsule when x2/y2 are set);
 * owner 'enemy' hazards damage the tower when it is inside. Kill-chain parent: `hazard.cause`.
 */
import type { WorldImpl } from './world-impl';
import type { Hazard } from './types';
import { EnemyFlag, TICK_DT, TOWER_RADIUS } from './types';

const INTANGIBLE = EnemyFlag.Phased | EnemyFlag.Burrowed;

const PULSE_TICKS = 15;
const PULSE_DT = PULSE_TICKS * TICK_DT;
const SCRATCH = new Int32Array(1024);

function segDist2(px: number, py: number, h: Hazard): number {
  const ax = h.x, ay = h.y, bx = h.x2 ?? h.x, by = h.y2 ?? h.y;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const qx = px - (ax + dx * t), qy = py - (ay + dy * t);
  return qx * qx + qy * qy;
}

export function updateHazards(w: WorldImpl): void {
  const hz = w.hazards;
  if (hz.length === 0) return;
  const pulse = w.tick % PULSE_TICKS === 0;
  const e = w.enemies;
  let k = 0;
  for (let i = 0; i < hz.length; i++) {
    const h = hz[i];
    h.life -= TICK_DT;
    if (pulse && h.dps > 0) {
      const amt = h.dps * PULSE_DT;
      if (h.owner === 'enemy') {
        const rr = h.radius + TOWER_RADIUS;
        if (segDist2(0, 0, h) <= rr * rr) w.damageTower(amt, -1, h.cause);
      } else {
        const line = h.x2 !== undefined && h.y2 !== undefined;
        const cx = line ? (h.x + h.x2!) * 0.5 : h.x, cy = line ? (h.y + h.y2!) * 0.5 : h.y;
        const lx = line ? h.x2! - h.x : 0, ly = line ? h.y2! - h.y : 0;
        const reach = line ? Math.sqrt(lx * lx + ly * ly) * 0.5 + h.radius : h.radius;
        const n = w.spatial.queryRadius(cx, cy, reach, SCRATCH);
        const tag = h.srcTag ?? h.element ?? h.owner;   // WP2: explicit srcTag wins
        for (let j = 0; j < n; j++) {
          const en = SCRATCH[j];
          if (!w.alive(en)) continue;
          if (e.flags[en] & INTANGIBLE) continue;   // Phased / Burrowed enemies are intangible
          if (line) { const rr = h.radius + e.radius[en]; if (segDist2(e.x[en], e.y[en], h) > rr * rr) continue; }
          w.damage(en, amt, { source: 'hazard', srcTag: tag, element: h.element ?? null, cause: h.cause });
        }
      }
    }
    if (h.life > 0) hz[k++] = h;
  }
  hz.length = k;
}
