/** Job descriptors: the unit of (parallel) work. Pure functions of their input → deterministic. */
import type { OfflineResult, PrestigeChainResult, RunConfig, RunResult } from './types';
import { runAttempt, runOffline, runPrestige } from './runner';
import { runDiffJob, type DiffJob, type DiffJobResult } from './difficulty';

export type Job =
  | { kind: 'attempt'; cfg: RunConfig }
  | { kind: 'chain'; cfg: RunConfig; n: number }
  | { kind: 'diff'; job: DiffJob }
  | { kind: 'offline'; cfg: RunConfig; patrolSeconds: number };

export type AnyResult = RunResult | PrestigeChainResult | DiffJobResult | OfflineResult;

export function runJob(job: Job): AnyResult {
  switch (job.kind) {
    case 'attempt': return runAttempt(job.cfg);
    case 'chain': return runPrestige(job.cfg, job.n);
    case 'diff': return runDiffJob(job.job);
    case 'offline': return runOffline(job.cfg, job.patrolSeconds);
  }
}
