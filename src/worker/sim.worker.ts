/// <reference lib="webworker" />
/**
 * Web Worker around Sim (protocol: core/types.ts ToWorker / FromWorker).
 *  - The main thread sends `tick_budget` each animation frame (frames × speed), so hidden tabs
 *    naturally stop simulating; the worker runs at most MAX_TICKS_PER_BUDGET ticks per message.
 *  - After a budget: posts `snapshot` (instances/fx copied into transferable buffers; the main
 *    thread hands them back with `return_buffer`, giving double buffering), `ui` every 6 ticks,
 *    `events` batches (non-Hit/Spawn events since the last batch, plus an `audio` digest of Hits and
 *    projectile launches for the sound director) and `save` every 30 s of sim time.
 *  - A rejected player command posts `cmd_error` (Sim.takeLastError; Directive commands are silent).
 *  - Fault tolerance: if step() throws, the worker posts `error` (once per distinct failure), keeps
 *    serving the last good snapshot, and on the next tick budget restarts the checkpoint (after
 *    repeated failures: rebuilds the Sim from the last good save), so one bug never freezes the game.
 *  - A save the Sim cannot load posts `error` with message `init: ...` and leaves the worker idle (no
 *    fresh game: that would autosave over the player's save). Every `inspector` request gets a reply.
 */
import { Sim } from '../sim/index';
import type { AudioDigest, Command, FromWorker, RenderSnapshot, SaveState, SimEvent, ToWorker } from '../sim/core/types';
import { Ev, INSTANCE_FLOATS, FX_FLOATS, ProjFlag, ProjKind, TICK_RATE } from '../sim/core/types';
import { StateBit } from '../sim/core/events';
import { ReplayQueue, SeqTracker } from './seq';

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
/** Command journal bookkeeping (N-09): which journaled commands the sim has applied; replayed commands' rejections stay silent. */
const seqs = new SeqTracker();
const replays = new ReplayQueue<Command>();
const freeInstances: Float32Array[] = [new Float32Array(INSTANCE_FLOATS * 4096), new Float32Array(INSTANCE_FLOATS * 4096)];
const freeFx: Float32Array[] = [new Float32Array(FX_FLOATS * 1024), new Float32Array(FX_FLOATS * 1024)];

// ---- fault handling: a throwing step() never freezes the game --------------------------------
/** True after step() threw: no more ticks until a recovery succeeds. */
let faulted = false;
let recoveries = 0;
const MAX_RESTART_RECOVERIES = 3;
const reported = new Set<string>();
/** Last good render state (copied on every successful snapshot) served while faulted. */
let goodInst = new Float32Array(0);
let goodMeta: Omit<RenderSnapshot, 'instances' | 'fx'> | null = null;
/** Last good save (periodic saves), used to rebuild the Sim if restarting the checkpoint keeps failing. */
let goodSave: SaveState | null = null;

function post(msg: FromWorker, transfer: Transferable[] = []): void { ctx.postMessage(msg, transfer); }

function reportError(e: unknown, where: string): void {
  const message = e instanceof Error ? e.message : String(e);
  const key = `${where}:${message}`;
  if (reported.has(key)) return;   // once per distinct failure
  reported.add(key);
  post({ t: 'error', message: `${where}: ${message}`, ...(e instanceof Error && e.stack ? { stack: e.stack } : {}) });
}

function take(pool: Float32Array[], need: number, min: number): Float32Array {
  for (let i = 0; i < pool.length; i++) if (pool[i].length >= need) return pool.splice(i, 1)[0];
  return new Float32Array(Math.max(need, min));
}

function postSnapshot(): void {
  if (!sim) return;
  let s: RenderSnapshot | null = null;
  if (!faulted) {
    try { s = sim.snapshot(); } catch (e) { reportError(e, 'snapshot'); s = null; }
  }
  if (s) {
    const ni = s.instanceCount * INSTANCE_FLOATS;
    if (goodInst.length < ni) goodInst = new Float32Array(Math.max(ni, INSTANCE_FLOATS * 4096));
    goodInst.set(s.instances.subarray(0, ni));
    goodMeta = { tick: s.tick, instanceCount: s.instanceCount, fxCount: 0, cameraShake: s.cameraShake, clarity: s.clarity };
  } else if (goodMeta) {
    // Serve the last good frame (no fx) so the renderer keeps drawing.
    s = { ...goodMeta, instances: goodInst, fx: new Float32Array(0) };
  } else return;
  const ni = s.instanceCount * INSTANCE_FLOATS, nf = s.fxCount * FX_FLOATS;
  const inst = take(freeInstances, ni, INSTANCE_FLOATS * 4096);
  const fx = take(freeFx, nf, FX_FLOATS * 1024);
  inst.set(s.instances.subarray(0, ni));
  if (nf > 0) fx.set(s.fx.subarray(0, nf));
  const snap: RenderSnapshot = { ...s, instances: inst, fx };
  post({ t: 'snapshot', snap }, [inst.buffer, fx.buffer]);
}

