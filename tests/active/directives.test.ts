import { describe, it, expect } from 'vitest';
import { Ev, TICK_RATE } from '../../src/sim/core/types';
import type { Directive } from '../../src/sim/core/types';
import { directiveSlots, reactionDelayTicks, setForecastProbe, forecastRecommends } from '../../src/sim/directives/engine';
import { arena, slot, dummy, cmd, tick, casts, events, unlock } from './helpers';

const repulseAt5: Directive = { enabled: true, conditions: [{ kind: 'inner_ring_at_least', n: 5 }], action: { kind: 'cast', ability: 'repulsor_pulse', at: 'tower' } };

describe('Directives', () => {
  it('unlock with prestige.directives: 3 slots at rank 1, +1 per rank, 0.6 s → 0.3 s with Directive Tuning', () => {
    const sim = arena();
    const w = sim.world;
    expect(directiveSlots(w)).toBe(0);
    unlock(sim, 'prestige.directives');
    expect(directiveSlots(w)).toBe(3);
    w.meta.prestigeRanks['prestige.directives'] = 10;
    w.rebuildStats();
    expect(directiveSlots(w)).toBe(12);
    expect(reactionDelayTicks(w)).toBe(36);
    w.meta.prestigeRanks['prestige.directive_tuning'] = 5;
    w.rebuildStats();
    expect(reactionDelayTicks(w)).toBe(18);
  });

  it('"WHEN 5 enemies in inner ring → Repulsor Pulse" fires after the 0.6 s reaction delay, not before', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    slot(sim, 'repulsor_pulse');
    expect(cmd(sim, { type: 'set_directives', directives: [repulseAt5] })).toBeNull();
    for (let k = 0; k < 4; k++) dummy(sim, 60 + k * 10, 30);
    tick(sim, 60);
    expect(casts(sim).length).toBe(0);
    dummy(sim, 0, -80);
    const t0 = w.tick;
    tick(sim, 36);
    expect(casts(sim).length).toBe(0);
    tick(sim, 3);
    const cs = casts(sim, 'repulsor_pulse');
    expect(cs.length).toBe(1);
    expect(cs[0].tick - t0).toBeGreaterThanOrEqual(36);
    expect(cs[0].tick - t0).toBeLessThanOrEqual(38);
    expect(cs[0].data).toMatchObject({ viaDirective: true, directive: 0 });
  });

  it('checks Directives in priority order (one fires per tick; the first wins the CE)', () => {
    const run = (order: 'repair_first' | 'pulse_first'): string[] => {
      const sim = arena();
      unlock(sim, 'prestige.directives');
      slot(sim, 'emergency_repair', 'repulsor_pulse');
      sim.world.tower.ce = 60;
      sim.world.tower.hp = sim.world.tower.maxHp * 0.5;
      dummy(sim, 60, 0);
      const repair: Directive = { enabled: true, conditions: [{ kind: 'tower_hp_below', pct: 90 }], action: { kind: 'cast', ability: 'emergency_repair', at: 'tower' } };
      const pulse: Directive = { enabled: true, conditions: [{ kind: 'inner_ring_at_least', n: 1 }], action: { kind: 'cast', ability: 'repulsor_pulse', at: 'tower' } };
      cmd(sim, { type: 'set_directives', directives: order === 'repair_first' ? [repair, pulse] : [pulse, repair] });
      tick(sim, 3 * TICK_RATE);
      return casts(sim).map((c) => c.src);
    };
    expect(run('repair_first')).toEqual(['ability.emergency_repair']);
    expect(run('pulse_first')).toEqual(['ability.repulsor_pulse']);
  });

  it('"WHEN group ≥ 12 → Bombardment at largest group" hits the group', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    slot(sim, 'bombardment');
    const group: number[] = [];
    for (let k = 0; k < 12; k++) group.push(dummy(sim, 250 + (k % 4) * 12, 100 + Math.floor(k / 4) * 12));
    const loners = [dummy(sim, -300, 0), dummy(sim, 0, -300), dummy(sim, -200, 250)];
    cmd(sim, { type: 'set_directives', directives: [
      { enabled: true, conditions: [{ kind: 'group_at_least', n: 12, radius: 90 }], action: { kind: 'cast', ability: 'bombardment', at: 'largest_group' } },
    ] });
    tick(sim, 2 * TICK_RATE);
    const cs = casts(sim, 'bombardment');
    expect(cs.length).toBe(1);
    expect(Math.abs(cs[0].x - 268)).toBeLessThan(20);
    expect(Math.abs(cs[0].y - 112)).toBeLessThan(20);
    const hit = new Set(events(sim, Ev.Hit, 'ability.bombardment').map((h) => h.a));
    for (const g of group) expect(hit.has(g)).toBe(true);
    for (const l of loners) expect(hit.has(l)).toBe(false);
    void w;
  });

  it('a group smaller than N does not trigger', () => {
    const sim = arena();
    unlock(sim, 'prestige.directives');
    slot(sim, 'bombardment');
    for (let k = 0; k < 11; k++) dummy(sim, 250 + k * 5, 100);
    cmd(sim, { type: 'set_directives', directives: [
      { enabled: true, conditions: [{ kind: 'group_at_least', n: 12, radius: 90 }], action: { kind: 'cast', ability: 'bombardment', at: 'largest_group' } },
    ] });
    tick(sim, 2 * TICK_RATE);
    expect(casts(sim).length).toBe(0);
  });

  it('a Directive fires at most once per second', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    w.stats.override('reactor.cooldown_reduction', 1);   // Hunter Mark cooldown 4 s × 0.2 = 0.8 s
    w.rebuildStats();
    slot(sim, 'hunter_mark');
    dummy(sim, 150, 0);
    cmd(sim, { type: 'set_directives', directives: [
      { enabled: true, conditions: [{ kind: 'ce_at_least', ce: 0 }], action: { kind: 'cast', ability: 'hunter_mark', at: 'nearest_threat' } },
    ] });
    for (let k = 0; k < 6 * TICK_RATE; k++) { w.tower.ce = 100; tick(sim); }
    const ticks = casts(sim, 'hunter_mark').map((c) => c.tick);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    for (let k = 1; k < ticks.length; k++) expect(ticks[k] - ticks[k - 1]).toBeGreaterThanOrEqual(TICK_RATE);
  });

  it('designate, targeting and mode actions go through the command path (viaDirective)', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    const healer = dummy(sim, -200, 0, 'healer');
    dummy(sim, 100, 0);
    const seen: string[] = [];
    w.systems.push({ id: 'spy', init() {}, rebuild() {}, update() {}, onCommand: (_w, c) => { if (c.type === 'designate' && c.viaDirective) seen.push('designate'); return false; } });
    cmd(sim, { type: 'set_directives', directives: [
      { enabled: true, conditions: [{ kind: 'enemy_present', enemy: 'healer' }], action: { kind: 'designate', what: 'healer' } },
      { enabled: true, conditions: [], action: { kind: 'targeting', system: 'primary', profile: 'lowest_hp' } },
      { enabled: true, conditions: [{ kind: 'wave_is', which: 'ordinary' }], action: { kind: 'mode', mode: 'patrol' } },
    ] });
    tick(sim, 3 * TICK_RATE);
    expect(w.tower.designated).toBe(healer);
    expect(seen).toEqual(['designate']);
    expect(w.build.targeting.primary).toBe('lowest_hp');
    expect(w.run.mode).toBe('patrol');
  });

  it('Auto-Prestige needs Autonomy and the setting; forecast_recommends reads the registered probe', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    const prestiges: string[] = [];
    const enqueue = w.enqueueCommand.bind(w);
    w.enqueueCommand = (c) => { if (c.type === 'prestige') prestiges.push(c.frame); enqueue(c); };
    const rule: Directive = { enabled: true, conditions: [{ kind: 'forecast_recommends' }], action: { kind: 'prestige' } };
    cmd(sim, { type: 'set_directives', directives: [rule] });
    try {
      expect(forecastRecommends(w)).toBe(false);   // WP8 forecast: nothing cleared yet
      setForecastProbe(() => true);
      tick(sim, TICK_RATE);
      expect(prestiges.length).toBe(0);            // no Autonomy
      unlock(sim, 'prestige.autonomy');
      tick(sim, TICK_RATE);
      expect(prestiges.length).toBe(0);            // setting off
      w.meta.settings.autoPrestige = true;
      tick(sim, TICK_RATE);
      expect(prestiges.length).toBeGreaterThanOrEqual(1);   // WP8 may really Prestige (resetting the attempt)
      expect(prestiges[0]).toBe('standard');
    } finally { setForecastProbe(null); }
  });

  it('Directive casts reach onCommand observers through the real Sim.step path', () => {
    const sim = arena();
    const w = sim.world;
    unlock(sim, 'prestige.directives');
    slot(sim, 'repulsor_pulse');
    for (let k = 0; k < 5; k++) dummy(sim, 60 + k * 8, 0);
    const seen: boolean[] = [];
    w.systems.push({ id: 'spy', init() {}, rebuild() {}, update() {}, onCommand: (_w, c) => { if (c.type === 'cast') seen.push(!!c.viaDirective); return false; } });
    sim.command({ type: 'set_directives', directives: [repulseAt5] });
    sim.run(60);
    expect(seen).toEqual([true]);
    expect(casts(sim, 'repulsor_pulse').length).toBe(1);
  });
});

