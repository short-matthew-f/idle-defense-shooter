/**
 * Run state machine (design §2): attempts, waves, checkpoints, Push/Patrol, drafts.
 *
 *  between    2 s: +25% max HP heal (none on the first wave of an attempt: HP is already full), shopping
 *  combat     spawns scheduled by tick from generateWave(seed, wave, dial, ascension); ends when all
 *             spawns are out and no enemy is alive (→ wave_clear) or the tower dies (→ dead)
 *  wave_clear 1.5 s: first-clear bookkeeping (kills during a not-yet-cleared wave already paid ×3),
 *             checkpoint on boss waves (Ev.Checkpoint), slot opening, Anomaly draft on the first
 *             clear of waves 10, 20 … 100
 *  draft      (legacy phase, no longer entered) — drafts never block: the offer waits in run.pendingDraft
 *             while the run continues, and later draft waves queue in run.draftQueue
 *  dead       1.5 s, then a new attempt at checkpoint+1 with full HP and empty CE (attempts++)
 * Boons (run/boons.ts): every attempt start clears the active boons and any offer, then (except on the first
 * attempt of a Prestige, and in Patrol) opens the start-of-attempt offer; a save load keeps an undecided offer
 * the save carried instead. Every boss cleared in Push opens (or queues) another offer. Offers wait for the
 * player; nothing here ever picks one.
 * Push advances wave by wave; Patrol loops checkpoint+1 … checkpoint+4 and never fights a boss,
 * measuring run.patrolScrapPerSecond for offline returns. Until Patrol has measured it, every non-boss
 * Push clear re-estimates it from the last PATROL_ESTIMATE_CLEARS such clears (first-clear bonus removed).
 * Wave-100 gate (design §15, code-health M2): before Ascension V (deepWavesUnlocked) waves past 100 never
 * start. Once wave 100 is cleared, Push holds at wave 100 in `between` (the Ascend prompt) and Patrol loops
 * waves 96–99; a death or restart returns to the same place.
 * Past the enemy cap, grunt/swarm spawns merge into a Clump (hp summed, clumpCount).
 */
import type { WorldImpl } from '../core/world-impl';
import type { SpawnEntry } from '../core/types';
import { EnemyFlag, Ev, MAX_ENEMIES, NO_ENTITY, TICK_DT, TICK_RATE } from '../core/types';
import { generateWave } from '../enemies/generator';
import { spawnPosition } from '../enemies/formations';
import { Prng, waveSeed } from '../math/prng';
import { TAU, cos, sin } from '../math/lut';
import { enemyDef } from '../core/content';
import { enemyHp } from '../economy/curves';
import { betweenWaveHeal } from '../systems/tower';
import { updateSlots } from './slots';
import { rollDraft } from './draft';
import { clearBoons, offerForBossClear, openBoonOffer } from './boons';   // Boons
import { ASCENSION_WAVE, deepWavesUnlocked } from '../economy/ascension';
import { trialWave } from './trials';                 // WP8
import { trialHas } from '../economy/prestige';       // WP8
import { ARENA_RADIUS } from '../core/types';

export const PHASE_TICKS = { between: 2 * TICK_RATE, wave_clear: 1.5 * TICK_RATE, dead: 1.5 * TICK_RATE } as const;
/** Non-boss Push clears the offline Patrol estimate averages over (one checkpoint cycle: checkpoint+1..+4). */
export const PATROL_ESTIMATE_CLEARS = 4;
const CLUMP_MARGIN = 20;
const WAVE_OVERHEAD_S = (PHASE_TICKS.between + PHASE_TICKS.wave_clear) / TICK_RATE;
const SCR = new Float32Array(2);

export class RunMachine {
  w: WorldImpl;
  cursor = 0;
  bossIndex = NO_ENTITY;
  bossGen = 0;
  draftRerolls = 0;
  private clumpIndex = NO_ENTITY;
  private clumpGen = 0;
  private patrolScrap = 0;
  private patrolTicks = 0;
  private scrapMark = 0;
  /** Last command rejection reason (UI/tests). */
  lastError: string | null = null;

  constructor(w: WorldImpl) { this.w = w; }

