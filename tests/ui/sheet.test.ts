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

describe('landscape phone layout', () => {
  it('uses the side panel on short landscape screens only', async () => {
    const { layoutMode, isCompactLandscape, panelWidth, COMPACT_PANEL_WIDTH, SIDE_PANEL_WIDTH } = await import('../../src/ui/sheet-logic');
    expect(layoutMode(844, 390)).toBe('side');
    expect(isCompactLandscape(844, 390)).toBe(true);
    expect(panelWidth(844, 390)).toBe(COMPACT_PANEL_WIDTH);
    expect(layoutMode(390, 844)).toBe('sheet');
    expect(layoutMode(740, 360)).toBe('side');
    expect(layoutMode(560, 320)).toBe('sheet');          // too narrow for a side panel
    expect(layoutMode(1280, 800)).toBe('side');
    expect(panelWidth(1280, 800)).toBe(SIDE_PANEL_WIDTH);
    expect(isCompactLandscape(1280, 800)).toBe(false);
  });
  it('moves the ability inset to the left in compact landscape', async () => {
    const { arenaInsets, snapHeights } = await import('../../src/ui/sheet-logic');
    const s = snapHeights(390, 120);
    expect(arenaInsets('side', 'peek', s, 120, 72, true, 300, 70)).toEqual({ top: 120, right: 300, bottom: 0, left: 70 });
    expect(arenaInsets('side', 'peek', s, 120, 72, false, 300, 0)).toEqual({ top: 120, right: 0, bottom: 72, left: 0 });
  });
});
