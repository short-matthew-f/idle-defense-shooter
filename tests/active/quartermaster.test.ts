import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import type { SaveState } from '../../src/sim/core/types';
import { Ev, SAVE_VERSION } from '../../src/sim/core/types';
import type { TreeId } from '../../src/sim/core/ids';
import { allNodes, nodeInfo, treeDef } from '../../src/sim/core/content';
import { buildShop, shopEntryFor } from '../../src/sim/economy/shop';
import { migrate } from '../../src/sim/save/serialize';
import {
  QM_INTERVAL_TICKS, QM_MAX_RANKS_PER_PASS, QM_TREES, quartermasterNode, queueHold, runQuartermaster, sanitizeQuartermaster,
} from '../../src/sim/directives/quartermaster';
import { arena, cmd, events, tick, unlock } from './helpers';

type S = ReturnType<typeof arena>;

/** Arena between waves, after one Prestige, Quartermaster on with `reserve`. */
function qm(reserve = 0, seed = 1): S {
  const sim = arena(seed);
  sim.world.meta.prestigeCount = 1;
  sim.machine.setPhase('between');
  expect(cmd(sim, { type: 'set_quartermaster', on: true, reserve })).toBeNull();
  return sim;
}
const qmBuys = (sim: S) => events(sim, Ev.Purchase).filter((e) => e.data?.via === 'quartermaster');

/** Everything the shop can show at once: four hardpoints, three elements, a Doctrine per tree, forks open, rich. */
function everything(sim: S): void {
  const w = sim.world, b = w.build;
  b.hardpoints = ['ordnance', 'drones', 'laser', 'gravitics'];
  b.attunements = ['fire', 'lightning', 'poison'];
  b.abilities = ['repulsor_pulse', 'hunter_mark'];
  w.run.hardpointSlotsOpen = 4; w.run.attunementSlotsOpen = 3;
  for (const info of allNodes()) if (info.group === 'tree' && info.shared && info.def.kind === 'stat') b.ranks[info.def.id] = 1;
  w.rebuildStats();
  for (const t of ['ballistics', 'bastion', 'reactor', 'ordnance', 'drones', 'laser', 'gravitics', 'fire', 'lightning', 'poison'] as TreeId[]) {
    const d = treeDef(t)!.doctrines[0];
    b.doctrines[t] = d.id;
  }
  w.rebuildStats();
  w.run.scrap = 1e12; w.run.cores = 50;
}