  // -------------------------------------------------------------------------
  // Attempts
  // -------------------------------------------------------------------------
  /**
   * Begin an attempt at checkpoint+1 with full HP and empty CE. `countAttempt` is false when a save loads or a
   * Trial ends (the run resumes at its checkpoint as a fresh attempt without counting one).
   */
  startAttempt(countAttempt: boolean): void {
    const w = this.w, run = w.run, t = w.tower;
    // Boons: every attempt starts with no active boons. The pristine first attempt of a Prestige (new game,
    // Prestige, Ascension, Trial start) gets no offer; a save load keeps an offer the save carried (it was never
    // decided, and reloading must not reroll it); anything else (death, restart, Trial end) opens the start offer.
    const pristine = countAttempt && run.attempts === 0;
    const keepOffer = !countAttempt && !!run.boonOffer && run.boonOffer.length > 0;
    if (keepOffer) { w.build.boons = []; run.boonSpent = []; } else clearBoons(w);
    w.clearCombat();
    w.wave = null;
    this.cursor = 0; this.bossIndex = NO_ENTITY; this.clumpIndex = NO_ENTITY;
    run.wave = this.firstWave();
    run.attemptTick = 0; run.waveTick = 0;
    run.attemptDamageTaken = {};
    w.towerKiller = null;
    if (countAttempt) {
      run.attempts++;
      const k = Math.floor(run.checkpoint / 5);
      while (run.attemptsPerCheckpoint.length <= k) run.attemptsPerCheckpoint.push(0);
      run.attemptsPerCheckpoint[k]++;
    }
    updateSlots(w);
    w.rebuildStats();
    t.hp = t.maxHp; t.shield = t.maxShield; t.tempHp = 0; t.invulnT = 0; t.secondCoreUsed = false; t.ce = 0; t.lowHpTicks = 0;
    t.designated = NO_ENTITY; t.designated2 = NO_ENTITY;
    w.lastTowerDamageTick = run.tick;
    this.setPhase('between');
    w.emit(Ev.AttemptStart, 'run', run.wave, run.attempts, 0, 0, -1);
    for (const s of w.systems) s.onAttemptStart?.(w);
    if (!pristine && !keepOffer && run.mode === 'push') openBoonOffer(w, 'start', run.wave);   // Boons: a retry never starts weaker
  }

  setPhase(p: WorldImpl['run']['phase']): void { this.w.run.phase = p; this.w.run.phaseTicks = 0; }

  // -------------------------------------------------------------------------
  // Wave-100 gate (Deep Waves open at Ascension V)
  // -------------------------------------------------------------------------
  /** True when wave 100 has been cleared and waves past it are still locked (no Ascension V). */
  atDeepWaveGate(): boolean {
    const run = this.w.run;
    return run.deepestCleared >= ASCENSION_WAVE && !deepWavesUnlocked(this.w);
  }
  /** Checkpoint the Patrol loop hangs off: the real checkpoint, or 95 at the gate (loop 96–99). */
  private patrolBase(): number {
    const cp = this.w.run.checkpoint;
    return this.atDeepWaveGate() && cp >= ASCENSION_WAVE ? ASCENSION_WAVE - 5 : cp;
  }
  /** Wave an attempt starts on: checkpoint+1, or at the gate wave 100 (Push, held) / 96 (Patrol). */
  private firstWave(): number {
    const run = this.w.run;
    if (this.atDeepWaveGate() && run.checkpoint >= ASCENSION_WAVE) return run.mode === 'patrol' ? this.patrolBase() + 1 : ASCENSION_WAVE;
    return run.checkpoint + 1;
  }
  /** Push is parked at wave 100 in `between` until the player Ascends (or switches to Patrol). */
  heldAtGate(): boolean {
    const run = this.w.run;
    return run.mode === 'push' && run.wave >= ASCENSION_WAVE && this.atDeepWaveGate();
  }

  private enterBetween(): void {
    const w = this.w;
    this.setPhase('between');
    betweenWaveHeal(w);
    if (w.run.wave > w.meta.deepestEver) w.run.speedMultiplier = 1;
  }

