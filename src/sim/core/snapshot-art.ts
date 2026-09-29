/**
 * Enemy and boss art for the render snapshot (graphics pass). Presentation only: every function here
 * READS a plain `EnemyView` (filled from the pools by core/snapshot.ts, or synthetically by the
 * `#dev:showcase` harness) and writes instances; nothing touches sim state or the sim PRNG.
 *
 * Per enemy (see types.ts InstFlag / RStatus / AnimKind):
 *   body     layer 4, unflagged (pickers and tests see exactly one per enemy), aux0 = hp bar,
 *            aux1 = packed status | phase | idle-animation kind | rate (renderer animates it)
 *   parts    layer 4|6, flag Part (aux1 = body instance index) — the composite silhouette (≤ 3),
 *            then status marks (≤ 2), elite crown; dropped (LOD) when `v.lod`
 *   outline  layer 5, halo layer 6 (unflagged, same packed aux1 so they breathe with the body)
 *   telegraphs  layer 7 lines / rings (artillery aim, healer pulse, charger wind-up glow)
 * Bosses: the body plus a per-boss table of moving parts, phase-dependent plates and weak-point nodes.
 */
import { AnimKind, AnimRate, EnemyFlag, INST_FLAG_SCALE, InstFlag, RStatus, Shape } from './types';
import type { BossDef } from '../data/schema';
import { cos, sin, TAU, PI } from '../math/lut';
import { kindIndex, bossIndex } from './content';

/** What the art writers need; the snapshot reuses one instance for every enemy (no allocation). */
export interface ArtWriter {
  readonly count: number;
  push(x: number, y: number, radius: number, rot: number, shape: number, r: number, g: number, b: number, a: number, layer: number, aux0?: number, aux1?: number): void;
}

export class EnemyView {
  x = 0; y = 0; r = 10;
  /** Facing (radians, toward where it is heading). */
  facing = 0;
  kind = 0;
  cr = 1; cg = 1; cb = 1; alpha = 1;
  /** Shape of the def (the LOD base silhouette). */
  shape: number = Shape.Circle;
  /** HP bar fraction (aux0 of the body; 0 = no bar). */
  hp = 1;
  status = 0;            // RStatus mask
  flags = 0;             // EnemyFlag
  eliteMods = 0;
  /** Boss index into BOSS_LIST (bosses and boss clones), else -1. */
  bossId = -1;
  bossPhase = 0;
  bossDef: BossDef | null = null;
  phase = 0;             // animation phase 0..63
  tick = 0;
  spawnAge = 9999;       // ticks since spawn
  flash = 0;             // 0..1 hit flash intensity (rate-limited by the snapshot)
  squash = 0;            // 0..1 hit squash
  wobble = 0;            // knockback wobble (radians, added to the facing)
  aiI = 0; aiA = 0; aiB = 0; attackT = 0; gen = 0;
  shieldFrac = 0;
  clump = 0;
  dist = 100;            // distance to the tower
  chilled = false; frozen = false;
  /** Outline colour/alpha (layer 5). */
  or = 0.05; og = 0.05; ob = 0.08; oa = 0.85;
  halo = false;
  /** Boss tell progress 0..1 while this boss's tell is live, else -1. */
  tell = -1;
  /** Composite parts off (enemy-count LOD). Telegraphs, crowns and the ice shell stay. */
  lod = false;
  /** Healer pulse / charger telegraph budget flags set by the caller. */
  allowPulse = true;
}

// ------------------------------------------------------------------ family table
const K = {
  grunt: kindIndex('grunt'), swarm: kindIndex('swarm'), runner: kindIndex('runner'), brute: kindIndex('brute'),
  kamikaze: kindIndex('kamikaze'), shielded: kindIndex('shielded'), splitter: kindIndex('splitter'), carrier: kindIndex('carrier'),
  healer: kindIndex('healer'), leech: kindIndex('leech'), veteran: kindIndex('veteran'), armored: kindIndex('armored'),
  warden: kindIndex('warden'), artillery: kindIndex('artillery'), charger: kindIndex('charger'), anchor: kindIndex('anchor'),
  phase: kindIndex('phase'), burrower: kindIndex('burrower'), nullifier: kindIndex('nullifier'), refractor: kindIndex('refractor'),
  jammer: kindIndex('jammer'), fragment: kindIndex('splitter_fragment'), brood: kindIndex('brood'), clump: kindIndex('clump'),
  bossAdd: kindIndex('boss_add'), boss: kindIndex('boss'),
} as const;

