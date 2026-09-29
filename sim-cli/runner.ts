/**
 * Headless runner (WP10, design §19). Drives a `Sim` at maximal speed with a purchase agent and a
 * player policy and records per-wave / per-checkpoint metrics.
 *
 *   runAttempt(cfg)            one Prestige climb (until the wall, a stop wave, the Prestige
 *                              recommendation, or the sim-time cap) → RunResult
 *   runPrestige(cfg, n)        n consecutive Prestiges in one Sim via the `prestige` command, with
 *                              Echoes spent between runs → PrestigeChainResult
 *
 * Instrumentation (no src edits): the runner wraps two WorldImpl instance methods —
 * `recordShare` (every damage number that feeds UiState.stats, i.e. world.damageShare) to keep exact
 * per-wave damage by srcTag, and `damageTower` to measure effective tower damage taken. Both wrappers
 * only observe; they never change sim behavior, so hashes are identical with or without them.
 *
 * Time: `simSeconds` = ticks / 60. `playSeconds` divides each tick by run.speedMultiplier (×2/×4/×8
 * on solved waves), i.e. the player's wall-clock; pacing metrics (minutes per checkpoint, Echo
 * rate) use playSeconds.
 */
import { Sim } from '../src/sim/index';
import type { WorldImpl } from '../src/sim/core/world-impl';
import type { AnomalyId, FrameId } from '../src/sim/core/ids';
import type { MetaState, SaveState } from '../src/sim/core/types';
import { Ev, TICK_RATE } from '../src/sim/core/types';
import { Prng, combineSeed, hashString } from '../src/sim/math/prng';
import { applyCommand } from '../src/sim/run/commands';
import { echoesFor, nodeCost } from '../src/sim/economy/curves';
import { nodeInfo } from '../src/sim/core/content';
import { PRESTIGE_NODES } from '../src/sim/data/index';
import { makeAgent } from './agents/index';
import { makeCtx, totalSpent, type Agent, type AgentCtx } from './agents/base';
import { makePolicy, type Policy } from './policies';
import type { CheckpointRecord, EchoSample, OfflineResult, PrestigeChainResult, RunConfig, RunResult, WaveRecord } from './types';

export const DEFAULTS = { maxSimSeconds: 4 * 3600, wallMinutes: 40 } as const;

interface Acc { dmg: Map<string, number>; tower: number }

/** Wrap WorldImpl.recordShare / damageTower on this instance (observation only). */
export function instrument(w: WorldImpl): Acc {
  const acc: Acc = { dmg: new Map(), tower: 0 };
  const anyW = w as unknown as Record<string, unknown> & { __wp10?: Acc };
  if (anyW.__wp10) return anyW.__wp10;
  anyW.__wp10 = acc;
  const rs = anyW.recordShare as ((tag: string, dmg: number) => void) | undefined;
  if (typeof rs === 'function') {
    anyW.recordShare = function (tag: string, dmg: number): void { acc.dmg.set(tag, (acc.dmg.get(tag) ?? 0) + dmg); rs.call(w, tag, dmg); };
  }
  const dt = w.damageTower;
  w.damageTower = function (amount: number, enemy: number, cause: number): void {
    const t = w.tower;
    const b = Math.max(0, t.hp) + t.shield + t.barrier + t.tempHp;
    dt.call(w, amount, enemy, cause);
    const a = Math.max(0, t.hp) + t.shield + t.barrier + t.tempHp;
    if (b > a) acc.tower += b - a;
  };
  return acc;
}

function addInto(dst: Record<string, number>, src: Map<string, number> | Record<string, number>): void {
  if (src instanceof Map) { for (const [k, v] of src) dst[k] = (dst[k] ?? 0) + v; }
  else for (const k in src) dst[k] = (dst[k] ?? 0) + src[k];
}

export function agentSeed(seed: number, agent: string): number { return combineSeed(seed, hashString(agent)); }

