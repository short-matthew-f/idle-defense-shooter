import { describe, it, expect } from 'vitest';
import type { Sim } from '../../src/sim/index';
import type { HardpointId, DoctrineId, TreeId } from '../../src/sim/core/ids';
import { Ev } from '../../src/sim/core/types';
import { Sim as SimClass } from '../../src/sim/index';
import { treeDef } from '../../src/sim/core/content';
import { LINK_IDS } from '../../src/sim/systems/linkages';
import { hpSim, ring, setRanks, combatTick, share } from './hardpoint-helpers';
import { cos, sin } from '../../src/sim/math/lut';
import { expectWithinBudget } from '../core/perf-budget';

/** Step until an Ev.Linkage with `src` appears; returns the tick count used (or -1). */
function untilLink(sim: Sim, src: string, max: number): number {
  const w = sim.world;
  for (let t = 0; t < max; t++) {
    combatTick(sim);
    if (w.events.recent(w.tick - 1, Infinity, (e) => e.type === Ev.Linkage && e.src === src).length > 0) return t;
  }
  return -1;
}

function linkSim(systems: HardpointId[], link: string, extra: Record<string, number> = {}): Sim {
  const sim = hpSim(systems);
  sim.world.stats.override('ballistics.crit_chance', 1);
  setRanks(sim, { [link]: 3, ...extra });
  return sim;
}
function cluster(sim: Sim, x: number, y: number, n: number, hpScale = 1e5): void {
  for (let k = 0; k < n; k++) sim.world.spawnEnemy('grunt', x + (k % 3) * 20 - 20, y + Math.floor(k / 3) * 20 - 20, { hpScale });
}

type Scenario = { systems: HardpointId[]; extra?: Record<string, number>; setup: (sim: Sim) => void; max?: number };
const SCENARIOS: Record<string, Scenario> = {
  'link.primary+ordnance': { systems: ['ordnance'], setup: (s) => ring(s, 6, 200) },
  'link.primary+drones': { systems: ['drones'], setup: (s) => ring(s, 6, 150) },
  'link.primary+blade': { systems: ['blade'], setup: (s) => ring(s, 6, 150) },
  'link.primary+laser': { systems: ['laser'], extra: { 'laser.nodes': 3 }, setup: (s) => ring(s, 6, 200) },
  'link.primary+gravitics': { systems: ['gravitics'], setup: (s) => cluster(s, 200, 0, 9) },
  'link.ordnance+drones': { systems: ['ordnance', 'drones'], setup: (s) => ring(s, 6, 150) },
  'link.ordnance+blade': { systems: ['ordnance', 'blade'], setup: (s) => ring(s, 8, 60), max: 1200 },
  'link.ordnance+laser': { systems: ['ordnance', 'laser'], extra: { 'laser.nodes': 3 }, setup: (s) => ring(s, 6, 250) },
  'link.ordnance+gravitics': { systems: ['ordnance', 'gravitics'], setup: (s) => cluster(s, 220, 0, 9) },
  'link.drones+blade': { systems: ['drones', 'blade'], setup: (s) => ring(s, 16, 90) },
  'link.drones+laser': { systems: ['drones', 'laser'], setup: (s) => ring(s, 6, 150), max: 800 },
  'link.drones+gravitics': { systems: ['drones', 'gravitics'], setup: (s) => cluster(s, 95, 0, 9) },
  'link.blade+laser': { systems: ['blade', 'laser'], setup: (s) => { s.world.stats.override('laser.radius', 70); s.world.rebuildStats(); } },
  'link.blade+gravitics': { systems: ['blade', 'gravitics'], setup: (s) => cluster(s, 60, 0, 6) },
  'link.laser+gravitics': { systems: ['laser', 'gravitics'], setup: (s) => { s.world.stats.override('laser.rotation', 0); s.world.rebuildStats(); cluster(s, 0, 20, 9); } },
  'chassis.bastion+ordnance': {
    systems: ['ordnance'], setup: (s) => {
      ring(s, 4, 200);
      s.world.stats.override('bastion.shield_capacity', 50); s.world.rebuildStats();
      s.world.tower.shield = 50; combatTick(s); s.world.damageTower(500, -1, -1);
    },
  },
  'chassis.bastion+drones': {
    systems: ['drones'], setup: (s) => {
      s.world.stats.override('bastion.shield_capacity', 1000); s.world.rebuildStats(); s.world.tower.shield = 0;
      for (let k = 0; k < 20; k++) s.world.spawnEnemy('grunt', cos(k) * 120, sin(k) * 120, { hpScale: 0.2 });
    },
  },
  'chassis.bastion+blade': {
    systems: ['blade'], setup: (s) => {
      s.world.stats.override('bastion.shield_capacity', 100); s.world.rebuildStats(); s.world.tower.shield = 100;
      combatTick(s); s.world.damageTower(10, -1, -1);
    },
    max: 2,
  },
  'chassis.bastion+laser': { systems: ['laser'], setup: (s) => { s.world.stats.override('bastion.shield_capacity', 100); s.world.rebuildStats(); s.world.tower.shield = 100; } },
  'chassis.bastion+gravitics': { systems: ['gravitics'], setup: (s) => ring(s, 8, 70) },
  'chassis.reactor+ordnance': {
    systems: ['ordnance'], extra: { 'reactor.critical_mass': 1 }, setup: (s) => {
      ring(s, 40, 200);
      combatTick(s);
      for (let k = 0; k < 12; k++) s.world.killEnemy(k, -1, 'test');
    },
    max: 2,
  },
  'chassis.reactor+drones': { systems: ['drones'], setup: (s) => { s.world.build.doctrines.reactor = 'synchronization'; s.world.rebuildStats(); ring(s, 1, 150); } },
  'chassis.reactor+blade': { systems: ['blade'], setup: () => undefined },
  'chassis.reactor+laser': { systems: ['laser'], setup: () => undefined },
  'chassis.reactor+gravitics': { systems: ['gravitics'], setup: (s) => cluster(s, 200, 0, 9), max: 400 },
};

