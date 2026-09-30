/**
 * Boons (docs/BOONS.md): attempt-scoped rewards. Offers, lifetime, commands, stat and mechanical effects,
 * save/load, determinism and malformed commands.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import type { Command } from '../../src/sim/core/types';
import type { BoonId } from '../../src/sim/core/ids';
import type { System } from '../../src/sim/core/system';
import { Ev, EnemyFlag } from '../../src/sim/core/types';
import { BOONS, BOON_CAP, BOON_QUEUE_CAP, BOON_TUNING as T } from '../../src/sim/data/boons';
import { rollBoons, boonRerollCost, isBoonCommand, offerForBossClear } from '../../src/sim/run/boons';
import { validateCommand } from '../../src/sim/run/validate';
import { applyCommand } from '../../src/sim/run/commands';
import { Prng } from '../../src/sim/math/prng';
import { strongSim, runUntil, combatTick } from './helpers';

const MIN = 3600;
const cmd = (sim: Sim, c: Command): string | null => applyCommand(sim.machine, c);
const offer = (sim: Sim): BoonId[] | null => sim.world.run.boonOffer;
const boonEvents = (sim: Sim, id: string): number => sim.events.recent(0).filter((e) => e.type === Ev.Anomaly && e.src === `boon.${id}`).length;

/** Put exactly these boons on offer (test shortcut for a rolled offer). */
function forceOffer(sim: Sim, ids: BoonId[]): void { sim.world.run.boonOffer = [...ids]; }
/** Activate boons directly (mechanics tests). */
function activate(sim: Sim, ...ids: BoonId[]): void { sim.world.build.boons.push(...ids); sim.world.rebuildStats(); }
function boonsSystem(sim: Sim): System { return sim.plugins.find((p) => p.id === 'boons')!; }

/** Fresh Sim with an empty field that never spawns (combat systems advance via combatTick). */
function calm(seed = 1): Sim {
  const sim = new Sim(null, seed);
  sim.world.clearCombat();
  sim.world.run.phase = 'wave_clear';
  sim.world.meta.codex = {};
  return sim;
}
function tough(sim: Sim, x: number, y: number, hp = 1e6, kind = 'grunt', opts: Record<string, unknown> = {}): number {
  const w = sim.world;
  const i = w.spawnEnemy(kind, x, y, { cause: -1, ...opts });
  w.enemies.hp[i] = w.enemies.maxHp[i] = hp;
  w.enemies.armor[i] = 0; w.enemies.shield[i] = 0;
  w.rebuildSpatial();
  return i;
}
/** Die now and step into the next attempt. */
function die(sim: Sim): void {
  const run = sim.world.run;
  runUntil(sim, () => run.phase === 'combat', MIN);
  sim.world.damageTower(1e15, -1, -1);
  sim.step();
  runUntil(sim, () => run.phase === 'between', 400);
}

// ---------------------------------------------------------------- content
describe('boon content', () => {
  it('has about 36 boons in four categories with unique ids and short lines', () => {
    const by = (c: string): number => BOONS.filter((b) => b.category === c).length;
    expect(BOONS.length).toBe(36);
    expect([by('surge'), by('twist'), by('trade'), by('wild')]).toEqual([12, 12, 8, 4]);
    expect(new Set(BOONS.map((b) => b.id)).size).toBe(BOONS.length);
    for (const b of BOONS) {
      expect(b.short.length, b.id).toBeLessThanOrEqual(34);
      expect(b.desc.length, b.id).toBeGreaterThan(10);
      expect(b.effects.length > 0 || !!b.flag, `${b.id} has an effect or a mechanic`).toBe(true);
      expect(b.value).toBeGreaterThanOrEqual(1);
      expect(b.value).toBeLessThanOrEqual(5);
    }
  });
  it('descriptions quote the tuned numbers', () => {
    const d = (id: BoonId): string => BOONS.find((b) => b.id === id)!.desc;
    expect(d('overcharge')).toContain(`+${T.overcharge.damage * 100}%`);
    expect(d('volatile_kills')).toContain(`${T.volatile_kills.fraction * 100}%`);
    expect(d('glass_hour')).toContain(`+${T.glass_hour.damage * 100}%`);
    expect(d('trophy_hunter')).toContain(`+${T.trophy_hunter.max * 100}%`);
  });
});

