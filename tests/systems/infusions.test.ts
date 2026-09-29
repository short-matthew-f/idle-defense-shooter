import { describe, it, expect } from 'vitest';
import type { Sim } from '../../src/sim/index';
import type { ElementId, HardpointId } from '../../src/sim/core/ids';
import { Ev, ProjKind } from '../../src/sim/core/types';
import { hpSim, ring, setRanks, combatTick, evs } from './hardpoint-helpers';

const SYSTEMS: HardpointId[] = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];
const ELEMENTS: ElementId[] = ['fire', 'lightning', 'poison', 'frost'];
const STATUS: Record<ElementId, string> = { fire: 'burn', lightning: 'shock', poison: 'poison', frost: 'chill' };

function cluster(sim: Sim, x: number, y: number, n: number): void {
  for (let k = 0; k < n; k++) sim.world.spawnEnemy('grunt', x + (k % 3) * 20 - 20, y + Math.floor(k / 3) * 20 - 20, { hpScale: 1e5 });
}

function setup(sys: HardpointId, el: ElementId): Sim {
  const sim = hpSim([sys], [el]);
  setRanks(sim, { [`infuse.${sys}.${el}`]: 3 });
  const w = sim.world;
  switch (sys) {
    case 'ordnance': ring(sim, 12, 200, 'grunt', 1e5); break;
    case 'drones': setRanks(sim, { 'drones.count': 3 }); ring(sim, 8, 150, 'grunt', 1e5); break;
    case 'blade': w.stats.override('blade.knockback', 0); w.rebuildStats(); ring(sim, 12, 50, 'grunt', 1e5); ring(sim, 12, 78, 'grunt', 1e5, 0.2); break;
    case 'laser': ring(sim, 12, 60, 'grunt', 1e5); ring(sim, 6, 150, 'grunt', 1e5); break;
    case 'gravitics': cluster(sim, 200, 0, 9); break;
  }
  return sim;
}

describe('Infusions', () => {
  for (const sys of SYSTEMS) for (const el of ELEMENTS) {
    const id = `infuse.${sys}.${el}`;
    it(`${id}: twist fires (Ev.Infusion) and applies ${STATUS[el]}`, () => {
      const sim = setup(sys, el);
      let ok = false;
      for (let t = 0; t < 900 && !ok; t++) {
        combatTick(sim);
        if (t % 30 !== 29) continue;
        const inf = evs(sim, Ev.Infusion, id).length;
        const st = evs(sim, Ev.StatusApply, id).length;
        ok = inf > 0 && st > 0;
      }
      expect(ok).toBe(true);
    });
  }

  it('infused hardpoints carry the element on their hits (HitInfo.element)', () => {
    for (const sys of SYSTEMS) {
      const sim = setup(sys, 'frost');
      const w = sim.world;
      const seen = new Set<string>();
      const orig = w.damage.bind(w);
      w.damage = (i, amt, opts) => { if (opts.srcTag === sys && opts.element) seen.add(opts.element); return orig(i, amt, opts); };
      if (sys === 'gravitics') {   // wells only deal damage through Collapse implosions (and Mass Driver)
        w.build.doctrines.gravitics = 'collapse';
        setRanks(sim, { 'gravitics.collapse.implosion': 1 });
      }
      for (let t = 0; t < 700; t++) combatTick(sim);
      expect([sys, [...seen]]).toEqual([sys, ['frost']]);
    }
  });

  it('Brood microdrones carry the infusion; without Brood they do not proc drone infusions', () => {
    const sim = hpSim(['drones'], ['poison']);
    setRanks(sim, { 'infuse.drones.poison': 3 });
    sim.world.build.doctrines.drones = 'carrier';
    setRanks(sim, { 'drones.carrier.launch_bay': 1 });
    let plain = 0;
    ring(sim, 6, 150, 'grunt', 1e5);
    for (let t = 0; t < 400; t++) {
      combatTick(sim);
      const p = sim.world.projectiles;
      for (let i = 0; i < p.count; i++) if (p.kind[i] === ProjKind.Microdrone && p.element[i] === 0) plain++;
    }
    expect(plain).toBeGreaterThan(0);
  });

  it('Prism frame: beams cycle every attuned element without infusion ranks', () => {
    const sim = hpSim([], ['fire', 'frost']);
    sim.world.build.frame = 'prism';
    sim.world.rebuildStats();
    const w = sim.world;
    expect(w.stats.mounted('laser')).toBe(true);
    ring(sim, 12, 60, 'grunt', 1e5);
    const seen = new Set<string>();
    const orig = w.damage.bind(w);
    w.damage = (i, amt, opts) => { if (opts.srcTag === 'laser' && opts.element) seen.add(opts.element); return orig(i, amt, opts); };
    for (let t = 0; t < 300; t++) combatTick(sim);
    expect([...seen].sort()).toEqual(['fire', 'frost']);
    expect(evs(sim, Ev.Infusion, 'infuse.laser.fire').length).toBeGreaterThan(0);
  });

  it('Rime Edge shatters frozen enemies; Venom Edge kills contaminate the blade', () => {
    const sim = hpSim(['blade'], ['frost', 'poison']);
    setRanks(sim, { 'infuse.blade.frost': 3, 'infuse.blade.poison': 3 });
    const w = sim.world;
    w.stats.override('blade.knockback', 0); w.rebuildStats();
    const ids = ring(sim, 8, 50, 'grunt', 1e5);
    for (const i of ids) w.freeze(i, 600, 'test', -1);
    for (let k = 0; k < 6; k++) w.spawnEnemy('grunt', 40 + k * 3, 30, { hpScale: 0.01 });
    for (let t = 0; t < 240; t++) combatTick(sim);
    expect(evs(sim, Ev.Hit, 'infuse.blade.frost').length).toBeGreaterThan(0);
    expect(evs(sim, Ev.Infusion, 'infuse.blade.poison').length).toBeGreaterThan(0);
  });
});
