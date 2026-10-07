/**
 * Directive gap harness (sim-cli/acceptance.ts testDirectiveGap): the directive climbs must run the game's own Directive
 * engine and Autocast, not the policy's emulated caster. These tests drive a boss wave with the automation owned and
 * check that engine-issued casts happen (Ev.Cast data.viaDirective, directive index ≥ 0 for a rule, −1 for Autocast),
 * that an engine cast inside a tell window scores a Counter, and that the idle / active baselines' "automation off"
 * setting really silences it.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { bossHp } from '../../src/sim/economy/curves';
import { bossDef } from '../../src/sim/core/content';
import { Ev } from '../../src/sim/core/types';
import type { Directive } from '../../src/sim/core/types';
import type { AbilityId } from '../../src/sim/core/ids';
import { ABILITY_IDS } from '../../src/sim/systems/abilities';
import { DirectivePolicy, AUTOMATION_DIRECTIVES, AUTOMATION_SLOTS } from '../../sim-cli/policies';
import { AUTOMATION_RANKS } from '../../sim-cli/runner';

/** Wave-5 boss (The Breaker: Slam wind-up, countered by Repulsor Pulse) with the given Prestige ranks owned. */
function breaker(ranks: Record<string, number>, slots: AbilityId[], autocastOff = 0): Sim {
  const sim = new Sim(null, 13);
  const w = sim.world, def = bossDef('breaker', 5);
  for (const [id, r] of Object.entries(ranks)) w.meta.prestigeRanks[id] = r;
  w.meta.prestigeCount = 1;
  w.meta.settings.autocastOff = autocastOff;
  w.meta.echoes = 1e12;
  w.stats.override('ballistics.damage', (bossHp(5, def.hpMul, 0, 0) / 20000) * (1 + def.armor / 100));   // the boss lives through many tells
  w.stats.override('bastion.max_hp', 1e12);
  w.build.abilities = [...slots];
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  w.run.wave = 5;
  sim.machine.startWave();
  return sim;
}

interface Seen { ruleCasts: number; autocasts: number; counters: number; counterEff: number[] }
function play(sim: Sim, seconds: number, policy?: DirectivePolicy): Seen {
  const w = sim.world, from = sim.events.nextId;
  for (let t = 0; t < seconds * 60; t++) {
    w.tower.ce = w.tower.ceCap;   // CE is not what is under test
    policy?.tick(sim);
    sim.step();
  }
  const out: Seen = { ruleCasts: 0, autocasts: 0, counters: 0, counterEff: [] };
  sim.events.forEachSince(from, (e) => {
    if (e.type === Ev.Cast) {
      const d = e.data as { viaDirective?: boolean; directive?: number } | undefined;
      if (d?.viaDirective && (d.directive ?? -1) >= 0) out.ruleCasts++;
      else if (d?.viaDirective) out.autocasts++;
    } else if (e.type === Ev.CounterScored) { out.counters++; out.counterEff.push(e.b); }
  });
  return out;
}

describe('Directive gap: the real automation plays', () => {
  it('the directive policy installs its Directive set and the engine casts with it (rules and Autocast)', () => {
    const sim = breaker({ ...AUTOMATION_RANKS }, ['hunter_mark', 'hunter_mark']);
    const policy = new DirectivePolicy();
    const s = play(sim, 60, policy);
    expect(policy.stats.directivesInstalled).toBe(1);
    expect(sim.world.meta.directives).toEqual(AUTOMATION_DIRECTIVES);
    expect(sim.world.build.abilities).toEqual(AUTOMATION_SLOTS);
    expect(policy.stats.casts).toBe(0);                 // the policy itself never casts: the engine does
    expect(s.ruleCasts + s.autocasts).toBeGreaterThan(0);
  }, 60_000);

  it('Autocast alone casts every slotted ability (directive index −1)', () => {
    const s = play(breaker({ 'prestige.autocast': 1 }, ['repulsor_pulse', 'bombardment']), 60);
    expect(s.autocasts).toBeGreaterThan(0);
    expect(s.ruleCasts).toBe(0);
  }, 60_000);

  it('an engine cast inside a tell window scores a Counter at the Directive efficiency', () => {
    // Adept rule (needs Autonomy): on a live tell, Repulsor Pulse — the Breaker's Counter
    const rule: Directive[] = [{ enabled: true, conditions: [{ kind: 'boss_tell_active' }], action: { kind: 'cast', ability: 'repulsor_pulse', at: 'tower' } }];
    const sim = breaker({ ...AUTOMATION_RANKS, 'prestige.autonomy': 1 }, ['repulsor_pulse', 'bombardment'], 1 << ABILITY_IDS.indexOf('repulsor_pulse'));
    const s = play(sim, 60, new DirectivePolicy(rule, ['repulsor_pulse', 'bombardment']));
    expect(s.ruleCasts).toBeGreaterThan(0);
    expect(s.counters).toBeGreaterThan(0);
    expect(s.counterEff.every((b) => b === 50)).toBe(true);   // directives.counter_efficiency 50% at Directive Tuning 0
  }, 60_000);

  it('the idle / active baseline setting (Autocast off for every ability, no Directives) silences the automation', () => {
    const s = play(breaker({ ...AUTOMATION_RANKS }, ['repulsor_pulse', 'bombardment'], (1 << ABILITY_IDS.length) - 1), 60);
    expect(s.ruleCasts + s.autocasts).toBe(0);
  }, 60_000);
});
