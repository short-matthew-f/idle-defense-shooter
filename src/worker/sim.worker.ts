/// <reference lib="webworker" />
/**
 * Web Worker around Sim (protocol: core/types.ts ToWorker / FromWorker).
 *  - The main thread sends `tick_budget` each animation frame (frames × speed), so hidden tabs
 *    naturally stop simulating; the worker runs at most MAX_TICKS_PER_BUDGET ticks per message.
 *  - After a budget: posts `snapshot` (instances/fx copied into transferable buffers; the main
 *    thread hands them back with `return_buffer`, giving double buffering), `ui` every 6 ticks,
 *    `events` batches (non-Hit/Spawn events since the last batch) and `save` every 30 s of sim time.
 */
import { Sim } from '../sim/index';
import type { FromWorker, RenderSnapshot, SimEvent, ToWorker } from '../sim/core/types';
import { Ev, INSTANCE_FLOATS, FX_FLOATS, TICK_RATE } from '../sim/core/types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const MAX_TICKS_PER_BUDGET = 240;
const UI_EVERY = 6;
const SAVE_EVERY = 30 * TICK_RATE;
const MAX_EVENTS_PER_BATCH = 500;

let sim: Sim | null = null;
let running = true;
let ticksSinceUi = 0;
let ticksSinceSave = 0;
let lastEventId = 0;
const freeInstances: Float32Array[] = [new Float32Array(INSTANCE_FLOATS * 4096), new Float32Array(INSTANCE_FLOATS * 4096)];
const freeFx: Float32Array[] = [new Float32Array(FX_FLOATS * 1024), new Float32Array(FX_FLOATS * 1024)];

function post(msg: FromWorker, transfer: Transferable[] = []): void { ctx.postMessage(msg, transfer); }

function take(pool: Float32Array[], need: number, min: number): Float32Array {
  for (let i = 0; i < pool.length; i++) if (pool[i].length >= need) return pool.splice(i, 1)[0];
  return new Float32Array(Math.max(need, min));
}

function postSnapshot(): void {
  if (!sim) return;
  const s = sim.snapshot();
  const ni = s.instanceCount * INSTANCE_FLOATS, nf = s.fxCount * FX_FLOATS;
  const inst = take(freeInstances, ni, INSTANCE_FLOATS * 4096);
  const fx = take(freeFx, nf, FX_FLOATS * 1024);
  inst.set(s.instances.subarray(0, ni));
  fx.set(s.fx.subarray(0, nf));
  const snap: RenderSnapshot = { ...s, instances: inst, fx };
  post({ t: 'snapshot', snap }, [inst.buffer, fx.buffer]);
}

function postEvents(): void {
  if (!sim) return;
  const out: SimEvent[] = [];
  sim.events.forEachSince(lastEventId, (e) => {
    if (e.type === Ev.Hit || e.type === Ev.Spawn || e.type === Ev.StatusTick) return;
    if (out.length < MAX_EVENTS_PER_BATCH) out.push({ ...e, ...(e.data ? { data: { ...e.data } } : {}) });
  });
  lastEventId = sim.events.nextId;
  if (out.length) post({ t: 'events', events: out });
}

function postSave(): void {
  if (!sim) return;
  const save = sim.save();
  save.savedAtMs = Date.now();
  post({ t: 'save', save });
}

function handle(msg: ToWorker): void {
  switch (msg.t) {
    case 'init':
      sim = new Sim(msg.save, msg.seedOverride ?? 1);
      lastEventId = 0; ticksSinceUi = 0; ticksSinceSave = 0;
      post({ t: 'ready', ui: sim.uiState() });
      break;
    case 'cmd': sim?.command(msg.cmd); break;
    case 'run': running = msg.running; break;
    case 'tick_budget': {
      if (!sim || !running) break;
      const n = Math.max(0, Math.min(MAX_TICKS_PER_BUDGET, Math.floor(msg.ticks)));
      for (let i = 0; i < n; i++) {
        sim.step();
        if (++ticksSinceUi >= UI_EVERY) { ticksSinceUi = 0; post({ t: 'ui', ui: sim.uiState() }); }
        if (++ticksSinceSave >= SAVE_EVERY) { ticksSinceSave = 0; postSave(); }
      }
      if (n > 0) { postEvents(); postSnapshot(); }
      break;
    }
    case 'want_snapshot': postSnapshot(); break;
    case 'want_save': postSave(); break;
    case 'inspector': {
      if (!sim) break;
      const id = sim.findDeathEvent(msg.enemyIndex, msg.gen);
      const r = id >= 0 ? sim.inspect(id) : { chain: [], sentence: '' };
      post({ t: 'inspector', chain: r.chain, sentence: r.sentence });
      break;
    }
    case 'set_clarity': if (sim) sim.world.meta.settings.clarity = msg.value; break;
    case 'return_buffer':
      if (freeInstances.length < 4) freeInstances.push(msg.instances);
      if (freeFx.length < 4) freeFx.push(msg.fx);
      break;
  }
}

ctx.onmessage = (ev: MessageEvent<ToWorker>): void => {
  try { handle(ev.data); }
  catch (e) { post({ t: 'error', message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) }); }
};
