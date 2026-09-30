/**
 * Status ticking (fixed phase: after spawns, before enemy movement — see Sim.step).
 *  - Durations count down every tick; a status loses all stacks when its duration expires.
 *  - speedMul = 0 while frozen or staggered (bosses: stagger only interrupts, see steering), else 1 − 0.12·chill (half effect on Immovable), min 0.1;
 *    then × (1 − fieldSlow), which area effects (Time Field, Containment, boss Deep Freeze window) raised last tick; fieldSlow is cleared.
 *    Only the AI's speed auras multiply speedMul after this (see EnemyPool.speedMul for the full rule).
 *  - DoTs deal damage in 4 Hz pulses through World.damage (silent: no Hit event; kills still emit Kill):
 *      burn   burnDps × stacks   (fire, ignores armor)
 *      poison poisonDps × stacks (poison, ignores armor; pulses every 15 × poison.tick_interval ticks — Heavy Water)
 *      bleed  bleedDps × stacks  (physical, armor applies)
 *    Once per second per enemy per status, one Ev.StatusTick (b = damage summed over that second)
 *    is emitted with the StatusApply that last refreshed it as cause.
 *  - shock (+5%/stack damage taken) and brittle (+15%/stack crit damage taken) are applied in World.damage.
 */
import type { System } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import { EnemyFlag, Ev } from '../core/types';

const PULSE = 15;
const PULSE_DT = PULSE / 60;

export class StatusesSystem implements System {
  readonly id = 'statuses';
  init(w: World): void { this.rebuild(w); }
  /** WP2: while Frost is attuned its tree sets the slow (frost.slow_per_stack, capped at frost.slow_cap); otherwise 12%/stack, cap 90%. */
  private slowPer = 0.12; private slowCap = 0.9;
  /** Poison pulse length in ticks: 15 × poison.tick_interval (Heavy Water ×1.25 → 19); damage per pulse scales with it. */
  private poisonPulse = PULSE;
  rebuild(w: World): void {
    const s = w.stats;
    this.poisonPulse = Math.max(1, Math.round(PULSE * Math.max(0.1, s.get('poison.tick_interval') || 1)));
    if (s.attuned('frost')) { this.slowPer = Math.max(0, s.get('frost.slow_per_stack')); this.slowCap = Math.min(0.9, Math.max(0, s.get('frost.slow_cap'))); }
    else { this.slowPer = 0.12; this.slowCap = 0.9; }
  }

  update(world: World): void {
    const w = world as WorldImpl;
    const e = w.enemies;
    const tick = w.tick;
    const pulse = tick % PULSE === 0;
    const pp = this.poisonPulse, poisonPulse = tick % pp === 0, poisonDt = pp / 60;
    const second = tick % 60 === 0;
    for (let i = 0; i < e.count; i++) {
      const f = e.flags[i];
      if (f & EnemyFlag.Dead) continue;
      if (e.burnT[i] > 0 && --e.burnT[i] === 0) e.burn[i] = 0;
      if (e.poisonT[i] > 0 && --e.poisonT[i] === 0) e.poison[i] = 0;
      if (e.chillT[i] > 0 && --e.chillT[i] === 0) e.chill[i] = 0;
      if (e.shockT[i] > 0 && --e.shockT[i] === 0) e.shock[i] = 0;
      if (e.bleedT[i] > 0 && --e.bleedT[i] === 0) e.bleed[i] = 0;
      if (e.brittleT[i] > 0 && --e.brittleT[i] === 0) e.brittle[i] = 0;
      if (e.staticT[i] > 0 && --e.staticT[i] === 0) e.staticStacks[i] = 0;
      if (e.markedT[i] > 0) e.markedT[i]--;
      if (e.frozenT[i] > 0) e.frozenT[i]--;
      if (e.staggerT[i] > 0) e.staggerT[i]--;
      let m = 1;
      // staggerT on a boss is an interrupt flag for its AI, not a stun
      if (e.frozenT[i] > 0 || (e.staggerT[i] > 0 && (f & EnemyFlag.Boss) === 0)) m = 0;
      else if (e.chill[i] > 0) {
        const slow = this.slowPer * e.chill[i] * ((f & EnemyFlag.Immovable) ? 0.5 : 1);   // WP2: frost tree keys
        m = slow >= this.slowCap ? 1 - this.slowCap : 1 - slow;
      }
      if (e.fieldSlow[i] > 0) { m *= 1 - e.fieldSlow[i]; e.fieldSlow[i] = 0; }   // WP9: Time Field (written by plugins last tick)
      e.speedMul[i] = m;

      if (pulse) {
        if (e.burn[i] > 0) {
          const h = w.damage(i, e.burnDps[i] * e.burn[i] * PULSE_DT, { source: 'status', srcTag: 'burn', element: 'fire', cause: e.burnCause[i], ignoreArmor: true, silent: true });
          e.burnAcc[i] += h.damage;
        }
        if (poisonPulse) this.poisonTick(w, i, poisonDt);
        if (e.bleed[i] > 0 && !(e.flags[i] & EnemyFlag.Dead)) {
          const h = w.damage(i, e.bleedDps[i] * e.bleed[i] * PULSE_DT, { source: 'status', srcTag: 'bleed', element: null, cause: e.bleedCause[i], silent: true });
          e.bleedAcc[i] += h.damage;
        }
      } else if (poisonPulse) this.poisonTick(w, i, poisonDt);
      if (second && !(e.flags[i] & EnemyFlag.Dead)) {
        const bits = w.stateBits(i) << 8;
        if (e.burnAcc[i] > 0) { w.emitC(Ev.StatusTick, 'burn', i, e.burnAcc[i], 0 | bits, e.x[i], e.y[i], e.burnCause[i]); e.burnAcc[i] = 0; }
        if (e.poisonAcc[i] > 0) { w.emitC(Ev.StatusTick, 'poison', i, e.poisonAcc[i], 2 | bits, e.x[i], e.y[i], e.poisonCause[i]); e.poisonAcc[i] = 0; }
        if (e.bleedAcc[i] > 0) { w.emitC(Ev.StatusTick, 'bleed', i, e.bleedAcc[i], 4 | bits, e.x[i], e.y[i], e.bleedCause[i]); e.bleedAcc[i] = 0; }
      }
    }
  }

  private poisonTick(w: WorldImpl, i: number, dt: number): void {
    const e = w.enemies;
    if (e.poison[i] <= 0 || (e.flags[i] & EnemyFlag.Dead)) return;
    const h = w.damage(i, e.poisonDps[i] * e.poison[i] * dt, { source: 'status', srcTag: 'poison', element: 'poison', cause: e.poisonCause[i], ignoreArmor: true, silent: true });
    e.poisonAcc[i] += h.damage;
  }
}
