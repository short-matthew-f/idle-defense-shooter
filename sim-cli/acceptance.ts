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
 *  - Checkpoint odds: attempts per checkpoint before the Prestige recommendation (the attempt that
 *    cleared the previous boss counts as #1), idle Generalist, first Prestige. Owner-approved targets
 *    (2026-10-06): first boss first try, every pre-Frontier checkpoint ≤ 6 attempts, ≥ 1 wall (≥ 3).
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
 *  - Boon cap: the idle Generalist over a fixed horizon (2 sim-h full, 1 sim-h quick) on two seeds, once
 *    declining every boon offer (baseline) and once per boon with that boon forced: injected into every offer
 *    and picked, and while it is active further offers are declined, so it is the only boon active. (Taking
 *    the first card instead — the --force-boon CLI default — measures the companions too.) Pass when no boon raises the mean deepest
 *    wave by more than 10%. The notes add the noise floor: the mean raise of boons whose `needs` the Generalist
 *    never meets (they do nothing for it, so that raise is chaos at the walls). Quick mode forces QUICK_BOONS.
 *  - Spend efficiency: judged on damage trees only (Bastion, Reactor, ability ranks buy survival /
 *    utility, not damage share); over every idle agent run. Damage share is by srcTag, with Fusion damage split
 *    over its elements (metrics.damageBySpendTree). Full mode confirms each flagged system with the spend
 *    counterfactual (counterfactual.ts): it stays an offender only if removing its ranks also costs < 10% of the
 *    build's summed contribution (Caliber scales other systems' damage, hardpoints carry element procs).
 */
import type { AnomalyId, BoonId, DoctrineId, TreeId } from '../src/sim/core/ids';
import { allTrees } from '../src/sim/core/content';
import { ANOMALIES, BOONS } from '../src/sim/data/index';
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
  /**
   * Diagnostic (`sim:accept -- --no-boons`): every agent declines every boon offer, as if boons did not exist
   * (the Boon cap row then measures nothing). Compares the other rows with and without boons.
   */
  noBoons?: boolean;
}

export interface AcceptData {
  mode: Mode;
  seeds: number[];
  hours: number;
  runs: Record<string, RunResult>;
  /**
   * Seeds for the idle / active / directive comparison rows (Active edge, Directive gap): full mode adds three
   * more Generalist seeds, since those rows compare a handful of attempts per seed (owner, 2026-10-07).
   */
  edgeSeeds?: number[];
  /** The first seed's chain (kept for single-chain readers). */
  chain: PrestigeChainResult | null;
  /** One chain per chain seed (full: every seed; quick: the first seed only). */
  chains: PrestigeChainResult[];
  offline: OfflineResult | null;
  difficulty: DifficultyResult | null;
  determinism: [RunResult, RunResult] | null;
  wallSeconds: number;
}

export interface AcceptReport { rows: AcceptRow[]; data: AcceptData }

interface Plan { key: string; job: Job }

const FINALES = [20, 40, 60, 80, 100];

function inRange(x: number, lo: number, hi: number): boolean { return Number.isFinite(x) && x >= lo && x <= hi; }

/** The idle / active / directive comparison seeds: full mode adds three more beyond the main seeds. */
export function edgeSeedsFor(mode: Mode, seeds: number[]): number[] {
  if (mode === 'quick') return seeds;
  const top = Math.max(0, ...seeds);
  return [...seeds, top + 1, top + 2, top + 3];
}

