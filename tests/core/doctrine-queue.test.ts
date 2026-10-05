/**
 * UX Phase 2 item 7: "Change at next checkpoint". queue_doctrine queues a Doctrine change outside the checkpoint
 * window; Sim.step applies it (charging the Core then) at the next checkpoint `between`; cancel_doctrine drops it;
 * the queue is saved and restored, and replays deterministically.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import type { DoctrineId, TreeId } from '../../src/sim/core/ids';
import { TREES } from '../../src/sim/data/index';
import { toSave, fromSave } from '../../src/sim/save/serialize';
import { cmd } from '../active/helpers';

function forkReady(sim: Sim, tree: TreeId): DoctrineId[] {
  const t = TREES.find((x) => x.id === tree)!;
  for (const n of t.shared.filter((x) => !x.ability).slice(0, t.forkRequirement)) sim.world.build.ranks[n.id] = 1;
  sim.world.rebuildStats();
  return t.doctrines.map((d) => d.id);
}
function midWave(sim: Sim): void { const r = sim.world.run; r.phase = 'combat'; r.wave = r.checkpoint + 2; }
function toCheckpoint(sim: Sim): void { const r = sim.world.run; r.phase = 'between'; r.phaseTicks = 0; r.wave = r.checkpoint + 1; }

describe('queue_doctrine / cancel_doctrine', () => {
  it('queues a change mid-wave, shows it in UiState, and applies it (1 Core) at the next checkpoint', () => {
    const sim = new Sim(null, 31);
    const [a, b] = forkReady(sim, 'ballistics');
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: a })).toBeNull();
    sim.world.run.cores = 1;
    midWave(sim);
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: b })).toBe('Change at next checkpoint');
    expect(cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: b })).toBeNull();
    expect(sim.uiState().run.pendingDoctrines).toEqual([{ tree: 'ballistics', doctrine: b, second: false }]);
    expect(sim.world.run.cores).toBe(1);                 // charged on apply, not on queue
    sim.step();                                          // still mid-wave: nothing happens
    expect(sim.world.build.doctrines.ballistics).toBe(a);
    toCheckpoint(sim);
    sim.step();
    expect(sim.world.build.doctrines.ballistics).toBe(b);
    expect(sim.world.run.cores).toBe(0);
    expect(sim.uiState().run.pendingDoctrines).toEqual([]);
  });

  it('cancel drops it; a new queue for the same tree replaces the old; no Cores → rejected', () => {
    const sim = new Sim(null, 32);
    const [a, b, c] = forkReady(sim, 'ballistics');
    cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: a });
    midWave(sim);
    sim.world.run.cores = 0;
    expect(cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: b })).toBe('Not enough Cores');
    sim.world.run.cores = 3;
    expect(cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: b })).toBeNull();
    expect(cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: c })).toBeNull();
    expect(sim.world.run.pendingDoctrines).toEqual([{ tree: 'ballistics', doctrine: c, second: false }]);
    expect(cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: a })).toBe('Already chosen');
    expect(cmd(sim, { type: 'cancel_doctrine', tree: 'ballistics' })).toBeNull();
    expect(sim.world.run.pendingDoctrines).toBeUndefined();
    expect(cmd(sim, { type: 'cancel_doctrine', tree: 'ballistics' })).toBe('No Doctrine change queued');
    toCheckpoint(sim);
    sim.step();
    expect(sim.world.build.doctrines.ballistics).toBe(a);
    expect(sim.world.run.cores).toBe(3);
  });

  it('at a checkpoint (or a free first pick) it applies at once', () => {
    const sim = new Sim(null, 33);
    const [a, b] = forkReady(sim, 'ballistics');
    midWave(sim);
    expect(cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: a })).toBeNull();   // free first pick
    expect(sim.world.build.doctrines.ballistics).toBe(a);
    toCheckpoint(sim);
    sim.world.run.cores = 1;
    expect(cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: b })).toBeNull();
    expect(sim.world.build.doctrines.ballistics).toBe(b);
    expect(sim.world.run.pendingDoctrines).toBeUndefined();
  });

  it('second Doctrine: queue a clear (doctrine null) and apply it at the checkpoint', () => {
    const sim = new Sim(null, 34);
    sim.world.meta.prestigeRanks['prestige.dual_doctrine'] = 1;
    const [a, b] = forkReady(sim, 'ballistics');
    cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: a });
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: b, second: true })).toBeNull();
    midWave(sim);
    sim.world.run.cores = 1;
    expect(cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: null })).toBe('Only a second Doctrine can be cleared');
    expect(cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: null, second: true })).toBeNull();
    toCheckpoint(sim);
    sim.step();
    expect(sim.world.build.secondDoctrines.ballistics).toBeUndefined();
    expect(sim.world.run.cores).toBe(0);
  });

  it('is saved and restored (unknown entries dropped), and the apply replays identically', () => {
    const mk = (): Sim => {
      const sim = new Sim(null, 35);
      const [a, b] = forkReady(sim, 'ballistics');
      cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: a });
      sim.world.run.cores = 2;
      midWave(sim);
      cmd(sim, { type: 'queue_doctrine', tree: 'ballistics', doctrine: b });
      return sim;
    };
    const sim = mk();
    const save = toSave(sim);
    expect(save.run.pendingDoctrines).toEqual([{ tree: 'ballistics', doctrine: 'piercing', second: false }]);
    const bad = JSON.parse(JSON.stringify(save));
    bad.run.pendingDoctrines.push({ tree: 'nope', doctrine: 'x', second: false }, { tree: 'ballistics', doctrine: 'ricochet', second: false });
    const restored = new Sim(bad, 35);
    expect(restored.world.run.pendingDoctrines).toEqual([{ tree: 'ballistics', doctrine: 'piercing', second: false }]);
    expect(fromSave(save).run.pendingDoctrines?.length).toBe(1);
    // the restored run starts its attempt at checkpoint+1 in `between`: the change lands on the first step
    restored.step();
    expect(restored.world.build.doctrines.ballistics).toBe('piercing');
    // determinism: two identical runs apply on the same tick
    const x = mk(), y = mk();
    for (let i = 0; i < 600; i++) { x.step(); y.step(); }
    expect(x.world.build.doctrines.ballistics).toBe(y.world.build.doctrines.ballistics);
    expect(x.world.run.cores).toBe(y.world.run.cores);
    expect(x.world.run.tick).toBe(y.world.run.tick);
  });
});
