import { describe, expect, it } from 'vitest';
import { ChainBudget, ChainTracker, chainPitch, MAX_CHAIN_STEP, RING, timbreFor, type NoteCandidate } from '../../src/audio/chain';
import { inScale, MODES, pentatonicFor } from '../../src/audio/theory';

describe('audio chain: depth ring map', () => {
  it('root events are depth 0; a known cause adds one link; continuing the same src adds none', () => {
    const c = new ChainTracker();
    expect(c.record(10, -1, true, false)).toBe(0);      // gun hit (root)
    expect(c.record(11, 10, false, false)).toBe(1);     // shocked (StatusApply)
    expect(c.record(12, 11, true, false)).toBe(2);      // lightning jumped (Hit)
    expect(c.record(13, 12, true, true)).toBe(2);       // same-src continuation (pierce)
    expect(c.record(14, 13, false, true)).toBe(2);      // Kill caused by the Hit of the same damage call
    expect(c.record(15, 14, false, false)).toBe(3);     // which launched the missiles
    expect(c.depthOf(12)).toBe(2);
    expect(c.isHit(12)).toBe(true);
    expect(c.isHit(11)).toBe(false);
  });

  it('an unknown cause (never seen, or overwritten by the ring) counts as a root', () => {
    const c = new ChainTracker();
    expect(c.record(100, 99, false, false)).toBe(0);
    c.record(5, -1, false, false);
    c.record(6, 5, false, false);
    expect(c.depthOf(6)).toBe(1);
    c.record(6 + RING, 5, false, false);                  // overwrites slot of id 6
    expect(c.depthOf(6)).toBe(-1);
    expect(c.record(6 + RING + 1, 6, false, false)).toBe(0);
  });

  it('depth saturates instead of overflowing', () => {
    const c = new ChainTracker();
    c.record(0, -1, false, false);
    for (let i = 1; i < 400; i++) c.record(i, i - 1, false, false);
    expect(c.depthOf(399)).toBe(255);
  });
});

describe('audio chain: melody', () => {
  it('pitch climbs with depth, stays in key, and caps at two octaves', () => {
    for (const key of [{ root: 50, mode: 'dorian' as const }, { root: 54, mode: 'lydian' as const }, { root: 46, mode: 'ionian' as const }]) {
      let prev = -Infinity;
      for (let d = 1; d <= MAX_CHAIN_STEP + 1; d++) {
        const m = chainPitch(d, key);
        expect(m).toBeGreaterThan(prev);
        expect(inScale(m, key.root, pentatonicFor(key.mode))).toBe(true);
        expect(inScale(m, key.root, MODES[key.mode])).toBe(true);
        prev = m;
      }
      expect(chainPitch(MAX_CHAIN_STEP + 1, key) - chainPitch(1, key)).toBe(24);
      expect(chainPitch(50, key)).toBe(chainPitch(MAX_CHAIN_STEP + 1, key));
    }
  });

  it('chooses timbre from the src tag', () => {
    expect(timbreFor('fire')).toBe('ember');
    expect(timbreFor('lightning')).toBe('spark');
    expect(timbreFor('poison')).toBe('drop');
    expect(timbreFor('frost')).toBe('glass');
    expect(timbreFor('fusion.plasma')).toBe('shimmer');
    expect(timbreFor('link.blade+laser')).toBe('bell');
    expect(timbreFor('infuse.laser.frost')).toBe('glass');
    expect(timbreFor('ability.bombardment')).toBe('shimmer');
    expect(timbreFor('ballistics')).toBe('pluck');
    expect(timbreFor('boss.breaker')).toBe('pluck');
  });

  it('budget keeps the deepest candidates, caps per batch and per second, and plays them rising', () => {
    const b = new ChainBudget(7, 5, 4);
    const cands: NoteCandidate[] = [1, 5, 2, 7, 3, 6, 1].map((depth, i) => ({ depth, id: i, src: 'fire', x: 0, weight: 1 }));
    const out = b.select(cands, 0);
    expect(out.map((c) => c.depth)).toEqual([3, 5, 6, 7]);
    // one token left in the burst of 5
    expect(b.select(cands, 0).length).toBe(1);
    expect(b.select(cands, 0).length).toBe(0);
    // refills at 7 per second
    expect(b.select(cands, 0.5).length).toBe(3);
    let total = 0;
    for (let t = 1; t < 11; t += 1 / 60) total += b.select(cands, t).length;
    expect(total).toBeLessThanOrEqual(7 * 10 + 5 + 5);   // rate × time + burst (+ what refilled before)
    expect(total).toBeGreaterThanOrEqual(7 * 10 - 5);
  });

  it('sim speed shrinks the note budget', () => {
    const b = new ChainBudget(7, 5, 4);
    b.setBudget(0.35);
    const cands: NoteCandidate[] = [{ depth: 3, id: 1, src: 'fire', x: 0, weight: 1 }];
    let total = 0;
    for (let t = 0; t < 10; t += 1 / 60) total += b.select(cands, t).length;
    expect(total).toBeLessThanOrEqual(7 * 0.35 * 10 + 2 + 1);   // rate × time + the shrunken burst
  });
});
