/**
 * Constellation Singularity bridges (design §15, data/constellation.ts): cross-system rules bought with Stars once
 * both majors are owned. Each firing emits Ev.Anomaly with src = the bridge's node id (the Codex registers it and what
 * follows chains from it). EFFECT-AUDIT: these three nodes were purchasable before any code read them.
 *
 *  star.bridge.primary+laser    Focal Reactor: every enemy that dies inside the laser polygon's interior
 *                               (world.shared.laserInterior) adds a charge; at FOCAL_CHARGES the primary fires a
 *                               central beam (a round that pierces everything) at its nearest target in range for
 *                               FOCAL_MUL × primary damage
 *  star.bridge.ordnance+drones  Deployment Charge: each ordnance explosion (Ev.Explosion src ordnance…) launches a
 *                               homing drone (Microdrone, drone damage, pierce) that lives DEPLOY_SECONDS; at most
 *                               DEPLOY_CAP alive at once
 *  star.bridge.ordnance+laser   Prism Battery: every PRISM_EVERY s, each point where two beams cross (world.shared
 *                               laserBeams, endpoints excluded) launches a homing missile (ordnance damage and blast)
 *                               at the nearest enemy, up to PRISM_CAP per volley
 */
import type { System, HitInfo } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { SimEvent } from '../core/types';
import { ARENA_RADIUS, Ev, ProjFlag, ProjKind, TICK_RATE } from '../core/types';
import { atan2, cos, sin } from '../math/lut';
import { SRC_DRONES, SRC_ORDNANCE, infusedElement } from './hardpoints/common';

const FOCAL = 'star.bridge.primary+laser', DEPLOY = 'star.bridge.ordnance+drones', PRISM = 'star.bridge.ordnance+laser';
export const FOCAL_CHARGES = 20, FOCAL_MUL = 10;
export const DEPLOY_SECONDS = 4, DEPLOY_CAP = 6;
export const PRISM_EVERY = 1.5, PRISM_CAP = 8;
const FOCAL_SPEED = 900, DRONE_SPEED = 260, EXCL = new Int32Array(1);

export class ConstellationSystem implements System {
  readonly id = 'constellation';
  private focal = false; private deploy = false; private prism = false;
  private charges = 0;
  private deployUntil = new Int32Array(DEPLOY_CAP);
  private lastEvent = 0;
  private w: World | null = null;

  init(w: World): void { this.w = w; this.rebuild(w); this.reset(w); }
  onAttemptStart(w: World): void { this.reset(w); }
  private reset(w: World): void { this.charges = 0; this.deployUntil.fill(0); this.lastEvent = w.events.nextId; }

  rebuild(w: World): void {
    const s = w.stats;
    this.focal = s.rank(FOCAL) > 0; this.deploy = s.rank(DEPLOY) > 0; this.prism = s.rank(PRISM) > 0;
  }

  update(w: World): void {
    const end = w.events.nextId;
    if (this.deploy) (w as WorldImpl).events.forEachRange(this.lastEvent, end, this.onEvent);
    this.lastEvent = end;
    if (this.prism && w.tick % Math.round(PRISM_EVERY * TICK_RATE) === 0) this.prismVolley(w);
  }

  /** Deployment Charge: an ordnance explosion launches a temporary drone. */
  private readonly onEvent = (e: SimEvent): void => {
    if (e.type !== Ev.Explosion || !(e.src === 'ordnance' || e.src.startsWith('ordnance.'))) return;
    const w = this.w!, now = w.tick;
    let slot = -1;
    for (let k = 0; k < DEPLOY_CAP; k++) if (this.deployUntil[k] <= now) { slot = k; break; }
    if (slot < 0) return;
    const t = w.nearestEnemy(e.x, e.y, 400, 'nearest', 'drones');
    if (t < 0) return;
    this.deployUntil[slot] = now + DEPLOY_SECONDS * TICK_RATE;
    const cause = w.emit(Ev.Anomaly, DEPLOY, t, 0, e.x, e.y, e.id);
    const a = atan2(w.enemies.y[t] - e.y, w.enemies.x[t] - e.x);
    w.spawnProjectile({ kind: ProjKind.Microdrone, source: SRC_DRONES, srcTag: DEPLOY, x: e.x, y: e.y, vx: cos(a) * DRONE_SPEED, vy: sin(a) * DRONE_SPEED,
      damage: w.stats.get('drones.damage'), radius: 3, life: DEPLOY_SECONDS * TICK_RATE, pierce: 255, target: t,
      flags: ProjFlag.Homing | ProjFlag.FromDrone, element: infusedElement(w.stats, 'drones'), cause });
  };

