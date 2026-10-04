/**
 * Enemy-side rules of the knockback governor and the anti-stall Rush (docs/BALANCE.md "Stalls and knockback").
 * Called by enemies/ai.ts once per enemy per tick, before its behavior moves it.
 *
 *  - Rally: an enemy pushed outward (core/forces.ts sets rallyR = where it was first pushed from) walks back at
 *    knockback.rally_speed (×2) until it is that close to the tower again, so knockback buys seconds, not minutes.
 *  - Rush (run/stall.ts starts it): speed ramps linearly from ×1 to wave.rush_speed (×3) over wave.rush_ramp (8 s).
 *    Both multiply `speedMul` like the AI's other speed auras (never a frozen or staggered enemy: 0 stays 0).
 *  - Regeneration gate (Shielded / shielded_elite shields, Regenerating elites): shields and regen punish low damage,
 *    not distance, so they only recover while the enemy is inside the primary's range, has not been pushed for
 *    knockback.regen_grace (3 s), and is not Rushing. The "3 s without damage" (1 s for Regenerating) rule is unchanged.
 */
import type { World } from '../core/world';
import { TICK_RATE } from '../core/types';

/** Per-tick knobs (read once per tick from the stat resolver by aiStep). */
export interface RecoveryParams { range: number; rally: number; rushSpeed: number; rushRampTicks: number; graceTicks: number }

export function newRecoveryParams(): RecoveryParams { return { range: 300, rally: 2, rushSpeed: 3, rushRampTicks: 480, graceTicks: 180 }; }

export function readRecoveryParams(w: World, p: RecoveryParams): void {
  const s = w.stats;
  p.range = Math.max(0, s.get('ballistics.range'));
  p.rally = Math.max(1, s.get('knockback.rally_speed'));
  p.rushSpeed = Math.max(1, s.get('wave.rush_speed'));
  p.rushRampTicks = Math.max(1, Math.round(s.get('wave.rush_ramp') * TICK_RATE));
  p.graceTicks = Math.max(0, Math.round(s.get('knockback.regen_grace') * TICK_RATE));
}

/** Rally and Rush speed for enemy i (multiplies speedMul; call before the enemy moves this tick). */
export function recoverySpeed(w: World, i: number, p: RecoveryParams): void {
  const e = w.enemies;
  let m = 1;
  const rr = e.rallyR[i];
  if (rr > 0) {
    const x = e.x[i], y = e.y[i];
    if (x * x + y * y <= (rr + 1) * (rr + 1)) e.rallyR[i] = 0; else m = p.rally;
  }
  const rt = e.rushT[i];
  if (rt > 0) {
    if (rt < 65535) e.rushT[i] = rt + 1;
    const ramp = rt >= p.rushRampTicks ? 1 : rt / p.rushRampTicks;
    const rush = 1 + (p.rushSpeed - 1) * ramp;
    if (rush > m) m = rush;
  }
  if (m !== 1 && e.speedMul[i] > 0) e.speedMul[i] *= m;
}

/** May enemy i regenerate shield / HP this tick (beyond its own "time since damage" rule)? */
export function regenAllowed(w: World, i: number, p: RecoveryParams): boolean {
  const e = w.enemies;
  if (e.rushT[i] > 0) return false;
  const kt = e.knockT[i];
  if (kt > 0 && w.tick - (kt - 1) < p.graceTicks) return false;
  const x = e.x[i], y = e.y[i], r = p.range + e.radius[i];
  return x * x + y * y <= r * r;
}
