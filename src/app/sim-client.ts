/**
 * Typed main-thread wrapper around the sim worker (protocol: core/types.ts ToWorker / FromWorker).
 *
 *   const client = new SimClient(save);
 *   client.onSnapshot = (snap) => { renderer.draw(snap); client.releaseSnapshot(snap); };
 *   client.onUi = (ui) => hud.update(ui);
 *   requestAnimationFrame loop: client.tickBudget(framesElapsed * ui.run.speedMultiplier);
 */
import { savesAfter } from './autosave';
import { appendJournal, nextSeq, readJournal, type JournalEntry } from './journal';
import type { AudioDigest, Command, FromWorker, RenderSnapshot, SaveState, SimEvent, ToWorker, UiState } from '../sim/core/types';

export class SimClient {
  readonly worker: Worker;
  onSnapshot: ((snap: RenderSnapshot) => void) | null = null;
  onUi: ((ui: UiState) => void) | null = null;
  onReady: ((ui: UiState) => void) | null = null;
  /** Event batches; `audio` (audio pass) carries the Hits and projectile launches the batch leaves out. `events` may be empty when only `audio` has content. */
  onEvents: ((events: SimEvent[], audio?: AudioDigest) => void) | null = null;
  onSave: ((save: SaveState) => void) | null = null;
  onError: ((message: string, stack?: string) => void) | null = null;
  /** A player command was rejected by the sim (message is player-facing, e.g. "Not enough Scrap"). */
  onCmdError: ((message: string, cmd: Command['type']) => void) | null = null;
  private saveWaiters: ((s: SaveState) => void)[] = [];
  private inspectWaiters: ((r: { chain: SimEvent[]; sentence: string }) => void)[] = [];
  /** Latest UiState received (null until ready). */
  ui: UiState | null = null;
  /** Next command-journal seq (app/journal.ts): above the save's journalSeq and everything already journaled. */
  private seq: number;

  constructor(save: SaveState | null, opts: { seed?: number; worker?: Worker } = {}) {
    this.seq = nextSeq(save?.journalSeq, readJournal());
    this.worker = opts.worker ?? new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
    // A worker that fails to load or throws at top level never posts `error` itself; surface it.
    this.worker.onerror = (ev: ErrorEvent) => { ev.preventDefault?.(); this.onError?.(`worker: ${ev.message || 'failed to start'}`); };
    this.worker.onmessageerror = () => { this.onError?.('worker: a message could not be deserialized'); };
    this.post({ t: 'init', save, ...(opts.seed !== undefined ? { seedOverride: opts.seed } : {}) });
  }

  private post(msg: ToWorker, transfer: Transferable[] = []): void { this.worker.postMessage(msg, transfer); }

  private receive(msg: FromWorker): void {
    switch (msg.t) {
      case 'ready': this.ui = msg.ui; this.onReady?.(msg.ui); this.onUi?.(msg.ui); break;
      case 'snapshot': this.onSnapshot?.(msg.snap); break;
      case 'ui': this.ui = msg.ui; this.onUi?.(msg.ui); break;
      case 'events': this.onEvents?.(msg.events, msg.audio); break;
      case 'save': {
        const waiters = this.saveWaiters; this.saveWaiters = [];
        for (const w of waiters) w(msg.save);
        this.onSave?.(msg.save);
        break;
      }
      case 'inspector': { const w = this.inspectWaiters.shift(); w?.({ chain: msg.chain, sentence: msg.sentence }); break; }
      case 'error': this.onError?.(msg.message, msg.stack); break;
      case 'cmd_error': this.onCmdError?.(msg.message, msg.cmd); break;
    }
  }

  /** Queue a player command (applied at the start of the next tick). */
  send(cmd: Command): void {
    if (!savesAfter(cmd)) { this.post({ t: 'cmd', cmd }); return; }
    // never lose a purchase: journal it synchronously (survives a kill before the next save), then post it with its seq
    const seq = this.seq++;
    appendJournal({ seq, cmd });
    this.post({ t: 'cmd', cmd, seq });
  }
  /** Re-send journaled commands from before a reload, in order, with their original seqs (not journaled again; rejections stay silent). */
  replay(entries: readonly JournalEntry[]): void {
    for (const e of entries) this.post({ t: 'cmd', cmd: e.cmd, seq: e.seq, replay: true });
  }
  /** Let the worker run up to n ticks now (call once per animation frame). */
  tickBudget(n: number): void { this.post({ t: 'tick_budget', ticks: n }); }
  setRunning(running: boolean): void { this.post({ t: 'run', running }); }
  wantSnapshot(): void { this.post({ t: 'want_snapshot' }); }
  setClarity(value: number): void { this.post({ t: 'set_clarity', value }); }
  /** Hand a rendered snapshot's buffers back to the worker for reuse (transfers them). */
  releaseSnapshot(snap: RenderSnapshot): void {
    if (snap.instances.buffer.byteLength === 0) return;   // already transferred
    this.post({ t: 'return_buffer', instances: snap.instances, fx: snap.fx }, [snap.instances.buffer, snap.fx.buffer]);
  }
  requestSave(): Promise<SaveState> {
    return new Promise((resolve) => { this.saveWaiters.push(resolve); this.post({ t: 'want_save' }); });
  }
  inspect(enemyIndex: number, gen: number): Promise<{ chain: SimEvent[]; sentence: string }> {
    return new Promise((resolve) => { this.inspectWaiters.push(resolve); this.post({ t: 'inspector', enemyIndex, gen }); });
  }
  terminate(): void { this.worker.terminate(); }
}
