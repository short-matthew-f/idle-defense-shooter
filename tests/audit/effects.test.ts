/**
 * Claim-vs-behavior scenarios for the effects EFFECT-AUDIT.md found dead, approximated or mismatched (and fixed).
 * Each scenario builds the situation directly and asserts the observable outcome the description promises.
 * Items whose claims existing tests already pin down are listed in the doc with that test, not repeated here.
 */
import { describe, it, expect } from 'vitest';
import type { Sim } from '../../src/sim/index';
import { Ev, EnemyFlag, ProjKind, ProjFlag, TICK_RATE } from '../../src/sim/core/types';
import { quietSim, combatTick } from '../core/helpers';
import { setup, plugin, grunt, ticks } from '../systems/wp2-helpers';
import { socket, cmd } from '../progression/helpers';
import { offlineScrap } from '../../src/sim/economy/curves';
import { FOCAL_CHARGES, FOCAL_MUL } from '../../src/sim/systems/constellation';
import { AI_DASH, AI_WINDUP } from '../../src/sim/enemies/behaviors/kinds';
import { bossCtrlOf, stallCharge } from '../../src/sim/enemies/bosses';
import { MOVE_DASH } from '../../src/sim/enemies/bosses/state';

function evs(sim: Sim, type: number, src?: string): number {
  return sim.world.events.recent(0).filter((e) => e.type === type && (src === undefined || e.src === src)).length;
}
function combat(sim: Sim): Sim { sim.world.run.phase = 'combat'; return sim; }

describe('Reactor: Targeting Logic (was never read)', () => {
  function field(rank: number): Sim {
    const sim = setup(quietSim(), { ranks: { 'reactor.targeting_logic': rank } });
    const w = sim.world;
    const a = grunt(sim, 120, 0, 1), b = grunt(sim, 200, 0, 1);   // a: nearer, weak
    w.rebuildSpatial();
    // a round already in flight at `a` that will kill it
    w.spawnProjectile({ kind: ProjKind.Bullet, source: 0, srcTag: 'ballistics', x: 20, y: 0, vx: 400, vy: 0, damage: w.enemies.hp[a] * 2, radius: 3, life: 60, target: a, cause: -1 });
    void b;
    return sim;
  }
  it('rank 1: weapons skip an enemy already doomed by damage in flight (rank 0 does not)', () => {
    for (const [rank, want] of [[0, 0], [1, 1]] as const) {
      const sim = field(rank);
      const t = sim.world.nearestEnemy(0, 0, 400, 'nearest', 'primary');
      expect(t, `rank ${rank}`).toBe(want);
    }
  });
  it('rank 1: a doomed enemy is still shot when nothing else is in range', () => {
    const sim = field(1);
    expect(sim.world.nearestEnemy(0, 0, 150, 'nearest', 'primary')).toBe(0);
  });
  it('rank 3: hardpoints spread over distinct targets in a tick; the primary does not avoid', () => {
    const sim = setup(quietSim(), { ranks: { 'reactor.targeting_logic': 3 } });
    const w = sim.world;
    grunt(sim, 120, 0); grunt(sim, 200, 0);
    w.rebuildSpatial();
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'drones')).toBe(0);
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'ordnance')).toBe(1);
    expect(w.nearestEnemy(0, 0, 400, 'nearest', 'primary')).toBe(0);
    const s2 = setup(quietSim(), { ranks: { 'reactor.targeting_logic': 2 } });
    grunt(s2, 120, 0); grunt(s2, 200, 0); s2.world.rebuildSpatial();
    expect(s2.world.nearestEnemy(0, 0, 400, 'nearest', 'drones')).toBe(0);
    expect(s2.world.nearestEnemy(0, 0, 400, 'nearest', 'ordnance')).toBe(0);
  });
  it('rank 2: the primary leads a moving target exactly (rank 0 leads 60%)', () => {
    const aim = (rank: number): number => {
      const sim = setup(quietSim(), { ranks: { 'reactor.targeting_logic': rank }, overrides: { 'ballistics.attack_speed': 0.01 } });
      const w = sim.world;
      const e = grunt(sim, 250, 0);
      w.enemies.vy[e] = 120;
      w.rebuildSpatial();
      for (let k = 0; k < 30; k++) { w.enemies.x[e] = 250; w.enemies.y[e] = 0; w.enemies.vy[e] = 120; combatTick(sim); }
      return w.tower.aimAngle;
    };
    const tt = 250 / 420;
    expect(aim(2)).toBeCloseTo(Math.atan2(120 * tt, 250), 2);
    expect(aim(0)).toBeCloseTo(Math.atan2(120 * tt * 0.6, 250), 2);
  });
});