export function newSim(cfg: RunConfig): Sim {
  let sim: Sim;
  if (cfg.prestigeMeta) {
    const base: SaveState = new Sim(null, cfg.seed).save();
    base.meta = structuredClone(cfg.prestigeMeta);
    sim = new Sim(base);
  } else sim = new Sim(null, cfg.seed);
  const w = sim.world;
  if (cfg.frame && cfg.frame !== w.build.frame) { w.build.frame = cfg.frame; w.rebuildStats(); }
  if (cfg.threatDial) w.run.threatDial = cfg.threatDial;
  if (cfg.mode === 'patrol') applyCommand(sim.machine, { type: 'set_mode', mode: 'patrol' });
  return sim;
}

/** One climb (a Prestige's worth of play) on an existing Sim. */
export class Climber {
  readonly sim: Sim;
  readonly cfg: RunConfig;
  readonly agent: Agent;
  readonly policy: Policy;
  readonly ctx: AgentCtx;
  private acc: Acc;
  private waves = new Map<number, WaveRecord>();
  private checkpoints: CheckpointRecord[] = [];
  private echo: EchoSample[] = [];
  private damage: Record<string, number> = {};
  private towerDamage = 0;
  private notes: string[] = [];
  private anomalies: string[] = [];
  private casts = 0; private tells = 0; private counters = 0; private bossCounters = 0;
  private eventMark = 0;
  private playSeconds = 0;
  private lastCpAt = 0;
  private fightWave = 0;
  private fightStart = 0;
  private earnMark = 0; private spendMark = 0;
  private forecastPresent = false;
  private forecastRec: { wave: number; seconds: number } | null = null;
  private computedRec: { wave: number; seconds: number } | null = null;
  private peak: { wave: number; seconds: number; rate: number } | null = null;
  private belowSince: number | null = null;
  private forcedDone = false;
  private echoMul = 1;

  /** Optional per-tick observer (after each step); return true to stop the climb. */
  onTick: ((c: Climber) => boolean | void) | null = null;

  constructor(sim: Sim, cfg: RunConfig, agent?: Agent, policy?: Policy) {
    this.sim = sim; this.cfg = cfg;
    this.agent = agent ?? makeAgent(cfg.agent);
    this.agent.setDoctrineOverrides(cfg.doctrineOverrides);
    if (cfg.forceAnomaly && cfg.forceAnomaly !== 'skip') this.agent.keepAnomaly = cfg.forceAnomaly;
    this.policy = policy ?? makePolicy(cfg.policy);
    this.ctx = makeCtx(sim, new Prng(agentSeed(cfg.seed, cfg.agent)), cfg.policy);
    this.acc = instrument(sim.world);
  }

  private rec(wave: number): WaveRecord {
    let r = this.waves.get(wave);
    if (!r) {
      r = { wave, boss: wave % 5 === 0, attemptsToClear: 0, fights: 0, deaths: 0, secondsToClear: null, clearFightSeconds: null, firstReachAt: this.playSeconds,
        firstClearAt: null, scrapEarned: 0, scrapSpent: 0, towerDamage: 0, damageBySrc: {}, hash: null, formation: null };
      this.waves.set(wave, r);
    }
    return r;
  }

  private flush(r: WaveRecord): void {
    const w = this.sim.world;
    addInto(r.damageBySrc, this.acc.dmg); addInto(this.damage, this.acc.dmg);
    this.acc.dmg.clear();
    r.towerDamage += this.acc.tower; this.towerDamage += this.acc.tower; this.acc.tower = 0;
    const spent = totalSpent(w);
    r.scrapEarned += w.scrapEarned - this.earnMark; r.scrapSpent += Math.max(0, spent - this.spendMark);
    this.earnMark = w.scrapEarned; this.spendMark = spent;
  }

