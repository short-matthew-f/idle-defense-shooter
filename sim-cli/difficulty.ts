/**
 * Formation Difficulty Multiplier measurement (design §12, §19).
 *
 * For every launch template × archetype × 10-wave band:
 *  1. Archetype build at the band's probe wave w = 10·band + 7 (never a boss or pre-boss wave):
 *     a real climb of the archetype's agent (Ballistics → pure primary, no hardpoints or
 *     attunements, Multishot; elements →
 *     that element's focused probe; hardpoints → the hardpoint agent), snapshotted with
 *     `sim.save()` the first time it reaches wave w (purchases scripted by the agent, so the build
 *     has the chassis, Doctrines, exotics and Anomalies a real player of that archetype would).
 *     Bands the archetype's climb never reaches are reported as "not reached".
 *     The tower is made unkillable (`stats.override` max HP 1e9, regeneration 0) and effective
 *     damage taken is measured instead; it is normalized by the build's real max HP.
 *  2. Wave: `generateWave` is pure and the template's layout function is private, so the WaveDef
 *     comes from searching Prestige seeds until `generateWave(seed, w)` picks that template
 *     (`seedsPerCell` hits, default 2). The generator spends budget / median(template); every
 *     spawn's hpScale is multiplied by median(template) so all templates face equal Threat Budget
 *     (radial_ring's median is 1). Templates the generator never produces at w (excluded by
 *     `isFair`, or minWave > w) are reported as not live.
 *  3. The WaveDef is injected into the run machine (world.wave / cursor / phase = combat) and the
 *     Sim steps until the wave clears or `maxWaveSeconds`.
 *  4. Multiplier M = sqrt(timeRatio · damageRatio) against radial_ring for the same build, where
 *     damageRatio = (1 + dmg/maxHp) / (1 + dmgRadial/maxHp).
 *
 * Output: sim-out/difficulty.json with every cell, the per-band tables, the median over bands per
 * template × archetype, deltas vs the seeded tables in data/formations.ts, and the §12 rule-2
 * fairness check (max archetype ≤ 1.5 × median) per band.
 */
import { Sim } from '../src/sim/index';
import type { WaveDef, SaveState } from '../src/sim/core/types';
import type { FormationId } from '../src/sim/core/ids';
import { NO_ENTITY, TICK_RATE } from '../src/sim/core/types';
import { generateWave } from '../src/sim/enemies/generator';
import { FORMATIONS, FORMATION_BY_ID, ARCHETYPES, medianDifficulty, type Archetype } from '../src/sim/data/formations';
import { Climber, instrument, newSim } from './runner';
import { median, round, tagSystem } from './metrics';

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

export function probeWave(band: number): number { return 10 * band + 7; }


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

/** Agent whose climb defines each archetype's build. */
export const ARCH_AGENT: Record<Archetype, string> = {
  ballistics: 'pure_ballistics', fire: 'doctrine:fire.inferno', lightning: 'doctrine:lightning.chain',
  poison: 'doctrine:poison.venom', frost: 'doctrine:frost.shatter',
  ordnance: 'hp_ordnance', drones: 'hp_drones', blade: 'hp_blade', laser: 'hp_laser', gravitics: 'hp_gravitics',
};
export const ARCH_SEED = 11;

export interface ArchetypeSnapshots { archetype: Archetype; agent: string; saves: Record<string, SaveState | null>; reached: number; wallSeconds: number }

/** Climb the archetype's agent and snapshot the build the first time it reaches each band's probe wave. */
export function archetypeClimb(archetype: Archetype, bands: number[], maxSimSeconds = 4 * 3600): ArchetypeSnapshots {
  const t0 = performance.now();
  const agent = ARCH_AGENT[archetype];
  const cfg = { seed: ARCH_SEED, agent: agent as never, policy: 'idle' as const, maxSimSeconds, hashes: false, name: `arch-${archetype}` };
  const sim = newSim(cfg);
  const c = new Climber(sim, cfg);
  const want = [...bands].sort((x, y) => x - y).map((b) => ({ b, w: probeWave(b) }));
  const saves: Record<string, SaveState | null> = {};
  for (const x of want) saves[String(x.b)] = null;
  let k = 0;
  c.onTick = () => {
    const run = sim.world.run;
    while (k < want.length && run.phase === 'between' && run.wave >= want[k].w) { saves[String(want[k].b)] = sim.save(); k++; }
    return k >= want.length;
  };
  const r = c.run();
  return { archetype, agent, saves, reached: r.deepestCleared, wallSeconds: (performance.now() - t0) / 1000 };
}