describe('Prestige: Long Patrol (ranks 2–4 did nothing)', () => {
  it('each rank adds 4 h of cap and 7.5 points of efficiency', () => {
    for (let r = 0; r <= 4; r++) {
      const sim = quietSim();
      const w = sim.world;
      if (r > 0) w.meta.prestigeRanks['prestige.long_patrol'] = r;
      w.rebuildStats();
      expect(w.stats.get('offline.cap_hours')).toBeCloseTo(8 + 4 * r, 9);
      expect(w.stats.get('offline.efficiency')).toBeCloseTo(0.4 + 0.075 * r, 9);
      w.run.patrolScrapPerSecond = 10;
      const before = w.run.scrap;
      cmd(sim, { type: 'offline_return', elapsedSeconds: 30 * 3600 });
      expect(w.run.scrap - before).toBe(Math.floor(10 * (8 + 4 * r) * 3600 * (0.4 + 0.075 * r)));
    }
    expect(offlineScrap(10, 30 * 3600, true)).toBe(Math.floor(10 * 24 * 3600 * 0.7));
  });
});

describe('Abilities', () => {
  it('Hunter Mark: statuses applied to the marked enemy gain +50% application (+25% per rank)', () => {
    for (const [rank, stacks] of [[0, 3], [2, 4]] as const) {
      const sim = combat(setup(quietSim(), { ranks: rank ? { 'ability.hunter_mark': rank } : {} }));
      const w = sim.world;
      w.build.abilities = ['hunter_mark'];
      const e = grunt(sim, 150, 0);
      w.rebuildSpatial();
      w.tower.ce = w.tower.ceCap;
      cmd(sim, { type: 'cast', ability: 'hunter_mark', x: 150, y: 0, target: e });
      w.applyStatus(e, 'chill', 2, 120, 'frost', -1);
      expect(w.enemies.chill[e], `rank ${rank}`).toBe(stacks);
      const o = grunt(sim, -150, 0);
      w.applyStatus(o, 'chill', 2, 120, 'frost', -1);
      expect(w.enemies.chill[o]).toBe(2);                // unmarked: unchanged
    }
  });
  it('Repulsor Pulse cancels a charge in progress; Time Field stalls a charge that enters it', () => {
    for (const ability of ['repulsor_pulse', 'time_field'] as const) {
      const sim = combat(quietSim());
      const w = sim.world;
      w.build.abilities = [ability];
      const c = w.spawnEnemy('charger', 120, 0, { cause: -1 });
      w.enemies.aiI[c] = AI_DASH | 1; w.enemies.aiA[c] = 60;
      w.rebuildSpatial();
      w.tower.ce = w.tower.ceCap;
      cmd(sim, { type: 'cast', ability, x: 120, y: 0 });
      if (ability === 'time_field') ticks(sim, 1);
      expect(w.enemies.aiI[c] & (AI_DASH | AI_WINDUP), ability).toBe(0);
    }
  });
  it('a boss mid-dash stalls (stallCharge) and deals no dash damage', () => {
    const sim = quietSim();
    const w = sim.world;
    w.run.wave = 20;
    const b = w.spawnEnemy('boss', 300, 0, { bossId: 'siege_engine', cause: -1 });
    sim.step();
    const c = bossCtrlOf(w, b)!;
    c.move = MOVE_DASH; c.mDmg = 999; c.mx = 30; c.my = 0; c.moveT = 100;
    expect(stallCharge(w, b)).toBe(true);
    expect(c.move).not.toBe(MOVE_DASH);
    expect(c.mDmg).toBe(0);
  });
  it('EMP cuts a boss tether and shield links for its duration', () => {
    const sim = combat(quietSim());
    const w = sim.world;
    w.run.wave = 45;
    w.build.abilities = ['emp'];
    const b = w.spawnEnemy('boss', 150, 0, { bossId: 'leech_queen', cause: -1 });
    combatTick(sim);
    const c = bossCtrlOf(w, b)!;
    c.tetherT = 200;
    w.tower.ce = w.tower.ceCap;
    cmd(sim, { type: 'cast', ability: 'emp', x: 0, y: 0 });
    expect(c.tetherT).toBe(0);
    expect(c.linkCutT).toBe(3 * TICK_RATE);
  });
  it('Drone Surge: the drones dive into an enemy and explode at the end', () => {
    const sim = combat(quietSim());
    const w = sim.world;
    w.build.abilities = ['drone_surge'];
    const e = grunt(sim, 150, 0, 1e6);
    w.enemies.armor[e] = 0;
    w.rebuildSpatial();
    w.tower.ce = w.tower.ceCap;
    cmd(sim, { type: 'cast', ability: 'drone_surge', x: 0, y: 0 });
    combatTick(sim);
    let n = 0;
    // fast-forward each drone to its last second (in a real fight they spend 10 s chewing through the wave)
    for (let i = 0; i < w.projectiles.count; i++) if (w.projectiles.kind[i] === ProjKind.Microdrone) { w.projectiles.life[i] = 50; n++; }
    expect(n).toBe(6);
    expect(evs(sim, Ev.Explosion, 'ability.drone_surge')).toBe(0);
    ticks(sim, 60);
    expect(evs(sim, Ev.Explosion, 'ability.drone_surge')).toBeGreaterThan(0);
  });
});

