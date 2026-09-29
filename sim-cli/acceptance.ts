/**
 * Acceptance tests (design §19). Every row of the §19 table is a function returning
 * { name, pass, value, target, notes } (plus `skipped` when the feature it needs is not in the sim
 * yet). `runAcceptance` gathers all runs (in parallel through sim-cli/pool.ts), evaluates every
 * row and returns the table plus the raw runs.
 *
 * Modes
 *  - full  (npm run sim:accept): 3 seeds × {Generalist idle/active/directive, Greedy, Survival}
 *          at 4 sim-hours per climb (stop at wave 100 or the 40-min wall); Elemental, Random, the
 *          five hardpoint agents (4 h) and the beam Optimizer (2 h) on seed 1; every Doctrine probe
 *          (1 h); the Optimizer-lite with every base-pool Anomaly forced (40 min, 3 seeds); a 3-Prestige
 *          chain; Offline; Determinism; the full Difficulty grid (10 bands × 10 archetypes × 2
 *          seeds). ~180 jobs, ~20 min on 4 cores. The balance gate.
 *  - quick (npm run sim:accept -- --quick, and tests/accept): 1 seed, 0.5 h climbs, two hardpoint
 *          agents, two Ballistics Doctrines, two Anomalies, 2-Prestige chain (1 h runs), 2 bands ×
 *          3 archetypes of difficulty. ~90 s on 4 cores, ~3 min in-process.
 *
 * Interpretations (the table's wording leaves room; these are the definitions the numbers use)
 *  - Checkpoint odds: "attempt k" = attempts that played the segment between two checkpoints (the
 *    attempt that cleared the previous boss counts as #1). Reported cumulatively: P(new boss by
 *    attempt 1/2/3), over every checkpoint of the idle Generalist's first Prestige.
 *  - First wall: the Forecast's first `recommended` wave; when UiState.forecast is absent, the
 *    computed §3 rule (Echo rate ≥ 15% below its peak for one full checkpoint cycle).
 *  - Forecast: |recommended wave − true Echo-rate-peak wave| / peak wave ≤ 10%. Skipped while the
 *    Forecast is absent (the computed rule would only test itself); the computed value is shown.
 *  - Build health: at the play-time the best agent first clears each Sector finale F, every
 *    hardpoint agent's deepest cleared wave ≥ 85% of F. With no finale cleared, final depths.
 *  - Active edge: attempts summed over the checkpoints both policies reached; idle "clears every
 *    boss" = in the same sim time, idle's checkpoint is at most one boss behind active's.
 *  - Directive gap: (A_idle − A_directive) / (A_idle − A_active) over common checkpoints.
 *  - Anomaly cap: mean depth (over the seeds) of the Optimizer with each base-pool Anomaly forced
 *    at the first draft (and never replaced) vs the same Optimizer skipping that draft (later
 *    drafts natural in both), same seeds and time. Uses `optimizer_lite` (lookahead 1) — the beam
 *    Optimizer is ~9× slower; see the report.
 *  - Spend efficiency: judged on damage trees only (Bastion, Reactor, ability ranks buy survival /
 *    utility, not damage share); over every idle agent run.
 */
import type { AnomalyId, DoctrineId, TreeId } from '../src/sim/core/ids';
import { allTrees } from '../src/sim/core/content';
import { ANOMALIES } from '../src/sim/data/index';
import type { AcceptRow, OfflineResult, PrestigeChainResult, RunConfig, RunResult } from './types';
import type { Job } from './jobs';
import { runJobs } from './pool';
import { aggregateDifficulty, difficultyJobs, FULL_DIFF, QUICK_DIFF, type ArchetypeSnapshots, type DiffJobResult, type DifficultyResult } from './difficulty';
import { attemptsUpTo, checkpointMinutes, checkpointOdds, depthAt, gameRecommendation, mean, median, NON_DAMAGE_TREES, pct, round, spendVsEffect, timeToWave } from './metrics';
import { HARDPOINT_AGENTS } from './agents/index';

