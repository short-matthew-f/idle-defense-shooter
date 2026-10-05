/**
 * Anti-stall invariant (docs/BALANCE.md "Stalls and knockback"): a wave always ends.
 *
 * RunMachine.postTick calls `tick` every combat tick, after every system ran. The watcher measures PROGRESS on a
 * reference set, the enemies alive at the last progress point: progress is that set's HP + shield (0 once dead)
 * falling PROGRESS_EPS of the living total below what it was then, net of healing, shields and regeneration.
 * Enemies spawned since are not in the set, and while a Carrier or a boss lives its brood never counts, so killing
 * what a spawner keeps producing is not progress while the spawner itself is untouched; each progress point re-takes
 * the set. Until every scheduled spawn is out every tick
 * is a progress point. The stall clock counts a tick without progress when
 *   - every scheduled spawn is out (the spawn window is part of the wave, not a stall),
 *   - no boss tell window is live (World.bossTell: the player is meant to answer it),
 *   - at least one living enemy is tangible (all Phased / Burrowed is the AI's own 20 s guarantee, enemies/ai.ts),
 *   - and either a tangible enemy is inside the primary's range while the weapons fire on their own (not Commander,
 *     Pacifist Core, or a Trial with the primary disabled), or no tangible enemy is approaching the tower (inward
 *     speed ≥ APPROACH u/s): enemies still walking in from the rim are not a stall.
 * Progress resets the clock; a paused tick neither counts nor resets.
 *
 * Boss waves (UX Phase 1, C-05): while a boss lives, the first `wave.stall_seconds` of counted ticks make only the
 * BOSS step in: it Rushes alone (speed ramp, ≤ rush_knockback, no shield / heal; it drops its scripted movement and
 * hold distance and walks to contact, enemies/ai.ts and steering.ts), one Ev.Rush (src 'boss.step_in') explains it,
 * and the clock restarts. Its brood and escorts do not Rush, so a boss nobody was damaging no longer turns into a ×3
 * brood swarm. If the boss still makes no progress for another `wave.stall_seconds`, or once it is dead and the rest
 * stalls, the whole wave Rushes as below. Bound for a stalled boss wave: 2 × stall_seconds + the ramp + the walk in.
 *
 * At `wave.stall_seconds` (10 s) of counted ticks (on a boss wave: see above)
 * every living enemy (and every later spawn of the wave) starts Rushing: EnemyPool.rushT > 0, so its speed ramps to
 * ×wave.rush_speed over wave.rush_ramp (enemies/recovery.ts), it takes ≤ wave.rush_knockback of any push
 * (core/forces.ts), it gains no shield, heal or regeneration (recovery.ts, World.healEnemy, bosses/common addShield)
 * and ranged enemies close to contact (steering.ts, behaviors/movement.ts). One Ev.Rush (src 'wave.rush', a = enemies
 * rushing, b = counted stall seconds, cause = the wave's WaveStart event) explains it to the Inspector and the feed.
 *
 * Deterministic: integer tick counts, pool-index iteration, no PRNG. The Inspector pause stops the tick loop itself,
 * so it can never advance the clock. The state is per RunMachine (one per Sim) and is not saved: a reload restarts
 * the wave from `between`, and a wave start or attempt start resets it.
 */
import type { WorldImpl } from '../core/world-impl';
import { EnemyFlag, Ev, TICK_RATE } from '../core/types';
import { kindIndex } from '../core/content';

/** Inward speed (units/s) that counts as "still approaching". */
const APPROACH = 2;
/** Fraction of the living HP + shield the level must fall below its best to count as progress (noise guard). */
const PROGRESS_EPS = 0.002;
const F_SKIP = EnemyFlag.Dead | EnemyFlag.Ally, F_HIDDEN = EnemyFlag.Phased | EnemyFlag.Burrowed;
const K_BROOD = kindIndex('brood'), K_CARRIER = kindIndex('carrier');

export class StallWatch {
  /** Counted stall ticks since the last progress. */
  clock = 0;
  /** True once this wave's Rush started (until the next wave / attempt). */
  rushing = false;
  /** Rushes started since this Sim was created (sim-cli metrics). */
  rushes = 0;
  /** True once this wave's boss stepped in (boss-only Rush; until the next wave / attempt). */
  bossStepped = false;
  /** Boss step-ins since this Sim was created (sim-cli metrics). */
  bossSteps = 0;
  /** Enemies with gen ≤ mark form the reference set (alive at the last progress point). */
  private mark = 0;
  /** Their HP + shield at the last progress point. */
  private best = 0;
  private startEv = -1;

