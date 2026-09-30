/**
 * Active edge (docs/ACTIVE.md): how a field tap maps onto the active commands (pure, no DOM; tests/app/active-tap.test.ts).
 *
 *  - A tap near a salvage crate (≥ CRATE_REACH_PX) collects it (`collect_salvage`, snapped onto the drawn crate) and does
 *    nothing else, unless the tap is on an enemy that is nearer to it than the crate: then the enemy wins (a crate drifting
 *    past must never steal a designation). Crates are forgiving in open ground: the reach is wide, a crate lasts 5 s.
 *  - A tap on an enemy (ability not armed) fires an assist shot (`tap_assist`) AND designates as before (`designate_at`
 *    through the ability bar). The one exception: a rapid re-tap of the SAME enemy (within REPEAT_MS of the previous enemy
 *    tap, and either drawn with a designation reticle or within SAME_ENEMY_WU of the previous tap's enemy) is an assist tap
 *    only, so hammering an enemy never toggles its designation off. A tap on another enemy always designates (two quick
 *    taps on two nearby enemies designate both); a lone tap on a designated enemy still clears it, exactly as before.
 *  - With an ability armed the tap casts it (unchanged); no assist, no collect.
 *  - Hold (the Input hold timer) on the tower while Overcharge is ready charges it; release fires. Elsewhere a hold still
 *    steers manual aim.
 *  - Gated by the unlock ladder (src/ui/progression.ts): `tapAssist` (assist shots), `salvage` (tap-collect; before it,
 *    crates still drift in and pay the passive share, ACTIVE.salvage.passiveValue).
 */
export const REPEAT_MS = 900;
export const REPEAT_PX = 48;
/** World units: an unmarked enemy this close to the previous tap's enemy, within REPEAT_MS, is the same enemy (re-tap). */
export const SAME_ENEMY_WU = 16;
/** A hold that starts within this many CSS px of the tower centre (or the tower's drawn radius + 10 px) charges Overcharge. */
export const TOWER_HOLD_PX = 34;

export type TapRoute =
  | { kind: 'collect'; x: number; y: number }
  | { kind: 'enemy'; x: number; y: number; assist: boolean; designate: boolean }
  | { kind: 'field' };

/** A drawn crate / enemy under the tap; `dist` = world distance from the tap (absent: treated as 0). */
export interface TapHit { x: number; y: number; dist?: number }

export interface TapGates {
  /** Progression feature `tapAssist`: an enemy tap also fires an assist shot. */
  assist: boolean;
  /** Progression feature `salvage`: a tap near a crate collects it. */
  salvage: boolean;
}
const ALL_ON: TapGates = { assist: true, salvage: true };

export class TapRouter {
  private lastAt = -1e9;
  private lastX = 0;
  private lastY = 0;

  /**
   * Route a field tap. `crate` / `enemy`: the drawn crate / enemy under the tap (or null); `armed`: an ability waits
   * for a target; `scale`: CSS px per world unit; `nowMs`: a monotonic clock; `marked`: the tapped enemy is drawn with a
   * designation reticle; `gates`: the unlock ladder's switches.
   */
  route(crate: TapHit | null, enemy: TapHit | null, armed: boolean, scale: number, nowMs: number, marked = false, gates: TapGates = ALL_ON): TapRoute {
    if (!gates.salvage) crate = null;
    if (!armed && crate && !(enemy && (enemy.dist ?? 0) < (crate.dist ?? 0))) return { kind: 'collect', x: crate.x, y: crate.y };
    if (!enemy) return { kind: 'field' };
    if (armed) return { kind: 'enemy', x: enemy.x, y: enemy.y, assist: false, designate: true };
    const wu = Math.hypot(enemy.x - this.lastX, enemy.y - this.lastY);
    const px = wu * Math.max(1e-6, scale);
    const repeat = nowMs - this.lastAt <= REPEAT_MS && px <= REPEAT_PX && (marked || wu <= SAME_ENEMY_WU);
    this.lastAt = nowMs; this.lastX = enemy.x; this.lastY = enemy.y;
    return { kind: 'enemy', x: enemy.x, y: enemy.y, assist: gates.assist, designate: !repeat };
  }
}

/** Does a hold that went down at world (x, y) start on the tower? `scale` = CSS px per world unit. */
export function holdOnTower(x: number, y: number, towerRadius: number, scale: number): boolean {
  const s = Math.max(1e-6, scale);
  return Math.hypot(x, y) * s <= Math.max(TOWER_HOLD_PX, towerRadius * s + 10);
}
