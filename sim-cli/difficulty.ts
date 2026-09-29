/**
 * Formation Difficulty Multiplier measurement (design §12, §19).
 *
 * For every launch template × archetype × 10-wave band:
 *  1. Archetype build at the band's probe wave w = 10·band + 7 (never a boss or pre-boss wave):
 *     a fresh Sim with the archetype's system mounted / element attuned, a Scrap budget of
 *     `scrapBudget(w)` (first-clear Scrap of waves 1..w × BUDGET_MUL, see below), spent cheapest-first — 60% in the archetype's
 *     tree and 40% in Ballistics (100% Ballistics for the Ballistics archetype) with the
 *     archetype's default Doctrine. The tower is made unkillable (`stats.override` max HP 1e9,
 *     regeneration 0) and effective damage taken is measured instead.
 *  2. Wave: `generateWave` is pure and the template's layout function is private, so the WaveDef
 *     comes from searching Prestige seeds until `generateWave(seed, w)` picks that template
 *     (`seedsPerCell` hits, default 2). The generator spends budget / median(template); every
 *     spawn's hpScale is multiplied by median(template) so all templates face equal Threat Budget
 *     (radial_ring's median is 1). Templates the generator never produces at w (excluded by
 *     `isFair`, or minWave > w) are reported as not live.
 *  3. The WaveDef is injected into the run machine (world.wave / cursor / phase = combat) and the
 *     Sim steps until the wave clears or `maxWaveSeconds`.
 *  4. Multiplier M = sqrt(timeRatio · damageRatio) against radial_ring for the same build, where
 *     damageRatio = (dmg + ε) / (dmgRadial + ε), ε = 5 grunt contact hits at w.
 *
 * Output: sim-out/difficulty.json with every cell, the per-band tables, the median over bands per
 * template × archetype, deltas vs the seeded tables in data/formations.ts, and the §12 rule-2
 * fairness check (max archetype ≤ 1.5 × median) per band.
 */
import { Sim } from '../src/sim/index';
import type { WaveDef, SaveState } from '../src/sim/core/types';
import type { DoctrineId, ElementId, FormationId, HardpointId, TreeId } from '../src/sim/core/ids';
import { NO_ENTITY, TICK_RATE } from '../src/sim/core/types';
import { generateWave } from '../src/sim/enemies/generator';
import { FORMATIONS, FORMATION_BY_ID, ARCHETYPES, medianDifficulty, type Archetype } from '../src/sim/data/formations';
import { ENEMY_BY_KIND } from '../src/sim/data/enemies';
import { scrapPerKill, contactDamage } from '../src/sim/economy/curves';
import { applyCommand } from '../src/sim/run/commands';
import { buildShop } from '../src/sim/economy/shop';
import { entryKey } from './agents/base';
import { instrument } from './runner';
import { median, round } from './metrics';
import { BEST_LOOKING } from './agents/hardpoint';

export interface DiffCell {
  template: FormationId; archetype: Archetype; band: number; wave: number; seeds: number[];
  clearSeconds: number; towerDamage: number; cleared: boolean; timeRatio: number; dmgRatio: number; mult: number;
}
export interface DifficultyResult {
  config: DiffOptions;
  cells: DiffCell[];
  /** band → template → archetype → multiplier */
  bands: Record<string, Record<string, Record<string, number>>>;
  /** template → archetype → median over bands */
  median: Record<string, Record<string, number>>;
  /** template → archetype → measured median − seeded value */
  deltas: Record<string, Record<string, number>>;
  notLive: Record<string, string[]>;
  fairness: { band: number; template: string; max: number; median: number; ratio: number; worst: string; fair: boolean }[];
  archetypeNotes: Record<string, string>;
  wallSeconds: number;
}
export interface DiffOptions { bands: number[]; archetypes: Archetype[]; seedsPerCell: number; maxWaveSeconds: number; templates?: FormationId[] }

export const FULL_DIFF: DiffOptions = { bands: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], archetypes: [...ARCHETYPES], seedsPerCell: 2, maxWaveSeconds: 150 };
export const QUICK_DIFF: DiffOptions = { bands: [0, 2], archetypes: ['ballistics', 'fire', 'ordnance'], seedsPerCell: 1, maxWaveSeconds: 90 };

