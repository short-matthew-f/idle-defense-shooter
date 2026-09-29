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
  /**
   * Per-cell item range: cell c holds items[cellStart[c] .. cellStart[c] + cellCount[c]). Only cells that
   * were occupied at the last rebuild have a non-zero count (the others are reset lazily through
   * `used`), so a rebuild costs O(enemies + occupied cells) rather than O(DIM²). Items inside a cell
   * are in ascending pool index, and queries scan cells row-major, so results are identical to a
   * full counting sort.
   */
  private cellStart = new Int32Array(CELLS);
  private cellCount = new Int32Array(CELLS);
  private cellFill = new Int32Array(CELLS);
  private used = new Int32Array(CELLS);
  private usedN = 0;
  /** Bounding box (cell coords) of occupied cells; queries clip to it (empty grid: minCx > maxCx). */
  private minCx = DIM; private maxCx = -1; private minCy = DIM; private maxCy = -1;
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
    const start = this.cellStart, count = this.cellCount, fill = this.cellFill, cellOf = this.cellOf, used = this.used;
    for (let k = 0; k < this.usedN; k++) count[used[k]] = 0;
    let usedN = 0;
    let maxR = 0;
    let minCx = DIM, maxCx = -1, minCy = DIM, maxCy = -1;
    for (let i = 0; i < n; i++) {
      if ((p.flags[i] & EnemyFlag.Dead) !== 0) { cellOf[i] = -1; continue; }
      const cx = SpatialHash.cellCoord(p.x[i]), cy = SpatialHash.cellCoord(p.y[i]);
      if (cx < minCx) minCx = cx; if (cx > maxCx) maxCx = cx;
      if (cy < minCy) minCy = cy; if (cy > maxCy) maxCy = cy;
      const c = cy * DIM + cx;
      cellOf[i] = c;
      if (count[c]++ === 0) used[usedN++] = c;
      if (p.radius[i] > maxR) maxR = p.radius[i];
    }
    this.usedN = usedN;
    this.maxRadius = maxR;
    this.minCx = minCx; this.maxCx = maxCx; this.minCy = minCy; this.maxCy = maxCy;
    let off = 0;
    for (let k = 0; k < usedN; k++) { const c = used[k]; start[c] = off; fill[c] = off; off += count[c]; }
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
    // clip the scan to occupied cells (cells outside the box are empty: same results, fewer probes)
    const x0 = Math.max(SpatialHash.cellCoord(x - reach), this.minCx), x1 = Math.min(SpatialHash.cellCoord(x + reach), this.maxCx);
    const y0 = Math.max(SpatialHash.cellCoord(y - reach), this.minCy), y1 = Math.min(SpatialHash.cellCoord(y + reach), this.maxCy);
    const start = this.cellStart, count = this.cellCount, items = this.items;
    let k = 0;
    const cap = out.length;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * DIM + cx;
        const m = count[c];
        if (m === 0) continue;
        for (let j = start[c], e = j + m; j < e; j++) {
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
   *
   * Ring search: cells are visited in rings of growing Chebyshev distance around the query's cell and
   * the scan stops once every remaining ring is provably farther than the best candidate (lower bound =
   * distance from the point to the previous ring's outer box; enemies clamped into edge cells lie even
   * farther out, so the bound still holds). The winner is the argmin over (distance², index), which does
   * not depend on visiting order, so results are identical to the full row-major scan (kept for query
   * points outside the grid).
   */
  nearest(x: number, y: number, maxR: number, exclude?: Int32Array, excludeCount = 0): number {
    const reach = maxR + this.maxRadius;
    const x0 = Math.max(SpatialHash.cellCoord(x - reach), this.minCx), x1 = Math.min(SpatialHash.cellCoord(x + reach), this.maxCx);
    const y0 = Math.max(SpatialHash.cellCoord(y - reach), this.minCy), y1 = Math.min(SpatialHash.cellCoord(y + reach), this.maxCy);
    this.nBest = NO_ENTITY; this.nBestD = Infinity;
    if (x0 > x1 || y0 > y1) return NO_ENTITY;   // nothing occupied in reach
    if (!(x > -HALF && x < HALF && y > -HALF && y < HALF)) {
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) this.scanNearest(cy * DIM + cx, x, y, maxR, exclude, excludeCount);
      return this.nBest;
    }
    // The query cell may lie outside the clipped region (then the inner rings are simply empty).
    const ccx = SpatialHash.cellCoord(x), ccy = SpatialHash.cellCoord(y);
    const maxK = Math.max(ccx - x0, x1 - ccx, ccy - y0, y1 - ccy);
    for (let k = 0; k <= maxK; k++) {
      if (k > 0 && this.nBest !== NO_ENTITY) {
        // world-space box of rings 0..k-1; every cell of ring >= k lies outside it
        const bx0 = (ccx - k + 1) * CELL - HALF, bx1 = (ccx + k) * CELL - HALF;
        const by0 = (ccy - k + 1) * CELL - HALF, by1 = (ccy + k) * CELL - HALF;
        let lb = x - bx0;
        if (bx1 - x < lb) lb = bx1 - x;
        if (y - by0 < lb) lb = y - by0;
        if (by1 - y < lb) lb = by1 - y;
        if (lb * lb * (1 - 1e-9) > this.nBestD) break;
      }
      const cxa = ccx - k > x0 ? ccx - k : x0, cxb = ccx + k < x1 ? ccx + k : x1;
      // top and bottom rows of the ring (full width), then the side columns between them
      const top = ccy - k, bot = ccy + k, left = ccx - k, right = ccx + k;
      if (top >= y0 && top <= y1) for (let cx = cxa; cx <= cxb; cx++) this.scanNearest(top * DIM + cx, x, y, maxR, exclude, excludeCount);
      if (k > 0 && bot >= y0 && bot <= y1) for (let cx = cxa; cx <= cxb; cx++) this.scanNearest(bot * DIM + cx, x, y, maxR, exclude, excludeCount);
      if (k > 0) {
        const cya = top + 1 > y0 ? top + 1 : y0, cyb = bot - 1 < y1 ? bot - 1 : y1;
        if (left >= x0 && left <= x1) for (let cy = cya; cy <= cyb; cy++) this.scanNearest(cy * DIM + left, x, y, maxR, exclude, excludeCount);
        if (right >= x0 && right <= x1) for (let cy = cya; cy <= cyb; cy++) this.scanNearest(cy * DIM + right, x, y, maxR, exclude, excludeCount);
      }
    }
    return this.nBest;
  }
  private nBest = NO_ENTITY;
  private nBestD = Infinity;
  private scanNearest(c: number, x: number, y: number, maxR: number, exclude: Int32Array | undefined, excludeCount: number): void {
    const m = this.cellCount[c];
    if (m === 0) return;
    const p = this.pool, items = this.items;
    for (let j = this.cellStart[c], e = j + m; j < e; j++) {
      const i = items[j];
      if ((p.flags[i] & INTANGIBLE) !== 0) continue;
      const dx = p.x[i] - x, dy = p.y[i] - y, rr = maxR + p.radius[i];
      const d = dx * dx + dy * dy;
      if (d > rr * rr) continue;
      if (d < this.nBestD || (d === this.nBestD && i < this.nBest)) {
        if (excludeCount > 0 && contains(exclude!, excludeCount, i)) continue;
        this.nBest = i; this.nBestD = d;
      }
    }
  }
}

function contains(arr: Int32Array, n: number, v: number): boolean {
  for (let k = 0; k < n; k++) if (arr[k] === v) return true;
  return false;
}

/** Can this enemy be targeted by weapons (not dead / phased / burrowed / allied)? */
export function targetable(p: EnemyPool, i: number): boolean { return (p.flags[i] & INTANGIBLE) === 0; }
