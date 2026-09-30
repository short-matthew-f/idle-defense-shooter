import { describe, expect, it } from 'vitest';
import { labelBox, ringBox, RING_MIN, RING_PAD } from '../../src/ui/pointer';

describe('pointer ring geometry', () => {
  const safe = { top: 47, right: 0, bottom: 34, left: 0 };
  it('grows the target by the pad and centres on it (the ring never covers the control)', () => {
    const r = ringBox({ left: 100, top: 400, width: 200, height: 60 }, 390, 844, safe)!;
    expect(r).toMatchObject({ left: 100 - RING_PAD, top: 400 - RING_PAD, width: 200 + 2 * RING_PAD, height: 60 + 2 * RING_PAD });
  });
  it('is at least 44 px square around a small control', () => {
    const r = ringBox({ left: 190, top: 300, width: 10, height: 12 }, 390, 844, safe)!;
    expect(r.width).toBe(RING_MIN);
    expect(r.height).toBe(RING_MIN);
    expect(r.left + r.width / 2).toBeCloseTo(195, 5);
    expect(r.top + r.height / 2).toBeCloseTo(306, 5);
  });
  it('stays inside the safe area (a tab-bar button over the home indicator, a chip under the notch)', () => {
    const low = ringBox({ left: 0, top: 760, width: 78, height: 50 }, 390, 844, safe)!;
    expect(low.left).toBeGreaterThanOrEqual(0);
    expect(low.top + low.height).toBeLessThanOrEqual(844 - 34);
    expect(low.height).toBeGreaterThanOrEqual(RING_MIN);
    const high = ringBox({ left: 370, top: 40, width: 30, height: 20 }, 390, 844, safe)!;
    expect(high.top).toBeGreaterThanOrEqual(47);
    expect(high.left + high.width).toBeLessThanOrEqual(390);
    expect(high.height).toBeGreaterThanOrEqual(RING_MIN);
    expect(high.width).toBeGreaterThanOrEqual(RING_MIN);
  });
  it('nothing for a target with no size or wholly off screen', () => {
    expect(ringBox({ left: 10, top: 10, width: 0, height: 20 }, 390, 844, safe)).toBeNull();
    expect(ringBox({ left: 10, top: 900, width: 40, height: 20 }, 390, 844, safe)).toBeNull();
    expect(ringBox({ left: -80, top: 10, width: 40, height: 20 }, 390, 844, safe)).toBeNull();
  });
  it('corner radius follows the control, capped at a pill', () => {
    expect(ringBox({ left: 100, top: 100, width: 40, height: 40 }, 390, 844, safe, { radius: 999 })!.radius).toBe(26);
    expect(ringBox({ left: 100, top: 100, width: 200, height: 60 }, 390, 844, safe, { radius: 16 })!.radius).toBe(16 + RING_PAD);
  });
  it('the label sits above the ring, below it near the top, inside when neither fits, and inside the safe area', () => {
    const ring = ringBox({ left: 20, top: 700, width: 350, height: 60 }, 390, 844, safe)!;
    expect(labelBox(ring, 120, 26, 390, 844, safe)).toMatchObject({ side: 'above', top: ring.top - 6 - 26 });
    const top = ringBox({ left: 20, top: 50, width: 100, height: 40 }, 390, 844, safe)!;
    expect(labelBox(top, 120, 26, 390, 844, safe).side).toBe('below');
    const tall = ringBox({ left: 0, top: 50, width: 390, height: 760 }, 390, 844, safe)!;
    expect(labelBox(tall, 120, 26, 390, 844, safe).side).toBe('inside');
    const edge = labelBox(ringBox({ left: 360, top: 400, width: 30, height: 30 }, 390, 844, safe)!, 150, 26, 390, 844, safe);
    expect(edge.left + 150).toBeLessThanOrEqual(390 - 4);
  });
});
