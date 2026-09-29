/**
 * The tower wears its build (graphics pass). Presentation only: reads a plain `TowerView` and writes
 * layer-0 instances (the hull, hardpoint mounts, attunement runes, shields, cracks, ornament) plus the
 * primary's barrel housing, recoil and muzzle flash. Shared by core/snapshot.ts and the showcase.
 *
 *  - Nine Frames, nine hulls (hex, fortress, coil, monolith, hive, cog, echo, prism, singularity).
 *  - Hardpoints sit on the hull's diagonals: ordnance pod, drone bay (docked drones while none fly),
 *    blade hub, laser emitter, gravitics core.
 *  - Attunements: element-coloured rune arcs with the status glyph (flame, bolt, droplet, flake).
 *  - Ornament grows with the deepest wave: bare at wave 1, rings, ticks, crown and filigree by 100.
 */
import { InstFlag, INST_FLAG_SCALE, Shape, TOWER_RADIUS } from './types';
import { cos, sin, TAU, PI } from '../math/lut';
import type { ArtWriter } from './snapshot-art';

export class TowerView {
  x = 0; y = 0; scale = 1;
  frame = 'standard';
  hardpoints: readonly (string | null)[] = [];
  attunements: readonly (string | null)[] = [];
  /** Deepest wave reached (ornament level). */
  deepest = 0;
  hpFrac = 1; shieldFrac = 0; barrierFrac = 0; barrierR = 70; tempHp = false;
  aim = 0;
  /** 0..1: a primary round just left the barrel. */
  firing = 0;
  tick = 0;
  /** Drones currently deployed (docked drones show while this is 0). */
  dronesOut = 0;
}

const R = TOWER_RADIUS;
const L_FLASH = 2 + INST_FLAG_SCALE * InstFlag.Flash;
export const FRAME_IDS = ['standard', 'arsenal', 'conductor', 'monolith', 'hive', 'bulwark', 'echo_engine', 'prism', 'singularity_core'] as const;
/** Hull tint per frame. */
const HULL: Record<string, readonly [number, number, number]> = {
  standard: [0.78, 0.88, 1], arsenal: [0.66, 0.7, 0.76], conductor: [0.92, 0.72, 0.46], monolith: [0.5, 0.52, 0.6],
  hive: [0.9, 0.84, 0.42], bulwark: [0.74, 0.62, 0.46], echo_engine: [0.52, 0.94, 0.88], prism: [0.86, 0.9, 1], singularity_core: [0.3, 0.2, 0.46],
};
const EL: Record<string, readonly [number, number, number]> = { fire: [1, 0.56, 0.16], lightning: [0.98, 0.93, 0.36], poison: [0.28, 0.9, 0.6], frost: [0.4, 0.78, 1] };
const EL_GLYPH: Record<string, number> = { fire: Shape.Drop, lightning: Shape.Shard, poison: Shape.Circle, frost: Shape.Star };

let ox = 0, oy = 0, sc = 1;
function put(out: ArtWriter, x: number, y: number, r: number, rot: number, shape: number, cr: number, cg: number, cb: number, a: number, layer = 0, aux0 = 0, aux1 = 0): void {
  out.push(ox + x * sc, oy + y * sc, r * sc, rot, shape, cr, cg, cb, a, layer, aux0, aux1);
}
function line(out: ArtWriter, x0: number, y0: number, x1: number, y1: number, w: number, cr: number, cg: number, cb: number, a: number, layer = 0): void {
  out.push(ox + x0 * sc, oy + y0 * sc, w * sc, 0, Shape.Line, cr, cg, cb, a, layer, ox + x1 * sc, oy + y1 * sc);
}