export function plan(mode: Mode, seeds: number[], hours: number): Plan[] {
  const quick = mode === 'quick';
  const H = hours * 3600;
  const out: Plan[] = [];
  const att = (key: string, cfg: Omit<RunConfig, 'name'>): void => { out.push({ key, job: { kind: 'attempt', cfg: { stopAtWave: 100, ...cfg, name: key } } }); };
  // extra comparison seeds: only the three Generalist policies the edge rows read
  for (const seed of edgeSeedsFor(mode, seeds).filter((x) => !seeds.includes(x))) {
    for (const policy of ['idle', 'active', 'directive'] as const) att(`generalist-${policy}-s${seed}`, { seed, agent: 'generalist', policy, maxSimSeconds: H });
  }
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
  // Boon cap: baseline (every offer declined) vs each boon forced, idle Generalist, fixed horizon, two seeds
  const bH = quick ? 3600 : 2 * 3600;
  for (const seed of boonSeeds(seeds)) {
    att(`boon-none-s${seed}`, { seed, agent: 'generalist', policy: 'idle', maxSimSeconds: bH, noBoons: true, hashes: false });
    for (const b of quick ? quickBoons() : BOONS.map((x) => x.id)) att(`boon-${b}-s${seed}`, { seed, agent: 'generalist', policy: 'idle', maxSimSeconds: bH, forceBoon: b, boonCompanions: 'none', hashes: false });
  }
  // Prestige chain, offline, determinism
  for (const seed of quick ? [s0] : seeds) out.push({ key: `chain-s${seed}`, job: { kind: 'chain', cfg: { name: `chain-generalist-s${seed}`, seed, agent: 'generalist', policy: 'idle', maxSimSeconds: quick ? 3600 : H }, n: quick ? 2 : 3 } });
  out.push({ key: 'offline', job: { kind: 'offline', cfg: { name: 'offline', seed: s0, agent: 'generalist', policy: 'idle', maxSimSeconds: 3600, stopAtWave: 19 }, patrolSeconds: quick ? 600 : 1800 } });
  for (const k of ['a', 'b']) att(`determinism-${k}`, { seed: 7, agent: 'greedy', policy: 'active', maxSimSeconds: quick ? 600 : 1800 });
  // Difficulty phase 1: archetype climbs (phase 2 — one job per archetype × band — runs after)
  const dopts = quick ? QUICK_DIFF : FULL_DIFF;
  for (const a of dopts.archetypes) out.push({ key: `diffclimb-${a}`, job: { kind: 'diffclimb', archetype: a, bands: dopts.bands } });
  // Spend efficiency (full mode): the judged runs also measure the counterfactual contribution of each damage tree
  if (!quick) for (const x of out) if (x.job.kind === 'attempt' && isSpendRun(x.key, s0)) x.job.cfg.spendProbe = true;
  return out;
}

/** The runs the Spend efficiency row judges: every idle agent climb on the first seed (no Anomaly / Doctrine probes). */
function isSpendRun(key: string, s0: number): boolean {
  return key.endsWith(`-idle-s${s0}`) && !key.startsWith('anomaly-') && !key.startsWith('doctrine-');
}

