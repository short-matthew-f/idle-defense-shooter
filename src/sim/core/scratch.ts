/**
 * Depth-indexed scratch buffers for spatial queries (one implementation for the whole sim; the
 * hardpoints, elements and World.explode used to carry three copies). Hooks re-enter: an explosion
 * damages → onHit → another system queries → damages ... so a loop that calls World methods while
 * iterating query results must hold its own buffer: `push()` before the query, `pop()` after the loop.
 *
 * Buffers are allocated on first use at each depth (warm-up only), never per call.
 * Note the size: `SpatialHash.queryRadius` silently stops at `out.length`, so a 1024-entry buffer caps
 * a query at 1024 enemies (MAX_ENEMIES is 1500); use MAX_ENEMIES-sized stacks where that matters.
 */
export class ScratchStack {
  private bufs: Int32Array[] = [];
  private depth = 0;
  constructor(private readonly size = 1024, levels = 0) { for (let i = 0; i < levels; i++) this.bufs.push(new Int32Array(size)); }
  push(): Int32Array {
    const d = this.depth++;
    while (this.bufs.length <= d) this.bufs.push(new Int32Array(this.size));
    return this.bufs[d];
  }
  pop(): void { if (this.depth > 0) this.depth--; }
}