describe('Linkages', () => {
  it('covers all 25 linkage node ids', () => {
    expect(LINK_IDS.length).toBe(25);
    for (const id of LINK_IDS) expect(SCENARIOS[id]).toBeTruthy();
  });

  for (const id of LINK_IDS) {
    it(`${id} fires (Ev.Linkage) in a constructed scenario`, () => {
      const sc = SCENARIOS[id];
      const sim = linkSim(sc.systems, id, sc.extra);
      sc.setup(sim);
      const early = sim.world.events.recent(0, Infinity, (e) => e.type === Ev.Linkage && e.src === id).length;
      const t = early > 0 ? 0 : untilLink(sim, id, sc.max ?? 600);
      expect(t).toBeGreaterThanOrEqual(0);
    });
  }

  it('is inert without its node rank, and needs both halves mounted', () => {
    const sim = hpSim(['ordnance']);
    sim.world.stats.override('ballistics.crit_chance', 1);
    ring(sim, 6, 200);
    expect(untilLink(sim, 'link.primary+ordnance', 300)).toBe(-1);
    const sim2 = hpSim(['blade']);
    setRanks(sim2, { 'link.ordnance+blade': 3 });
    ring(sim2, 6, 60);
    expect(untilLink(sim2, 'link.ordnance+blade', 300)).toBe(-1);
  });

  it('linkage damage is attributed to the linkage src tag (Undertow, Escort Blades)', () => {
    const sim = linkSim(['blade', 'gravitics'], 'link.blade+gravitics');
    cluster(sim, 60, 0, 6);
    for (let t = 0; t < 300; t++) combatTick(sim);
    expect(share(sim, 'link.blade+gravitics')).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// Determinism and performance with four hardpoints and every tree ranked
// -----------------------------------------------------------------------------
function rankEverything(sim: Sim, trees: [TreeId, DoctrineId][]): void {
  const w = sim.world;
  for (const [tree, doc] of trees) {
    const def = treeDef(tree)!;
    for (const n of def.shared) w.build.ranks[n.id] = n.maxRank;
    w.build.doctrines[tree] = doc;
    for (const n of def.doctrines.find((d) => d.id === doc)!.nodes) w.build.ranks[n.id] = n.maxRank;
    if (def.exotic) w.build.ranks[def.exotic.id] = 1;
  }
  for (const id of LINK_IDS) w.build.ranks[id] = 3;
  for (const s of ['ordnance', 'drones', 'blade', 'laser', 'gravitics']) w.build.ranks[`infuse.${s}.fire`] = 3;
}

function fullBuild(seed: number, systems: HardpointId[]): Sim {
  const sim = new SimClass(null, seed);
  const w = sim.world;
  w.build.frame = 'arsenal';
  w.build.hardpoints = systems;
  w.build.attunements = ['fire'];
  w.stats.override('bastion.max_hp', 1e12);
  rankEverything(sim, [['ordnance', 'swarm'], ['drones', 'arc'], ['blade', 'tempest'], ['laser', 'resonance'], ['gravitics', 'collapse']]);
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  return sim;
}

describe('Hardpoints: determinism and performance', () => {
  it('two fresh Sims with four hardpoints and every tree ranked hash identically after 3000 ticks', () => {
    const systems: HardpointId[] = ['ordnance', 'drones', 'blade', 'laser'];
    const a = fullBuild(7, systems), b = fullBuild(7, systems);
    a.run(3000); b.run(3000);
    expect(a.events.nextId).toBeGreaterThan(300);
    const hpHits = a.events.recent(0, Infinity, (e) => e.type === Ev.Hit && ['ordnance', 'drones', 'blade', 'laser'].includes(e.src)).length;
    expect(hpHits).toBeGreaterThan(20);
    expect(a.events.hash()).toBe(b.events.hash());
    const c = fullBuild(7, ['ordnance', 'blade', 'laser', 'gravitics']), d = fullBuild(7, ['ordnance', 'blade', 'laser', 'gravitics']);
    c.run(3000); d.run(3000);
    expect(c.events.hash()).toBe(d.events.hash());
  }, 120_000);

  it('600 ticks, 800 enemies, four hardpoints active, under 5 s (smoke test)', () => {
    const sim = fullBuild(5, ['drones', 'blade', 'laser', 'gravitics']);
    const w = sim.world;
    const r = w.prng;
    for (let i = 0; i < 800; i++) {
      const a = r.next() * 6.283, dd = 60 + r.next() * 420;
      w.spawnEnemy(i % 3 === 0 ? 'swarm' : 'grunt', cos(a) * dd, sin(a) * dd, { hpScale: 1e6 });
    }
    sim.run(30);
    const t0 = performance.now();
    sim.run(600);
    const ms = performance.now() - t0;
    expect(w.enemies.count).toBeGreaterThan(600);
    for (const tag of ['drones', 'blade', 'laser', 'gravitics']) expect(share(sim, tag)).toBeGreaterThan(0);
    expectWithinBudget(ms, 5000);
  }, 60_000);
});