// ---------------------------------------------------------------- offers
describe('boon offers', () => {
  it('no offer on the first attempt of a Prestige; a start offer after a death and after a restart', () => {
    const sim = new Sim(null, 3);
    expect(sim.world.run.attempts).toBe(1);
    expect(offer(sim)).toBeNull();
    die(sim);
    expect(offer(sim)?.length).toBe(3);
    expect(sim.world.run.boonOfferKind).toBe('start');
    expect(cmd(sim, { type: 'decline_boon' })).toBeNull();
    expect(cmd(sim, { type: 'restart_checkpoint' })).toBeNull();
    expect(offer(sim)?.length).toBe(3);
  });

  it('the first offer of a Prestige draws only stat surges', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const sim = new Sim(null, seed);
      cmd(sim, { type: 'restart_checkpoint' });
      const o = offer(sim)!;
      expect(o.every((id) => BOONS.find((b) => b.id === id)!.category === 'surge')).toBe(true);
    }
  });

  it('offers are a pure function of (seed, wave, attempt, rerolls, build)', () => {
    const a = new Sim(null, 11), b = new Sim(null, 11);
    const r1 = rollBoons(a.world, 7, 3, 0, 'start', false), r2 = rollBoons(b.world, 7, 3, 0, 'start', false);
    expect(r1).toEqual(r2);
    expect(rollBoons(a.world, 7, 3, 0, 'start', false)).toEqual(r1);   // no hidden state
    const differs = [1, 2, 3, 4].some((k) => rollBoons(a.world, 7, 3, k, 'start', false).join() !== r1.join());
    expect(differs).toBe(true);
    expect(rollBoons(a.world, 12, 3, 0, 'start', false).join() !== r1.join() || rollBoons(a.world, 7, 4, 0, 'start', false).join() !== r1.join()).toBe(true);
    const c = new Sim(null, 12);
    expect([5, 6, 7, 8, 9].some((wv) => rollBoons(c.world, wv, 3, 0, 'start', false).join() !== rollBoons(a.world, wv, 3, 0, 'start', false).join())).toBe(true);
  });

  it('build-aware: never an active boon, at most one card the build lacks, never three of one category', () => {
    const sim = new Sim(null, 5);
    const w = sim.world;
    w.build.attunements = ['fire']; w.build.hardpoints = ['drones'];
    w.run.hardpointSlotsOpen = 1; w.run.attunementSlotsOpen = 1;
    w.build.boons = ['overcharge', 'miser'];
    w.rebuildStats();
    let fitting = 0, total = 0;
    for (let k = 0; k < 300; k++) {
      const o = rollBoons(w, 5 + (k % 40), k, k % 3, k % 2 ? 'boss' : 'start', false);
      expect(o.length).toBe(3);
      expect(new Set(o).size).toBe(3);
      expect(o.includes('overcharge') || o.includes('miser')).toBe(false);
      const defs = o.map((id) => BOONS.find((b) => b.id === id)!);
      const lacking = defs.filter((d) => d.needs && !d.needs.every((n) => n === 'fire' || n === 'drones')).length;
      expect(lacking).toBeLessThanOrEqual(1);
      expect(new Set(defs.map((d) => d.category)).size).toBeGreaterThan(1);
      for (const d of defs) { total++; if (d.needs && d.needs.every((n) => n === 'fire' || n === 'drones')) fitting++; }
    }
    // weighting: the two boons this build fits (Wildfire Seed, Rally Drones) show up far above their 2/36 share
    expect(fitting / total).toBeGreaterThan(2 / 36 * 1.5);
  });

  it('a boss clear offers boons (kind boss); another boss while one is pending queues (cap 3, oldest dropped)', () => {
    const sim = strongSim(2);
    const run = sim.world.run;
    runUntil(sim, () => run.deepestCleared >= 5, 12 * MIN);
    expect(offer(sim)?.length).toBe(3);
    expect(run.boonOfferKind).toBe('boss');
    expect(run.boonOfferWave).toBe(5);
    const first = [...offer(sim)!];
    for (const wv of [10, 15, 20, 25]) offerForBossClear(sim.world, wv);
    expect(run.boonQueue).toEqual([15, 20, 25]);
    expect(run.boonQueue.length).toBe(BOON_QUEUE_CAP);
    expect(offer(sim)).toEqual(first);   // the pending one is untouched
    expect(cmd(sim, { type: 'decline_boon' })).toBeNull();
    expect(run.boonOfferWave).toBe(15);
    expect(run.boonQueue).toEqual([20, 25]);
  });

  it('never auto-picks: an offer waits through 10 sim minutes of play', () => {
    const sim = strongSim(4);
    cmd(sim, { type: 'restart_checkpoint' });
    const o = [...offer(sim)!];
    const seq = sim.world.run.boonOfferSeq;
    sim.run(10 * MIN);
    expect(sim.world.run.deepestCleared).toBeGreaterThan(0);
    expect(sim.world.build.boons).toEqual([]);
    expect(offer(sim)).toEqual(o);
    expect(sim.world.run.boonOfferSeq).toBe(seq);
    expect(sim.events.recent(0).some((e) => e.type === Ev.BoonPicked)).toBe(false);
  });

  it('no offers in Patrol, but active boons still apply there', () => {
    const sim = strongSim(5);
    const run = sim.world.run;
    cmd(sim, { type: 'set_mode', mode: 'patrol' });
    cmd(sim, { type: 'restart_checkpoint' });
    expect(offer(sim)).toBeNull();
    offerForBossClear(sim.world, 5);
    expect(offer(sim)).toBeNull();
    activate(sim, 'thick_plating');
    sim.run(MIN);
    expect(run.mode).toBe('patrol');
    expect(sim.world.build.boons).toEqual(['thick_plating']);
    expect(sim.world.stats.hasBoon('thick_plating')).toBe(true);
  });
});

