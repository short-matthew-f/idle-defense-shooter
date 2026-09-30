/**
 * Boss Tell / Counter audit (docs/reviews/EFFECT-AUDIT.md): for every boss and every tell it can show (The Crown's three
 * phases, Deep Graft's two borrowed sources), wait for the tell, perform the mapped Counter and assert Ev.CounterScored
 * with the right src; in an identical Sim, the wrong action (another ability, or designating the wrong enemy) and a cast
 * the abilities system rejects (not slotted, on cooldown) must not score.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { bossHp } from '../../src/sim/economy/curves';
import { bossDef } from '../../src/sim/core/content';
import { BOSSES, TELL_COUNTERS, tellAttack, graftSources } from '../../src/sim/data/bosses';
import { Ev } from '../../src/sim/core/types';
import type { AbilityId, BossId } from '../../src/sim/core/ids';
import { counterHint } from '../../src/sim/enemies/bosses';
import { findAbilities } from '../../src/sim/systems/abilities';

function bossSim(id: BossId, wave: number, seed = 13): Sim {
  const sim = new Sim(null, seed);
  const w = sim.world, s = w.stats, def = bossDef(id, wave);
  s.override('ballistics.damage', (bossHp(wave, def.hpMul, 0, 0) / 20000) * (1 + def.armor / 100));   // barely scratches it
  s.override('bastion.max_hp', 1e12);
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  w.run.wave = wave;
  sim.machine.startWave();
  return sim;
}

function ready(sim: Sim, ...abilities: AbilityId[]): void {
  const w = sim.world;
  w.build.abilities = [...abilities];
  findAbilities(w)!.cd.fill(0);
  w.tower.ce = w.tower.ceCap;
}

/** Step until the n-th tell of the boss opens (optionally forcing a phase first). Returns false on timeout. */
function toTell(sim: Sim, phase: number, nth = 1): boolean {
  const w = sim.world;
  for (let k = 0; k < 600 && sim.machine.boss() < 0; k++) sim.step();
  const b = sim.machine.boss();
  if (phase > 0 && b >= 0) {
    const def = bossDef(BOSSES.find((x) => x.wave === w.run.wave)?.id ?? 'crown', w.run.wave);
    w.enemies.hp[b] = w.enemies.maxHp[b] * def.phases[phase].hpFraction * 0.999;   // lint-allow causality: test setup
  }
  let seen = 0, t = 0, open = false;
  while (t++ < 90 * 60) {
    sim.step();
    const now = w.bossTell.ability !== null;
    if (now && !open && ++seen === nth) return true;
    open = now;
  }
  return false;
}

function scored(sim: Sim, from: number): string[] {
  const out: string[] = [];
  sim.events.forEachSince(from, (e) => { if (e.type === Ev.CounterScored) out.push(e.src); });
  return out;
}

/** The right action for the open tell (from counterHint). */
function answer(sim: Sim): void {
  const h = counterHint(sim.world)!;
  if (h.ability === 'designate') { for (const t of h.targets) sim.command({ type: 'designate', enemy: t }); return; }
  ready(sim, h.ability as AbilityId);
  sim.command({ type: 'cast', ability: h.ability as AbilityId, x: h.x, y: h.y, target: h.targets[0] });
}

/** A wrong action: an ability that is not the counter, aimed at the tell; for designate tells also a wrong designation. */
function wrong(sim: Sim): void {
  const w = sim.world, h = counterHint(w)!;
  const other = (['bombardment', 'repulsor_pulse', 'time_field', 'singularity_bomb'] as AbilityId[]).find((a) => a !== h.ability)!;
  ready(sim, other);
  sim.command({ type: 'cast', ability: other, x: h.x, y: h.y, target: h.bossIndex });
  if (h.ability === 'designate') {
    const e = w.enemies;
    let bad = -1;
    for (let i = 0; i < e.count && bad < 0; i++) if (w.alive(i) && !h.targets.includes(i)) bad = i;
    if (bad >= 0) sim.command({ type: 'designate', enemy: bad });
  }
}

interface Case { boss: BossId; wave: number; phase: number; nth: number; tell: string }
const CASES: Case[] = [];
for (const b of BOSSES) {
  if (b.id === 'deep_graft') {
    const [a, c] = graftSources(b.wave);
    CASES.push({ boss: b.id, wave: b.wave, phase: 0, nth: 1, tell: tellAttack(bossDef(a, b.wave), 0)! });
    CASES.push({ boss: b.id, wave: b.wave, phase: 0, nth: 2, tell: tellAttack(bossDef(c, b.wave), 0)! });
    continue;
  }
  const seenTells = new Set<string>();
  b.phases.forEach((_, k) => {
    const t = tellAttack(b, k);
    if (t && !seenTells.has(t)) { seenTells.add(t); CASES.push({ boss: b.id, wave: b.wave, phase: k, nth: 1, tell: t }); }
  });
}

describe('boss Tell → Counter table', () => {
  it('has a case for all 21 bosses (Crown per phase, Deep Graft per source)', () => {
    expect(new Set(CASES.map((c) => c.boss)).size).toBe(21);
    expect(CASES.filter((c) => c.boss === 'crown').length).toBe(3);
    expect(CASES.filter((c) => c.boss === 'deep_graft').length).toBe(2);
  });

  it.each(CASES.map((c) => [`${c.boss} p${c.phase} #${c.nth} ${c.tell} → ${TELL_COUNTERS[c.tell]}`, c] as const))('%s', (_label, c) => {
    const counter = TELL_COUNTERS[c.tell];
    // right action scores, with the Counter's src
    const good = bossSim(c.boss, c.wave);
    expect(toTell(good, c.phase, c.nth), 'tell opened').toBe(true);
    expect(good.world.bossTell.ability).toBe(counter);
    const m1 = good.events.nextId;
    answer(good);
    good.step();
    expect(scored(good, m1)).toEqual([counter]);
    // the wrong action in an identical Sim does not
    const bad = bossSim(c.boss, c.wave);
    expect(toTell(bad, c.phase, c.nth)).toBe(true);
    const m2 = bad.events.nextId;
    wrong(bad);
    bad.step();
    expect(scored(bad, m2)).toEqual([]);
    // the right ability, but rejected (not slotted, or on cooldown), does not score either
    if (counter !== 'designate') {
      const rej = bossSim(c.boss, c.wave);
      expect(toTell(rej, c.phase, c.nth)).toBe(true);
      const h = counterHint(rej.world)!;
      ready(rej, 'emergency_repair');                                   // the counter is not slotted
      const m3 = rej.events.nextId;
      rej.command({ type: 'cast', ability: counter as AbilityId, x: h.x, y: h.y, target: h.targets[0] });
      rej.step();
      ready(rej, counter as AbilityId);
      findAbilities(rej.world)!.cd.fill(9999);                          // slotted but on cooldown
      rej.command({ type: 'cast', ability: counter as AbilityId, x: h.x, y: h.y, target: h.targets[0] });
      rej.step();
      expect(scored(rej, m3)).toEqual([]);
    }
  }, 60_000);
});
