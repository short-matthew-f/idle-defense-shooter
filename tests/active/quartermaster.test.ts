import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Sim } from '../../src/sim/index';
import type { SaveState } from '../../src/sim/core/types';
import { Ev, SAVE_VERSION } from '../../src/sim/core/types';
import type { TreeId } from '../../src/sim/core/ids';
import { allNodes, nodeInfo, treeDef } from '../../src/sim/core/content';
import { buildShop } from '../../src/sim/economy/shop';
import { REFIT_REFUND } from '../../src/sim/economy/curves';
import { migrate } from '../../src/sim/save/serialize';
import { startFresh } from '../../src/sim/run/prestige';
import { findActive } from '../../src/sim/systems/active';
import { Prng } from '../../src/sim/math/prng';
import {
  QM_DEFAULT_SHARE, QM_INTERVAL_TICKS, QM_MAX_RANKS_PER_PASS, QM_SHARES, QM_TREES, quartermasterNode, runQuartermaster,
  sanitizeQuartermaster, shareFromReserve,
} from '../../src/sim/directives/quartermaster';
import { arena, cmd, events, tick, unlock } from './helpers';

type S = ReturnType<typeof arena>;

/** Arena between waves, after one Prestige, Quartermaster on with `share`. */
function qm(share = 50, seed = 1): S {
  const sim = arena(seed);
  sim.world.meta.prestigeCount = 1;
  sim.machine.setPhase('between');
  expect(cmd(sim, { type: 'set_quartermaster', on: true, share })).toBeNull();
  return sim;
}
const qmBuys = (sim: S) => events(sim, Ev.Purchase).filter((e) => e.data?.via === 'quartermaster');
const bank = (sim: S): number => sim.world.run.quartermaster?.bank ?? 0;
const spentTotal = (sim: S): number => Object.values(sim.world.run.spentByTree).reduce((a, v) => a + v, 0);
/** Fill the bank (tests only: as if income had been diverted). */
function fund(sim: S, amount: number): void { sim.world.run.quartermaster!.bank += amount; }

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
  fund(sim, 1e12);
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

  it('over the whole live shop it only ever buys stat entries and never touches choices, Cores or the player\'s Scrap', () => {
    const sim = qm(100);
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
    expect(w.run.scrap).toBe(1e12);                       // paid from the bank only
    expect(bank(sim)).toBeCloseTo(1e12 - w.run.quartermaster!.spent, 0);
    expect(JSON.stringify({ hp: w.build.hardpoints, at: w.build.attunements, d: w.build.doctrines, d2: w.build.secondDoctrines, an: w.build.anomalies, ab: w.build.abilities, boons: w.build.boons })).toBe(before);
    for (const info of allNodes()) if (!quartermasterNode(info) && info.group !== 'prestige' && info.group !== 'star') {
      const shared = info.group === 'tree' && info.shared && info.def.kind === 'stat';
      expect(w.build.ranks[info.def.id] ?? 0, info.def.id).toBe(shared ? 1 : 0);
    }
  });

  it('buys in a Doctrine\'s stat nodes only once that Doctrine was chosen, and never in element trees', () => {
    const sim = qm(50);
    everything(sim);
    const w = sim.world;
    for (let k = 0; k < 40; k++) runQuartermaster(w);
    const trees = new Set(qmBuys(sim).map((e) => nodeInfo(e.src)!.tree));
    for (const t of ['fire', 'lightning', 'poison', 'frost']) expect(trees.has(t as TreeId)).toBe(false);
    for (const e of qmBuys(sim)) { const i = nodeInfo(e.src)!; if (i.doctrine) expect(w.build.doctrines[i.tree!]).toBe(i.doctrine); }
  });
});