function postUi(): void {
  if (!sim) return;
  try { post({ t: 'ui', ui: sim.uiState() }); } catch (e) { reportError(e, 'uiState'); }
}

function postEvents(): void {
  if (!sim) return;
  const out: SimEvent[] = [];
  const log = sim.events;
  let nHits = 0;
  log.forEachSince(lastEventId, (e) => {
    if (e.type === Ev.Hit) {   // audio digest: every Hit's id (links + sample below)
      if (nHits === hitIds.length) { const g = new Int32Array(hitIds.length * 2); g.set(hitIds); hitIds = g; }
      hitIds[nHits++] = e.id;
      return;
    }
    if (e.type === Ev.Spawn || e.type === Ev.StatusTick) return;
    if (out.length < MAX_EVENTS_PER_BATCH) out.push({ ...e, ...(e.data ? { data: { ...e.data } } : {}) });
  });
  lastEventId = log.nextId;
  const audio = audioDigest(nHits);
  if (out.length || audio) post({ t: 'events', events: out, ...(audio ? { audio } : {}) }, audio ? [audio.links.buffer] : []);
}

// ---- audio digest (audio pass): Hits and projectile launches, which the events batch leaves out ----
const MAX_HIT_SAMPLE = 48;
let hitIds = new Int32Array(4096);
/** Projectile generations below this were already reported as launches. */
let lastProjGen = 0;

function audioDigest(nHits: number): AudioDigest | null {
  if (!sim) return null;
  const log = sim.events;
  const links = new Int32Array(nHits * 3);
  let live = 0;
  for (let k = 0; k < nHits; k++) {
    const e = log.byId(hitIds[k]);
    if (!e) continue;
    const p = e.cause >= 0 ? log.byId(e.cause) : undefined;
    links[live * 3] = e.id; links[live * 3 + 1] = e.cause; links[live * 3 + 2] = p && p.src === e.src ? 1 : 0;
    hitIds[live++] = e.id;
  }
  // sample: crits and deep chains first, then evenly spaced ordinary hits
  const picked: number[] = [];
  for (let k = 0; k < live && picked.length < MAX_HIT_SAMPLE / 2; k++) {
    const e = log.byId(hitIds[k]);
    if (e && (((e.c ?? 0) & StateBit.Crit) !== 0 || log.depthOf(e.id) >= 3)) picked.push(e.id);
  }
  const stride = Math.max(1, Math.ceil(live / Math.max(1, MAX_HIT_SAMPLE - picked.length)));
  for (let k = 0; k < live && picked.length < MAX_HIT_SAMPLE; k += stride) if (!picked.includes(hitIds[k])) picked.push(hitIds[k]);
  picked.sort((a, b) => a - b);
  const hits: SimEvent[] = [];
  for (const id of picked) { const e = log.byId(id); if (e) hits.push({ id: e.id, tick: e.tick, type: e.type, cause: e.cause, src: e.src, a: e.a, b: e.b, x: e.x, y: e.y, c: e.c ?? 0 }); }
  // launches: projectiles whose generation is new since the last batch (short-lived ones may be missed; that is fine for sound)
  const pr = sim.world.projectiles;
  const shots = [0, 0, 0, 0, 0, 0, 0, 0];
  let maxGen = lastProjGen - 1;
  for (let i = 0; i < pr.count; i++) {
    const g = pr.gen[i];
    if (g > maxGen) maxGen = g;
    if (g < lastProjGen || (pr.flags[i] & ProjFlag.Hostile) !== 0) continue;
    const k = pr.kind[i];
    const cls = k === ProjKind.Bullet || k === ProjKind.Fireball ? 0 : k === ProjKind.Missile || k === ProjKind.Rocket || k === ProjKind.Shell || k === ProjKind.Bomb ? 1
      : k === ProjKind.DroneShot || k === ProjKind.Microdrone ? 2 : k === ProjKind.EnemyShot ? -1 : 3;
    if (cls < 0) continue;
    if (shots[cls * 2]++ === 0) shots[cls * 2 + 1] = pr.x[i];
  }
  lastProjGen = maxGen + 1;
  if (live === 0 && shots[0] + shots[2] + shots[4] + shots[6] === 0) return null;
  return { links: live * 3 === links.length ? links : links.slice(0, live * 3), hits, shots };
}

function postSave(): void {
  if (!sim) return;
  let save: SaveState;
  try { save = sim.save(); } catch (e) { reportError(e, 'save'); return; }
  save.savedAtMs = Date.now();
  save.journalSeq = seqs.applied;
  if (!faulted) goodSave = save;
  post({ t: 'save', save });
}

