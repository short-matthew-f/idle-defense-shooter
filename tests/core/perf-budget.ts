/**
 * Wall-clock budgets for the performance smoke tests. They catch order-of-magnitude regressions, not
 * small ones: shared CI runners and coverage instrumentation run the sim several times slower, which
 * made the old fixed budgets flaky. Rules:
 *  - `CI` set, or `PERF_BUDGETS=off`: the timing assertion is skipped (the scenario still has to run
 *    without throwing, which is most of the smoke value).
 *  - otherwise the budget is multiplied by `PERF_BUDGET_SCALE` (default 2).
 */
import { expect } from 'vitest';

export const PERF_ENFORCED = !process.env.CI && process.env.PERF_BUDGETS !== 'off';
export const PERF_SCALE = Number(process.env.PERF_BUDGET_SCALE ?? 2) || 2;

export function expectWithinBudget(ms: number, budgetMs: number): void {
  if (!PERF_ENFORCED) return;
  expect(ms, `took ${Math.round(ms)} ms; budget ${budgetMs} ms × ${PERF_SCALE}`).toBeLessThan(budgetMs * PERF_SCALE);
}