/** The 21 families plus sub-units, in pool-kind order (for tests and the showcase). */
export const FAMILY_KINDS: readonly number[] = [
  K.grunt, K.swarm, K.runner, K.brute, K.kamikaze, K.shielded, K.splitter, K.carrier, K.healer, K.leech, K.veteran,
  K.armored, K.warden, K.artillery, K.charger, K.anchor, K.phase, K.burrower, K.nullifier, K.refractor, K.jammer,
];
export const SUBUNIT_KINDS: readonly number[] = [K.fragment, K.brood, K.clump, K.bossAdd];

/** Idle animation per kind (index = pool kind). */
const ANIM: number[] = [];
/** Composite body shape per kind (-1 = the def shape). */
const BODY: number[] = [];
function fam(k: number, anim: AnimKind, body = -1): void { ANIM[k] = anim; BODY[k] = body; }
fam(K.grunt, AnimKind.Breathe); fam(K.swarm, AnimKind.Jitter); fam(K.runner, AnimKind.Sway); fam(K.brute, AnimKind.Heavy);
fam(K.kamikaze, AnimKind.Spin); fam(K.shielded, AnimKind.Breathe); fam(K.splitter, AnimKind.Wobble); fam(K.carrier, AnimKind.Pulse, Shape.Hex);
fam(K.healer, AnimKind.Pulse, Shape.Circle); fam(K.leech, AnimKind.Sway); fam(K.veteran, AnimKind.Breathe); fam(K.armored, AnimKind.Heavy);
fam(K.warden, AnimKind.SlowSpin, Shape.Hex); fam(K.artillery, AnimKind.Heavy, Shape.Triangle); fam(K.charger, AnimKind.Wobble); fam(K.anchor, AnimKind.Heavy, Shape.Square);
fam(K.phase, AnimKind.Sway); fam(K.burrower, AnimKind.Wobble); fam(K.nullifier, AnimKind.SlowSpin); fam(K.refractor, AnimKind.SlowSpin);
fam(K.jammer, AnimKind.Spin); fam(K.fragment, AnimKind.Jitter); fam(K.brood, AnimKind.Jitter); fam(K.clump, AnimKind.Wobble);
fam(K.bossAdd, AnimKind.Breathe); fam(K.boss, AnimKind.Heavy);

export function familyAnim(kind: number): number { return ANIM[kind] ?? AnimKind.Breathe; }

/** Pack aux1 for unflagged layer 4/5/6 instances. */
export function packAnim(status: number, phase: number, anim: number, rate: number): number {
  return (status & 255) | ((phase & 63) << 8) | ((anim & 15) << 14) | ((rate & 3) << 18);
}

/** Layer float with flags (types.ts INST_FLAG_SCALE). */
export function flagged(layer: number, flags: number): number { return layer + INST_FLAG_SCALE * flags; }

const PART = flagged(4, InstFlag.Part);
const PART_DETAIL = flagged(4, InstFlag.Part | InstFlag.Detail);
const PART_FLASH = flagged(4, InstFlag.Part | InstFlag.Flash);
const HALO_PART = flagged(6, InstFlag.Part | InstFlag.Detail);
const HALO_SOFT = flagged(6, InstFlag.Part | InstFlag.Detail | InstFlag.Soft);

/** Largest composite part count any family writes (budget; see tests/render/composite.test.ts). */
export const MAX_COMPOSITE_PARTS = 3;
export const MAX_STATUS_PARTS = 2;

// ------------------------------------------------------------------ writer
let bodyIdx = 0;
let bx = 0, by = 0, br = 0, fc = 0, fs = 0, fang = 0;   // body centre, effective radius, facing cos/sin/angle

