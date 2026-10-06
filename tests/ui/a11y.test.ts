import { describe, expect, it } from 'vitest';
import { arenaLabel, motionClassOn, rootFontSize, textScaleOf } from '../../src/ui/a11y';
import { announceDecision, POLITE_GAP_MS, REPEAT_MS } from '../../src/ui/announce';
import { srLines, type SrSnap } from '../../src/ui/sr-watch';
import { trapIndex } from '../../src/ui/modal';

describe('text scale', () => {
  it('sanitises stored values', () => {
    expect(textScaleOf(115)).toBe(115);
    expect(textScaleOf(130)).toBe(130);
    expect(textScaleOf(150)).toBe(100);
    expect(textScaleOf('130')).toBe(100);
    expect(textScaleOf(undefined)).toBe(100);
  });
  it('maps to the root font size', () => {
    expect(rootFontSize(100)).toBe('');
    expect(rootFontSize(115)).toBe('115%');
    expect(rootFontSize(130)).toBe('130%');
  });
});

describe('reduce-motion class', () => {
  it('follows the setting, System follows the OS', () => {
    expect(motionClassOn('reduce', false)).toBe(true);
    expect(motionClassOn('full', true)).toBe(false);
    expect(motionClassOn('system', true)).toBe(true);
    expect(motionClassOn('system', false)).toBe(false);
  });
});

describe('announce throttle', () => {
  const fresh = () => ({ lastText: '', lastAt: -Infinity, lastPoliteAt: -Infinity });
  it('speaks a first line at once and drops blanks', () => {
    expect(announceDecision(fresh(), 'Boss: Breaker', false, 0)).toBe('now');
    expect(announceDecision(fresh(), '  ', true, 0)).toBe('drop');
  });
  it('drops a repeat inside the window, allows it after', () => {
    const s = { lastText: 'Tell', lastAt: 1000, lastPoliteAt: -Infinity };
    expect(announceDecision(s, 'Tell', true, 1000 + REPEAT_MS - 1)).toBe('drop');
    expect(announceDecision(s, 'Tell', true, 1000 + REPEAT_MS)).toBe('now');
  });
  it('spaces polite lines, never urgent ones', () => {
    const s = { lastText: 'a', lastAt: 1000, lastPoliteAt: 1000 };
    expect(announceDecision(s, 'b', false, 1000 + POLITE_GAP_MS - 1)).toBe('later');
    expect(announceDecision(s, 'b', false, 1000 + POLITE_GAP_MS)).toBe('now');
    expect(announceDecision(s, 'b', true, 1001)).toBe('now');
  });
});

describe('screen-reader lines', () => {
  const base: SrSnap = { bossLive: false, bossName: '', tell: null, prestigeRec: false };
  it('says nothing on the first state (load)', () => {
    expect(srLines(null, { ...base, bossLive: true, bossName: 'Breaker', tell: 'x', prestigeRec: true })).toEqual([]);
  });
  it('announces boss start, a new tell (urgent) and Prestige recommended once', () => {
    const boss = { ...base, bossLive: true, bossName: 'Breaker' };
    expect(srLines(base, boss)).toEqual([{ text: 'Boss: Breaker', urgent: false }]);
    const tell = { ...boss, tell: 'Repulsor Pulse: cast Shield' };
    expect(srLines(boss, tell)).toEqual([{ text: 'Repulsor Pulse: cast Shield', urgent: true }]);
    expect(srLines(tell, tell)).toEqual([]);
    expect(srLines(base, { ...base, prestigeRec: true })).toEqual([{ text: 'Prestige recommended', urgent: false }]);
    expect(srLines({ ...base, prestigeRec: true }, { ...base, prestigeRec: true })).toEqual([]);
  });
});

describe('arena label', () => {
  const ui = (o: { wave?: number; isBoss?: boolean; bossHp?: number; hp?: number }) => ({
    run: { wave: o.wave ?? 7 }, tower: { hp: o.hp ?? 50, maxHp: 100 },
    wave: { isBoss: o.isBoss ?? false, bossHp: o.bossHp ?? 0, bossMaxHp: o.isBoss ? 1000 : 0 },
  }) as unknown as Parameters<typeof arenaLabel>[0];
  it('names the wave, HP and boss state', () => {
    expect(arenaLabel(ui({}))).toBe('Battlefield: wave 7, tower health 50%');
    expect(arenaLabel(ui({ wave: 10, isBoss: true, bossHp: 640 }))).toBe('Battlefield: wave 10, boss fight, boss at 64%, tower health 50%');
  });
});

describe('dialog focus trap', () => {
  it('wraps Tab and Shift+Tab', () => {
    expect(trapIndex(-1, 3, false)).toBe(0);
    expect(trapIndex(-1, 3, true)).toBe(2);
    expect(trapIndex(2, 3, false)).toBe(0);
    expect(trapIndex(0, 3, true)).toBe(2);
    expect(trapIndex(0, 0, false)).toBe(-1);
  });
});