  private onPhase(prev: string, cur: string): void {
    const w = this.sim.world, run = w.run;
    if (cur === 'combat') {
      const r = this.rec(run.wave);
      r.fights++;
      if (r.firstClearAt === null) r.attemptsToClear++;
      if (!r.formation && w.wave) r.formation = w.wave.formation;
      this.fightWave = run.wave; this.fightStart = run.tick;
      return;
    }
    if (prev !== 'combat') return;
    const r = this.rec(this.fightWave);
    this.flush(r);
    if (cur === 'wave_clear' || cur === 'draft') {
      if (r.firstClearAt === null) {
        r.firstClearAt = this.playSeconds;
        r.secondsToClear = this.playSeconds - r.firstReachAt;
        r.clearFightSeconds = (run.tick - this.fightStart) / TICK_RATE;
        if (this.cfg.hashes !== false) r.hash = this.sim.events.hash();
        this.sampleEcho(false);
      }
    } else if (cur === 'dead') r.deaths++;
  }

  private onCheckpoint(cp: number): void {
    const run = this.sim.world.run;
    // attemptsPerCheckpoint[k] counts attempts *started* from checkpoint 5k. The attempt that cleared
    // the previous boss continues into this segment, so it is attempt #1 here (except from wave 0,
    // where the opening attempt is already counted).
    const k = cp / 5 - 1;
    const started = run.attemptsPerCheckpoint[k] ?? 0;
    const attempts = k === 0 ? Math.max(1, started) : started + 1;
    this.checkpoints.push({ checkpoint: cp, attempts, bossFights: this.waves.get(cp)?.attemptsToClear ?? 0,
      minutes: (this.playSeconds - this.lastCpAt) / 60, at: this.playSeconds });
    this.lastCpAt = this.playSeconds;
  }

  private sampleEcho(withForecast: boolean): void {
    const w = this.sim.world, run = w.run;
    const hours = Math.max(1e-6, this.playSeconds / 3600);
    const base = echoesFor(run.deepestCleared, run.threatDial);
    const s: EchoSample = { seconds: Math.round(this.playSeconds), deepest: run.deepestCleared, echoes: base, rate: 0 };
    if (withForecast) {
      const f = this.sim.uiState().forecast;
      if (f) {
        this.forecastPresent = true;
        s.forecastRate = f.echoRate; s.recommended = f.recommended;
        // the game's own Echo count (Echo multipliers, Codex bonus) → scale the curve formula by it
        if (base > 0 && f.echoesNow > 0) this.echoMul = f.echoesNow / base;
        if (f.recommended && !this.forecastRec) this.forecastRec = { wave: run.deepestCleared, seconds: this.playSeconds };
      }
    }
    s.echoes = Math.floor(base * this.echoMul);
    const rate = s.echoes / hours;
    s.rate = rate;
    if (rate > 0 && (!this.peak || rate > this.peak.rate)) this.peak = { wave: run.deepestCleared, seconds: this.playSeconds, rate };
    // Computed rule (§3): rate ≥ 15% below its peak for one full checkpoint cycle.
    if (this.peak && rate <= 0.85 * this.peak.rate) {
      if (this.belowSince === null) this.belowSince = this.playSeconds;
      const cps = this.checkpoints.map((c) => c.minutes * 60).sort((a, b) => a - b);
      const cycle = Math.max(300, cps.length ? cps[cps.length >> 1] : 600);
      if (!this.computedRec && this.playSeconds - this.belowSince >= cycle) this.computedRec = { wave: this.peakWaveBefore(), seconds: this.playSeconds };
    } else this.belowSince = null;
    this.echo.push(s);
  }
  /** The recommendation is "Prestige now": the depth reached when it fires. */
  private peakWaveBefore(): number { return this.sim.world.run.deepestCleared; }

  private scanEvents(): void {
    const ev = this.sim.events;
    if (ev.nextId - this.eventMark > ev.capacity) this.notes.push(`event ring overflow at tick ${this.sim.world.run.tick}`);
    ev.forEachSince(this.eventMark, (e) => {
      switch (e.type) {
        case Ev.Cast: this.casts++; break;
        case Ev.BossTell: this.tells++; break;
        case Ev.CounterScored: this.counters++; break;
        case Ev.BossCounter: this.bossCounters++; break;
        case Ev.AnomalyPicked: this.anomalies.push(e.src); break;
        default: break;
      }
    });
    this.eventMark = ev.nextId;
  }

