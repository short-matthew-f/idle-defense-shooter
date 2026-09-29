import { describe, it, expect } from 'vitest';
import { generateWave, threatBudget, waveDuration, describeWave, eliteCount, MAX_SPAWNS } from '../../src/sim/enemies/generator';
import { ENEMY_BY_KIND, COUNTER_KINDS } from '../../src/sim/data/enemies';
import { BOSS_BY_ID, bossForWave } from '../../src/sim/data/bosses';
import { FORMATIONS, FORMATION_BY_ID, isFair } from '../../src/sim/data/formations';
import { INTRO_WAVE } from '../../src/sim/data/sectors';
import { TICK_RATE } from '../../src/sim/core/types';
import type { BossId, FormationId } from '../../src/sim/core/ids';

const SEEDS = [1, 42, 0xC17ADE1, 987654321, 31337];

describe('generateWave determinism', () => {
  it('same inputs give identical waves', () => {
    for (const w of [1, 7, 17, 20, 44, 63, 99, 100, 137]) {
      expect(generateWave(42, w, 3, 2)).toEqual(generateWave(42, w, 3, 2));
    }
  });
  it('different seeds give different waves', () => {
    let differ = 0;
    for (const w of [3, 8, 17, 33, 64]) if (JSON.stringify(generateWave(1, w, 0, 0)) !== JSON.stringify(generateWave(2, w, 0, 0))) differ++;
    expect(differ).toBe(5);
  });
  it('has a golden summary so cross-engine drift is caught', () => {
    const d = generateWave(0xC17ADE1, 17, 0, 0);
    expect({ desc: describeWave(d), n: d.spawns.length, first: d.spawns[0], last: d.spawns[d.spawns.length - 1] }).toMatchSnapshot();
  });
});