describe('Anomalies and Frames', () => {
  it('Cold Iron: each Chill stack strips 1% of armor', () => {
    const dmg = (cold: boolean): number => {
      const sim = quietSim();
      if (cold) socket(sim, 'cold_iron');
      const w = sim.world;
      const e = grunt(sim, 150, 0);
      w.enemies.armor[e] = 100; w.enemies.chill[e] = 5; w.enemies.chillT[e] = 600;
      return w.damage(e, 100, { source: 'primary', srcTag: 'ballistics', cause: -1 }).damage;
    };
    expect(dmg(false)).toBeCloseTo(50, 6);
    expect(dmg(true)).toBeCloseTo(100 * 100 / (100 + 95), 6);
  });
  it('Heavy Water: Poison ticks 25% slower and each tick hits 50% harder', () => {
    const run = (hw: boolean): { hits: number; perTick: number } => {
      const sim = setup(quietSim(), { overrides: { 'ballistics.attack_speed': 0 } });   // only the Poison deals damage
      if (hw) socket(sim, 'heavy_water');
      const w = sim.world;
      const e = grunt(sim, 150, 0, 60);   // small HP: Float32 HP keeps the per-tick differences exact
      w.applyStatus(e, 'poison', 1, 3600, 'poison', -1, 10);
      const h0 = w.enemies.hp[e];
      let hits = 0, prev = h0, perTick = 0;
      for (let k = 0; k < 120; k++) { combatTick(sim); if (w.enemies.hp[e] < prev) { hits++; perTick = prev - w.enemies.hp[e]; prev = w.enemies.hp[e]; } }
      return { hits, perTick };
    };
    const base = run(false), hw = run(true);
    expect(base.hits).toBe(8);                          // 4 Hz
    expect(hw.hits).toBe(7);                            // every 19 ticks (≈1.25 × 15)
    expect(hw.perTick / base.perTick).toBeCloseTo(19 / 15, 3);   // the pulse carries 19 ticks of damage (poison.damage ×1.2 is checked in anomalies.test.ts)
  });
  it('Tithe pays 2 Cores and Hungry Core heals 1% per kill through their stat keys', () => {
    const sim = combat(quietSim());
    const w = sim.world;
    socket(sim, 'tithe', 'hungry_core');
    w.run.wave = 5;
    const b = w.spawnEnemy('boss', 200, 0, { bossId: 'breaker', cause: -1 });
    w.tower.hp = w.tower.maxHp * 0.5;
    const cores = w.run.cores;
    w.damage(b, 1e12, { source: 'primary', srcTag: 'ballistics', cause: -1 });
    expect(w.run.cores - cores).toBe(2);
    expect(w.tower.hp / w.tower.maxHp).toBeCloseTo(0.51, 6);
  });
  it('Unstable Isotope: missile blasts are 50% larger', () => {
    const blast = (iso: boolean): number => {
      const sim = quietSim();
      const w = sim.world;
      w.build.hardpoints.push('ordnance');
      if (iso) socket(sim, 'unstable_isotope'); else w.rebuildStats();
      return plugin<{ blast: number }>(sim, 'ordnance').blast;
    };
    expect(blast(false)).toBe(40);
    expect(blast(true)).toBeCloseTo(60, 6);
  });
  it('Meteor Round counts Seventh Shot Fireballs ("from any source")', () => {
    const sim = setup(quietSim(), { elements: ['fire'], doctrines: { fire: 'wildfire' }, ranks: { 'fire.meteor_round': 1 }, overrides: { 'fire.meteor_round.every': 1, 'ballistics.attack_speed': 8 } });
    socket(sim, 'seventh_shot');
    grunt(sim, 150, 0);
    ticks(sim, 180);
    expect(sim.world.hazards.some((h) => h.kind === 'fire_zone' && h.srcTag === 'fire.meteor_round')).toBe(true);
  });
  it('Arsenal −25% primary damage and Mirror Node −40% beam damage hold with upgrade ranks bought', () => {
    const sim = setup(quietSim(), { ranks: { 'ballistics.damage': 10 } });
    const w = sim.world;
    const full = w.stats.get('ballistics.damage');
    w.build.frame = 'arsenal'; w.rebuildStats();
    expect(w.stats.get('ballistics.damage')).toBeCloseTo(full * 0.75, 9);
    w.build.frame = 'hive'; w.rebuildStats();
    expect(w.stats.get('ballistics.attack_speed')).toBeCloseTo(2 * 0.5, 9);
    const s2 = setup(quietSim(), { ranks: { 'laser.damage': 10 } });
    s2.world.build.hardpoints.push('laser'); s2.world.rebuildStats();
    const beam = s2.world.stats.get('laser.damage');
    socket(s2, 'mirror_node');
    expect(s2.world.stats.get('laser.damage')).toBeCloseTo(beam * 0.6, 9);
  });
  it('Pacifist Core also blocks weapon true damage', () => {
    const sim = quietSim();
    const w = sim.world;
    w.meta.activeTrial = 'pacifist_core';
    const e = grunt(sim, 150, 0);
    const hp = w.enemies.hp[e];
    w.damage(e, 50, { source: 'primary', srcTag: 'ballistics', cause: -1, trueDamage: true });
    expect(w.enemies.hp[e]).toBe(hp);
    w.damage(e, 50, { source: 'hazard', srcTag: 'fire_zone', cause: -1, trueDamage: true });
    expect(w.enemies.hp[e]).toBe(hp - 50);
  });
});

