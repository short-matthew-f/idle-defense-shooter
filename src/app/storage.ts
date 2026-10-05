/**
 * Save storage: IndexedDB (db "citadel", store "saves", key "main"), falling back to
 * localStorage (export-string format) when IndexedDB is unavailable (private mode, blocked).
 * Saves are versioned by SAVE_VERSION; older saves are migrated by the sim (save/serialize.ts
 * migrate), newer ones are refused and parked so they are never overwritten.
 *
 * Backup (UX Phase 1, "never lose a purchase"): the main thread keeps the latest save it stored as an export
 * string and writes it SYNCHRONOUSLY to localStorage (BACKUP_KEY) on pagehide / hidden, where an async IndexedDB
 * write may never finish. A load takes the newer (savedAtMs) of the IndexedDB save and the backup.
 */
import type { SaveState } from '@sim/core/types';
import { SAVE_VERSION } from '@sim/core/types';
import { exportString, importString } from '@sim/save/serialize';
import { newerSave } from './autosave';

const DB_NAME = 'citadel';
const STORE = 'saves';
const KEY = 'main';
const LS_KEY = 'citadel.save.v1';
const BACKUP_KEY = 'citadel.save.backup';

let dbPromise: Promise<IDBDatabase> | null = null;
let idbBroken = false;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => { idbBroken = true; dbPromise = null; });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? req.error ?? new Error('IndexedDB transaction failed'));
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
  }));
}

export function idbGet<T>(key: string): Promise<T | undefined> { return tx('readonly', (s) => s.get(key) as IDBRequest<T | undefined>); }
export function idbPut(key: string, value: unknown): Promise<IDBValidKey> { return tx('readwrite', (s) => s.put(value, key)); }
export function idbDelete(key: string): Promise<undefined> { return tx('readwrite', (s) => s.delete(key) as IDBRequest<undefined>); }

function isSave(v: unknown): v is SaveState {
  return !!v && typeof v === 'object' && typeof (v as SaveState).version === 'number' && !!(v as SaveState).meta && !!(v as SaveState).run;
}

/** Load the stored save (IndexedDB, then localStorage). Null for a first launch. */
export async function loadSave(): Promise<SaveState | null> {
  let s: unknown = null;
  if (!idbBroken) {
    try { s = await idbGet<SaveState>(KEY); } catch (e) { console.warn('[save] IndexedDB read failed, using localStorage:', e); }
  }
  if (!s) {
    try { const str = localStorage.getItem(LS_KEY); if (str) s = importString(str); } catch (e) { console.warn('[save] localStorage read failed:', e); }
  }
  const backup = readBackup();
  s = newerSave(isSave(s) ? s : null, backup);
  if (!isSave(s)) return null;
  if (s.version > SAVE_VERSION) {
    console.warn(`[save] save version ${s.version} is newer than this build (${SAVE_VERSION}); parking it and starting fresh`);
    await parkSave(s, 'future');
    return null;
  }
  return s;
}

/** Store a save; returns where it went. */
export async function storeSave(save: SaveState): Promise<'idb' | 'local'> {
  if (!idbBroken) {
    try { await idbPut(KEY, save); return 'idb'; } catch (e) { console.warn('[save] IndexedDB write failed, using localStorage:', e); }
  }
  localStorage.setItem(LS_KEY, exportString(save));
  return 'local';
}

/** Keep a copy of a save that could not be used (never overwritten by autosave). */
export async function parkSave(save: SaveState, why: string): Promise<void> {
  const key = `${why}-${Date.now()}`;
  try { await idbPut(key, save); } catch { try { localStorage.setItem(`citadel.${key}`, exportString(save)); } catch { /* nothing left */ } }
}

export async function clearSave(): Promise<void> {
  try { await idbDelete(KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  clearBackup();
}

/** Write the backup snapshot now (synchronous; pagehide / hidden). `text` is an export string (exportToString). */
export function writeBackup(text: string): boolean {
  try { localStorage.setItem(BACKUP_KEY, text); return true; } catch (e) { console.warn('[save] backup write failed:', e); return false; }
}
export function clearBackup(): void { try { localStorage.removeItem(BACKUP_KEY); } catch { /* ignore */ } }
/** The backup snapshot, or null (absent, unreadable, or not a save). */
export function readBackup(): SaveState | null {
  try {
    const str = localStorage.getItem(BACKUP_KEY);
    if (!str) return null;
    const s: unknown = importString(str);
    return isSave(s) ? s : null;
  } catch (e) { console.warn('[save] backup read failed:', e); return null; }
}

/** Export string (versioned, base64 JSON with a CITADEL1: prefix). */
export function exportToString(save: SaveState): string { return exportString(save); }

/** Parse + migrate an export string; throws a readable error when it is not a save. */
export function importFromString(text: string): SaveState {
  let s: SaveState;
  try { s = importString(text.trim()); } catch { throw new Error('That is not a Citadel save string'); }
  if (!isSave(s)) throw new Error('The save string is incomplete');
  if (s.version > SAVE_VERSION) throw new Error(`The save is from a newer version (${s.version})`);
  return s;
}
