/**
 * WP3 shared helpers for the hardpoint systems, Linkages and Infusions. Pure functions and
 * preallocated scratch only (no per-tick allocation); systems never import each other, but they
 * may all import this module.
 *
 * Per-projectile private bits (ProjectilePool.hpBits, WP3 addition):
 *   HB_SEEK       WP3 seeker: steered by ordnance (source 1) / drones (Microdrone) at their own turn
 *                 rate instead of the core Homing blend. Jammer auras suspend the steering.
 *   HB_RETARGET   2-bit counter of Overkill Guidance retargets used
 *   HB_SPLIT      cluster split done / fragment (never splits again)
 *   HB_ROCKET     Swarm rocket (Afterburner acceleration)
 *   HB_PAYLOAD    Payload Well radius bonus applied
 *   HB_CHARGED    Charged Warheads split applied
 *   HB_SLING_*    Slingshot: 8-bit mask of well slots already passed (slot & 7)
 *   HB_LENS_*     Lensing: 8-bit mask of well slots already lensed (slot & 7)
 *   HB_WHET       Whetstone pierce granted; HB_ENERGIZED Energized Rounds applied; HB_FOCAL Focal Point
 *   HB_CASING     Shell Casing crit applied; HB_CASCADE cascade rocket (rendered smaller)
 */
import type { World, DerivedStats } from '../../core/world';
import type { ElementId, HardpointId } from '../../core/ids';
import { EnemyFlag, NO_ENTITY, ProjFlag, ProjKind, TOWER_RADIUS } from '../../core/types';
import { ELITE_LIST, enemyDefByIndex } from '../../core/content';
import { atan2, cos, sin, growth } from '../../math/lut';

export const HB_SEEK = 1 << 0;
export const HB_RETARGET_SHIFT = 1;
export const HB_RETARGET_MASK = 3 << 1;
export const HB_SPLIT = 1 << 3;
export const HB_ROCKET = 1 << 4;
export const HB_PAYLOAD = 1 << 5;
export const HB_CHARGED = 1 << 6;
export const HB_SLING_SHIFT = 8;
export const HB_LENS_SHIFT = 16;
export const HB_WHET = 1 << 24;
export const HB_ENERGIZED = 1 << 25;
export const HB_FOCAL = 1 << 26;
export const HB_CASING = 1 << 27;
export const HB_CASCADE = 1 << 28;

/** Projectile `source` indices (SYSTEM_ORDER_IDS). */
export const SRC_PRIMARY = 0, SRC_ORDNANCE = 1, SRC_DRONES = 2, SRC_BLADE = 3, SRC_LASER = 4, SRC_GRAVITICS = 5;

export const ELEMENTS: readonly ElementId[] = ['fire', 'lightning', 'poison', 'frost'];
export function elementIndex(el: ElementId | null): number { return el ? ELEMENTS.indexOf(el) + 1 : 0; }
export function elementAt(idx: number): ElementId | null { return idx > 0 ? ELEMENTS[idx - 1] ?? null : null; }

/** Element carried by a hardpoint's hits: the first infused element (fire → lightning → poison → frost) with rank ≥ 1. */
export function infusedElement(s: DerivedStats, sys: HardpointId): ElementId | null {
  for (let k = 0; k < 4; k++) if (s.has(`infuse.${sys}.${ELEMENTS[k]}`)) return ELEMENTS[k];
  return null;
}

/** Common global speed factors for hardpoint cadence. */
export function globalRate(w: World): number {
  const d = w.dynamicSpeedMul;
  return Math.max(0.05, w.stats.get('reactor.global_attack_speed')) * (d > 0 ? d : 1);
}
export function cooldownFactor(s: DerivedStats): number {
  const c = s.get('reactor.cooldown_reduction');
  return 1 - (c > 0.75 ? 0.75 : c < 0 ? 0 : c);
}

const JAMMING_BIT = 1 << Math.max(0, ELITE_LIST.indexOf('jamming'));
const REFRACTING_BIT = 1 << Math.max(0, ELITE_LIST.indexOf('refracting'));

export function isJammer(w: World, i: number): boolean {
  const e = w.enemies;
  return (e.flags[i] & EnemyFlag.Jams) !== 0 || (e.eliteMods[i] & JAMMING_BIT) !== 0;
}
export function isRefractor(w: World, i: number): boolean {
  const e = w.enemies;
  return (e.flags[i] & EnemyFlag.Refracts) !== 0 || (e.eliteMods[i] & REFRACTING_BIT) !== 0;
}