describe('Quartermaster: the bank', () => {
  it('share 50 splits a 100 Scrap income 50 / 50; scrapEarned and waveScrap count the gross', () => {
    for (const share of QM_SHARES) {
      const sim = qm(share);
      const w = sim.world;
      const s0 = w.run.scrap, e0 = w.scrapEarned, v0 = w.waveScrap;
      w.addScrap(100);
      expect(bank(sim)).toBeCloseTo(share, 9);
      expect(w.run.scrap - s0).toBeCloseTo(100 - share, 9);
      expect(w.scrapEarned - e0).toBe(100);
      expect(w.waveScrap - v0).toBe(100);
    }
  });

  it('a kill and a salvage crate are split; their gross is what the events and scrapEarned report', () => {
    const sim = qm(50);
    const w = sim.world;
    sim.machine.setPhase('combat');
    w.run.tick = 1;                                          // keep passes away (they would spend the bank)
    const i = w.spawnEnemy('grunt', 200, 0, { hpScale: 1 });
    const s0 = w.run.scrap, b0 = bank(sim), e0 = w.scrapEarned;
    w.killEnemy(i, -1, 'ballistics');
    const gross = w.scrapEarned - e0;
    expect(gross).toBeGreaterThan(0);
    expect(bank(sim) - b0).toBeCloseTo(gross / 2, 9);
    expect(w.run.scrap - s0).toBeCloseTo(gross / 2, 9);
    // salvage crate (tap)
    const act = findActive(w)!;
    const k = act.addCrate(w, 0, 300, 400);
    const s1 = w.run.scrap, b1 = bank(sim);
    cmd(sim, { type: 'collect_salvage', x: act.crateX[k], y: act.crateY[k] });
    tick(sim, 2);
    const paid = events(sim, Ev.SalvageCollect).at(-1)!;
    expect(paid.a).toBeCloseTo(400, 6);
    expect(bank(sim) - b1).toBeCloseTo(200, 6);
    expect(w.run.scrap - s1).toBeCloseTo(200, 6);
  });

  it('Seed Capital, the Checkpoint Dividend perk, offline return and Refit refunds are never split', () => {
    const sim = qm(100);
    const w = sim.world, meta = w.meta;
    // Seed Capital bought mid-run (economy/prestige.ts grantStartBonus)
    meta.deepestEver = 28; meta.echoes = 100;
    let s0 = w.run.scrap;
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.seed_capital' })).toBeNull();
    expect(w.run.scrap).toBe(s0 + 400);
    expect(bank(sim)).toBe(0);
    // Seed Capital at a run start (run/prestige.ts applyRunStart)
    startFresh(sim.machine, 77, 'standard', {});
    expect(w.run.scrap).toBe(400);
    expect(bank(sim)).toBe(0);
    // Checkpoint Dividend (a Prestige perk: addScrap(bonus, false))
    unlock(sim, 'prestige.checkpoint_dividend');
    expect(w.stats.get('prestige.checkpoint_dividend')).toBeGreaterThan(0);
    w.run.phase = 'combat'; w.run.tick = 1;
    w.waveScrap = 1000;
    s0 = w.run.scrap;
    const e0 = w.scrapEarned;
    w.emit(Ev.Checkpoint, 'run', 5, 0, 0, 0, -1);
    tick(sim);
    const div = events(sim, Ev.ScrapGain, 'checkpoint_dividend').at(-1)!;
    expect(div.b).toBeGreaterThan(0);
    expect(w.run.scrap - s0).toBeCloseTo(div.b, 9);
    expect(w.scrapEarned - e0).toBeCloseTo(div.b, 9);
    expect(bank(sim)).toBe(0);
    // offline return (run/commands.ts)
    w.run.patrolScrapPerSecond = 10;
    s0 = w.run.scrap;
    expect(cmd(sim, { type: 'offline_return', elapsedSeconds: 3600 })).toBeNull();
    expect(w.run.scrap).toBeGreaterThan(s0);
    expect(bank(sim)).toBe(0);
    // Refit refund
    w.build.hardpoints = ['ordnance']; w.run.hardpointSlotsOpen = 1; w.run.cores = 100; w.run.spentByTree.ordnance = 1000;
    w.rebuildStats();
    s0 = w.run.scrap;
    expect(cmd(sim, { type: 'refit_hardpoint', slot: 0, system: 'drones' })).toBeNull();
    expect(w.run.scrap - s0).toBe(Math.floor(1000 * REFIT_REFUND));
    expect(bank(sim)).toBe(0);
  });

  it('every addScrap caller is accounted for (divert unless a Prestige perk); no other income path calls it', () => {
    const files: string[] = [];
    const walk = (d: string): void => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    walk('src/sim');
    const calls: string[] = [];
    for (const f of files) readFileSync(f, 'utf8').split('\n').forEach((l) => { const m = /\.addScrap\(([^)]*)\)/.exec(l); if (m && !/^\s*(\*|\/\/)/.test(l)) calls.push(`${f.replace(/\\/g, '/')}: ${m[1]}`); });
    expect(calls.sort()).toEqual([
      'src/sim/core/world-impl.ts: scrap',                   // kills (finishKill)
      'src/sim/run/prestige.ts: bonus, false',               // Checkpoint Dividend perk: the player's
      'src/sim/systems/active.ts: amount',                   // salvage crates
      'src/sim/systems/reactor.ts: amount',                  // Reactor dividend
    ]);
  });

  it('the player\'s own buys never touch the bank, and the Quartermaster pays only from it', () => {
    const sim = qm(50);
    const w = sim.world;
    w.run.scrap = 1e6;
    expect(cmd(sim, { type: 'buy', node: 'ballistics.damage', count: 3 })).toBeNull();
    expect(bank(sim)).toBe(0);
    const s0 = w.run.scrap;
    expect(runQuartermaster(w)).toBe(0);                    // empty bank: buys nothing, whatever the player holds
    expect(w.run.scrap).toBe(s0);
    fund(sim, 5000);
    expect(runQuartermaster(w)).toBeGreaterThan(0);
    expect(w.run.scrap).toBe(s0);
    expect(bank(sim)).toBeCloseTo(5000 - w.run.quartermaster!.spent, 9);
    expect(bank(sim)).toBeGreaterThanOrEqual(0);
  });

  it('switching off releases the bank at once and stops diversion; changing the share keeps it', () => {
    const sim = qm(50);
    const w = sim.world;
    w.run.tick = 1;
    w.addScrap(1000);
    expect(bank(sim)).toBe(500);
    expect(cmd(sim, { type: 'set_quartermaster', share: 25 })).toBeNull();
    expect(bank(sim)).toBe(500);
    w.addScrap(1000);
    expect(bank(sim)).toBe(750);
    const s0 = w.run.scrap;
    expect(cmd(sim, { type: 'set_quartermaster', on: false })).toBeNull();
    expect(bank(sim)).toBe(0);
    expect(w.run.scrap).toBe(s0 + 750);
    expect(events(sim, Ev.Quartermaster, 'quartermaster.release').at(-1)!.a).toBe(750);
    w.addScrap(1000);
    expect(bank(sim)).toBe(0);
    expect(w.run.scrap).toBe(s0 + 1750);
    expect(sim.uiState().quartermaster).toMatchObject({ on: false, bank: 0, idle: false, share: 25 });
  });

  it('every tree off, or nothing left it could ever buy, is idle: the bank is released and diversion pauses until something is buyable', () => {
    const sim = qm(50);
    const w = sim.world;
    w.run.tick = 1;
    w.addScrap(1000);
    const s0 = w.run.scrap;
    expect(cmd(sim, { type: 'set_quartermaster', trees: { ballistics: false, bastion: false, reactor: false } })).toBeNull();
    expect(bank(sim)).toBe(0);
    expect(w.run.scrap).toBe(s0 + 500);
    expect(sim.uiState().quartermaster?.idle).toBe(true);
    w.addScrap(100);
    expect(bank(sim)).toBe(0);
    expect(cmd(sim, { type: 'set_quartermaster', trees: { ballistics: true } })).toBeNull();
    expect(sim.uiState().quartermaster?.idle).toBe(false);
    w.addScrap(100);
    expect(bank(sim)).toBe(50);
    // every Ballistics stat ramp at max rank: nothing it could ever buy (NOT merely unaffordable)
    const ramps = allNodes().filter((i) => quartermasterNode(i) && i.tree === 'ballistics');
    for (const i of ramps) w.build.ranks[i.def.id] = i.def.maxRank;
    w.rebuildStats();
    const s1 = w.run.scrap;
    expect(runQuartermaster(w)).toBe(0);
    expect(w.run.quartermaster!.idle).toBe(true);
    expect(bank(sim)).toBe(0);
    expect(w.run.scrap).toBe(s1 + 50);
    w.addScrap(100);
    expect(bank(sim)).toBe(0);
    // something buyable again (one rank below max) → the next pass resumes diversion
    w.build.ranks[ramps[0].def.id] = ramps[0].def.maxRank - 1;
    w.rebuildStats();
    runQuartermaster(w);
    expect(w.run.quartermaster!.idle).toBe(false);
    w.addScrap(100);
    expect(bank(sim)).toBe(50);
    // an empty bank with buyable ranks is NOT idle (merely unaffordable)
    const sim2 = qm(50);
    runQuartermaster(sim2.world);
    expect(sim2.world.run.quartermaster!.idle).toBe(false);
  });

  it('a death or restart keeps the bank; a new run (Prestige / Ascension) starts it empty; a Trial parks it with the main run', () => {
    const sim = qm(50);
    const w = sim.world;
    w.run.tick = 1;
    w.addScrap(1000);
    sim.machine.startAttempt(true);
    expect(bank(sim)).toBe(500);
    expect(cmd(sim, { type: 'restart_checkpoint' })).toBeNull();
    expect(bank(sim)).toBe(500);
    unlock(sim, 'prestige.trials');
    expect(cmd(sim, { type: 'start_trial', trial: 'bare_metal' })).toBeNull();
    expect(bank(sim)).toBe(0);                               // the Trial is a fresh run
    expect(sim.world.meta.parkedRun?.quartermaster?.bank).toBe(500);
    expect(cmd(sim, { type: 'end_trial' })).toBeNull();
    expect(bank(sim)).toBe(500);                             // the main run resumes with its bank
    startFresh(sim.machine, 99, 'standard', {});
    expect(bank(sim)).toBe(0);
    expect(sim.world.run.quartermaster?.spent ?? 0).toBe(0);
  });
});

