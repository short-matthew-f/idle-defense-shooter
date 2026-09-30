/**
 * Reachability (docs/reviews/REACHABILITY.md): sim support for capabilities the UI must be able to reach.
 *   second Doctrine (choose, strength/source in UiState, change, clear), ability slots growing with the count,
 *   designate_at choosing the designator slot, Borrowed Blade mountable into a slot, Blueprint delete,
 *   per-ability Autocast off, and the UiState fields the Build screen reads (caps, mount blocks).
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import type { DoctrineId, TreeId } from '../../src/sim/core/ids';
import { TREES, ABILITIES } from '../../src/sim/data/index';
import { syncAbilitySlots } from '../../src/sim/core/stats';
import { validateCommand } from '../../src/sim/run/validate';
import { abilitySlotCount } from '../../src/sim/systems/abilities';
import { arena, cmd, dummy, setTrial } from '../active/helpers';

function forkReady(sim: Sim, tree: TreeId): DoctrineId[] {
  const t = TREES.find((x) => x.id === tree)!;
  for (const n of t.shared.filter((x) => !x.ability).slice(0, t.forkRequirement)) sim.world.build.ranks[n.id] = 1;
  sim.world.rebuildStats();
  return t.doctrines.map((d) => d.id);
}
/** Put the run at the start of its checkpoint (the Doctrine-change window). */
function atCheckpoint(sim: Sim): void { const r = sim.world.run; r.phase = 'between'; r.wave = r.checkpoint + 1; }

describe('second Doctrine', () => {
  it('Spare Barrel: UiState reports 50% from the Anomaly; choose_doctrine second: true fills the second', () => {
    const sim = new Sim(null, 21);
    const [a, b, c] = forkReady(sim, 'ballistics');
    expect(sim.uiState().secondDoctrine?.ballistics).toBeUndefined();
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: a })).toBeNull();
    sim.world.build.anomalies.push('spare_barrel');
    sim.world.rebuildStats();
    expect(sim.uiState().secondDoctrine?.ballistics).toEqual({ allowed: true, strength: 0.5, source: 'spare_barrel' });
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: b, second: true })).toBeNull();
    expect(sim.world.build.doctrines.ballistics).toBe(a);
    expect(sim.world.build.secondDoctrines.ballistics).toBe(b);
    expect(sim.world.stats.doctrineStrength('ballistics', b)).toBe(0.5);
    // change the second: 1 Core, at a checkpoint (the first stays)
    sim.world.run.cores = 0;
    sim.world.run.phase = 'combat';
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: c, second: true })).toMatch(/checkpoint/);
    atCheckpoint(sim);
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: c, second: true })).toBe('Not enough Cores');
    sim.world.run.cores = 2;
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: c, second: true })).toBeNull();
    expect(sim.world.build.secondDoctrines.ballistics).toBe(c);
    expect(sim.world.build.doctrines.ballistics).toBe(a);
    expect(sim.world.run.cores).toBe(1);
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: a, second: true })).toBe('Already chosen');
  });

  it('frames: Monolith (Ballistics) and Bulwark (Bastion) at full strength, Singularity Core 60% everywhere', () => {
    const mono = new Sim(null, 22); mono.world.build.frame = 'monolith'; mono.world.rebuildStats();
    expect(mono.uiState().secondDoctrine).toEqual({ ballistics: { allowed: true, strength: 1, source: 'monolith' } });
    const bul = new Sim(null, 23); bul.world.build.frame = 'bulwark'; bul.world.rebuildStats();
    expect(bul.uiState().secondDoctrine).toEqual({ bastion: { allowed: true, strength: 1, source: 'bulwark' } });
    const sing = new Sim(null, 24); sing.world.build.frame = 'singularity_core'; sing.world.rebuildStats();
    const sd = sing.uiState().secondDoctrine!;
    expect(Object.keys(sd).sort()).toEqual(['ballistics', 'bastion', 'reactor']);
    expect(sd.reactor).toEqual({ allowed: true, strength: 0.6, source: 'singularity_core' });
  });

  it('Dual Doctrine: one tree; clearing the second (1 Core, at a checkpoint) frees it for another tree', () => {
    const sim = new Sim(null, 25);
    sim.world.meta.prestigeRanks['prestige.dual_doctrine'] = 1;
    const bal = forkReady(sim, 'ballistics'), bas = forkReady(sim, 'bastion');
    cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: bal[0] });
    cmd(sim, { type: 'choose_doctrine', tree: 'bastion', doctrine: bas[0] });
    expect(sim.uiState().secondDoctrine?.bastion).toEqual({ allowed: true, strength: 0.6, source: 'dual_doctrine' });
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'ballistics', doctrine: bal[1], second: true })).toBeNull();
    const ui = sim.uiState().secondDoctrine!;
    expect(ui.ballistics?.allowed).toBe(true);
    expect(ui.bastion).toBeUndefined();   // Dual Doctrine is used by Ballistics now
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'bastion', doctrine: bas[1], second: true })).toMatch(/cannot run a second/);
    sim.world.run.phase = 'combat';
    expect(cmd(sim, { type: 'clear_second_doctrine', tree: 'ballistics' })).toMatch(/checkpoint/);
    atCheckpoint(sim);
    sim.world.run.cores = 1;
    expect(cmd(sim, { type: 'clear_second_doctrine', tree: 'ballistics' })).toBeNull();
    expect(sim.world.build.secondDoctrines.ballistics).toBeUndefined();
    expect(sim.world.run.cores).toBe(0);
    expect(cmd(sim, { type: 'clear_second_doctrine', tree: 'ballistics' })).toBe('No second Doctrine to clear');
    expect(cmd(sim, { type: 'choose_doctrine', tree: 'bastion', doctrine: bas[1], second: true })).toBeNull();
    expect(sim.world.build.secondDoctrines.bastion).toBe(bas[1]);
  });
});