  // -------------------------------------------------------------------------
  // Tick hooks (see Sim.step)
  // -------------------------------------------------------------------------
  preTick(): void {
    const w = this.w, run = w.run;
    switch (run.phase) {
      case 'between': if (run.phaseTicks >= PHASE_TICKS.between && !this.heldAtGate()) this.startWave(); break;
      case 'wave_clear':
        if (run.phaseTicks >= PHASE_TICKS.wave_clear) this.advanceWave();
        break;
      case 'draft': this.advanceWave(); break;   // legacy saves only
      case 'dead': if (run.phaseTicks >= PHASE_TICKS.dead) this.startAttempt(true); break;
      case 'combat': break;
    }
  }

  startWave(): void {
    const w = this.w, run = w.run;
    // WP8: Scatter Trial forces spread formations; Swarmstorm post-processes the wave (run/trials.ts)
    const wave = trialWave(w, generateWave(run.prestigeSeed, run.wave, run.threatDial, w.meta.ascension, { scatter: trialHas(w.trial, 'scatter') }));
    w.wave = wave;
    this.cursor = 0; this.bossIndex = NO_ENTITY; this.clumpIndex = NO_ENTITY;
    run.waveTick = 0;
    w.waveScrap = 0; w.waveKills = 0;
    w.tower.secondCoreUsed = false;
    const startId = w.emit(Ev.WaveStart, wave.sector, run.wave, wave.spawns.length, 0, 0, -1);
    if (wave.isBoss && !wave.spawns.some((s) => s.kind === 'boss')) {
      const a = new Prng(waveSeed(run.prestigeSeed, run.wave)).next() * TAU;
      const i = w.spawnEnemy('boss', cos(a) * ARENA_RADIUS, sin(a) * ARENA_RADIUS, { bossId: wave.bossId, hpScale: 1 + 0.12 * run.threatDial, cause: startId });
      if (i >= 0) { this.bossIndex = i; this.bossGen = w.enemies.gen[i]; }
    }
    this.setPhase('combat');
    for (const s of w.systems) s.onWaveStart?.(w);
  }

  /** Spawn every scheduled entry whose tick has come (combat only). */
  spawnScheduled(): void {
    const w = this.w, run = w.run, wave = w.wave;
    if (run.phase !== 'combat' || !wave) return;
    const spawns = wave.spawns;
    while (this.cursor < spawns.length && spawns[this.cursor].tick <= run.waveTick) {
      if (!this.spawnEntry(this.cursor, spawns[this.cursor])) break;   // at cap: wait
      this.cursor++;
    }
  }

  private spawnEntry(k: number, sp: SpawnEntry): boolean {
    const w = this.w, e = w.enemies, wave = w.wave!;
    spawnPosition(wave, sp, SCR);
    const x = SCR[0], y = SCR[1];
    const mergeable = sp.kind === 'swarm' || sp.kind === 'grunt';
    if (mergeable && e.count >= MAX_ENEMIES - CLUMP_MARGIN) { this.mergeIntoClump(sp, x, y); return true; }
    if (e.count >= MAX_ENEMIES) return false;
    // The generator folds Threat Dial and elite HP into hpScale; spawnEnemy adds Ascension HP and dial speed.
    const i = w.spawnEnemy(sp.kind, x, y, { hpScale: sp.hpScale, elite: sp.elite, bossId: sp.kind === 'boss' ? wave.bossId : null, cause: -1, eliteHpIncluded: true });
    if (i < 0) return false;
    e.spawnIdx[i] = k; e.formT[i] = 0;
    if (sp.kind === 'boss') { this.bossIndex = i; this.bossGen = e.gen[i]; }
    return true;
  }