const ARCH_DOCTRINE: Record<string, DoctrineId> = {
  ballistics: 'multishot', fire: 'inferno', lightning: 'chain', poison: 'venom', frost: 'shatter', ...BEST_LOOKING,
};
const HARDPOINTS = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];
const ELEMENTS = ['fire', 'lightning', 'poison', 'frost'];

export function probeWave(band: number): number { return 10 * band + 7; }

const budgetCache = new Map<number, number>();
/**
 * Build budget at wave w: first-clear Scrap of waves 1..w (×3, from the generator's spawns for
 * seed 1) × BUDGET_MUL. The multiplier accounts for repeat-clear income from failed attempts; it is
 * calibrated to the idle Generalist, whose total spend on first reaching a wave is ≈ 6× the
 * first-clear sum.
 */
export const BUDGET_MUL = 6;
export function scrapBudget(w: number): number {
  const c = budgetCache.get(w);
  if (c !== undefined) return c;
  let s = 0;
  for (let v = 1; v <= w; v++) {
    const def = generateWave(1, v, 0, 0);
    for (const sp of def.spawns) s += scrapPerKill(v, ENEMY_BY_KIND[sp.kind]?.scrapMul ?? 1) * 3;
  }
  s *= BUDGET_MUL;
  budgetCache.set(w, s);
  return s;
}

/** Waves of `template` at wave w: up to n WaveDefs from different seeds (equal-budget normalized). */
const waveCache = new Map<string, { seed: number; def: WaveDef }[]>();
export function templateWaves(template: FormationId, w: number, n: number, searchSeeds = 1500): { seed: number; def: WaveDef }[] {
  const key = `${template}@${w}`;
  const hit = waveCache.get(key);
  if (hit && hit.length >= n) return hit.slice(0, n);
  const out: { seed: number; def: WaveDef }[] = [];
  const med = medianDifficulty(FORMATION_BY_ID[template]);
  for (let s = 1; s <= searchSeeds && out.length < n; s++) {
    const def = generateWave(s, w, 0, 0);
    if (def.formation !== template) continue;
    for (const sp of def.spawns) sp.hpScale *= med;
    out.push({ seed: s, def });
  }
  waveCache.set(key, out);
  return out;
}

/** Spend `scrap` cheapest-first within `tree`, taking the archetype Doctrine when the fork opens. */
function spendIn(sim: Sim, tree: string, scrap: number, doctrine: DoctrineId | undefined): void {
  const w = sim.world;
  w.run.scrap = scrap;
  for (let guard = 0; guard < 2000; guard++) {
    const shop = buildShop(w);
    const doc = shop.find((e) => e.kind === 'doctrine' && e.tree === tree && !e.locked && e.cost === 0 && !w.build.doctrines[tree as TreeId]);
    if (doc) {
      const want = doctrine && shop.some((e) => e.node === `${tree}.${doctrine}`) ? doctrine : (doc.node.slice(tree.length + 1) as DoctrineId);
      applyCommand(sim.machine, { type: 'choose_doctrine', tree: tree as TreeId, doctrine: want });
      continue;
    }
    let best = null as null | { node: string; cost: number };
    for (const e of shop) {
      if (e.currency !== 'scrap' || e.locked || e.kind === 'doctrine' || e.kind === 'ability') continue;
      if (entryKey(e) !== tree) continue;
      if (e.cost <= w.run.scrap && (!best || e.cost < best.cost)) best = e;
    }
    if (!best || applyCommand(sim.machine, { type: 'buy', node: best.node })) break;
  }
  w.run.scrap = 0;
}

/** Archetype build at probe wave w, returned as a save (restore per template). */
export function archetypeSave(arch: Archetype, w: number): { save: SaveState; note: string } {
  const sim = new Sim(null, 0xd1ff);
  const W = sim.world;
  let note = '';
  if (HARDPOINTS.includes(arch)) { W.run.hardpointSlotsOpen = 1; W.build.hardpoints = [arch as HardpointId]; }
  if (ELEMENTS.includes(arch)) { W.run.attunementSlotsOpen = 1; W.build.attunements = [arch as ElementId]; }
  W.rebuildStats();
  const budget = scrapBudget(w);
  if (arch === 'ballistics') spendIn(sim, 'ballistics', budget, 'multishot');
  else {
    spendIn(sim, arch, budget * 0.6, ARCH_DOCTRINE[arch]);
    spendIn(sim, 'ballistics', budget * 0.4, 'multishot');
  }
  const spent = W.run.spentByTree[arch] ?? 0;
  if (arch !== 'ballistics' && spent < budget * 0.05) note = `only ${Math.round(spent)} of ${Math.round(budget * 0.6)} Scrap could be spent in ${arch}`;
  return { save: sim.save(), note };
}

