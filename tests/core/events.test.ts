import { describe, it, expect } from 'vitest';
import { EventLogImpl, StateBit, STATUS_INDEX } from '../../src/sim/core/events';
import { Ev } from '../../src/sim/core/types';

describe('event log', () => {
  it('assigns ids, evicts old events from the ring and keeps hashing', () => {
    const log = new EventLogImpl(8);
    for (let i = 0; i < 20; i++) log.pushRaw(Ev.Hit, i, 'ballistics', i, 1, 0, 0, 0, -1);
    expect(log.nextId).toBe(20);
    expect(log.byId(11)).toBeUndefined();
    expect(log.byId(12)?.tick).toBe(12);
    expect(log.recent(18).map((e) => e.id)).toEqual([18, 19]);
    const a = new EventLogImpl(8), b = new EventLogImpl(8);
    for (let i = 0; i < 50; i++) { a.pushRaw(Ev.Kill, i, 'x', i, i * 2, 0, 0, 0, -1); b.pushRaw(Ev.Kill, i, 'x', i, i * 2, 0, 0, 0, -1); }
    expect(a.hash()).toBe(b.hash());
    b.pushRaw(Ev.Kill, 51, 'y', 0, 0, 0, 0, 0, -1);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('builds the design test sentence from cause links and tracks the longest kill chain', () => {
    const log = new EventLogImpl();
    const shock = log.pushRaw(Ev.StatusApply, 1, 'drones', 3, 1, STATUS_INDEX.shock | (StateBit.Frozen << 8), 0, 0, -1);
    const arc = log.pushRaw(Ev.Hit, 1, 'lightning', 4, 20, 0, 0, 0, shock);
    const det = log.pushRaw(Ev.Explosion, 1, 'poison', 30, 50, 0, 0, 0, arc);
    const hit = log.pushRaw(Ev.Hit, 1, 'poison', 5, 50, StateBit.Elite, 0, 0, det);
    const kill = log.pushRaw(Ev.Kill, 1, 'poison', 5, 77, StateBit.Elite, 0, 0, hit);
    const launch = log.pushRaw(Ev.Spawn, 1, 'ordnance', 0, 0, 0, 0, 0, kill);
    const { chain, sentence } = log.chain(launch);
    expect(chain.map((e) => e.id)).toEqual([shock, arc, det, hit, kill, launch]);
    expect(sentence).toBe('The drone shocked the frozen enemy, which caused the lightning to jump to the enemy, which caused the poison to detonate, which killed the elite, which launched the missiles.');
    expect(log.longestKillChain).toBe(3);
  });

  it('folds a same-source hit into its kill', () => {
    const log = new EventLogImpl();
    const h = log.pushRaw(Ev.Hit, 1, 'ballistics', 0, 10, 0, 0, 0, -1);
    const k = log.pushRaw(Ev.Kill, 1, 'ballistics', 0, 1, 0, 0, 0, h);
    expect(log.chain(k).sentence).toBe('The gun killed the enemy.');
    expect(log.longestKillChain).toBe(1);
  });

  it('never repeats a triggered thing or a clause (UX review S4)', () => {
    const log = new EventLogImpl();
    // gun hit → loaded dice re-roll (twice in a row) → gun kill
    const h = log.pushRaw(Ev.Hit, 1, 'ballistics', 0, 10, 0, 0, 0, -1);
    const d1 = log.pushRaw(Ev.Anomaly, 1, 'anomaly.loaded_dice', 0, 0, 0, 0, 0, h);
    const d2 = log.pushRaw(Ev.Anomaly, 1, 'anomaly.loaded_dice', 0, 0, 0, 0, 0, d1);
    const k = log.pushRaw(Ev.Kill, 1, 'ballistics', 0, 1, StateBit.Burning, 0, 0, d2);
    const { sentence } = log.chain(k);
    expect(sentence).toBe('The gun shot the enemy, which triggered the loaded dice, which caused the gun to kill the burning enemy.');
    expect(sentence).not.toMatch(/loaded dice to trigger loaded dice/);
    // repeated identical DoT links collapse to one clause
    const b = log.pushRaw(Ev.StatusApply, 2, 'fire', 1, 1, STATUS_INDEX.burn, 0, 0, -1);
    const t1 = log.pushRaw(Ev.StatusTick, 2, 'burn', 1, 5, StateBit.Burning << 8, 0, 0, b);
    const t2 = log.pushRaw(Ev.StatusTick, 3, 'burn', 1, 5, StateBit.Burning << 8, 0, 0, t1);
    const k2 = log.pushRaw(Ev.Kill, 3, 'burn', 1, 1, StateBit.Burning, 0, 0, t2);
    const s2 = log.chain(k2).sentence;
    expect(s2).toBe('The fire ignited the enemy, which wore down the burning enemy, which killed the burning enemy.');
    // a triggered Fusion as the root and a Linkage mid-chain
    const f = log.pushRaw(Ev.Fusion, 4, 'fusion.plasma', 2, 1, 0, 0, 0, -1);
    const l = log.pushRaw(Ev.Linkage, 4, 'link.blade+laser', 2, 1, 0, 0, 0, f);
    expect(log.chain(l).sentence).toBe('The plasma triggered, which triggered the blade-laser link.');
  });
});
