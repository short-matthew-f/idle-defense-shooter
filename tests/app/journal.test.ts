/** N-09 command journal: app/journal.ts (storage, trim, replay selection) and worker/seq.ts (seq bookkeeping). */
import { describe, it, expect } from 'vitest';
import { JOURNAL_KEY, JOURNAL_MAX, appendJournal, clearJournal, nextSeq, readJournal, selectReplay, trimJournal, type KV } from '../../src/app/journal';
import { REPLAY_RETRY_EVERY, REPLAY_RETRY_TICKS, ReplayQueue, SeqTracker } from '../../src/worker/seq';
import { Sim } from '../../src/sim/index';

function mem(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}
const buy = (seq: number) => ({ seq, cmd: { type: 'buy' as const, node: 'x' } });
const throwing: KV = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };

describe('journal storage', () => {
  it('appends in order and reads back', () => {
    const s = mem();
    expect(appendJournal(buy(1), s)).toBe(true); appendJournal(buy(2), s);
    expect(readJournal(s).map((e) => e.seq)).toEqual([1, 2]);
  });
  it('trims entries covered by a save (seq <= journalSeq) and removes the key when empty', () => {
    const s = mem();
    for (let i = 1; i <= 4; i++) appendJournal(buy(i), s);
    trimJournal(2, s);
    expect(readJournal(s).map((e) => e.seq)).toEqual([3, 4]);
    trimJournal(undefined, s);
    expect(readJournal(s)).toHaveLength(2);
    trimJournal(9, s);
    expect(s.data.has(JOURNAL_KEY)).toBe(false);
  });
  it('caps at JOURNAL_MAX, dropping the oldest', () => {
    const s = mem();
    for (let i = 1; i <= JOURNAL_MAX + 25; i++) appendJournal(buy(i), s);
    const e = readJournal(s);
    expect(e).toHaveLength(JOURNAL_MAX);
    expect(e[0].seq).toBe(26);
    expect(e[e.length - 1].seq).toBe(JOURNAL_MAX + 25);
  });
  it('never throws when storage throws or holds junk', () => {
    expect(appendJournal(buy(1), throwing)).toBe(false);
    expect(readJournal(throwing)).toEqual([]);
    expect(() => { trimJournal(5, throwing); clearJournal(throwing); }).not.toThrow();
    expect(appendJournal(buy(1), null)).toBe(false);
    const s = mem();
    s.setItem(JOURNAL_KEY, '{not json'); expect(readJournal(s)).toEqual([]);
    s.setItem(JOURNAL_KEY, JSON.stringify([buy(3), { seq: 'x' }, null, { seq: 1, cmd: 5 }])); expect(readJournal(s).map((e) => e.seq)).toEqual([3]);
    expect(appendJournal(buy(4), s)).toBe(true);
    expect(readJournal(s).map((e) => e.seq)).toEqual([3, 4]);
  });
  it('clear removes everything', () => {
    const s = mem(); appendJournal(buy(1), s); clearJournal(s);
    expect(readJournal(s)).toEqual([]);
  });
});

describe('replay selection and next seq', () => {
  const entries = [buy(5), buy(3), buy(4), buy(6)];
  it('replays only entries newer than the save, in order', () => {
    expect(selectReplay(entries, 4).map((e) => e.seq)).toEqual([5, 6]);
    expect(selectReplay(entries, 6)).toEqual([]);
  });
  it('an old save (no journalSeq) discards the journal; no save at all replays it whole', () => {
    expect(selectReplay(entries, undefined)).toEqual([]);
    expect(selectReplay(entries, undefined, true).map((e) => e.seq)).toEqual([3, 4, 5, 6]);
  });
  it('the next seq is above both the save and the journal', () => {
    expect(nextSeq(undefined, [])).toBe(1);
    expect(nextSeq(10, entries)).toBe(11);
    expect(nextSeq(2, entries)).toBe(7);
  });
});

describe('worker seq bookkeeping', () => {
  it('applied only advances when a step drains the queue', () => {
    const t = new SeqTracker(7);
    expect(t.applied).toBe(7);
    t.note(8); t.note(9); t.note(undefined);
    expect(t.applied).toBe(7);   // paused / held: no step yet, so the save must not claim them
    t.stepped();
    expect(t.applied).toBe(9);
    t.note(10);
    t.stepped(); t.stepped();
    expect(t.applied).toBe(10);
  });
  it('replayed commands keep their seq and out-of-order notes never lower it', () => {
    const t = new SeqTracker(0);
    t.note(5); t.note(3); t.stepped();
    expect(t.applied).toBe(5);
    t.reset(2); expect(t.applied).toBe(2);
  });
  it('the journal never reaches the sim: a Sim ignores journalSeq in a save', () => {
    const a = new Sim(null, 1); const b = new Sim(null, 1);
    const save = b.save(); save.journalSeq = 42; const c = new Sim(save, 1);
    for (let i = 0; i < 120; i++) { a.step(); c.step(); }
    expect(JSON.stringify(c.save().run)).toBe(JSON.stringify(a.save().run));
  });
});

describe('replay queue (replayed commands wait for income the old save lacks)', () => {
  it('a held replay keeps journalSeq below it until it is settled', () => {
    const t = new SeqTracker(3);
    t.hold(4); t.note(4); t.note(6); t.stepped();
    expect(t.applied).toBe(3);
    t.release(4);
    expect(t.applied).toBe(6);
  });
  it('"Not enough Scrap" waits and retries every REPLAY_RETRY_EVERY ticks, then applies', () => {
    const q = new ReplayQueue<string>();
    q.push('a', 4); q.push('b', 5);
    expect(q.next()?.cmd).toBe('a');
    expect(q.settle('Not enough Scrap')).toBeNull();
    let ticks = 0;
    while (q.next() === null) ticks++;
    expect(ticks).toBeGreaterThan(0);
    expect(ticks + 1).toBeLessThanOrEqual(REPLAY_RETRY_EVERY);
    expect(q.settle(null)).toBe(4);
    expect(q.next()?.cmd).toBe('b');
  });
  it('any other rejection drops the command, and a wait ends after REPLAY_RETRY_TICKS', () => {
    const q = new ReplayQueue<string>();
    q.push('a', 1); q.push('b', 2);
    expect(q.next()?.cmd).toBe('a');
    expect(q.settle('That offer is gone')).toBe(1);
    expect(q.next()?.cmd).toBe('b');
    let dropped: number | null = null, n = 0;
    while (dropped === null && n++ < REPLAY_RETRY_TICKS * 2) { if (q.next()) dropped = q.settle('Not enough Cores'); }
    expect(dropped).toBe(2);
    expect(n).toBeLessThanOrEqual(REPLAY_RETRY_TICKS + 2);
    expect(q.length).toBe(0);
  });
});
