/**
 * Active edge (systems/active.ts, data/active.ts, docs/ACTIVE.md): tap-to-assist cooldown and damage, salvage drops
 * (own PRNG stream, cap, drift, passive value, chain), Overcharge (unlock, meter, timing window, beam), determinism.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { Ev, TICK_RATE } from '../../src/sim/core/types';
import type { Command } from '../../src/sim/core/types';
import { ACTIVE } from '../../src/sim/data/active';
import { chainMultiplier, findActive, overchargePower, overchargeUnlocked, type ActiveSystem } from '../../src/sim/systems/active';
import { validateCommand } from '../../src/sim/run/validate';
import { arena, cmd, dummy, events, setTrial, tick } from './helpers';

const A = ACTIVE.assist, S = ACTIVE.salvage, O = ACTIVE.overcharge;
const act = (sim: Sim): ActiveSystem => findActive(sim.world)!;
/** Arena with deterministic assist damage: no crit (crit bonus only, ×1 crit damage). */
function assistArena(seed = 1): Sim {
  const sim = arena(seed);
  sim.world.stats.override('ballistics.crit_damage', 1);
  sim.world.rebuildStats();
  return sim;
}

describe('commands', () => {
  it('validate: shapes', () => {
    expect(validateCommand({ type: 'tap_assist', x: 1, y: 2 })).toBeNull();
    expect(validateCommand({ type: 'tap_assist', x: Number.NaN, y: 2 })).toMatch(/Malformed/);
    expect(validateCommand({ type: 'collect_salvage', x: 1 })).toMatch(/Malformed/);
    expect(validateCommand({ type: 'overcharge', action: 'charge' })).toBeNull();
    expect(validateCommand({ type: 'overcharge', action: 'boom' })).toMatch(/Malformed/);
  });
  it('never an error: empty taps, cooldown, outside combat', () => {
    const sim = assistArena();
    expect(cmd(sim, { type: 'tap_assist', x: 400, y: 400 })).toBeNull();
    expect(cmd(sim, { type: 'collect_salvage', x: 0, y: 0 })).toBeNull();
    expect(cmd(sim, { type: 'overcharge', action: 'charge' })).toBeNull();
    tick(sim);
    expect(events(sim, Ev.Assist)).toHaveLength(0);
  });
});

describe('tap-to-assist', () => {
  it('a tap on an enemy fires one bonus shot of damageMul × primary damage', () => {
    const sim = assistArena();
    const w = sim.world;
    const i = dummy(sim, 150, 0);
    const hp = w.enemies.hp[i];
    cmd(sim, { type: 'tap_assist', x: 158, y: 6 });   // near, not exactly on it
    tick(sim);
    const ev = events(sim, Ev.Assist);
    expect(ev).toHaveLength(1);
    expect(ev[0].b).toBeCloseTo(A.damageMul * w.stats.get('ballistics.damage'), 6);
    const hit = events(sim, Ev.Hit, 'assist');
    expect(hit).toHaveLength(1);
    expect(hit[0].cause).toBe(ev[0].id);   // the Assist event is the Hit's cause
    expect(w.enemies.hp[i]).toBeLessThan(hp);
  });
  it('cooldown: spamming inside it gives nothing extra', () => {
    const sim = assistArena();
    // a fast primary (silenced by range 0): the plain cooldown applies
    sim.world.stats.override('ballistics.attack_speed', 40); sim.world.stats.override('ballistics.range', 0); sim.world.rebuildStats();
    dummy(sim, 150, 0);
    const cdTicks = Math.round(A.cooldown * TICK_RATE);
    expect(act(sim).assistCooldownTicks(sim.world)).toBe(cdTicks);
    for (let t = 0; t < cdTicks * 3; t++) { cmd(sim, { type: 'tap_assist', x: 150, y: 0 }); tick(sim); }   // 60 taps/s
    expect(events(sim, Ev.Assist)).toHaveLength(3);
    const ticks = events(sim, Ev.Assist).map((e) => e.tick);
    expect(ticks[1] - ticks[0]).toBe(cdTicks);
    expect(act(sim).uiState(sim.world).assistCooldown).toBeGreaterThan(0);
  });
  it('the assist never out-fires a slow primary: cooldown ≥ 1 / (maxPrimaryShare × shots/s)', () => {
    const sim = assistArena();
    sim.world.stats.override('ballistics.attack_speed', 2); sim.world.stats.override('ballistics.range', 0); sim.world.rebuildStats();
    const t = act(sim).assistCooldownTicks(sim.world);
    expect(t).toBe(Math.round(TICK_RATE / (A.maxPrimaryShare * 2)));
    expect(t).toBeGreaterThan(Math.round(A.cooldown * TICK_RATE));
  });
  it('only in combat, never under Blackout', () => {
    const sim = assistArena();
    dummy(sim, 150, 0);
    sim.world.run.phase = 'between';
    cmd(sim, { type: 'tap_assist', x: 150, y: 0 }); tick(sim);
    sim.world.run.phase = 'combat';
    setTrial(sim, 'blackout');
    cmd(sim, { type: 'tap_assist', x: 150, y: 0 }); tick(sim);
    expect(events(sim, Ev.Assist)).toHaveLength(0);
  });
});