describe('Bosses: Absolute Zero, Kill Order / Held Open', () => {
  it('Absolute Zero: a boss at max Chill runs its tell timer at half speed', () => {
    const tellTicks = (az: boolean): number => {
      const sim = combat(setup(quietSim(), { elements: ['frost'], ranks: az ? { 'frost.absolute_zero': 1 } : {} }));
      const w = sim.world;
      w.run.wave = 5;
      const b = w.spawnEnemy('boss', 350, 0, { bossId: 'breaker', cause: -1 });
      w.enemies.hp[b] = w.enemies.maxHp[b] = 1e12;   // lint-allow causality: test setup
      for (let k = 0; k < 6000; k++) {
        w.enemies.chill[b] = 50; w.enemies.chillT[b] = 600;
        combatTick(sim);
        if (evs(sim, Ev.BossTell) > 0) return k;
      }
      return -1;
    };
    const plain = tellTicks(false), slow = tellTicks(true);
    expect(plain).toBeGreaterThan(0);
    expect(slow).toBeGreaterThanOrEqual(plain * 2 - 2);
  });
  it('a weak point held open by Held Open still takes weak-point damage (it only kept the flag before)', () => {
    const sim = quietSim();
    const w = sim.world;
    w.meta.prestigeRanks['prestige.held_open'] = 2;
    w.rebuildStats();
    w.run.wave = 5;
    const b = w.spawnEnemy('boss', 300, 0, { bossId: 'breaker', cause: -1 });
    sim.step();
    const c = bossCtrlOf(w, b)!;
    c.weakT = 2; w.enemies.flags[b] |= EnemyFlag.WeakPointOpen;
    for (let k = 0; k < 10; k++) combatTick(sim);      // the script closed it after 2 ticks; Held Open holds it 1 s
    expect(c.weakT).toBe(0);
    expect(w.enemies.flags[b] & EnemyFlag.WeakPointOpen).not.toBe(0);
    expect(w.damageModifier!(b, null, 'ballistics', 'primary')).toBe(1.5);
    ticks(sim, 70);
    expect(w.enemies.flags[b] & EnemyFlag.WeakPointOpen).toBe(0);
    expect(w.damageModifier!(b, null, 'ballistics', 'primary')).toBe(1);
  });
});

