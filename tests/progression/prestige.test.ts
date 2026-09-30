import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { echoesFor, starsFor } from '../../src/sim/economy/curves';
import { allowedSpeed, prestigeEchoes, socketCount } from '../../src/sim/economy/prestige';
import { generateWave } from '../../src/sim/enemies/generator';
import { buildShop } from '../../src/sim/economy/shop';
import { treeDef } from '../../src/sim/core/content';
import { growth } from '../../src/sim/math/lut';
import { cmd } from './helpers';

function at30(seed = 7): Sim {
  const sim = new Sim(null, seed);
  const w = sim.world;
  w.meta.codex = {};
  w.run.deepestCleared = 30; w.run.checkpoint = 30;
  w.meta.deepestEver = 30;
  return sim;
}

describe('Echo and Star formulas', () => {
  it('match design §17', () => {
    expect(echoesFor(19)).toBe(0);
    expect(echoesFor(20)).toBe(10);
    expect(echoesFor(30)).toBe(Math.floor(10 * growth(1.2, 10)));
    expect(echoesFor(30)).toBe(61);
    expect(echoesFor(20, 5)).toBe(15);
    expect(starsFor(100, 0)).toBe(4);
    expect(starsFor(110, 1)).toBe(Math.floor(8 * growth(1.1, 10)));
  });
});