describe('Autocast', () => {
  it('fires each slotted ability when affordable, after the reaction delay', () => {
    const sim = arena();
    unlock(sim, 'prestige.autocast');
    slot(sim, 'repulsor_pulse');
    sim.world.tower.ce = 100;
    dummy(sim, 60, 0);
    tick(sim, 35);
    expect(casts(sim).length).toBe(0);
    tick(sim, 5);
    const cs = casts(sim, 'repulsor_pulse');
    expect(cs.length).toBe(1);
    expect(cs[0].data).toMatchObject({ viaDirective: true, directive: -1 });
  });

  it('does nothing without prestige.autocast, and yields abilities owned by a Directive', () => {
    const sim = arena();
    slot(sim, 'repulsor_pulse');
    dummy(sim, 60, 0);
    tick(sim, 5 * TICK_RATE);
    expect(casts(sim).length).toBe(0);

    const s2 = arena();
    unlock(s2, 'prestige.autocast', 'prestige.directives');
    slot(s2, 'repulsor_pulse');
    dummy(s2, 60, 0);
    cmd(s2, { type: 'set_directives', directives: [repulseAt5] });   // owns the pulse; never satisfied
    tick(s2, 5 * TICK_RATE);
    expect(casts(s2).length).toBe(0);
  });

  it('aims point abilities at the densest group', () => {
    const sim = arena();
    unlock(sim, 'prestige.autocast');
    slot(sim, 'bombardment');
    for (let k = 0; k < 6; k++) dummy(sim, -250 + k * 6, 200);
    dummy(sim, 300, 0);
    tick(sim, TICK_RATE);
    const cs = casts(sim, 'bombardment');
    expect(cs.length).toBe(1);
    expect(Math.abs(cs[0].x + 235)).toBeLessThan(20);
    expect(Math.abs(cs[0].y - 200)).toBeLessThan(20);
  });
});
