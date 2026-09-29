/**
 * Prestige (design §3, §4, §14) and the per-tick progression bookkeeping.
 *
 * Commands (dispatched from run/commands.ts):
 *  - `prestige {frame, blueprint?, threatDial?, keepsake?, discountTree?}`: pays prestigeEchoes(w)
 *    (economy/prestige.ts), prestigeCount++, records, then a fresh run at wave 1 with
 *    prestigeSeed = combineSeed(oldSeed, prestigeCount). Scrap, upgrades, Cores and Anomalies are
 *    cleared except the Keepsake (Prestige II). Frame must be unlocked; a blueprint overrides the
 *    frame and plans Hardpoints / Attunements / Doctrines (auto-applied as slots and forks open),
 *    Targeting Profiles and the Upgrade Queue. Threat Dial needs `prestige.threat_dial` (0..10,
 *    0..20 from Ascension IV); Branch Discount needs `prestige.branch_discount`.
 *    Run start (also for Ascension and Trials): Anomaly sockets, Seed Capital Scrap, Memory of
 *    Steel / Motion ranks (build.ranks of ballistics.damage / attack_speed).
 *  - `set_threat_dial`: lower only; run.minThreatDial remembers the lowest level (Echoes pay at it).
 *  - `save_blueprint`: up to `prestige.blueprint_slots` ranks (same name overwrites).
 *  - `choose_doctrine {second: true}`: the tree's second doctrine where allowed.
 *  - `buy_prestige`: economy/prestige.buyPrestige, then slots reopen.
 *
 * ProgressionSystem (registered in systems/index.ts, last): Codex scan of new events, checkpoint
 * bookkeeping (Checkpoint Dividend, checkpoint times, Forecast samples), Forecast Scrap tracking,
 * Trial tiers and rewards, Anomaly socket count, second-doctrine cleanup, blueprint auto-mounts,
 * Accelerated Clearing speed, Singularity Core enemy HP ×1.5, fastest wave 100 record.
 */
import type { RunMachine } from './machine';
import type { WorldImpl } from '../core/world-impl';
import type { World } from '../core/world';
import type { System } from '../core/system';
import type { Blueprint, BuildState, Command, MetaState, RunState } from '../core/types';
import type { AnomalyId, DoctrineId, FrameId, HardpointId, TreeId } from '../core/ids';
import { Ev } from '../core/types';
import { newBuild, newRun, newTower } from './state';
import { updateSlots } from './slots';
import { combineSeed } from '../math/prng';
import { frameDef } from '../core/content';
import { chooseDoctrine, doctrineChoice } from '../economy/shop';
import {
  autoSpeed, buyPrestige, frameUnlocked, maxThreatDial, prank, prestigeEchoes, socketCount, trialHas,
  TRIAL_FRAMES, unlockFrames,
} from '../economy/prestige';
import { scanCodexEvent } from '../economy/codex';
import { resetForecastTracker, sampleForecast, trackScrap, SAMPLE_EVERY_TICKS } from '../economy/forecast';
import { TRIALS } from '../data/index';

// ---------------------------------------------------------------------------
// Installing a run (Prestige, Ascension, Trials)
// ---------------------------------------------------------------------------
/** Swap in `run`/`build`, reseed (or restore) the combat PRNG, re-init systems and begin an attempt. */
export function installRun(m: RunMachine, run: RunState, build: BuildState, prngState: [number, number, number, number] | null, countAttempt: boolean, prep?: () => void): void {
  const w = m.w;
  w.clearCombat();
  w.wave = null;
  w.run = run; w.build = build;
  w.stats.bind(build, w.meta);
  if (prngState) w.prng.setState(prngState); else w.prng.reseed(run.prestigeSeed ^ 0x5eed);
  Object.assign(w.tower, newTower());
  m.draftRerolls = 0;
  resetForecastTracker(w);
  prep?.();
  w.rebuildStats();
  for (const s of w.systems) s.init(w);
  m.startAttempt(countAttempt);
}

export interface FreshOpts { dial?: number; keep?: AnomalyId | null; bp?: Blueprint; discountTree?: TreeId | null }