  run(): RunResult {
    const sim = this.sim, cfg = this.cfg;
    const w = sim.world;
    const maxSec = cfg.maxSimSeconds ?? DEFAULTS.maxSimSeconds;
    const wallSec = (cfg.wallMinutes ?? DEFAULTS.wallMinutes) * 60;
    const maxTicks = Math.round(maxSec * TICK_RATE);
    this.eventMark = sim.events.nextId;
    this.earnMark = w.scrapEarned; this.spendMark = totalSpent(w);
    const t0 = performance.now();
    let prevPhase: string = w.run.phase;
    let prevCp = w.run.checkpoint;
    let stop: RunResult['stopReason'] = 'max_time';
    let n = 0;
    const agent = this.agent, policy = this.policy, ctx = this.ctx;
    if (prevPhase === 'combat') this.onPhase('between', 'combat');
    for (; n < maxTicks; n++) {
      const run = w.run;
      if (cfg.forceAnomaly && run.pendingDraft && !this.forcedDone) {
        this.forcedDone = true;
        if (cfg.forceAnomaly === 'skip') { if (applyCommand(sim.machine, { type: 'pick_anomaly', anomaly: null })) this.notes.push('forced skip rejected'); }
        else run.pendingDraft = [cfg.forceAnomaly as AnomalyId];
      }
      agent.tick(ctx);
      policy.tick(sim);
      sim.step();
      this.playSeconds += 1 / (TICK_RATE * (w.run.speedMultiplier || 1));
      const r2 = w.run;
      if (r2.phase !== prevPhase) { this.onPhase(prevPhase, r2.phase); prevPhase = r2.phase; }
      if (r2.checkpoint !== prevCp) { if (r2.checkpoint > prevCp) this.onCheckpoint(r2.checkpoint); prevCp = r2.checkpoint; }
      if ((n & 63) === 0) this.scanEvents();
      if (n % 3600 === 3599) {
        this.sampleEcho(true);
        if (cfg.stopAtRecommendation && (this.forecastPresent ? this.forecastRec : this.computedRec)) { stop = 'recommended'; n++; break; }
      }
      if (cfg.stopAtWave && r2.deepestCleared >= cfg.stopAtWave) { stop = 'stop_wave'; n++; break; }
      if (this.onTick && this.onTick(this)) { stop = 'stop_wave'; n++; break; }
      if (cfg.mode !== 'patrol' && this.playSeconds - this.lastCpAt > wallSec) { stop = 'wall'; n++; break; }
    }
    if (cfg.mode === 'patrol' && stop === 'max_time') stop = 'patrol_done';
    if (prevPhase === 'combat') this.flush(this.rec(this.fightWave));
    this.scanEvents();
    const wallMs = performance.now() - t0;
    const b = w.build;
    const { prestigeMeta, ...cfgRest } = cfg;
    const result: RunResult = {
      name: cfg.name ?? `${cfg.agent}-${cfg.policy}-s${cfg.seed}`,
      config: { ...cfgRest, ...(prestigeMeta ? { prestigeMeta: `prestigeCount=${prestigeMeta.prestigeCount}` } : {}) },
      agent: cfg.agent, policy: cfg.policy, seed: cfg.seed, frame: b.frame,
      deepestCleared: w.run.deepestCleared, checkpoint: w.run.checkpoint, attempts: w.run.attempts,
      simSeconds: n / TICK_RATE, playSeconds: this.playSeconds, wallSeconds: wallMs / 1000, ticks: n, ticksPerSecond: n / Math.max(1e-6, wallMs / 1000),
      stopReason: stop, walled: stop === 'wall', wallWave: stop === 'wall' ? w.run.deepestCleared : null,
      waves: [...this.waves.values()].sort((a, c) => a.wave - c.wave),
      checkpoints: this.checkpoints,
      spendByTree: { ...w.run.spentByTree },
      damageBySrc: this.damage, towerDamage: this.towerDamage, scrapEarned: w.scrapEarned,
      echoCurve: this.echo, forecastRecommended: this.forecastRec, computedRecommended: this.computedRec, echoPeak: this.peak,
      forecastPresent: this.forecastPresent,
      build: { hardpoints: [...b.hardpoints], attunements: [...b.attunements], doctrines: { ...b.doctrines }, anomalies: [...b.anomalies], purchases: ctx.purchases },
      anomaliesPicked: this.anomalies,
      casts: this.casts, tells: this.tells, counters: Math.max(this.counters, this.bossCounters), designations: policy.stats.designations,
      noops: { ...policy.stats.noops },
      finalHash: sim.events.hash(),
      notes: this.notes,
    };
    this.result = result;
    return result;
  }
  result: RunResult | null = null;
  /** Play seconds elapsed in this climb. */
  get elapsed(): number { return this.playSeconds; }
}