describe('salvage', () => {
  function killMany(sim: Sim, n: number, elite = false): void {
    const w = sim.world;
    for (let k = 0; k < n; k++) {
      const i = dummy(sim, 200 + (k % 5) * 20, (k % 7) * 20, 'grunt', 1, elite ? ['swift'] : undefined);
      w.killEnemy(i, -1, 'ballistics');
    }
  }
  function drops(sim: Sim): string { return events(sim, Ev.SalvageDrop).map((e) => `${e.tick}:${e.a.toFixed(3)}:${e.cause}`).join(','); }

  it('no drops before fromWave', () => {
    const sim = arena(3);
    sim.world.run.wave = S.fromWave - 1;
    killMany(sim, 200);
    expect(events(sim, Ev.SalvageDrop)).toHaveLength(0);
  });
  it('drops come from the system\'s own seeded stream: same seed same drops, the combat PRNG untouched', () => {
    const run = (seed: number): Sim => {
      const sim = arena(seed); sim.world.run.wave = 4;
      // enough kills for several drops at the tuned ordinary chance (~0.6%: 2,000 kills ≈ 12 expected)
      for (let r = 0; r < 100; r++) { killMany(sim, 20); tick(sim, S.lifeSeconds * TICK_RATE + 1); }
      return sim;
    };
    const a = run(5), b = run(5), c = run(6);
    expect(events(a, Ev.SalvageDrop).length).toBeGreaterThan(3);
    expect(drops(a)).toBe(drops(b));
    expect(drops(a)).not.toBe(drops(c));
    // the world's combat PRNG never drew for salvage
    const d = arena(5); d.world.run.wave = 4;
    const before = d.world.prng.nextU32();
    const e = arena(5); e.world.run.wave = 4;
    killMany(e, 20);
    expect(e.world.prng.nextU32()).toBe(before);
  });
  it('a crate is worth valueMin..valueMax × its kill\'s Scrap; the drop names the Kill as its cause', () => {
    const sim = arena(7); sim.world.run.wave = 4;
    for (let r = 0; r < 200 && events(sim, Ev.SalvageDrop).length === 0; r++) killMany(sim, 10);
    const d = events(sim, Ev.SalvageDrop)[0];
    const kill = sim.world.events.byId(d.cause)!;
    expect(kill.type).toBe(Ev.Kill);
    const perKill = sim.world.killScrap[kill.a];
    expect(d.a / perKill).toBeGreaterThanOrEqual(S.valueMin);
    expect(d.a / perKill).toBeLessThan(S.valueMax);
  });
  it('live crates are capped at maxLive', () => {
    const sim = arena(9); sim.world.run.wave = 4;
    killMany(sim, 600, true);   // elites: eliteChance each
    expect(act(sim).liveCrates()).toBe(S.maxLive);
    expect(events(sim, Ev.SalvageDrop)).toHaveLength(S.maxLive);
  });
  it('drifts to the tower and the passive collector pays passiveValue when it arrives', () => {
    const sim = arena(11);
    const w = sim.world, s = act(sim);
    const k = s.addCrate(w, 300, 0, 1000);
    const scrap = w.run.scrap;
    tick(sim, 60);
    expect(s.crateX[k]).toBeLessThan(300);
    expect(s.crateX[k]).toBeGreaterThan(0);
    tick(sim, S.lifeSeconds * TICK_RATE - 60 - 1);
    expect(s.crateLive[k]).toBe(1);
    tick(sim);
    expect(s.crateLive[k]).toBe(0);
    const c = events(sim, Ev.SalvageCollect);
    expect(c).toHaveLength(1);
    expect(c[0].src).toBe('salvage.passive');
    expect(c[0].a).toBeCloseTo(1000 * S.passiveValue, 6);
    expect(w.run.scrap - scrap).toBeCloseTo(1000 * S.passiveValue, 6);
    expect(sim.world.events.byId(c[0].cause)!.type).toBe(Ev.SalvageDrop);
  });
  it('a tap collects the full value; quick collects chain (×1, ×1.5, ×2 …, max chainMax) and the chain lapses', () => {
    const sim = arena(12);
    const w = sim.world, s = act(sim);
    const paid = (): number[] => events(sim, Ev.SalvageCollect).filter((e) => e.src === 'salvage.tap').map((e) => e.a);
    for (let k = 0; k < 5; k++) s.addCrate(w, 100 + 60 * k, 200, 100);
    for (let k = 0; k < 5; k++) { const x = s.crateX[k], y = s.crateY[k]; cmd(sim, { type: 'collect_salvage', x: x + 20, y: y - 20 }); tick(sim, 10); }
    expect(paid().map((v) => Math.round(v))).toEqual([100, 150, 200, 250, 300]);
    expect(chainMultiplier(9)).toBe(S.chainMax);
    expect(s.chain).toBe(5);
    tick(sim, Math.ceil(S.chainWindow * TICK_RATE) + 1);
    expect(s.chain).toBe(0);
    s.addCrate(w, 0, 300, 100);
    cmd(sim, { type: 'collect_salvage', x: 0, y: 290 }); tick(sim);
    expect(Math.round(paid()[5])).toBe(100);
    // a miss (beyond tapReach) collects nothing
    s.addCrate(w, 0, -300, 100);
    cmd(sim, { type: 'collect_salvage', x: 0, y: -300 + S.tapReach + 30 }); tick(sim);
    expect(paid()).toHaveLength(6);
  });
  it('crates in flight when the tower dies pay passively', () => {
    const sim = arena(13);
    const w = sim.world, s = act(sim);
    s.addCrate(w, 300, 0, 500); s.addCrate(w, -300, 0, 500);
    w.run.phase = 'dead';
    tick(sim);
    expect(s.liveCrates()).toBe(0);
    expect(events(sim, Ev.SalvageCollect).map((e) => e.a)).toEqual([500 * S.passiveValue, 500 * S.passiveValue]);
  });
});

