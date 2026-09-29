/**
 * Save / load. Live combat is never saved: a run resumes at the start of its checkpoint
 * (wave = checkpoint + 1, phase 'between'). Per-wave tables are stored as 0/1 arrays.
 */
import type { SaveState, RunSave, RunState, BuildState, MetaState } from '../core/types';
import { SAVE_VERSION } from '../core/types';
import { newMeta, newRun, WAVE_TABLE_SIZE } from '../run/state';

/** Minimal surface of the Sim the serializer needs (avoids an import cycle). */
export interface Serializable { world: { run: RunState; build: BuildState; meta: MetaState; prng: { state(): [number, number, number, number] } } }

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
function trimmed(a: Uint8Array): number[] {
  let n = a.length;
  while (n > 0 && a[n - 1] === 0) n--;
  return Array.from(a.subarray(0, n));
}
function table(src: readonly number[] | undefined, min: number): Uint8Array {
  const t = new Uint8Array(Math.max(min, (src?.length ?? 0) + 1));
  if (src) for (let i = 0; i < src.length; i++) t[i] = src[i] ? 1 : 0;
  return t;
}

/** WP8: optional progression fields shared by RunState and RunSave (copied when present). */
const RUN_EXTRAS = ['plannedHardpoints', 'plannedAttunements', 'plannedDoctrines', 'minThreatDial', 'discountTree', 'checkpointSeconds'] as const;
function runExtras(src: RunState | RunSave): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RUN_EXTRAS) { const v = src[k]; if (v !== undefined && v !== null) out[k] = clone(v); }
  return out;
}

export function toRunSave(run: RunState, build: BuildState, prngState: [number, number, number, number]): RunSave {
  return Object.assign({
    prestigeSeed: run.prestigeSeed, wave: run.wave, checkpoint: run.checkpoint, deepestCleared: run.deepestCleared,
    firstClears: trimmed(run.firstClears), mode: run.mode, scrap: run.scrap, cores: run.cores,
    coresDroppedByBoss: trimmed(run.coresDroppedByBoss), threatDial: run.threatDial, attempts: run.attempts,
    attemptsPerCheckpoint: [...run.attemptsPerCheckpoint], prestigeStartedAt: run.prestigeStartedAt, playSeconds: run.playSeconds,
    echoRateHistory: clone(run.echoRateHistory), anomaliesOfferedAt: trimmed(run.anomaliesOfferedAt),
    hardpointSlotsOpen: run.hardpointSlotsOpen, attunementSlotsOpen: run.attunementSlotsOpen,
    patrolScrapPerSecond: run.patrolScrapPerSecond, longestChain: run.longestChain,
    build: clone(build), prngState: [...prngState] as [number, number, number, number], spentByTree: { ...run.spentByTree },
  } as RunSave, runExtras(run));   // WP8: progression extras
}

export function toSave(sim: Serializable): SaveState {
  const w = sim.world;
  return { version: SAVE_VERSION, savedAtMs: 0, meta: clone(w.meta), run: toRunSave(w.run, w.build, w.prng.state()), trial: null };
}

export function fromRunSave(s: RunSave): { run: RunState; build: BuildState; prngState: [number, number, number, number] } {
  const run = newRun(s.prestigeSeed);
  run.checkpoint = s.checkpoint; run.wave = s.checkpoint + 1; run.deepestCleared = s.deepestCleared;
  run.firstClears = table(s.firstClears, WAVE_TABLE_SIZE);
  run.clearedWaves = s.firstClears.reduce((a, v) => a + (v ? 1 : 0), 0);
  run.mode = s.mode; run.scrap = s.scrap; run.cores = s.cores;
  run.coresDroppedByBoss = table(s.coresDroppedByBoss, WAVE_TABLE_SIZE);
  run.threatDial = s.threatDial; run.attempts = s.attempts; run.attemptsPerCheckpoint = [...s.attemptsPerCheckpoint];
  run.prestigeStartedAt = s.prestigeStartedAt; run.playSeconds = s.playSeconds; run.echoRateHistory = clone(s.echoRateHistory);
  run.anomaliesOfferedAt = table(s.anomaliesOfferedAt, 32);
  run.hardpointSlotsOpen = s.hardpointSlotsOpen; run.attunementSlotsOpen = s.attunementSlotsOpen;
  run.patrolScrapPerSecond = s.patrolScrapPerSecond; run.longestChain = s.longestChain;
  run.spentByTree = { ...(s.spentByTree ?? {}) };
  Object.assign(run, runExtras(s));   // WP8: progression extras
  return { run, build: clone(s.build), prngState: [...s.prngState] as [number, number, number, number] };
}

export function fromSave(save: SaveState): { meta: MetaState; run: RunState; build: BuildState; prngState: [number, number, number, number] } {
  const m = migrate(save);
  const r = fromRunSave(m.run);
  return { meta: clone(m.meta), ...r };
}

/** Bring any older save up to SAVE_VERSION (v1: identity plus defaults for optional fields). */
export function migrate(save: SaveState): SaveState {
  const s = clone(save);
  if (!s.version || s.version < 1) s.version = 1;
  s.meta = { ...newMeta(), ...s.meta };
  s.run.spentByTree = s.run.spentByTree ?? {};
  s.trial = s.trial ?? null;
  return s;
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64: string): string {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Export string: base64 of the save JSON (prefixed so imports can be recognized). */
export function exportString(save: SaveState): string { return 'CITADEL1:' + toBase64(JSON.stringify(save)); }
export function importString(s: string): SaveState {
  const body = s.startsWith('CITADEL1:') ? s.slice(9) : s;
  return migrate(JSON.parse(fromBase64(body)) as SaveState);
}