/** Start a brand-new run (wave 1) on `frame` with the Prestige I start bonuses. */
export function startFresh(m: RunMachine, seed: number, frame: FrameId, opts: FreshOpts): void {
  const w = m.w;
  const run = newRun(seed), build = newBuild(frame);
  run.threatDial = run.minThreatDial = opts.dial ?? 0;
  run.discountTree = opts.discountTree ?? null;
  run.checkpointSeconds = [];
  if (opts.keep) build.anomalies.push(opts.keep);
  if (opts.bp) applyBlueprint(w.meta, run, build, opts.bp);
  installRun(m, run, build, null, true, () => applyRunStart(w));
}

/** Prestige I start bonuses and socket count (after stats are bound to the new build). */
export function applyRunStart(w: WorldImpl): void {
  const s = w.stats, b = w.build;
  b.anomalySockets = socketCount(w.meta);
  w.run.scrap += Math.max(0, Math.floor(s.get('economy.start_scrap')));
  const steel = Math.floor(s.get('prestige.memory_of_steel') + 1e-9);
  const motion = Math.floor(s.get('prestige.memory_of_motion') + 1e-9);
  if (steel > 0) b.ranks['ballistics.damage'] = Math.max(b.ranks['ballistics.damage'] | 0, steel);
  if (motion > 0) b.ranks['ballistics.attack_speed'] = Math.max(b.ranks['ballistics.attack_speed'] | 0, motion);
}