/** Inject `def` as the live wave and run it. */
export function runInjectedWave(save: SaveState, def: WaveDef, maxSeconds: number): { seconds: number; towerDamage: number; cleared: boolean } {
  const sim = new Sim(structuredClone(save));
  const w = sim.world, m = sim.machine;
  w.stats.override('bastion.max_hp', 1e9);
  w.stats.override('bastion.regeneration', 0);
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  const acc = instrument(w);
  w.clearCombat();
  w.run.wave = def.wave;
  w.wave = def;
  m.cursor = 0; m.bossIndex = NO_ENTITY;
  w.run.waveTick = 0; w.waveScrap = 0; w.waveKills = 0;
  m.setPhase('combat');
  for (const s of w.systems) s.onWaveStart?.(w);
  acc.tower = 0;
  const max = Math.round(maxSeconds * TICK_RATE);
  let t = 0;
  for (; t < max && w.run.phase === 'combat'; t++) sim.step();
  return { seconds: t / TICK_RATE, towerDamage: acc.tower, cleared: w.run.phase !== 'combat' };
}

export interface DiffJob { archetype: Archetype; band: number; opts: DiffOptions }
export interface DiffJobResult { cells: DiffCell[]; notLive: string[]; note: string }

/** All templates for one (archetype, band): the unit of parallel work. */
export function runDiffJob(job: DiffJob): DiffJobResult {
  const { archetype, band, opts } = job;
  const w = probeWave(band);
  const { save, note } = archetypeSave(archetype, w);
  const eps = contactDamage(ENEMY_BY_KIND.grunt.contactDamage, w) * 5;
  const templates = (opts.templates ?? FORMATIONS.filter((f) => !f.spatial).map((f) => f.id)).filter((t) => FORMATION_BY_ID[t].minWave <= w);
  const raw: { t: FormationId; seconds: number; dmg: number; cleared: boolean; seeds: number[] }[] = [];
  const notLive: string[] = [];
  for (const t of templates) {
    const waves = templateWaves(t, w, opts.seedsPerCell);
    if (waves.length === 0) { notLive.push(t); continue; }
    let s = 0, d = 0, c = true;
    for (const { def } of waves) { const r = runInjectedWave(save, def, opts.maxWaveSeconds); s += r.seconds; d += r.towerDamage; c = c && r.cleared; }
    raw.push({ t, seconds: s / waves.length, dmg: d / waves.length, cleared: c, seeds: waves.map((x) => x.seed) });
  }
  const base = raw.find((r) => r.t === 'radial_ring');
  const cells: DiffCell[] = raw.map((r) => {
    const timeRatio = base ? r.seconds / Math.max(1e-6, base.seconds) : NaN;
    const dmgRatio = base ? (r.dmg + eps) / (base.dmg + eps) : NaN;
    return { template: r.t, archetype, band, wave: w, seeds: r.seeds, clearSeconds: round(r.seconds, 2), towerDamage: round(r.dmg, 1), cleared: r.cleared,
      timeRatio: round(timeRatio, 3), dmgRatio: round(dmgRatio, 3), mult: round(Math.sqrt(timeRatio * dmgRatio), 3) };
  });
  return { cells, notLive, note };
}