describe('Quartermaster: what it may buy', () => {
  it('the rule accepts only Scrap-priced stat ramps in chassis / hardpoint trees (every node in the content)', () => {
    let ok = 0;
    for (const info of allNodes()) {
      if (!quartermasterNode(info)) continue;
      ok++;
      expect(info.group, info.def.id).toBe('tree');
      expect(info.def.kind, info.def.id).toBe('stat');
      expect('cores' in info.def.cost, info.def.id).toBe(false);
      expect(info.exotic, info.def.id).toBeFalsy();
      expect(info.def.ability, info.def.id).toBeFalsy();
      expect(['chassis', 'hardpoint']).toContain(treeDef(info.tree!)!.category);
    }
    expect(ok).toBeGreaterThan(20);
    for (const g of ['fusion', 'triad', 'link', 'chassis_link', 'infuse', 'ability', 'prestige', 'star']) {
      expect(allNodes().filter((i) => i.group === g).some(quartermasterNode), g).toBe(false);
    }
    expect(allNodes().filter((i) => i.tree && treeDef(i.tree)?.category === 'element').some(quartermasterNode)).toBe(false);
  });

  it('over the whole live shop it only ever buys stat entries and never touches choices or Cores', () => {
    const sim = qm(0);
    everything(sim);
    const w = sim.world;
    const before = JSON.stringify({ hp: w.build.hardpoints, at: w.build.attunements, d: w.build.doctrines, d2: w.build.secondDoctrines, an: w.build.anomalies, ab: w.build.abilities, boons: w.build.boons });
    const kinds = new Map(buildShop(w).map((e) => [e.node, e]));
    expect([...kinds.values()].some((e) => e.kind !== 'stat' && e.affordable)).toBe(true);   // choices were on offer
    for (let k = 0; k < 40; k++) runQuartermaster(w);
    const bought = qmBuys(sim);
    expect(bought.length).toBeGreaterThan(40);
    for (const e of bought) {
      const entry = kinds.get(e.src);
      expect(entry?.kind, e.src).toBe('stat');
      expect(entry?.currency, e.src).toBe('scrap');
      expect(quartermasterNode(nodeInfo(e.src)), e.src).toBe(true);
      expect(QM_TREES).toContain(entry!.tree);
    }
    expect(w.run.cores).toBe(50);
    expect(JSON.stringify({ hp: w.build.hardpoints, at: w.build.attunements, d: w.build.doctrines, d2: w.build.secondDoctrines, an: w.build.anomalies, ab: w.build.abilities, boons: w.build.boons })).toBe(before);
    for (const info of allNodes()) if (!quartermasterNode(info) && info.group !== 'prestige' && info.group !== 'star') {
      const shared = info.group === 'tree' && info.shared && info.def.kind === 'stat';
      expect(w.build.ranks[info.def.id] ?? 0, info.def.id).toBe(shared ? 1 : 0);
    }
  });

  it('buys in a Doctrine\'s stat nodes only once that Doctrine was chosen, and never in element trees', () => {
    const sim = qm(0);
    everything(sim);
    const w = sim.world;
    for (let k = 0; k < 40; k++) runQuartermaster(w);
    const trees = new Set(qmBuys(sim).map((e) => nodeInfo(e.src)!.tree));
    for (const t of ['fire', 'lightning', 'poison', 'frost']) expect(trees.has(t as TreeId)).toBe(false);
    for (const e of qmBuys(sim)) { const i = nodeInfo(e.src)!; if (i.doctrine) expect(w.build.doctrines[i.tree!]).toBe(i.doctrine); }
  });
});