// ---------------------------------------------------------------- actions
describe('pick / reroll / decline', () => {
  it('pick activates the boon (Codex entry, event) and clears the offer', () => {
    const sim = new Sim(null, 6);
    sim.world.meta.codex = {};
    cmd(sim, { type: 'restart_checkpoint' });
    const id = offer(sim)![1];
    expect(cmd(sim, { type: 'pick_boon', boon: id })).toBeNull();
    expect(sim.world.build.boons).toEqual([id]);
    expect(offer(sim)).toBeNull();
    expect(sim.world.meta.codex[`boon.${id}`]).toBe(1);
    expect(sim.events.recent(0).some((e) => e.type === Ev.BoonPicked && e.src === id)).toBe(true);
  });

  it('rejects picks that are not on offer, unknown, or with no offer pending', () => {
    const sim = new Sim(null, 6);
    expect(cmd(sim, { type: 'pick_boon', boon: 'overcharge' })).toMatch(/No boon offer/);
    expect(cmd(sim, { type: 'reroll_boon' })).toMatch(/No boon offer/);
    expect(cmd(sim, { type: 'decline_boon' })).toMatch(/No boon offer/);
    forceOffer(sim, ['overcharge', 'long_sight', 'iron_skin']);
    expect(cmd(sim, { type: 'pick_boon', boon: 'miser' })).toMatch(/not on offer/);
    expect(cmd(sim, { type: 'pick_boon', boon: 'nonsense' as BoonId })).toMatch(/not on offer/);
    expect(cmd(sim, { type: 'pick_boon', boon: 'overcharge', replace: 'miser' })).toMatch(/replace is not active/);
    expect(sim.world.build.boons).toEqual([]);
  });

  it('cap of 4: a fifth pick replaces the oldest, or the one named', () => {
    const sim = new Sim(null, 7);
    const picks: BoonId[] = ['overcharge', 'long_sight', 'iron_skin', 'miser'];
    for (const id of picks) { forceOffer(sim, [id, 'stopwatch', 'windfall']); expect(cmd(sim, { type: 'pick_boon', boon: id })).toBeNull(); }
    expect(sim.world.build.boons).toEqual(picks);
    expect(BOON_CAP).toBe(4);
    forceOffer(sim, ['stopwatch', 'windfall', 'berserk']);
    expect(cmd(sim, { type: 'pick_boon', boon: 'stopwatch' })).toBeNull();
    expect(sim.world.build.boons).toEqual(['long_sight', 'iron_skin', 'miser', 'stopwatch']);
    const ev = sim.events.recent(0).filter((e) => e.type === Ev.BoonPicked).pop()!;
    expect(ev.b).toBe(0);   // dropped index
    forceOffer(sim, ['windfall', 'berserk', 'bulwark']);
    expect(cmd(sim, { type: 'pick_boon', boon: 'bulwark', replace: 'miser' })).toBeNull();
    expect(sim.world.build.boons).toEqual(['long_sight', 'iron_skin', 'stopwatch', 'bulwark']);
    expect(sim.world.stats.hasBoon('miser')).toBe(false);
  });

  it('reroll costs 1 Core, then 2; decline is free', () => {
    const sim = new Sim(null, 8);
    const run = sim.world.run;
    cmd(sim, { type: 'restart_checkpoint' });
    const first = [...offer(sim)!];
    run.cores = 2;
    expect(boonRerollCost(run)).toBe(1);
    expect(cmd(sim, { type: 'reroll_boon' })).toBeNull();
    expect(run.cores).toBe(1);
    expect(offer(sim)).not.toEqual(first);
    expect(boonRerollCost(run)).toBe(2);
    expect(cmd(sim, { type: 'reroll_boon' })).toMatch(/Not enough Cores \(reroll costs 2\)/);
    run.cores = 5;
    expect(cmd(sim, { type: 'reroll_boon' })).toBeNull();
    expect(run.cores).toBe(3);
    // the first offer of a Prestige stays surges-only through rerolls
    expect(offer(sim)!.every((id) => BOONS.find((b) => b.id === id)!.category === 'surge')).toBe(true);
    const cores = run.cores;
    expect(cmd(sim, { type: 'decline_boon' })).toBeNull();
    expect(run.cores).toBe(cores);
    expect(offer(sim)).toBeNull();
    expect(sim.world.build.boons).toEqual([]);
    cmd(sim, { type: 'restart_checkpoint' });
    expect(boonRerollCost(run)).toBe(1);   // a new offer starts at 1 again
  });

  it('Directives, Autocast and the Upgrade Queue can never pick, reroll or decline', () => {
    for (const t of ['pick_boon', 'reroll_boon', 'decline_boon'] as const) {
      expect(validateCommand({ type: t, boon: 'overcharge', viaDirective: true })).toMatch(/player only/);
      expect(validateCommand({ type: t, boon: 'overcharge', directive: 2 })).toMatch(/player only/);
      expect(isBoonCommand({ type: t })).toBe(true);
    }
    const sim = new Sim(null, 9);
    cmd(sim, { type: 'restart_checkpoint' });
    const o = [...offer(sim)!];
    sim.world.run.cores = 10;
    sim.world.enqueueCommand({ type: 'pick_boon', boon: o[0] });
    sim.world.enqueueCommand({ type: 'reroll_boon' });
    sim.world.enqueueCommand({ type: 'decline_boon' });
    sim.world.pendingCommands.push({ type: 'pick_boon', boon: o[0] });   // even if one slips into the queue
    sim.step();
    expect(offer(sim)).toEqual(o);
    expect(sim.world.build.boons).toEqual([]);
    expect(sim.world.run.cores).toBe(10);
    sim.command({ type: 'pick_boon', boon: o[0], viaDirective: true } as Command);
    sim.step();
    expect(sim.takeLastError()).toMatch(/player only/);
    expect(offer(sim)).toEqual(o);
  });
});