describe('Quartermaster: conservation (property tests)', () => {
  /** Random income, passes, player buys and switches; checks the books after every step. */
  function fuzz(seed: number, steps: number): void {
    const rng = new Prng(seed);
    const sim = qm(QM_SHARES[rng.int(0, QM_SHARES.length - 1)], seed);
    const w = sim.world;
    w.run.scrap = rng.range(0, 2000);
    let income = w.run.scrap + bank(sim) + spentTotal(sim);   // the books start balanced
    const nodes = allNodes().filter((i) => i.tree === 'ballistics' || i.tree === 'bastion' || i.tree === 'reactor').map((i) => i.def.id);
    for (let k = 0; k < steps; k++) {
      const op = rng.int(0, 9);
      const wallet0 = w.run.scrap, bank0 = bank(sim);
      if (op <= 3) {
        const amount = rng.next() < 0.1 ? rng.range(1e4, 1e6) : rng.range(0, 500);
        const divert = rng.next() < 0.85;
        w.addScrap(amount, divert);
        income += amount;
        expect(w.run.scrap).toBeGreaterThanOrEqual(wallet0);
        if (!divert) expect(bank(sim)).toBe(bank0);
      } else if (op <= 6) {
        runQuartermaster(w);
        expect(w.run.scrap).toBeGreaterThanOrEqual(wallet0);   // (b) the Quartermaster never takes the player's Scrap
      } else if (op === 7) {
        cmd(sim, { type: 'buy', node: nodes[rng.int(0, nodes.length - 1)], count: rng.int(1, 3) });
        expect(bank(sim)).toBe(bank0);                       // the player's buys never touch the bank
      } else if (op === 8) {
        const r = rng.int(0, 3);
        if (r === 0) cmd(sim, { type: 'set_quartermaster', on: !w.meta.settings.quartermaster!.on });
        else if (r === 1) cmd(sim, { type: 'set_quartermaster', share: QM_SHARES[rng.int(0, QM_SHARES.length - 1)] });
        else cmd(sim, { type: 'set_quartermaster', trees: { [QM_TREES[rng.int(0, 2)]]: rng.next() < 0.6 } });
        expect(w.run.scrap).toBeGreaterThanOrEqual(wallet0);
      } else {
        w.run.tick += rng.int(1, 120);
      }
      // (a) nothing created or destroyed: wallet + bank + everything spent = start + income
      const books = w.run.scrap + bank(sim) + spentTotal(sim);
      expect(Math.abs(books - income)).toBeLessThanOrEqual(1e-9 * Math.max(1, income));
      expect(bank(sim)).toBeGreaterThanOrEqual(0);
    }
    expect(qmBuys(sim).length).toBeGreaterThan(0);
  }
  for (const seed of [1, 2, 3, 4, 5, 6]) it(`seed ${seed}: wallet + bank + spent conserves all income; the wallet never drops because of it`, () => fuzz(seed, 600));
});