describe('Quartermaster: gates', () => {
  it('is locked before the first Prestige: the command is rejected and a forced setting buys nothing', () => {
    const sim = arena();
    const w = sim.world;
    sim.machine.setPhase('between');
    w.run.scrap = 1e6;
    expect(cmd(sim, { type: 'set_quartermaster', on: true })).toMatch(/first Prestige/);
    w.meta.settings.quartermaster = { on: true, reserve: 0, trees: {}, order: [] };   // a hand-edited save
    expect(runQuartermaster(w)).toBe(0);
    expect(sim.uiState().quartermaster?.unlocked).toBe(false);
    w.meta.prestigeCount = 1;
    expect(runQuartermaster(w)).toBeGreaterThan(0);
  });

  it('is off by default and after switching off', () => {
    const sim = arena();
    const w = sim.world;
    w.meta.prestigeCount = 2;
    sim.machine.setPhase('between');
    w.run.scrap = 1e6;
    expect(w.meta.settings.quartermaster?.on).toBe(false);
    expect(runQuartermaster(w)).toBe(0);
    cmd(sim, { type: 'set_quartermaster', on: true, reserve: 0 });
    expect(runQuartermaster(w)).toBeGreaterThan(0);
    cmd(sim, { type: 'set_quartermaster', on: false });
    expect(runQuartermaster(w)).toBe(0);
  });

  it('runs once per sim second (tick-gated), at most QM_MAX_RANKS_PER_PASS ranks, only between waves and in combat', () => {
    const sim = qm(0);
    const w = sim.world;
    w.run.scrap = 1e9;
    w.run.tick = 1;                                         // not a pass tick
    tick(sim, QM_INTERVAL_TICKS - 1);                       // systems see ticks 1..59
    expect(qmBuys(sim).length).toBe(0);
    tick(sim);                                              // they see tick 60: a pass
    const n = qmBuys(sim).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(QM_MAX_RANKS_PER_PASS);
    tick(sim, QM_INTERVAL_TICKS - 1);
    expect(qmBuys(sim).length).toBe(n);
    sim.machine.setPhase('wave_clear');
    w.run.tick = 0;
    expect(runQuartermaster(w)).toBe(0);
  });

  it('keeps the reserve: never takes Scrap below reserve% of the Scrap on hand', () => {
    for (const reserve of [0, 25, 50, 75]) {
      const sim = qm(reserve);
      const w = sim.world;
      w.run.scrap = 5000;
      for (let k = 0; k < 20; k++) { const s0 = w.run.scrap; runQuartermaster(w); expect(w.run.scrap).toBeGreaterThanOrEqual(s0 * reserve / 100 - 1e-9); }
      // allowance: without new income it never spends more than (100 − reserve)% of what it started with
      expect(5000 - w.run.scrap).toBeLessThanOrEqual(5000 * (1 - reserve / 100) + 1e-9);
      if (reserve === 75) expect(w.run.scrap).toBeGreaterThanOrEqual(3750 - 1e-9);
    }
  });

  it('spends (100 − reserve)% of kill Scrap only; offline Scrap stays the player\'s', () => {
    const sim = qm(50);
    const w = sim.world;
    w.run.scrap = 0;
    runQuartermaster(w);                                    // starts with an empty allowance
    expect(cmd(sim, { type: 'offline_return', elapsedSeconds: 3600 })).toBeNull();
    w.run.scrap += 1e5;                                     // (whatever offline credited plus a lump that is not income)
    expect(runQuartermaster(w)).toBe(0);
    const s0 = w.run.scrap;
    w.addScrap(2000);                                      // kill income
    runQuartermaster(w);
    expect(s0 + 2000 - w.run.scrap).toBeLessThanOrEqual(1000 + 1e-9);
    expect(s0 + 2000 - w.run.scrap).toBeGreaterThan(0);
  });

  it('the Upgrade Queue goes first: the Quartermaster leaves the Scrap its head is saving for', () => {
    const sim = qm(0);
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    w.meta.upgradeQueue = [{ node: 'ballistics.crit_chance', maxRank: 1 }];
    const info = nodeInfo('ballistics.crit_chance');
    expect(info).toBeDefined();
    const price = shopEntryFor(w, 'ballistics.crit_chance')?.cost ?? 0;
    expect(price).toBeGreaterThan(0);
    w.run.scrap = price * 3;
    expect(queueHold(w)).toBe(price);
    for (let k = 0; k < 30; k++) runQuartermaster(w);
    expect(w.run.scrap).toBeGreaterThanOrEqual(price - 1e-9);
  });
});

