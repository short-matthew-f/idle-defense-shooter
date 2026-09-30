/**
 * Headless simulator CLI (WP10).
 *
 *   npm run sim -- --agent greedy --policy idle --seed 1 --hours 2 --frame standard --report
 *   npm run sim -- --agents all --policy idle --seeds 1,2 --hours 4 --report --jobs 4
 *   npm run sim -- --agent generalist --chain 3 --report          (Prestige chain)
 *   npm run sim -- --difficulty [--quick]                           (Difficulty Multiplier grid)
 *   npm run sim -- --profile                                        (ticks/second, incl. a ~900-enemy dense case)
 *   npm run sim -- --boon-cap [--quick] [--seeds 1,2]               (only the Boon cap acceptance row)
 *
 * Options: --stop-wave W, --dial T, --wall-minutes M, --force-anomaly ID, --doctrine tree.doctrine,
 *          --force-boon ID (inject that boon into every offer; once active, take the first card, or with
 *          --boon-companions none decline), --no-boons (decline every offer),
 *          --stop-at-recommendation, --out DIR, --jobs N (parallel processes; default = cores).
 * Agents: greedy survival elemental generalist random hp_ordnance hp_drones hp_blade hp_laser
 *         hp_gravitics optimizer optimizer_lite doctrine:<tree>.<doctrine>
 */