  /** Prism Battery: a missile from every beam crossing. */
  private prismVolley(w: World): void {
    const sh = w.shared, B = sh.laserBeams, n = sh.laserBeamCount;
    if (n < 2) return;
    const s = w.stats, dmg = s.get('ordnance.damage'), blast = s.get('ordnance.blast_radius') * (s.get('combat.blast_radius_mul') || 1);
    const speed = Math.max(60, s.get('ordnance.missile_speed')), el = infusedElement(s, 'ordnance');
    let launched = 0, cause = -1;
    for (let a = 0; a < n && launched < PRISM_CAP; a++) {
      const ax = B[a * 4], ay = B[a * 4 + 1], adx = B[a * 4 + 2] - ax, ady = B[a * 4 + 3] - ay;
      for (let b = a + 1; b < n && launched < PRISM_CAP; b++) {
        const bx = B[b * 4], by = B[b * 4 + 1], bdx = B[b * 4 + 2] - bx, bdy = B[b * 4 + 3] - by;
        const den = adx * bdy - ady * bdx;
        if (Math.abs(den) < 1e-6) continue;
        const u = ((bx - ax) * bdy - (by - ay) * bdx) / den, v = ((bx - ax) * ady - (by - ay) * adx) / den;
        if (u <= 0.02 || u >= 0.98 || v <= 0.02 || v >= 0.98) continue;   // a true crossing, not a shared node
        const x = ax + adx * u, y = ay + ady * u;
        const t = w.nearestEnemy(x, y, ARENA_RADIUS, 'nearest', 'ordnance');
        if (t < 0) return;
        if (cause < 0) cause = w.emit(Ev.Anomaly, PRISM, n, 0, x, y, -1);
        const ang = atan2(w.enemies.y[t] - y, w.enemies.x[t] - x);
        w.spawnProjectile({ kind: ProjKind.Missile, source: SRC_ORDNANCE, srcTag: PRISM, x, y, vx: cos(ang) * speed, vy: sin(ang) * speed,
          damage: dmg, radius: 4, blast, life: Math.ceil(((ARENA_RADIUS * 2) / speed) * TICK_RATE), target: t, flags: ProjFlag.Homing, element: el, cause });
        launched++;
      }
    }
  }

  /** Focal Reactor: kills inside the polygon charge the central beam. */
  onKill(w: World, hit: HitInfo): void {
    if (!this.focal) return;
    const r = w.shared.laserInterior;
    if (!(r > 0) || hit.x * hit.x + hit.y * hit.y > r * r) return;
    if (++this.charges < FOCAL_CHARGES) return;
    this.charges = 0;
    EXCL[0] = hit.enemy;
    const range = w.stats.get('ballistics.range');
    const t = w.nearestExcluding(0, 0, range, EXCL, 1);
    if (t < 0) { this.charges = FOCAL_CHARGES - 1; return; }   // nothing to fire at: keep it charged
    const cause = w.emit(Ev.Anomaly, FOCAL, t, FOCAL_CHARGES, 0, 0, hit.eventId);
    const a = atan2(w.enemies.y[t], w.enemies.x[t]);
    w.spawnProjectile({ kind: ProjKind.Bullet, source: 0, srcTag: FOCAL, x: 0, y: 0, vx: cos(a) * FOCAL_SPEED, vy: sin(a) * FOCAL_SPEED,
      damage: FOCAL_MUL * w.stats.get('ballistics.damage'), radius: 6, life: Math.ceil(((ARENA_RADIUS * 1.2) / FOCAL_SPEED) * TICK_RATE),
      pierce: 255, retention: 1, target: t, flags: ProjFlag.Duplicate, cause });
  }
}
