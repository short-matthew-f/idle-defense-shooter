import { describe, expect, it } from 'vitest';
import { snapHeights, snapTarget, nextSnap, clampHeight, layoutMode, arenaInsets, SIDE_PANEL_WIDTH } from '../../src/ui/sheet-logic';

describe('sheet snap logic', () => {
  const s = snapHeights(844, 150);
  it('computes ordered heights', () => {
    expect(s.peek).toBeLessThan(s.half);
    expect(s.half).toBeLessThan(s.full);
    expect(s.full).toBe(844 - 150 - 8);
    expect(s.half).toBe(422);
  });
  it('snaps to the nearest height when slow', () => {
    expect(snapTarget(s.peek + 10, 0, s)).toBe('peek');
    expect(snapTarget(s.half - 30, 0.1, s)).toBe('half');
    expect(snapTarget(s.full - 5, -0.1, s)).toBe('full');
  });
  it('flicks one step in the drag direction', () => {
    expect(snapTarget(s.peek + 20, 0.8, s)).toBe('half');
    expect(snapTarget(s.half + 20, 0.8, s)).toBe('full');
    expect(snapTarget(s.half - 20, -0.8, s)).toBe('peek');
    expect(snapTarget(s.full, 1, s)).toBe('full');
    expect(snapTarget(s.peek, -1, s)).toBe('peek');
  });
  it('clamps and cycles', () => {
    expect(clampHeight(10, s)).toBe(s.peek);
    expect(clampHeight(5000, s)).toBe(s.full);
    expect(nextSnap('peek')).toBe('half');
    expect(nextSnap('half')).toBe('full');
    expect(nextSnap('full')).toBe('peek');
  });
  it('picks layout and insets', () => {
    expect(layoutMode(390)).toBe('sheet');
    expect(layoutMode(1280)).toBe('side');
    expect(arenaInsets('side', 'peek', s, 100, 70).right).toBe(SIDE_PANEL_WIDTH);
    expect(arenaInsets('sheet', 'full', s, 100, 70).bottom).toBe(s.half);
    expect(arenaInsets('sheet', 'half', s, 100, 70).bottom).toBe(s.half);
    expect(arenaInsets('sheet', 'peek', s, 100, 70).bottom).toBe(s.peek + 70);
  });
  it('stays ordered on tiny screens', () => {
    const t = snapHeights(300, 200);
    expect(t.peek).toBeLessThan(t.half);
    expect(t.half).toBeLessThan(t.full);
  });
});