describe('ability slots follow abilitySlotCount', () => {
  it('syncAbilitySlots grows with nulls and never drops a filled slot', () => {
    const a: (string | null)[] = ['x', null];
    syncAbilitySlots(a, 4); expect(a).toEqual(['x', null, null, null]);
    syncAbilitySlots(a, 2); expect(a).toEqual(['x', null]);
    const b: (string | null)[] = ['x', null, 'y', null];
    syncAbilitySlots(b, 2); expect(b).toEqual(['x', null, 'y']);
  });
  it('Third Tactical Slot adds a slot on stat rebuild and after a load; the new slot can be assigned and cast', () => {
    const sim = arena(26);
    const w = sim.world;
    expect(w.build.abilities.length).toBe(2);
    w.meta.prestigeRanks['prestige.third_tactical_slot'] = 1;
    w.rebuildStats();
    expect(w.build.abilities.length).toBe(3);
    expect(abilitySlotCount(w)).toBe(3);
    expect(sim.uiState().abilitySlots).toBe(3);
    expect(cmd(sim, { type: 'set_ability_slot', slot: 2, ability: 'overdrive' })).toBeNull();
    expect(cmd(sim, { type: 'cast', ability: 'overdrive', x: 0, y: 0 })).toBeNull();
    // a save whose build predates the slot comes back with it
    const save = sim.save();
    save.run.build.abilities = ['repulsor_pulse', 'hunter_mark'];
    const loaded = new Sim(save, 26);
    expect(loaded.world.build.abilities).toEqual(['repulsor_pulse', 'hunter_mark', null]);
  });
});

describe('designate_at picks the designator slot', () => {
  it('one designator: a tap designates; tapping the designated enemy clears it', () => {
    const sim = arena(27);
    const w = sim.world;
    const a = dummy(sim, 150, 0), b = dummy(sim, -150, 0);
    expect(sim.uiState().designators).toEqual({ slots: 1, live: 0 });
    expect(cmd(sim, { type: 'designate_at', x: 150, y: 0 })).toBeNull();
    expect(w.tower.designated).toBe(a);
    expect(sim.uiState().designators).toEqual({ slots: 1, live: 1 });
    expect(cmd(sim, { type: 'designate_at', x: -150, y: 0 })).toBeNull();
    expect(w.tower.designated).toBe(b);
    expect(w.tower.designated2).toBe(-1);
    expect(cmd(sim, { type: 'designate_at', x: -150, y: 0 })).toBeNull();
    expect(w.tower.designated).toBe(-1);
  });
  it('two designators: fill slot 0, then 1, then replace the older; a tap on either clears it', () => {
    const sim = arena(28);
    const w = sim.world, t = w.tower;
    w.build.anomalies.push('second_opinion');
    w.rebuildStats();
    const a = dummy(sim, 150, 0), b = dummy(sim, -150, 0), c = dummy(sim, 0, 150);
    expect(sim.uiState().designators).toEqual({ slots: 2, live: 0 });
    cmd(sim, { type: 'designate_at', x: 150, y: 0 });
    cmd(sim, { type: 'designate_at', x: -150, y: 0 });
    expect([t.designated, t.designated2]).toEqual([a, b]);
    expect(sim.uiState().designators).toEqual({ slots: 2, live: 2 });
    cmd(sim, { type: 'designate_at', x: 0, y: 150 });   // replaces the older (slot 0)
    expect([t.designated, t.designated2]).toEqual([c, b]);
    const d = dummy(sim, 0, -150);
    cmd(sim, { type: 'designate_at', x: 0, y: -150 });   // now slot 1 is the older
    expect([t.designated, t.designated2]).toEqual([c, d]);
    cmd(sim, { type: 'designate_at', x: 0, y: -150 });   // tap a designated enemy: clear
    expect([t.designated, t.designated2]).toEqual([c, -1]);
    cmd(sim, { type: 'designate_at', x: 150, y: 0 });   // the free slot fills
    expect([t.designated, t.designated2]).toEqual([c, a]);
  });
  it('while a boss tell asks for a designation, tapping the designated enemy re-designates it', () => {
    const sim = arena(29);
    const w = sim.world;
    const a = dummy(sim, 150, 0);
    cmd(sim, { type: 'designate_at', x: 150, y: 0 });
    w.bossTell.ability = 'designate'; w.bossTell.ticksLeft = 60;
    cmd(sim, { type: 'designate_at', x: 150, y: 0 });
    expect(w.tower.designated).toBe(a);
  });
  it('Blackout: no designators', () => {
    const sim = arena(30);
    setTrial(sim, 'blackout');
    expect(sim.uiState().designators).toEqual({ slots: 0, live: 0 });
  });
});

