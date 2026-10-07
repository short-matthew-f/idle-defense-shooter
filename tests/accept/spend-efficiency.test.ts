/**
 * Balance round 2 (2026-10-07): measurement fixes behind the Spend efficiency and Formation fairness rows.
 */
import { describe, it, expect } from 'vitest';
import { damageBySpendTree, damageBySystem, spendVsEffect } from '../../sim-cli/metrics';
import { plan, testSpendEfficiency, type AcceptData } from '../../sim-cli/acceptance';
import { FULL_DIFF } from '../../sim-cli/difficulty';
import type { RunResult } from '../../sim-cli/types';

const run = (agent: string, damageBySrc: Record<string, number>, spendByTree: Record<string, number>, spendContribution?: Record<string, number>): RunResult =>
  ({ agent, damageBySrc, spendByTree, ...(spendContribution ? { spendContribution } : {}) }) as unknown as RunResult;

const data = (runs: Record<string, RunResult>): AcceptData =>
  ({ mode: 'full', seeds: [1], hours: 4, runs, chain: null, chains: [], offline: null, difficulty: null, determinism: null, wallSeconds: 0 });

describe('Spend efficiency attribution', () => {
  it('Fusion damage is credited to its elements for the spend comparison, not to the one-rank fusion key', () => {
    const r = run('elemental', { poison: 2, 'fusion.toxic_combustion': 12, burn: 26, 'triad.catalyst': 3, ballistics: 57 }, { poison: 30, fire: 30, ballistics: 40 });
    const d = damageBySpendTree(r);
    expect(d.poison).toBeCloseTo((2 + 6 + 1) / 100, 6);
    expect(d.fire).toBeCloseTo((26 + 6 + 1) / 100, 6);
    expect(d.lightning).toBeCloseTo(1 / 100, 6);
    expect(d.fusion).toBeUndefined();
    expect(damageBySystem(r).fusion).toBeCloseTo(0.15, 6);   // the per-system report is unchanged
    expect(spendVsEffect(r).find((x) => x.system === 'poison')!.damageShare).toBeCloseTo(0.09, 6);
  });

  it('a share offender stays one only when the counterfactual confirms it', () => {
    const spend = { ballistics: 30, ordnance: 25, fire: 45 };
    const dmg = { ballistics: 5, ordnance: 5, burn: 90 };
    // no counterfactual (quick mode): both flagged by share
    expect(testSpendEfficiency(data({ 'a-idle-s1': run('a', dmg, spend) })).value).toBe('2 offenders in 1 runs');
    // ballistics' ranks carry 40% of the build, ordnance 5%: only ordnance stays an offender
    const row = testSpendEfficiency(data({ 'a-idle-s1': run('a', dmg, spend, { ballistics: 0.4, ordnance: 0.05, fire: 0.55 }) }));
    expect(row.pass).toBe(false);
    expect(row.value).toBe('1 offenders in 1 runs');
    expect(row.notes).toContain('a: ordnance');
    expect(row.notes).toContain('cleared by the counterfactual: a: ballistics');
  });

  it('full mode asks the judged runs (only those) for the counterfactual', () => {
    const p = plan('full', [1, 2, 3], 4);
    const probed = p.filter((x) => x.job.kind === 'attempt' && x.job.cfg.spendProbe).map((x) => x.key).sort();
    expect(probed).toContain('elemental-idle-s1');
    expect(probed).toContain('optimizer-idle-s1');
    expect(probed.every((k) => k.endsWith('-idle-s1') && !k.startsWith('anomaly-') && !k.startsWith('doctrine-'))).toBe(true);
    expect(plan('quick', [1], 0.5).some((x) => x.job.kind === 'attempt' && x.job.cfg.spendProbe)).toBe(false);
  });
});

describe('Formation fairness sample size', () => {
  it('the full grid measures each cell on 10 waves (2 let single-wave noise cross the 1.5× line)', () => {
    expect(FULL_DIFF.seedsPerCell).toBeGreaterThanOrEqual(10);
  });
});
