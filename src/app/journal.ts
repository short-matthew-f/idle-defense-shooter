/**
 * Command journal (N-09, "never lose a purchase"). A debounced save can miss the last ~2 s of purchases, and a save
 * requested while the worker is not ticking misses commands still in the sim's queue. So every command that
 * `savesAfter` is written SYNCHRONOUSLY to localStorage (`citadel.journal`) before it is posted to the worker, with a
 * monotonic `seq`. The worker stamps each save with `journalSeq` (the highest seq inside it); once a save is stored the
 * entries it covers are trimmed; on a cold start the entries newer than the loaded save are replayed in order.
 * Pure functions over a minimal storage interface; every access is try/catch'd (a failing localStorage never breaks play).
 */
import type { Command } from '@sim/core/types';

export const JOURNAL_KEY = 'citadel.journal';
export const JOURNAL_MAX = 200;

export interface JournalEntry { seq: number; cmd: Command }
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

function defaultStore(): KV | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }

function valid(e: unknown): e is JournalEntry {
  return !!e && typeof e === 'object' && typeof (e as JournalEntry).seq === 'number' && Number.isFinite((e as JournalEntry).seq)
    && !!(e as JournalEntry).cmd && typeof (e as JournalEntry).cmd === 'object' && typeof (e as JournalEntry).cmd.type === 'string';
}

/** The stored entries, oldest first (empty on absent, corrupt or unreadable storage). */
export function readJournal(store: KV | null = defaultStore()): JournalEntry[] {
  try {
    const raw = store?.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(valid).sort((a, b) => a.seq - b.seq) : [];
  } catch { return []; }
}

function write(entries: JournalEntry[], store: KV | null): boolean {
  try {
    if (!store) return false;
    if (entries.length === 0) store.removeItem(JOURNAL_KEY); else store.setItem(JOURNAL_KEY, JSON.stringify(entries));
    return true;
  } catch { return false; }
}

/** Append one entry (synchronously), keeping at most JOURNAL_MAX (the oldest drop). False when storage failed. */
export function appendJournal(entry: JournalEntry, store: KV | null = defaultStore(), max = JOURNAL_MAX): boolean {
  const all = readJournal(store);
  all.push(entry);
  return write(all.length > max ? all.slice(all.length - max) : all, store);
}

/** Drop entries a stored save covers (seq <= journalSeq). */
export function trimJournal(journalSeq: number | undefined, store: KV | null = defaultStore()): void {
  if (journalSeq === undefined || !Number.isFinite(journalSeq)) return;
  const all = readJournal(store);
  const kept = all.filter((e) => e.seq > journalSeq);
  if (kept.length !== all.length) write(kept, store);
}

export function clearJournal(store: KV | null = defaultStore()): void { try { store?.removeItem(JOURNAL_KEY); } catch { /* ignore */ } }

/**
 * The entries to replay on load. `saveSeq` is the loaded save's journalSeq; `fresh` is true when there is no save at all
 * (a first launch: the whole journal is the early play of this game). A save WITHOUT journalSeq (an old save) replays
 * nothing: its journal cannot be related to it.
 */
export function selectReplay(entries: readonly JournalEntry[], saveSeq: number | undefined, fresh = false): JournalEntry[] {
  const from = fresh ? 0 : saveSeq;
  if (from === undefined) return [];
  return entries.filter((e) => e.seq > from).sort((a, b) => a.seq - b.seq);
}

/** The next seq to hand out: above both the save's journalSeq and anything in the journal. */
export function nextSeq(saveSeq: number | undefined, entries: readonly JournalEntry[]): number {
  let m = saveSeq !== undefined && Number.isFinite(saveSeq) ? saveSeq : 0;
  for (const e of entries) if (e.seq > m) m = e.seq;
  return m + 1;
}