describe('other reachability support', () => {
  it('a Borrowed Blade can be mounted into a hardpoint slot (then it is not borrowed)', () => {
    const sim = new Sim(null, 31);
    const w = sim.world;
    w.build.anomalies.push('borrowed_blade');
    w.run.hardpointSlotsOpen = 1; w.build.hardpoints = [null];
    w.rebuildStats();
    expect(w.stats.borrowed('blade')).toBe(true);
    expect(cmd(sim, { type: 'mount_hardpoint', slot: 0, system: 'blade' })).toBeNull();
    expect(w.stats.borrowed('blade')).toBe(false);
    expect(sim.uiState().extraSystems).toEqual([]);
    expect(cmd(sim, { type: 'mount_hardpoint', slot: 0, system: 'blade' })).toMatch(/occupied/);
  });
  it('mountBlocked names the Frame free mount and Trial rules; slotCaps follow Frame and Prestige', () => {
    const hive = new Sim(null, 32); hive.world.build.frame = 'hive'; hive.world.rebuildStats();
    expect(hive.uiState().mountBlocked).toEqual({ drones: 'Mounted free by your Frame' });
    expect(hive.uiState().slotCaps).toEqual({ hardpoint: 2, attunement: 2 });
    const std = new Sim(null, 33);
    std.world.meta.prestigeRanks['prestige.expanded_frame'] = 1;
    std.world.meta.prestigeRanks['prestige.third_attunement'] = 1;
    expect(std.uiState().slotCaps).toEqual({ hardpoint: 4, attunement: 3 });
    const siege = new Sim(null, 34);
    setTrial(siege, 'siege_mentality');
    expect(Object.keys(siege.uiState().mountBlocked ?? {}).sort()).toEqual(['drones', 'gravitics', 'laser', 'ordnance']);
  });
  it('delete_blueprint frees a slot', () => {
    const sim = new Sim(null, 35);
    const w = sim.world;
    w.meta.prestigeRanks['prestige.blueprint_slots'] = 1;
    const bp = { name: 'A', frame: 'standard' as const, hardpoints: [], attunements: [], doctrines: {}, targeting: {}, upgradeQueue: [] };
    expect(cmd(sim, { type: 'save_blueprint', blueprint: bp })).toBeNull();
    expect(cmd(sim, { type: 'save_blueprint', blueprint: { ...bp, name: 'B' } })).toBe('No free blueprint slot');
    expect(cmd(sim, { type: 'delete_blueprint', index: 3 })).toBe('No such blueprint');
    expect(cmd(sim, { type: 'delete_blueprint', index: 0 })).toBeNull();
    expect(cmd(sim, { type: 'save_blueprint', blueprint: { ...bp, name: 'B' } })).toBeNull();
    expect(w.meta.blueprints.map((b) => b.name)).toEqual(['B']);
  });
  it('autocastOff is a validated setting', () => {
    expect(validateCommand({ type: 'set_setting', key: 'autocastOff', value: 5 })).toBeNull();
    expect(validateCommand({ type: 'set_setting', key: 'autocastOff', value: -1 })).toMatch(/Malformed/);
    expect(validateCommand({ type: 'set_setting', key: 'autocastOff', value: 1.5 })).toMatch(/Malformed/);
    expect(validateCommand({ type: 'clear_second_doctrine', tree: 'ballistics' })).toBeNull();
    expect(validateCommand({ type: 'delete_blueprint', index: 'x' })).toMatch(/Malformed/);
  });
  it('Autocast skips abilities switched off in autocastOff', () => {
    const sim = arena(36);
    const w = sim.world;
    w.meta.prestigeRanks['prestige.autocast'] = 1;
    w.build.abilities = ['repulsor_pulse', null];
    w.rebuildStats();
    dummy(sim, 60, 0);
    const bit = 1 << ABILITIES.findIndex((a) => a.id === 'repulsor_pulse');
    expect(cmd(sim, { type: 'set_setting', key: 'autocastOff', value: bit })).toBeNull();
    for (let k = 0; k < 120; k++) sim.step();
    expect(w.events.recent(0, 1000, (e) => e.src === 'ability.repulsor_pulse').length).toBe(0);
    cmd(sim, { type: 'set_setting', key: 'autocastOff', value: 0 });
    for (let k = 0; k < 120; k++) sim.step();
    expect(w.events.recent(0, 5000, (e) => e.src === 'ability.repulsor_pulse').length).toBeGreaterThan(0);
  });
});