/** A body-attached part at (u, v) in body-frame units of the effective radius (u forward, v left). */
function part(out: ArtWriter, u: number, v: number, size: number, rot: number, shape: number, r: number, g: number, b: number, a: number, layer = PART, aux0 = 0): void {
  out.push(bx + (fc * u - fs * v) * br, by + (fs * u + fc * v) * br, size * br, rot, shape, r, g, b, a, layer, aux0, bodyIdx);
}
/** A part offset in WORLD axes (screen up = -y), e.g. crowns and flames that stay upright. */
function partW(out: ArtWriter, dx: number, dy: number, size: number, rot: number, shape: number, r: number, g: number, b: number, a: number, layer = PART, aux0 = 0): void {
  out.push(bx + dx * br, by + dy * br, size * br, rot, shape, r, g, b, a, layer, aux0, bodyIdx);
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/**
 * Write one enemy. Returns the number of instances written. `v.lod` drops the composite; the base
 * shape, outline, halo, telegraphs, elite crown and ice shell remain.
 */
export function writeEnemy(out: ArtWriter, v: EnemyView): number {
  const start = out.count;
  const isBoss = v.bossId >= 0;
  // spawn-in: scale 0.55→1 and fade 0.35→1 over 0.4 s; hit squash; knockback wobble
  const sp = v.spawnAge < 24 ? clamp01(v.spawnAge / 24) : 1;
  const ease = 1 - (1 - sp) * (1 - sp);
  let re = v.r * (0.55 + 0.45 * ease) * (1 - 0.14 * v.squash);
  const alpha = v.alpha * (0.35 + 0.65 * ease);
  let rot = v.facing + v.wobble;
  // telegraph: charger wind-up pulls the body back; burrowed enemies are a low mound
  const windup = v.kind === K.charger && v.aiI !== -1 && (v.aiI & 16) !== 0;
  const dash = v.kind === K.charger && v.aiI !== -1 && (v.aiI & 32) !== 0;
  const burrowed = (v.flags & EnemyFlag.Burrowed) !== 0;
  let x = v.x, y = v.y;
  if (windup) { const k = 0.18 * v.r * (0.6 + 0.4 * sin(v.tick * 0.9)); x -= cos(v.facing) * k; y -= sin(v.facing) * k; }
  if (burrowed) re *= 0.8;
  bodyIdx = out.count; bx = x; by = y; br = re; fc = cos(rot); fs = sin(rot); fang = rot;

  let bodyShape = v.shape === Shape.Line ? Shape.Triangle : v.shape;   // artillery's def shape is a Line: never a body
  if (!v.lod && !isBoss) { const o = BODY[v.kind]; if (o !== undefined && o >= 0) bodyShape = o; }
  const rate = v.frozen ? AnimRate.Frozen : v.chilled ? AnimRate.Slow : (v.kind === K.kamikaze && v.dist < 200) || dash ? AnimRate.Fast : AnimRate.Normal;
  const anim = burrowed ? AnimKind.None : isBoss ? AnimKind.Heavy : familyAnim(v.kind);
  const packed = packAnim(v.status, v.phase, anim, rate);
  let cr = v.cr, cg = v.cg, cb = v.cb;
  if (burrowed) { cr *= 0.45; cg *= 0.4; cb *= 0.4; }
  if (isBoss && v.bossPhase > 0) { const h = v.bossPhase === 1 ? 0.18 : 0.32; cr = cr + (1 - cr) * h; cg *= 1 - h * 0.6; cb *= 1 - h * 0.7; }
  out.push(x, y, re, rot, bodyShape, cr, cg, cb, burrowed ? alpha * 0.6 : alpha, 4, v.hp, packed);

  if (isBoss) writeBossParts(out, v, cr, cg, cb);
  else if (!v.lod) writeComposite(out, v, cr, cg, cb, windup, dash, burrowed);
  writeStatusParts(out, v);
  // elite crown (kept at LOD: elites are few and matter)
  if ((v.flags & EnemyFlag.Elite) !== 0 && !isBoss) {
    partW(out, 0, -1.55, 0.42, -PI / 2, Shape.Star, 1, 0.84, 0.3, 1);
    if (!v.lod) partW(out, 0, 0, 1.9, 0, Shape.Circle, 1, 0.8, 0.3, 0.28, HALO_SOFT);
  }
  // hit flash: the body silhouette in white (Flash flag: the renderer caps it for reduced motion)
  if (v.flash > 0.02) out.push(x, y, re * 1.02, rot, bodyShape, 1, 1, 1, 0.75 * v.flash, PART_FLASH, 0, bodyIdx);
  // outline + halo
  out.push(x, y, re + 2, rot, bodyShape, v.or, v.og, v.ob, v.oa, 5, 0, packed);
  if (v.halo) out.push(x, y, re * 1.8, rot, bodyShape, 1, (v.flags & EnemyFlag.WeakPointOpen) ? 0.9 : 0.25, 0.2, 0.6, 6, 0, packed);
  writeTelegraphs(out, v, x, y, re, windup);
  return out.count - start;
}

/** Colour helpers (no allocation). */
function dk(c: number): number { return c * 0.45; }
function lt(c: number): number { return c + (1 - c) * 0.55; }

function writeComposite(out: ArtWriter, v: EnemyView, cr: number, cg: number, cb: number, windup: boolean, dash: boolean, burrowed: boolean): void {
  const k = v.kind, t = v.tick, ph = v.phase * 0.0997;
  switch (k) {
    case K.grunt:
      part(out, 0.12, 0, 0.3, 0, Shape.Circle, dk(cr), dk(cg), dk(cb), 1);
      break;
    case K.runner:
      part(out, -1.15, 0, 0.62, fang, Shape.Capsule, cr, cg, cb, 0.35, PART_DETAIL);
      break;
    case K.brute:
      part(out, 0.05, 0.9, 0.42, fang, Shape.Square, lt(cr), lt(cg), lt(cb), 1);
      part(out, 0.05, -0.9, 0.42, fang, Shape.Square, lt(cr), lt(cg), lt(cb), 1);
      part(out, 0.5, 0, 0.3, fang + PI / 2, Shape.Capsule, dk(cr), dk(cg), dk(cb), 1);
      break;
    case K.kamikaze: {
      // fuse: the core pulses faster (≤ 3 Hz) as it closes on the tower
      const close = clamp01(1 - (v.dist - 40) / 260);
      const hz = 0.8 + 2.2 * close;
      const p = 0.5 + 0.5 * sin(t * (TAU * hz / 60) + ph);
      part(out, 0, 0, 0.3 + 0.18 * p * (0.4 + close), 0, Shape.Circle, 1, 0.95 - 0.5 * close * p, 0.7 - 0.5 * close, 0.95);
      break;
    }
    case K.shielded:
      if (v.shieldFrac > 0) part(out, 0, 0, 1.4, fang, Shape.Arc, 0.6, 0.85, 1, 0.35 + 0.6 * v.shieldFrac, PART, 0.22);
      part(out, 0, 0, 0.3, 0, Shape.Circle, dk(cr), dk(cg), dk(cb), 1);
      break;
    case K.splitter:
      for (let j = 0; j < 3; j++) { const a = ph + j * (TAU / 3); part(out, 0.42 * cos(a), 0.42 * sin(a), 0.26, a, Shape.Diamond, dk(cr), dk(cg), dk(cb), 1); }
      break;
    case K.carrier: {
      const swell = clamp01(v.aiA / 240);
      const s = 0.26 + 0.14 * swell * swell;
      for (let j = 0; j < 3; j++) { const a = PI / 2 + j * (TAU / 3); part(out, 0.95 * cos(a), 0.95 * sin(a), s, 0, Shape.Circle, lt(cr), lt(cg) * (1 - 0.3 * swell), lt(cb) * (1 - 0.5 * swell), 1); }
      break;
    }
    case K.healer:
      part(out, 0, 0, 0.72, 0, Shape.Cross, 0.92, 1, 0.95, 1);
      break;
    case K.leech: {
      const tether = v.aiI !== -1 && (v.aiI & 8) !== 0;
      part(out, 0.62, 0.62, 0.3, fang, Shape.Triangle, lt(cr), lt(cg), lt(cb), 1);
      part(out, 0.62, -0.62, 0.3, fang, Shape.Triangle, lt(cr), lt(cg), lt(cb), 1);
      if (tether) part(out, 0.55, 0, 0.32, 0, Shape.Circle, 1, 0.35, 0.3, 0.9);
      break;
    }
    case K.veteran:
      part(out, -0.3, 0, 0.5, fang, Shape.Chevron, 1, 0.86, 0.4, 1);
      part(out, 0.22, 0, 0.26, fang, Shape.Square, dk(cr), dk(cg), dk(cb), 1);
      break;
    case K.armored:
      part(out, 0, 0, 0.6, fang, Shape.Square, cr * 0.62, cg * 0.62, cb * 0.66, 1);
      part(out, 0.5, 0, 0.26, fang + PI / 2, Shape.Capsule, dk(cr), dk(cg), dk(cb), 1);
      break;
    case K.warden: {
      const a = t * 0.02 + ph;
      part(out, 0, 0, 1.5, a, Shape.Arc, 0.6, 0.85, 1, 0.85, PART, 0.14);
      part(out, 0, 0, 1.5, a + PI, Shape.Arc, 0.6, 0.85, 1, 0.85, PART, 0.14);
      part(out, 0, 0, 0.36, 0, Shape.Circle, 0.85, 0.95, 1, 1);
      break;
    }
    case K.artillery: {
      const aim = aimAtTower(v);
      part(out, 0.75 * cos(aim - fang), 0.75 * sin(aim - fang), 0.55, aim, Shape.Capsule, lt(cr), lt(cg), lt(cb), 1);
      part(out, -0.35, 0, 0.42, fang, Shape.Square, dk(cr), dk(cg), dk(cb), 1);
      break;
    }
    case K.charger:
      part(out, 0.9, 0, windup ? 0.62 : 0.5, fang, Shape.Chevron, windup ? 1 : lt(cr), windup ? 0.4 : lt(cg), windup ? 0.3 : lt(cb), 1);
      if (dash) part(out, -1.35, 0, 0.8, fang, Shape.Capsule, cr, cg, cb, 0.35, PART_DETAIL);
      break;
    case K.anchor:
      part(out, 0, 0, 0.55, 0, Shape.Hex, dk(cr), dk(cg), dk(cb), 1);
      part(out, -0.15, 1.05, 0.3, 0, Shape.Ring, 0.8, 0.85, 0.95, 1, PART, 0.45);
      part(out, -0.15, -1.05, 0.3, 0, Shape.Ring, 0.8, 0.85, 0.95, 1, PART, 0.45);
      break;
    case K.phase:
      part(out, -0.35 + 0.15 * sin(t * 0.07 + ph), 0.2 * sin(t * 0.05 + ph), 1.05, 0, Shape.Ring, lt(cr), lt(cg), lt(cb), 0.45, PART_DETAIL, 0.16);
      part(out, 0.1, 0, 0.55, fang, Shape.Crescent, dk(cr), dk(cg), dk(cb), 1);
      break;
    case K.burrower:
      if (burrowed) partW(out, 0, 0, 1.6, 0, Shape.Circle, 0.55, 0.45, 0.35, 0.35, HALO_SOFT);
      else part(out, 0.8, 0, 0.5, fang + sin(t * 0.5) * 0.3, Shape.Triangle, lt(cr), lt(cg), lt(cb), 1);
      break;
    case K.nullifier:
      part(out, 0, 0, 0.42, 0, Shape.Circle, 0.06, 0.02, 0.1, 1);
      part(out, 0, 0, 1.55, t * 0.015 + ph, Shape.Octagon, cr, cg, cb, 0.3, HALO_PART);
      break;
    case K.refractor:
      part(out, 0, 0, 0.55, fang, Shape.Triangle, lt(cr), lt(cg), lt(cb), 1);
      part(out, 0.35, -0.4, 0.3, t * 0.05, Shape.Star, 1, 1, 1, 0.9, PART_DETAIL);
      break;
    case K.jammer: {
      const a = t * 0.06 + ph;
      part(out, 1.3 * cos(a), 1.3 * sin(a), 0.3, a, Shape.Diamond, 1, 0.95, 0.7, 1);
      const w = ((t + v.gen * 7) % 90) / 90;
      part(out, 0, 0, 1.2 + 1.2 * w, 0, Shape.Ring, 1, 0.85, 0.4, 0.45 * (1 - w), HALO_PART, 0.06);
      break;
    }
    case K.clump:
      for (let j = 0; j < 3; j++) { const a = ph + j * (TAU / 3) + t * 0.01; part(out, 0.45 * cos(a), 0.45 * sin(a), 0.3, 0, Shape.Circle, 1, 0.84, 0.5, 1); }
      break;
    case K.bossAdd: {
      const role = v.aiB | 0;
      if (role === 3) {   // Null Engine resistance node: element orb
        const el = ELEMENT_RGB[(v.aiA | 0) & 3];
        part(out, 0, 0, 0.55, 0, Shape.Circle, el[0], el[1], el[2], 1);
      } else if (role === 4) {   // Choir generator
        part(out, 0, 0, 0.6, t * 0.02, Shape.Pentagon, 0.95, 0.95, 1, 1);
      } else if (role === 5) {   // Siege turret
        const aim = aimAtTower(v);
        part(out, 0.7 * cos(aim - fang), 0.7 * sin(aim - fang), 0.5, aim, Shape.Capsule, lt(cr), lt(cg), lt(cb), 1);
      } else {
        part(out, 0, 0, 1.25, t * 0.02, Shape.Arc, 1, 0.5, 0.45, 0.8, PART_DETAIL, 0.14);
      }
      break;
    }
    default: break;   // swarm, fragment, brood: motion reads them
  }
}

const ELEMENT_RGB: readonly (readonly [number, number, number])[] = [[1, 0.56, 0.16], [0.98, 0.93, 0.36], [0.28, 0.9, 0.6], [0.4, 0.78, 1]];

/** Cheap atan2 for part rotation (visual only; the sim LUT atan2 is also fine but this avoids a table walk). */
function atan2Approx(y: number, x: number): number {
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  const a = (ax > ay ? ay / (ax || 1) : ax / (ay || 1));
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.57079637 - r;
  if (x < 0) r = 3.14159274 - r;
  if (y < 0) r = -r;
  return r;
}
function aimAtTower(v: EnemyView): number { return atan2Approx(-v.y, -v.x); }
export { atan2Approx };

// ------------------------------------------------------------------ statuses on the body
/** Status marks by shape and motion: flame above, drips below, sparks jumping around the rim, frost flake, ice shell. */
function writeStatusParts(out: ArtWriter, v: EnemyView): void {
  const s = v.status;
  if (s === 0) return;
  const t = v.tick, ph = v.phase * 0.0997;
  let n = 0;
  if (s & RStatus.Frozen) {   // ice shell: essential (Shatter builds read it), kept at LOD
    partW(out, 0, 0, 1.32, ph, Shape.Hex, 0.78, 0.94, 1, 0.5);
    n++;
  }
  if (v.lod) return;
  if ((s & RStatus.Burn) && n < MAX_STATUS_PARTS) {
    const f = 0.85 + 0.25 * sin(t * 0.35 + ph);
    partW(out, 0.12 * sin(t * 0.11 + ph), -1.05 - 0.12 * f, 0.55 * f, -PI / 2, Shape.Drop, 1, 0.55, 0.12, 0.95, PART_DETAIL);
    n++;
  }
  if ((s & RStatus.Shock) && n < MAX_STATUS_PARTS) {
    const a = ((t >> 2) * 2.4 + ph) % TAU;
    partW(out, 1.1 * cos(a), 1.1 * sin(a), 0.42, a + PI / 2, Shape.Shard, 1, 0.97, 0.55, 1, PART_DETAIL);
    n++;
  }
  if ((s & RStatus.Poison) && n < MAX_STATUS_PARTS) {
    const c = ((t + v.phase * 5) % 50) / 50;
    partW(out, 0.35, 0.9 + 0.8 * c, 0.34 * (1 - 0.4 * c), -PI / 2, Shape.Drop, 0.35, 0.95, 0.4, 1 - c * 0.6, PART_DETAIL);
    n++;
  }
  if ((s & RStatus.Bleed) && n < MAX_STATUS_PARTS) {
    const c = ((t + v.phase * 3) % 70) / 70;
    partW(out, -0.3, 0.95 + 0.7 * c, 0.32, -PI / 2, Shape.Drop, 0.75, 0.05, 0.1, 1 - c * 0.5, PART_DETAIL);
    n++;
  }
  if ((s & RStatus.Chill) && !(s & RStatus.Frozen) && n < MAX_STATUS_PARTS) {
    const a = ph + t * 0.01;
    partW(out, 0.95 * cos(a), 0.95 * sin(a), 0.38, a, Shape.Star, 0.85, 0.96, 1, 1, PART_DETAIL);
  }
}

// ------------------------------------------------------------------ telegraphs (layer 7 / 6)
function writeTelegraphs(out: ArtWriter, v: EnemyView, x: number, y: number, re: number, windup: boolean): void {
  const k = v.kind;
  if (k === K.artillery && v.bossId < 0) {
    // aim line while the next shell is winding up (attackT counts down from 150 to the shot)
    if (v.attackT > 0 && v.attackT <= 45 && v.dist < 420) {
      const f = 1 - v.attackT / 45;
      const d = v.dist > 1 ? v.dist : 1;
      const ex = -x / d * 26, ey = -y / d * 26;   // stop at the tower rim
      out.push(x, y, 0.8 + 0.8 * f, 0, Shape.Line, 0.55, 0.9, 1, 0.25 + 0.5 * f, 7, ex, ey);
    }
  } else if (k === K.healer && v.allowPulse && !v.lod) {
    const p = ((v.tick + v.gen) % 30) / 30;   // the heal pulses when this wraps (support.ts pulseNow)
    out.push(x, y, re + (90 - re) * p, 0, Shape.Ring, 0.4, 1, 0.65, 0.3 * (1 - p), flagged(6, InstFlag.Detail), 0.02, 0);
  } else if (windup) {
    out.push(x, y, re * 1.55, 0, Shape.Ring, 1, 0.35, 0.3, 0.8, flagged(6, InstFlag.Part), 0.14, bodyIdx);
  }
}

// ------------------------------------------------------------------ bosses
/**
 * Boss part table: [shape, dist (×r), angle (rad, from facing), size (×r), colour (0 body, 1 dark, 2 light, 3 hot core),
 * motion (0 fixed, 1 orbit, 2 counter-orbit, 3 spin, 4 extends on the tell, 5 pulse), minPhase, maxPhase].
 */
type BossPart = readonly [number, number, number, number, number, number, number, number];
const BP = (shape: number, d: number, a: number, s: number, c: number, m: number, p0 = 0, p1 = 9): BossPart => [shape, d, a, s, c, m, p0, p1];
const BOSS_PARTS: Record<string, readonly BossPart[]> = {
  breaker: [BP(Shape.Square, 1.05, PI / 2, 0.42, 2, 4), BP(Shape.Square, 1.05, -PI / 2, 0.42, 2, 4), BP(Shape.Square, 0.2, 0, 0.62, 1, 0, 0, 0), BP(Shape.Circle, 0.4, PI, 0.3, 3, 5, 1)],
  broodheart: [BP(Shape.Circle, 0.75, PI, 0.45, 2, 4), BP(Shape.Circle, 1.25, 0, 0.16, 2, 1), BP(Shape.Circle, 1.25, 2.1, 0.16, 2, 1), BP(Shape.Circle, 1.25, 4.2, 0.16, 2, 1), BP(Shape.Crescent, 0.3, 0, 0.35, 3, 5, 1)],
  warden: [BP(Shape.Arc, 0, 0, 1.35, 2, 1), BP(Shape.Arc, 0, PI, 1.35, 2, 1), BP(Shape.Hex, 0, 0, 0.5, 1, 3), BP(Shape.Square, 1.15, PI / 2, 0.3, 2, 4, 0, 0)],
  siege_engine: [BP(Shape.Capsule, 0.9, PI / 2, 0.55, 1, 0), BP(Shape.Capsule, 0.9, -PI / 2, 0.55, 1, 0), BP(Shape.Triangle, 1.0, 0, 0.45, 2, 4), BP(Shape.Square, 0.1, 0, 0.45, 2, 0, 0, 1), BP(Shape.Circle, 0, 0, 0.3, 3, 5, 2)],
  iron_maw: [BP(Shape.Crescent, 0.25, PI, 0.9, 1, 4), BP(Shape.Triangle, 0.7, 0.5, 0.2, 2, 0), BP(Shape.Triangle, 0.7, -0.5, 0.2, 2, 0), BP(Shape.Circle, 0.55, 0, 0.25, 3, 5, 1)],
  mirror_hive: [BP(Shape.Diamond, 1.25, 0, 0.3, 2, 1), BP(Shape.Diamond, 1.25, 2.1, 0.3, 2, 1), BP(Shape.Diamond, 1.25, 4.2, 0.3, 2, 1), BP(Shape.Diamond, 0, 0, 0.45, 1, 3)],
  storm_crown: [BP(Shape.Star, 0, 0, 0.6, 1, 3), BP(Shape.Circle, 1.35, 0, 0.2, 3, 1), BP(Shape.Circle, 1.35, 2.1, 0.2, 3, 1), BP(Shape.Circle, 1.35, 4.2, 0.2, 3, 1)],
  distant_saint: [BP(Shape.Ring, 0, 0, 1.55, 3, 4), BP(Shape.Diamond, 0.95, 2.4, 0.35, 2, 0), BP(Shape.Diamond, 0.95, -2.4, 0.35, 2, 0), BP(Shape.Circle, 0, 0, 0.28, 3, 5)],
  leech_queen: [BP(Shape.Capsule, 1.05, 0.6, 0.4, 2, 4), BP(Shape.Capsule, 1.05, -0.6, 0.4, 2, 4), BP(Shape.Star, 0.55, PI, 0.3, 3, 0), BP(Shape.Circle, 0.3, 0, 0.26, 1, 0)],
  splinter_king: [BP(Shape.Shard, 1.3, 0.5, 0.35, 2, 1), BP(Shape.Shard, 1.3, 2.6, 0.35, 2, 1), BP(Shape.Shard, 1.3, 4.7, 0.35, 2, 1), BP(Shape.Diamond, 0, 0, 0.4, 1, 3, 1)],
  null_engine: [BP(Shape.Hex, 0, 0, 0.55, 1, 3), BP(Shape.Square, 1.2, 0, 0.18, 2, 1), BP(Shape.Square, 1.2, PI, 0.18, 2, 1), BP(Shape.Circle, 0, 0, 0.22, 3, 5)],
  chronophage: [BP(Shape.Capsule, 0.45, 0, 0.5, 2, 3), BP(Shape.Capsule, 0.3, PI / 2, 0.36, 2, 2), BP(Shape.Ring, 0, 0, 1.3, 2, 0), BP(Shape.Circle, 0, 0, 0.18, 3, 5, 1)],
  hive_fortress: [BP(Shape.Square, 1.0, 0, 0.3, 1, 4), BP(Shape.Square, 1.0, PI / 2, 0.3, 1, 4), BP(Shape.Square, 1.0, PI, 0.3, 1, 4), BP(Shape.Square, 1.0, -PI / 2, 0.3, 1, 4), BP(Shape.Hex, 0, 0, 0.4, 3, 5, 1)],
  redline: [BP(Shape.Drop, 1.05, PI, 0.5, 3, 5), BP(Shape.Triangle, 0.6, 2.2, 0.35, 2, 0), BP(Shape.Triangle, 0.6, -2.2, 0.35, 2, 0), BP(Shape.Chevron, 0.4, 0, 0.35, 1, 4)],
  grave_battery: [BP(Shape.Square, 0.55, 0, 0.22, 3, 4), BP(Shape.Square, 0, 0, 0.22, 3, 4), BP(Shape.Square, -0.55, 0, 0.22, 3, 4), BP(Shape.Cross, 0, 0, 0.8, 2, 0, 1)],
  event_horizon: [BP(Shape.Ring, 0, 0, 1.45, 2, 4), BP(Shape.Arc, 0, 0, 1.2, 3, 1), BP(Shape.Arc, 0, PI, 1.2, 3, 1), BP(Shape.Circle, 0, 0, 0.55, 1, 0)],
  architect: [BP(Shape.Capsule, 0.9, 0.8, 0.55, 2, 1), BP(Shape.Capsule, 0.9, 0.8 + PI, 0.55, 2, 1), BP(Shape.Square, 0, 0, 0.5, 1, 3), BP(Shape.Circle, 0, 0, 0.2, 3, 5)],
  choir: [BP(Shape.Circle, 1.3, 0, 0.25, 2, 1), BP(Shape.Circle, 1.3, 2.1, 0.25, 2, 1), BP(Shape.Circle, 1.3, 4.2, 0.25, 2, 1), BP(Shape.Ring, 0, 0, 1.05, 3, 5)],
  last_procession: [BP(Shape.Triangle, 0.9, PI, 0.45, 2, 0), BP(Shape.Diamond, 1.4, 1.0, 0.22, 2, 1), BP(Shape.Diamond, 1.4, -1.0, 0.22, 2, 1), BP(Shape.Diamond, 0, 0, 0.45, 1, 3)],
  crown: [BP(Shape.Star, 1.35, 0, 0.22, 3, 1), BP(Shape.Star, 1.35, 2.1, 0.22, 3, 1), BP(Shape.Star, 1.35, 4.2, 0.22, 3, 1), BP(Shape.Ring, 0, 0, 1.6, 2, 0, 1), BP(Shape.Octagon, 0, 0, 0.5, 1, 3), BP(Shape.Ring, 0, 0, 1.85, 3, 2, 2)],
  deep_graft: [BP(Shape.Crescent, 0.35, 0, 0.8, 2, 0), BP(Shape.Hex, 0.4, PI, 0.6, 1, 3), BP(Shape.Circle, 0, 0, 0.25, 3, 5)],
};
export const BOSS_PART_IDS = Object.keys(BOSS_PARTS);
export function bossPartCount(id: string): number { return BOSS_PARTS[id]?.length ?? 0; }

function writeBossParts(out: ArtWriter, v: EnemyView, cr: number, cg: number, cb: number): void {
  const def = v.bossDef;
  const id = def ? def.id : 'breaker';
  const parts = BOSS_PARTS[id] ?? BOSS_PARTS.breaker;
  const t = v.tick, tell = v.tell < 0 ? 0 : v.tell, phase = v.bossPhase;
  const fa = fang;
  for (let j = 0; j < parts.length; j++) {
    const p = parts[j];
    if (phase < p[6] || phase > p[7]) continue;
    let d = p[1], a = p[2], s = p[3], rot = a;
    switch (p[5]) {
      case 1: a += t * (0.012 + 0.006 * phase); rot = a; break;
      case 2: a -= t * 0.016; rot = a; break;
      case 3: rot = t * (0.02 + 0.01 * phase); break;
      case 4: d += 0.35 * tell; s *= 1 + 0.25 * tell; break;
      case 5: s *= 1 + 0.18 * (0.5 + 0.5 * sin(t * 0.21)); break;   // ~2 Hz
      default: break;
    }
    let r = cr, g = cg, b = cb;
    const c = p[4];
    if (c === 1) { r = dk(cr); g = dk(cg); b = dk(cb); }
    else if (c === 2) { r = lt(cr); g = lt(cg); b = lt(cb); }
    else if (c === 3) { r = 1; g = 0.9 - 0.4 * tell; b = 0.55 - 0.35 * tell; }
    const ring = p[0] === Shape.Ring || p[0] === Shape.Arc;
    part(out, d * cos(a), d * sin(a), s, fa + rot, p[0], r, g, b, ring ? 0.8 : 1, PART, ring ? 0.12 : 0);
  }
  // weak point: a dark hatch where it will open, a pulsing node while it is open (≤ 2 Hz)
  const wp = def?.phases[phase]?.weakPoint;
  if (wp) {
    const open = (v.flags & EnemyFlag.WeakPointOpen) !== 0;
    const u = wp.radius / Math.max(1, v.r);
    const pu = u * cos(wp.angle), pv = u * sin(wp.angle);
    if (open) {
      const pulse = 0.5 + 0.5 * sin(t * 0.2);
      part(out, pu, pv, 0.24 + 0.08 * pulse, 0, Shape.Circle, 1, 0.92, 0.35, 1);
      part(out, pu, pv, 0.42 + 0.22 * pulse, 0, Shape.Ring, 1, 0.85, 0.3, 0.9 - 0.5 * pulse, flagged(6, InstFlag.Part), 0.2);
    } else {
      part(out, pu, pv, 0.2, 0, Shape.Hex, 0.1, 0.08, 0.12, 0.9);
    }
  }
}

/** Boss index for a BossId (showcase helper). */
export function bossIdx(id: string): number { return bossIndex(id); }
