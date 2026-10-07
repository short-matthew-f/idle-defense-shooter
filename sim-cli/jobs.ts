/** Job descriptors: the unit of (parallel) work. Pure functions of their input → deterministic. */
import type { OfflineResult, PrestigeChainResult, RunConfig, RunResult } from './types';
import { runAttempt, runAutomationAttempt, runOffline, runPrestige } from './runner';
import { archetypeClimb, runDiffJob, type ArchetypeSnapshots, type DiffJob, type DiffJobResult } from './difficulty';
import type { Archetype } from '../src/sim/data/formations';

export type Job =
  | { kind: 'attempt'; cfg: RunConfig }
  /** A climb from the start of Prestige 2 with Autocast + Directives owned (runner.ts automationStart; Directive gap). */
  | { kind: 'automation'; cfg: RunConfig }
  | { kind: 'chain'; cfg: RunConfig; n: number }
  | { kind: 'diff'; job: DiffJob }
  | { kind: 'offline'; cfg: RunConfig; patrolSeconds: number }
  | { kind: 'diffclimb'; archetype: Archetype; bands: number[] };

export type AnyResult = RunResult | PrestigeChainResult | DiffJobResult | OfflineResult | ArchetypeSnapshots;

export function runJob(job: Job): AnyResult {
  switch (job.kind) {
    case 'attempt': return runAttempt(job.cfg);
    case 'automation': return runAutomationAttempt(job.cfg);
    case 'chain': return runPrestige(job.cfg, job.n);
    case 'diff': return runDiffJob(job.job);
    case 'offline': return runOffline(job.cfg, job.patrolSeconds);
    case 'diffclimb': return archetypeClimb(job.archetype, job.bands);
  }
}