/** One Prestige climb from a fresh game (or `cfg.prestigeMeta`). */
export function runAttempt(cfg: RunConfig): RunResult {
  return new Climber(newSim(cfg), cfg).run();
}

// ---------------------------------------------------------------------------
// Prestige chain
// ---------------------------------------------------------------------------
const ECHO_PRIORITY = [
  'prestige.scrap_resonance', 'prestige.memory_of_steel', 'prestige.memory_of_motion', 'prestige.hardened_core',
  'prestige.accelerated_clearing', 'prestige.seed_capital', 'prestige.boss_bounty', 'prestige.checkpoint_dividend',
  'prestige.weapon_seed', 'prestige.elemental_memory', 'prestige.autocast', 'prestige.frames', 'prestige.early_hardpoints',
  'prestige.third_attunement', 'prestige.anomaly_socket', 'prestige.directives', 'prestige.third_tactical_slot',
  'prestige.speed_controls', 'prestige.long_patrol', 'prestige.directive_tuning',
];

/** Spend Echoes cheapest-first over a sensible priority list. Returns nodes bought. */
export function spendEchoes(sim: Sim): string[] {
  const w = sim.world, bought: string[] = [];
  const known = new Set(PRESTIGE_NODES.map((p) => p.id));
  // priority list first (cheapest-first within it), then every other node in data order
  const order = [...ECHO_PRIORITY, ...PRESTIGE_NODES.map((p) => p.id).filter((id) => !ECHO_PRIORITY.includes(id))];
  const blocked = new Set<string>();
  for (let guard = 0; guard < 2000; guard++) {
    let best: string | null = null, bestCost = Infinity;
    for (const id of order) {
      if (!known.has(id) || blocked.has(id)) continue;
      const info = nodeInfo(id);
      if (!info) continue;
      const r = w.meta.prestigeRanks[id] | 0;
      if (r >= info.def.maxRank) continue;
      const c = nodeCost(info.def, r).cost;
      if (c <= w.meta.echoes && c < bestCost) { bestCost = c; best = id; }
    }
    if (!best) break;
    const before = w.meta.echoes;
    const err = applyCommand(sim.machine, { type: 'buy_prestige', node: best });
    if (err || w.meta.echoes === before) { blocked.add(best); continue; }
    bought.push(best);
  }
  return bought;
}

/**
 * n Prestiges in one Sim: climb until the recommendation (Forecast, else the computed Echo-rate
 * rule) or the wall, send `prestige`, spend Echoes, repeat. If `prestige` has no effect
 * (not implemented yet), returns implemented=false after the first run.
 */