/** Aggregate job results into the DifficultyResult tables. */
export function aggregateDifficulty(opts: DiffOptions, jobs: { job: DiffJob; res: DiffJobResult }[], wallSeconds: number): DifficultyResult {
  const cells = jobs.flatMap((j) => j.res.cells);
  const bands: DifficultyResult['bands'] = {};
  for (const c of cells) {
    const b = (bands[String(c.band)] ??= {});
    (b[c.template] ??= {})[c.archetype] = c.mult;
  }
  const medianT: DifficultyResult['median'] = {}, deltas: DifficultyResult['deltas'] = {};
  const byTA = new Map<string, number[]>();
  for (const c of cells) if (Number.isFinite(c.mult)) { const k = `${c.template}|${c.archetype}`; const a = byTA.get(k) ?? []; a.push(c.mult); byTA.set(k, a); }
  for (const [k, v] of byTA) {
    const [t, a] = k.split('|');
    const m = round(median(v), 3);
    (medianT[t] ??= {})[a] = m;
    const seeded = FORMATION_BY_ID[t as FormationId].difficulty[a] ?? 1;
    (deltas[t] ??= {})[a] = round(m - seeded, 3);
  }
  const fairness: DifficultyResult['fairness'] = [];
  for (const b of Object.keys(bands)) {
    for (const [t, row] of Object.entries(bands[b])) {
      const vals = Object.entries(row).filter(([, v]) => Number.isFinite(v));
      if (vals.length < 2) continue;
      const med = median(vals.map(([, v]) => v));
      let worst = '', max = -Infinity;
      for (const [a, v] of vals) if (v > max) { max = v; worst = a; }
      fairness.push({ band: Number(b), template: t, max: round(max, 3), median: round(med, 3), ratio: round(max / med, 3), worst, fair: max <= 1.5 * med });
    }
  }
  const notLive: Record<string, string[]> = {};
  const archetypeNotes: Record<string, string> = {};
  for (const { job, res } of jobs) {
    if (res.notLive.length) notLive[String(job.band)] = [...new Set([...(notLive[String(job.band)] ?? []), ...res.notLive])];
    if (res.note) archetypeNotes[`${job.archetype}@${job.band}`] = res.note;
  }
  return { config: opts, cells, bands, median: medianT, deltas, notLive, fairness, archetypeNotes, wallSeconds };
}

export function difficultyJobs(opts: DiffOptions): DiffJob[] {
  const out: DiffJob[] = [];
  for (const band of opts.bands) for (const archetype of opts.archetypes) out.push({ archetype, band, opts });
  return out;
}

/** Sequential convenience (tests / --quick). */
export function measureDifficulty(opts: DiffOptions): DifficultyResult {
  const t0 = performance.now();
  const jobs = difficultyJobs(opts).map((job) => ({ job, res: runDiffJob(job) }));
  return aggregateDifficulty(opts, jobs, (performance.now() - t0) / 1000);
}

export function difficultyMarkdown(d: DifficultyResult): string {
  const archs = d.config.archetypes;
  const lines = ['# Formation Difficulty Multipliers (measured)', '',
    `bands ${d.config.bands.join(', ')} (probe wave 10·band+7), ${d.config.seedsPerCell} seed(s) per cell, cap ${d.config.maxWaveSeconds} s per wave; ${round(d.wallSeconds, 1)} s wall`, '',
    'Median over bands (measured / seeded delta):', '',
    `| template | ${archs.join(' | ')} | max/median |`, `| --- | ${archs.map(() => '---').join(' | ')} | --- |`];
  for (const t of Object.keys(d.median)) {
    const row = archs.map((a) => (d.median[t][a] === undefined ? '—' : `${d.median[t][a]} (${d.deltas[t][a] >= 0 ? '+' : ''}${d.deltas[t][a]})`));
    const vals = archs.map((a) => d.median[t][a]).filter((v) => v !== undefined && Number.isFinite(v));
    lines.push(`| ${t} | ${row.join(' | ')} | ${vals.length ? round(Math.max(...vals) / median(vals), 2) : '—'} |`);
  }
  const unfair = d.fairness.filter((f) => !f.fair);
  lines.push('', `Fairness (§12 rule 2, per band): ${unfair.length} of ${d.fairness.length} template-bands exceed 1.5× median.`, '');
  for (const f of unfair.slice(0, 30)) lines.push(`- band ${f.band} ${f.template}: ${f.worst} ${f.max} vs median ${f.median} (×${f.ratio})`);
  if (Object.keys(d.notLive).length) lines.push('', `Not generated at the probe wave: ${Object.entries(d.notLive).map(([b, ts]) => `band ${b}: ${ts.join(', ')}`).join('; ')}`);
  if (Object.keys(d.archetypeNotes).length) lines.push('', 'Archetype notes:', ...Object.entries(d.archetypeNotes).map(([k, v]) => `- ${k}: ${v}`));
  return lines.join('\n') + '\n';
}
