import { describe, it, expect } from 'vitest';
import { Ev } from '../../src/sim/core/types';
import type { ElementsSystem } from '../../src/sim/systems/elements';
import { quietSim, setup, plugin, events, ticks, grunt } from './wp2-helpers';

const NO_GUN = { 'ballistics.range': 1 };
const fusionEvents = (sim: ReturnType<typeof quietSim>, id: string) => events(sim, (e) => e.type === Ev.Fusion && e.src === id);

describe('Fusions', () => {
  it('Toxic Combustion: Burn on a heavily poisoned enemy consumes the poison in an explosion', () => {
    const sim = setup(quietSim(), { elements: ['fire', 'poison'], ranks: { 'fusion.toxic_combustion': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const a = grunt(sim, 200, 200), b = grunt(sim, 250, 200);
    w.rebuildSpatial();
    w.applyStatus(a, 'poison', 6, 300, 'poison', -1, 10);
    const pending = 10 * 6 * 5;
    w.applyStatus(a, 'burn', 1, 180, 'fire', -1, 1);
    const f = fusionEvents(sim, 'fusion.toxic_combustion');
    expect(f.length).toBe(1);
    expect(f[0].b).toBeCloseTo(pending * w.stats.get('fusion.toxic_combustion'), 3);   // rank 1: ×0.5 (balance pass)
    expect(w.enemies.poison[a]).toBe(0);
    const hpB = w.enemies.hp[b];
    ticks(sim, 1);
    const boom = events(sim, (e) => e.type === Ev.Explosion && e.src === 'fusion.toxic_combustion')[0];
    expect(boom.cause).toBe(f[0].id);
    expect(hpB - w.enemies.hp[b]).toBeGreaterThan(0);   // b is 50 units out: falloff + per-target cap (balance pass)
  });

  it('Superconductivity: arcs prefer chilled enemies and gain damage per chilled link', () => {
    const sim = setup(quietSim(), { elements: ['lightning', 'frost'], ranks: { 'fusion.superconductivity': 2 }, overrides: NO_GUN });
    const w = sim.world;
    const a = grunt(sim, 200, 200), near = grunt(sim, 240, 200), cold = grunt(sim, 290, 200);
    w.rebuildSpatial();
    w.applyStatus(a, 'chill', 1, 600, 'frost', -1);
    w.applyStatus(cold, 'chill', 1, 600, 'frost', -1);
    plugin<ElementsSystem>(sim, 'elements').arcs.chain(w, a, 200, 200, 1, 100, -1);
    const link = events(sim, (e) => e.type === Ev.Hit && e.src === 'lightning')[0];
    expect(link.a).toBe(cold);
    expect(link.a).not.toBe(near);
    const f = fusionEvents(sim, 'fusion.superconductivity');
    expect(f.length).toBe(1);
    expect(link.cause).toBe(f[0].id);
    expect(link.b).toBeCloseTo(100 * (1 + 0.3 * 1), 3);                 // one chilled enemy (the origin) already in the chain
  });

  it('Thermal Shock: Burn on a heavily chilled enemy (or Chill on a burning one) bursts physical damage, once per second', () => {
    const sim = setup(quietSim(), { elements: ['fire', 'frost'], ranks: { 'fusion.thermal_shock': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const a = grunt(sim, 200, 200), b = grunt(sim, 230, 200);
    w.rebuildSpatial();
    w.applyStatus(a, 'chill', 4, 600, 'frost', -1);
    const hit = w.damage(a, 40, { source: 'ability', srcTag: 'x', cause: -1 });
    w.applyStatus(a, 'burn', 1, 180, 'fire', hit.eventId, 1);
    w.applyStatus(a, 'burn', 1, 180, 'fire', hit.eventId, 1);                  // lockout
    const f = fusionEvents(sim, 'fusion.thermal_shock');
    expect(f.length).toBe(1);
    expect(f[0].b).toBeCloseTo(hit.damage, 3);
    const hpB = w.enemies.hp[b];
    ticks(sim, 1);
    expect(hpB - w.enemies.hp[b]).toBeCloseTo(hit.damage, 1);
    const c = grunt(sim, -200, 200);
    w.applyStatus(c, 'burn', 3, 600, 'fire', -1, 1);
    w.applyStatus(c, 'chill', 1, 120, 'frost', -1);
    expect(fusionEvents(sim, 'fusion.thermal_shock').length).toBe(2);
  });

  it('Electrolysis: arcs instantly deal a share of pending poison', () => {
    const sim = setup(quietSim(), { elements: ['lightning', 'poison'], ranks: { 'fusion.electrolysis': 2 }, overrides: NO_GUN });
    const w = sim.world;
    const a = grunt(sim, 200, 200), b = grunt(sim, 250, 200);
    w.rebuildSpatial();
    w.applyStatus(b, 'poison', 4, 300, 'poison', -1, 10);
    plugin<ElementsSystem>(sim, 'elements').arcs.chain(w, a, 200, 200, 1, 10, -1);
    const f = fusionEvents(sim, 'fusion.electrolysis');
    expect(f.length).toBe(1);
    expect(f[0].b).toBeCloseTo(10 * 4 * 5 * 0.3, 3);
    const hit = events(sim, (e) => e.type === Ev.Hit && e.src === 'fusion.electrolysis')[0];
    expect(hit.cause).toBe(f[0].id);
    expect(w.enemies.poison[b]).toBe(4);
  });

  it('Plasma: arcs through burning enemies leave a 1 s plasma line that damages what touches it', () => {
    const sim = setup(quietSim(), { elements: ['fire', 'lightning'], ranks: { 'fusion.plasma': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const a = grunt(sim, 200, 200), b = grunt(sim, 280, 200), mid = grunt(sim, 240, 204);
    w.rebuildSpatial();
    w.applyStatus(a, 'burn', 1, 600, 'fire', -1, 1);
    const el = plugin<ElementsSystem>(sim, 'elements');
    el.arcs.strike(w, a, 200, 200, b, 50, -1, 'lightning');
    expect(fusionEvents(sim, 'fusion.plasma').length).toBe(1);
    const line = w.hazards.find((h) => h.kind === 'plasma_line')!;
    expect(line.srcTag).toBe('fusion.plasma');
    expect(line.life).toBe(1);
    expect(line.dps).toBeCloseTo(0.2 * 50, 4);
    ticks(sim, 16);
    expect(events(sim, (e) => e.type === Ev.Hit && e.src === 'fusion.plasma' && e.a === mid).length).toBeGreaterThan(0);
  });

  it('Cryotoxin: poison on a frozen enemy is banked and released ×1.5 on thaw', () => {
    const sim = setup(quietSim(), { elements: ['poison', 'frost'], ranks: { 'fusion.cryotoxin': 1 }, overrides: NO_GUN });
    const w = sim.world, e = w.enemies;
    const a = grunt(sim, 200, 200);
    w.applyStatus(a, 'poison', 5, 6000, 'poison', -1, 20);
    w.freeze(a, 61, 'frost', -1);
    const hp0 = e.hp[a];
    ticks(sim, 30);
    expect(e.hp[a]).toBe(hp0);                                            // poison banked, not dealt
    expect(e.bankedPoison[a]).toBeGreaterThan(0);
    const banked = () => e.bankedPoison[a];
    ticks(sim, 29);
    const bank = banked();
    ticks(sim, 4);
    const f = fusionEvents(sim, 'fusion.cryotoxin');
    expect(f.length).toBe(1);
    expect(f[0].b).toBeCloseTo(bank * 1.5, 2);
    expect(e.bankedPoison[a]).toBe(0);
  });

  it('Conductor frame: Fusions start at rank 1 without a purchase', () => {
    const sim = quietSim();
    sim.world.build.frame = 'conductor';
    setup(sim, { elements: ['fire', 'lightning', 'poison'] });
    expect(sim.world.stats.rank('fusion.plasma')).toBe(1);
    expect(sim.world.stats.rank('fusion.cryotoxin')).toBe(0);            // frost not attuned
  });
});

describe('Triads', () => {
  it('Polar Storm: Thermal Shock bursts also arc as lightning', () => {
    const sim = setup(quietSim(), { elements: ['fire', 'lightning', 'frost'], ranks: { 'fusion.thermal_shock': 1, 'triad.polar_storm': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const a = grunt(sim, 200, 200); grunt(sim, 260, 200);
    w.rebuildSpatial();
    w.applyStatus(a, 'chill', 4, 600, 'frost', -1);
    w.applyStatus(a, 'burn', 1, 180, 'fire', -1, 1);
    ticks(sim, 1);
    const t = events(sim, (e) => e.type === Ev.Triad && e.src === 'triad.polar_storm');
    expect(t.length).toBe(1);
    expect(events(sim, (e) => e.type === Ev.Hit && e.src === 'lightning' && e.cause === t[0].id).length).toBe(1);
  });

  it('Crucible: Thermal Shock bursts copy Poison stacks onto everything they hit', () => {
    const sim = setup(quietSim(), { elements: ['fire', 'poison', 'frost'], ranks: { 'fusion.thermal_shock': 1, 'triad.crucible': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const a = grunt(sim, 200, 200), b = grunt(sim, 230, 200);
    w.rebuildSpatial();
    w.applyStatus(a, 'poison', 4, 600, 'poison', -1, 3);
    w.applyStatus(a, 'chill', 4, 600, 'frost', -1);
    w.applyStatus(a, 'burn', 1, 180, 'fire', -1, 1);
    ticks(sim, 1);
    expect(events(sim, (e) => e.type === Ev.Triad && e.src === 'triad.crucible').length).toBe(1);
    expect(w.enemies.poison[b]).toBe(2);
  });

  it('Cold Circuit: arcs between chilled, poisoned enemies never decay and hit harder', () => {
    const sim = setup(quietSim(), { elements: ['lightning', 'poison', 'frost'], ranks: { 'triad.cold_circuit': 1 }, overrides: NO_GUN });
    const w = sim.world;
    const ids = [grunt(sim, 200, 200), grunt(sim, 250, 200), grunt(sim, 300, 200), grunt(sim, 350, 200)];
    w.rebuildSpatial();
    for (const i of ids) { w.applyStatus(i, 'chill', 1, 600, 'frost', -1); w.applyStatus(i, 'poison', 1, 600, 'poison', -1, 1); }
    plugin<ElementsSystem>(sim, 'elements').arcs.chain(w, ids[0], 200, 200, 3, 100, -1);
    const links = events(sim, (e) => e.type === Ev.Hit && e.src === 'lightning');
    expect(links.length).toBe(3);
    for (const l of links) expect(l.b).toBeCloseTo(110, 3);
    expect(events(sim, (e) => e.type === Ev.Triad && e.src === 'triad.cold_circuit').length).toBe(1);
  });
});
