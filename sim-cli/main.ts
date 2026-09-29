/**
 * Headless simulator CLI (WP10).
 *
 *   npm run sim -- --agent greedy --policy idle --seed 1 --hours 2 --frame standard --report
 *   npm run sim -- --agents all --policy idle --seeds 1,2 --hours 4 --report --jobs 4
 *   npm run sim -- --agent generalist --chain 3 --report          (Prestige chain)
 *   npm run sim -- --difficulty [--quick]                           (Difficulty Multiplier grid)
 *   npm run sim -- --profile                                        (ticks/second)
 *
 * Options: --stop-wave W, --dial T, --wall-minutes M, --force-anomaly ID, --doctrine tree.doctrine,
 *          --stop-at-recommendation, --out DIR, --jobs N (parallel processes; default = cores).
 * Agents: greedy survival elemental generalist random hp_ordnance hp_drones hp_blade hp_laser
 *         hp_gravitics optimizer optimizer_lite doctrine:<tree>.<doctrine>
 */
import { parseArgs, list, num } from './args';
import type { AgentId, PolicyId, RunConfig, RunResult, PrestigeChainResult } from './types';
import type { FrameId, AnomalyId, TreeId, DoctrineId } from '../src/sim/core/ids';
import { BASE_AGENTS } from './agents/index';
import { runJobs } from './pool';
import type { Job } from './jobs';
import { OUT_DIR, runMarkdown, summaryMarkdown, writeJson, writeRun, writeText } from './report';
import { aggregateDifficulty, difficultyJobs, difficultyMarkdown, FULL_DIFF, QUICK_DIFF, type DiffJobResult } from './difficulty';
import { runAttempt } from './runner';
import { Sim } from '../src/sim/index';
import { round } from './metrics';

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const out = typeof a.out === 'string' ? a.out : OUT_DIR;
  const jobsN = a.jobs ? num(a.jobs, 1) : undefined;
  if (a.help) { console.log((await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); return; }

  if (a.profile) return profile();

  if (a.difficulty) {
    const opts = a.quick ? QUICK_DIFF : FULL_DIFF;
    const js = difficultyJobs(opts);
    const t0 = performance.now();
    const res = await runJobs<DiffJobResult>(js.map((job) => ({ kind: 'diff', job })), jobsN, (_i, _r, done) => { if (done % 10 === 0) console.error(`  ${done}/${js.length}`); });
    const d = aggregateDifficulty(opts, js.map((job, i) => ({ job, res: res[i] })), (performance.now() - t0) / 1000);
    const suffix = a.quick ? '-quick' : '';
    writeJson(`difficulty${suffix}`, d, out);
    const md = difficultyMarkdown(d);
    writeText(`difficulty${suffix}.md`, md, out);
    console.log(md);
    return;
  }

  const agents: string[] = a.agents === 'all' || a.agents === true ? [...BASE_AGENTS] : list(a.agents).length ? list(a.agents) : [typeof a.agent === 'string' ? a.agent : 'greedy'];
  const policies = (list(a.policies).length ? list(a.policies) : [typeof a.policy === 'string' ? a.policy : 'idle']) as PolicyId[];
  const seeds = list(a.seeds).length ? list(a.seeds).map(Number) : [num(a.seed, 1)];
  const base: Omit<RunConfig, 'seed' | 'agent' | 'policy'> = {
    maxSimSeconds: num(a.hours, 2) * 3600,
    ...(typeof a.frame === 'string' ? { frame: a.frame as FrameId } : {}),
    ...(a['stop-wave'] ? { stopAtWave: num(a['stop-wave'], 100) } : {}),
    ...(a.dial ? { threatDial: num(a.dial, 0) } : {}),
    ...(a['wall-minutes'] ? { wallMinutes: num(a['wall-minutes'], 40) } : {}),
    ...(typeof a['force-anomaly'] === 'string' ? { forceAnomaly: a['force-anomaly'] as AnomalyId } : {}),
    ...(a['stop-at-recommendation'] ? { stopAtRecommendation: true } : {}),
  };
  if (typeof a.doctrine === 'string') { const [t, d] = a.doctrine.split('.'); base.doctrineOverrides = { [t as TreeId]: d as DoctrineId }; }
  const chainN = a.chain ? num(a.chain, 2) : 0;
  const jobs: Job[] = [];
  for (const agent of agents) for (const policy of policies) for (const seed of seeds) {
    const cfg: RunConfig = { ...base, seed, agent: agent as AgentId, policy, name: `${agent.replace(':', '-')}-${policy}-s${seed}${chainN ? '-chain' : ''}` };
    jobs.push(chainN ? { kind: 'chain', cfg, n: chainN } : { kind: 'attempt', cfg });
  }
  const t0 = performance.now();
  const res = await runJobs(jobs, jobsN, (i, r, done) => {
    const x = r as RunResult | PrestigeChainResult;
    const first = 'runs' in x ? x.runs[x.runs.length - 1] : x;
    console.error(`  [${done}/${jobs.length}] ${'runs' in x ? x.name : first.name}: deepest ${first?.deepestCleared}, attempts ${first?.attempts}, ${first?.stopReason}, ${Math.round(first?.ticksPerSecond ?? 0)} ticks/s`);
  });
  const flat: RunResult[] = [];
  for (const r of res as (RunResult | PrestigeChainResult)[]) {
    if ('runs' in r) { flat.push(...r.runs); if (a.report) writeJson(r.name, r, out); console.log(`${r.name}: implemented=${r.implemented}; ${r.notes.join('; ')}`); }
    else flat.push(r);
  }
  if (a.report) for (const r of flat) writeRun(r, out);
  const summary = summaryMarkdown(`Runs (${round((performance.now() - t0) / 1000, 1)} s wall)`, flat);
  if (a.report) writeText(`summary-${Date.now().toString(36)}.md`, summary, out);
  if (flat.length === 1 && !a.report) console.log(runMarkdown(flat[0]));
  else console.log(summary);
}

/** --profile: headless ticks/second for a few representative loads. */
function profile(): void {
  const rows: string[] = [];
  const bare = new Sim(null, 3);
  let t0 = performance.now();
  bare.run(60 * 600);
  rows.push(`bare Sim, no purchases, 10 sim-min: ${Math.round(36000 / ((performance.now() - t0) / 1000))} ticks/s (dies early: mostly between/dead phases)`);
  for (const [agent, hours] of [['greedy', 1], ['generalist', 2], ['optimizer_lite', 0.5], ['optimizer', 0.25]] as const) {
    t0 = performance.now();
    const r = runAttempt({ seed: 1, agent, policy: 'idle', maxSimSeconds: hours * 3600, hashes: false });
    rows.push(`${agent} idle ${hours} sim-h: ${Math.round(r.ticksPerSecond)} ticks/s (deepest ${r.deepestCleared}, ${round(r.wallSeconds, 1)} s wall)`);
  }
  // dense combat: one deep wave with an unkillable tower
  const s = new Sim(null, 5);
  const w = s.world;
  w.stats.override('bastion.max_hp', 1e12); w.rebuildStats(); w.tower.hp = w.tower.maxHp;
  w.run.checkpoint = 59; s.machine.startAttempt(false);
  let ticks = 0, maxE = 0;
  t0 = performance.now();
  while (ticks < 60 * 90) { s.step(); ticks++; if (w.enemies.count > maxE) maxE = w.enemies.count; }
  rows.push(`dense combat (wave 60 swarm, primary only, unkillable tower): ${Math.round(ticks / ((performance.now() - t0) / 1000))} ticks/s, up to ${maxE} enemies`);
  console.log(rows.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(2); });
