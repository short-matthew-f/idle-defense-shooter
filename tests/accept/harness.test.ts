/**
 * WP10 harness tests. They run the --quick acceptance subset in-process and assert that the
 * harness works and produces a report; they do NOT assert that balance targets pass (the numbers
 * are untuned — `npm run sim:accept` is the balance gate).
 */
import { describe, it, expect } from 'vitest';
import { runAttempt } from '../../sim-cli/runner';
import { runAcceptance, type AcceptReport } from '../../sim-cli/acceptance';
import { acceptMarkdown, runMarkdown } from '../../sim-cli/report';
import { tagSystem, checkpointOdds } from '../../sim-cli/metrics';
import { makeAgent, BASE_AGENTS } from '../../sim-cli/agents/index';

describe('WP10 simulator harness', () => {
  it('a short idle climb is deterministic and records waves, checkpoints and damage', () => {
    const cfg = { seed: 3, agent: 'greedy' as const, policy: 'idle' as const, maxSimSeconds: 600 };
    const a = runAttempt(cfg), b = runAttempt(cfg);
    expect(a.ticks).toBe(36000);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.deepestCleared).toBeGreaterThanOrEqual(3);
    expect(a.waves.length).toBeGreaterThan(2);
    expect(a.build.purchases).toBeGreaterThan(5);
    expect(Object.keys(a.damageBySrc)).toContain('ballistics');
    expect(runMarkdown(a)).toContain('## Checkpoints');
  }, 60_000);

  it('every agent id resolves', () => {
    for (const id of [...BASE_AGENTS, 'optimizer_lite', 'doctrine:ballistics.piercing', 'doctrine:fire.inferno', 'doctrine:blade.tempest']) expect(makeAgent(id)).toBeTruthy();
  });

  it('srcTag → system mapping', () => {
    expect(tagSystem('burn')).toBe('fire');
    expect(tagSystem('fire.fireball')).toBe('fire');
    expect(tagSystem('infuse.laser.fire')).toBe('laser');
    expect(tagSystem('link.primary+blade')).toBe('blade');
    expect(tagSystem('link.blade+laser')).toBe('blade');
    expect(tagSystem('fusion.plasma')).toBe('fusion');
    expect(checkpointOdds([]).n).toBe(0);
  });

  let report: AcceptReport | null = null;
  it('the --quick acceptance subset runs and produces a full report', async () => {
    report = await runAcceptance({ mode: 'quick', parallel: 1 });
    const names = report.rows.map((r) => r.name);
    expect(names).toEqual(['Checkpoint odds', 'Checkpoint time', 'First wall', 'Reclimb', 'Push', 'Forecast', 'Build health', 'Doctrine health',
      'Spend efficiency', 'Defense', 'Active edge', 'Directive gap', 'Lazy caster (reference)', 'Formation fairness', 'Anomaly cap', 'Boon cap', 'Offline', 'Determinism']);
    for (const r of report.rows) { expect(typeof r.pass).toBe('boolean'); expect(r.value.length).toBeGreaterThan(0); expect(r.target.length).toBeGreaterThan(0); }
    expect(acceptMarkdown(report.rows)).toContain('| Test | Result |');
    expect(report.data.difficulty?.cells.length ?? 0).toBeGreaterThan(10);
    for (const n of ['First wall', 'Forecast', 'Active edge', 'Directive gap', 'Lazy caster (reference)']) expect(report.rows.find((r) => r.name === n)!.skipped).toContain('needs full run');
    // the determinism row is a harness property, not a balance number
    expect(report.rows.find((r) => r.name === 'Determinism')!.pass).toBe(true);
  }, 900_000);
});

// UX Phase 2 item 5: the Prestige-chain report printed the bank after spending ("echoes +3" at wave 28 where the game pays 43)
describe('harness Prestige Echo report', () => {
  it('prestigeOnce reports what the game pays, before any Echoes are spent', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { Sim } = await import('../../src/sim/index');
    const { importString } = await import('../../src/sim/save/serialize');
    const { prestigeEchoes } = await import('../../src/sim/economy/prestige');
    const { prestigeOnce, spendEchoes } = await import('../../sim-cli/runner');
    const sim = new Sim(importString(readFileSync(join(__dirname, '../fixtures/owner-save-w28.txt'), 'utf8').trim()), 1);
    const due = prestigeEchoes(sim.world);
    expect(due).toBe(43);
    const p = prestigeOnce(sim, 'standard');
    expect(p.ok).toBe(true);
    expect(p.paid).toBe(due);
    expect(spendEchoes(sim).length).toBeGreaterThan(0);   // spending afterwards no longer changes the reported number
    expect(p.paid).toBe(43);
  });
});
