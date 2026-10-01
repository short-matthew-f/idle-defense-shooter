import { describe, expect, it } from 'vitest';
import { fitCount, LANE_GAP, MIN_OFFER, planLanes, type LaneItem } from '../../src/ui/lanes';

const G = LANE_GAP;

describe('overlay lanes: fitCount', () => {
  it('stacks in order with a gap between, never past the room', () => {
    expect(fitCount([37, 56, 37], 37, G)).toBe(1);
    expect(fitCount([37, 56, 37], 37 + G + 56, G)).toBe(2);
    expect(fitCount([37, 56, 37], 37 + G + 55, G)).toBe(1);
    expect(fitCount([], 500, G)).toBe(0);
    expect(fitCount([60], 0, G)).toBe(0);
  });
});

describe('overlay lanes: planLanes', () => {
  const slots = (b: number, t: number) => [{ id: 'B', room: b }, { id: 'T', room: t }];
  const coach = (h = 62, compactH = 46): LaneItem => ({ id: 'coach', kind: 'card', opts: [{ slot: 'B', h }, { slot: 'T', h }, { slot: 'B', h: compactH, compact: true }, { slot: 'T', h: compactH, compact: true }] });
  const toasts = (hs: number[]): LaneItem => ({ id: 'toasts', kind: 'stack', slots: ['B', 'T'], hs: { B: hs, T: hs } });
  const offer = (h: number): LaneItem => ({ id: 'offer', kind: 'card', opts: [{ slot: 'B', h }], floor: MIN_OFFER });

  it('everything fits under the tower: offer, then the banner, then the toasts, all in B', () => {
    const p = planLanes(slots(400, 150), [offer(172), coach(), toasts([37, 37])]);
    expect(p.offer).toMatchObject({ slot: 'B', h: 172 });
    expect(p.coach).toMatchObject({ slot: 'B', compact: false });
    expect(p.toasts).toMatchObject({ slot: 'B', count: 2 });
  });

  it('the banner moves above the tower when the offer fills the band under it', () => {
    const p = planLanes(slots(172 + G + 30, 150), [offer(172), coach(), toasts([37])]);
    expect(p.coach).toMatchObject({ slot: 'T', compact: false });
    // T has 150 - 62 - 8 = 80 left: the toast goes there
    expect(p.toasts).toMatchObject({ slot: 'T', count: 1 });
  });

  it('a banner with no room for its sentence anywhere shrinks to one line, else waits', () => {
    const p = planLanes(slots(50, 40), [coach(62, 46)]);
    expect(p.coach).toMatchObject({ slot: 'B', compact: true, h: 46 });
    expect(planLanes(slots(30, 40), [coach(62, 46)]).coach).toBeNull();
  });

  it('the offer is always placed (scrolling), never below MIN_OFFER', () => {
    const p = planLanes(slots(60, 200), [offer(172), coach(), toasts([37])]);
    expect(p.offer).toMatchObject({ slot: 'B', h: MIN_OFFER });
    const q = planLanes(slots(130, 0), [offer(172)]);
    expect(q.offer?.h).toBe(130);
    // never taller than it is
    expect(planLanes(slots(400, 0), [offer(120)]).offer?.h).toBe(120);
  });

  it('toasts take the band that fits the most; the rest wait (count), and none is ever cut', () => {
    const p = planLanes(slots(37, 37 + G + 37), [toasts([37, 37, 37])]);
    expect(p.toasts).toMatchObject({ slot: 'T', count: 2 });
    expect(planLanes(slots(10, 10), [toasts([37])]).toasts).toMatchObject({ count: 0 });
  });

  it('a scrollable card (minH) fits a slot with at least minH and is capped at the room', () => {
    const death: LaneItem = { id: 'death', kind: 'card', opts: [{ slot: 'B', h: 280, minH: 140 }, { slot: 'T', h: 280, minH: 140 }, { slot: 'B', h: 52, compact: true }] };
    expect(planLanes(slots(200, 100), [death]).death).toMatchObject({ slot: 'B', h: 200, compact: false });
    expect(planLanes(slots(100, 160), [death]).death).toMatchObject({ slot: 'T', h: 160, compact: false });
    expect(planLanes(slots(100, 100), [death]).death).toMatchObject({ slot: 'B', h: 52, compact: true });
  });

  it('priority is the item order: a later item never displaces an earlier one', () => {
    const p = planLanes(slots(70, 0), [coach(62), toasts([37])]);
    expect(p.coach).toMatchObject({ slot: 'B' });
    expect(p.toasts?.count).toBe(0);
  });
});