// ---------------------------------------------------------------- lifetime
describe('boon lifetime', () => {
  it('a death clears active boons and any offer, then the start offer opens', () => {
    const sim = new Sim(null, 10);
    forceOffer(sim, ['overcharge', 'long_sight', 'iron_skin']);
    cmd(sim, { type: 'pick_boon', boon: 'overcharge' });
    forceOffer(sim, ['miser', 'stopwatch', 'windfall']);
    sim.world.run.boonQueue = [10];
    expect(sim.world.stats.hasBoon('overcharge')).toBe(true);
    die(sim);
    expect(sim.world.build.boons).toEqual([]);
    expect(sim.world.stats.hasBoon('overcharge')).toBe(false);
    expect(sim.world.run.boonQueue).toEqual([]);
    expect(sim.world.run.boonOfferKind).toBe('start');
    expect(offer(sim)!.length).toBe(3);
  });

  it('Prestige clears boons and offers; the new run\'s first attempt makes no offer', () => {
    const sim = strongSim(11);
    const run0 = sim.world.run;
    runUntil(sim, () => run0.deepestCleared >= 20, 40 * MIN);
    forceOffer(sim, ['overcharge', 'long_sight', 'iron_skin']);
    cmd(sim, { type: 'pick_boon', boon: 'overcharge' });
    forceOffer(sim, ['miser', 'stopwatch', 'windfall']);
    expect(cmd(sim, { type: 'prestige', frame: 'standard' })).toBeNull();
    expect(sim.world.build.boons).toEqual([]);
    expect(offer(sim)).toBeNull();
    expect(sim.world.run.boonsSeenFirst).toBe(false);
    cmd(sim, { type: 'restart_checkpoint' });
    expect(offer(sim)!.every((id) => BOONS.find((b) => b.id === id)!.category === 'surge')).toBe(true);
  });

  it('Trial start and end clear boons and offers; the resumed run gets a fresh start offer', () => {
    const sim = new Sim(null, 14);
    const w = sim.world;
    w.meta.prestigeRanks['prestige.trials'] = 1;
    cmd(sim, { type: 'restart_checkpoint' });
    cmd(sim, { type: 'pick_boon', boon: offer(sim)![0] });
    offerForBossClear(w, 5);
    const parkedOffer = [...offer(sim)!];
    expect(cmd(sim, { type: 'start_trial', trial: 'poverty' })).toBeNull();
    expect(w.build.boons).toEqual([]);
    expect(offer(sim)).toBeNull();                       // the Trial's first attempt makes no offer
    cmd(sim, { type: 'restart_checkpoint' });
    cmd(sim, { type: 'pick_boon', boon: offer(sim)![0] });
    expect(cmd(sim, { type: 'end_trial' })).toBeNull();
    expect(w.build.boons).toEqual([]);
    expect(w.run.boonOfferKind).toBe('start');
    expect(offer(sim)!.length).toBe(3);
    expect(w.run.boonQueue).toEqual([]);
    expect(offer(sim)).not.toEqual(parkedOffer);
  });

  it('save/load: the pending offer survives, the active boons do not (a reload is a fresh attempt)', () => {
    const sim = new Sim(null, 12);
    cmd(sim, { type: 'restart_checkpoint' });
    cmd(sim, { type: 'pick_boon', boon: offer(sim)![0] });
    offerForBossClear(sim.world, 5);
    offerForBossClear(sim.world, 10);
    sim.world.run.cores = 3;
    cmd(sim, { type: 'reroll_boon' });
    const pending = [...offer(sim)!];
    const save = sim.save();
    expect(save.run.build.boons.length).toBe(1);
    expect(save.run.boonOffer).toEqual(pending);
    const back = Sim.load(JSON.parse(JSON.stringify(save)));
    expect(back.world.run.boonOffer).toEqual(pending);
    expect(back.world.run.boonRerolls).toBe(1);
    expect(back.world.run.boonQueue).toEqual([10]);
    expect(back.world.build.boons).toEqual([]);
    expect(back.world.stats.hasBoon(save.run.build.boons[0])).toBe(false);
    // a save with no pending offer loads into the fresh attempt's start offer
    cmd(back, { type: 'decline_boon' }); cmd(back, { type: 'decline_boon' });
    expect(back.world.run.boonOffer).toBeNull();
    const again = Sim.load(JSON.parse(JSON.stringify(back.save())));
    expect(again.world.run.boonOffer?.length).toBe(3);
    expect(again.world.run.boonOfferKind).toBe('start');
  });

  it('load sanitizes junk boon fields', () => {
    const sim = new Sim(null, 13);
    const save = JSON.parse(JSON.stringify(sim.save()));
    save.run.build.boons = ['overcharge', 'bogus', 'overcharge', 7];
    save.run.boonOffer = ['nope', 'miser', 'miser'];
    save.run.boonQueue = [5, 'x', -5, 7, 10];
    save.run.boonRerolls = 'lots';
    save.run.boonOfferKind = 'weird';
    const back = Sim.load(save);
    expect(back.world.run.boonOffer).toEqual(['miser']);
    expect(back.world.run.boonQueue).toEqual([5, 10]);
    expect(back.world.run.boonRerolls).toBe(0);
    expect(back.world.run.boonOfferKind).toBe('start');
    expect(back.world.build.boons).toEqual([]);
    delete save.run.boonOffer; delete save.run.build.boons;
    expect(() => Sim.load(save)).not.toThrow();
  });
});

