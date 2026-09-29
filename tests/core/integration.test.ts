/**
 * Cross-package integration fixes: designate_at, player command errors (Sim.takeLastError),
 * UiState additions, victim names on Kill events, speed rules, Mirror Hive clone HP bars,
 * area damage vs intangible enemies.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { EnemyFlag, Ev, INSTANCE_FLOATS, type Command } from '../../src/sim/core/types';
import type { System } from '../../src/sim/core/system';
import { applyCommand } from '../../src/sim/run/commands';
import { chainSentence } from '../../src/sim/core/events';
import { ensureClones } from '../../src/sim/enemies/bosses/tells';
import { updateHazards } from '../../src/sim/core/hazards';
import { quietSim, strongSim, runUntil } from './helpers';
import { arena, dummy, slot } from '../active/helpers';

const cmd = (sim: Sim, c: Command): string | null => applyCommand(sim.machine, c);

describe('designate_at', () => {
  it('designates the enemy nearest the point (not the instance ordinal) and notifies observers', () => {
    const sim = arena(3);
    const w = sim.world;
    const a = dummy(sim, 100, 0);
    const b = dummy(sim, -150, 40);
    const seen: Command[] = [];
    const spy = { id: 'spy', init() {}, rebuild() {}, update() {}, onCommand: (_w: unknown, c: Command) => { seen.push(c); return false; } } as unknown as System;
    w.systems.push(spy);
    expect(cmd(sim, { type: 'designate_at', x: -160, y: 45 })).toBeNull();
    expect(w.tower.designated).toBe(b);
    expect(w.tower.designatedGen).toBe(w.enemies.gen[b]);
    expect(seen).toEqual([{ type: 'designate', enemy: b }]);   // same path as 'designate'
    // a dead slot before it does not shift the pick
    w.killEnemy(a, -1, 'test');
    expect(cmd(sim, { type: 'designate_at', x: -150, y: 40 })).toBeNull();
    expect(w.tower.designated).toBe(b);
    // nothing within max(24, radius + 8)
    expect(cmd(sim, { type: 'designate_at', x: 300, y: 300 })).toBe('No enemy there');
  });

  it('ties resolve to the lower pool index; slot 1 follows the second-designator rule', () => {
    const sim = arena(4);
    const w = sim.world;
    const a = dummy(sim, 10, 0);
    const b = dummy(sim, -10, 0);
    expect(a).toBeLessThan(b);
    expect(cmd(sim, { type: 'designate_at', x: 0, y: 0 })).toBeNull();
    expect(w.tower.designated).toBe(a);
    expect(cmd(sim, { type: 'designate_at', x: -10, y: 0, slot: 1 })).toBe('No second designator');
  });
});

describe('player command errors', () => {
  it('Sim.takeLastError reports rejected player commands (machine and abilities), once', () => {
    const sim = arena(5);
    sim.world.run.scrap = 0;
    sim.command({ type: 'buy', node: 'ballistics.damage' });
    sim.step();
    expect(sim.lastErrorCommand).toBe('buy');
    expect(sim.takeLastError()).toMatch(/scrap/i);
    expect(sim.takeLastError()).toBeNull();
    slot(sim, 'bombardment');
    sim.world.tower.ce = 0;
    sim.world.run.phase = 'combat';
    sim.command({ type: 'cast', ability: 'bombardment', x: 0, y: 100 });
    sim.step();
    expect(sim.lastErrorCommand).toBe('cast');
    expect(sim.takeLastError()).toMatch(/Command Energy|combat/);
  });

  it('commands issued inside the sim (Directives / Autocast) are not reported', () => {
    const sim = arena(6);
    sim.world.enqueueCommand({ type: 'buy', node: 'ballistics.damage' });
    sim.world.run.scrap = 0;
    sim.step();
    expect(sim.takeLastError()).toBeNull();
  });
});

describe('UiState additions', () => {
  it('exposes patrol rate, Trial, next slot waves and the allowed speed', () => {
    const sim = new Sim(null, 7);
    const ui = sim.uiState();
    expect(ui.run.patrolScrapPerSecond).toBe(0);
    expect(ui.activeTrial).toBeNull();
    expect(ui.nextHardpointWave).toBe(10);
    expect(ui.nextAttunementWave).toBe(5);
    expect(ui.speedAllowed).toBe(1);
    sim.world.meta.prestigeRanks['prestige.early_hardpoints'] = 1;
    sim.world.meta.prestigeRanks['prestige.elemental_memory'] = 1;
    sim.world.run.attunementSlotsOpen = 1;
    const ui2 = sim.uiState();
    expect(ui2.nextHardpointWave).toBe(10);          // the first slot is not moved by Early Hardpoints
    expect(ui2.nextAttunementWave).toBe(25);
    sim.world.run.hardpointSlotsOpen = 1;
    expect(sim.uiState().nextHardpointWave).toBe(25); // 30 − 5
  });
});

describe('Kill events name the victim', () => {
  it('carries kind / elite / boss and the sentence names it', () => {
    const sim = arena(8);
    const w = sim.world;
    const brute = dummy(sim, 100, 0, 'brute', 1);
    const h = w.damage(brute, 1e9, { source: 'primary', srcTag: 'ballistics', cause: -1, trueDamage: true });
    const kill = w.events.recent(0).filter((e) => e.type === Ev.Kill).pop()!;
    expect(kill.data).toMatchObject({ kind: 'brute', elite: false, boss: false });
    expect(sim.inspect(kill.id).sentence).toContain('the Brute');
    expect(h.killed).toBe(true);
    const runner = dummy(sim, 0, 100, 'runner', 1, ['swift']);
    w.damage(runner, 1e9, { source: 'primary', srcTag: 'ballistics', cause: -1, trueDamage: true });
    const k2 = w.events.recent(0).filter((e) => e.type === Ev.Kill).pop()!;
    expect(k2.data).toMatchObject({ kind: 'runner', elite: true });
    expect(chainSentence([k2])).toContain('the elite Runner');
    const boss = w.spawnEnemy('boss', 0, -200, { bossId: 'warden', hpScale: 0.001 });
    w.damage(boss, 1e12, { source: 'primary', srcTag: 'ballistics', cause: -1, trueDamage: true });
    const k3 = w.events.recent(0).filter((e) => e.type === Ev.Kill).pop()!;
    expect(k3.data).toMatchObject({ kind: 'boss', boss: true, bossId: 'warden' });
    expect(chainSentence([k3])).toContain('the Warden (boss)');
  });
});

describe('speed rules', () => {
  it('manual ×2..×8 needs Speed Controls on solved waves; Accelerated Clearing applies automatically', () => {
    const sim = strongSim(9);
    const w = sim.world, run = w.run, meta = w.meta;
    meta.deepestEver = 30;
    expect(cmd(sim, { type: 'set_speed', speed: 2 })).toMatch(/Speed Controls/);
    expect(cmd(sim, { type: 'set_speed', speed: 1 })).toBeNull();
    meta.prestigeRanks['prestige.speed_controls'] = 1;
    expect(cmd(sim, { type: 'set_speed', speed: 2 })).toBeNull();
    expect(run.speedMultiplier).toBe(2);
    expect(cmd(sim, { type: 'set_speed', speed: 4 })).toMatch(/higher Speed Controls rank/);
    expect(sim.uiState().speedAllowed).toBe(2);
    run.wave = 31;
    expect(cmd(sim, { type: 'set_speed', speed: 2 })).toMatch(/solved waves/);
    run.wave = 1;
    meta.prestigeRanks['prestige.speed_controls'] = 0;
    meta.prestigeRanks['prestige.accelerated_clearing'] = 2;
    expect(sim.uiState().speedAllowed).toBe(4);
    cmd(sim, { type: 'set_speed', speed: 1 });
    runUntil(sim, () => run.phase === 'combat', 600);
    expect(run.speedMultiplier).toBe(4);             // automatic, from wave start
  });
});

describe('Mirror Hive', () => {
  it('clones and the true boss draw no HP bar', () => {
    const sim = arena(10);
    const w = sim.world;
    const b = w.spawnEnemy('boss', 0, 250, { bossId: 'mirror_hive' });
    ensureClones(w, b, 2, -1);
    for (let i = 0; i < w.enemies.count; i++) w.enemies.hp[i] = w.enemies.maxHp[i] * 0.5;
    const snap = sim.snapshot();
    let enemies = 0;
    for (let k = 0; k < snap.instanceCount; k++) {
      const o = k * INSTANCE_FLOATS;
      if (snap.instances[o + 9] !== 4) continue;
      enemies++;
      expect(snap.instances[o + 10]).toBe(0);
    }
    expect(enemies).toBe(3);
    // an ordinary damaged enemy still shows its bar
    const g = dummy(sim, 100, 0);
    w.enemies.hp[g] = w.enemies.maxHp[g] * 0.5;
    const s2 = sim.snapshot();
    let bars = 0;
    for (let k = 0; k < s2.instanceCount; k++) { const o = k * INSTANCE_FLOATS; if (s2.instances[o + 9] === 4 && s2.instances[o + 10] > 0) bars++; }
    expect(bars).toBe(1);
  });
});

describe('area damage vs intangible enemies', () => {
  it('explosions and hazards skip Phased and Burrowed enemies', () => {
    const sim = quietSim(11);
    const w = sim.world;
    const a = w.spawnEnemy('grunt', 0, 200, { hpScale: 100 });
    const b = w.spawnEnemy('grunt', 10, 200, { hpScale: 100 });
    const c = w.spawnEnemy('grunt', -10, 200, { hpScale: 100 });
    w.enemies.flags[b] |= EnemyFlag.Phased;
    w.enemies.flags[c] |= EnemyFlag.Burrowed;
    w.rebuildSpatial();
    const hb = w.enemies.hp[b], hc = w.enemies.hp[c], ha = w.enemies.hp[a];
    w.explode(0, 200, 80, 50, { source: 'ability', srcTag: 'ability.bombardment', cause: -1 });
    expect(w.enemies.hp[a]).toBeLessThan(ha);
    expect(w.enemies.hp[b]).toBe(hb);
    expect(w.enemies.hp[c]).toBe(hc);
    const ha2 = w.enemies.hp[a];
    w.addHazard({ kind: 'fire_zone', x: 0, y: 200, radius: 80, life: 2, dps: 100, cause: -1, owner: 'ordnance' });
    for (let t = 0; t < 31; t++) { w.rebuildSpatial(); updateHazards(w); w.run.tick++; }
    expect(w.enemies.hp[a]).toBeLessThan(ha2);
    expect(w.enemies.hp[b]).toBe(hb);
    expect(w.enemies.hp[c]).toBe(hc);
  });
});
