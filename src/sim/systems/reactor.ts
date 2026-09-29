/**
 * Reactor (design §5; WP2): system-wide behavior and economy.
 *
 * Resolved by other code (verified, nothing to do here):
 *   reactor.global_attack_speed (Overclock speed writes it too) — every system's fire rate (Ballistics reads it)
 *   reactor.cooldown_reduction / reactor.command.cooldowns / reactor.command.fourth_slot — hardpoints, abilities
 *   reactor.energy_recycling — WorldImpl.gainCE multiplies every CE gain by (1 + x)
 *   economy.ce_cap (Command Capacitor Array writes it) — WorldImpl.cacheStats → tower.ceCap after every rebuild
 *   economy.scrap_mul, combat.power_mul (Salvage Protocol), economy.first_clear_mul (Strip Mine sets 4) —
 *   WorldImpl.finishKill; economy.boss_scrap_mul (Boss Scavenging) — WorldImpl.finishKill on boss/elite kills
 *   reactor.targeting_logic — NOT implemented: it needs core/targeting.ts (core-owned) and each weapon's
 *   targeting; left for WP1/WP3 (key resolves: 0..3).
 * Implemented here:
 *   Overdrive Core   every overdrive_core.every s of the attempt, `duration` s of ×(1 + bonus) speed (World.dynamicSpeedMul)
 *   Critical Mass    more than `threshold` live enemies: ×(1 + min(cap, per_enemy × (n − threshold))) speed
 *   Checkpoint Dividend  on the first reach of a checkpoint (Ev.Checkpoint), pays x × that wave's kill Scrap
 *   Synchronization  weapon hits (hit.source primary/ordnance/drones/blade/laser/gravitics) mark the enemy's
 *                    combo window (enemies.comboStart/comboMask, window reactor.sync.window s). While 2+ systems
 *                    are in the window, the enemy takes +reactor.sync.combo per extra system (damageMul).
 *                    Harmonic Lock: 4+ systems → +50% from all sources for 3 s (enemies.harmonicUntil).
 *   Command          reactor.command.ce_regen is applied by systems/abilities.ts (WP9 owns CE); nothing here.
 */
