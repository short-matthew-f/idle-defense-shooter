/** Kill-chain link lines (graphics pass): selection, budget, lifetime and the renderer's per-tier cap. */
import { describe, expect, it } from 'vitest';
import { Ev, INST_FLAG_SCALE, INSTANCE_FLOATS, InstFlag, Shape } from '../../src/sim/core/types';
import type { SimEvent, RenderSnapshot } from '../../src/sim/core/types';
import { CHAIN_LIFE, CHAIN_MAX, ChainLines, chooseChainSlot, srcColor } from '../../src/sim/core/snapshot-fx';
import { SnapshotWriter } from '../../src/sim/core/snapshot';
import { FramePrep, DEFAULT_FRAME_OPTIONS } from '../../src/render/frame-prep';

function ev(type: Ev, x: number, y: number, src = 'lightning'): SimEvent {
  return { id: 0, tick: 0, type, cause: -1, src, a: 0, b: 0, x, y };
}

function lines(out: SnapshotWriter): { depthWidth: number; a: number }[] {
  const r: { depthWidth: number; a: number }[] = [];
  for (let i = 0; i < out.count; i++) {
    const o = i * INSTANCE_FLOATS;
    expect(out.instances[o + 4]).toBe(Shape.Line);
    expect(out.instances[o + 9]).toBe(2 + INST_FLAG_SCALE * InstFlag.Chain);
    r.push({ depthWidth: out.instances[o + 2], a: out.instances[o + 8] });
  }
  return r;
}

describe('chain slot selection', () => {
  it('reuses expired slots first, then evicts the shallowest (oldest on ties) only for an equal or deeper link', () => {
    const depths = new Int32Array([3, 2, 5, 2]), born = new Int32Array([10, 11, 12, 9]);
    expect(chooseChainSlot(depths, born, 20, 24, 1)).toBe(-1);   // shallower than everything live
    expect(chooseChainSlot(depths, born, 20, 24, 2)).toBe(3);    // shallowest, oldest
    expect(chooseChainSlot(depths, born, 33, 24, 1)).toBe(3);    // slot 3 (born 9) expires first, at frame 33
  });

  it('keeps the CHAIN_MAX deepest when more links compete in one frame', () => {
    const c = new ChainLines();
    const depths: number[] = [];
    for (let k = 0; k < 300; k++) { const d = 2 + ((k * 7919) % 11); depths.push(d); c.add(k, 0, k, 10, [1, 1, 1], d, 5); }
    expect(c.live(5)).toBe(CHAIN_MAX);
    const kept = Array.from(c.depth).sort((a, b) => b - a);
    const best = depths.sort((a, b) => b - a).slice(0, CHAIN_MAX);
    expect(kept).toEqual(best);
  });

  it('fades out over CHAIN_LIFE frames and writes at most CHAIN_MAX lines, deep ones first', () => {
    const c = new ChainLines();
    for (let k = 0; k < 80; k++) c.add(k, 0, k + 20, 0, [1, 0.5, 0.2], k % 2 ? 5 : 2, 0);
    const out = new SnapshotWriter();
    expect(c.write(out, 0)).toBe(CHAIN_MAX);
    const l = lines(out);
    expect(l[0].depthWidth).toBeGreaterThan(l[l.length - 1].depthWidth);
    const mid = new SnapshotWriter(); c.write(mid, CHAIN_LIFE / 2);
    expect(lines(mid)[0].a).toBeLessThan(l[0].a);
    const done = new SnapshotWriter();
    expect(c.write(done, CHAIN_LIFE)).toBe(0);
  });

  it('offers only real links: deeper than the parent, at least depth 2, from a place, visibly apart', () => {
    const c = new ChainLines();
    const parent = ev(Ev.Hit, 100, 100, 'drones'), child = ev(Ev.StatusApply, 160, 120, 'lightning');
    expect(c.offer(child, parent, 2, 1, 0)).toBe(true);
    expect(c.offer(child, parent, 1, 0, 0)).toBe(false);          // too shallow
    expect(c.offer(child, parent, 3, 3, 0)).toBe(false);          // same link continuing
    expect(c.offer(child, undefined, 3, 1, 0)).toBe(false);       // parent aged out of the log
    expect(c.offer(ev(Ev.Hit, 101, 101), parent, 3, 1, 0)).toBe(false);   // too close to see
    expect(c.offer(child, ev(Ev.Purchase, 0, 0), 3, 1, 0)).toBe(false);   // not a place
    expect(c.offer(ev(Ev.WaveClear, 5, 5), parent, 3, 1, 0)).toBe(false); // not a linkable child
    expect(c.offer(ev(Ev.Explosion, 20, 20, 'kamikaze'), ev(Ev.Spawn, 400, 0, 'grunt'), 3, 1, 0)).toBe(false);   // enemy attacks (caused by their Spawn) never draw
  });

  it('colours links by element / system / fusion', () => {
    expect(srcColor('fire')).toEqual(srcColor('infuse.blade.fire'));
    expect(srcColor('laser')).not.toEqual(srcColor('drones'));
    expect(srcColor('fusion.plasma')).not.toEqual(srcColor('fire'));
    for (const s of ['ballistics', 'link.blade+laser', 'anomaly.pinball', 'zzz']) srcColor(s).forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); });
  });
});

describe('renderer chain budget', () => {
  function snapWith(nLines: number): RenderSnapshot {
    const c = new ChainLines(), out = new SnapshotWriter();
    out.push(0, 0, 10, 0, Shape.Circle, 1, 1, 1, 1, 4, 1, 0);
    for (let k = 0; k < nLines; k++) c.add(k, 0, k, 50, [1, 1, 1], 2 + (k % 5), 0);
    c.write(out, 0);
    return { tick: 1, instances: out.instances, instanceCount: out.count, fx: new Float32Array(8), fxCount: 0, cameraShake: 0, clarity: 0 };
  }
  it('caps chain lines per quality tier and drops them all when the setting is off', () => {
    const p = new FramePrep(100);
    const s = snapWith(64);
    p.frame(s, 1 / 60, { ...DEFAULT_FRAME_OPTIONS, chainMax: 24 });
    expect(p.chainsDrawn).toBe(24);
    expect(p.counts[2]).toBe(24);
    p.frame({ ...s, tick: 2 }, 1 / 60, { ...DEFAULT_FRAME_OPTIONS, chains: false });
    expect(p.chainsDrawn).toBe(0);
    expect(p.counts[2]).toBe(0);
    expect(p.counts[4]).toBe(1);
  });
});
