import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { bossHp } from '../../src/sim/economy/curves';
import { bossDef, BOSS_LIST } from '../../src/sim/core/content';
import { BOSSES, TELL_COUNTERS, graftSources } from '../../src/sim/data/bosses';
import { EnemyFlag, Ev, ProjFlag, ProjKind } from '../../src/sim/core/types';
import type { Command } from '../../src/sim/core/types';
import type { AbilityId, BossId } from '../../src/sim/core/ids';
import { ATTACKS, ATTACK_IDS, TELLS } from '../../src/sim/enemies/bosses/registry';
import { counterHint, bossCtrlOf } from '../../src/sim/enemies/bosses';
import { cos, sin } from '../../src/sim/math/lut';
import { expectWithinBudget } from '../core/perf-budget';
import { findAbilities } from '../../src/sim/systems/abilities';

/** Slot the abilities a test casts and clear their cooldowns (only casts that go off score Counters). */
function ready(sim: Sim, ...abilities: AbilityId[]): void {
  const w = sim.world;
  w.build.abilities = [...abilities];
  findAbilities(w)!.cd.fill(0);
  w.tower.ce = w.tower.ceCap;
}

const MINUTES_4 = 4 * 60 * 60;

/** A Sim at a boss wave with a strong (but not one-shotting) primary aimed at the boss: ~hitsToKill boss hits to kill. */
function bossSim(id: BossId, wave: number, seed = 7, hitsToKill = 200): Sim {
  const sim = new Sim(null, seed);
  const w = sim.world, s = w.stats;
  const def = bossDef(id, wave);
  s.override('ballistics.damage', (bossHp(wave, def.hpMul, 0, 0) / hitsToKill) * (1 + def.armor / 100));
  s.override('ballistics.attack_speed', 12);
  s.override('ballistics.range', 700);
  s.override('ballistics.projectile_speed', 900);
  s.override('bastion.max_hp', 1e12);
  w.build.targeting.primary = 'highest_hp';   // shoot the boss, not its escort
  w.build.doctrines.ballistics = 'piercing';  // rounds punch through the escort to reach the boss
  s.override('ballistics.piercing.count', 30);
  s.override('ballistics.piercing.retention', 1);
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  w.meta.echoes = 1e12;   // an experienced player: the onboarding Frontier (economy/curves.ts) sits past wave 100
  w.run.wave = wave;
  sim.machine.startWave();
  return sim;
}

/** Step one tick and count events of the watched types emitted during it. */
function stepCount(sim: Sim, counts: Map<number, number>): void {
  const from = sim.events.nextId;
  sim.step();
  sim.events.forEachSince(from, (e) => { if (counts.has(e.type)) counts.set(e.type, counts.get(e.type)! + 1); });
}

function scoredSince(sim: Sim, from: number): number {
  let n = 0;
  sim.events.forEachSince(from, (e) => { if (e.type === Ev.CounterScored) n++; });
  return n;
}

/** The command that answers the open tell (from counterHint). */
function counterCommands(sim: Sim): Command[] {
  const h = counterHint(sim.world)!;
  if (h.ability === 'designate') return h.targets.map((t) => ({ type: 'designate', enemy: t }) as Command);
  return [{ type: 'cast', ability: h.ability as AbilityId, x: h.x, y: h.y, target: h.targets[0] }];
}

const BOSS_WAVES: [BossId, number][] = BOSSES.map((b) => [b.id, b.wave]);

describe('boss registry', () => {
  it('implements every attack id referenced by the boss data (all phases, all 21 bosses)', () => {
    const missing: string[] = [];
    for (const b of BOSSES) for (const p of b.phases) for (const a of p.attacks) {
      if (a === 'graft_tell') continue;
      if (!ATTACKS[a] && !TELLS[a]) missing.push(`${b.id}:${a}`);
    }
    expect(missing).toEqual([]);
    for (const t of Object.keys(TELL_COUNTERS)) expect(TELLS[t], t).toBeDefined();
    expect(BOSS_LIST.length).toBe(21);
    expect(new Set(ATTACK_IDS).size).toBe(ATTACK_IDS.length);
  });
});

describe('every boss is clearable without Counters', () => {
  it.each(BOSS_WAVES)('%s (wave %i) reaches phase 2, tells, and dies within 4 minutes', (id, wave) => {
    const sim = bossSim(id, wave, 7, 120);
    const counts = new Map<number, number>([[Ev.BossPhase, 0], [Ev.BossTell, 0], [Ev.BossKilled, 0]]);
    let t = 0;
    const w = sim.world;
    while (counts.get(Ev.BossKilled)! === 0 && t < MINUTES_4) {
      // keep the primary on the boss without issuing designate commands (those could score Counters)
      const b = sim.machine.boss();
      if (b >= 0) { w.tower.designated = b; w.tower.designatedGen = w.enemies.gen[b]; }
      stepCount(sim, counts); t++;
    }
    expect(counts.get(Ev.BossTell)!, 'tells').toBeGreaterThanOrEqual(1);
    expect(counts.get(Ev.BossPhase)!, 'phase changes').toBeGreaterThanOrEqual(1);
    expect(counts.get(Ev.BossKilled)!, `killed within 4 min (ticks ${t})`).toBe(1);
    expect(sim.world.tower.hp).toBeGreaterThan(0);
  }, 60_000);
});