describe('overcharge', () => {
  function ocArena(seed = 21): Sim {
    const sim = assistArena(seed);
    sim.world.meta.deepestEver = O.unlockWave;
    return sim;
  }
  /** Charge, hold `ticks` (release command after that many ticks), return the Overcharge event. */
  function volley(sim: Sim, holdTicks: number): ReturnType<typeof events>[number] | undefined {
    act(sim).meter = O.meterMax;
    cmd(sim, { type: 'overcharge', action: 'charge' }); tick(sim);
    tick(sim, holdTicks - 1);
    cmd(sim, { type: 'overcharge', action: 'release' }); tick(sim);
    return events(sim, Ev.Overcharge).pop();
  }
  it('unlocks at the ladder wave (deepest ever or this run)', () => {
    const sim = assistArena();
    expect(overchargeUnlocked(sim.world)).toBe(false);
    sim.world.run.deepestCleared = O.unlockWave;
    expect(overchargeUnlocked(sim.world)).toBe(true);
    const locked = assistArena();
    act(locked).meter = O.meterMax;
    cmd(locked, { type: 'overcharge', action: 'charge' }); tick(locked);
    expect(act(locked).charging).toBe(false);
  });
  it('needs a full meter; primary hits fill it, capped per second; assists add meterPerTap', () => {
    const sim = ocArena();
    const s = act(sim);
    cmd(sim, { type: 'overcharge', action: 'charge' }); tick(sim);
    expect(s.charging).toBe(false);
    const w = sim.world;
    const i = dummy(sim, 120, 0);
    for (let k = 0; k < 60; k++) s.onHit(w, { enemy: i, damage: 5, source: 'primary', srcTag: 'ballistics', crit: false, element: null, projectile: -1, x: 0, y: 0, cause: -1, eventId: -1, killed: false });
    expect(s.meter).toBeCloseTo(O.shotCapPerSecond, 6);   // a burst of 60 hits: only the bucket
    tick(sim, TICK_RATE);
    for (let k = 0; k < 60; k++) s.onHit(w, { enemy: i, damage: 5, source: 'primary', srcTag: 'ballistics', crit: false, element: null, projectile: -1, x: 0, y: 0, cause: -1, eventId: -1, killed: false });
    expect(s.meter).toBeCloseTo(2 * O.shotCapPerSecond, 6);
    cmd(sim, { type: 'tap_assist', x: 120, y: 0 }); tick(sim);
    expect(s.meter).toBeCloseTo(2 * O.shotCapPerSecond + A.meterPerTap, 6);
  });
  it('release inside the window: perfect volley along the designated line, with stagger; off-line enemies untouched', () => {
    const sim = ocArena();
    const w = sim.world;
    const on = dummy(sim, 200, 10), behind = dummy(sim, 400, -5), off = dummy(sim, 0, 200);
    cmd(sim, { type: 'designate', enemy: on });
    const hp = [w.enemies.hp[on], w.enemies.hp[behind], w.enemies.hp[off]];
    const ev = volley(sim, Math.round(((O.perfectFrom + O.perfectTo) / 2) * TICK_RATE))!;
    expect(ev.a).toBe(1);
    expect(ev.b).toBeCloseTo(O.perfectMul * w.stats.get('ballistics.damage'), 6);
    expect(w.enemies.hp[on]).toBeLessThan(hp[0]);
    expect(w.enemies.hp[behind]).toBeLessThan(hp[1]);
    expect(w.enemies.hp[off]).toBe(hp[2]);
    expect(w.enemies.staggerT[on]).toBeGreaterThan(0);
    const hits = events(sim, Ev.Hit, 'overcharge');
    expect(hits).toHaveLength(2);
    for (const h of hits) expect(h.cause).toBe(ev.id);
    expect(act(sim).meter).toBe(0);
  });
  it('outside the window: a weaker volley, never a fail state; holding too long releases weak; cancel keeps the meter', () => {
    expect(overchargePower(0.1)).toEqual({ perfect: false, mul: O.weakMul });
    expect(overchargePower(O.perfectFrom)).toEqual({ perfect: true, mul: O.perfectMul });
    expect(overchargePower(O.perfectTo + 0.05).perfect).toBe(false);
    const early = ocArena(); dummy(early, 150, 0);
    expect(volley(early, 6)!.a).toBe(0);
    const late = ocArena(); dummy(late, 150, 0);
    act(late).meter = O.meterMax;
    cmd(late, { type: 'overcharge', action: 'charge' }); tick(late, Math.round(O.maxHoldSeconds * TICK_RATE) + 2);
    expect(events(late, Ev.Overcharge)).toHaveLength(1);
    expect(events(late, Ev.Overcharge)[0].a).toBe(0);
    const c = ocArena(); dummy(c, 150, 0);
    act(c).meter = O.meterMax;
    cmd(c, { type: 'overcharge', action: 'charge' }); tick(c, 10);
    cmd(c, { type: 'overcharge', action: 'cancel' }); tick(c);
    expect(act(c).charging).toBe(false);
    expect(act(c).meter).toBe(O.meterMax);
    expect(events(c, Ev.Overcharge)).toHaveLength(0);
  });
  it('a release may report the hold the player saw (input latency), within releaseLatency below the sim hold, never longer', () => {
    const run = (simTicks: number, seen: number): number => {
      const sim = ocArena(); dummy(sim, 150, 0);
      act(sim).meter = O.meterMax;
      cmd(sim, { type: 'overcharge', action: 'charge' }); tick(sim, simTicks);
      cmd(sim, { type: 'overcharge', action: 'release', hold: seen }); tick(sim);
      return events(sim, Ev.Overcharge)[0].a;
    };
    const late = Math.round((O.perfectTo + 0.15) * TICK_RATE);                  // the sim is past the window...
    expect(run(late, O.perfectTo - 0.05)).toBe(1);                              // ...the player let go inside it: perfect
    expect(run(late, O.perfectTo - O.releaseLatency - 0.2)).toBe(0);            // too far below the sim's hold: ignored
    expect(run(Math.round(0.3 * TICK_RATE), O.perfectFrom + 0.1)).toBe(0);      // cannot claim more than the sim held
    expect(validateCommand({ type: 'overcharge', action: 'release', hold: Number.NaN })).toMatch(/Malformed/);
  });
  it('the window is real time: at ×2 speed a hold counts half per sim tick', () => {
    const sim = ocArena(); dummy(sim, 150, 0);
    sim.world.run.speedMultiplier = 2;
    const perfectTicks = Math.round(((O.perfectFrom + O.perfectTo) / 2) * TICK_RATE);
    expect(volley(sim, perfectTicks)!.a).toBe(0);            // only half the hold in real time
    const sim2 = ocArena(); dummy(sim2, 150, 0);
    sim2.world.run.speedMultiplier = 2;
    expect(volley(sim2, perfectTicks * 2)!.a).toBe(1);
  });
});

