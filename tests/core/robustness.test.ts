/**
 * Robustness gates from the code-health review: malformed Commands, corrupted saves, the save
 * migration scaffold, pending Anomaly drafts across save/load, numeric guards, and enemy heals going
 * through World (causality).
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import type { Command, SaveState } from '../../src/sim/core/types';
import { Ev, SAVE_VERSION } from '../../src/sim/core/types';
import { migrate, type Migration } from '../../src/sim/save/serialize';
import { validateCommand } from '../../src/sim/run/validate';
import { growth } from '../../src/sim/math/lut';
import { statCost } from '../../src/sim/economy/curves';
import { quietSim } from './helpers';

const MALFORMED: unknown[] = [
  null, undefined, 42, 'buy', [], {}, { type: 42 }, { type: 'no_such_command' },
  { type: 'buy' }, { type: 'buy', node: 7 },
  { type: 'mount_hardpoint', slot: Number.NaN, system: 'drones' }, { type: 'mount_hardpoint', slot: 0.5, system: 'drones' },
  { type: 'mount_hardpoint', slot: 0, system: 'primary' }, { type: 'attune', slot: 0, element: 'shadow' },
  { type: 'designate', enemy: 1.5 }, { type: 'designate', enemy: '0' }, { type: 'designate', enemy: 0, slot: 2 },
  { type: 'designate_at', x: Number.NaN, y: 0 },
  { type: 'manual_aim', active: true, angle: Number.NaN }, { type: 'manual_aim', active: 'yes', angle: 0 },
  { type: 'cast', ability: 'emp', x: Number.POSITIVE_INFINITY, y: 0 }, { type: 'cast', x: 0, y: 0 },
  { type: 'set_targeting', system: 'primary', profile: 'bogus' }, { type: 'set_targeting', system: '__proto__', profile: 'nearest' },
  { type: 'set_setting', key: '__proto__', value: 1 }, { type: 'set_setting', key: 'clarity', value: Number.NaN },
  { type: 'set_setting', key: 'autoPrestige', value: 1 }, { type: 'offline_return', elapsedSeconds: -5 },
  { type: 'offline_return', elapsedSeconds: Number.POSITIVE_INFINITY }, { type: 'pick_anomaly', anomaly: 'x', replace: Number.NaN },
  { type: 'set_ability_slot', slot: Number.NaN, ability: 'emp' }, { type: 'set_speed', speed: 3 },
  { type: 'set_directives', directives: 'all of them' }, { type: 'set_upgrade_queue', rules: null },
  { type: 'save_blueprint', blueprint: { name: 'x' } }, { type: 'prestige', frame: 'standard', threatDial: Number.NaN },
  { type: 'set_threat_dial', level: Number.NaN }, { type: 'start_trial', trial: 3 }, { type: 'set_mode', mode: 'turbo' },
];

describe('malformed commands', () => {
  it('validateCommand rejects every malformed command and accepts well-formed ones', () => {
    for (const c of MALFORMED) expect(validateCommand(c), JSON.stringify(c) ?? String(c)).not.toBeNull();
    const ok: Command[] = [
      { type: 'buy', node: 'ballistics.damage' }, { type: 'designate', enemy: null }, { type: 'designate', enemy: 3, slot: 1 },
      { type: 'manual_aim', active: false, angle: 0 }, { type: 'set_setting', key: 'clarity', value: 0.3 },
      { type: 'set_targeting', system: 'laser', profile: 'designated' }, { type: 'cast', ability: 'emp', x: 1, y: 2, viaDirective: true, directive: -1 },
      { type: 'offline_return', elapsedSeconds: 60 }, { type: 'pick_anomaly', anomaly: null }, { type: 'restart_checkpoint' },
    ];
    for (const c of ok) expect(validateCommand(c), JSON.stringify(c)).toBeNull();
  });

  it('never throw, never corrupt state, and leave the event stream identical to a Sim that got none', () => {
    const fuzzed = new Sim(null, 6), control = new Sim(null, 6);
    const settingsBefore = JSON.stringify(fuzzed.world.meta.settings);
    let errors = 0;
    for (let t = 0; t < 1800; t++) {
      if (t % 20 === 0) {
        for (const c of MALFORMED) fuzzed.command(c as Command);
      }
      expect(() => fuzzed.step()).not.toThrow();
      if (fuzzed.takeLastError() !== null) errors++;
      control.step();
    }
    expect(errors).toBeGreaterThan(0);
    expect(fuzzed.events.hash()).toBe(control.events.hash());
    const w = fuzzed.world;
    expect(Number.isFinite(w.tower.manualAngle)).toBe(true);
    expect(Object.keys(w.build.hardpoints).every((k) => /^\d+$/.test(k))).toBe(true);
    expect(Object.keys(w.build.attunements).every((k) => /^\d+$/.test(k))).toBe(true);
    expect(JSON.stringify(w.meta.settings)).toBe(settingsBefore);
    expect(Object.keys(w.build.targeting)).toEqual([]);
  });
});

describe('save migration and sanitization', () => {
  it('migrates through a synthetic v2 step; a missing step is a readable error', () => {
    const save = new Sim(null, 2).save();
    expect(save.version).toBe(SAVE_VERSION);
    const toV2: Migration = (s) => ({ ...s, meta: { ...s.meta, echoes: s.meta.echoes + 100 } });
    const v2 = migrate({ ...save, version: 1 }, 2, { 1: toV2 });
    expect(v2.version).toBe(2);
    expect(v2.meta.echoes).toBe(save.meta.echoes + 100);
    expect(() => migrate({ ...save, version: 1 }, 3, { 1: toV2 })).toThrow(/version 2 to 3/);
    // the real table is identity at SAVE_VERSION: a valid save passes through unchanged
    expect(migrate(save)).toEqual(JSON.parse(JSON.stringify(save)));
  });

  it('rejects non-saves with a readable error', () => {
    expect(() => migrate(null as unknown as SaveState)).toThrow(/Not a Citadel save/);
    expect(() => migrate({ version: 1 } as unknown as SaveState)).toThrow(/Not a Citadel save/);
  });

  it('a corrupted save loads and plays: unknown Trial / frame / anomalies, NaN numbers, huge ranks, zero PRNG', () => {
    const save = JSON.parse(JSON.stringify(new Sim(null, 4).save())) as SaveState;
    save.meta.activeTrial = 'no_such_trial' as never;
    save.run.build.frame = 'no_such_frame' as never;
    save.run.build.anomalies = ['bogus' as never, 'loaded_dice'];
    save.run.build.ranks = { 'ballistics.damage': 1e12, 'bastion.max_hp': Number.NaN as number, 'ballistics.attack_speed': -3, 'reactor.x': 2.7 };
    save.run.scrap = Number.NaN; save.run.cores = -4;
    save.run.prngState = [0, 0, 0, 0];
    (save.run as unknown as Record<string, unknown>).firstClears = 'lots';
    const sim = Sim.load(save);
    expect(sim.world.meta.activeTrial).toBeNull();
    expect(sim.world.build.frame).toBe('standard');
    expect(sim.world.build.anomalies).toEqual(['loaded_dice']);
    expect(sim.world.build.ranks).toEqual({ 'ballistics.damage': 1e12, 'reactor.x': 2 });
    expect(sim.world.run.scrap).toBe(0);
    expect(sim.world.prng.state().some((v) => v !== 0)).toBe(true);
    expect(() => { sim.run(1200); sim.uiState(); sim.snapshot(); }).not.toThrow();
    expect(Number.isFinite(sim.world.tower.hp)).toBe(true);
  });
});

describe('pending Anomaly draft across save/load', () => {
  it('is saved, restored and still pickable (it used to be lost on reload)', () => {
    const a = new Sim(null, 3);
    a.world.run.pendingDraft = ['loaded_dice', 'seventh_shot', 'spare_barrel'];
    const b = Sim.load(JSON.parse(JSON.stringify(a.save())) as SaveState);
    expect(b.world.run.pendingDraft).toEqual(['loaded_dice', 'seventh_shot', 'spare_barrel']);
    b.command({ type: 'pick_anomaly', anomaly: 'seventh_shot' });
    b.step();
    expect(b.takeLastError()).toBeNull();
    expect(b.world.build.anomalies).toContain('seventh_shot');
    expect(b.world.run.pendingDraft).toBeNull();
    expect(Sim.load(b.save()).world.run.pendingDraft).toBeNull();
  });
});

describe('numeric guards', () => {
  it('growth() never allocates a giant table for huge or non-finite exponents', () => {
    expect(growth(1.15, 1e12)).toBe(Number.POSITIVE_INFINITY);
    expect(growth(0.5, 1e12)).toBe(0);
    expect(growth(1.15, Number.NaN)).toBe(1);
    expect(growth(1.15, 10)).toBeCloseTo(1.15 ** 10, 10);
    expect(statCost(10, 1.2, 1e9)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('causality: enemy heals go through World.healEnemy', () => {
  it('caps at max HP, emits Heal with the cause unless silent, ignores dead enemies', () => {
    const sim = quietSim();
    const w = sim.world;
    const i = w.spawnEnemy('grunt', 100, 0, { hpScale: 10 });
    const max = w.enemies.maxHp[i];
    w.damage(i, max * 0.5, { source: 'primary', srcTag: 'ballistics', cause: -1, trueDamage: true });
    const before = w.events.nextId;
    const got = w.healEnemy(i, max, 'healer', 77);
    expect(got).toBeCloseTo(max * 0.5, 3);
    expect(w.enemies.hp[i]).toBe(w.enemies.maxHp[i]);
    const ev = w.events.byId(before)!;
    expect(ev.type).toBe(Ev.Heal); expect(ev.cause).toBe(77); expect(ev.a).toBe(i);
    w.damage(i, 5, { source: 'primary', srcTag: 'ballistics', cause: -1, trueDamage: true });
    const n = w.events.nextId;
    expect(w.healEnemy(i, 1, 'elite.regenerating', -1, true)).toBe(1);
    expect(w.events.nextId).toBe(n);
    w.killEnemy(i, -1, 'test');
    expect(w.healEnemy(i, 10, 'healer', -1)).toBe(0);
  });
});