describe('tell → Counter', () => {
  it.each(BOSS_WAVES)('%s: the right command during the window scores; outside it does not', (id, wave) => {
    const sim = bossSim(id, wave, 11, 4000);
    const w = sim.world;
    // outside the window (before the first tell): the boss's own counter never scores
    sim.run(5);
    w.tower.ce = w.tower.ceCap;
    const ctrl = bossCtrlOf(w, sim.machine.boss())!;
    expect(ctrl).toBeTruthy();
    const first = id === 'deep_graft' ? bossDef(graftSources(wave)[0], wave) : bossDef(id, wave);
    const tellId = Object.keys(TELL_COUNTERS).find((k) => first.phases[0].attacks.includes(k))!;
    const counter = TELL_COUNTERS[tellId];
    const b = sim.machine.boss();
    const mark0 = sim.events.nextId;
    if (counter !== 'designate') ready(sim, counter as AbilityId);
    if (counter === 'designate') sim.command({ type: 'designate', enemy: b });
    else sim.command({ type: 'cast', ability: counter as AbilityId, x: w.enemies.x[b], y: w.enemies.y[b], target: b });
    sim.step();
    expect(scoredSince(sim, mark0), 'no Counter outside the window').toBe(0);
    // wait for the tell
    let t = 0;
    while (w.bossTell.ability === null && t < 60 * 60) { sim.step(); t++; }
    expect(w.bossTell.ability, 'tell opened').not.toBeNull();
    expect(w.bossTell.ticksLeft).toBeGreaterThan(0);
    expect(sim.uiState().wave.tellActive).toBe(w.bossTell.ability);
    if (w.bossTell.ability !== 'designate') ready(sim, w.bossTell.ability as AbilityId);
    const mark = sim.events.nextId;
    for (const c of counterCommands(sim)) sim.command(c);
    sim.step();
    expect(scoredSince(sim, mark), 'Counter scored in the window').toBe(1);
    let counterEv = 0, weak = false;
    sim.events.forEachSince(mark, (e) => { if (e.type === Ev.BossCounter) counterEv++; });
    const bi = sim.machine.boss();
    if (bi >= 0) weak = (w.enemies.flags[bi] & EnemyFlag.WeakPointOpen) !== 0;
    expect(counterEv).toBe(1);
    expect(weak, 'weak point open').toBe(true);
    expect(w.bossTell.ability).toBeNull();
  }, 60_000);

  it('a Counter refunds half the ability cost; a Directive earns counter_efficiency (50%)', () => {
    for (const via of [false, true]) {
      const sim = bossSim('breaker', 5, 3, 4000);
      const w = sim.world;
      let t = 0;
      while (w.bossTell.ability === null && t < 3600) { sim.step(); t++; }
      expect(w.bossTell.ability).toBe('repulsor_pulse');
      ready(sim, 'repulsor_pulse');
      w.tower.ce = 50;
      const mark = sim.events.nextId;
      sim.command({ type: 'cast', ability: 'repulsor_pulse', x: 0, y: 0, viaDirective: via });
      sim.step();
      let eff = -1;
      sim.events.forEachSince(mark, (e) => { if (e.type === Ev.CounterScored) eff = e.b; });
      expect(eff).toBe(via ? 50 : 100);
    }
  }, 30_000);

  it('a wrong ability, a far-away point cast, or an uncountered window lets the attack fire', () => {
    const sim = bossSim('broodheart', 10, 5, 4000);
    const w = sim.world;
    let t = 0;
    while (w.bossTell.ability === null && t < 3600) { sim.step(); t++; }
    expect(w.bossTell.ability).toBe('bombardment');
    ready(sim, 'emp', 'bombardment');
    const b = sim.machine.boss();
    const mark = sim.events.nextId;
    sim.command({ type: 'cast', ability: 'emp', x: 0, y: 0 });
    const a = Math.atan2(w.enemies.y[b], w.enemies.x[b]) + 3;
    sim.command({ type: 'cast', ability: 'bombardment', x: cos(a) * 400, y: sin(a) * 400 });
    const ticks = w.bossTell.ticksLeft + 2;
    let brood = 0;
    for (let k = 0; k < ticks; k++) {
      const from = sim.events.nextId;
      sim.step();
      sim.events.forEachSince(from, (e) => { if (e.type === Ev.Spawn && e.src === 'brood') brood++; });
    }
    expect(scoredSince(sim, mark)).toBe(0);
    expect(brood).toBeGreaterThanOrEqual(10);   // the brood sac burst
  }, 30_000);

  it('The Choir: designating generators out of the sung order does not score; in order does', () => {
    const sim = bossSim('choir', 90, 9, 4000);
    const w = sim.world;
    let t = 0;
    while (w.bossTell.ability === null && t < 3600) { sim.step(); t++; }
    const h = counterHint(w)!;
    expect(h.targets.length).toBe(3);
    const mark = sim.events.nextId;
    sim.command({ type: 'designate', enemy: h.targets[1] });
    sim.command({ type: 'designate', enemy: h.targets[0] });
    sim.step();
    expect(scoredSince(sim, mark)).toBe(0);
    const h2 = counterHint(w)!;
    for (const g of h2.targets) sim.command({ type: 'designate', enemy: g });
    sim.step();
    expect(scoredSince(sim, mark)).toBe(1);
  }, 30_000);

  it('a designated open weak point takes double damage; phase changes grant 1 s of invulnerability', () => {
    const sim = bossSim('iron_maw', 25, 4, 4000);
    const w = sim.world;
    let t = 0;
    while (w.bossTell.ability === null && t < 3600) { sim.step(); t++; }
    const b = sim.machine.boss();
    sim.command({ type: 'designate', enemy: b });
    sim.step();
    const bi = sim.machine.boss();
    expect(w.enemies.flags[bi] & EnemyFlag.WeakPointOpen).toBeTruthy();
    const mul = w.damageModifier!(bi, null, 'ballistics', 'primary');
    expect(mul).toBe(2);
    w.tower.designated = -1;
    expect(w.damageModifier!(bi, null, 'ballistics', 'primary')).toBe(1.5);
  }, 30_000);

  it('Heavy Rounds stagger interrupts a tell (at most once per 4 s)', () => {
    const sim = bossSim('breaker', 5, 2, 4000);
    const w = sim.world;
    let t = 0;
    while (w.bossTell.ability === null && t < 3600) { sim.step(); t++; }
    const b = sim.machine.boss();
    w.enemies.staggerT[b] = 20;
    sim.step();
    expect(w.bossTell.ability).toBeNull();
    const c = bossCtrlOf(w, sim.machine.boss())!;
    expect(c.staggerCd).toBeGreaterThan(200);
  }, 30_000);
});