describe('Boons: Anchor Well', () => {
  it('only the first well of a wave lasts twice as long, even when two open in the same tick', () => {
    const sim = setup(quietSim(), { ranks: { 'gravitics.wells': 1 } });
    const w = sim.world;
    w.build.hardpoints.push('gravitics');
    w.build.boons = ['anchor_well'];
    w.rebuildStats();
    for (let k = 0; k < 6; k++) { grunt(sim, 200 + k * 3, 0); grunt(sim, -200 - k * 3, 0); }
    w.rebuildSpatial();
    for (const s of sim.plugins) s.onWaveStart?.(w);
    combatTick(sim);
    const g = plugin<{ life: Int32Array; act: Uint8Array }>(sim, 'gravitics');
    const lives = [0, 1].filter((k) => g.act[k]).map((k) => g.life[k]);
    expect(lives.length).toBe(2);
    expect(Math.max(...lives)).toBeGreaterThan(Math.min(...lives) * 1.5);
  });
});

describe('Ballistics numbers', () => {
  it('Extra Barrels reaches 5 projectiles at rank 4; a 50% second Multishot gets half the extra barrels', () => {
    const count = (rank: number, second: boolean): number => {
      const sim = quietSim();
      const w = sim.world;
      if (second) { socket(sim, 'spare_barrel'); w.build.doctrines.ballistics = 'piercing'; w.build.secondDoctrines.ballistics = 'multishot'; }
      else w.build.doctrines.ballistics = 'multishot';
      w.build.ranks['ballistics.multishot.count'] = rank;
      w.stats.override('ballistics.attack_speed', 60);
      w.rebuildStats();
      grunt(sim, 200, 0); w.rebuildSpatial();
      for (let k = 0; k < 20; k++) combatTick(sim);
      const shots = w.events.recent(0).length;   // not used
      void shots;
      let n = 0;
      for (let i = 0; i < w.projectiles.count; i++) if (w.projectiles.kind[i] === ProjKind.Bullet && (w.projectiles.flags[i] & ProjFlag.Dead) === 0) n++;
      return n;
    };
    expect(count(4, false) % 5).toBe(0);
    expect(count(4, false)).toBeGreaterThan(0);
    const sim = quietSim();
    sim.world.build.doctrines.ballistics = 'multishot'; sim.world.build.ranks['ballistics.multishot.count'] = 4; sim.world.rebuildStats();
    expect(sim.world.stats.get('ballistics.multishot.count')).toBe(5);
    const s2 = quietSim();
    socket(s2, 'spare_barrel');
    s2.world.build.doctrines.ballistics = 'piercing'; s2.world.build.secondDoctrines.ballistics = 'multishot'; s2.world.build.ranks['ballistics.multishot.count'] = 4;
    s2.world.rebuildStats();
    expect(s2.world.stats.get('ballistics.multishot.count')).toBe(3);   // 1 + 4 × 50%, not scaled a second time
  });
});