// ---------------------------------------------------------------- stat boons
describe('stat boons change stats.get as described', () => {
  // [boon, key, expected(base)] — base is the value with no boons (bases here have no other bonuses)
  const cases: [BoonId, string, (b: number) => number][] = [
    ['overcharge', 'ballistics.damage', (b) => b * (1 + T.overcharge.damage)],
    ['hair_trigger', 'ballistics.attack_speed', (b) => b * (1 + T.hair_trigger.attackSpeed)],
    ['long_sight', 'ballistics.range', (b) => b * (1 + T.long_sight.range)],
    ['thick_plating', 'bastion.max_hp', (b) => b * (1 + T.thick_plating.maxHp)],
    ['ablative_shell', 'bastion.shield_hp_frac', (b) => b + T.ablative_shell.shieldFrac],
    ['second_wind', 'bastion.between_wave_heal', (b) => b + T.second_wind.heal],
    ['scrap_magnet', 'economy.scrap_mul', (b) => b * (1 + T.scrap_magnet.scrap)],
    ['quick_hands', 'ability.emp.cost_mul', (b) => b * (1 - T.quick_hands.cost)],
    ['deep_reserves', 'economy.ce_cap', (b) => b + T.deep_reserves.ce],
    ['lucky_streak', 'ballistics.crit_chance', (b) => b + T.lucky_streak.crit],
    ['heavy_hits', 'ballistics.crit_damage', (b) => b + T.heavy_hits.critMul],
    ['iron_skin', 'bastion.armor', (b) => b + T.iron_skin.armor],
    ['glass_hour', 'combat.power_mul', (b) => b * (1 + T.glass_hour.damage)],
    ['glass_hour', 'bastion.between_wave_heal', (b) => b * (1 - T.glass_hour.heal)],
    ['berserk', 'reactor.global_attack_speed', (b) => b * (1 + T.berserk.attackSpeed)],
    ['berserk', 'bastion.max_hp_final', (b) => b * (1 - T.berserk.maxHp)],
    ['miser', 'economy.scrap_mul', (b) => b * (1 + T.miser.scrap)],
    ['miser', 'combat.power_mul', (b) => b * (1 - T.miser.damage)],
    ['reckless', 'ability.hunter_mark.cost_mul', (b) => b * (1 - T.reckless.cost)],
    ['reckless', 'reactor.command.cooldowns', (b) => b - T.reckless.cooldown],
    ['bulwark', 'bastion.max_hp', (b) => b * (1 + T.bulwark.maxHp)],
    ['bulwark', 'reactor.global_attack_speed', (b) => b * (1 - T.bulwark.attackSpeed)],
    ['slow_and_sure', 'combat.power_mul', (b) => b * (1 + T.slow_and_sure.damage)],
    ['slow_and_sure', 'reactor.global_attack_speed', (b) => b * (1 - T.slow_and_sure.attackSpeed)],
    ['overclocked', 'reactor.cooldown_reduction', (b) => b + T.overclocked.cooldown],
    ['overclocked', 'bastion.damage_taken_mul', (b) => b + T.overclocked.damageTaken],
  ];
  for (const [id, key, f] of cases) {
    it(`${id} → ${key}`, () => {
      const sim = calm();
      const base = sim.world.stats.get(key);
      activate(sim, id);
      expect(sim.world.stats.get(key)).toBeCloseTo(f(base), 6);
      sim.world.build.boons = [];
      sim.world.rebuildStats();
      expect(sim.world.stats.get(key)).toBeCloseTo(base, 9);
    });
  }
  it('the tower reads them: Thick Plating max HP, Ablative Shell shield, Overclocked damage taken, Reckless cooldowns', () => {
    const sim = calm();
    const w = sim.world, t = w.tower;
    const hp0 = t.maxHp;
    activate(sim, 'thick_plating', 'ablative_shell');
    expect(t.maxHp).toBeCloseTo(hp0 * (1 + T.thick_plating.maxHp), 6);
    expect(t.maxShield).toBeCloseTo(t.maxHp * T.ablative_shell.shieldFrac, 6);
    w.build.boons = ['overclocked']; w.rebuildStats();
    t.hp = t.maxHp; t.shield = 0; t.invulnT = 0;
    w.damageTower(10, -1, -1);
    expect(t.maxHp - t.hp).toBeCloseTo(10 * (1 + T.overclocked.damageTaken), 6);
  });
});