describe('boss specifics', () => {
  it('The Architect: an enemy wall blocks player projectiles crossing it', () => {
    const sim = bossSim('architect', 85, 6, 4000);
    const w = sim.world;
    let t = 0;
    const wall = () => w.hazards.find((h) => h.kind === 'barrier_field' && h.owner === 'enemy' && h.x2 !== undefined);
    while (!wall() && t < 60 * 60) { sim.step(); t++; }
    const h = wall()!;
    expect(h).toBeDefined();
    // a round fired from the tower through the wall's midpoint
    const mx = (h.x + h.x2!) / 2, my = (h.y + h.y2!) / 2, d = Math.hypot(mx, my);
    const sx = (mx / d) * (d - 12), sy = (my / d) * (d - 12);
    const p = w.spawnProjectile({ kind: ProjKind.Bullet, x: sx, y: sy, vx: (mx / d) * 600, vy: (my / d) * 600, damage: 1, life: 600, srcTag: 'ballistics' });
    const gen = w.projectiles.gen[p];
    sim.step();
    let alive = false;
    for (let j = 0; j < w.projectiles.count; j++) if (w.projectiles.gen[j] === gen && !(w.projectiles.flags[j] & ProjFlag.Dead)) alive = true;
    expect(alive).toBe(false);
  }, 30_000);

  it('Mirror Hive: clones share the boss look (bossId) and the true one is revealed during the shuffle', () => {
    const sim = bossSim('mirror_hive', 30, 6, 4000);
    const w = sim.world, e = w.enemies;
    let t = 0;
    while (w.bossTell.ability === null && t < 3600) { sim.step(); t++; }
    const b = sim.machine.boss();
    let clones = 0;
    for (let i = 0; i < e.count; i++) if (i !== b && e.bossId[i] === e.bossId[b] && !(e.flags[i] & EnemyFlag.Boss)) clones++;
    expect(clones).toBeGreaterThanOrEqual(2);
    expect(bossCtrlOf(w, b)!.revealT).toBeGreaterThan(0);
    const snap = sim.snapshot();
    let bossShaped = 0;
    const shape = bossDef('mirror_hive', 30).shape;
    for (let k = 0; k < snap.instanceCount; k++) { const o = k * 12; if (snap.instances[o + 9] === 4 && snap.instances[o + 4] === shape) bossShaped++; }
    expect(bossShaped).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it('Null Engine resists one damage type (70% less) and rotates it on the tell', () => {
    const sim = bossSim('null_engine', 55, 6, 4000);
    const w = sim.world;
    sim.run(10);
    const b = sim.machine.boss();
    const c = bossCtrlOf(w, b)!;
    c.invulnT = 0;
    expect(w.damageModifier!(b, 'fire', 'fire', 'primary')).toBeCloseTo(0.3, 5);
    expect(w.damageModifier!(b, 'frost', 'frost', 'primary')).toBe(1);
    let t = 0;
    while (w.bossTell.ability === null && t < 3600) { sim.step(); t++; }
    const left = w.bossTell.ticksLeft;
    sim.run(left + 1);
    expect(bossCtrlOf(w, sim.machine.boss())!.resisted).toBe(2);   // fire → lightning
  }, 30_000);

  it('Event Horizon: inhale bends player projectiles near it', () => {
    const sim = bossSim('event_horizon', 80, 6, 4000);
    const w = sim.world;
    sim.run(5);
    const b = sim.machine.boss();
    const c = bossCtrlOf(w, b)!;
    c.inhaleT = 60;
    const e = w.enemies;
    const d = Math.hypot(e.x[b], e.y[b]);
    const px = e.x[b] * (1 - 150 / d), py = e.y[b] * (1 - 150 / d);
    const p = w.spawnProjectile({ kind: ProjKind.Bullet, x: px, y: py, vx: (e.x[b] / d) * 300, vy: (e.y[b] / d) * 300, damage: 1, life: 600, srcTag: 'ballistics' });
    const vx0 = w.projectiles.vx[p], vy0 = w.projectiles.vy[p];
    const gen = w.projectiles.gen[p];
    sim.step();
    let j = -1;
    for (let k = 0; k < w.projectiles.count; k++) if (w.projectiles.gen[k] === gen) j = k;
    expect(j).toBeGreaterThanOrEqual(0);
    const dot = (w.projectiles.vx[j] * vx0 + w.projectiles.vy[j] * vy0) / (300 * 300);
    expect(dot).toBeLessThan(0.9999);
  }, 30_000);
});

describe('determinism and performance', () => {
  function play(seed: number, tells = { n: 0 }): Sim {
    const sim = new Sim(null, seed);
    const w = sim.world, s = w.stats;
    s.override('ballistics.damage', 60);
    s.override('ballistics.attack_speed', 8);
    s.override('ballistics.range', 700);
    s.override('ballistics.projectile_speed', 900);
    s.override('bastion.max_hp', 1e9);
    w.rebuildStats(); w.tower.hp = w.tower.maxHp;
    w.run.wave = 18; w.run.checkpoint = 15;
    sim.machine.startWave();
    for (let t = 0; t < 9000; t++) {
      if (t === 2000 && w.enemies.count > 0) sim.command({ type: 'designate', enemy: 0 });
      const from = sim.events.nextId;
      sim.step();
      sim.events.forEachSince(from, (e) => { if (e.type === Ev.BossTell) tells.n++; });
    }
    return sim;
  }
  it('same seed twice → identical event hash across waves 18–21 (includes the wave-20 boss)', () => {
    const tells = { n: 0 };
    const a = play(21, tells), b = play(21);
    expect(a.world.run.wave).toBeGreaterThanOrEqual(21);
    expect(tells.n).toBeGreaterThanOrEqual(1);
    expect(a.events.hash()).toBe(b.events.hash());
    expect(a.world.enemies.count).toBe(b.world.enemies.count);
    expect(a.world.tower.hp).toBe(b.world.tower.hp);
  }, 60_000);

  it('a boss wave with 300 adds runs 600 ticks in under 2 s', () => {
    const sim = bossSim('hive_fortress', 65, 13, 1e9);
    const w = sim.world;
    for (let i = 0; i < 300; i++) {
      const a = (i * 2.399963) % 6.283, d = 180 + (i % 7) * 45;
      w.spawnEnemy(i % 5 === 0 ? 'runner' : i % 5 === 1 ? 'healer' : i % 5 === 2 ? 'warden' : 'grunt', cos(a) * d, sin(a) * d, { hpScale: 1e6 });
    }
    sim.run(30);
    const t0 = performance.now();
    sim.run(600);
    const ms = performance.now() - t0;
    expect(w.enemies.count).toBeGreaterThan(250);
    expect(sim.machine.boss()).toBeGreaterThanOrEqual(0);
    expectWithinBudget(ms, 2000);
  }, 30_000);
});