/** Report a rejected player command to the UI. */
/** This step ran a replayed command: rejections are the replay queue's business, never a toast. */
let replayHead: { cmd: Command; seq: number } | null = null;
function postCmdError(): void {
  if (!sim) return;
  const cmd = sim.lastErrorCommand;
  const message = sim.takeLastError();
  if (replayHead) {   // a replayed command that no longer applies (offer gone, price changed): no toast; the queue decides retry or drop
    const seq = replays.settle(message);
    if (seq !== null) seqs.release(seq);
    replayHead = null;
    return;
  }
  if (message !== null && cmd !== null) post({ t: 'cmd_error', message, cmd });
}

/**
 * After a throwing step: restart the current checkpoint (a fresh attempt clears combat state).
 * If that keeps failing, rebuild the Sim from the last good save. Returns true when ticking may resume.
 */
function recover(): boolean {
  if (!sim) return false;
  recoveries++;
  try {
    if (recoveries > MAX_RESTART_RECOVERIES && goodSave) {
      sim = new Sim(JSON.parse(JSON.stringify(goodSave)) as SaveState);
      lastEventId = sim.events.nextId; lastProjGen = 0;
    } else {
      sim.command({ type: 'restart_checkpoint' });
    }
    sim.step();
    sim.takeLastError();
    faulted = false;
    return true;
  } catch (e) {
    reportError(e, 'recovery');
    return false;
  }
}

function handle(msg: ToWorker): void {
  switch (msg.t) {
    case 'init':
      try { sim = new Sim(msg.save, msg.seedOverride ?? 1); }
      catch (e) {
        // A save the sim cannot load (corrupt, or from a newer build): report it as `init: ...` and stay
        // idle. Never fall back to a fresh game here: the next autosave would overwrite the player's save.
        sim = null; reported.delete(`init:${e instanceof Error ? e.message : String(e)}`); reportError(e, 'init');
        break;
      }
      lastEventId = 0; lastProjGen = 0; ticksSinceUi = 0; ticksSinceSave = 0;
      faulted = false; recoveries = 0; goodSave = msg.save; goodMeta = null;
      seqs.reset(msg.save?.journalSeq ?? 0); replays.clear(); replayHead = null;
      post({ t: 'ready', ui: sim.uiState() });
      break;
    case 'cmd':
      if (!sim) break;
      if (msg.replay) { replays.push(msg.cmd, msg.seq); if (msg.seq !== undefined) seqs.hold(msg.seq); }   // handed to the sim one per tick (ReplayQueue)
      else { sim.command(msg.cmd); seqs.note(msg.seq); }
      break;
    case 'run': running = msg.running; break;
    case 'tick_budget': {
      if (!sim || !running) break;
      if (faulted && !recover()) { postSnapshot(); break; }
      const n = Math.max(0, Math.min(MAX_TICKS_PER_BUDGET, Math.floor(msg.ticks)));
      let ran = 0;
      for (let i = 0; i < n; i++) {
        replayHead = replays.next();
        if (replayHead) { sim.command(replayHead.cmd); seqs.note(replayHead.seq); }
        try { sim.step(); }
        catch (e) { faulted = true; reportError(e, 'step'); break; }
        seqs.stepped();
        ran++;
        postCmdError();
        if (++ticksSinceUi >= UI_EVERY) { ticksSinceUi = 0; postUi(); }
        if (++ticksSinceSave >= SAVE_EVERY) { ticksSinceSave = 0; postSave(); }
      }
      if (ran > 0 && !faulted) recoveries = 0;
      if (n > 0) { postEvents(); postSnapshot(); }
      break;
    }
    case 'want_snapshot': postSnapshot(); break;
    case 'want_save': postSave(); break;
    case 'inspector': {
      // Always answer: SimClient pairs inspector replies with requests in order, so a missing reply
      // would hand every later chain to the wrong caller.
      let r: { chain: SimEvent[]; sentence: string } = { chain: [], sentence: '' };
      try {
        const id = sim ? sim.findDeathEvent(msg.enemyIndex, msg.gen) : -1;
        if (sim && id >= 0) r = sim.inspect(id);
      } catch (e) { reportError(e, 'inspector'); }
      post({ t: 'inspector', chain: r.chain, sentence: r.sentence });
      break;
    }
    case 'set_clarity': if (sim && Number.isFinite(msg.value)) sim.world.meta.settings.clarity = msg.value; break;
    case 'return_buffer':
      if (freeInstances.length < 4) freeInstances.push(msg.instances);
      if (freeFx.length < 4) freeFx.push(msg.fx);
      break;
  }
}

ctx.onmessage = (ev: MessageEvent<ToWorker>): void => {
  try { handle(ev.data); }
  catch (e) { post({ t: 'error', message: e instanceof Error ? e.message : String(e), ...(e instanceof Error && e.stack ? { stack: e.stack } : {}) }); }
};