/** Hull, mounts, runes, shields, cracks and ornament (drawn before the systems' own visuals). */
export function writeTowerBase(out: ArtWriter, v: TowerView): number {
  const start = out.count;
  ox = v.x; oy = v.y; sc = v.scale;
  const t = v.tick, deep = v.deepest;
  const c = HULL[v.frame] ?? HULL.standard;
  const dr = c[0] * 0.32, dg = c[1] * 0.32, db = c[2] * 0.36;
  // ---- ornament under the hull (grows with depth)
  if (deep >= 5) put(out, 0, 0, R * 1.95, 0, Shape.Ring, c[0], c[1], c[2], 0.22, 0, 0.03);
  if (deep >= 20) for (let k = 0; k < 6; k++) { const a = k * (TAU / 6) + PI / 6; put(out, cos(a) * R * 2.2, sin(a) * R * 2.2, 3, a, Shape.Diamond, c[0], c[1], c[2], 0.55); }
  if (deep >= 40) for (let k = 0; k < 3; k++) put(out, 0, 0, R * 2.65, t * 0.004 + k * (TAU / 3), Shape.Arc, c[0], c[1], c[2], 0.4, 0, 0.05);
  if (deep >= 60) put(out, 0, 0, R * 1.7, -t * 0.003, Shape.Star, dr * 1.6, dg * 1.6, db * 1.6, 0.9);
  if (deep >= 80) for (let k = 0; k < 8; k++) { const a = -t * 0.006 + k * (TAU / 8); put(out, cos(a) * R * 3.05, sin(a) * R * 3.05, 2.6, a, Shape.Diamond, 1, 0.86, 0.45, 0.7); }
  if (deep >= 100) {
    put(out, 0, 0, R * 3.4, 0, Shape.Ring, 1, 0.84, 0.36, 0.45, 0, 0.025);
    for (let k = 0; k < 4; k++) { const a = t * 0.01 + k * (TAU / 4); put(out, cos(a) * R * 3.4, sin(a) * R * 3.4, 2.2, 0, Shape.Circle, 1, 0.92, 0.6, 0.9); }
  }
  // ---- attunement runes: element arcs with the status glyph at their middle
  const na = v.attunements.length;
  for (let j = 0; j < na; j++) {
    const el = v.attunements[j];
    if (!el) continue;
    const col = EL[el] ?? EL.fire;
    const a = t * 0.005 + (j * TAU) / Math.max(1, na) - PI / 2;
    put(out, 0, 0, R * 1.55, a, Shape.Arc, col[0], col[1], col[2], 0.9, 0, 0.1);
    put(out, cos(a) * R * 1.55, sin(a) * R * 1.55, 3.4, -PI / 2, EL_GLYPH[el] ?? Shape.Circle, col[0], col[1], col[2], 1);
  }
  // ---- hull per Frame
  writeHull(out, v.frame, c, dr, dg, db, t);
  // ---- hardpoint mounts on the diagonals
  for (let s = 0; s < v.hardpoints.length && s < 4; s++) {
    const hp = v.hardpoints[s];
    if (!hp) continue;
    const a = PI / 4 + s * (PI / 2);
    writeMount(out, hp, cos(a) * R * 1.02, sin(a) * R * 1.02, a, t, v.dronesOut);
  }
  // ---- core light
  put(out, 0, 0, R * 0.28, 0, Shape.Circle, 0.9, 0.98, 1, 1);
  // ---- damage cracks (and slow sparks under a quarter HP, 2 Hz)
  const hp = v.hpFrac;
  if (hp < 0.5) line(out, -R * 0.55, -R * 0.2, R * 0.1, R * 0.35, 0.9, 0.05, 0.05, 0.08, 0.9);
  if (hp < 0.3) line(out, R * 0.15, -R * 0.6, R * 0.5, R * 0.05, 0.8, 0.05, 0.05, 0.08, 0.9);
  if (hp < 0.15) line(out, -R * 0.2, R * 0.55, -R * 0.65, R * 0.15, 0.8, 0.05, 0.05, 0.08, 0.9);
  if (hp < 0.25 && ((t / 15) | 0) % 2 === 0) put(out, R * 0.1, R * 0.35, 3.2, t * 0.3, Shape.Star, 1, 0.7, 0.3, 0.9, L_FLASH);
  // ---- Bastion shield (hex-cell ring) and Aegis barrier (rotating plates)
  if (v.shieldFrac > 0) {
    put(out, 0, 0, R + 7, t * 0.01, Shape.Hex, 0.45, 0.8, 1, 0.12 + 0.18 * v.shieldFrac, 2);
    put(out, 0, 0, R + 7, 0, Shape.Ring, 0.45, 0.8, 1, 0.35 + 0.5 * v.shieldFrac, 0, 0.08);
  }
  if (v.barrierFrac > 0) {
    const plates = 6;
    for (let k = 0; k < plates; k++) put(out, 0, 0, v.barrierR, t * 0.006 + k * (TAU / plates), Shape.Arc, 0.55, 0.85, 1, 0.25 + 0.45 * v.barrierFrac, 2, 0.05);
  }
  if (v.tempHp) put(out, 0, 0, R * 1.3, 0, Shape.Ring, 1, 0.85, 0.5, 0.45, 0, 0.06);
  return out.count - start;
}