describe('generator rules', () => {
  it('budget grows monotonically with wave (≈228 at 100)', () => {
    expect(threatBudget(1)).toBeCloseTo(10.2);
    expect(threatBudget(100)).toBeCloseTo(228);
    for (let w = 2; w <= 300; w++) {
      expect(threatBudget(w)).toBeGreaterThan(threatBudget(w - 1));
      expect(generateWave(7, w, 0, 0).threatBudget).toBeGreaterThan(generateWave(7, w - 1, 0, 0).threatBudget);
    }
  });
  it('caps counter enemies at 20% of budget (35% in Ascension) for waves 1–100', () => {
    for (const seed of SEEDS) for (const asc of [0, 1]) for (let w = 1; w <= 100; w++) {
      const d = generateWave(seed, w, 0, asc);
      let counter = 0;
      for (const s of d.spawns) if ((COUNTER_KINDS as string[]).includes(s.kind)) counter += ENEMY_BY_KIND[s.kind].threat;
      expect(counter, `seed ${seed} wave ${w} asc ${asc}`).toBeLessThanOrEqual((asc > 0 ? 0.35 : 0.2) * d.threatBudget + 1e-9);
    }
  });
  it('only rosters introduced enemies', () => {
    for (const seed of SEEDS) for (let w = 1; w <= 100; w++) {
      for (const s of generateWave(seed, w, 0, 0).spawns) if (s.kind !== 'boss') expect(INTRO_WAVE[s.kind], `${s.kind} at ${w}`).toBeLessThanOrEqual(w);
    }
  });
  it('boss waves carry the right boss at tick 0', () => {
    for (let w = 5; w <= 130; w += 5) {
      const d = generateWave(42, w, 0, 0);
      expect(d.isBoss).toBe(true);
      const expected: BossId = w > 100 ? 'deep_graft' : (bossForWave(w) as BossId);
      expect(d.bossId).toBe(expected);
      if (w <= 100) expect(BOSS_BY_ID[d.bossId as BossId].wave).toBe(w);
      expect(d.spawns[0]).toMatchObject({ tick: 0, kind: 'boss' });
      expect(d.spawns.filter((s) => s.kind === 'boss').length).toBe(1);
      expect(d.formation === null || d.formation === 'escort').toBe(true);
    }
    for (const w of [1, 4, 17, 99]) { const d = generateWave(42, w, 0, 0); expect(d.isBoss).toBe(false); expect(d.bossId).toBeNull(); }
  });
  it('pre-boss waves pick among the six flattest eligible templates', () => {
    for (const seed of SEEDS) for (let w = 4; w <= 99; w += 5) for (const asc of [0, 3]) {
      const d = generateWave(seed, w, 0, asc);
      const eligible = FORMATIONS.filter((f) => f.minWave <= w && (!f.spatial || asc >= 3) && isFair(f));
      const flat = eligible.slice().sort((a, b) => (b.flatness - a.flatness) || (a.id < b.id ? -1 : 1)).slice(0, 6).map((f) => f.id);
      expect(flat, `wave ${w}`).toContain(d.formation);
    }
  });
  it('picks only eligible templates; spatial ones only from Ascension III', () => {
    const seen = new Set<FormationId>();
    for (const seed of SEEDS) for (let w = 1; w <= 100; w++) {
      if (w % 5 === 0) continue;
      const d0 = generateWave(seed, w, 0, 0);
      const f0 = FORMATION_BY_ID[d0.formation as FormationId];
      expect(f0.minWave).toBeLessThanOrEqual(w);
      expect(f0.spatial).toBeFalsy();
      const d3 = generateWave(seed, w, 0, 3);
      seen.add(d3.formation as FormationId);
    }
    expect(FORMATIONS.filter((f) => f.spatial).some((f) => seen.has(f.id))).toBe(true);
  });
  it('never exceeds the spawn cap; deep waves merge into clumps', () => {
    for (const w of [1, 50, 100, 101, 199, 777, 3001, 9999]) {
      const d = generateWave(5, w, 10, 0);
      expect(d.spawns.length, `wave ${w}`).toBeLessThanOrEqual(MAX_SPAWNS);
      expect(d.spawns.length).toBeGreaterThan(0);
    }
    const deep = generateWave(5, 9999, 0, 0);
    expect(deep.spawns.some((s) => s.hpScale > 1.5)).toBe(true);
    for (const seed of SEEDS) for (let w = 1; w <= 100; w++) expect(generateWave(seed, w, 0, 0).spawns.length).toBeLessThanOrEqual(MAX_SPAWNS);
  });
  it('spawns are sorted by tick and inside the spawn window', () => {
    for (const seed of SEEDS) for (let w = 1; w <= 100; w++) {
      const d = generateWave(seed, w, 0, 0);
      for (let i = 0; i < d.spawns.length; i++) {
        const s = d.spawns[i];
        if (i > 0) expect(s.tick).toBeGreaterThanOrEqual(d.spawns[i - 1].tick);
        expect(Number.isInteger(s.tick)).toBe(true);
        expect(s.tick).toBeGreaterThanOrEqual(0);
        expect(s.tick).toBeLessThanOrEqual(d.durationTicks);
        expect(s.radiusOffset).toBeLessThanOrEqual(60);
        expect(Number.isFinite(s.angle)).toBe(true);
      }
    }
  });
  it('wave durations: ordinary 18–40 s of spawns (30–60 s with travel)', () => {
    for (let w = 1; w <= 200; w++) {
      const s = waveDuration(w) / TICK_RATE;
      if (w % 5 === 0) expect(s).toBe(12);
      else { expect(s).toBeGreaterThanOrEqual(18); expect(s).toBeLessThanOrEqual(40); }
    }
  });
  it('Threat Dial scales HP, not count', () => {
    for (const w of [9, 33, 71]) {
      const a = generateWave(9, w, 0, 0), b = generateWave(9, w, 5, 0);
      expect(b.spawns.length).toBe(a.spawns.length);
      const plain = b.spawns.find((s) => s.elite.length === 0 && s.kind !== 'boss');
      expect(plain?.hpScale).toBeCloseTo(1.6);
    }
  });
  it('elites appear from wave 8 with 1–2 modifiers; coordinated 3+ from Ascension V', () => {
    for (let w = 1; w < 8; w++) expect(generateWave(3, w, 0, 0).spawns.every((s) => s.elite.length === 0)).toBe(true);
    for (const w of [8, 12, 24, 47, 61, 88, 99]) {
      const d = generateWave(3, w, 0, 0);
      const elites = d.spawns.filter((s) => s.elite.length > 0);
      expect(elites.length).toBe(Math.min(eliteCount(w, 0), d.spawns.length));
      expect(elites.length).toBe(Math.min(1 + Math.floor(w / 12), 6));
      for (const e of elites) { expect(e.elite.length).toBeGreaterThanOrEqual(1); expect(e.elite.length).toBeLessThanOrEqual(2); expect(new Set(e.elite).size).toBe(e.elite.length); }
      const a5 = generateWave(3, w, 0, 5).spawns.filter((s) => s.elite.length > 0);
      for (const e of a5) { expect(e.elite.length).toBeGreaterThanOrEqual(3); expect(e.elite).toEqual(a5[0].elite); }
    }
  });
  it('describeWave reads like the UI line', () => {
    const d = generateWave(42, 17, 0, 0);
    expect(describeWave(d)).toMatch(/^Wave 17 · The Outskirts · [A-Za-z ]+ · \d+ enemies(, \d+ elites?)?$/);
    expect(describeWave(generateWave(42, 20, 0, 0))).toMatch(/^Wave 20 · The Outskirts · The Siege Engine · boss \+ \d+ escorts?/);
  });
});