export function runPrestige(cfg: RunConfig, n: number): PrestigeChainResult {
  const sim = newSim(cfg);
  const agent = makeAgent(cfg.agent);
  const policy = makePolicy(cfg.policy);
  const out: PrestigeChainResult = { name: cfg.name ?? `chain-${cfg.agent}-${cfg.policy}-s${cfg.seed}`, implemented: true, runs: [], notes: [] };
  for (let i = 0; i < n; i++) {
    agent.reset(); policy.reset();
    const c = new Climber(sim, { ...cfg, name: `${out.name}-p${i + 1}`, stopAtRecommendation: true }, agent, policy);
    out.runs.push(c.run());
    if (i === n - 1) break;
    const w = sim.world;
    const before = w.meta.prestigeCount, deep = w.run.deepestCleared, echoesBefore = w.meta.echoes;
    const frames = w.meta.unlockedFrames as FrameId[];
    const pref = (agent as { preferredFrame?: FrameId }).preferredFrame;
    const frame: FrameId = pref && frames.includes(pref) ? pref : (cfg.frame ?? 'standard');
    const err = applyCommand(sim.machine, { type: 'prestige', frame });
    sim.step();
    if (err || (w.meta.prestigeCount === before && sim.world.run.deepestCleared >= deep && deep > 0)) {
      out.implemented = false;
      out.notes.push(`prestige command had no effect (${err ?? 'no state change'}); chain stopped after run ${i + 1}`);
      break;
    }
    const bought = spendEchoes(sim);
    out.notes.push(`prestige ${i + 1} (run stopped: ${out.runs[i].stopReason}): deepest ${deep}, echoes +${sim.world.meta.echoes - echoesBefore + 0} (bank ${Math.floor(sim.world.meta.echoes)}), bought ${bought.length} nodes`);
  }
  return out;
}

/**
 * Offline test (§19): climb normally to a checkpoint, then Patrol for `patrolSeconds` with no
 * purchases (a boss must never be fought), measuring online Patrol Scrap/hour; then send
 * `offline_return` for one hour and compare the credited Scrap with the online rate.
 */
function w0(sim: Sim): WorldImpl { return sim.world; }

export function runOffline(cfg: RunConfig, patrolSeconds = 1800): OfflineResult {
  const notes: string[] = [];
  const sim = newSim({ ...cfg, mode: 'push' });
  // Climb until the four waves after a checkpoint are cleared (Patrol then loops solved waves only,
  // as it does after a failed boss attempt; first-clear ×3 income would otherwise inflate the rate).
  new Climber(sim, { ...cfg, mode: 'push', hashes: false, maxSimSeconds: cfg.maxSimSeconds ?? 3600, stopAtWave: cfg.stopAtWave ?? 19 }).run();
  if (w0(sim).run.deepestCleared % 5 === 0) notes.push(`climb ended on a boss wave (${w0(sim).run.deepestCleared}); Patrol covers uncleared waves`);
  const w = sim.world;
  applyCommand(sim.machine, { type: 'set_mode', mode: 'patrol' });
  const cp0 = w.run.checkpoint;
  // Online rate over whole Patrol loops: from the first wave clear to the last one (the same kind of
  // window the run machine measures run.patrolScrapPerSecond over).
  let bossFights = 0, prev = w.run.phase, t = 0;
  let firstClear: { t: number; e: number } | null = null, lastClear: { t: number; e: number } | null = null;
  const total = Math.round(patrolSeconds * TICK_RATE);
  for (; t < total; t++) {
    sim.step();
    if (w.run.phase !== prev) {
      if (w.run.phase === 'combat' && w.run.wave % 5 === 0) bossFights++;
      if (prev === 'combat' && w.run.phase === 'wave_clear') { const c = { t, e: w.scrapEarned }; if (!firstClear) firstClear = c; lastClear = c; }
      prev = w.run.phase;
    }
  }
  const onlinePerHour = firstClear && lastClear && lastClear.t > firstClear.t ? (lastClear.e - firstClear.e) / ((lastClear.t - firstClear.t) / TICK_RATE) * 3600 : NaN;
  const before = w.run.scrap;
  const err = applyCommand(sim.machine, { type: 'offline_return', elapsedSeconds: 3600 });
  if (err) notes.push(`offline_return: ${err}`);
  const offline = w.run.scrap - before;
  return { patrolSeconds, bossWavesFought: bossFights, checkpointsSet: w.run.checkpoint - cp0, onlineScrapPerHour: onlinePerHour,
    measuredPatrolRatePerSecond: w.run.patrolScrapPerSecond, offlineScrapPerHour: offline, ratio: onlinePerHour > 0 ? offline / onlinePerHour : NaN, notes };
}

export type { MetaState };