function applyBlueprint(meta: MetaState, run: RunState, build: BuildState, bp: Blueprint): void {
  const free = frameDef(build.frame).freeMount;
  run.plannedHardpoints = bp.hardpoints.filter((h, i, a) => h !== free && a.indexOf(h) === i);
  run.plannedAttunements = bp.attunements.filter((e, i, a) => a.indexOf(e) === i);
  run.plannedDoctrines = { ...bp.doctrines };
  build.targeting = { ...bp.targeting };
  meta.upgradeQueue = bp.upgradeQueue.map((r) => ({ ...r, ...(r.keepWithin ? { keepWithin: { ...r.keepWithin } } : {}) }));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
export function doPrestige(m: RunMachine, cmd: Extract<Command, { type: 'prestige' }>): string | null {
  const w = m.w, meta = w.meta, old = w.run;
  if (w.trial) return 'Finish or leave the Trial first';
  let frame = cmd.frame;
  let bp: Blueprint | undefined;
  if (cmd.blueprint !== undefined) {
    bp = meta.blueprints[cmd.blueprint];
    if (!bp) return 'No such blueprint';
    frame = bp.frame;
  }
  if (!frameUnlocked(meta, frame)) return 'Frame locked';
  let dial = 0;
  if (cmd.threatDial !== undefined && cmd.threatDial !== 0) {
    if (prank(meta, 'prestige.threat_dial') <= 0) return 'Threat Dial locked (Prestige III)';
    if (!(cmd.threatDial >= 0) || cmd.threatDial > maxThreatDial(meta)) return 'Threat Dial out of range';
    dial = Math.floor(cmd.threatDial);
  }
  if (cmd.discountTree && prank(meta, 'prestige.branch_discount') <= 0) return 'Branch Discount locked';
  let keep: AnomalyId | null = null;
  if (cmd.keepsake) {
    if (prank(meta, 'prestige.keepsake') <= 0) return 'Keepsake locked';
    if (!w.build.anomalies.includes(cmd.keepsake)) return 'The Keepsake must be socketed';
    keep = cmd.keepsake;
  } else if (prank(meta, 'prestige.keepsake') > 0 && meta.keepsake && w.build.anomalies.includes(meta.keepsake)) keep = meta.keepsake;

  const echoes = prestigeEchoes(w);
  meta.echoes += echoes;
  meta.prestigeCount += 1;
  if (old.deepestCleared > meta.deepestEver) meta.deepestEver = old.deepestCleared;
  if (old.deepestCleared > meta.records.deepestWave) meta.records.deepestWave = old.deepestCleared;
  if (old.longestChain > meta.records.longestChain) meta.records.longestChain = old.longestChain;
  meta.lastRunCheckpointSeconds = [...(old.checkpointSeconds ?? [])];
  meta.keepsake = keep;
  w.emit(Ev.Prestige, frame, echoes, meta.prestigeCount, 0, 0, -1);
  startFresh(m, combineSeed(old.prestigeSeed, meta.prestigeCount), frame, { dial, keep, bp, discountTree: cmd.discountTree ?? null });
  return null;
}

export function setThreatDial(w: WorldImpl, level: number): string | null {
  const run = w.run;
  if (!(level >= 0) || level >= run.threatDial) return 'The Threat Dial can only be lowered mid-run';
  run.threatDial = Math.floor(level);
  run.minThreatDial = Math.min(run.minThreatDial ?? run.threatDial, run.threatDial);
  return null;
}

export function saveBlueprint(w: WorldImpl, bp: Blueprint): string | null {
  const meta = w.meta, slots = prank(meta, 'prestige.blueprint_slots');
  if (slots <= 0) return 'Blueprint Slots locked (Prestige II)';
  const copy: Blueprint = JSON.parse(JSON.stringify(bp)) as Blueprint;
  const at = meta.blueprints.findIndex((b) => b.name === copy.name);
  if (at >= 0) { meta.blueprints[at] = copy; return null; }
  if (meta.blueprints.length >= slots) return 'No free blueprint slot';
  meta.blueprints.push(copy);
  return null;
}

export function chooseDoctrineCmd(w: WorldImpl, tree: TreeId, doctrine: DoctrineId, second?: boolean): string | null {
  if (second) {
    if (!w.build.doctrines[tree]) return 'Choose the first Doctrine first';
    if (w.build.secondDoctrines[tree]) return 'Second Doctrine already chosen';
    if (!w.stats.secondDoctrineAllowed(tree)) return 'This tree cannot run a second Doctrine';
  }
  return chooseDoctrine(w, tree, doctrine);
}

export function buyPrestigeNode(w: WorldImpl, id: string): string | null {
  const err = buyPrestige(w, id);
  if (!err) { updateSlots(w); autoMountPlanned(w); }
  return err;
}

/** Trial hardpoint rules: Bare Metal none, Hive Mind drones only, Siege Mentality blade only. */
export function trialForbidsMount(w: WorldImpl, sys: HardpointId): boolean {
  const t = w.trial;
  if (trialHas(t, 'no_hardpoints')) return true;
  if (trialHas(t, 'drones_only') && sys !== 'drones') return true;
  if (trialHas(t, 'blade_only') && sys !== 'blade') return true;
  return false;
}

/** Pre-dispatch checks for rules WP8 owns (Blackout / Commander live in systems/abilities.ts). */
export function commandGuard(w: WorldImpl, cmd: Command): string | null {
  if ((cmd.type === 'mount_hardpoint' || cmd.type === 'refit_hardpoint') && trialForbidsMount(w, cmd.system)) return 'Not allowed in this Trial';
  return null;
}

/** Mount planned hardpoints / attunements into open empty slots and choose planned doctrines. */
export function autoMountPlanned(w: WorldImpl): boolean {
  const run = w.run, b = w.build, s = w.stats;
  let changed = false;
  const ph = run.plannedHardpoints;
  if (ph && ph.length) {
    for (let k = 0; k < run.hardpointSlotsOpen; k++) {
      if (b.hardpoints[k]) continue;
      const sys = ph.find((h) => !b.hardpoints.includes(h) && !s.mounted(h) && !trialForbidsMount(w, h));
      if (!sys) break;
      b.hardpoints[k] = sys; changed = true;
      w.emit(Ev.Mounted, sys, k, 0, 0, 0, -1);
    }
  }
  const pa = run.plannedAttunements;
  if (pa && pa.length) {
    for (let k = 0; k < run.attunementSlotsOpen; k++) {
      if (b.attunements[k]) continue;
      const el = pa.find((e) => !b.attunements.includes(e));
      if (!el) break;
      b.attunements[k] = el; changed = true;
      w.emit(Ev.Attuned, el, k, 0, 0, 0, -1);
    }
  }
  if (changed) w.rebuildStats();
  const pd = run.plannedDoctrines;
  if (pd) {
    for (const tree of Object.keys(pd) as TreeId[]) {
      const doc = pd[tree];
      if (!doc || b.doctrines[tree] || !s.treeActive(tree)) continue;
      const c = doctrineChoice(w, tree, doc);
      if (c.locked || c.cost > 0 || c.second) continue;
      if (!chooseDoctrine(w, tree, doc)) changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// ProgressionSystem
// ---------------------------------------------------------------------------
function maxEnemyGen(w: WorldImpl): number {
  let g = 0;
  const e = w.enemies;
  for (let i = 0; i < e.count; i++) if (e.gen[i] > g) g = e.gen[i];
  return g;
}

export class ProgressionSystem implements System {
  readonly id = 'progression';
  private lastEvent = 0;
  private lastEnemyGen = 0;
  private statsVersion = -1;

  init(world: World): void {
    const w = world as WorldImpl;
    this.lastEvent = w.events.nextId;
    this.lastEnemyGen = maxEnemyGen(w);
    this.statsVersion = -1;
  }
  rebuild(): void { /* reads stats lazily */ }

  update(world: World): void {
    const w = world as WorldImpl, run = w.run;
    // 1. new events: Codex, checkpoints, records
    const end = w.events.nextId;
    let codexNew = false;
    w.events.forEachSince(this.lastEvent, (e) => {
      if (e.id >= end) return;
      if (scanCodexEvent(w, e)) codexNew = true;
      if (e.type === Ev.Checkpoint) this.onCheckpoint(w, e.a, e.id);
      else if (e.type === Ev.WaveClear && e.a === 100) {
        const r = w.meta.records;
        if (r.fastestWave100Seconds === null || run.playSeconds < r.fastestWave100Seconds) r.fastestWave100Seconds = run.playSeconds;
      }
    });
    this.lastEvent = end;
    if (codexNew) w.rebuildStats();
    // 2. Forecast
    trackScrap(w);
    if (run.tick > 0 && run.tick % SAMPLE_EVERY_TICKS === 0) sampleForecast(w);
    // 3. Trials
    if (w.trial) this.trialTiers(w);
    // 4. sockets / second doctrines when stats change
    if (w.stats.version !== this.statsVersion) {
      const b = w.build;
      const sc = socketCount(w.meta);
      if (b.anomalySockets < sc) b.anomalySockets = sc;
      let drop = false;
      for (const t of Object.keys(b.secondDoctrines) as TreeId[]) {
        if (b.secondDoctrines[t] && !w.stats.secondDoctrineAllowed(t)) { delete b.secondDoctrines[t]; drop = true; }
      }
      if (drop) w.rebuildStats();
      this.statsVersion = w.stats.version;
    }
    // 5. blueprint plan
    if (run.tick % 30 === 0) autoMountPlanned(w);
    // 6. Singularity Core: enemies +50% HP
    const e = w.enemies;
    let g = this.lastEnemyGen;
    const boost = w.stats.frameFlag('enemy_hp_plus_50');
    for (let i = 0; i < e.count; i++) {
      const gi = e.gen[i];
      if (gi <= this.lastEnemyGen) continue;
      if (gi > g) g = gi;
      if (boost) { e.hp[i] *= 1.5; e.maxHp[i] *= 1.5; e.shield[i] *= 1.5; e.maxShield[i] *= 1.5; }
    }
    this.lastEnemyGen = g;
  }

  onWaveStart(world: World): void {
    const w = world as WorldImpl;
    const a = autoSpeed(w.run, w.meta);   // Accelerated Clearing
    if (a > w.run.speedMultiplier) w.run.speedMultiplier = a;
  }

  private onCheckpoint(w: WorldImpl, wave: number, cause: number): void {
    const run = w.run, k = Math.floor(wave / 5);
    const cs = run.checkpointSeconds ?? (run.checkpointSeconds = []);
    while (cs.length <= k) cs.push(0);
    if (!cs[k]) cs[k] = run.playSeconds;
    const f = w.stats.get('prestige.checkpoint_dividend');
    if (f > 0 && w.waveScrap > 0) {
      const bonus = w.waveScrap * f;
      w.addScrap(bonus);
      w.emit(Ev.ScrapGain, 'checkpoint_dividend', wave, bonus, 0, 0, cause);
    }
    sampleForecast(w);
  }

  private trialTiers(w: WorldImpl): void {
    const id = w.trial!, meta = w.meta;
    const def = TRIALS.find((t) => t.id === id);
    if (!def) return;
    const cur = meta.trials[id] ?? 0;
    let tier = cur;
    while (tier < 3 && w.run.deepestCleared >= def.tiers[tier]) tier++;
    if (tier <= cur) return;
    meta.trials[id] = tier;
    w.emit(Ev.Codex, `trial.${id}`, tier, 0, 0, 0, -1);
    if (cur === 0) { const f = TRIAL_FRAMES[id]; if (f) unlockFrames(meta, [f]); }
    w.rebuildStats();
  }
}