describe('Prestige', () => {
  it('pays floor(10·1.2^10) Echoes from wave 30, resets the run, keeps meta and reseeds', () => {
    const sim = at30();
    const w = sim.world;
    const oldSeed = w.run.prestigeSeed;
    w.run.scrap = 12345; w.run.cores = 4; w.build.ranks['ballistics.damage'] = 7;
    w.meta.prestigeRanks['prestige.scrap_resonance'] = 1;
    expect(prestigeEchoes(w)).toBe(61);
    expect(cmd(sim, { type: 'prestige', frame: 'standard' })).toBeNull();
    expect(w.meta.echoes).toBe(Math.floor(10 * growth(1.2, 10)));
    expect(w.meta.prestigeCount).toBe(1);
    expect(w.meta.deepestEver).toBe(30);
    expect(w.meta.records.deepestWave).toBeGreaterThanOrEqual(30);
    expect(w.meta.prestigeRanks['prestige.scrap_resonance']).toBe(1);
    expect(w.run.wave).toBe(1);
    expect(w.run.deepestCleared).toBe(0);
    expect(w.run.checkpoint).toBe(0);
    expect(w.run.scrap).toBe(0);
    expect(w.run.cores).toBe(0);
    expect(w.build.ranks['ballistics.damage'] ?? 0).toBe(0);
    expect(w.run.prestigeSeed).not.toBe(oldSeed);
    const a = JSON.stringify([1, 2, 3].map((k) => generateWave(oldSeed, k, 0, 0).spawns));
    const b = JSON.stringify([1, 2, 3].map((k) => generateWave(w.run.prestigeSeed, k, 0, 0).spawns));
    expect(a).not.toBe(b);
    // the machine really plays the new content
    sim.run(200);
    expect(w.wave?.wave).toBe(1);
    expect(JSON.stringify(w.wave!.spawns)).toBe(JSON.stringify(generateWave(w.run.prestigeSeed, 1, 0, 0).spawns));
    // a second Prestige reseeds again
    const seed1 = w.run.prestigeSeed;
    cmd(sim, { type: 'prestige', frame: 'standard' });
    expect(w.run.prestigeSeed).not.toBe(seed1);
    expect(w.meta.prestigeCount).toBe(2);
  });

  it('pays nothing below wave 20 and rejects locked frames', () => {
    const sim = new Sim(null, 3);
    sim.world.run.deepestCleared = 15;
    expect(cmd(sim, { type: 'prestige', frame: 'arsenal' })).toMatch(/locked/i);
    expect(cmd(sim, { type: 'prestige', frame: 'standard' })).toBeNull();
    expect(sim.world.meta.echoes).toBe(0);
  });

  it('buy_prestige charges Echoes ×1.5 per rank; Seed Capital / Memory of Steel start the next run', () => {
    const sim = at30();
    const w = sim.world, meta = w.meta;
    meta.echoes = 100; meta.deepestEver = 10;
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.seed_capital' })).toMatch(/wave 20/);
    meta.deepestEver = 30;
    for (let k = 0; k < 3; k++) expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.seed_capital' })).toBeNull();
    expect(meta.prestigeRanks['prestige.seed_capital']).toBe(3);
    expect(meta.echoes).toBe(100 - 10 - Math.ceil(10 * 1.5) - Math.ceil(10 * 2.25));   // balance pass: Seed Capital base 5 → 10
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.memory_of_steel' })).toBeNull();
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.frames' })).toMatch(/wave 40/);
    cmd(sim, { type: 'prestige', frame: 'standard' });
    expect(w.run.scrap).toBe(1200);   // onboarding pass: 400 Scrap per rank; Memory of Steel 1 (chunkier) Caliber rank per rank
    expect(w.build.ranks['ballistics.damage']).toBe(1);
    expect(w.stats.rank('ballistics.damage')).toBe(1);
    meta.echoes = 0;
    expect(cmd(sim, { type: 'buy_prestige', node: 'prestige.boss_bounty' })).toMatch(/Echoes/);
  });

  it('Hardened Core and Scrap Resonance resolve through prestigeRanks', () => {
    const sim = new Sim(null, 1);
    const w = sim.world;
    w.meta.codex = {};
    const hp = w.stats.get('bastion.max_hp'), scrap = w.stats.get('economy.scrap_mul');
    w.meta.prestigeRanks['prestige.hardened_core'] = 2;
    w.meta.prestigeRanks['prestige.scrap_resonance'] = 4;
    w.rebuildStats();
    expect(w.stats.get('bastion.max_hp')).toBeCloseTo(hp * 1.1, 6);
    expect(w.stats.get('economy.scrap_mul')).toBeCloseTo(scrap + 0.2, 6);
    expect(w.tower.maxHp).toBeCloseTo(hp * 1.1, 6);
  });

  it('Accelerated Clearing allows ×2/×4/×8 on solved waves only', () => {
    const sim = new Sim(null, 1);
    const { run, meta } = sim.world;
    meta.deepestEver = 30; run.wave = 12;
    expect(allowedSpeed(run, meta)).toBe(1);
    meta.prestigeRanks['prestige.accelerated_clearing'] = 2;
    expect(allowedSpeed(run, meta)).toBe(4);
    meta.prestigeRanks['prestige.accelerated_clearing'] = 3;
    expect(allowedSpeed(run, meta)).toBe(8);
    run.wave = 31;
    expect(allowedSpeed(run, meta)).toBe(1);
    run.wave = 12;
    sim.machine.startWave();
    expect(run.speedMultiplier).toBe(8);
  });

  it('Keepsake survives a Prestige; other Anomalies do not; sockets grow with Anomaly Socket', () => {
    const sim = at30();
    const w = sim.world;
    w.build.anomalies.push('glass_cannon', 'tithe', 'pinball');
    expect(cmd(sim, { type: 'prestige', frame: 'standard', keepsake: 'tithe' })).toMatch(/Keepsake locked/);
    expect(w.build.anomalies.length).toBe(3);
    w.meta.prestigeRanks['prestige.keepsake'] = 1;
    w.meta.prestigeRanks['prestige.anomaly_socket'] = 1;
    expect(cmd(sim, { type: 'prestige', frame: 'standard', keepsake: 'hungry_core' })).toMatch(/socketed/);
    expect(cmd(sim, { type: 'prestige', frame: 'standard', keepsake: 'tithe' })).toBeNull();
    expect(w.build.anomalies).toEqual(['tithe']);
    expect(w.meta.keepsake).toBe('tithe');
    expect(w.build.anomalySockets).toBe(4);
    expect(socketCount(w.meta)).toBe(4);
    expect(w.stats.hasAnomaly('tithe')).toBe(true);
    // draft: fill the sockets, then a pick replaces the chosen socket
    w.run.pendingDraft = ['glass_cannon', 'pinball', 'rogue_moon'];
    expect(cmd(sim, { type: 'pick_anomaly', anomaly: 'glass_cannon' })).toBeNull();
    w.build.anomalies.push('cold_iron', 'heavy_water');
    w.run.pendingDraft = ['glass_cannon', 'pinball', 'rogue_moon'];
    expect(cmd(sim, { type: 'pick_anomaly', anomaly: 'pinball', replace: 2 })).toBeNull();
    expect(w.build.anomalies).toEqual(['tithe', 'glass_cannon', 'pinball', 'heavy_water']);
  });

  it('Branch Discount prices one tree at −25%; Threat Dial at Prestige needs its node', () => {
    const sim = at30();
    const w = sim.world;
    expect(cmd(sim, { type: 'prestige', frame: 'standard', discountTree: 'ballistics' })).toMatch(/Branch Discount/);
    expect(cmd(sim, { type: 'prestige', frame: 'standard', threatDial: 3 })).toMatch(/Threat Dial/);
    w.meta.prestigeRanks['prestige.branch_discount'] = 1;
    expect(cmd(sim, { type: 'prestige', frame: 'standard', discountTree: 'ballistics' })).toBeNull();
    const shop = buildShop(w);
    const cal = shop.find((e) => e.node === 'ballistics.damage')!;
    const hull = shop.find((e) => e.node === 'bastion.max_hp')!;
    const calBase = treeDef('ballistics')!.shared.find((n) => n.id === 'ballistics.damage')!.cost as { base: number };
    const hullBase = treeDef('bastion')!.shared.find((n) => n.id === 'bastion.max_hp')!.cost as { base: number };
    expect(cal.cost).toBe(Math.ceil(calBase.base * 0.75));
    expect(hull.cost).toBe(Math.ceil(hullBase.base));
  });

  it('Blueprints save (slot-limited) and load: frame, planned hardpoints/attunements auto-mount as slots open', () => {
    const sim = at30();
    const w = sim.world, meta = w.meta;
    const bp = { name: 'drone fire', frame: 'standard' as const, hardpoints: ['drones' as const], attunements: ['fire' as const],
      doctrines: {}, targeting: { primary: 'lowest_hp' as const }, upgradeQueue: [{ node: 'ballistics.damage' }] };
    expect(cmd(sim, { type: 'save_blueprint', blueprint: bp })).toMatch(/locked/);
    meta.prestigeRanks['prestige.blueprint_slots'] = 1;
    meta.prestigeRanks['prestige.weapon_seed'] = 1;
    meta.prestigeRanks['prestige.elemental_memory'] = 1;
    expect(cmd(sim, { type: 'save_blueprint', blueprint: bp })).toBeNull();
    expect(cmd(sim, { type: 'save_blueprint', blueprint: { ...bp, name: 'other' } })).toMatch(/slot/);
    expect(cmd(sim, { type: 'prestige', frame: 'standard', blueprint: 0 })).toBeNull();
    expect(w.run.plannedHardpoints).toEqual(['drones']);
    expect(w.build.targeting.primary).toBe('lowest_hp');
    expect(meta.upgradeQueue).toEqual([{ node: 'ballistics.damage' }]);
    sim.run(31);
    expect(w.build.hardpoints[0]).toBe('drones');
    expect(w.build.attunements[0]).toBe('fire');
  });

  it('choose_doctrine second: true needs a second-doctrine rule (Spare Barrel → 50%)', () => {
    const sim = new Sim(null, 2);
    const w = sim.world;
    const t = treeDef('ballistics')!;
    for (const n of t.shared.slice(0, t.forkRequirement)) w.build.ranks[n.id] = 1;
    w.rebuildStats();
    const [d1, d2] = t.doctrines.map((d) => d.id);
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: d2, second: true })).toMatch(/first/);
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: d1 })).toBeNull();
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: d2, second: true })).toMatch(/cannot/);
    w.build.anomalies.push('spare_barrel');
    w.rebuildStats();
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: d2, second: true })).toBeNull();
    expect(w.build.secondDoctrines.ballistics).toBe(d2);
    expect(w.stats.doctrineStrength('ballistics', d2)).toBe(0.5);
    // losing the Anomaly drops the second doctrine
    w.build.anomalies.length = 0;
    w.rebuildStats();
    sim.step();
    expect(w.build.secondDoctrines.ballistics).toBeUndefined();
  });
});