import { parseArgs, list, num } from './args';
import type { AgentId, PolicyId, RunConfig, RunResult, PrestigeChainResult } from './types';
import type { FrameId, AnomalyId, TreeId, DoctrineId, BoonId } from '../src/sim/core/ids';
import { BASE_AGENTS } from './agents/index';
import { runJobs } from './pool';
import type { Job } from './jobs';
import { OUT_DIR, runMarkdown, summaryMarkdown, writeJson, writeRun, writeText } from './report';
import { aggregateDifficulty, difficultyJobs, difficultyMarkdown, FULL_DIFF, QUICK_DIFF, type ArchetypeSnapshots, type DiffJobResult } from './difficulty';
import { runAttempt } from './runner';
import { plan, testBoonCap } from './acceptance';
import { Sim } from '../src/sim/index';
import { round } from './metrics';
import { allNodes, boonDef } from '../src/sim/core/content';
import { TAU, cos, sin } from '../src/sim/math/lut';
import { ARENA_RADIUS } from '../src/sim/core/types';

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const out = typeof a.out === 'string' ? a.out : OUT_DIR;
  const jobsN = a.jobs ? num(a.jobs, 1) : undefined;
  if (a.help) { console.log((await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); return; }

  if (a.profile) return profile();

  if (a['boon-cap']) {
    const mode = a.quick ? 'quick' : 'full';
    const seeds = list(a.seeds).length ? list(a.seeds).map(Number) : [1, 2];
    const p = plan(mode, seeds, 4).filter((x) => x.key.startsWith('boon-'));
    if (a['boon-companions'] === 'first') for (const x of p) if (x.job.kind === 'attempt' && x.job.cfg.forceBoon) x.job.cfg.boonCompanions = 'first';   // the literal rule, for comparison
    const t0 = performance.now();
    const res = await runJobs<RunResult>(p.map((x) => x.job), jobsN, (_i, r, done) => { if (done % 10 === 0 || done === p.length) console.error(`  ${done}/${p.length} (${round((performance.now() - t0) / 1000, 0)} s) ${r.name}: ${r.deepestCleared}`); });
    const runs: Record<string, RunResult> = {};
    p.forEach((x, i) => { runs[x.key] = res[i]; });
    const row = testBoonCap({ mode, seeds, hours: 0, runs, chain: null, offline: null, difficulty: null, determinism: null, wallSeconds: 0 });
    writeJson(`boon-cap${a.quick ? '-quick' : ''}`, { row, depths: Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.deepestCleared])) }, out);
    console.log(`${row.name}: ${row.pass ? 'PASS' : 'FAIL'} · ${row.value}\n${row.notes}`);
    return;
  }

  if (a.difficulty) {
    const opts = a.quick ? QUICK_DIFF : FULL_DIFF;
    const t0 = performance.now();
    const snaps = await runJobs<ArchetypeSnapshots>(opts.archetypes.map((archetype) => ({ kind: 'diffclimb', archetype, bands: opts.bands })), jobsN,
      (_i, r, done) => console.error(`  climb ${done}/${opts.archetypes.length}: ${r.archetype} reached ${r.reached} (${round(r.wallSeconds, 0)} s)`));
    const js = difficultyJobs(opts, snaps);
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
    ...(typeof a['force-boon'] === 'string' ? { forceBoon: a['force-boon'] as BoonId } : {}),
    ...(a['no-boons'] ? { noBoons: true } : {}),
    ...(a['boon-companions'] === 'none' || a['boon-companions'] === 'first' ? { boonCompanions: a['boon-companions'] } : {}),
  };
  if (base.forceBoon && !boonDef(base.forceBoon)) throw new Error(`Unknown boon '${base.forceBoon}'`);
  if (typeof a.doctrine === 'string') { const [t, d] = a.doctrine.split('.'); base.doctrineOverrides = { [t as TreeId]: d as DoctrineId }; }
  const chainN = a.chain ? num(a.chain, 2) : 0;
  const jobs: Job[] = [];
  for (const agent of agents) for (const policy of policies) for (const seed of seeds) {
    const cfg: RunConfig = { ...base, seed, agent: agent as AgentId, policy, name: `${agent.replace(':', '-')}-${policy}-s${seed}${chainN ? '-chain' : ''}` };
    jobs.push(chainN ? { kind: 'chain', cfg, n: chainN } : { kind: 'attempt', cfg });
  }
  const t0 = performance.now();
  const res = await runJobs(jobs, jobsN, (_i, r, done) => {
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
  rows.push(`wave 60, primary only, unkillable tower: ${Math.round(ticks / ((performance.now() - t0) / 1000))} ticks/s, up to ${maxE} enemies`);
  rows.push(denseProfile());
  console.log(rows.join('\n'));
}

/**
 * Near the enemy budget: four hardpoints + three elements (every tree/linkage/infusion/fusion node at
 * rank 3), wave 60, and the field topped up to ~900 mixed enemies (×30 HP) every half second.
 * This is the load the Web Worker must sustain at ×8 speed (480 ticks/s).
 */
function denseProfile(ticks = 60 * 90): string {
  const s = new Sim(null, 5);
  const w = s.world, b = w.build;
  b.hardpoints = ['ordnance', 'drones', 'laser', 'gravitics'];
  b.attunements = ['fire', 'lightning', 'poison'];
  w.run.hardpointSlotsOpen = 4; w.run.attunementSlotsOpen = 3;
  for (const info of allNodes()) {
    if (info.group !== 'tree' && info.group !== 'link' && info.group !== 'infuse' && info.group !== 'fusion') continue;
    if (info.doctrine || info.exotic) continue;
    b.ranks[info.def.id] = Math.min(info.def.maxRank, 3);
  }
  w.stats.override('bastion.max_hp', 1e12);
  w.rebuildStats(); w.tower.hp = w.tower.maxHp;
  w.run.checkpoint = 59; s.machine.startAttempt(false);
  const kinds = ['grunt', 'swarm', 'runner', 'brute', 'shielded', 'healer', 'warden', 'splitter', 'phase', 'jammer'] as const;
  let maxE = 0;
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    if (t % 30 === 0 && w.run.phase === 'combat' && w.enemies.count < 900) {
      for (let k = 0; k < 60; k++) { const a = w.prng.next() * TAU; w.spawnEnemy(kinds[k % kinds.length], cos(a) * ARENA_RADIUS, sin(a) * ARENA_RADIUS, { hpScale: 30, cause: -1 }); }
    }
    s.step();
    if (w.enemies.count > maxE) maxE = w.enemies.count;
  }
  const ms = performance.now() - t0;
  return `dense (4 hardpoints + 3 elements, wave 60, ~900 enemies): ${Math.round(ticks / (ms / 1000))} ticks/s (${(ms / ticks).toFixed(2)} ms/tick), up to ${maxE} enemies, ${w.events.nextId} events`;
}

main().catch((e) => { console.error(e); process.exit(2); });