  private mergeIntoClump(sp: SpawnEntry, x: number, y: number): void {
    const w = this.w, e = w.enemies;
    const def = enemyDef(sp.kind);
    const unitHp = enemyHp(w.run.wave, def.hpMul, w.meta.ascension) * sp.hpScale;
    let c = w.resolveEnemy(this.clumpIndex, this.clumpGen);
    if (c < 0) {
      c = w.spawnEnemy('clump', x, y, { cause: -1 });
      if (c < 0) return;
      this.clumpIndex = c; this.clumpGen = e.gen[c];
      e.hp[c] = e.maxHp[c] = unitHp; e.clumpCount[c] = 1;   // lint-allow causality: spawn-time (new Clump)
      e.scrapMul[c] = def.scrapMul; e.contact[c] = def.contactDamage; e.speed[c] = def.speed; e.shield[c] = e.maxShield[c] = 0;
      return;
    }
    e.hp[c] += unitHp; e.maxHp[c] += unitHp;   // lint-allow causality: a spawn merged into the Clump
    if (e.clumpCount[c] < 65535) e.clumpCount[c]++;
    e.radius[c] = Math.min(40, 12 + Math.sqrt(e.clumpCount[c]) * 2);
  }

  /** Death and wave-clear checks (after every system has run). */
  postTick(): void {
    const w = this.w, run = w.run;
    if (run.phase !== 'combat') return;
    if (w.tower.hp <= 0) { this.setPhase('dead'); return; }
    const wave = w.wave;
    if (!wave || this.cursor < wave.spawns.length) return;
    const e = w.enemies;
    for (let i = 0; i < e.count; i++) if ((e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally)) === 0) return;
    this.onWaveClear();
  }

  private onWaveClear(): void {
    const w = this.w, run = w.run, meta = w.meta;
    const wv = run.wave;
    const first = !run.firstClears[wv];
    if (wv >= run.firstClears.length) { const g = new Uint8Array(Math.max(wv + 1, run.firstClears.length * 2)); g.set(run.firstClears); run.firstClears = g; }
    if (first) { run.firstClears[wv] = 1; run.clearedWaves++; }
    if (wv > run.deepestCleared) run.deepestCleared = wv;
    if (wv > meta.deepestEver) meta.deepestEver = wv;
    if (wv > meta.records.deepestWave) meta.records.deepestWave = wv;
    if (run.longestChain > meta.records.longestChain) meta.records.longestChain = run.longestChain;
    const clearId = w.emit(Ev.WaveClear, w.wave?.sector ?? 'run', wv, w.waveScrap, 0, 0, -1);
    if (w.waveScrap > 0) w.emit(Ev.ScrapGain, first ? 'first_clear' : 'wave', wv, w.waveScrap, 0, 0, clearId);
    // Patrol rate: measured in Patrol; until then estimated from the recent non-boss Push clears
    // (without the first-clear bonus: Patrol replays), so an offline return pays something sensible
    // to players who never Patrol (UX review S7). Offline still pays only a fraction of it (economy/curves.ts).
    const waveSeconds = run.waveTick / TICK_RATE + WAVE_OVERHEAD_S;
    if (run.mode === 'patrol') {
      if (this.patrolTicks > 0) { run.patrolScrapPerSecond = this.patrolScrap / (this.patrolTicks / TICK_RATE); run.patrolMeasured = true; }
    } else if (wv % 5 !== 0 && waveSeconds > 0) {
      const log = run.recentClears ?? (run.recentClears = []);
      log.push({ wave: wv, scrap: w.waveScrap / (first ? Math.max(1, w.stats.get('economy.first_clear_mul')) : 1), seconds: waveSeconds });
      if (log.length > PATROL_ESTIMATE_CLEARS) log.shift();
      if (!run.patrolMeasured) run.patrolScrapPerSecond = patrolEstimate(log);
    }
    if (wv % 5 === 0 && run.mode === 'push' && wv > run.checkpoint) {
      run.checkpoint = wv;
      w.emit(Ev.Checkpoint, 'run', wv, run.attempts, 0, 0, clearId);
    }
    updateSlots(w);
    if (first && wv % 10 === 0 && wv <= 100) {
      const k = wv / 10;
      if (!run.anomaliesOfferedAt[k]) {
        run.anomaliesOfferedAt[k] = 1;
        if (run.pendingDraft && run.pendingDraft.length > 0) run.draftQueue.push(wv);   // decide the earlier one first
        else this.openDraft(wv);
      }
    }
    if (wv % 5 === 0) offerForBossClear(w, wv);   // Boons: every boss the tower clears (Push only; see run/boons.ts)
    for (const s of w.systems) s.onWaveEnd?.(w);
    this.setPhase('wave_clear');
  }

  /** Offer the draft for `wave` (three rolled cards); the player picks, skips or rerolls whenever they like. */
  private openDraft(wave: number): void {
    const run = this.w.run;
    this.draftRerolls = 0;
    const offers = rollDraft(this.w, wave, 0);
    if (offers.length > 0) { run.pendingDraft = offers; run.draftWave = wave; }
    else this.nextDraft();
  }

  /** After a draft resolves, bring up the next queued one (if any). */
  private nextDraft(): void {
    const run = this.w.run;
    run.pendingDraft = null;
    const next = run.draftQueue.shift();
    if (next !== undefined) this.openDraft(next);
  }

  advanceWave(): void {
    const w = this.w, run = w.run;
    w.wave = null;
    if (run.mode === 'patrol') {
      const next = run.wave + 1, base = this.patrolBase();
      run.wave = next > base + 4 || next <= base || next % 5 === 0 ? base + 1 : next;
    } else run.wave = this.atDeepWaveGate() && run.wave >= ASCENSION_WAVE ? ASCENSION_WAVE : run.wave + 1;   // held at the gate
    this.enterBetween();
  }

  /** Switch Push/Patrol. Entering Patrol on a boss wave (or beyond the loop) returns to checkpoint+1 without costing an attempt. */
  setMode(mode: 'push' | 'patrol'): void {
    const w = this.w, run = w.run;
    if (run.mode === mode) return;
    run.mode = mode;
    this.patrolScrap = 0; this.patrolTicks = 0; this.scrapMark = w.scrapEarned;
    const base = this.patrolBase();
    if (mode === 'patrol' && (run.wave % 5 === 0 || run.wave > base + 4) && run.phase !== 'dead') {
      w.clearCombat(); w.wave = null; this.cursor = 0; this.bossIndex = NO_ENTITY;
      run.wave = base + 1;
      this.setPhase('between');
    }
  }

  pickAnomaly(id: string | null, replace: number | undefined): string | null {
    const w = this.w, run = w.run;
    if (!run.pendingDraft) return 'No draft pending';
    if (id === null) {
      run.cores += 1;
      w.emit(Ev.AnomalyPicked, 'skip', 0, 1, 0, 0, -1);
    } else {
      if (!run.pendingDraft.includes(id as never)) return 'Not offered';
      const a = w.build.anomalies;
      if (a.length < w.build.anomalySockets) a.push(id as never);
      else a[Math.max(0, Math.min(a.length - 1, replace ?? 0))] = id as never;
      w.emit(Ev.AnomalyPicked, id, a.length, 0, 0, 0, -1);
      w.rebuildStats();
    }
    this.nextDraft();
    return null;
  }

  rerollDraft(): string | null {
    const w = this.w, run = w.run;
    if (!run.pendingDraft) return 'No draft pending';
    if (run.cores < 1) return 'Not enough Cores';
    run.cores -= 1;
    this.draftRerolls++;
    const offers = rollDraft(w, run.draftWave, this.draftRerolls);
    if (offers.length > 0) run.pendingDraft = offers;
    return null;
  }

  /** Advance clocks at the very end of the tick. */
  advanceClock(): void {
    const w = this.w, run = w.run;
    run.tick++; run.attemptTick++; run.phaseTicks++;
    if (run.phase === 'combat') run.waveTick++;
    run.playSeconds += TICK_DT; w.meta.totalPlaySeconds += TICK_DT;
    if (run.mode === 'patrol') {
      this.patrolTicks++;
      this.patrolScrap += w.scrapEarned - this.scrapMark;
    }
    this.scrapMark = w.scrapEarned;
  }

  /** Live boss index (or NO_ENTITY). */
  boss(): number { return this.w.resolveEnemy(this.bossIndex, this.bossGen); }
}

/** Scrap per second over the logged clears (pure; 0 when there is nothing to go on). */
export function patrolEstimate(log: readonly { scrap: number; seconds: number }[]): number {
  let scrap = 0, secs = 0;
  for (const c of log) { scrap += c.scrap; secs += c.seconds; }
  return secs > 0 ? scrap / secs : 0;
}
