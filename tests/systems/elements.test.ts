import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { Ev, EnemyFlag, ProjKind } from '../../src/sim/core/types';
import { cos, sin } from '../../src/sim/math/lut';
import type { ElementsSystem } from '../../src/sim/systems/elements';
import { quietSim, setup, plugin, events, ticks, grunt } from './wp2-helpers';
import { expectWithinBudget } from '../core/perf-budget';

const ALL = ['fire', 'lightning', 'poison', 'frost'] as const;

describe('Elements: base procs on primary hits', () => {
  it('Fire: primary hits ignite with burn dps from the hit and the fire.burn_stacks cap', () => {
    const sim = setup(quietSim(), { elements: ['fire'], overrides: { 'fire.burn_chance': 1 } });
    const w = sim.world;
    const i = grunt(sim, 100, 0);
    ticks(sim, 90);
    expect(w.enemies.burn[i]).toBeGreaterThan(0);
    const apply = events(sim, (e) => e.type === Ev.StatusApply && e.src === 'fire')[0];
    const parent = w.events.byId(apply.cause)!;
    expect(parent.type).toBe(Ev.Hit);
    expect(parent.src).toBe('ballistics');
    expect(w.enemies.burnDps[i]).toBeCloseTo(0.2 * parent.b, 3);
    expect(w.statusCap('burn')).toBe(3);
    w.applyStatus(i, 'burn', 9, 600, 'fire', -1, 1);
    expect(w.enemies.burn[i]).toBe(3);
  });

  it('Lightning: arcs chain from the struck enemy, one Hit per link caused by the previous link, no revisits', () => {
    const sim = setup(quietSim(), { elements: ['lightning'], overrides: { 'lightning.arc_chance': 1, 'lightning.arc_targets': 3 } });
    const w = sim.world;
    grunt(sim, 100, 0); grunt(sim, 170, 0); grunt(sim, 240, 0); grunt(sim, 310, 0);
    ticks(sim, 60);
    const firstGun = events(sim, (e) => e.type === Ev.Hit && e.src === 'ballistics')[0];
    const links = events(sim, (e) => e.type === Ev.Hit && e.src === 'lightning');
    expect(links.length).toBeGreaterThanOrEqual(3);
    // walk the first chain: link1.cause = gun hit, link2.cause = link1, link3.cause = link2
    const l1 = links.find((e) => e.cause === firstGun.id)!;
    const l2 = links.find((e) => e.cause === l1.id)!;
    const l3 = links.find((e) => e.cause === l2.id)!;
    expect(l1 && l2 && l3).toBeTruthy();
    const struck = new Set([firstGun.a, l1.a, l2.a, l3.a]);
    expect(struck.size).toBe(4);
    expect(l2.b).toBeCloseTo(l1.b * 0.9, 3);                       // ARC_DECAY per jump
    expect(w.events.byId(w.events.byId(l2.cause)!.cause)!.src).toBe('ballistics');
  });

  it('Lightning: the Inspector sentence of an arc kill names the lightning', () => {
    const sim = setup(quietSim(), { elements: ['lightning'], overrides: { 'lightning.arc_chance': 1 } });
    grunt(sim, 100, 0);
    grunt(sim, 150, 0, 0.001);
    ticks(sim, 60);
    const kill = events(sim, (e) => e.type === Ev.Kill && e.src === 'lightning')[0];
    expect(kill).toBeTruthy();
    const { sentence, chain } = sim.inspect(kill.id);
    expect(chain[0].src).toBe('ballistics');
    expect(sentence).toMatch(/lightning/);
    expect(sentence).toMatch(/^The gun shot/);
  });

  it('Poison: application stacks with poison.damage × primary damage per stack', () => {
    const sim = setup(quietSim(), { elements: ['poison'], overrides: { 'poison.application': 2 } });
    const w = sim.world;
    const i = grunt(sim, 100, 0);
    ticks(sim, 50);
    expect(w.enemies.poison[i]).toBeGreaterThanOrEqual(2);
    expect(w.enemies.poisonDps[i]).toBeCloseTo(0.16 * w.stats.get('ballistics.damage'), 4);
    expect(w.statusCap('poison')).toBe(10);
  });

  it('Frost: chill stacks slow movement by frost.slow_per_stack', () => {
    const sim = setup(quietSim(), { elements: ['frost'], overrides: { 'frost.chill_chance': 1 } });
    const w = sim.world;
    const i = grunt(sim, 100, 0);
    ticks(sim, 50);
    expect(w.enemies.chill[i]).toBeGreaterThan(0);
    ticks(sim, 1);
    expect(w.enemies.speedMul[i]).toBeCloseTo(1 - 0.06 * w.enemies.chill[i], 4);
  });

  it('hardpoint hits proc only the element they carry (Infusion contract)', () => {
    const sim = setup(quietSim(), { elements: ['fire', 'frost'], overrides: { 'fire.burn_chance': 1, 'frost.chill_chance': 1 } });
    const w = sim.world;
    const a = grunt(sim, 200, 200), b = grunt(sim, -200, 200);
    w.damage(a, 5, { source: 'blade', srcTag: 'infuse.blade.fire', element: 'fire', cause: -1 });
    w.damage(b, 5, { source: 'blade', srcTag: 'blade', element: null, cause: -1 });
    expect(w.enemies.burn[a]).toBe(1);
    expect(w.enemies.chill[a]).toBe(0);
    expect(w.enemies.burn[b]).toBe(0);
    w.damage(b, 5, { source: 'status', srcTag: 'burn', element: 'fire', cause: -1 });   // DoTs never proc
    expect(w.enemies.burn[b]).toBe(0);
  });
});