export type Mode = 'quick' | 'full';

export interface AcceptOptions {
  mode: Mode;
  seeds?: number[];
  hours?: number;
  parallel?: number;
  log?: (s: string) => void;
}

export interface AcceptData {
  mode: Mode;
  seeds: number[];
  hours: number;
  runs: Record<string, RunResult>;
  chain: PrestigeChainResult | null;
  offline: OfflineResult | null;
  difficulty: DifficultyResult | null;
  determinism: [RunResult, RunResult] | null;
  wallSeconds: number;
}

export interface AcceptReport { rows: AcceptRow[]; data: AcceptData }

interface Plan { key: string; job: Job }

const FINALES = [20, 40, 60, 80, 100];

function inRange(x: number, lo: number, hi: number): boolean { return Number.isFinite(x) && x >= lo && x <= hi; }

export function plan(mode: Mode, seeds: number[], hours: number): Plan[] {
  const quick = mode === 'quick';
  const H = hours * 3600;
  const out: Plan[] = [];
  const att = (key: string, cfg: Omit<RunConfig, 'name'>): void => { out.push({ key, job: { kind: 'attempt', cfg: { stopAtWave: 100, ...cfg, name: key } } }); };
  for (const seed of seeds) {
    att(`generalist-idle-s${seed}`, { seed, agent: 'generalist', policy: 'idle', maxSimSeconds: H });
    att(`generalist-active-s${seed}`, { seed, agent: 'generalist', policy: 'active', maxSimSeconds: H });
    att(`generalist-directive-s${seed}`, { seed, agent: 'generalist', policy: 'directive', maxSimSeconds: H });
    att(`greedy-idle-s${seed}`, { seed, agent: 'greedy', policy: 'idle', maxSimSeconds: H });
    att(`survival-idle-s${seed}`, { seed, agent: 'survival', policy: 'idle', maxSimSeconds: H });
  }
  const s0 = seeds[0];
  for (const a of ['elemental', 'random'] as const) att(`${a}-idle-s${s0}`, { seed: s0, agent: a, policy: 'idle', maxSimSeconds: H });
  for (const a of quick ? ['hp_ordnance', 'hp_blade'] : HARDPOINT_AGENTS) att(`${a}-idle-s${s0}`, { seed: s0, agent: a as RunConfig['agent'], policy: 'idle', maxSimSeconds: H });
  att(`optimizer-idle-s${s0}`, { seed: s0, agent: quick ? 'optimizer_lite' : 'optimizer', policy: 'idle', maxSimSeconds: quick ? Math.min(H, 1200) : Math.min(H, 2 * 3600) });
  // Doctrine health probes
  const docH = quick ? Math.min(H, 1200) : Math.min(H, 3600);
  for (const t of allTrees()) {
    if (quick && t.id !== 'ballistics') continue;
    for (const d of t.doctrines) {
      if (quick && !['multishot', 'piercing'].includes(d.id)) continue;
      att(`doctrine-${t.id}.${d.id}-s${s0}`, { seed: s0, agent: `doctrine:${t.id}.${d.id}`, policy: 'idle', maxSimSeconds: docH });
    }
  }
  // Anomaly cap: every base-pool Anomaly forced at the first draft vs skipping it, on each seed
  const anH = quick ? Math.min(H, 1800) : Math.min(H, 2400);
  const pool = ANOMALIES.filter((a) => a.pool === 'base').map((a) => a.id);
  const forced = quick ? pool.filter((a) => ['loaded_dice', 'glass_cannon'].includes(a)) : pool;
  for (const seed of quick ? [s0] : seeds) {
    att(`anomaly-none-s${seed}`, { seed, agent: 'optimizer_lite', policy: 'idle', maxSimSeconds: anH, forceAnomaly: 'skip', hashes: false });
    for (const a of forced) att(`anomaly-${a}-s${seed}`, { seed, agent: 'optimizer_lite', policy: 'idle', maxSimSeconds: anH, forceAnomaly: a, hashes: false });
  }
  // Prestige chain, offline, determinism
  out.push({ key: 'chain', job: { kind: 'chain', cfg: { name: `chain-generalist-s${s0}`, seed: s0, agent: 'generalist', policy: 'idle', maxSimSeconds: quick ? 3600 : H }, n: quick ? 2 : 3 } });
  out.push({ key: 'offline', job: { kind: 'offline', cfg: { name: 'offline', seed: s0, agent: 'generalist', policy: 'idle', maxSimSeconds: 3600, stopAtWave: 19 }, patrolSeconds: quick ? 600 : 1800 } });
  for (const k of ['a', 'b']) att(`determinism-${k}`, { seed: 7, agent: 'greedy', policy: 'active', maxSimSeconds: quick ? 600 : 1800 });
  // Difficulty phase 1: archetype climbs (phase 2 — one job per archetype × band — runs after)
  const dopts = quick ? QUICK_DIFF : FULL_DIFF;
  for (const a of dopts.archetypes) out.push({ key: `diffclimb-${a}`, job: { kind: 'diffclimb', archetype: a, bands: dopts.bands } });
  return out;
}

