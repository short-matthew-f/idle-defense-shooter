/**
 * Sim: the facade every consumer (worker, headless CLI, tests) uses. See core/sim-api.ts.
 *
 * Tick order (ARCHITECTURE.md "Tick order"):
 *   commands → run machine (phases, wave start) → scheduled spawns → statuses → enemy AI →
 *   spatial hash → SYSTEM_ORDER plugins → projectiles → hazards → tower upkeep/death →
 *   wave clear / death checks → pool compaction → clocks
 */
import type { ISim } from './core/sim-api';
import type { Command, RenderSnapshot, SaveState, SimEvent, UiState } from './core/types';
import type { System } from './core/system';
import { WorldImpl } from './core/world-impl';
import { Prng } from './math/prng';
import { StatusesSystem } from './systems/statuses';
import { TowerSystem } from './systems/tower';
import { SYSTEM_ORDER } from './systems/index';
import { aiStep } from './enemies/ai';
import { updateProjectiles } from './core/projectiles';
import { updateHazards } from './core/hazards';
import { RunMachine } from './run/machine';
import { applyCommand, applyPendingDoctrines } from './run/commands';
import { newBuild, newMeta, newRun, newTower } from './run/state';
import { fromSave, toSave } from './save/serialize';
import { SnapshotWriter, writeScene } from './core/snapshot';
import { buildUiState } from './core/ui-state';
import { Ev } from './core/types';
import { isBoonCommand } from './run/boons';

export interface SimOptions {
  /** Prestige seed for a new game (default 1). Ignored when loading a save. */
  seed?: number;
}

export class Sim implements ISim {
  readonly world: WorldImpl;
  readonly machine: RunMachine;
  readonly plugins: System[];
  readonly statuses = new StatusesSystem();
  readonly towerSystem = new TowerSystem();
  private queue: Command[] = [];
  private writer = new SnapshotWriter();
  private fxFrom = 0;
  private shake = 0;
  private shakeFrom = 0;
  /** Last rejection of a player-queued command (Directive / Autocast commands are not reported). */
  private lastErr: string | null = null;
  private lastErrCmd: Command['type'] | null = null;
  /** Systems that expose a per-command `lastError` (e.g. abilities: cast rejections). */
  private errorSystems: { lastError: string | null }[] = [];

  constructor(save: SaveState | null = null, seedOrOpts: number | SimOptions = 1) {
    const seed = typeof seedOrOpts === 'number' ? seedOrOpts : seedOrOpts.seed ?? 1;
    let world: WorldImpl;
    if (save) {
      const s = fromSave(save);
      const prng = new Prng(s.run.prestigeSeed);
      prng.setState(s.prngState);
      world = new WorldImpl(s.run, s.build, s.meta, newTower(), prng);
    } else {
      const run = newRun(seed);
      world = new WorldImpl(run, newBuild('standard'), newMeta(), newTower(), new Prng(run.prestigeSeed ^ 0x5eed));
    }
    this.world = world;
    this.plugins = SYSTEM_ORDER.map((f) => f());
    world.setSystems([this.statuses, ...this.plugins, this.towerSystem]);
    for (const s of world.systems) s.init(world);
    this.errorSystems = world.systems.filter((s) => 'lastError' in s) as unknown as { lastError: string | null }[];
    this.machine = new RunMachine(world);
    this.machine.startAttempt(!save, !!save);
  }

  static load(save: SaveState): Sim { return new Sim(save); }

  get events(): WorldImpl['events'] { return this.world.events; }
  get tick(): number { return this.world.run.tick; }

  command(cmd: Command): void { this.queue.push(cmd); }

  step(): void {
    const w = this.world, m = this.machine;
    if (this.queue.length) {
      const q = this.queue;
      this.queue = [];
      for (const c of q) this.applyPlayer(c);
    }
    if (w.pendingCommands.length) {   // WP9: Directive / Autocast commands, same dispatch path
      const q = w.pendingCommands;
      w.pendingCommands = [];
      for (const c of q) if (!isBoonCommand(c)) applyCommand(m, c);   // Boons are player-only: never from the sim's own queue
    }
    applyPendingDoctrines(m);   // UX Phase 2: Doctrine changes queued for the next checkpoint
    m.preTick();
    m.spawnScheduled();
    this.statuses.update(w);
    aiStep(w);
    w.rebuildSpatial();
    const ps = this.plugins;
    for (let k = 0; k < ps.length; k++) ps[k].update(w);
    updateProjectiles(w);
    updateHazards(w);
    this.towerSystem.update(w);
    m.postTick();
    w.endTick();
    m.advanceClock();
  }

  /** Apply a player command and remember why it was rejected (machine or any system's lastError). */
  private applyPlayer(c: Command): void {
    const es = this.errorSystems;
    for (let k = 0; k < es.length; k++) es[k].lastError = null;
    let err = applyCommand(this.machine, c);
    for (let k = 0; err === null && k < es.length; k++) err = es[k].lastError;
    if (err !== null) { this.lastErr = err; this.lastErrCmd = typeof c === 'object' && c !== null && typeof c.type === 'string' ? c.type : null; }
  }

  /**
   * The most recent rejection of a player command since the last call (then cleared), or null.
   * Collects run/commands.ts errors (machine.lastError) and system errors (abilities' lastError).
   * `lastErrorCommand` names the rejected command type; read it before taking the error.
   */
  takeLastError(): string | null {
    const e = this.lastErr;
    this.lastErr = null;
    return e;
  }
  get lastErrorCommand(): Command['type'] | null { return this.lastErrCmd; }

  /** Run n ticks (convenience for tests / headless). */
  run(n: number): void { for (let i = 0; i < n; i++) this.step(); }

  snapshot(): RenderSnapshot {
    const w = this.world;
    // camera shake: decays; tower hits since the last snapshot add to it
    this.shake *= 0.85;
    w.events.forEachSince(this.shakeFrom, (e: SimEvent) => { if (e.type === Ev.TowerHit) this.shake = Math.min(1, this.shake + e.b / Math.max(1, w.tower.maxHp) * 4); });
    this.shakeFrom = w.events.nextId;
    const snap = writeScene(w, this.writer, this.fxFrom, w.meta.settings.clarity, this.shake);
    this.fxFrom = w.events.nextId;
    return snap;
  }

  uiState(): UiState { return buildUiState(this.world, this.machine); }

  save(): SaveState { return toSave(this); }

  inspect(eventId: number): { chain: SimEvent[]; sentence: string } { return this.world.events.chain(eventId); }

  /** Most recent Kill event id for enemy (index, gen) still in the log, else the latest Hit on that index, else -1. */
  findDeathEvent(enemyIndex: number, gen: number): number {
    let hit = -1, kill = -1;
    this.world.events.forEachSince(0, (e) => {
      if (e.type === Ev.Kill && e.a === enemyIndex && e.b === gen) kill = e.id;
      else if (e.type === Ev.Hit && e.a === enemyIndex) hit = e.id;
    });
    return kill >= 0 ? kill : hit;
  }
}

export type { ISim } from './core/sim-api';