describe('Elements: doctrines', () => {
  it('Wildfire Flashpoint erupts at max Burn and spreads stacks; spread_on_death passes Burn on', () => {
    const sim = setup(quietSim(), { elements: ['fire'], doctrines: { fire: 'wildfire' }, ranks: { 'fire.wildfire.flashpoint': 1, 'fire.spread_on_death': 1, 'fire.burn_chance': 1 } });
    const w = sim.world;
    const a = grunt(sim, 200, 200), b = grunt(sim, 230, 200);
    w.rebuildSpatial();
    w.applyStatus(a, 'burn', 3, 600, 'fire', -1, 5);
    expect(events(sim, (e) => e.type === Ev.Explosion && e.src === 'fire.flashpoint').length).toBe(0);   // queued
    ticks(sim, 1);                                                                                   // detonates next update
    expect(events(sim, (e) => e.type === Ev.Explosion && e.src === 'fire.flashpoint').length).toBe(1);
    w.applyStatus(a, 'burn', 1, 600, 'fire', -1, 5);                                                  // refresh at max: no re-eruption
    ticks(sim, 1);
    expect(events(sim, (e) => e.type === Ev.Explosion && e.src === 'fire.flashpoint').length).toBe(1);
    expect(w.enemies.burn[b]).toBe(1);
    const c = grunt(sim, -200, -200, 0.001), d = grunt(sim, -230, -200);
    w.rebuildSpatial();
    w.applyStatus(c, 'burn', 1, 600, 'fire', -1, 5);
    w.damage(c, 1e6, { source: 'ability', srcTag: 'x', cause: -1 });
    expect(w.enemies.burn[d]).toBe(1);
  });

  it('Inferno converts every Nth primary bullet into a Fireball; Meteor Round leaves a burning zone', () => {
    const sim = setup(quietSim(), { elements: ['fire'], doctrines: { fire: 'inferno' },
      ranks: { 'fire.inferno.fireball_every': 3, 'fire.meteor_round': 1, 'fire.inferno.sunburst': 1 }, overrides: { 'fire.meteor_round.every': 1, 'ballistics.attack_speed': 8 } });
    const w = sim.world;
    grunt(sim, 150, 0);
    let fireballs = 0;
    for (let t = 0; t < 120; t++) { ticks(sim, 1); for (let p = 0; p < w.projectiles.count; p++) if (w.projectiles.kind[p] === ProjKind.Fireball) fireballs++; }
    expect(fireballs).toBeGreaterThan(0);
    expect(events(sim, (e) => e.type === Ev.Explosion && e.src === 'fire.meteor_round').length).toBeGreaterThan(0);
    expect(w.hazards.some((h) => h.kind === 'fire_zone' && h.srcTag === 'fire.meteor_round')).toBe(true);
    expect(events(sim, (e) => e.type === Ev.StatusApply && e.src === 'fire').length).toBeGreaterThan(0);
    const shots = events(sim, (e) => e.type === Ev.Hit && e.src === 'ballistics').length;
    const booms = events(sim, (e) => e.type === Ev.Explosion && e.src === 'fire.meteor_round').length;
    expect(shots).toBeGreaterThanOrEqual(booms * 2);                 // every 4th bullet at rank 3
  });

  it('Chain: Static Charge amplifies and is consumed by the next weapon hit; Discharge arcs from dying carriers', () => {
    const sim = setup(quietSim(), { elements: ['lightning'], doctrines: { lightning: 'chain' },
      ranks: { 'lightning.chain.static_charge': 5, 'lightning.chain.discharge': 1 }, overrides: { 'lightning.arc_chance': 0 } });
    const w = sim.world;
    const el = plugin<ElementsSystem>(sim, 'elements');
    const a = grunt(sim, 200, 200), b = grunt(sim, 260, 200);
    w.rebuildSpatial();
    el.arcs.chain(w, a, w.enemies.x[a], w.enemies.y[a], 1, 10, -1);
    expect(w.enemies.staticStacks[b]).toBe(1);
    const plain = w.damage(a, 10, { source: 'primary', srcTag: 'ballistics', cause: -1 }).damage;
    const charged = w.damage(b, 10, { source: 'primary', srcTag: 'ballistics', cause: -1 }).damage;
    expect(charged / plain).toBeCloseTo(1.2, 4);
    expect(w.enemies.staticStacks[b]).toBe(0);
    const c = grunt(sim, -200, -200, 0.001), d = grunt(sim, -250, -200);
    w.rebuildSpatial();
    w.applyStatus(c, 'static', 1, 240, 'lightning', -1);
    w.damage(c, 1e6, { source: 'primary', srcTag: 'ballistics', cause: -1 });
    const kill = events(sim, (e) => e.type === Ev.Kill && e.a === c)[0];
    expect(events(sim, (e) => e.type === Ev.Hit && e.src === 'lightning' && e.a === d && e.cause === kill.id).length).toBe(1);
  });

  it('Storm: Ball Lightning zaps enemies near it; Supercell starts a storm after enough arcs', () => {
    const sim = setup(quietSim(), { elements: ['lightning'], doctrines: { lightning: 'storm' },
      ranks: { 'lightning.storm.ball_lightning': 2, 'lightning.supercell': 1 }, overrides: { 'lightning.arc_chance': 1, 'lightning.supercell.arcs': 4 } });
    for (let k = 0; k < 12; k++) grunt(sim, cos(k * 0.52) * 60, sin(k * 0.52) * 60);
    ticks(sim, 300);
    expect(events(sim, (e) => e.type === Ev.Hit && e.src === 'lightning.ball').length).toBeGreaterThan(0);
    expect(events(sim, (e) => e.type === Ev.Fx && e.src === 'lightning.supercell').length).toBeGreaterThan(0);
    expect(events(sim, (e) => e.type === Ev.Hit && e.src === 'lightning.supercell').length).toBeGreaterThan(0);
  });

  it('Storm Arc Anchor bends arcs through elites and bosses', () => {
    const sim = setup(quietSim(), { elements: ['lightning'], doctrines: { lightning: 'storm' }, ranks: { 'lightning.storm.arc_anchor': 1 } });
    const w = sim.world;
    const a = grunt(sim, 200, 0), near = grunt(sim, 240, 0);
    const elite = w.spawnEnemy('grunt', 300, 0, { hpScale: 1000, elite: ['hardened'] });
    w.rebuildSpatial();
    plugin<ElementsSystem>(sim, 'elements').arcs.chain(w, a, 200, 0, 1, 10, -1);
    const link = events(sim, (e) => e.type === Ev.Hit && e.src === 'lightning')[0];
    expect(link.a).toBe(elite);
    expect(near).not.toBe(elite);
  });

  it('Plague: Contagion jumps stacks on death; Plague Carrier seeds neighbors and passes on; Pandemic seeds from elites', () => {
    const sim = setup(quietSim(), { elements: ['poison'], doctrines: { poison: 'plague' },
      ranks: { 'poison.plague.contagion': 2, 'poison.plague.plague_carrier': 1 }, overrides: { 'ballistics.range': 1 } });
    const w = sim.world;
    const a = grunt(sim, 200, 200, 0.001), b = grunt(sim, 240, 200);
    w.rebuildSpatial();
    w.applyStatus(a, 'poison', 6, 600, 'poison', -1, 1);
    w.damage(a, 1e6, { source: 'ability', srcTag: 'x', cause: -1 });
    expect(w.enemies.poison[b]).toBe(Math.round(6 * 0.6));
    ticks(sim, 1);
    // carrier: the most-poisoned enemy seeds everything within 70 u every second
    const x = grunt(sim, -200, -200), y = grunt(sim, -240, -200), v = grunt(sim, -250, -268);
    const vGen = w.enemies.gen[v];
    w.applyStatus(x, 'poison', 8, 6000, 'poison', -1, 1);
    ticks(sim, 61);
    expect(w.enemies.poison[y]).toBe(1);
    expect(w.enemies.poison[v]).toBe(0);                                   // ~85 u from the carrier, ~68 u from y
    w.damage(x, 1e9, { source: 'ability', srcTag: 'x', cause: -1 });      // Contagion makes y the most poisoned: it carries now
    ticks(sim, 60);
    expect(w.enemies.poison[w.resolveEnemy(v, vGen)]).toBeGreaterThan(0);
    expect(events(sim, (e) => e.type === Ev.StatusApply && e.src === 'poison.plague_carrier').length).toBeGreaterThan(1);

    const s2 = setup(quietSim(), { elements: ['poison'], ranks: { 'poison.pandemic': 1 }, overrides: { 'ballistics.range': 1 } });
    const w2 = s2.world;
    const elite = w2.spawnEnemy('grunt', -250, 0, { hpScale: 1000, elite: ['hardened'] });
    const f = grunt(s2, -280, 0), g = grunt(s2, 250, 0);
    w2.applyStatus(elite, 'poison', 8, 6000, 'poison', -1, 1);
    ticks(s2, 121);
    expect(w2.enemies.poison[f]).toBeGreaterThanOrEqual(4);
    expect(w2.enemies.poison[g]).toBeGreaterThanOrEqual(4);                                 // the 2 nearest, anywhere in the arena
    expect(events(s2, (e) => e.type === Ev.StatusApply && e.src === 'poison.pandemic').length).toBeGreaterThan(0);
  });

  it('Venom: Virulence and Corrosion raise damage; Toxic Burst detonates remaining poison at the cap', () => {
    const sim = setup(quietSim(), { elements: ['poison'], doctrines: { poison: 'venom' },
      ranks: { 'poison.venom.virulence': 5, 'poison.venom.corrosion': 3, 'poison.venom.toxic_burst': 1 } });
    const w = sim.world;
    const a = grunt(sim, 200, 200), b = grunt(sim, -200, 200);
    w.enemies.armor[a] = 100; w.enemies.armor[b] = 100;
    w.applyStatus(a, 'poison', 9, 600, 'poison', -1, 1);
    const hurt = w.damage(a, 100, { source: 'primary', srcTag: 'ballistics', cause: -1 }).damage;
    const clean = w.damage(b, 100, { source: 'primary', srcTag: 'ballistics', cause: -1 }).damage;
    expect(hurt / clean).toBeCloseTo(200 / (100 + 100 * (1 - 0.27)), 3);   // 9 stacks × 3% armor stripped
    const dotA = w.damage(a, 10, { source: 'status', srcTag: 'poison', cause: -1, ignoreArmor: true }).damage;
    expect(dotA).toBeCloseTo(10 * (1 + w.stats.get('poison.venom.virulence') * 4), 3);   // virulence (base 0.03 + 5 × 0.02) × (9 − 5)
    w.applyStatus(a, 'poison', 1, 600, 'poison', -1, 1);                  // reaches cap 10 → burst
    expect(events(sim, (e) => e.type === Ev.Hit && e.src === 'poison.toxic_burst').length).toBe(1);
    expect(w.enemies.poison[a]).toBe(5);
  });

  it('Control: Deep Freeze at max Chill with lockout, bosses slowed instead; Permafrost sheds one stack at a time; Glacial Shot', () => {
    const sim = setup(quietSim(), { elements: ['frost'], doctrines: { frost: 'control' },
      ranks: { 'frost.control.deep_freeze': 1, 'frost.control.permafrost': 1, 'frost.control.glacial_shot': 1 } });
    const w = sim.world, e = w.enemies;
    const a = grunt(sim, 300, 300);
    w.applyStatus(a, 'chill', 5, 30, 'frost', -1);
    expect(e.frozenT[a]).toBe(36);
    e.frozenT[a] = 0;
    w.applyStatus(a, 'chill', 5, 30, 'frost', -1);
    expect(e.frozenT[a]).toBe(0);                                          // 5 s lockout
    ticks(sim, 31);
    expect(e.chill[a]).toBe(4);                                            // Permafrost: one stack falls
    const boss = w.spawnEnemy('grunt', -300, 300, { hpScale: 1000 });
    e.flags[boss] |= EnemyFlag.Boss;
    w.applyStatus(boss, 'chill', 5, 300, 'frost', -1);
    expect(e.frozenT[boss]).toBe(0);
    ticks(sim, 2);
    expect(e.speedMul[boss]).toBeLessThan(0.25 * (1 - 0.06 * 5) + 1e-6);
    // Glacial Shot: every 5th bullet pierces and applies max Chill
    grunt(sim, 100, 0);
    w.stats.override('ballistics.attack_speed', 10); w.rebuildStats();
    ticks(sim, 120);
    expect(events(sim, (ev) => ev.type === Ev.Hit && ev.src === 'frost.glacial_shot').length).toBeGreaterThan(0);
  });

  it('Shatter: max Chill makes enemies Brittle (+damage taken), Iceburst on death chills neighbors', () => {
    const sim = setup(quietSim(), { elements: ['frost'], doctrines: { frost: 'shatter' },
      ranks: { 'frost.shatter.brittle': 5, 'frost.shatter.iceburst': 1 } });
    const w = sim.world, e = w.enemies;
    const a = grunt(sim, 200, 200), b = grunt(sim, 240, 200), c = grunt(sim, -200, 200);
    w.rebuildSpatial();
    w.applyStatus(a, 'chill', 5, 300, 'frost', -1);
    expect(e.brittle[a]).toBe(1);
    const r = w.damage(a, 100, { source: 'primary', srcTag: 'ballistics', cause: -1 }).damage / w.damage(c, 100, { source: 'primary', srcTag: 'ballistics', cause: -1 }).damage;
    expect(r).toBeCloseTo(1.2, 4);
    w.damage(a, 1e9, { source: 'primary', srcTag: 'ballistics', cause: -1 });
    expect(events(sim, (ev) => ev.type === Ev.Explosion && ev.src === 'frost.iceburst').length).toBe(1);
    expect(e.chill[b]).toBe(3);
  });

  it('Absolute Zero: enemies at max Chill attack at half speed', () => {
    const sim = setup(quietSim(), { elements: ['frost'], ranks: { 'frost.absolute_zero': 1 } });
    const w = sim.world, e = w.enemies;
    const a = grunt(sim, 300, 300);
    w.applyStatus(a, 'chill', 5, 6000, 'frost', -1);
    e.attackT[a] = 100;
    for (let t = 0; t < 40; t++) { if (e.attackT[a] > 0) e.attackT[a]--; ticks(sim, 1); }   // emulate the AI's countdown
    expect(e.attackT[a]).toBe(80);
  });

  it('Catalyst: an elemental proc can trigger the other two', () => {
    const sim = setup(quietSim(), { elements: ['fire', 'lightning', 'poison'], ranks: { 'triad.catalyst': 1 },
      overrides: { 'triad.catalyst': 1, 'fire.burn_chance': 1, 'lightning.arc_chance': 0, 'poison.application': 0 } });
    const w = sim.world;
    const a = grunt(sim, 200, 200); grunt(sim, 250, 200);
    w.rebuildSpatial();
    w.damage(a, 10, { source: 'primary', srcTag: 'ballistics', cause: -1 });
    expect(events(sim, (e) => e.type === Ev.Triad && e.src === 'triad.catalyst').length).toBe(1);
    expect(w.enemies.poison[a]).toBeGreaterThan(0);
    expect(events(sim, (e) => e.type === Ev.Hit && e.src === 'lightning').length).toBeGreaterThan(0);
  });
});

