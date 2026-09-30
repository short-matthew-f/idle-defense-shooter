/**
 * Tower upkeep (fixed phase: after projectiles and hazards — see Sim.step).
 *  - Regeneration: `bastion.regeneration` HP/s (disabled by the Hungry Core anomaly).
 *  - Shield recharge: after 3 s without damage, shields refill at `bastion.shield_recharge`/s plus a
 *    baseline 10% of capacity per second.
 *  - invulnerability countdown, low-HP bookkeeping (lowHpTicks for Command Energy / Phoenix).
 *  - Death: when HP reaches 0 during combat, emits Ev.TowerDeath once (data: World.towerKiller, i.e.
 *    { killer, boss?, bossPhase? }); the run machine reacts.
 * `betweenWaveHeal` is called by the run machine at each `between` phase.
 */
import type { System } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import { Ev, TICK_DT, TICK_RATE } from '../core/types';
import { BETWEEN_WAVE_HEAL } from '../economy/curves';

const SHIELD_DELAY = 3 * TICK_RATE;

export class TowerSystem implements System {
  readonly id = 'tower';
  private regen = 0;
  private recharge = 0;
  private deathEmitted = false;

  init(w: World): void { this.rebuild(w); this.deathEmitted = false; }
  rebuild(w: World): void {
    this.regen = w.stats.hasAnomaly('hungry_core') ? 0 : Math.max(0, w.stats.get('bastion.regeneration'));
    this.recharge = Math.max(0, w.stats.get('bastion.shield_recharge'));
  }
  onAttemptStart(): void { this.deathEmitted = false; }

  update(world: World): void {
    const w = world as WorldImpl;
    const t = w.tower;
    if (t.invulnT > 0) t.invulnT--;
    if (t.hp <= 0) {
      // data (UX review S3): { killer, boss?, bossPhase? } from World.damageTower's killing blow
      if (!this.deathEmitted) { this.deathEmitted = true; w.emit(Ev.TowerDeath, 'tower', w.run.wave, w.run.attempts, 0, 0, -1, w.towerKiller ?? { killer: 'enemy' }); }
      return;
    }
    this.deathEmitted = false;
    if (this.regen > 0 && t.hp < t.maxHp) t.hp = Math.min(t.maxHp, t.hp + this.regen * TICK_DT);
    if (t.shield < t.maxShield && w.tick - w.lastTowerDamageTick >= SHIELD_DELAY) {
      t.shield = Math.min(t.maxShield, t.shield + (this.recharge + 0.1 * t.maxShield) * TICK_DT);
    }
    if (t.hp < t.maxHp * 0.25) t.lowHpTicks++; else t.lowHpTicks = 0;
  }
}

/**
 * Heal `bastion.between_wave_heal` × max HP between waves (base BETWEEN_WAVE_HEAL = 25%; Boons: Second Wind
 * adds, Glass Hour halves; none with the Tithe anomaly); shields refill.
 */
export function betweenWaveHeal(w: WorldImpl): void {
  const t = w.tower;
  if (t.hp <= 0) return;
  const f = Math.max(0, w.stats.get('bastion.between_wave_heal') ?? BETWEEN_WAVE_HEAL);
  if (!w.stats.hasAnomaly('tithe') && f > 0) w.healTower(t.maxHp * f, -1);
  t.shield = t.maxShield;
}
