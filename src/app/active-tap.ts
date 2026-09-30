/**
 * Active edge (docs/ACTIVE.md): how a field tap maps onto the active commands (pure, no DOM; tests/app/active-tap.test.ts).
 *
 *  - A tap near a salvage crate (≥ CRATE_REACH_PX) collects it (`collect_salvage`, snapped onto the drawn crate) and does
 *    nothing else. Crates win over enemies: the reach is forgiving and a crate is gone in a few seconds.
 *  - A tap on an enemy (ability not armed) fires an assist shot (`tap_assist`) AND designates as before (`designate_at`
 *    through the ability bar). Rapid re-taps on the same spot (within REPEAT_MS and REPEAT_PX of the previous enemy tap)
 *    are assist taps only, so hammering an enemy never toggles its designation off; a lone tap on a designated enemy still
 *    clears it, exactly as before.
 *  - With an ability armed the tap casts it (unchanged); no assist.
 *  - Hold (the Input hold timer) on the tower while Overcharge is ready charges it; release fires. Elsewhere a hold still
 *    steers manual aim.
 */
export const REPEAT_MS = 900;
export const REPEAT_PX = 48;
/** A hold that starts within this many CSS px of the tower centre (or the tower's drawn radius + 10 px) charges Overcharge. */
export const TOWER_HOLD_PX = 34;

export type TapRoute =
  | { kind: 'collect'; x: number; y: number }
  | { kind: 'enemy'; x: number; y: number; assist: boolean; designate: boolean }
  | { kind: 'field' };

export class TapRouter {
  private lastAt = -1e9;
  private lastX = 0;
  private lastY = 0;

  /**
   * Route a field tap. `crate` / `enemy`: the drawn crate / enemy under the tap (or null); `armed`: an ability waits
   * for a target; `scale`: CSS px per world unit; `nowMs`: a monotonic clock.
   */
  route(crate: { x: number; y: number } | null, enemy: { x: number; y: number } | null, armed: boolean, scale: number, nowMs: number): TapRoute {
    if (!armed && crate) return { kind: 'collect', x: crate.x, y: crate.y };
    if (!enemy) return { kind: 'field' };
    if (armed) return { kind: 'enemy', x: enemy.x, y: enemy.y, assist: false, designate: true };
    const px = Math.hypot(enemy.x - this.lastX, enemy.y - this.lastY) * Math.max(1e-6, scale);
    const repeat = nowMs - this.lastAt <= REPEAT_MS && px <= REPEAT_PX;
    this.lastAt = nowMs; this.lastX = enemy.x; this.lastY = enemy.y;
    return { kind: 'enemy', x: enemy.x, y: enemy.y, assist: true, designate: !repeat };
  }
}

/** Does a hold that went down at world (x, y) start on the tower? `scale` = CSS px per world unit. */
export function holdOnTower(x: number, y: number, towerRadius: number, scale: number): boolean {
  const s = Math.max(1e-6, scale);
  return Math.hypot(x, y) * s <= Math.max(TOWER_HOLD_PX, towerRadius * s + 10);
}
