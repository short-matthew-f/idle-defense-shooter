/**
 * Save / load. Live combat is never saved: a run resumes at the start of its checkpoint
 * (wave = checkpoint + 1, phase 'between'). Per-wave tables are stored as 0/1 arrays.
 *
 * Versioning: `migrate` upgrades a save one version at a time through MIGRATIONS (append a step for
 * every SAVE_VERSION bump; tests/core/save.test.ts shows the pattern with a synthetic v2), then fills
 * defaults and sanitizes fields a corrupted or hand-edited save could break the sim with (unknown
 * Trial / frame / anomalies, non-finite numbers, a degenerate PRNG state). Valid saves pass unchanged.
 */
import type { SaveState, RunSave, RunState, BuildState, MetaState } from '../core/types';
import type { AnomalyId } from '../core/ids';
import { SAVE_VERSION } from '../core/types';
import { newBuild, newMeta, newRun, WAVE_TABLE_SIZE } from '../run/state';
import { anomalyDef } from '../core/content';
import { FRAMES, TRIALS } from '../data/index';
import { Prng } from '../math/prng';

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
const RUN_EXTRAS = ['plannedHardpoints', 'plannedAttunements', 'plannedDoctrines', 'minThreatDial', 'discountTree', 'checkpointSeconds', 'patrolMeasured'] as const;
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
  } as RunSave, runExtras(run),   // WP8: progression extras
  run.pendingDraft && run.pendingDraft.length ? { pendingDraft: [...run.pendingDraft], draftWave: run.draftWave } : {},
  run.draftQueue.length ? { draftQueue: [...run.draftQueue] } : {});
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
  if (Array.isArray(s.pendingDraft) && s.pendingDraft.length) { run.pendingDraft = [...s.pendingDraft]; run.draftWave = typeof s.draftWave === 'number' ? s.draftWave : run.checkpoint; }
  if (Array.isArray(s.draftQueue)) run.draftQueue = s.draftQueue.filter((v): v is number => typeof v === 'number' && v > 0 && v % 10 === 0);
  return { run, build: clone(s.build), prngState: [...s.prngState] as [number, number, number, number] };
}

export function fromSave(save: SaveState): { meta: MetaState; run: RunState; build: BuildState; prngState: [number, number, number, number] } {
  const m = migrate(save);
  const r = fromRunSave(m.run);
  return { meta: clone(m.meta), ...r };
}

/** One migration step: upgrades a save of version `v` (the table key) to `v + 1`. */
export type Migration = (save: SaveState) => SaveState;
/**
 * MIGRATIONS[v] upgrades a v-save to v+1. Empty while SAVE_VERSION is 1. When bumping SAVE_VERSION to
 * N, add `MIGRATIONS[N - 1]` (pure: take the old shape, return the new one) and a test next to the
 * synthetic-v2 test in tests/core/save.test.ts.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/**
 * Bring any older save up to `target` (default SAVE_VERSION), then fill defaults and sanitize.
 * Throws a readable Error for input that is not a save at all, or when a migration step is missing.
 */