describe('Threat Dial', () => {
  it('is set at Prestige, only lowered mid-run, and Echoes pay at the lowest level used', () => {
    const sim = at30();
    const w = sim.world;
    w.meta.prestigeRanks['prestige.threat_dial'] = 1;
    expect(cmd(sim, { type: 'prestige', frame: 'standard', threatDial: 11 })).toMatch(/range/);
    expect(cmd(sim, { type: 'prestige', frame: 'standard', threatDial: 5 })).toBeNull();
    expect(w.run.threatDial).toBe(5);
    expect(cmd(sim, { type: 'set_threat_dial', level: 6 })).toMatch(/lowered/);
    expect(cmd(sim, { type: 'set_threat_dial', level: 2 })).toBeNull();
    expect(cmd(sim, { type: 'set_threat_dial', level: 4 })).toMatch(/lowered/);
    expect(w.run.threatDial).toBe(2);
    expect(w.run.minThreatDial).toBe(2);
    w.run.deepestCleared = 30;
    expect(prestigeEchoes(w)).toBe(echoesFor(30, 2));
    // the generator's dial HP scale reaches spawned enemies
    const wave = generateWave(w.run.prestigeSeed, 3, 2, 0);
    expect(wave.spawns.every((s) => s.hpScale >= 1.24 - 1e-9)).toBe(true);
    w.meta.ascension = 4;
    expect(cmd(sim, { type: 'prestige', frame: 'standard', threatDial: 20 })).toBeNull();
  });
});