import type { System, HitInfo, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import { EnemyFlag, Ev, Shape, TICK_RATE } from '../core/types';
import { weaponIndex } from './elements-shared';

function bits(m: number): number { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; }

export class ReactorSystem implements System {
  readonly id = 'reactor';
  private overdrive = false; private odEvery = 1800; private odDur = 300; private odBonus = 0.5;
  private critMass = false; private cmTh = 25; private cmPer = 0.02; private cmCap = 0.4;
  private dividend = 0;
  private combo = 0; private window = 30; private harmonic = false; private hN = 4; private hBonus = 0.5; private hDur = 180;
  private applied = 1;
  private lastCheckpoint = 0;
  /** Speed factor currently contributed (UI / tests). */
  speedFactor = 1;

  init(w: World): void { this.rebuild(w); this.lastCheckpoint = w.run.checkpoint; }

  rebuild(w: World): void {
    const s = w.stats;
    const oc = s.hasDoctrine('reactor', 'overclock'), sv = s.hasDoctrine('reactor', 'salvage');
    const sy = s.hasDoctrine('reactor', 'synchronization');
    this.overdrive = oc && s.has('reactor.overclock.overdrive_core');
    this.odEvery = Math.max(1, Math.round(s.get('reactor.overclock.overdrive_core.every') * TICK_RATE));
    this.odDur = Math.round(s.get('reactor.overclock.overdrive_core.duration') * TICK_RATE);
    this.odBonus = s.get('reactor.overclock.overdrive_core.bonus');
    this.critMass = s.has('reactor.critical_mass');
    this.cmTh = s.get('reactor.critical_mass.threshold'); this.cmPer = s.get('reactor.critical_mass.per_enemy'); this.cmCap = s.get('reactor.critical_mass.cap');
    this.dividend = sv && s.has('reactor.salvage.checkpoint_dividend') ? s.get('reactor.salvage.checkpoint_dividend') : 0;
    this.combo = sy ? s.get('reactor.sync.combo') : 0;
    this.window = Math.max(1, Math.round(s.get('reactor.sync.window') * TICK_RATE));
    this.harmonic = sy && s.has('reactor.sync.harmonic_lock');
    this.hN = s.get('reactor.sync.harmonic_lock.systems'); this.hBonus = s.get('reactor.sync.harmonic_lock.bonus');
    this.hDur = Math.round(s.get('reactor.sync.harmonic_lock.duration') * TICK_RATE);
  }

  onAttemptStart(w: World): void { if (w.run.checkpoint < this.lastCheckpoint) this.lastCheckpoint = w.run.checkpoint; }

  update(w: World): void {
    let f = 1;
    if (this.overdrive) {
      const t = w.run.attemptTick;
      if (t >= this.odEvery && t % this.odEvery < this.odDur) {
        f *= 1 + this.odBonus;
        if (t % this.odEvery === 0) w.emit(Ev.Fx, 'reactor.overdrive_core', this.odDur, 0, 0, 0, -1);
      }
    }
    if (this.critMass) {
      const e = w.enemies;
      let n = 0;
      for (let i = 0; i < e.count; i++) if ((e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally)) === 0) n++;
      if (n > this.cmTh) f *= 1 + Math.min(this.cmCap, this.cmPer * (n - this.cmTh));
    }
    if (f !== this.applied) { w.dynamicSpeedMul = (w.dynamicSpeedMul / this.applied) * f; this.applied = f; }
    this.speedFactor = f;
  }

  onWaveEnd(w: World): void {
    const run = w.run;
    if (run.checkpoint < this.lastCheckpoint) this.lastCheckpoint = run.checkpoint;   // new Prestige
    if (run.checkpoint !== run.wave || run.checkpoint <= this.lastCheckpoint) return;
    this.lastCheckpoint = run.checkpoint;
    if (this.dividend <= 0) return;
    const wi = w as WorldImpl;
    const amount = wi.waveScrap * this.dividend;
    if (!(amount > 0)) return;
    let cause = -1;
    for (let id = w.events.nextId - 1; id >= 0 && id >= w.events.nextId - 16; id--) {
      const ev = w.events.byId(id);
      if (ev && ev.type === Ev.Checkpoint) { cause = id; break; }
    }
    wi.addScrap(amount);
    w.emit(Ev.ScrapGain, 'reactor.checkpoint_dividend', run.wave, amount, 0, 0, cause);
  }

  onHit(w: World, hit: HitInfo): void {
    if (this.combo <= 0 && !this.harmonic) return;
    const idx = weaponIndex(hit.source);
    const i = hit.enemy;
    if (idx < 0 || i < 0 || !w.alive(i)) return;
    const e = w.enemies, tick = w.tick;
    if (tick - e.comboStart[i] > this.window || e.comboMask[i] === 0) { e.comboStart[i] = tick; e.comboMask[i] = 1 << idx; }
    else e.comboMask[i] |= 1 << idx;
    if (this.harmonic && e.harmonicUntil[i] <= tick && bits(e.comboMask[i]) >= this.hN) {
      e.harmonicUntil[i] = tick + this.hDur;
      w.emit(Ev.Fx, 'reactor.harmonic_lock', i, this.hDur, e.x[i], e.y[i], hit.eventId);
    }
  }

  damageMul(w: World, i: number): number {
    const e = w.enemies, tick = w.tick;
    let m = 1;
    if (this.combo > 0 && e.comboMask[i] !== 0 && tick - e.comboStart[i] <= this.window) {
      const n = bits(e.comboMask[i]);
      if (n >= 2) m *= 1 + this.combo * (n - 1);
    }
    if (e.harmonicUntil[i] > tick) m *= 1 + this.hBonus;
    return m;
  }

  render(_w: World, out: InstanceWriter): void {
    if (this.speedFactor > 1) out.push(0, 0, 26, 0, Shape.Ring, 0.95, 0.9, 0.4, 0.4, 2);
  }
}