// ---------------------------------------------------------------- mechanical boons
describe('every mechanical boon fires its event (src boon.<id>)', () => {
  it('forked_arc: a primary crit arcs to a second enemy', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'forked_arc');
    const a = tough(sim, 100, 0), b = tough(sim, 140, 0);
    const hp = w.enemies.hp[b];
    w.damage(a, 100, { source: 'primary', srcTag: 'ballistics', crit: true, cause: -1 });
    expect(boonEvents(sim, 'forked_arc')).toBe(1);
    expect(hp - w.enemies.hp[b]).toBeCloseTo(100 * T.forked_arc.fraction, 3);
  });
  it('ricochet_rounds: a killing primary shot flies on', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'ricochet_rounds');
    const a = tough(sim, 100, 0, 50), b = tough(sim, 150, 0);
    const hp = w.enemies.hp[b];
    w.damage(a, 80, { source: 'primary', srcTag: 'ballistics', cause: -1 });
    expect(boonEvents(sim, 'ricochet_rounds')).toBe(1);
    expect(w.enemies.hp[b]).toBeLessThan(hp);
  });
  it('volatile_kills: a kill explodes for a fraction of max HP', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'volatile_kills');
    const a = tough(sim, 100, 0, 1000), b = tough(sim, 120, 0);
    const hp = w.enemies.hp[b];
    w.killEnemy(a, -1, 'test');
    expect(boonEvents(sim, 'volatile_kills')).toBe(1);
    expect(hp - w.enemies.hp[b]).toBeCloseTo(1000 * T.volatile_kills.fraction, 1);
  });
  it('static_field: a lightning hit leaves a field', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'static_field');
    const a = tough(sim, 100, 0);
    const n = w.hazards.length;
    w.damage(a, 100, { source: 'element', srcTag: 'lightning', element: 'lightning', cause: -1 });
    expect(boonEvents(sim, 'static_field')).toBe(1);
    expect(w.hazards.length).toBe(n + 1);
  });
  it('frostbite: every Chill adds one more stack', () => {
    const sim = calm(); const w = sim.world;
    const a = tough(sim, 100, 0);
    w.applyStatus(a, 'chill', 1, 120, 'frost', -1);
    const plain = w.enemies.chill[a];
    activate(sim, 'frostbite');
    const b = tough(sim, -100, 0);
    w.applyStatus(b, 'chill', 1, 120, 'frost', -1);
    expect(boonEvents(sim, 'frostbite')).toBe(1);
    expect(w.enemies.chill[b]).toBe(plain + T.frostbite.stacks);
  });
  it('wildfire_seed: a burning death spreads Burn', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'wildfire_seed');
    const a = tough(sim, 100, 0), b = tough(sim, 130, 0);
    w.applyStatus(a, 'burn', 1, 240, 'fire', -1, 5);
    expect(w.enemies.burn[b]).toBe(0);
    w.killEnemy(a, -1, 'test');
    expect(boonEvents(sim, 'wildfire_seed')).toBe(1);
    expect(w.enemies.burn[b]).toBeGreaterThan(0);
  });
  it('toxic_bloom: a poisoned death leaves a cloud', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'toxic_bloom');
    const a = tough(sim, 100, 0);
    w.applyStatus(a, 'poison', 1, 240, 'poison', -1, 5);
    const n = w.hazards.length;
    w.killEnemy(a, -1, 'test');
    expect(boonEvents(sim, 'toxic_bloom')).toBe(1);
    expect(w.hazards.length).toBe(n + 1);
  });
  it('rally_drones: a kill speeds the drones up for a moment', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'rally_drones');
    const a = tough(sim, 100, 0);
    w.killEnemy(a, -1, 'test');
    combatTick(sim);
    expect(boonEvents(sim, 'rally_drones')).toBe(1);
    expect(w.signals.droneRateMul).toBeCloseTo(1 + T.rally_drones.rateBonus, 6);
    for (let k = 0; k < T.rally_drones.seconds * 60 + 2; k++) combatTick(sim);
    expect(w.signals.droneRateMul).toBe(1);
  });
  it('sharpened_edge and hunters_gambit: blade vs a boss, everything else vs a grunt', () => {
    const sim = calm(); const w = sim.world;
    const boss = tough(sim, 200, 0, 1e6, 'boss', { bossId: 'breaker' });
    const g = tough(sim, -200, 0);
    const hit = (i: number, source: 'blade' | 'primary'): number => { const hp = w.enemies.hp[i]; w.damage(i, 100, { source, srcTag: source === 'blade' ? 'blade' : 'ballistics', cause: -1, ignoreArmor: true }); return hp - w.enemies.hp[i]; };
    const base = hit(boss, 'blade'), baseG = hit(g, 'primary');
    activate(sim, 'sharpened_edge', 'hunters_gambit');
    expect(hit(boss, 'blade') / base).toBeCloseTo((1 + T.sharpened_edge.bonus) * T.hunters_gambit.boss, 3);
    expect(hit(g, 'primary') / baseG).toBeCloseTo(T.hunters_gambit.other, 3);
    expect(boonEvents(sim, 'sharpened_edge')).toBe(1);
    expect(boonEvents(sim, 'hunters_gambit')).toBe(1);
    expect(w.enemies.flags[boss] & EnemyFlag.Boss).toBeTruthy();
  });
  it('focus_beam: laser damage ramps with contact time up to the cap', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'focus_beam');
    const a = tough(sim, 100, 0);
    const dmg = (): number => { const hp = w.enemies.hp[a]; w.damage(a, 10, { source: 'laser', srcTag: 'laser', cause: -1, ignoreArmor: true }); return hp - w.enemies.hp[a]; };
    const d0 = dmg();
    let last = d0;
    for (let k = 0; k < 7 * 60; k++) { combatTick(sim); last = dmg(); }
    expect(last / d0).toBeCloseTo(1 + T.focus_beam.max, 1);
    expect(boonEvents(sim, 'focus_beam')).toBeGreaterThanOrEqual(1);
  });
  it('encore: the first Fusion of a wave fires again as a blast', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'encore');
    boonsSystem(sim).onWaveStart!(w);
    const a = tough(sim, 100, 0);
    const hp = w.enemies.hp[a];
    w.emit(Ev.Fusion, 'fusion.plasma', a, 500, 100, 0, -1);
    w.emit(Ev.Fusion, 'fusion.plasma', a, 500, 100, 0, -1);   // only the first echoes
    for (let k = 0; k < 60; k++) combatTick(sim);
    expect(boonEvents(sim, 'encore')).toBe(1);
    expect(hp - w.enemies.hp[a]).toBeGreaterThanOrEqual(499);
  });
  it('anchor_well: the first well of a wave lasts twice as long', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'anchor_well');
    boonsSystem(sim).onWaveStart!(w);
    expect(w.signals.wellLifeMul).toBe(T.anchor_well.lifeMul);
    w.emit(Ev.Fx, 'gravitics.well', 0, 1, 50, 0, -1);
    combatTick(sim);
    expect(boonEvents(sim, 'anchor_well')).toBe(1);
    expect(w.signals.wellLifeMul).toBe(1);
  });
  it('stopwatch: enemies move slower', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'stopwatch');
    boonsSystem(sim).onWaveStart!(w);
    const a = tough(sim, 300, 0);
    combatTick(sim); combatTick(sim);
    expect(boonEvents(sim, 'stopwatch')).toBe(1);
    expect(w.enemies.speedMul[a]).toBeCloseTo(1 - T.stopwatch.slow, 6);
  });
  it('second_chance: survives one lethal blow, then is used up for the attempt', () => {
    const sim = calm(); const w = sim.world, t = w.tower;
    activate(sim, 'second_chance');
    w.damageTower(1e12, -1, -1);
    expect(t.hp).toBe(1);
    expect(t.invulnT).toBe(T.second_chance.invulnSeconds * 60);
    expect(boonEvents(sim, 'second_chance')).toBe(1);
    combatTick(sim);
    expect(w.build.boons).toEqual([]);
    expect(w.run.boonSpent).toEqual(['second_chance']);
    for (let k = 0; k < 40; k++) expect(rollBoons(w, 10 + k, k, 0, 'boss', false)).not.toContain('second_chance');
    forceOffer(sim, ['second_chance', 'miser', 'stopwatch']);
    expect(cmd(sim, { type: 'pick_boon', boon: 'second_chance' })).toMatch(/used up/);
    t.invulnT = 0;
    w.damageTower(1e12, -1, -1);
    expect(t.hp).toBe(0);
  });
  it('windfall: the next boss kill drops an extra Core; picked again, it arms again', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'windfall');
    const b = tough(sim, 200, 0, 1000, 'boss', { bossId: 'breaker' });
    const cores = w.run.cores;
    w.killEnemy(b, -1, 'test');
    expect(boonEvents(sim, 'windfall')).toBe(1);
    expect(w.run.cores - cores).toBe(1 + T.windfall.cores);   // the boss Core + Windfall
    combatTick(sim);
    expect(w.build.boons).toEqual([]);
    forceOffer(sim, ['windfall', 'miser', 'stopwatch']);
    expect(cmd(sim, { type: 'pick_boon', boon: 'windfall' })).toBeNull();
    const b2 = tough(sim, 200, 0, 1000, 'boss', { bossId: 'breaker' });
    w.killEnemy(b2, -1, 'test');
    expect(boonEvents(sim, 'windfall')).toBe(2);
  });
  it('trophy_hunter: elite and boss kills stack damage up to the cap', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'trophy_hunter');
    const m0 = w.dynamicPowerMul;
    for (let k = 0; k < 15; k++) { const b = tough(sim, 200, k, 1000, 'boss', { bossId: 'breaker' }); w.killEnemy(b, -1, 'test'); combatTick(sim); }
    expect(boonEvents(sim, 'trophy_hunter')).toBe(Math.round(T.trophy_hunter.max / T.trophy_hunter.perKill));
    expect(w.dynamicPowerMul / m0).toBeCloseTo(1 + T.trophy_hunter.max, 6);
    w.build.boons = []; w.rebuildStats();
    expect(w.dynamicPowerMul).toBeCloseTo(m0, 9);
  });
  it('the Inspector names boon events', () => {
    const sim = calm(); const w = sim.world;
    activate(sim, 'volatile_kills');
    const a = tough(sim, 100, 0, 1000); tough(sim, 110, 0, 50);
    w.killEnemy(a, -1, 'test');
    const ev = sim.events.recent(0).filter((e) => e.type === Ev.Kill).pop()!;
    expect(sim.inspect(ev.id).sentence).toMatch(/Volatile Kills boon/);
  });
});