describe('active edge determinism', () => {
  /** A full Sim playing real waves with scripted taps, crate collects and Overcharge. */
  function play(seed: number, ticks: number): Sim {
    const sim = new Sim(null, seed);
    const w = sim.world;
    w.meta.deepestEver = 20;
    w.run.checkpoint = 5; w.run.deepestCleared = 5;
    w.stats.override('bastion.max_hp', 1e5);
    w.rebuildStats();
    sim.machine.startAttempt(false);
    const s = findActive(w)!;
    for (let t = 0; t < ticks; t++) {
      const cmds: Command[] = [];
      if (t % 20 === 0 && w.enemies.count > 0) cmds.push({ type: 'tap_assist', x: w.enemies.x[0], y: w.enemies.y[0] });
      if (t % 15 === 0) for (let k = 0; k < s.crateLive.length; k++) if (s.crateLive[k] && (k + t) % 2 === 0) cmds.push({ type: 'collect_salvage', x: s.crateX[k], y: s.crateY[k] });
      if (s.canCharge(w)) cmds.push({ type: 'overcharge', action: 'charge' });
      if (s.charging && s.hold >= 55) cmds.push({ type: 'overcharge', action: 'release' });
      for (const c of cmds) sim.command(c);
      sim.step();
    }
    return sim;
  }
  it('same seed + same taps → identical event hash; every active piece fired', () => {
    const a = play(31, 5400), b = play(31, 5400);
    expect(a.events.hash()).toBe(b.events.hash());
    expect(a.world.run.scrap).toBe(b.world.run.scrap);
    const all = a.world.events.recent(0);
    expect(all.some((e) => e.type === Ev.Assist)).toBe(true);
    expect(all.some((e) => e.type === Ev.SalvageDrop)).toBe(true);
    expect(all.some((e) => e.type === Ev.SalvageCollect)).toBe(true);
    expect(all.some((e) => e.type === Ev.Overcharge)).toBe(true);
  });
  it('the salvage chain sentence reads through the kill', () => {
    const sim = arena(41);
    const s = act(sim), w = sim.world;
    w.run.wave = 4;
    let drop = events(sim, Ev.SalvageDrop)[0];
    // kill until the first drop (at the tuned ~0.6% chance, 2,000 tries all but guarantee one)
    for (let r = 0; r < 2000 && !drop; r++) { const i = dummy(sim, 200, 0, 'grunt', 1); w.killEnemy(i, -1, 'ballistics'); drop = events(sim, Ev.SalvageDrop)[0]; }
    expect(drop).toBeDefined();
    const k = s.crateLive.indexOf(1);
    cmd(sim, { type: 'collect_salvage', x: s.crateX[k], y: s.crateY[k] }); tick(sim);
    const c = events(sim, Ev.SalvageCollect)[0];
    expect(w.events.chain(c.id).sentence).toMatch(/killed the .*which dropped a salvage crate, which paid \d+ Scrap\./);
  });
});