export async function gather(opts: AcceptOptions): Promise<AcceptData> {
  const mode = opts.mode;
  const seeds = opts.seeds ?? (mode === 'quick' ? [1] : [1, 2, 3]);
  const hours = opts.hours ?? (mode === 'quick' ? 0.5 : 4);
  const log = opts.log ?? (() => {});
  const p = plan(mode, seeds, hours);
  // Longest jobs first so the pool drains evenly.
  const weight = (x: Plan): number => (x.job.kind === 'chain' ? 4 : x.job.kind === 'diffclimb' ? 3 : x.key.startsWith('optimizer') ? 5 : x.key.startsWith('anomaly') ? 2 : 1);
  const order = p.map((_, i) => i).sort((a, b) => weight(p[b]) - weight(p[a]) || a - b);
  const t0 = performance.now();
  log(`acceptance ${mode}: ${p.length} jobs, seeds ${seeds.join(',')}, ${hours} sim-h per climb, ${opts.parallel ?? 'auto'} parallel`);
  const res = await runJobs(order.map((i) => p[i].job), opts.parallel, (i, _r, done) => {
    if (done % 5 === 0 || done === p.length) log(`  ${done}/${p.length} jobs (${round((performance.now() - t0) / 1000, 0)} s) last: ${p[order[i]].key}`);
  });
  const byKey: Record<string, unknown> = {};
  order.forEach((pi, k) => { byKey[p[pi].key] = res[k]; });
  const runs: Record<string, RunResult> = {};
  const snaps: ArchetypeSnapshots[] = [];
  for (const x of p) {
    if (x.job.kind === 'attempt') runs[x.key] = byKey[x.key] as RunResult;
    else if (x.job.kind === 'diffclimb') snaps.push(byKey[x.key] as ArchetypeSnapshots);
  }
  // Difficulty phase 2
  const dopts = mode === 'quick' ? QUICK_DIFF : FULL_DIFF;
  const dj = difficultyJobs(dopts, snaps);
  log(`  difficulty: ${dj.length} archetype×band jobs (archetype depths ${snaps.map((s) => `${s.archetype} ${s.reached}`).join(', ')})`);
  const dres = await runJobs<DiffJobResult>(dj.map((job) => ({ kind: 'diff', job })), opts.parallel, (_i, _r, done) => { if (done % 20 === 0 || done === dj.length) log(`  difficulty ${done}/${dj.length} (${round((performance.now() - t0) / 1000, 0)} s)`); });
  const diffJobs = dj.map((job, i) => ({ job, res: dres[i] }));
  const wall = (performance.now() - t0) / 1000;
  return {
    mode, seeds, hours, runs,
    chain: (byKey.chain as PrestigeChainResult) ?? null,
    offline: (byKey.offline as OfflineResult) ?? null,
    difficulty: diffJobs.length ? aggregateDifficulty(mode === 'quick' ? QUICK_DIFF : FULL_DIFF, diffJobs, wall) : null,
    determinism: runs['determinism-a'] && runs['determinism-b'] ? [runs['determinism-a'], runs['determinism-b']] : null,
    wallSeconds: wall,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
function series(d: AcceptData, prefix: string): RunResult[] { return d.seeds.map((s) => d.runs[`${prefix}-s${s}`]).filter(Boolean); }

export function testCheckpointOdds(d: AcceptData): AcceptRow {
  const o = checkpointOdds(series(d, 'generalist-idle'));
  const pass = inRange(o.p1, 0.15, 0.3) && inRange(o.p2, 0.4, 0.6) && inRange(o.p3, 0.7, 0.9);
  return { name: 'Checkpoint odds', pass, value: `${pct(o.p1)} / ${pct(o.p2)} / ${pct(o.p3)} (n=${o.n})`, target: '15–30% / 40–60% / 70–90% by attempt 1/2/3',
    notes: `attempts per checkpoint: ${o.dist.join(',')}` };
}

export function testCheckpointTime(d: AcceptData): AcceptRow {
  const m = checkpointMinutes(series(d, 'generalist-idle'));
  const med = median(m);
  return { name: 'Checkpoint time', pass: inRange(med, 8, 20), value: `${round(med, 1)} min median (n=${m.length})`, target: '8–20 min median, first Prestige',
    notes: `per checkpoint (min): ${m.map((x) => round(x, 1)).join(', ')}` };
}

export function testFirstWall(d: AcceptData): AcceptRow {
  const runs = series(d, 'generalist-idle');
  const recs = runs.map(gameRecommendation);
  const waves = recs.map((r) => (r ? r.wave : NaN));
  const med = median(waves.filter(Number.isFinite));
  const forecast = runs.some((r) => r.forecastPresent);
  return { name: 'First wall', pass: waves.every(Number.isFinite) && waves.every((w) => inRange(w, 22, 28)),
    value: `wave ${waves.map((w) => (Number.isFinite(w) ? String(w) : 'never')).join(', ')}${Number.isFinite(med) ? ` (median ${round(med, 1)})` : ''}`,
    target: 'Prestige recommended at wave 22–28 on run 1',
    notes: `${forecast ? 'UiState.forecast.recommended' : 'Forecast absent: computed §3 rule'}; computed rule ${runs.map((r) => r.computedRecommended?.wave ?? '—').join('/')}; Echo-rate peak ${runs.map((r) => r.echoPeak?.wave ?? '—').join('/')}; stop ${runs.map((r) => r.wallWave !== null ? `wall@${r.wallWave}` : r.stopReason).join(', ')}` };
}

export function testReclimb(d: AcceptData): AcceptRow {
  const c = d.chain;
  if (!c || !c.implemented || c.runs.length < 2) return { name: 'Reclimb', pass: false, skipped: 'prestige not implemented', value: '—', target: '25–40% of previous run time', notes: c?.notes.join('; ') ?? '' };
  if (c.runs[0].deepestCleared < 20) return { name: 'Reclimb', pass: false, skipped: `run 1 reached only wave ${c.runs[0].deepestCleared} in budget (no Echoes below 20)`, value: '—', target: '25–40% of previous run time', notes: c.notes.join('; ') };
  const ratios: number[] = [];
  let best = c.runs[0].deepestCleared;
  for (let i = 1; i < c.runs.length; i++) {
    const t = timeToWave(c.runs[i], best);
    ratios.push(t === null ? Infinity : t / Math.max(1, c.runs[i - 1].playSeconds));
    best = Math.max(best, c.runs[i].deepestCleared);
  }
  return { name: 'Reclimb', pass: ratios.every((r) => inRange(r, 0.25, 0.4)), value: ratios.map((r) => pct(r)).join(', '), target: '25–40% of previous run time', notes: c.notes.join('; ') };
}

export function testPush(d: AcceptData): AcceptRow {
  const c = d.chain;
  if (!c || !c.implemented || c.runs.length < 2) return { name: 'Push', pass: false, skipped: 'prestige not implemented', value: '—', target: '+8–15 waves per Prestige (2–8)', notes: c?.notes.join('; ') ?? '' };
  if (c.runs[0].deepestCleared < 20) return { name: 'Push', pass: false, skipped: `run 1 reached only wave ${c.runs[0].deepestCleared} in budget (no Echoes below 20)`, value: '—', target: '+8–15 waves per Prestige (2–8)', notes: c.notes.join('; ') };
  const pushes: number[] = [];
  let best = c.runs[0].deepestCleared;
  for (let i = 1; i < c.runs.length; i++) { pushes.push(c.runs[i].deepestCleared - best); best = Math.max(best, c.runs[i].deepestCleared); }
  return { name: 'Push', pass: pushes.every((p) => inRange(p, 8, 15)), value: pushes.map((p) => `+${p}`).join(', '), target: '+8–15 waves past previous best (Prestiges 2–8)',
    notes: `depths ${c.runs.map((r) => r.deepestCleared).join(' → ')}` };
}

export function testForecast(d: AcceptData): AcceptRow {
  const runs = series(d, 'generalist-idle');
  const present = runs.some((r) => r.forecastPresent);
  const errs = runs.map((r) => {
    const rec = gameRecommendation(r);
    return rec && r.echoPeak ? Math.abs(rec.wave - r.echoPeak.wave) / r.echoPeak.wave : NaN;
  });
  const worst = errs.some((e) => !Number.isFinite(e)) ? Infinity : Math.max(...errs);
  const row: AcceptRow = { name: 'Forecast', pass: present && worst <= 0.1, value: Number.isFinite(worst) ? `worst ${pct(worst)} off the peak wave` : 'no recommendation in ≥ 1 run',
    target: 'recommendation within 10% of the true Echo-rate peak',
    notes: runs.map((r) => `rec ${gameRecommendation(r)?.wave ?? 'never'} vs peak ${r.echoPeak?.wave ?? '—'} (${r.echoPeak ? round(r.echoPeak.rate, 0) : '—'}/h)`).join('; ') };
  if (!present) row.skipped = 'Forecast not implemented (value uses the computed rule)';
  return row;
}

export function testBuildHealth(d: AcceptData): AcceptRow {
  const s0 = d.seeds[0];
  const all = Object.entries(d.runs).filter(([k]) => k.endsWith(`-idle-s${s0}`) && !k.startsWith('doctrine-') && !k.startsWith('anomaly-')).map(([, r]) => r);
  const hp = HARDPOINT_AGENTS.map((a) => d.runs[`${a}-idle-s${s0}`]).filter(Boolean);
  if (!hp.length || !all.length) return { name: 'Build health', pass: false, skipped: 'no runs', value: '—', target: '≥ 85%', notes: '' };
  const best = all.reduce((a, b) => (b.deepestCleared > a.deepestCleared ? b : a));
  const parts: string[] = [];
  let worst = Infinity, worstName = '';
  const finales = FINALES.filter((f) => timeToWave(best, f) !== null);
  if (finales.length) {
    for (const f of finales) {
      const t = timeToWave(best, f)!;
      for (const r of hp) { const x = depthAt(r, t) / f; if (x < worst) { worst = x; worstName = `${r.agent}@${f}`; } }
      parts.push(`F${f}: ${hp.map((r) => `${r.agent.slice(3)} ${depthAt(r, t)}`).join(' ')}`);
    }
  } else {
    for (const r of hp) { const x = r.deepestCleared / Math.max(1, best.deepestCleared); if (x < worst) { worst = x; worstName = r.agent; } }
    parts.push('no Sector finale cleared by the best agent; final depths');
  }
  return { name: 'Build health', pass: worst >= 0.85, value: `worst ${pct(worst)} (${worstName})`, target: 'every hardpoint agent ≥ 85% of best depth at each finale',
    notes: `best ${best.agent} (${best.deepestCleared}); ${parts.join('; ')}; hardpoint depths ${hp.map((r) => `${r.agent.slice(3)} ${r.deepestCleared}`).join(', ')}` };
}

export function testDoctrineHealth(d: AcceptData): AcceptRow {
  const byTree = new Map<string, { doc: string; depth: number }[]>();
  for (const [k, r] of Object.entries(d.runs)) {
    const m = /^doctrine-([a-z]+)\.([a-z_]+)-s\d+$/.exec(k);
    if (!m) continue;
    const a = byTree.get(m[1]) ?? [];
    // a probe whose Doctrine never got chosen did not test it
    a.push({ doc: m[2], depth: r.build.doctrines[m[1] as TreeId] === (m[2] as DoctrineId) ? r.deepestCleared : 0 });
    byTree.set(m[1], a);
  }
  let worst = Infinity, worstName = '';
  const parts: string[] = [];
  for (const [t, a] of byTree) {
    const best = Math.max(...a.map((x) => x.depth));
    for (const x of a) { const r = best > 0 ? x.depth / best : 0; if (r < worst) { worst = r; worstName = `${t}.${x.doc}`; } }
    parts.push(`${t}: ${a.map((x) => `${x.doc} ${x.depth}`).join(' ')}`);
  }
  return { name: 'Doctrine health', pass: byTree.size > 0 && worst >= 0.8, value: `worst ${pct(worst)} (${worstName})`, target: "every Doctrine ≥ 80% of its tree's best",
    notes: parts.join('; ') };
}

export function testSpendEfficiency(d: AcceptData): AcceptRow {
  const s0 = d.seeds[0];
  const offenders: string[] = [];
  let n = 0;
  for (const [k, r] of Object.entries(d.runs)) {
    if (!k.endsWith(`-idle-s${s0}`) || k.startsWith('anomaly-') || k.startsWith('doctrine-')) continue;
    n++;
    for (const x of spendVsEffect(r)) {
      if (NON_DAMAGE_TREES.has(x.system)) continue;
      if (x.spendShare >= 0.2 && x.damageShare < 0.1) offenders.push(`${r.agent}: ${x.system} spend ${pct(x.spendShare)} dmg ${pct(x.damageShare)}`);
    }
  }
  return { name: 'Spend efficiency', pass: offenders.length === 0, value: `${offenders.length} offenders in ${n} runs`, target: 'no system with ≥ 20% of spend gives < 10% of damage',
    notes: offenders.slice(0, 12).join('; ') || 'none' };
}

export function testDefense(d: AcceptData): AcceptRow {
  const g = median(series(d, 'greedy-idle').map((r) => r.deepestCleared));
  const s = median(series(d, 'survival-idle').map((r) => r.deepestCleared));
  return { name: 'Defense', pass: s >= 0.9 * g, value: `survival ${s} vs greedy ${g} (${pct(s / g)})`, target: 'Survival ≥ 90% of Greedy DPS depth', notes: 'median deepest over seeds' };
}

function commonCp(runs: RunResult[]): number { return Math.min(...runs.map((r) => r.checkpoint)); }

export function testActiveEdge(d: AcceptData): AcceptRow {
  const idle = series(d, 'generalist-idle'), act = series(d, 'generalist-active');
  let ai = 0, aa = 0;
  const behind: string[] = [];
  for (let i = 0; i < Math.min(idle.length, act.length); i++) {
    const c = commonCp([idle[i], act[i]]);
    ai += attemptsUpTo(idle[i], c); aa += attemptsUpTo(act[i], c);
    if (idle[i].checkpoint < act[i].checkpoint - 5) behind.push(`s${idle[i].seed}: idle ${idle[i].checkpoint} vs active ${act[i].checkpoint}`);
  }
  const edge = ai > 0 ? 1 - aa / ai : NaN;
  const casts = act.reduce((s, r) => s + r.casts, 0), counters = act.reduce((s, r) => s + r.counters, 0), tells = act.reduce((s, r) => s + r.tells, 0);
  return { name: 'Active edge', pass: inRange(edge, 0.15, 0.3) && behind.length === 0, value: `${pct(edge)} fewer attempts (${aa} vs ${ai})`,
    target: '15–30% fewer attempts; idle clears every boss',
    notes: `${behind.length ? `idle behind: ${behind.join(', ')}` : 'idle keeps up with every boss'}; active casts ${casts}, tells ${tells}, counters ${counters} (${pct(tells ? counters / tells : NaN)}); rejected: ${JSON.stringify(act[0]?.noops ?? {})}` };
}

export function testDirectiveGap(d: AcceptData): AcceptRow {
  const idle = series(d, 'generalist-idle'), act = series(d, 'generalist-active'), dir = series(d, 'generalist-directive');
  let ai = 0, aa = 0, ad = 0;
  for (let i = 0; i < Math.min(idle.length, act.length, dir.length); i++) {
    const c = commonCp([idle[i], act[i], dir[i]]);
    ai += attemptsUpTo(idle[i], c); aa += attemptsUpTo(act[i], c); ad += attemptsUpTo(dir[i], c);
  }
  const gap = ai - aa;
  const closed = gap > 0 ? (ai - ad) / gap : NaN;
  return { name: 'Directive gap', pass: inRange(closed, 0.4, 0.7), value: gap > 0 ? `closes ${pct(closed)}` : `no idle→active gap (idle ${ai}, active ${aa}, directive ${ad})`,
    target: 'Directive policy closes 40–70% of the idle→active gap', notes: `attempts idle ${ai}, directive ${ad}, active ${aa}; directive casts ${dir.reduce((s, r) => s + r.casts, 0)}` };
}

export function testFormationFairness(d: AcceptData): AcceptRow {
  const df = d.difficulty;
  if (!df) return { name: 'Formation fairness', pass: false, skipped: 'difficulty not measured', value: '—', target: '≤ 1.5× median', notes: '' };
  const bad = df.fairness.filter((f) => !f.fair);
  const worst = df.fairness.reduce((a, b) => (b.ratio > a.ratio ? b : a), df.fairness[0]);
  return { name: 'Formation fairness', pass: bad.length === 0, value: `${bad.length}/${df.fairness.length} template-bands unfair; worst ×${worst?.ratio ?? '—'} (${worst ? `${worst.template} b${worst.band} ${worst.worst}` : ''})`,
    target: 'no live template > 1.5× median multiplier for any archetype', notes: bad.slice(0, 8).map((f) => `${f.template} b${f.band} ${f.worst} ×${f.ratio}`).join('; ') || 'all fair' };
}

export function testAnomalyCap(d: AcceptData): AcceptRow {
  const seeds = d.seeds.filter((s) => d.runs[`anomaly-none-s${s}`]);
  if (!seeds.length) return { name: 'Anomaly cap', pass: false, skipped: 'no baseline', value: '—', target: '≤ 15% (Paradox ≤ 25%)', notes: '' };
  const baseDepths = seeds.map((s) => d.runs[`anomaly-none-s${s}`].deepestCleared);
  const base = mean(baseDepths);
  const over: string[] = [];
  const parts: string[] = [];
  let worst = -Infinity, worstName = '', socketed = 0;
  for (const a of ANOMALIES) {
    const rs = seeds.map((s) => d.runs[`anomaly-${a.id}-s${s}`]).filter(Boolean);
    if (!rs.length) continue;
    const ok = rs.filter((r) => r.build.anomalies.includes(a.id as AnomalyId) || r.anomaliesPicked.includes(a.id));
    if (!ok.length) { parts.push(`${a.id} (never socketed)`); continue; }
    socketed++;
    const raise = mean(ok.map((r) => r.deepestCleared)) / Math.max(1, base) - 1;
    const cap = a.rarity === 'paradox' ? 0.25 : 0.15;
    parts.push(`${a.id} ${raise >= 0 ? '+' : ''}${pct(raise, 0)}`);
    if (raise > worst) { worst = raise; worstName = a.id; }
    if (raise > cap) over.push(`${a.id} +${pct(raise)}`);
  }
  const H = round(d.runs[`anomaly-none-s${seeds[0]}`].simSeconds / 3600, 2);
  if (socketed === 0) return { name: 'Anomaly cap', pass: false, skipped: `first draft (wave 10) not reached in ${H} sim-h`, value: `baseline depth ${round(base, 1)}`,
    target: 'no Anomaly raises Optimizer depth > 15% (Paradox > 25%)', notes: parts.join(', ') };
  const spread = baseDepths.length > 1 ? `${Math.min(...baseDepths)}–${Math.max(...baseDepths)}` : String(baseDepths[0]);
  return { name: 'Anomaly cap', pass: over.length === 0, value: `max +${pct(worst)} (${worstName}); baseline (first draft skipped) depth ${round(base, 1)}`,
    target: 'no Anomaly raises Optimizer depth > 15% (Paradox > 25%)',
    notes: `optimizer_lite, ${H} sim-h, mean over ${seeds.length} seed(s) (baseline range ${spread}); over cap: ${over.join(', ') || 'none'}; all: ${parts.join(', ')}` };
}

export function testOffline(d: AcceptData): AcceptRow {
  const o = d.offline;
  if (!o) return { name: 'Offline', pass: false, skipped: 'not run', value: '—', target: '', notes: '' };
  // 1% tolerance: the machine's rate window and ours differ by the loop phase at which Patrol started
  const pass = o.bossWavesFought === 0 && o.checkpointsSet === 0 && o.ratio <= 0.4 * 1.01;
  return { name: 'Offline', pass, value: `boss fights ${o.bossWavesFought}, offline/online ${pct(o.ratio)}`, target: 'Patrol never fights a boss; offline Scrap/h ≤ 40% of online Patrol',
    notes: `online ${Math.round(o.onlineScrapPerHour)}/h, offline ${Math.round(o.offlineScrapPerHour)}/h, measured patrol rate ${round(o.measuredPatrolRatePerSecond * 3600, 0)}/h ${o.notes.join('; ')}` };
}

export function testDeterminism(d: AcceptData): AcceptRow {
  const p = d.determinism;
  if (!p) return { name: 'Determinism', pass: false, skipped: 'not run', value: '—', target: '', notes: '' };
  const same = p[0].finalHash === p[1].finalHash && p[0].deepestCleared === p[1].deepestCleared && p[0].ticks === p[1].ticks;
  return { name: 'Determinism', pass: same, value: `${p[0].finalHash.toString(16)} vs ${p[1].finalHash.toString(16)}`, target: 'same seed + build → identical event hash (Node; browsers via golden PRNG snapshot)',
    notes: `greedy/active, ${round(p[0].simSeconds / 60, 0)} sim-min, deepest ${p[0].deepestCleared}; separate processes` };
}

export function evaluate(d: AcceptData): AcceptRow[] {
  return [
    testCheckpointOdds(d), testCheckpointTime(d), testFirstWall(d), testReclimb(d), testPush(d), testForecast(d),
    testBuildHealth(d), testDoctrineHealth(d), testSpendEfficiency(d), testDefense(d), testActiveEdge(d), testDirectiveGap(d),
    testFormationFairness(d), testAnomalyCap(d), testOffline(d), testDeterminism(d),
  ];
}

export async function runAcceptance(opts: AcceptOptions): Promise<AcceptReport> {
  const data = await gather(opts);
  return { rows: evaluate(data), data };
}

