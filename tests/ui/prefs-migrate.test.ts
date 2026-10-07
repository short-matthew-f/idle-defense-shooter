/** B-13: the old prefs.unlockAll migrates to both new switches. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function store(initial: Record<string, unknown> | null): void {
  const data = new Map<string, string>();
  if (initial) data.set('citadel.prefs.v1', JSON.stringify(initial));
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) });
}
async function load() {
  vi.resetModules();
  return import('../../src/ui/prefs');
}

describe('unlockAll migration', () => {
  beforeEach(() => vi.unstubAllGlobals());
  it('an existing true sets both switches', async () => {
    store({ unlockAll: true });
    const { prefs } = await load();
    expect(prefs().showAllScreens).toBe(true);
    expect(prefs().offerAllContent).toBe(true);
  });
  it('a stored choice wins over the legacy value', async () => {
    store({ unlockAll: true, showAllScreens: false, offerAllContent: true });
    const { prefs } = await load();
    expect(prefs().showAllScreens).toBe(false);
    expect(prefs().offerAllContent).toBe(true);
  });
  it('nothing stored: both off; turning one off afterwards sticks', async () => {
    store(null);
    const { prefs, setPref } = await load();
    expect(prefs().showAllScreens || prefs().offerAllContent).toBe(false);
    store({ unlockAll: true });
    const m = await load();
    m.setPref('showAllScreens', false);   // persists the whole object, so the migration no longer applies
    const again = await load();
    expect(again.prefs().showAllScreens).toBe(false);
    expect(again.prefs().offerAllContent).toBe(true);
    void setPref;
  });
});