describe('Quartermaster: gates', () => {
  it('is locked before the first Prestige: the command is rejected, a forced setting neither banks nor buys', () => {
    const sim = arena();
    const w = sim.world;
    sim.machine.setPhase('between');
    w.run.scrap = 1e6;
    expect(cmd(sim, { type: 'set_quartermaster', on: true })).toMatch(/first Prestige/);
    w.meta.settings.quartermaster = { on: true, share: 100, trees: {}, order: [] };   // a hand-edited save
    const s0 = w.run.scrap;
    w.addScrap(100);
    expect(w.run.scrap).toBe(s0 + 100);
    expect(bank(sim)).toBe(0);
    expect(runQuartermaster(w)).toBe(0);
    expect(sim.uiState().quartermaster?.unlocked).toBe(false);
    w.meta.prestigeCount = 1;
    w.addScrap(1e5);
    expect(bank(sim)).toBe(1e5);
    expect(runQuartermaster(w)).toBeGreaterThan(0);
  });

  it('is off by default (default share 50) and buys nothing while off', () => {
    const sim = arena();
    const w = sim.world;
    w.meta.prestigeCount = 2;
    sim.machine.setPhase('between');
    w.run.scrap = 1e6;
    expect(w.meta.settings.quartermaster).toEqual({ on: false, share: QM_DEFAULT_SHARE, trees: {}, order: [] });
    expect(QM_DEFAULT_SHARE).toBe(50);
    expect(runQuartermaster(w)).toBe(0);
    cmd(sim, { type: 'set_quartermaster', on: true, share: 100 });
    w.addScrap(1e5);
    expect(runQuartermaster(w)).toBeGreaterThan(0);
    cmd(sim, { type: 'set_quartermaster', on: false });
    w.addScrap(1e5);
    expect(runQuartermaster(w)).toBe(0);
  });

  it('runs once per sim second (tick-gated), at most QM_MAX_RANKS_PER_PASS ranks, only between waves and in combat', () => {
    const sim = qm(50);
    const w = sim.world;
    fund(sim, 1e9);
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

  it('the Upgrade Queue spends the player\'s Scrap and never the bank', () => {
    const sim = qm(50);
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    w.meta.upgradeQueue = [{ node: 'bastion.max_hp', maxRank: 3 }];
    fund(sim, 1234);
    w.run.scrap = 1e6;
    w.run.tick = 1;
    tick(sim, 30);
    expect(w.build.ranks['bastion.max_hp'] ?? 0).toBeGreaterThan(0);
    expect(bank(sim)).toBe(1234);
  });
});

describe('Quartermaster: order, events, UiState', () => {
  it('goes round-robin over the enabled trees, one rank per tree per round; tree switches are honored', () => {
    const sim = qm(50);
    const w = sim.world;
    cmd(sim, { type: 'set_quartermaster', order: ['bastion', 'ballistics'], trees: { reactor: false } });
    fund(sim, 1e9);
    runQuartermaster(w);
    const trees = qmBuys(sim).map((e) => nodeInfo(e.src)!.tree);
    expect(trees.slice(0, 4)).toEqual(['bastion', 'ballistics', 'bastion', 'ballistics']);
    expect(trees).not.toContain('reactor');
  });

  it('Purchase events name the pass event (src quartermaster, a = bank, b = share) as their cause', () => {
    const sim = qm(75);
    const w = sim.world;
    fund(sim, 1e6);
    runQuartermaster(w);
    const pass = events(sim, Ev.Quartermaster, 'quartermaster');
    expect(pass.length).toBe(1);
    expect(pass[0].a).toBe(1e6);
    expect(pass[0].b).toBe(75);
    for (const e of qmBuys(sim)) expect(e.cause).toBe(pass[0].id);
  });

  it('UiState.quartermaster reports share, bank, idle, switches, order and what was bought this Prestige', () => {
    const sim = qm(25);
    const w = sim.world;
    cmd(sim, { type: 'set_quartermaster', trees: { bastion: false } });
    fund(sim, 1e6);
    runQuartermaster(w);
    const q = sim.uiState().quartermaster!;
    expect(q.unlocked && q.on).toBe(true);
    expect(q.share).toBe(25);
    expect(q.idle).toBe(false);
    expect(q.bank).toBeCloseTo(1e6 - q.scrapSpentThisRun, 6);
    expect(q.trees.map((t) => t.tree)).toEqual(['ballistics', 'bastion', 'reactor']);
    expect(q.trees.find((t) => t.tree === 'bastion')).toMatchObject({ on: false, bought: 0 });
    expect(q.boughtThisRun).toBe(qmBuys(sim).length);
    expect(q.trees.reduce((a, t) => a + t.bought, 0)).toBe(q.boughtThisRun);
    expect(q.scrapSpentThisRun).toBeCloseTo(qmBuys(sim).reduce((a, e) => a + e.b, 0), 6);
  });

  it('rejects malformed patches (unknown tree, share not offered, element trees, the old reserve field is ignored)', () => {
    const sim = qm(50);
    expect(cmd(sim, { type: 'set_quartermaster', share: 33 })).toMatch(/Share/);
    expect(cmd(sim, { type: 'set_quartermaster', share: 0 })).toMatch(/Share/);
    expect(cmd(sim, { type: 'set_quartermaster', trees: { fire: true } })).toMatch(/does not buy/);
    expect(cmd(sim, { type: 'set_quartermaster', order: ['nope' as TreeId] })).toMatch(/does not buy/);
    expect(cmd(sim, { type: 'set_quartermaster', on: 'yes' as unknown as boolean })).toMatch(/Malformed/);
    expect(cmd(sim, { type: 'set_quartermaster', share: 2.5 })).toMatch(/Malformed/);
    expect(sim.world.meta.settings.quartermaster?.share).toBe(50);
  });
});

describe('Quartermaster: determinism and saves', () => {
  function played(seed: number, on: boolean): Sim {
    const base = new Sim(null, seed).save();
    base.meta.prestigeCount = 1;
    const sim = new Sim(base);
    if (on) expect(sim.command({ type: 'set_quartermaster', on: true, share: 50 })).toBeUndefined();
    sim.run(60 * 240);
    return sim;
  }
  it('same seed → identical event hash with the Quartermaster on (and it did act)', () => {
    const a = played(3, true), b = played(3, true), off = played(3, false);
    expect(a.events.hash()).toBe(b.events.hash());
    expect(a.world.run.quartermaster?.spent ?? 0).toBeGreaterThan(0);
    expect(a.world.run.quartermaster?.bank).toBe(b.world.run.quartermaster?.bank);
    expect(a.events.hash()).not.toBe(off.events.hash());
  });

  it('the bank and this run\'s bookkeeping survive a save / load (and a Trial\'s parked run)', () => {
    const sim = qm(50);
    const w = sim.world;
    w.run.tick = 1;
    w.addScrap(1e5);
    runQuartermaster(w);
    const st = { ...w.run.quartermaster!, bought: { ...w.run.quartermaster!.bought } };
    expect(st.bank).toBeGreaterThan(0);
    expect(st.spent).toBeGreaterThan(0);
    const save = sim.save();
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.run.quartermaster).toEqual(st);
    const loaded = Sim.load(JSON.parse(JSON.stringify(save)) as SaveState);
    expect(loaded.world.run.quartermaster).toEqual(st);
    expect(loaded.uiState().quartermaster?.bank).toBe(st.bank);
    // junk is repaired
    const bad = JSON.parse(JSON.stringify(save)) as SaveState;
    (bad.run as unknown as Record<string, unknown>).quartermaster = { bank: Number.NaN, idle: 'x', bought: { ballistics: -2, fire: 3, bastion: 2.7 }, spent: -5 };
    expect(Sim.load(bad).world.run.quartermaster).toEqual({ bank: 0, idle: false, bought: { bastion: 2 }, spent: 0 });
    (bad.run as unknown as Record<string, unknown>).quartermaster = 'lots';
    expect(Sim.load(bad).world.run.quartermaster).toBeUndefined();
  });

  it('a version-2 save (legacy reserve) migrates: share = the option nearest 100 − reserve, on/trees/order kept, bank empty', () => {
    // a v2 fixture: the shape v2 wrote (settings.quartermaster with `reserve`, no run state)
    const v2 = JSON.parse(JSON.stringify(new Sim(null, 6).save())) as SaveState;
    v2.version = 2;
    v2.meta.prestigeCount = 2;
    (v2.meta.settings as Record<string, unknown>).quartermaster = { on: true, reserve: 25, trees: { bastion: false }, order: ['reactor'] };
    delete (v2.run as unknown as Record<string, unknown>).quartermaster;
    const m = migrate(v2);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.meta.settings.quartermaster).toEqual({ on: true, share: 75, trees: { bastion: false }, order: ['reactor'] });
    expect([0, 25, 50, 75].map(shareFromReserve)).toEqual([100, 75, 50, 25]);
    expect(shareFromReserve(90)).toBe(10);
    expect(shareFromReserve(undefined)).toBe(QM_DEFAULT_SHARE);
    const sim = Sim.load(v2);
    expect(sim.world.run.quartermaster?.bank ?? 0).toBe(0);
    const s0 = sim.world.run.scrap;
    sim.world.addScrap(100);
    expect(sim.world.run.quartermaster!.bank).toBe(75);
    expect(sim.world.run.scrap).toBe(s0 + 25);
  });

  it('a version-1 save (no Quartermaster settings) migrates with it off and never auto-buys', () => {
    const v1 = JSON.parse(JSON.stringify(new Sim(null, 5).save())) as SaveState;
    v1.version = 1;
    v1.meta.prestigeCount = 3;
    delete (v1.meta.settings as Record<string, unknown>).quartermaster;
    const m = migrate(v1);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.meta.settings.quartermaster).toEqual({ on: false, share: 50, trees: {}, order: [] });
    const sim = Sim.load(v1);
    sim.world.run.scrap = 1e6;
    sim.world.run.phase = 'between';
    sim.world.addScrap(100);
    expect(sim.world.run.quartermaster?.bank ?? 0).toBe(0);
    expect(runQuartermaster(sim.world)).toBe(0);
  });

  it('settings round-trip through a save; junk is repaired', () => {
    const sim = qm(10);
    cmd(sim, { type: 'set_quartermaster', trees: { ballistics: false }, order: ['reactor'] });
    const loaded = Sim.load(sim.save());
    expect(loaded.world.meta.settings.quartermaster).toEqual({ on: true, share: 10, trees: { ballistics: false }, order: ['reactor'] });
    expect(sanitizeQuartermaster({ on: 1, share: 33, trees: { fire: true, blade: false, x: 1 }, order: ['blade', 'blade', 'frost', 7] }))
      .toEqual({ on: false, share: 50, trees: { blade: false }, order: ['blade'] });
    expect(sanitizeQuartermaster(null)).toEqual({ on: false, share: 50, trees: {}, order: [] });
  });
});
