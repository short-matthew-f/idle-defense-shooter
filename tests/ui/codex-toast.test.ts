/** C-12: Codex discovery toasts are named and wait for the Codex to be revealed. */
import { describe, it, expect } from 'vitest';
import { codexToastText } from '../../src/ui/feed';
import { codexEntryName, codexGroups } from '../../src/ui/codex';
import { features } from '../../src/ui/progression';

describe('codex toasts', () => {
  it('names the entry', () => {
    expect(codexToastText('chain.3', true)).toBe('Codex: 3-link chain');
    expect(codexToastText('counter.boss.broodheart', true)).toMatch(/^Codex: Countered /);
    expect(codexToastText('boon.nope_x', true)).toBe('Codex: Nope X');
  });
  it('every known entry has a non-generic name', () => {
    for (const g of codexGroups()) for (const e of g.entries) expect(codexEntryName(e.id)).toBe(e.name);
  });
  it('is silent until the Codex is revealed', () => {
    expect(codexToastText('chain.3', false)).toBeNull();
    const base = { run: { deepestCleared: 0 }, meta: { deepestEver: 0, prestigeCount: 0 } };
    expect(features(base).codex).toBe(false);
    expect(features({ run: { deepestCleared: 20 }, meta: { deepestEver: 20, prestigeCount: 0 } }).codex).toBe(true);
  });
});

describe('codex wording (B-17)', () => {
  it('plainDesc drops markers and code names, keeps numbers', async () => {
    const { plainDesc } = await import('../../src/ui/format');
    expect(plainDesc('NEW. Explosions repeat once 0.5 s later at 40% damage.')).toBe('Explosions repeat once 0.5 s later at 40% damage.');
    expect(plainDesc('fires again as a 80-unit blast')).toBe('fires again as an 80-unit blast');
    expect(plainDesc('a 60-unit blast, a 12 s timer')).toBe('a 60-unit blast, a 12 s timer');
    expect(plainDesc('Slam (Repulsor Pulse). See TELL_COUNTERS.')).toBe('Slam (Repulsor Pulse).');
  });
  it('no entry shows code names or the NEW marker', () => {
    for (const g of codexGroups()) for (const e of g.entries) {
      expect(e.desc, e.id).not.toMatch(/TELL_COUNTERS|graftSources|^NEW\./);
      expect(e.desc, e.id).not.toMatch(/\ba 8\d?-/);
    }
  });
  it('infusion entries carry their full text with numbers', () => {
    const inf = codexGroups().find((g) => g.name === 'Infusions')!;
    for (const e of inf.entries) expect(e.desc.length, e.id).toBeGreaterThan(40);
  });
});
