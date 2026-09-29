import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { exportString, importString, migrate } from '../../src/sim/save/serialize';
import { strongSim, runUntil } from './helpers';

describe('save / load', () => {
  it('round-trips through export strings and resumes at the checkpoint', () => {
    const a = strongSim(9);
    runUntil(a, () => a.world.run.deepestCleared >= 7, 15 * 3600);
    a.world.run.scrap = 1234.5;
    a.world.build.ranks['ballistics.damage'] = 3;
    const save = a.save();
    const str = exportString(save);
    const back = importString(str);
    expect(back).toEqual(migrate(save));
    const b = Sim.load(back);
    expect(b.world.run.wave).toBe(a.world.run.checkpoint + 1);
    expect(b.world.run.phase).toBe('between');
    expect(b.world.run.scrap).toBe(1234.5);
    expect(b.world.run.firstClears[3]).toBe(1);
    expect(b.world.build.ranks['ballistics.damage']).toBe(3);
    const again = b.save();
    expect({ ...again.run, attempts: 0 }).toEqual({ ...save.run, wave: again.run.wave, attempts: 0 });
  });

  it('a save taken mid-combat on wave 3 resumes at the checkpoint with Scrap and build intact', () => {
    const a = strongSim(4);
    a.world.run.scrap = 1e6;
    a.command({ type: 'buy', node: 'ballistics.damage' });
    a.command({ type: 'buy', node: 'ballistics.damage' });
    a.step();
    expect(a.world.build.ranks['ballistics.damage']).toBe(2);
    const w = a.world;
    const alive = (): number => { let n = 0; for (let i = 0; i < w.enemies.count; i++) if (w.alive(i)) n++; return n; };
    runUntil(a, () => w.run.wave === 3 && w.run.phase === 'combat' && w.run.waveTick > 30 && alive() > 0, 60 * 600);
    expect(w.run.wave).toBe(3);
    expect(w.run.phase).toBe('combat');
    expect(w.run.checkpoint).toBe(0);
    const scrap = w.run.scrap;
    const build = JSON.parse(JSON.stringify(w.build));
    const b = Sim.load(importString(exportString(a.save())));
    expect(b.world.run.wave).toBe(w.run.checkpoint + 1);
    expect(b.world.run.phase).toBe('between');
    expect(b.world.run.scrap).toBe(scrap);
    expect(b.world.run.deepestCleared).toBe(2);
    expect(JSON.parse(JSON.stringify(b.world.build))).toEqual(build);
    expect(b.world.enemies.count).toBe(0);
  });

  it('two Sims loaded from the same save produce identical event hashes', () => {
    const a = new Sim(null, 21);
    a.run(2400);
    const save = a.save();
    const b1 = Sim.load(importString(exportString(save)));
    const b2 = Sim.load(importString(exportString(save)));
    b1.run(2400); b2.run(2400);
    expect(b1.events.hash()).toBe(b2.events.hash());
    expect(b1.events.nextId).toBe(b2.events.nextId);
  });
});