describe('Quartermaster: order, events, UiState', () => {
  it('goes round-robin over the enabled trees, one rank per tree per round; tree switches are honored', () => {
    const sim = qm(0);
    const w = sim.world;
    w.run.scrap = 1e9;
    cmd(sim, { type: 'set_quartermaster', order: ['bastion', 'ballistics'], trees: { reactor: false } });
    runQuartermaster(w);
    const trees = qmBuys(sim).map((e) => nodeInfo(e.src)!.tree);
    expect(trees.slice(0, 4)).toEqual(['bastion', 'ballistics', 'bastion', 'ballistics']);
    expect(trees).not.toContain('reactor');
  });

  it('Purchase events name the pass event (src quartermaster) as their cause', () => {
    const sim = qm(0);
    const w = sim.world;
    w.run.scrap = 1e6;
    runQuartermaster(w);
    const pass = events(sim, Ev.Quartermaster, 'quartermaster');
    expect(pass.length).toBe(1);
    for (const e of qmBuys(sim)) expect(e.cause).toBe(pass[0].id);
  });

  it('UiState.quartermaster reports switches, order and what was bought this Prestige', () => {
    const sim = qm(25);
    const w = sim.world;
    w.run.scrap = 1e6;
    cmd(sim, { type: 'set_quartermaster', trees: { bastion: false } });
    runQuartermaster(w);
    const q = sim.uiState().quartermaster!;
    expect(q.unlocked && q.on).toBe(true);
    expect(q.reserve).toBe(25);
    expect(q.trees.map((t) => t.tree)).toEqual(['ballistics', 'bastion', 'reactor']);
    expect(q.trees.find((t) => t.tree === 'bastion')).toMatchObject({ on: false, bought: 0 });
    expect(q.boughtThisRun).toBe(qmBuys(sim).length);
    expect(q.trees.reduce((a, t) => a + t.bought, 0)).toBe(q.boughtThisRun);
    expect(q.scrapSpentThisRun).toBeCloseTo(qmBuys(sim).reduce((a, e) => a + e.b, 0), 6);
  });

  it('rejects malformed patches (unknown tree, reserve not offered, element trees)', () => {
    const sim = qm(0);
    expect(cmd(sim, { type: 'set_quartermaster', reserve: 33 })).toMatch(/Reserve/);
    expect(cmd(sim, { type: 'set_quartermaster', trees: { fire: true } })).toMatch(/does not buy/);
    expect(cmd(sim, { type: 'set_quartermaster', order: ['nope' as TreeId] })).toMatch(/does not buy/);
    expect(cmd(sim, { type: 'set_quartermaster', on: 'yes' as unknown as boolean })).toMatch(/Malformed/);
  });
});

describe('Quartermaster: determinism and saves', () => {
  function played(seed: number, on: boolean): Sim {
    const base = new Sim(null, seed).save();
    base.meta.prestigeCount = 1;
    const sim = new Sim(base);
    if (on) expect(sim.command({ type: 'set_quartermaster', on: true, reserve: 25 })).toBeUndefined();
    sim.run(60 * 240);
    return sim;
  }
  it('same seed → identical event hash with the Quartermaster on (and it did act)', () => {
    const a = played(3, true), b = played(3, true), off = played(3, false);
    expect(a.events.hash()).toBe(b.events.hash());
    expect(a.world.run.quartermaster?.spent ?? 0).toBeGreaterThan(0);
    expect(a.events.hash()).not.toBe(off.events.hash());
  });

  it('a version-1 save (no Quartermaster settings) migrates with it off and never auto-buys', () => {
    const v1 = JSON.parse(JSON.stringify(new Sim(null, 5).save())) as SaveState;
    v1.version = 1;
    v1.meta.prestigeCount = 3;
    delete (v1.meta.settings as Record<string, unknown>).quartermaster;
    const m = migrate(v1);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.meta.settings.quartermaster).toEqual({ on: false, reserve: 25, trees: {}, order: [] });
    const sim = Sim.load(v1);
    sim.world.run.scrap = 1e6;
    sim.world.run.phase = 'between';
    expect(runQuartermaster(sim.world)).toBe(0);
  });

  it('settings round-trip through a save; junk is repaired', () => {
    const sim = qm(50);
    cmd(sim, { type: 'set_quartermaster', trees: { ballistics: false }, order: ['reactor'] });
    const loaded = Sim.load(sim.save());
    expect(loaded.world.meta.settings.quartermaster).toEqual({ on: true, reserve: 50, trees: { ballistics: false }, order: ['reactor'] });
    expect(sanitizeQuartermaster({ on: 1, reserve: 33, trees: { fire: true, blade: false, x: 1 }, order: ['blade', 'blade', 'frost', 7] }))
      .toEqual({ on: false, reserve: 25, trees: { blade: false }, order: ['blade'] });
    expect(sanitizeQuartermaster(null)).toEqual({ on: false, reserve: 25, trees: {}, order: [] });
  });
});