function writeHull(out: ArtWriter, frame: string, c: readonly [number, number, number], dr: number, dg: number, db: number, t: number): void {
  switch (frame) {
    case 'arsenal':
      put(out, 0, 0, R * 1.02, 0, Shape.Square, c[0], c[1], c[2], 1);
      for (let k = 0; k < 4; k++) { const a = PI / 4 + k * (PI / 2); put(out, cos(a) * R * 0.95, sin(a) * R * 0.95, R * 0.34, 0, Shape.Square, dr * 2, dg * 2, db * 2, 1); }
      put(out, 0, 0, R * 0.6, 0, Shape.Square, dr, dg, db, 1);
      break;
    case 'conductor':
      put(out, 0, 0, R * 0.98, 0, Shape.Circle, c[0], c[1], c[2], 1);
      put(out, 0, 0, R * 0.8, 0, Shape.Ring, dr, dg, db, 1, 0, 0.12);
      put(out, 0, 0, R * 0.56, 0, Shape.Ring, dr, dg, db, 1, 0, 0.16);
      for (let k = 0; k < 3; k++) { const a = -PI / 2 + k * (TAU / 3); put(out, cos(a) * R * 1.12, sin(a) * R * 1.12, R * 0.26, a, Shape.Diamond, 0.98, 0.93, 0.36, 1); }
      break;
    case 'monolith':
      put(out, 0, 0, R * 1.15, PI / 8, Shape.Octagon, c[0], c[1], c[2], 1);
      put(out, 0, 0, R * 0.85, PI / 8, Shape.Octagon, dr, dg, db, 1);
      put(out, 0, 0, R * 0.55, PI / 8, Shape.Octagon, c[0] * 0.8, c[1] * 0.8, c[2] * 0.9, 1);
      break;
    case 'hive':
      put(out, 0, 0, R * 0.95, 0, Shape.Hex, c[0], c[1], c[2], 1);
      for (let k = 0; k < 6; k++) { const a = k * (TAU / 6); put(out, cos(a) * R * 0.58, sin(a) * R * 0.58, R * 0.27, 0, Shape.Hex, dr * 1.6, dg * 1.6, db * 1.6, 1); }
      break;
    case 'bulwark':
      put(out, 0, 0, R * 1.18, t * 0.002, Shape.Gear, c[0], c[1], c[2], 1);
      put(out, 0, 0, R * 0.78, 0, Shape.Ring, dr, dg, db, 1, 0, 0.3);
      put(out, 0, 0, R * 0.42, PI / 4, Shape.Square, dr * 2.2, dg * 2.2, db * 2.2, 1);
      break;
    case 'echo_engine':
      put(out, 3.5 * cos(t * 0.03), 3.5 * sin(t * 0.03), R, t * 0.006, Shape.Hex, c[0], c[1], c[2], 0.3);
      put(out, 0, 0, R, 0, Shape.Hex, c[0], c[1], c[2], 1);
      put(out, 0, 0, R * 1.35, 0, Shape.Ring, c[0], c[1], c[2], 0.5, 0, 0.05);
      put(out, 0, 0, R * 0.6, 0, Shape.Hex, dr, dg, db, 1);
      break;
    case 'prism':
      put(out, 0, 0, R * 1.08, -PI / 2, Shape.Triangle, c[0], c[1], c[2], 1);
      put(out, 0, 0, R * 1.08, PI / 2, Shape.Triangle, 1, 0.62, 0.9, 0.85);
      put(out, 0, 0, R * 0.45, 0, Shape.Diamond, 0.6, 0.95, 1, 1);
      break;
    case 'singularity_core':
      put(out, 0, 0, R * 1.35, t * 0.02, Shape.Arc, 0.7, 0.45, 1, 0.9, 0, 0.14);
      put(out, 0, 0, R * 1.35, t * 0.02 + PI, Shape.Arc, 0.7, 0.45, 1, 0.9, 0, 0.14);
      put(out, 0, 0, R * 0.95, 0, Shape.Circle, c[0], c[1], c[2], 1);
      put(out, 0, 0, R * 0.62, 0, Shape.Ring, 0.8, 0.55, 1, 1, 0, 0.2);
      put(out, 0, 0, R * 0.42, 0, Shape.Circle, 0.02, 0, 0.04, 1);
      break;
    default:   // standard
      put(out, 0, 0, R, 0, Shape.Hex, c[0], c[1], c[2], 1);
      put(out, 0, 0, R * 0.62, 0, Shape.Hex, dr, dg, db, 1);
      break;
  }
}

