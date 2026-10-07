/** A-21: the import preview rows, and the N-13 import / offline decision. */
import { describe, it, expect } from 'vitest';
import { fmtSavedAt, savePreviewRows } from '../../src/ui/import-preview';
import { importString, exportString } from '../../src/sim/save/serialize';

describe('import preview', () => {
  it('shows Prestiges, deepest wave, Echoes and the saved date', () => {
    const rows = savePreviewRows({ savedAtMs: Date.UTC(2026, 0, 5, 14, 3), meta: { prestigeCount: 3, deepestEver: 62, echoes: 23544 } });
    expect(rows.map((r) => r.label)).toEqual(['Prestiges', 'Deepest wave', 'Echoes', 'Saved']);
    expect(rows[0].value).toBe('3');
    expect(rows[1].value).toBe('62');
    expect(rows[2].value).toBe('23,544');
    expect(rows[3].value).not.toBe('unknown');
  });
  it('a save without a time says unknown', () => {
    expect(fmtSavedAt(0)).toBe('unknown');
    expect(fmtSavedAt(NaN)).toBe('unknown');
  });
  it('the sim parser rejects a string that is not a save (so the preview can say so)', () => {
    expect(() => importString('CITADEL1:not base64 json!!')).toThrow();
    expect(() => importString('hello')).toThrow();
    void exportString;
  });
});