describe('Constellation Singularity bridges (were never read)', () => {
  function laserSim(extra: Record<string, number>, stars: Record<string, number>): Sim {
    const sim = setup(quietSim(), { ranks: { 'laser.nodes': 3, ...extra } });
    const w = sim.world;
    w.build.hardpoints.push('laser', 'ordnance');
    Object.assign(w.meta.constellation, stars);
    w.rebuildStats();
    combatTick(sim);
    return sim;
  }
  it(`Focal Reactor: ${FOCAL_CHARGES} kills inside the polygon fire a piercing beam for ${FOCAL_MUL}× primary damage`, () => {
    const sim = laserSim({}, { 'star.major.primary': 1, 'star.major.laser': 1, 'star.bridge.primary+laser': 1 });
    const w = sim.world;
    expect(w.shared.laserInterior).toBeGreaterThan(0);
    grunt(sim, 250, 0, 1e6); w.rebuildSpatial();
    for (let k = 0; k < FOCAL_CHARGES; k++) { const v = grunt(sim, 20, 20, 1); w.damage(v, 1e9, { source: 'ability', srcTag: 'x', cause: -1 }); }
    expect(evs(sim, Ev.Anomaly, 'star.bridge.primary+laser')).toBe(1);
    let beam = -1;
    for (let i = 0; i < w.projectiles.count; i++) if (w.tagName(w.projectiles.tag[i]) === 'star.bridge.primary+laser') beam = i;
    expect(beam).toBeGreaterThanOrEqual(0);
    expect(w.projectiles.damage[beam]).toBeCloseTo(FOCAL_MUL * w.stats.get('ballistics.damage'), 6);
    expect(w.projectiles.pierce[beam]).toBe(255);
  });
  it('Deployment Charge: an ordnance explosion launches a temporary drone', () => {
    const sim = laserSim({}, { 'star.major.ordnance': 1, 'star.major.drones': 1, 'star.bridge.ordnance+drones': 1 });
    const w = sim.world;
    grunt(sim, 200, 0, 1e6); w.rebuildSpatial();
    w.explode(200, 0, 40, 1, { source: 'ordnance', srcTag: 'ordnance', cause: -1 });
    combatTick(sim);
    expect(evs(sim, Ev.Anomaly, 'star.bridge.ordnance+drones')).toBe(1);
    let drones = 0;
    for (let i = 0; i < w.projectiles.count; i++) if (w.tagName(w.projectiles.tag[i]) === 'star.bridge.ordnance+drones') drones++;
    expect(drones).toBe(1);
  });
  it('Prism Battery: where two beams cross, a missile launches (Star Configuration)', () => {
    const sim = laserSim({ 'laser.expansion.nodes': 1, 'laser.expansion.star': 1 }, { 'star.major.ordnance': 1, 'star.major.laser': 1, 'star.bridge.ordnance+laser': 1 });
    const w = sim.world;
    w.build.doctrines.laser = 'expansion'; w.rebuildStats();
    grunt(sim, 300, 0, 1e6); w.rebuildSpatial();
    ticks(sim, 100);
    expect(evs(sim, Ev.Anomaly, 'star.bridge.ordnance+laser')).toBeGreaterThan(0);
    expect(evs(sim, Ev.Explosion, 'star.bridge.ordnance+laser') + [...Array(w.projectiles.count).keys()].filter((i) => w.tagName(w.projectiles.tag[i]) === 'star.bridge.ordnance+laser').length).toBeGreaterThan(0);
  });
});