// ---------------------------------------------------------------- determinism and fuzz
describe('boon determinism and robustness', () => {
  function scripted(seed: number): Sim {
    const sim = strongSim(seed);
    for (let k = 0; k < 6; k++) {
      runUntil(sim, () => !!sim.world.run.boonOffer, 12 * MIN);
      sim.world.run.cores = Math.max(sim.world.run.cores, 1);
      if (k % 3 === 1) sim.command({ type: 'reroll_boon' });
      sim.step();
      const o = sim.world.run.boonOffer;
      if (o) sim.command(k % 3 === 2 ? { type: 'decline_boon' } : { type: 'pick_boon', boon: o[k % o.length] });
      sim.run(120);
      if (k === 3) { sim.world.damageTower(1e15, -1, -1); sim.run(200); }
    }
    return sim;
  }
  it('two Sims with the same commands produce the same hash', () => {
    const a = scripted(21), b = scripted(21);
    expect(a.events.hash()).toBe(b.events.hash());
    expect(a.world.build.boons).toEqual(b.world.build.boons);
    expect(a.events.recent(0).filter((e) => e.type === Ev.BoonPicked).length).toBeGreaterThan(0);
  });

  it('malformed boon commands are rejected, never thrown', () => {
    const sim = new Sim(null, 22);
    cmd(sim, { type: 'restart_checkpoint' });
    const o = [...offer(sim)!];
    const rng = new Prng(99);
    const junk: unknown[] = [null, 1, 'x', [], {}, NaN, -1, 1e308, { a: 1 }, 'overcharge', 'pick_boon', true, undefined, ''.padEnd(300, 'z')];
    const any = (): unknown => junk[rng.int(0, junk.length - 1)];
    for (let k = 0; k < 400; k++) {
      const type = ['pick_boon', 'reroll_boon', 'decline_boon'][rng.int(0, 2)];
      const c: Record<string, unknown> = { type };
      if (rng.chance(0.8)) c.boon = any();
      if (rng.chance(0.5)) c.replace = any();
      if (type !== 'pick_boon' || typeof c.boon !== 'string' || !o.includes(c.boon as BoonId)) {
        expect(() => sim.command(c as unknown as Command)).not.toThrow();
        expect(() => sim.step()).not.toThrow();
      }
    }
    expect(offer(sim) === null || offer(sim)!.length === 3).toBe(true);
    for (const b of sim.world.build.boons) expect(BOONS.some((d) => d.id === b)).toBe(true);
    expect(Number.isFinite(sim.world.run.cores)).toBe(true);
  });
});