function writeMount(out: ArtWriter, hp: string, x: number, y: number, a: number, t: number, dronesOut: number): void {
  switch (hp) {
    case 'ordnance':
      put(out, x, y, 7.5, a, Shape.Square, 0.55, 0.5, 0.45, 1);
      put(out, x + cos(a + 1.2) * 3.5, y + sin(a + 1.2) * 3.5, 2.3, 0, Shape.Circle, 1, 0.62, 0.25, 1);
      put(out, x + cos(a - 1.2) * 3.5, y + sin(a - 1.2) * 3.5, 2.3, 0, Shape.Circle, 1, 0.62, 0.25, 1);
      break;
    case 'drones':
      put(out, x, y, 7.5, 0, Shape.Hex, 0.3, 0.5, 0.6, 1);
      if (dronesOut === 0) for (let k = 0; k < 3; k++) { const b = a + (k - 1) * 0.9; put(out, x + cos(b) * 3.8, y + sin(b) * 3.8, 2.8, b, Shape.Triangle, 0.45, 0.9, 1, 1); }
      else put(out, x, y, 3.2, 0, Shape.Circle, 0.45, 0.9, 1, 0.9);
      break;
    case 'blade':
      put(out, x, y, 7, t * 0.12, Shape.Star, 0.82, 0.88, 1, 1);
      put(out, x, y, 2.4, 0, Shape.Circle, 0.25, 0.3, 0.4, 1);
      break;
    case 'laser':
      put(out, x, y, 7, 0, Shape.Ring, 1, 0.45, 0.85, 1, 0, 0.3);
      put(out, x, y, 3, a, Shape.Diamond, 1, 0.8, 0.95, 1);
      put(out, 0, 0, R * 1.26, 0, Shape.Ring, 1, 0.45, 0.85, 0.55, 0, 0.04);
      break;
    case 'gravitics':
      put(out, x, y, 6.5, 0, Shape.Circle, 0.35, 0.2, 0.6, 1);
      for (let k = 0; k < 2; k++) { const b = t * 0.08 + k * PI; put(out, x + cos(b) * 6, y + sin(b) * 6, 1.8, 0, Shape.Circle, 0.8, 0.65, 1, 1); }
      break;
    default: break;
  }
}

/** Barrel housing (recoils), drawn over the primary's own line, and the muzzle flash (drawn after the systems). */
export function writeTowerTop(out: ArtWriter, v: TowerView): number {
  const start = out.count;
  ox = v.x; oy = v.y; sc = v.scale;
  const a = v.aim, c = cos(a), s = sin(a);
  const heavy = v.frame === 'monolith' ? 1.35 : 1;
  const recoil = v.firing * 3.2;
  const d = R * 0.78 - recoil;
  const col = HULL[v.frame] ?? HULL.standard;
  put(out, c * d, s * d, 9 * heavy, a, Shape.Capsule, col[0] * 0.55, col[1] * 0.55, col[2] * 0.6, 1);
  put(out, c * (d + 5), s * (d + 5), 3.2 * heavy, a, Shape.Capsule, 0.9, 0.95, 1, 1);
  if (v.firing > 0.05) put(out, c * (R * 1.5 - recoil), s * (R * 1.5 - recoil), 7 * heavy * (0.6 + 0.4 * v.firing), a, Shape.Star, 1, 0.92, 0.65, 0.9 * v.firing, L_FLASH);
  return out.count - start;
}