/** Refresh the per-tick Jammer aura cache on world.shared (once per tick). */
export function refreshJammers(w: World): void {
  const sh = w.shared;
  if (sh.jammerTick === w.tick) return;
  sh.jammerTick = w.tick;
  const e = w.enemies, cap = (sh.jammers.length / 3) | 0;
  let n = 0;
  for (let i = 0; i < e.count && n < cap; i++) {
    if (e.flags[i] & EnemyFlag.Dead) continue;
    if (!isJammer(w, i)) continue;
    const r = enemyDefByIndex(e.kind[i]).auraRadius ?? 140;
    sh.jammers[n * 3] = e.x[i]; sh.jammers[n * 3 + 1] = e.y[i]; sh.jammers[n * 3 + 2] = r > 0 ? r : 140;
    n++;
  }
  sh.jammerCount = n;
}
/** Is (x,y) inside any Jammer aura this tick? */
export function jammedAt(w: World, x: number, y: number): boolean {
  refreshJammers(w);
  const sh = w.shared, j = sh.jammers;
  for (let k = 0; k < sh.jammerCount; k++) {
    const dx = x - j[k * 3], dy = y - j[k * 3 + 1], r = j[k * 3 + 2];
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/** Squared distance from point P to segment AB. */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const qx = px - (ax + dx * t), qy = py - (ay + dy * t);
  return qx * qx + qy * qy;
}
/** Parameter t ∈ [0,1] of P's projection on AB. */
export function segParam(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t;
}

/**
 * Depth-indexed scratch buffers so nested hooks (damage → onHit → query → damage ...) never clobber
 * an outer loop's query results. push() before a query, pop() after the loop.
 */
export class ScratchStack {
  private bufs: Int32Array[] = [];
  private depth = 0;
  constructor(private size = 1024, levels = 4) { for (let i = 0; i < levels; i++) this.bufs.push(new Int32Array(size)); }
  push(): Int32Array {
    const d = this.depth++;
    while (this.bufs.length <= d) this.bufs.push(new Int32Array(this.size));   // warm-up growth only
    return this.bufs[d];
  }
  pop(): void { if (this.depth > 0) this.depth--; }
}
export const SCRATCH = new ScratchStack(1024, 8);

/**
 * Enemies (not Dead) whose body touches the capsule AB with half-width `hw`. Writes into `out`;
 * returns the count. Deterministic (spatial-hash order).
 */
export function querySegment(w: World, ax: number, ay: number, bx: number, by: number, hw: number, out: Int32Array): number {
  const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
  const dx = bx - ax, dy = by - ay;
  const half = Math.sqrt(dx * dx + dy * dy) * 0.5;
  const n = w.queryRadius(mx, my, half + hw, out);
  const e = w.enemies;
  let k = 0;
  for (let j = 0; j < n; j++) {
    const i = out[j];
    const rr = hw + e.radius[i];
    if (segDist2(e.x[i], e.y[i], ax, ay, bx, by) <= rr * rr) out[k++] = i;
  }
  return k;
}

/** Can a weapon target this enemy (alive, not phased/burrowed/allied)? */
export function targetableEnemy(w: World, i: number): boolean {
  if (i < 0 || i >= w.enemies.count) return false;
  return (w.enemies.flags[i] & (EnemyFlag.Dead | EnemyFlag.Phased | EnemyFlag.Burrowed | EnemyFlag.Ally)) === 0;
}

/**
 * Densest spot: among up to `samples` live enemies within `range` of (cx,cy) (evenly strided through
 * the query result), the one whose `radius` neighbourhood holds the most enemies (tie → lower index).
 * `avoid` (x,y,r triples, `avoidN` of them) excludes candidates inside those circles. Returns the
 * enemy index or NO_ENTITY; `score` receives the neighbour count via bestScore.
 */
export let bestScore = 0;
export function densestEnemy(w: World, cx: number, cy: number, range: number, radius: number, samples: number, avoid?: Float32Array, avoidN = 0): number {
  const cand = SCRATCH.push();
  const tmp = SCRATCH.push();
  const n = w.queryRadius(cx, cy, range, cand);
  const e = w.enemies;
  let best = NO_ENTITY, bestN = 0;
  const step = n > samples ? n / samples : 1;
  const m = n > samples ? samples : n;
  for (let s = 0; s < m; s++) {
    const i = cand[Math.floor(s * step)];
    if (!targetableEnemy(w, i)) continue;
    const x = e.x[i], y = e.y[i];
    let skip = false;
    for (let a = 0; a < avoidN; a++) {
      const dx = x - avoid![a * 4], dy = y - avoid![a * 4 + 1], r = avoid![a * 4 + 2];
      if (dx * dx + dy * dy < r * r) { skip = true; break; }
    }
    if (skip) continue;
    const c = w.queryRadius(x, y, radius, tmp);
    if (c > bestN || (c === bestN && best >= 0 && i < best)) { best = i; bestN = c; }
  }
  SCRATCH.pop(); SCRATCH.pop();
  bestScore = bestN;
  return best;
}

export interface SeekerInit {
  kind: number; source: number; srcTag: string;
  x: number; y: number; angle: number; speed: number;
  damage: number; radius: number; blast: number; life: number;
  target: number; element: ElementId | null; cause: number; bits: number; pierce?: number; flags?: number;
}
/** Spawn a WP3-steered projectile (missile / rocket / fragment / microdrone). Returns its index or -1. */
export function spawnSeeker(w: World, s: SeekerInit): number {
  const i = w.spawnProjectile({
    kind: s.kind, source: s.source, srcTag: s.srcTag, x: s.x, y: s.y,
    vx: cos(s.angle) * s.speed, vy: sin(s.angle) * s.speed, damage: s.damage, radius: s.radius,
    blast: s.blast, life: s.life, target: s.target, element: s.element, cause: s.cause,
    pierce: s.pierce ?? 0, flags: s.flags ?? 0,
  });
  if (i >= 0) w.projectiles.hpBits[i] = s.bits | HB_SEEK;
  return i;
}

/** Stats a missile launched from the rack uses (shared by ordnance and chassis linkages). */
export function launchRackMissile(w: World, target: number, damage: number, srcTag: string, cause: number, angleOffset = 0): number {
  const s = w.stats, e = w.enemies;
  const speed = Math.max(60, s.get('ordnance.missile_speed'));
  const range = s.get('ordnance.range');
  const tx = target >= 0 ? e.x[target] : 1, ty = target >= 0 ? e.y[target] : 0;
  const a = atan2(ty, tx) + angleOffset;
  return spawnSeeker(w, {
    kind: ProjKind.Missile, source: SRC_ORDNANCE, srcTag, x: cos(a) * TOWER_RADIUS, y: sin(a) * TOWER_RADIUS, angle: a, speed,
    damage, radius: 4, blast: s.get('ordnance.blast_radius'), life: Math.ceil((range * 2.2 / speed) * 60),
    target, element: infusedElement(s, 'ordnance'), cause, bits: 0,
  });
}

/** Spawn a microdrone (Carrier / Spotter). */
export function launchMicrodrone(w: World, x: number, y: number, angle: number, target: number, damage: number, lifeSeconds: number, element: ElementId | null, srcTag: string, cause: number): number {
  return spawnSeeker(w, {
    kind: ProjKind.Microdrone, source: SRC_DRONES, srcTag, x, y, angle, speed: 260, damage, radius: 3, blast: 0,
    life: Math.ceil(lifeSeconds * 60), target, element, cause, bits: 0, pierce: 255, flags: ProjFlag.FromDrone,
  });
}

/**
 * Steer projectile i toward (tx,ty) by at most `maxTurn` radians this tick (speed preserved).
 */
export function steerToward(w: World, i: number, tx: number, ty: number, maxTurn: number): void {
  const p = w.projectiles;
  const vx = p.vx[i], vy = p.vy[i];
  const sp = Math.sqrt(vx * vx + vy * vy);
  if (sp < 1e-6) return;
  const cur = atan2(vy, vx);
  const want = atan2(ty - p.y[i], tx - p.x[i]);
  let d = want - cur;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (d > maxTurn) d = maxTurn; else if (d < -maxTurn) d = -maxTurn;
  const a = cur + d;
  p.vx[i] = cos(a) * sp; p.vy[i] = sin(a) * sp;
}

/** Is projectile i's remembered target still the same live, targetable enemy? */
export function projTargetValid(w: World, i: number): boolean {
  const p = w.projectiles, t = p.target[i];
  if (t < 0 || t >= w.enemies.count) return false;
  if (w.enemies.gen[t] !== p.targetGen[i]) return false;
  return targetableEnemy(w, t);
}
export function setProjTarget(w: World, i: number, t: number): void {
  const p = w.projectiles;
  p.target[i] = t; p.targetGen[i] = t >= 0 ? w.enemies.gen[t] : 0;
}

/** Contact damage per second of enemy i against a structure (laser nodes). */
export function contactDps(w: World, i: number): number {
  return w.enemies.contact[i] * growth(1.06, w.run.wave);
}

/** Which well (index into shared.wells) holds (x,y), or -1. */
export function wellAt(w: World, x: number, y: number): number {
  const sh = w.shared, W = sh.wells;
  for (let k = 0; k < sh.wellCount; k++) {
    const dx = x - W[k * 4], dy = y - W[k * 4 + 1], r = W[k * 4 + 2];
    if (dx * dx + dy * dy <= r * r) return k;
  }
  return -1;
}

/** Throttle helper: returns true (and records) when at least `gap` ticks passed since last[k]. */
export function every(last: Int32Array, k: number, tick: number, gap: number): boolean {
  if (tick - last[k] < gap) return false;
  last[k] = tick;
  return true;
}

/**
 * Remap a per-enemy typed array after pool compaction (remap[old] = new or -1). Values move with
 * their enemy; slots at/after the new count are reset to `fill`. Compaction only moves entities
 * DOWN into freed slots, so one ascending pass is safe.
 */
export function remapArray(arr: Float32Array | Int32Array | Uint16Array | Uint8Array, remap: Int32Array, oldCount: number, newCount: number, fill: number): void {
  for (let i = 0; i < oldCount; i++) {
    const j = remap[i];
    if (j >= 0 && j !== i) arr[j] = arr[i];
  }
  for (let i = newCount; i < oldCount; i++) arr[i] = fill;
}

/** Element colors (mirrors render/palette.ts ELEMENT_COLORS; the sim may not import render code). */
export const ELEMENT_RGB: readonly (readonly [number, number, number])[] = [
  [1.0, 0.56, 0.16], [0.98, 0.93, 0.36], [0.28, 0.9, 0.6], [0.4, 0.78, 1.0],
];