  /** New wave (or attempt): forget everything. `startEv` = the WaveStart event (the Rush's cause). */
  reset(w: WorldImpl, startEv: number): void {
    this.clock = 0; this.rushing = false; this.bossStepped = false; this.mark = w.lastSpawnGen(); this.best = 0; this.startEv = startEv;
  }

  /** One combat tick, after every system ran. `spawnsOut`: every scheduled spawn of the wave is on the field. */
  tick(w: WorldImpl, spawnsOut: boolean): void {
    const e = w.enemies, n = e.count, mark = this.mark, rushing = this.rushing;
    const range = Math.max(0, w.stats.get('ballistics.range'));
    let all = 0, ref = 0, elig = 0, alive = 0, tangible = 0, inReach = 0, approaching = 0, spawner = false, boss = false;
    for (let i = 0; i < n; i++) {
      if ((e.flags[i] & F_SKIP) !== 0) continue;
      if (e.flags[i] & EnemyFlag.Boss) { boss = true; spawner = true; break; }
      if (e.kind[i] === K_CARRIER) spawner = true;
    }
    for (let i = 0; i < n; i++) {
      const f = e.flags[i];
      if (f & F_SKIP) continue;
      alive++;
      if (rushing) { if (e.rushT[i] === 0) e.rushT[i] = 1; continue; }   // later spawns of a rushing wave rush too
      const v = (e.hp[i] > 0 ? e.hp[i] : 0) + e.shield[i];
      all += v;
      if (!(spawner && e.kind[i] === K_BROOD)) { elig += v; if (e.gen[i] <= mark) ref += v; }   // a live spawner's brood is an endless stream
      if (f & F_HIDDEN) continue;
      tangible++;
      const x = e.x[i], y = e.y[i], d2 = x * x + y * y, rr = range + e.radius[i];
      if (d2 <= rr * rr) inReach++;
      else if (e.vx[i] * x + e.vy[i] * y < -APPROACH * Math.sqrt(d2)) approaching++;
    }
    if (rushing || alive === 0) return;
    // Progress: the reference set (everything alive at the last progress point) lost HP + shield net of any
    // healing / regeneration, or members died. Enemies spawned since (a Carrier's brood, fragments, boss adds) are
    // not in it, so killing what a spawner keeps producing is not progress; damaging the spawner is.
    if (!spawnsOut || ref < this.best - PROGRESS_EPS * all) {
      this.mark = w.lastSpawnGen(); this.best = elig; this.clock = 0;
      return;
    }
    if (w.bossTell.ticksLeft > 0 || tangible === 0) return;
    const t = w.trial;
    const autoFire = w.stats.mounted('primary') && t !== 'commander' && t !== 'pacifist_core';
    if (!((inReach > 0 && autoFire) || approaching === 0)) return;
    if (++this.clock < Math.max(1, Math.round(w.stats.get('wave.stall_seconds') * TICK_RATE))) return;
    if (boss && !this.bossStepped) this.bossStepIn(w);
    else this.startRush(w, alive);
  }

  /** Boss waves: the boss alone Rushes (steps in); the clock restarts. */
  private bossStepIn(w: WorldImpl): void {
    const e = w.enemies;
    let n = 0;
    for (let i = 0; i < e.count; i++) if ((e.flags[i] & F_SKIP) === 0 && (e.flags[i] & EnemyFlag.Boss) && e.rushT[i] === 0) { e.rushT[i] = 1; n++; }
    this.bossStepped = true;
    this.bossSteps++;
    w.emit(Ev.Rush, 'boss.step_in', n, Math.round(this.clock / TICK_RATE), 0, 0, this.startEv);
    this.clock = 0;
  }

  /** What stalled this wave (UiState.wave.stalled; the death card names it): the whole wave Rushing, the boss stepping in, or nothing. */
  stalled(): 'wave' | 'boss' | null { return this.rushing ? 'wave' : this.bossStepped ? 'boss' : null; }

  private startRush(w: WorldImpl, alive: number): void {
    const e = w.enemies;
    this.rushing = true;
    this.rushes++;
    for (let i = 0; i < e.count; i++) if ((e.flags[i] & F_SKIP) === 0 && e.rushT[i] === 0) e.rushT[i] = 1;
    w.emit(Ev.Rush, 'wave.rush', alive, Math.round(this.clock / TICK_RATE), 0, 0, this.startEv);
  }
}