function fullBuild(sim: Sim, variant: number): Sim {
  const d = variant === 0
    ? { fire: 'wildfire', lightning: 'chain', poison: 'venom', frost: 'control' } as const
    : { fire: 'inferno', lightning: 'storm', poison: 'plague', frost: 'shatter' } as const;
  const ranks: Record<string, number> = {
    'fire.burn_chance': 10, 'fire.burn_stacks': 3, 'fire.spread_on_death': 2, 'lightning.arc_chance': 10, 'lightning.arc_targets': 2,
    'poison.application': 10, 'poison.stack_cap': 5, 'frost.chill_chance': 10, 'frost.chill_stacks': 2,
    'fire.wildfire.flashpoint': 2, 'fire.wildfire.spread': 1, 'fire.inferno.fireball_every': 3, 'fire.inferno.crits_ignite': 2, 'fire.inferno.sunburst': 1,
    'lightning.chain.forked_current': 2, 'lightning.chain.static_charge': 5, 'lightning.chain.discharge': 1,
    'lightning.storm.ball_lightning': 2, 'lightning.storm.arc_anchor': 1, 'poison.venom.virulence': 5, 'poison.venom.corrosion': 3, 'poison.venom.toxic_burst': 1,
    'poison.plague.contagion': 2, 'poison.plague.plague_carrier': 1, 'frost.control.deep_freeze': 2, 'frost.control.permafrost': 2, 'frost.control.glacial_shot': 1,
    'frost.shatter.brittle': 5, 'frost.shatter.fracture': 2, 'frost.shatter.iceburst': 1,
    'fire.meteor_round': 1, 'lightning.supercell': 1, 'poison.pandemic': 1, 'frost.absolute_zero': 1,
  };
  for (const f of ['toxic_combustion', 'superconductivity', 'thermal_shock', 'electrolysis', 'plasma', 'cryotoxin']) ranks[`fusion.${f}`] = 3;
  for (const t of ['catalyst', 'polar_storm', 'crucible', 'cold_circuit']) ranks[`triad.${t}`] = 2;
  return setup(sim, { elements: [...ALL], doctrines: d, ranks });
}