export async function gather(opts: AcceptOptions): Promise<AcceptData> {
  const mode = opts.mode;
  const seeds = opts.seeds ?? (mode === 'quick' ? [1] : [1, 2, 3]);
  const hours = opts.hours ?? (mode === 'quick' ? 0.5 : 4);
  const log = opts.log ?? (() => {});
  const p = plan(mode, seeds, hours);
  if (opts.noBoons) for (const x of p) if ('cfg' in x.job && !x.key.startsWith('boon-')) (x.job.cfg as RunConfig).noBoons = true;
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
  const chains = p.filter((x) => x.job.kind === 'chain').map((x) => byKey[x.key] as PrestigeChainResult).filter(Boolean);
  // Difficulty phase 2
  const dopts = mode === 'quick' ? QUICK_DIFF : FULL_DIFF;
  const dj = difficultyJobs(dopts, snaps);
  log(`  difficulty: ${dj.length} archetype×band jobs (archetype depths ${snaps.map((s) => `${s.archetype} ${s.reached}`).join(', ')})`);
  const dres = await runJobs<DiffJobResult>(dj.map((job) => ({ kind: 'diff', job })), opts.parallel, (_i, _r, done) => { if (done % 20 === 0 || done === dj.length) log(`  difficulty ${done}/${dj.length} (${round((performance.now() - t0) / 1000, 0)} s)`); });
  const diffJobs = dj.map((job, i) => ({ job, res: dres[i] }));
  const wall = (performance.now() - t0) / 1000;
  return {
    mode, seeds, hours, runs, edgeSeeds: edgeSeedsFor(mode, seeds),
    chain: chains[0] ?? null,
    chains,
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
/** The comparison rows' runs: the main seeds plus full mode's extra edge seeds. */
function edgeSeries(d: AcceptData, prefix: string): RunResult[] { return (d.edgeSeeds ?? d.seeds).map((s) => d.runs[`${prefix}-s${s}`]).filter(Boolean); }

/** The checkpoints before the run's Prestige recommendation (past the Frontier, walls are the design). */
function preFrontier(r: RunResult): RunResult['checkpoints'] {
  const rec = gameRecommendation(r)?.wave ?? Infinity;
  return r.checkpoints.filter((c) => c.checkpoint <= rec);
}

/**
 * Owner 2026-10-06 ("Bosses at 10 and 20 can be hard"): the first boss falls on the first try, the hardest checkpoint
 * before the Frontier falls within 6 attempts (median over seeds; the time row bounds the outliers), and at least one is a real wall (≥ 3 attempts). Replaces the old
 * 15–30 / 40–60 / 70–90 % first-try odds, which predate the onboarding goals.
 */
export function testCheckpointOdds(d: AcceptData): AcceptRow {
  const runs = series(d, 'generalist-idle');
  const per = runs.map((r) => preFrontier(r).map((c) => c.attempts));
  const firstTry = per.every((a) => a.length > 0 && a[0] === 1);
  const worstPer = per.map((a) => Math.max(0, ...a));
  const worst = median(worstPer);
  const walls = per.every((a) => a.some((x) => x >= 3));
  const all = per.flat();
  return { name: 'Checkpoint odds', pass: firstTry && worst <= 6 && walls,
    value: `first boss ${firstTry ? 'first try' : 'not first try'}; hardest ${worst} attempts (median; per seed ${worstPer.join('/')}); ${pct(all.filter((x) => x === 1).length / Math.max(1, all.length))} first-try (n=${all.length})`,
    target: 'first boss first try; hardest pre-Frontier checkpoint ≤ 6 attempts (median over seeds); at least one wall (≥ 3)',
    notes: `attempts per pre-Frontier checkpoint: ${per.map((a) => a.join(',')).join(' | ')}` };
}

/** Owner-approved onboarding goal: the first Prestige is recommended after 25–40 min of play; no checkpoint over 20 min. */
export function testCheckpointTime(d: AcceptData): AcceptRow {
  const runs = series(d, 'generalist-idle');
  const recMin = runs.map((r) => { const g = gameRecommendation(r); return g ? g.seconds / 60 : NaN; });
  const cpMin = runs.flatMap((r) => preFrontier(r).map((c) => c.minutes));
  const med = median(recMin.filter(Number.isFinite));
  const slowest = Math.max(0, ...cpMin);
  return { name: 'Checkpoint time', pass: recMin.every(Number.isFinite) && inRange(med, 25, 40) && slowest <= 20,
    value: `first Prestige at ${Number.isFinite(med) ? round(med, 1) : '—'} min median; slowest checkpoint ${round(slowest, 1)} min`,
    target: 'first Prestige recommended at 25–40 min of play; no pre-Frontier checkpoint over 20 min',
    notes: `recommended at (min): ${recMin.map((x) => (Number.isFinite(x) ? round(x, 1) : 'never')).join(', ')}; per checkpoint (min): ${cpMin.map((x) => round(x, 1)).join(', ')}` };
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

/** The chains that can be judged (Prestige implemented, ≥ 2 runs, run 1 reached wave 20), plus their notes. */
function usableChains(d: AcceptData): { ok: PrestigeChainResult[]; notes: string[]; why: string } {
  const cs = d.chains?.length ? d.chains : d.chain ? [d.chain] : [];
  const ok: PrestigeChainResult[] = [];
  const notes: string[] = [];
  let why = 'prestige not implemented';
  for (const c of cs) {
    notes.push(...c.notes);
    if (!c.implemented || c.runs.length < 2) continue;
    if (c.runs[0].deepestCleared < 20) { why = `run 1 reached only wave ${c.runs[0].deepestCleared} in budget (no Echoes below 20)`; continue; }
    ok.push(c);
  }
  return { ok, notes, why };
}

function chainSeed(c: PrestigeChainResult): string { return /-s(\d+)$/.exec(c.name)?.[1] ?? '?'; }

/** Per-seed lists → per-Prestige medians across seeds. */
function medianPerPrestige(lists: number[][]): number[] {
  const n = Math.min(...lists.map((l) => l.length));
  return Array.from({ length: n }, (_, i) => median(lists.map((l) => l[i])));
}

function chainBasis(d: AcceptData, n: number): string {
  return d.mode === 'quick' ? `indicative (${n} seed, quick mode)` : `gated on the median of ${n} seed(s)`;
}

/**
 * Owner 2026-10-06: back to the previous best in 25–50 % of the previous run's time (median over seeds), never
 * slower than the Prestige before (+5 points of noise allowed), and never more than 20 min of play.
 */
export function testReclimb(d: AcceptData): AcceptRow {
  const target = '25–50% of previous run time, not rising Prestige to Prestige, ≤ 20 min (medians over seeds)';
  const { ok, notes, why } = usableChains(d);
  if (!ok.length) return { name: 'Reclimb', pass: false, skipped: why, value: '—', target, notes: notes.join('; ') };
  const per = ok.map((c) => {
    const ratios: number[] = [], mins: number[] = [];
    let best = c.runs[0].deepestCleared;
    for (let i = 1; i < c.runs.length; i++) {
      const t = timeToWave(c.runs[i], best);
      ratios.push(t === null ? Infinity : t / Math.max(1, c.runs[i - 1].playSeconds));
      mins.push(t === null ? Infinity : t / 60);
      best = Math.max(best, c.runs[i].deepestCleared);
    }
    return { ratios, mins };
  });
  const med = medianPerPrestige(per.map((p) => p.ratios));
  const medMin = medianPerPrestige(per.map((p) => p.mins));
  const falling = med.every((r, i) => i === 0 || r <= med[i - 1] + 0.05);
  return { name: 'Reclimb', pass: med.every((r) => inRange(r, 0.25, 0.5)) && falling && medMin.every((m) => m <= 20),
    value: `${med.map((r) => pct(r)).join(', ')} (${medMin.map((m) => `${round(m, 1)} min`).join(', ')})`, target,
    notes: `${chainBasis(d, ok.length)}; per seed: ${ok.map((c, i) => `s${chainSeed(c)} ${per[i].ratios.map((r) => pct(r)).join('/')}`).join(', ')}; ${notes.join('; ')}` };
}

export function testPush(d: AcceptData): AcceptRow {
  const target = '+8–15 waves past previous best (Prestiges 2–8, median over seeds)';
  const { ok, notes, why } = usableChains(d);
  if (!ok.length) return { name: 'Push', pass: false, skipped: why, value: '—', target, notes: notes.join('; ') };
  const per = ok.map((c) => {
    const pushes: number[] = [];
    let best = c.runs[0].deepestCleared;
    for (let i = 1; i < c.runs.length; i++) { pushes.push(c.runs[i].deepestCleared - best); best = Math.max(best, c.runs[i].deepestCleared); }
    return pushes;
  });
  const med = medianPerPrestige(per);
  return { name: 'Push', pass: med.every((p) => inRange(p, 8, 15)), value: med.map((p) => `+${round(p, 1)}`).join(', '), target,
    notes: `${chainBasis(d, ok.length)}; per seed: ${ok.map((c, i) => `s${chainSeed(c)} ${per[i].map((p) => `+${p}`).join('/')} (depths ${c.runs.map((r) => r.deepestCleared).join('→')})`).join(', ')}` };
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
  const offenders: string[] = [], cleared: string[] = [];
  let n = 0;
  for (const [k, r] of Object.entries(d.runs)) {
    if (!isSpendRun(k, s0)) continue;
    n++;
    const cf = r.spendContribution;
    let cfTotal = 0;
    if (cf) for (const v of Object.values(cf)) cfTotal += Math.max(0, v);
    for (const x of spendVsEffect(r)) {
      if (NON_DAMAGE_TREES.has(x.system)) continue;
      if (!(x.spendShare >= 0.2 && x.damageShare < 0.1)) continue;
      const msg = `${r.agent}: ${x.system} spend ${pct(x.spendShare)} dmg ${pct(x.damageShare)}`;
      // Confirmed by the counterfactual (counterfactual.ts) when its ranks also give < 10% of the build's summed contribution
      const share = cf && cfTotal > 0 ? Math.max(0, cf[x.system] ?? 0) / cfTotal : NaN;
      if (Number.isFinite(share) && share >= 0.1) cleared.push(`${msg}, but its ranks give ${pct(share)} of the counterfactual`);
      else offenders.push(`${msg}${Number.isFinite(share) ? `, counterfactual ${pct(share)}` : ''}`);
    }
  }
  return { name: 'Spend efficiency', pass: offenders.length === 0, value: `${offenders.length} offenders in ${n} runs`,
    target: 'no system with ≥ 20% of spend gives < 10% of damage (by share, confirmed by the counterfactual in full mode)',
    notes: `${offenders.slice(0, 12).join('; ') || 'none'}${cleared.length ? `; cleared by the counterfactual: ${cleared.join('; ')}` : ''}` };
}

export function testDefense(d: AcceptData): AcceptRow {
  const g = median(series(d, 'greedy-idle').map((r) => r.deepestCleared));
  const s = median(series(d, 'survival-idle').map((r) => r.deepestCleared));
  return { name: 'Defense', pass: s >= 0.9 * g, value: `survival ${s} vs greedy ${g} (${pct(s / g)})`, target: 'Survival ≥ 90% of Greedy DPS depth', notes: 'median deepest over seeds' };
}

function commonCp(runs: RunResult[]): number { return Math.min(...runs.map((r) => r.checkpoint)); }

export function testActiveEdge(d: AcceptData): AcceptRow {
  const idle = edgeSeries(d, 'generalist-idle'), act = edgeSeries(d, 'generalist-active');
  let ai = 0, aa = 0;
  const behind: string[] = [];
  for (let i = 0; i < Math.min(idle.length, act.length); i++) {
    const c = commonCp([idle[i], act[i]]);
    ai += attemptsUpTo(idle[i], c); aa += attemptsUpTo(act[i], c);
    if (idle[i].checkpoint < act[i].checkpoint - 5) behind.push(`s${idle[i].seed}: idle ${idle[i].checkpoint} vs active ${act[i].checkpoint}`);
  }
  const edge = ai > 0 ? 1 - aa / ai : NaN;
  const casts = act.reduce((s, r) => s + r.casts, 0), counters = act.reduce((s, r) => s + r.counters, 0), tells = act.reduce((s, r) => s + r.tells, 0);
  return { name: 'Active edge', pass: inRange(edge, 0.15, 0.4) && behind.length === 0, value: `${pct(edge)} fewer attempts (${aa} vs ${ai})`,
    target: '15–40% fewer attempts; idle clears every boss',
    notes: `${behind.length ? `idle behind: ${behind.join(', ')}` : 'idle keeps up with every boss'}; active casts ${casts}, tells ${tells}, counters ${counters} (${pct(tells ? counters / tells : NaN)}); rejected: ${JSON.stringify(act[0]?.noops ?? {})}` };
}

export function testDirectiveGap(d: AcceptData): AcceptRow {
  const idle = edgeSeries(d, 'generalist-idle'), act = edgeSeries(d, 'generalist-active'), dir = edgeSeries(d, 'generalist-directive');
  let ai = 0, aa = 0, ad = 0;
  for (let i = 0; i < Math.min(idle.length, act.length, dir.length); i++) {
    const c = commonCp([idle[i], act[i], dir[i]]);
    ai += attemptsUpTo(idle[i], c); aa += attemptsUpTo(act[i], c); ad += attemptsUpTo(dir[i], c);
  }
  const gap = ai - aa;
  const closed = gap > 0 ? (ai - ad) / gap : NaN;
  return { name: 'Directive gap', pass: inRange(closed, 0.4, 0.7), value: gap > 0 ? `closes ${pct(closed)}` : `no idle→active gap (idle ${ai}, active ${aa}, directive ${ad})`,
    target: 'Directive policy closes 40–70% of the idle→active gap', notes: `${idle.length} seeds; attempts idle ${ai}, directive ${ad}, active ${aa}; directive casts ${dir.reduce((s, r) => s + r.casts, 0)}` };
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

/** The two seeds the Boon cap uses (the first two acceptance seeds; quick mode adds seed + 1). */
export function boonSeeds(seeds: number[]): number[] { return seeds.length >= 2 ? seeds.slice(0, 2) : [seeds[0], seeds[0] + 1]; }

/**
 * The six boons quick mode forces: the ones that read closest to the cap in the last full measurement
 * (docs/BOONS.md, "Measured effect"). Update this list when a full run reorders the top of the table.
 */
export const QUICK_BOONS: readonly BoonId[] = ['glass_hour', 'rally_drones', 'slow_and_sure', 'second_wind', 'thick_plating', 'trophy_hunter'];
export function quickBoons(): BoonId[] { return QUICK_BOONS.filter((id) => BOONS.some((b) => b.id === id)); }

export function testBoonCap(d: AcceptData): AcceptRow {
  const target = 'no boon raises the idle Generalist\'s mean deepest wave > 10%';
  const seeds = boonSeeds(d.seeds).filter((s) => d.runs[`boon-none-s${s}`]);
  if (!seeds.length) return { name: 'Boon cap', pass: false, skipped: 'no baseline', value: '—', target, notes: '' };
  const base = mean(seeds.map((s) => d.runs[`boon-none-s${s}`].deepestCleared));
  const rows: { id: string; raise: number; depth: number }[] = [];
  for (const b of BOONS) {
    const rs = seeds.map((s) => d.runs[`boon-${b.id}-s${s}`]).filter(Boolean);
    if (!rs.length) continue;
    const depth = mean(rs.map((r) => r.deepestCleared));
    rows.push({ id: b.id, raise: depth / Math.max(1, base) - 1, depth });
  }
  if (!rows.length) return { name: 'Boon cap', pass: false, skipped: 'no forced runs', value: '—', target, notes: '' };
  rows.sort((a, b) => b.raise - a.raise || (a.id < b.id ? -1 : 1));
  const over = rows.filter((r) => r.raise > 0.1);
  const H = round(d.runs[`boon-none-s${seeds[0]}`].simSeconds / 3600, 2);
  const fmt = (r: { id: string; raise: number; depth: number }): string => `${r.id} ${r.raise >= 0 ? '+' : ''}${pct(r.raise, 1)} (${round(r.depth, 1)})`;
  const placebo = placeboRaise(d, seeds, rows);
  return { name: 'Boon cap', pass: over.length === 0, value: `max ${rows[0].raise >= 0 ? '+' : ''}${pct(rows[0].raise)} (${rows[0].id}); baseline depth ${round(base, 1)}`,
    target, notes: `generalist idle, ${H} sim-h, seeds ${seeds.join(',')}, ${rows.length} boons; top five: ${rows.slice(0, 5).map(fmt).join(', ')}; over cap: ${over.map(fmt).join(', ') || 'none'}; `
      + `${placebo ? `noise floor ${placebo}; ` : ''}all: ${rows.map(fmt).join(', ')}` };
}

/**
 * The measurement's noise floor: boons whose `needs` (a hardpoint or element) the Generalist's final build lacks in
 * every forced run do nothing for it (bar the +0.25% Codex entry a pick records), so their raise is chaos at the walls.
 */
function placeboRaise(d: AcceptData, seeds: number[], rows: { id: string; raise: number }[]): string {
  const idle: string[] = [];
  for (const b of BOONS) {
    if (!b.needs || !b.needs.length || b.needs.includes('fusion')) continue;
    const rs = seeds.map((s) => d.runs[`boon-${b.id}-s${s}`]).filter(Boolean);
    const met = (r: RunResult): boolean => b.needs!.every((n) => r.build.hardpoints.includes(n as never) || r.build.attunements.includes(n as never));
    if (rs.length && !rs.some(met)) idle.push(b.id);
  }
  const rs = rows.filter((r) => idle.includes(r.id));
  if (!rs.length) return '';
  return `${pct(mean(rs.map((r) => r.raise)), 1)} mean over ${rs.length} boons the build never uses (${rs.map((r) => r.id).join(', ')})`;
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

/** Quick mode cannot measure these: replace the row with a SKIP (full mode is unchanged). */
const QUICK_SKIPS: Record<string, string> = {
  'First wall': 'needs full run: quick climbs end before the first Prestige (recommended ~29 min of play)',
  Forecast: 'needs full run: quick climbs end before the first Prestige',
  'Checkpoint time': 'needs full run: quick climbs end before the first Prestige',
  'Active edge': 'needs full run: one seed and a handful of attempts is too few to judge',
  'Directive gap': 'needs full run: one seed and a handful of attempts is too few to judge',
};

export function evaluate(d: AcceptData): AcceptRow[] {
  const rows = evaluateAll(d);
  if (d.mode !== 'quick') return rows;
  return rows.map((r) => (QUICK_SKIPS[r.name] ? { ...r, pass: false, skipped: QUICK_SKIPS[r.name], notes: `not judged in quick mode (measured: ${r.value})` } : r));
}

function evaluateAll(d: AcceptData): AcceptRow[] {
  return [
    testCheckpointOdds(d), testCheckpointTime(d), testFirstWall(d), testReclimb(d), testPush(d), testForecast(d),
    testBuildHealth(d), testDoctrineHealth(d), testSpendEfficiency(d), testDefense(d), testActiveEdge(d), testDirectiveGap(d),
    testFormationFairness(d), testAnomalyCap(d), testBoonCap(d), testOffline(d), testDeterminism(d),
  ];
}

export async function runAcceptance(opts: AcceptOptions): Promise<AcceptReport> {
  const data = await gather(opts);
  return { rows: evaluate(data), data };
}

