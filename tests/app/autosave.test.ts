/**
 * UX Phase 1 "never lose a purchase" and "updates never interrupt" (app/autosave.ts, app/storage.ts backup).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Debouncer, SAVE_DEBOUNCE_MS, newerSave, savesAfter, updateBlocker } from '../../src/app/autosave';
import { Sim } from '../../src/sim/index';
import { exportString, importString } from '../../src/sim/save/serialize';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('debounced save after purchases and choices', () => {
  it('purchases, choices, picks, doctrines, mounts and settings save; taps, aim, casts and speed do not', () => {
    for (const t of ['buy', 'buy_cheapest', 'choose_doctrine', 'mount_hardpoint', 'refit_hardpoint', 'attune', 'pick_anomaly', 'reroll_anomaly',
      'pick_boon', 'reroll_boon', 'decline_boon', 'set_setting', 'set_ability_slot', 'set_targeting', 'set_quartermaster', 'buy_prestige', 'prestige'] as const) {
      expect(savesAfter({ type: t }), t).toBe(true);
    }
    for (const t of ['manual_aim', 'designate', 'designate_at', 'cast', 'tap_assist', 'collect_salvage', 'overcharge', 'set_speed', 'release_hold', 'offline_return'] as const) {
      expect(savesAfter({ type: t }), t).toBe(false);
    }
  });

  it('saves once, ~2 s after the last of a burst; flush runs it now; cancel drops it', () => {
    vi.useFakeTimers();
    let saves = 0;
    const d = new Debouncer(() => saves++, SAVE_DEBOUNCE_MS);
    expect(SAVE_DEBOUNCE_MS).toBe(2000);
    d.poke(); vi.advanceTimersByTime(1500);
    d.poke(); vi.advanceTimersByTime(1500);
    expect(saves).toBe(0);
    expect(d.pending).toBe(true);
    vi.advanceTimersByTime(600);
    expect(saves).toBe(1);
    expect(d.pending).toBe(false);
    d.poke(); d.flush();
    expect(saves).toBe(2);
    d.poke(); d.cancel(); vi.advanceTimersByTime(5000);
    expect(saves).toBe(2);
  });

  it('load prefers the newer of IndexedDB and the backup', () => {
    const a = { savedAtMs: 100, id: 'idb' }, b = { savedAtMs: 200, id: 'backup' };
    expect(newerSave(a, b)?.id).toBe('backup');
    expect(newerSave(b, a)?.id).toBe('backup');
    expect(newerSave({ savedAtMs: 5, id: 'x' }, { savedAtMs: 5, id: 'y' })?.id).toBe('x');   // ties keep the primary
    expect(newerSave(null, b)?.id).toBe('backup');
    expect(newerSave(a, null)?.id).toBe('idb');
  });

  it('the backup snapshot round-trips through localStorage and wins when newer (storage.ts)', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
    });
    const { writeBackup, readBackup, loadSave, clearBackup } = await import('../../src/app/storage');
    const sim = new Sim(null, 5);
    sim.world.run.scrap = 12345;
    const save = sim.save(); save.savedAtMs = 2000;
    expect(writeBackup(exportString(save))).toBe(true);
    expect(readBackup()?.run.scrap).toBe(12345);
    // no IndexedDB in node: the older localStorage fallback save loses to the newer backup
    const older = sim.save(); older.savedAtMs = 1000; older.run.scrap = 1;
    store.set('citadel.save.v1', exportString(older));
    expect((await loadSave())?.run.scrap).toBe(12345);
    clearBackup();
    expect((await loadSave())?.run.scrap).toBe(1);
    expect(importString(exportString(save)).run.scrap).toBe(12345);
  });
});

describe('updates never interrupt', () => {
  const quiet = { phase: 'between', isBoss: false, wave: 6, checkpoint: 5 };
  it('a quiet between at checkpoint + 1 with nothing open may reload', () => {
    expect(updateBlocker(quiet)).toBeNull();
  });
  it('dialogs, More sub-screens, text inputs, pending decisions, any wave in progress and progress since the checkpoint block it', () => {
    expect(updateBlocker({ ...quiet, dialog: true })).toBe('dialog');
    expect(updateBlocker({ ...quiet, sub: true })).toBe('sub-screen');
    expect(updateBlocker({ ...quiet, input: true })).toBe('text input');
    expect(updateBlocker({ ...quiet, decision: true })).toBe('decision pending');
    expect(updateBlocker({ ...quiet, phase: 'combat', isBoss: true })).toBe('boss wave');
    expect(updateBlocker({ ...quiet, phase: 'combat' })).toBe('wave');
    expect(updateBlocker({ ...quiet, wave: 8 })).toBe('progress since checkpoint');
  });
});
