/**
 * Reachability UI models (pure parts): the Doctrine fork (first / second / change / clear), rule warnings for Directives
 * that can never act, the Autocast mask, granted Exotics, Constellation regions and Frame caps. They run against a real
 * Sim's UiState so the labels follow the sim's rules.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import type { DoctrineId, TreeId } from '../../src/sim/core/ids';
import type { UiState } from '../../src/sim/core/types';
import { TREES, FRAMES, STAR_NODES } from '../../src/sim/data/index';
import { applyCommand } from '../../src/sim/run/commands';
import { confirmText, forkModel, freeDoctrineTrees, secondNote } from '../../src/ui/doctrine';
import { reactionDelay, ruleWarning } from '../../src/ui/directives';
import { autocastOn, setAutocast } from '../../src/ui/abilities';
import { grantedExotic } from '../../src/ui/shop';
import { regionLock } from '../../src/ui/constellation';
import { frameCapsText } from '../../src/ui/prestige';
import { replaceLoss } from '../../src/ui/draft';

function forkReady(sim: Sim, tree: TreeId): DoctrineId[] {
  const t = TREES.find((x) => x.id === tree)!;
  for (const n of t.shared.filter((x) => !x.ability).slice(0, t.forkRequirement)) sim.world.build.ranks[n.id] = 1;
  sim.world.rebuildStats();
  return t.doctrines.map((d) => d.id);
}
const act = (ui: UiState, tree: TreeId, doctrine: DoctrineId) => forkModel(ui, tree)!.cards.find((c) => c.doctrine === doctrine)!;

describe('Doctrine fork model', () => {
  it('no Doctrine yet: every card offers Choose (free)', () => {
    const sim = new Sim(null, 41);
    const ds = forkReady(sim, 'ballistics');
    const m = forkModel(sim.uiState(), 'ballistics')!;
    expect(m.cards.map((c) => c.actions.map((a) => a.kind))).toEqual(ds.map(() => ['choose']));
    expect(m.cards.every((c) => c.actions[0].blocked === null && c.actions[0].cost === 0)).toBe(true);
    expect(m.note).toBeNull();
  });

  it('fork not open: Choose is blocked with the reason', () => {
    const sim = new Sim(null, 42);
    const m = forkModel(sim.uiState(), 'ballistics')!;
    expect(m.cards[0].actions[0].blocked).toMatch(/Buy \d+ more Ballistics nodes/);
  });

  it('Spare Barrel: the other cards offer "Choose as 2nd · 50%" and the command carries second: true', () => {
    const sim = new Sim(null, 43);
    const [a, b] = forkReady(sim, 'ballistics');
    applyCommand(sim.machine, { type: 'choose_doctrine', tree: 'ballistics', doctrine: a });
    let ui = sim.uiState();
    expect(act(ui, 'ballistics', b).actions.map((x) => x.kind)).toEqual(['change1']);   // no second yet: a change (1 Core)
    expect(freeDoctrineTrees(ui)).toEqual([]);
    sim.world.build.anomalies.push('spare_barrel');
    sim.world.rebuildStats();
    ui = sim.uiState();
    const card = act(ui, 'ballistics', b);
    expect(card.actions).toHaveLength(1);
    expect(card.actions[0]).toMatchObject({ kind: 'second', label: 'Choose as 2nd · 50%', cost: 0, blocked: null, cmd: { type: 'choose_doctrine', tree: 'ballistics', doctrine: b, second: true } });
    expect(secondNote(ui, 'ballistics')).toMatch(/Spare Barrel: Ballistics can run a second Doctrine at 50%/);
    expect(freeDoctrineTrees(ui)).toEqual(['ballistics']);
    expect(confirmText(ui, 'ballistics', card, card.actions[0]).body).toMatch(/runs at 50% alongside/);
    // choose it: the card becomes "2nd", the first stays "1st"
    applyCommand(sim.machine, card.actions[0].cmd);
    ui = sim.uiState();
    expect(act(ui, 'ballistics', a)).toMatchObject({ state: 'first', tag: '1st' });
    expect(act(ui, 'ballistics', b)).toMatchObject({ state: 'second', tag: '2nd · 50%' });
    expect(freeDoctrineTrees(ui)).toEqual([]);
  });

  it('both chosen: Replace 1st / Replace 2nd (1 Core, checkpoint); Clear 2nd on the second card', () => {
    const sim = new Sim(null, 44);
    sim.world.build.frame = 'monolith';
    const [a, b, c] = forkReady(sim, 'ballistics');
    applyCommand(sim.machine, { type: 'choose_doctrine', tree: 'ballistics', doctrine: a });
    applyCommand(sim.machine, { type: 'choose_doctrine', tree: 'ballistics', doctrine: b, second: true });
    sim.world.run.cores = 3;
    let ui = sim.uiState();
    expect(ui.secondDoctrine?.ballistics?.strength).toBe(1);
    expect(act(ui, 'ballistics', b).tag).toBe('2nd · full strength');
    const open = act(ui, 'ballistics', c);
    expect(open.actions.map((x) => [x.kind, x.cost])).toEqual([['change1', 1], ['change2', 1]]);
    // the fresh Sim sits at the start of checkpoint 0: allowed
    expect(open.actions.every((x) => x.blocked === null)).toBe(true);
    expect(act(ui, 'ballistics', b).actions[0]).toMatchObject({ kind: 'clear2', cost: 1, blocked: null, cmd: { type: 'clear_second_doctrine', tree: 'ballistics' } });
    sim.world.run.phase = 'combat';
    ui = sim.uiState();
    expect(act(ui, 'ballistics', c).actions[0].blocked).toMatch(/checkpoint/);
    expect(act(ui, 'ballistics', b).actions[0].blocked).toMatch(/checkpoint/);
    // every action the model offers is accepted by the sim at a checkpoint
    sim.world.run.phase = 'between';
    ui = sim.uiState();
    expect(applyCommand(sim.machine, act(ui, 'ballistics', c).actions[1].cmd)).toBeNull();
    expect(sim.world.build.secondDoctrines.ballistics).toBe(c);
    ui = sim.uiState();
    expect(applyCommand(sim.machine, act(ui, 'ballistics', c).actions[0].cmd)).toBeNull();
    expect(sim.world.build.secondDoctrines.ballistics).toBeUndefined();
  });

  it('Dual Doctrine used on another tree: the fork says so', () => {
    const sim = new Sim(null, 45);
    sim.world.meta.prestigeRanks['prestige.dual_doctrine'] = 1;
    const bal = forkReady(sim, 'ballistics'), bas = forkReady(sim, 'bastion');
    applyCommand(sim.machine, { type: 'choose_doctrine', tree: 'ballistics', doctrine: bal[0] });
    applyCommand(sim.machine, { type: 'choose_doctrine', tree: 'bastion', doctrine: bas[0] });
    let ui = sim.uiState();
    expect(secondNote(ui, 'bastion')).toMatch(/^Dual Doctrine: one tree runs a second Doctrine at 60%/);
    const card = act(ui, 'bastion', bas[1]);
    expect(confirmText(ui, 'bastion', card, card.actions[0]).body).toMatch(/Dual Doctrine covers one tree: this makes Bastion that tree/);
    applyCommand(sim.machine, card.actions[0].cmd);
    ui = sim.uiState();
    expect(secondNote(ui, 'ballistics')).toMatch(/Dual Doctrine is in use on Bastion/);
    expect(act(ui, 'ballistics', bal[1]).actions.map((x) => x.kind)).toEqual(['change1']);
  });
});

describe('other reachability helpers', () => {
  it('ruleWarning: an unslotted cast and the Prestige action without Auto-Prestige', () => {
    const sim = new Sim(null, 46);
    const ui = sim.uiState();
    const cast = (ability: string) => ({ enabled: true, conditions: [], action: { kind: 'cast', ability, at: 'tower' } }) as never;
    expect(ruleWarning(cast(ui.build.abilities[0]!), ui)).toBeNull();
    expect(ruleWarning(cast('emp'), ui)).toMatch(/EMP is not in an ability slot/);
    const pr = { enabled: true, conditions: [], action: { kind: 'prestige' } } as never;
    expect(ruleWarning(pr, ui)).toMatch(/Autonomy/);
    ui.meta.prestigeRanks['prestige.autonomy'] = 1;
    expect(ruleWarning(pr, ui)).toMatch(/Auto-Prestige is off/);
    ui.meta.settings.autoPrestige = true;
    expect(ruleWarning(pr, ui)).toBeNull();
    expect(reactionDelay(0)).toBeCloseTo(0.6);
    expect(reactionDelay(5)).toBeCloseTo(0.3);
  });
  it('Autocast mask round-trips per ability', () => {
    let m = 0;
    expect(autocastOn(m, 'emp')).toBe(true);
    m = setAutocast(m, 'emp', false);
    expect(autocastOn(m, 'emp')).toBe(false);
    expect(autocastOn(m, 'overdrive')).toBe(true);
    m = setAutocast(m, 'emp', true);
    expect(m).toBe(0);
  });
  it('Recursive Warhead marks the Cluster Warheads Exotic as granted', () => {
    const b = { build: { anomalies: ['recursive_warhead'], ranks: {} } } as unknown as Pick<UiState, 'build'>;
    expect(grantedExotic(b, 'ordnance.cluster_warheads')).toMatch(/already gives you Cluster Warheads/);
    expect(grantedExotic(b, 'drones.payload')).toBeNull();
  });
  it('replacing a capability Anomaly says what goes with it', () => {
    const sim = new Sim(null, 47);
    const [a, b] = forkReady(sim, 'ballistics');
    sim.world.build.anomalies.push('spare_barrel', 'second_opinion', 'borrowed_blade');
    sim.world.rebuildStats();
    applyCommand(sim.machine, { type: 'choose_doctrine', tree: 'ballistics', doctrine: a });
    let ui = sim.uiState();
    expect(replaceLoss('spare_barrel', ui)).toBeNull();   // nothing chosen yet
    applyCommand(sim.machine, { type: 'choose_doctrine', tree: 'ballistics', doctrine: b, second: true });
    ui = sim.uiState();
    expect(replaceLoss('spare_barrel', ui)).toMatch(/second Barrel Doctrine/);
    expect(replaceLoss('second_opinion', ui)).toMatch(/second Target Designator/);
    expect(replaceLoss('borrowed_blade', ui)).toMatch(/borrowed Orbital Blade/);
    ui.meta.trials.commander = 1;
    expect(replaceLoss('second_opinion', ui)).toBeNull();
    expect(replaceLoss('glass_cannon', ui)).toBeNull();
  });
  it('Constellation regions and Frame caps', () => {
    expect(regionLock(STAR_NODES[0], 0)).toBe('Region revealed at Ascension 1');
    expect(regionLock(STAR_NODES[0], 1)).toBeNull();
    const meta = { meta: { prestigeRanks: { 'prestige.expanded_frame': 1, 'prestige.third_attunement': 1 } } } as unknown as Pick<UiState, 'meta'>;
    const f = (id: string) => FRAMES.find((x) => x.id === id)!;
    expect(frameCapsText(f('standard'), meta)).toBe('4 hardpoints · 3 attunements');
    expect(frameCapsText(f('monolith'), meta)).toBe('1 hardpoint · 3 attunements');
    expect(frameCapsText(f('hive'), meta)).toBe('3 + Drones (free) hardpoints · 3 attunements');
  });
});