describe('Elements: determinism and performance', () => {
  it('two fresh Sims with all four elements, doctrines, fusions and triads hash identically after 3000 ticks', () => {
    for (const variant of [0, 1]) {
      const run = (): [number, number] => {
        const sim = fullBuild(new Sim(null, 11), variant);
        sim.world.stats.override('bastion.max_hp', 1e7); sim.world.stats.override('ballistics.attack_speed', 6);
        sim.world.run.checkpoint = 15; sim.machine.startAttempt(false);      // a busy wave 16
        sim.run(3000);
        return [sim.events.hash(), sim.events.nextId];
      };
      const a = run(), b = run();
      expect(a[1]).toBeGreaterThan(1000);
      expect(a).toEqual(b);
    }
  });

  it('600 ticks with 800 enemies, all elements and fusions active, run under 4 s (smoke test)', () => {
    const sim = fullBuild(new Sim(null, 5), 0);
    const w = sim.world;
    w.stats.override('bastion.max_hp', 1e12); w.stats.override('ballistics.attack_speed', 12); w.stats.override('ballistics.range', 520);
    w.rebuildStats(); w.tower.hp = w.tower.maxHp;
    const r = w.prng;
    for (let i = 0; i < 800; i++) {
      const a = r.next() * 6.283, dd = 150 + r.next() * 350;
      const k = w.spawnEnemy(i % 3 === 0 ? 'swarm' : 'grunt', cos(a) * dd, sin(a) * dd, { hpScale: 1e9 });
      if (k >= 0) { w.applyStatus(k, 'poison', 3, 6000, 'poison', -1, 1); if (i % 2) w.applyStatus(k, 'burn', 2, 6000, 'fire', -1, 1); if (i % 5 === 0) w.applyStatus(k, 'chill', 2, 6000, 'frost', -1); }
    }
    sim.run(30);
    const t0 = performance.now();
    sim.run(600);
    const ms = performance.now() - t0;
    expect(w.enemies.count).toBeGreaterThan(700);
    expect(w.events.nextId).toBeGreaterThan(100_000);                      // the build really is busy
    expectWithinBudget(ms, 4000);
  });
});
