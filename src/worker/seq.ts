/**
 * Command-journal bookkeeping for the worker (N-09, "never lose a purchase"). Pure, so it is unit tested without a Worker.
 * The main thread stamps each journaled command with a monotonic `seq`; the worker notes the seqs it hands to the sim and,
 * after each step (which drains the sim's whole command queue), moves `applied` up to the highest seq it handed over.
 * A save carries `applied` as `journalSeq`: every journaled command with seq <= journalSeq is inside that save.
 * UI bookkeeping only: nothing here reaches the sim.
 */
export class SeqTracker {
  private pending = 0;
  private appliedSeq: number;
  private held = new Set<number>();
  constructor(initial = 0) { this.appliedSeq = initial; }
  /** A command with this seq was handed to the sim's queue (undefined = transient, not journaled). */
  note(seq: number | undefined): void { if (seq !== undefined && Number.isFinite(seq) && seq > this.pending) this.pending = seq; }
  /** A step ran: everything handed over before it is now applied. */
  stepped(): void { if (this.pending > this.appliedSeq) this.appliedSeq = this.pending; }
  /** The highest seq inside the sim state (what `postSave` stamps as journalSeq). */
  get applied(): number {
    if (this.held.size === 0) return this.appliedSeq;
    let low = Infinity;
    for (const q of this.held) if (q < low) low = q;
    return Math.min(this.appliedSeq, low - 1);   // a replayed command still waiting (e.g. for Scrap) is not inside any save yet
  }
  /** A replayed command is waiting to be retried: saves must not claim it (or anything after it). */
  hold(seq: number): void { this.held.add(seq); }
  release(seq: number): void { this.held.delete(seq); }
  reset(initial = 0): void { this.pending = 0; this.appliedSeq = initial; this.held.clear(); }
}

/** Retry the head of a replay queue for this many sim ticks (60 s at 60 Hz) before giving up on it. */
export const REPLAY_RETRY_TICKS = 3600;
/** How often (ticks) a waiting replayed command is tried again. */
export const REPLAY_RETRY_EVERY = 30;
/** Rejections worth waiting out: the saved state predates some income, so the Scrap / Cores may simply not have arrived yet. */
export function isWaitable(message: string | null): boolean { return message !== null && /^Not enough (Scrap|Cores)/.test(message); }

/**
 * Commands re-sent from the journal on load, handed to the sim one at a time in order. The save they replay onto is from
 * before the purchase, so the first try can fall short on Scrap that the player had earned since: such a head waits and
 * is retried until the income is back (or REPLAY_RETRY_TICKS pass); any other rejection drops it.
 */
export class ReplayQueue<C> {
  private items: { cmd: C; seq: number; waited: number }[] = [];
  get length(): number { return this.items.length; }
  push(cmd: C, seq: number | undefined): void { this.items.push({ cmd, seq: seq ?? -1, waited: 0 }); }
  /** The command to hand to the sim this tick (null: empty, or the head is waiting for its next retry). */
  next(): { cmd: C; seq: number } | null {
    const h = this.items[0];
    if (!h) return null;
    if (h.waited > 0 && h.waited % REPLAY_RETRY_EVERY !== 0) { h.waited++; return null; }
    return h;
  }
  /** The step that ran `next()` finished with this rejection (null = applied). Returns the seq to release, or null if it stays queued. */
  settle(message: string | null): number | null {
    const h = this.items[0];
    if (!h) return null;
    if (isWaitable(message) && h.waited + 1 < REPLAY_RETRY_TICKS) { h.waited++; return null; }
    this.items.shift();
    return h.seq;
  }
  clear(): void { this.items = []; }
}