export function migrate(save: SaveState, target: number = SAVE_VERSION, table: Readonly<Record<number, Migration>> = MIGRATIONS): SaveState {
  if (!isObj(save) || !isObj(save.run) || !isObj(save.meta)) throw new Error('Not a Citadel save (missing run or meta)');
  let s: SaveState = clone(save as SaveState);
  if (typeof s.version !== 'number' || !(s.version >= 1)) s.version = 1;
  s.version = Math.floor(s.version);
  while (s.version < target) {
    const step = table[s.version];
    if (!step) throw new Error(`No save migration from version ${s.version} to ${s.version + 1}`);
    const from = s.version;
    s = step(s);
    s.version = from + 1;
  }
  s.meta = { ...newMeta(), ...s.meta };
  s.run.spentByTree = s.run.spentByTree ?? {};
  s.trial = s.trial ?? null;
  sanitize(s);
  return s;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finiteOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const TRIAL_IDS = new Set<string>(TRIALS.map((t) => t.id));
const FRAME_IDS = new Set<string>(FRAMES.map((f) => f.id));

/** Repair fields that would make the sim throw or go NaN; valid values are left untouched. */
function sanitize(s: SaveState): void {
  const m = s.meta;
  if (m.activeTrial != null && !TRIAL_IDS.has(m.activeTrial)) { m.activeTrial = null; delete m.parkedRun; }
  if (!isObj(m.prestigeRanks)) m.prestigeRanks = {};
  if (!isObj(m.constellation)) m.constellation = {};
  if (!Array.isArray(m.directives)) m.directives = [];
  if (!Array.isArray(m.upgradeQueue)) m.upgradeQueue = [];
  if (!Array.isArray(m.blueprints)) m.blueprints = [];
  m.echoes = Math.max(0, finiteOr(m.echoes, 0)); m.stars = Math.max(0, finiteOr(m.stars, 0));
  sanitizeRun(s.run);
  if (m.parkedRun) { if (isObj(m.parkedRun) && isObj(m.parkedRun.build)) sanitizeRun(m.parkedRun); else delete m.parkedRun; }
}

function sanitizeRun(r: RunSave): void {
  r.prestigeSeed = finiteOr(r.prestigeSeed, 1) >>> 0;
  r.checkpoint = Math.max(0, Math.floor(finiteOr(r.checkpoint, 0) / 5) * 5);
  r.deepestCleared = Math.max(0, Math.floor(finiteOr(r.deepestCleared, 0)));
  r.scrap = Math.max(0, finiteOr(r.scrap, 0)); r.cores = Math.max(0, Math.floor(finiteOr(r.cores, 0)));
  r.threatDial = Math.max(0, Math.floor(finiteOr(r.threatDial, 0)));
  r.playSeconds = Math.max(0, finiteOr(r.playSeconds, 0));
  if (r.mode !== 'push' && r.mode !== 'patrol') r.mode = 'push';
  for (const k of ['firstClears', 'coresDroppedByBoss', 'anomaliesOfferedAt', 'attemptsPerCheckpoint'] as const) if (!Array.isArray(r[k])) r[k] = [];
  if (!Array.isArray(r.echoRateHistory)) r.echoRateHistory = [];
  const p = r.prngState;
  if (!Array.isArray(p) || p.length !== 4 || !p.every((v) => typeof v === 'number' && Number.isFinite(v)) || p.every((v) => (v >>> 0) === 0)) {
    r.prngState = new Prng(r.prestigeSeed ^ 0x5eed).state();   // an all-zero xoshiro state never leaves zero
  }
  if (!isObj(r.build)) r.build = newBuild('standard');
  const b = r.build, fresh = newBuild(b.frame);
  if (!FRAME_IDS.has(b.frame)) b.frame = 'standard';
  if (!isObj(b.ranks)) b.ranks = {};
  for (const id of Object.keys(b.ranks)) {
    const v = b.ranks[id];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) delete b.ranks[id];
    else if (!Number.isInteger(v)) b.ranks[id] = Math.floor(v);
  }
  for (const k of ['hardpoints', 'attunements', 'abilities'] as const) if (!Array.isArray(b[k])) (b as unknown as Record<string, unknown>)[k] = fresh[k];
  if (!Array.isArray(b.anomalies)) b.anomalies = [];
  b.anomalies = b.anomalies.filter((a) => typeof a === 'string' && !!anomalyDef(a));
  if (Array.isArray(r.pendingDraft)) r.pendingDraft = r.pendingDraft.filter((a): a is AnomalyId => typeof a === 'string' && !!anomalyDef(a));
  for (const k of ['doctrines', 'secondDoctrines', 'targeting'] as const) if (!isObj(b[k])) b[k] = {};
  b.anomalySockets = Math.max(0, Math.floor(finiteOr(b.anomalySockets, 3)));
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
