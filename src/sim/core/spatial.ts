/**
 * Uniform-grid spatial hash over live enemies, rebuilt once per tick (counting sort, no allocation).
 *
 * Grid: square [-HALF, HALF]^2 with CELL-sized cells; positions outside are clamped into the edge
 * cells so every enemy is findable. Within a cell, enemies are stored in ascending pool index.
 * Queries scan cells row-major (y then x) and, within a cell, ascending index — fully deterministic.
 *
 * Predicate: an enemy matches a radius query when its CENTER is within `r + enemy.radius` of the
 * point (i.e. the query circle touches the enemy body). Dead-flagged and intangible enemies
 * (Phased/Burrowed/Ally) are skipped by `nearest`, but `queryRadius` only skips Dead.
 */
import type { EnemyPool } from './types';
import { EnemyFlag, NO_ENTITY } from './types';

export const CELL = 48;
export const HALF = 1056;                       // covers ARENA_RADIUS + spawn offsets
export const DIM = Math.ceil((HALF * 2) / CELL); // 44
const CELLS = DIM * DIM;
const INTANGIBLE = EnemyFlag.Dead | EnemyFlag.Phased | EnemyFlag.Burrowed | EnemyFlag.Ally;

export class SpatialHash {
  readonly cellStart = new Int32Array(CELLS + 1);
  private cellFill = new Int32Array(CELLS);
  items: Int32Array;
  private cellOf: Int32Array;
  /** Largest enemy radius in the current build (widens the cell scan so big bodies are found). */
  maxRadius = 0;
  pool: EnemyPool;

  constructor(pool: EnemyPool) {
    this.pool = pool;
    this.items = new Int32Array(pool.capacity);
    this.cellOf = new Int32Array(pool.capacity);
  }

  static cellCoord(v: number): number {
    let c = Math.floor((v + HALF) / CELL);
    if (c < 0) c = 0; else if (c >= DIM) c = DIM - 1;
    return c;
  }

  rebuild(): void {
    const p = this.pool, n = p.count;
    const start = this.cellStart, fill = this.cellFill, cellOf = this.cellOf;
    start.fill(0);
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      if ((p.flags[i] & EnemyFlag.Dead) !== 0) { cellOf[i] = -1; continue; }
      const c = SpatialHash.cellCoord(p.y[i]) * DIM + SpatialHash.cellCoord(p.x[i]);
      cellOf[i] = c;
      start[c + 1]++;
      if (p.radius[i] > maxR) maxR = p.radius[i];
    }
    this.maxRadius = maxR;
    for (let c = 0; c < CELLS; c++) { start[c + 1] += start[c]; fill[c] = start[c]; }
    const items = this.items;
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c >= 0) items[fill[c]++] = i;
    }
  }

  /** Writes matching indices into `out` (up to out.length); returns the number written. */
  queryRadius(x: number, y: number, r: number, out: Int32Array): number {
    const p = this.pool;
    const reach = r + this.maxRadius;
    const x0 = SpatialHash.cellCoord(x - reach), x1 = SpatialHash.cellCoord(x + reach);
    const y0 = SpatialHash.cellCoord(y - reach), y1 = SpatialHash.cellCoord(y + reach);
    const start = this.cellStart, items = this.items;
    let k = 0;
    const cap = out.length;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * DIM + cx;
        for (let j = start[c], e = start[c + 1]; j < e; j++) {
          const i = items[j];
          if ((p.flags[i] & EnemyFlag.Dead) !== 0) continue;
          const dx = p.x[i] - x, dy = p.y[i] - y, rr = r + p.radius[i];
          if (dx * dx + dy * dy <= rr * rr) { if (k < cap) out[k++] = i; else return k; }
        }
      }
    }
    return k;
  }

  /**
   * Nearest targetable enemy whose center is within maxR (+ its radius) of (x,y); ties broken by lower index.
   * `exclude` (optional) lists indices to skip (first `excludeCount` entries).
   */
  nearest(x: number, y: number, maxR: number, exclude?: Int32Array, excludeCount = 0): number {
    const p = this.pool;
    const reach = maxR + this.maxRadius;
    const x0 = SpatialHash.cellCoord(x - reach), x1 = SpatialHash.cellCoord(x + reach);
    const y0 = SpatialHash.cellCoord(y - reach), y1 = SpatialHash.cellCoord(y + reach);
    const start = this.cellStart, items = this.items;
    let best = NO_ENTITY, bestD = Infinity;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * DIM + cx;
        for (let j = start[c], e = start[c + 1]; j < e; j++) {
          const i = items[j];
          if ((p.flags[i] & INTANGIBLE) !== 0) continue;
          const dx = p.x[i] - x, dy = p.y[i] - y, rr = maxR + p.radius[i];
          const d = dx * dx + dy * dy;
          if (d > rr * rr) continue;
          if (d < bestD || (d === bestD && i < best)) {
            if (excludeCount > 0 && contains(exclude!, excludeCount, i)) continue;
            best = i; bestD = d;
          }
        }
      }
    }
    return best;
  }
}

function contains(arr: Int32Array, n: number, v: number): boolean {
  for (let k = 0; k < n; k++) if (arr[k] === v) return true;
  return false;
}

/** Can this enemy be targeted by weapons (not dead / phased / burrowed / allied)? */
export function targetable(p: EnemyPool, i: number): boolean { return (p.flags[i] & INTANGIBLE) === 0; }