/** Inject `def` as the live wave and run it. */
export function runInjectedWave(save: SaveState, def: WaveDef, maxSeconds: number, archetype?: string): { seconds: number; towerDamage: number; cleared: boolean; share: number; maxHp: number } {
  const sim = new Sim(structuredClone(save));
  const w = sim.world, m = sim.machine;
  const maxHp = w.tower.maxHp;
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
  acc.dmg.clear();
  const max = Math.round(maxSeconds * TICK_RATE);
  let t = 0;
  for (; t < max && w.run.phase === 'combat'; t++) sim.step();
  let mine = 0, all = 0;
  for (const [tag, v] of acc.dmg) { all += v; if (archetype && tagSystem(tag) === archetype) mine += v; }
  return { seconds: t / TICK_RATE, towerDamage: acc.tower, cleared: w.run.phase !== 'combat', share: all > 0 ? mine / all : 0, maxHp };
}

export interface DiffJob { archetype: Archetype; band: number; opts: DiffOptions; save: SaveState | null; agent: string }
export interface DiffJobResult { cells: DiffCell[]; notLive: string[]; note: string; share: number }

/** All templates for one (archetype, band): the unit of parallel work. */
export function runDiffJob(job: DiffJob): DiffJobResult {
  const { archetype, band, opts, save } = job;
  const w = probeWave(band);
  if (!save) return { cells: [], notLive: [], note: `${job.agent} never reached wave ${w}`, share: NaN };
  const templates = (opts.templates ?? FORMATIONS.filter((f) => !f.spatial).map((f) => f.id)).filter((t) => FORMATION_BY_ID[t].minWave <= w);
  const raw: { t: FormationId; seconds: number; dmg: number; cleared: boolean; seeds: number[] }[] = [];
  const notLive: string[] = [];
  let shareSum = 0, shareN = 0, maxHp = 1;
  for (const t of templates) {
    const waves = templateWaves(t, w, opts.seedsPerCell);
    if (waves.length === 0) { notLive.push(t); continue; }
    let s = 0, d = 0, c = true;
    for (const { def } of waves) {
      const r = runInjectedWave(save, def, opts.maxWaveSeconds, archetype);
      s += r.seconds; d += r.towerDamage; c = c && r.cleared; shareSum += r.share; shareN++; maxHp = r.maxHp;
    }
    raw.push({ t, seconds: s / waves.length, dmg: d / waves.length, cleared: c, seeds: waves.map((x) => x.seed) });
  }
  const base = raw.find((r) => r.t === 'radial_ring');
  const cells: DiffCell[] = raw.map((r) => {
    const timeRatio = base ? r.seconds / Math.max(1e-6, base.seconds) : NaN;
    const dmgRatio = base ? (1 + r.dmg / maxHp) / (1 + base.dmg / maxHp) : NaN;
    return { template: r.t, archetype, band, wave: w, seeds: r.seeds, clearSeconds: round(r.seconds, 2), towerDamage: round(r.dmg, 1), cleared: r.cleared,
      timeRatio: round(timeRatio, 3), dmgRatio: round(dmgRatio, 3), mult: round(Math.sqrt(timeRatio * dmgRatio), 3) };
  });
  const share = shareN ? shareSum / shareN : NaN;
  const uncleared = cells.filter((c) => !c.cleared).length;
  const note = `${job.agent} build (max HP ${Math.round(maxHp)}): ${archetype} deals ${round(share * 100, 0)}% of damage${uncleared ? `; ${uncleared} template(s) hit the ${opts.maxWaveSeconds} s cap` : ''}`;
  return { cells, notLive, note, share };
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

/** Phase 2 jobs: one per (archetype, band), carrying the archetype's snapshot for that band. */
export function difficultyJobs(opts: DiffOptions, snaps: ArchetypeSnapshots[]): DiffJob[] {
  const out: DiffJob[] = [];
  for (const band of opts.bands) for (const archetype of opts.archetypes) {
    const sn = snaps.find((x) => x.archetype === archetype);
    out.push({ archetype, band, opts, save: sn?.saves[String(band)] ?? null, agent: sn?.agent ?? ARCH_AGENT[archetype] });
  }
  return out;
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
