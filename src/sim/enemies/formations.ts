/**
 * Formation scripts (WP4). Given the wave, an enemy's spawn entry and the current
 * wave tick, write the position the formation wants the enemy at. The AI steers
 * toward it; contact with the tower ring is handled by the AI.
 *
 * Conventions shared with the generator (enemies/generator.ts):
 *  - Positions are a pure function of (wave, spawn, waveTick, baseSpeed): no state,
 *    continuous in time, never farther than ARENA_RADIUS + 60 from the tower.
 *  - `spawn.angle` is the member's anchor angle: its spawn angle for radial-style
 *    templates, the wall normal for walls, the orbit center's angle for escorts and
 *    the polygon's base angle for polygon sieges. Use `spawnPosition()` to place a
 *    new enemy exactly where its script starts.
 *  - `radiusOffset` shifts the start radius (ARENA_RADIUS + offset); < -100 marks a
 *    delayed-ambush burrower surfacing inside the arena.
 *  - `formationSlot` / `lane` carry the member's place inside its group.
 *  - Radial progress uses baseSpeed × params.radialSpeed; curved templates slow their
 *    radial component so the path speed stays close to the enemy's own speed.
 */
import type { WaveDef, SpawnEntry } from '../core/types';
import { ARENA_RADIUS, TOWER_RADIUS, TICK_RATE } from '../core/types';
import { cos, sin, log, PI, TAU, HALF_PI } from '../math/lut';
import { BOSS_BY_ID } from '../data/bosses';

export const FORMATION_MAX_R = ARENA_RADIUS + 60;
const MAX_R = FORMATION_MAX_R;
const RMIN = TOWER_RADIUS;
const GOLDEN = 2.399963229728653;          // golden angle (radians)

/** Shared geometry constants (the generator lays spawns out with the same numbers). */
export const FORMATION_CONST = {
  artilleryHold: 330,                      // artillery_ring gun-line radius
  artilleryReleaseSeconds: 8,              // non-artillery gun-line members advance after this
  ambushRadius: 200,                       // delayed_ambush surfacing radius
  ambushSurfaceSeconds: 1,
  escortCoreSpeed: 28,                     // escort cores advance at a common pace
  escortOrbit: 46,
  escortShell: 20,
  kamikazeHold: 300,
  wallSpacing: 30,
  pincerSweep: HALF_PI,
  flankOffset: 1.1,
  flankSweep: 0.55,
} as const;

function clampR(out: Float32Array): void {
  const x = out[0], y = out[1];
  const r2 = x * x + y * y;
  if (r2 > MAX_R * MAX_R) {
    const k = MAX_R / Math.sqrt(r2);
    out[0] = x * k; out[1] = y * k;
  }
}

function polar(out: Float32Array, a: number, r: number): void {
  out[0] = cos(a) * r;
  out[1] = sin(a) * r;
}

/** Handedness of curved templates: rotation sign, or wave parity when rotation is 0. */
function hand(wave: WaveDef): number {
  const rot = wave.params.rotation;
  if (rot < 0) return -1;
  if (rot > 0) return 1;
  return (wave.wave & 1) === 1 ? -1 : 1;
}

/** Log spiral: θ advances k radians per e-fold of radius; path speed ≈ v. */
function spiral(out: Float32Array, a: number, R0: number, v: number, t: number, k: number, dir: number): void {
  const vr = v / Math.sqrt(1 + k * k);
  const r = Math.max(RMIN, R0 - vr * t);
  polar(out, a + dir * k * log(R0 / r), r);
}

/** Cumulative distance factor for alternating spokes (fast/slow halves of each period). */
function gated(x: number, period: number): number {
  const half = period * 0.5;
  const n = Math.floor(x / period);
  const rem = x - n * period;
  return n * period + (rem < half ? 1.6 * rem : 1.6 * half + 0.4 * (rem - half));
}

/** Triangle wave in [-1, 1] with period 1. */
function tri(x: number): number {
  const f = x - Math.floor(x);
  return f < 0.5 ? 4 * f - 1 : 3 - 4 * f;
}

function smooth01(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

export function formationPosition(wave: WaveDef, spawn: SpawnEntry, waveTick: number, baseSpeed: number, out: Float32Array): void {
  const p = wave.params;
  const tickNow = waveTick > spawn.tick ? waveTick : spawn.tick;
  const t = (tickNow - spawn.tick) / TICK_RATE;
  const v = baseSpeed * p.radialSpeed;
  let R0 = ARENA_RADIUS + spawn.radiusOffset;
  if (R0 > MAX_R) R0 = MAX_R;
  if (R0 < RMIN) R0 = RMIN;
  const a = spawn.angle;

  switch (wave.formation) {
    // ------------------------------------------------------------- spirals
    case 'tightening_spiral':
      spiral(out, a, R0, v, t, 1.1 * p.spread, hand(wave));
      break;
    case 'spiral_arms':
      spiral(out, a, R0, v, t, 1.1 * p.spread, hand(wave));
      break;
    case 'double_helix':
      spiral(out, a, R0, v, t, 1.0 * p.spread, (spawn.lane & 1) === 1 ? -1 : 1);
      break;
    case 'comet_tail':
      spiral(out, a, R0, v, t, 0.55, hand(wave));
      break;
    case 'safe_corridor':
      spiral(out, a, R0, v, t, 0.3, spawn.lane === 0 ? -1 : 1);
      break;

    // ------------------------------------------------------------- pulsing radial
    case 'alternating_spokes': {
      const period = 1 / Math.max(0.1, p.tempo);
      const phase = (spawn.lane & 1) * period * 0.5;
      const tw = tickNow / TICK_RATE, ts = spawn.tick / TICK_RATE;
      const d = v * (gated(tw + phase, period) - gated(ts + phase, period));
      polar(out, a, Math.max(RMIN, R0 - d));
      break;
    }
    case 'concentric_assault': {
      const w = TAU * Math.max(0.1, p.tempo);
      const tw = tickNow / TICK_RATE, ts = spawn.tick / TICK_RATE;
      let d = v * (t + (0.7 / w) * (cos(w * ts) - cos(w * tw)));
      if (d < 0) d = 0;
      polar(out, a, Math.max(RMIN, R0 - d));
      break;
    }
    case 'tidal_ring': {
      const w = TAU * Math.max(0.1, p.tempo);
      const d = 0.75 * v * t + 30 * (1 - cos(w * t));
      polar(out, a, Math.max(RMIN, R0 - d));
      break;
    }
    case 'synchronized_burst': {
      const d = t < 1.5 ? v * 1.8 * t : v * (2.7 + 0.8 * (t - 1.5));
      polar(out, a, Math.max(RMIN, R0 - d));
      break;
    }
    case 'annular_rush': {
      const tt = t < 10 ? t : 10;
      const d = v * (t + 0.03 * tt * tt + 0.6 * (t - tt));
      polar(out, a, Math.max(RMIN, R0 - d));
      break;
    }
    case 'kamikaze_ring': {
      const Rh = FORMATION_CONST.kamikazeHold + (spawn.formationSlot & 1) * 20;
      const tA = R0 > Rh ? (R0 - Rh) / Math.max(1, v) : 0;
      const hold = 1.5 / Math.max(0.2, p.tempo);
      let r: number;
      if (t < tA) r = R0 - v * t;
      else if (t < tA + hold) r = Math.min(R0, Rh) - 0.1 * v * (t - tA);
      else r = Math.min(R0, Rh) - 0.1 * v * hold - 1.7 * v * (t - tA - hold);
      polar(out, a, Math.max(RMIN, r));
      break;
    }
    case 'staggered_lanes': {
      const f = 1 + 0.1 * ((spawn.lane % 3) - 1);
      polar(out, a, Math.max(RMIN, R0 - v * f * t));
      break;
    }

    // ------------------------------------------------------------- rotation
    case 'rotating_wedge': {
      polar(out, a + p.rotation * t, Math.max(RMIN, R0 - v * t));
      break;
    }
    case 'orbit_lattice': {
      const w = Math.abs(p.rotation) * ((spawn.lane & 1) === 1 ? -1 : 1);
      polar(out, a + w * t, Math.max(RMIN, R0 - 0.7 * v * t));
      break;
    }

    // ------------------------------------------------------------- weaving
    case 'serpentine':
    case 'mirror_lanes': {
      const rr = 0.6 * v;
      const r = Math.max(RMIN, R0 - rr * t);
      const s = R0 - r;
      const ph = wave.formation === 'mirror_lanes' && (spawn.lane & 1) === 1 ? PI : 0;
      const A = 40 * p.spread;
      polar(out, a + (A / Math.max(r, 120)) * sin(TAU * s / 200 + ph), r);
      break;
    }
    case 'figure_eight': {
      const rr = 0.55 * v;
      const r = Math.max(RMIN, R0 - rr * t);
      const s = R0 - r;
      const ph = (spawn.lane & 1) === 1 ? PI : 0;
      const wob = 20 * sin(2 * TAU * s / 260) * (r > 60 ? 1 : r / 60);
      polar(out, a + (65 / Math.max(r, 120)) * sin(TAU * s / 260 + ph), Math.max(RMIN, r - Math.abs(wob)));
      break;
    }
    case 'barrier_maze': {
      const rr = 0.65 * v;
      const r = Math.max(RMIN, R0 - rr * t);
      const s = R0 - r;
      const ph = (spawn.lane & 1) === 1 ? 0.5 : 0;
      // tri() starts at -1 → shift by 0.25 so the path starts on the anchor angle
      polar(out, a + (50 / Math.max(r, 120)) * tri(s / 180 + 0.25 + ph), r);
      break;
    }
    case 'gate_weave': {
      const rr = 0.5 * v;
      const r = Math.max(RMIN, R0 - rr * t);
      const lanes = Math.max(2, p.lanes);
      const step = Math.min(TAU / lanes, TAU / 6) * ((spawn.lane & 1) === 1 ? -1 : 1);
      const u = (440 - r) / 240;
      polar(out, a + step * smooth01(u), r);
      break;
    }

    // ------------------------------------------------------------- flowers
    case 'expanding_flower':
    case 'hazard_bloom': {
      const s = v * t;
      const u0 = (s - 80) / 240;
      const u = u0 < 0 ? 0 : u0 > 1 ? 1 : u0;
      const bump = sin(PI * u);
      const side = (spawn.formationSlot & 1) === 1 ? 1 : -1;
      const r = Math.max(RMIN, R0 - s + 100 * bump);
      const rot = wave.formation === 'hazard_bloom' ? p.rotation * t : 0;
      polar(out, a + rot + side * 0.18 * p.spread * bump, r);
      break;
    }

    // ------------------------------------------------------------- groups
    case 'escort': {
      const boss = wave.isBoss && wave.bossId ? BOSS_BY_ID[wave.bossId] : undefined;
      const vc = (boss ? boss.speed : FORMATION_CONST.escortCoreSpeed) * p.radialSpeed;
      // boss waves: the core (boss) spawns at tick 0, so escorts orbit on wave time
      const tc = boss ? tickNow / TICK_RATE : t;
      const floorR = RMIN + (boss ? boss.radius : 8) + 8;
      const rc = Math.max(floorR, R0 - vc * tc);
      if (spawn.lane === 0) { polar(out, a, rc); break; }
      const shell = (spawn.formationSlot >> 3) & 3;
      const base = boss ? boss.radius + 34 : FORMATION_CONST.escortOrbit * p.spread;
      const ro = (base + FORMATION_CONST.escortShell * shell) * Math.min(1, rc / 160);
      const phi = spawn.formationSlot * GOLDEN + 0.8 * tc * ((shell & 1) === 1 ? -1 : 1);
      out[0] = cos(a) * rc + cos(phi) * ro;
      out[1] = sin(a) * rc + sin(phi) * ro;
      break;
    }
    case 'pincer': {
      const sweep = Math.min(HALF_PI, FORMATION_CONST.pincerSweep * p.spread);
      const r = Math.max(RMIN, R0 - 0.6 * v * t);
      const dir = spawn.lane === 0 ? 1 : -1;
      polar(out, a + dir * sweep * (1 - r / R0), r);
      break;
    }
    case 'flank_pair': {
      const r = Math.max(RMIN, R0 - 0.8 * v * t);
      const dir = spawn.lane === 0 ? 1 : -1;
      polar(out, a + dir * FORMATION_CONST.flankSweep * (1 - r / R0), r);
      break;
    }
    case 'artillery_ring': {
      if (spawn.lane !== 1) { polar(out, a, Math.max(RMIN, R0 - v * t)); break; }
      const Rh = Math.min(R0, FORMATION_CONST.artilleryHold + (spawn.formationSlot % 3) * 14);
      const tA = (R0 - Rh) / Math.max(1, v);
      const drift = 0.03 * ((spawn.formationSlot & 1) === 1 ? -1 : 1);
      if (t < tA) { polar(out, a, R0 - v * t); break; }
      const held = t - tA;
      if (spawn.kind === 'artillery') { polar(out, a + drift * held, Rh); break; }
      const rel = FORMATION_CONST.artilleryReleaseSeconds;
      if (held < rel) { polar(out, a + drift * held, Rh); break; }
      polar(out, a + drift * rel, Math.max(RMIN, Rh - v * (held - rel)));
      break;
    }
    case 'delayed_ambush': {
      if (spawn.radiusOffset < -100) {
        const tt = t - FORMATION_CONST.ambushSurfaceSeconds;
        polar(out, a, Math.max(RMIN, R0 - v * (tt > 0 ? tt : 0)));
      } else {
        polar(out, a, Math.max(RMIN, R0 - v * t));
      }
      break;
    }

    // ------------------------------------------------------------- walls and polygons
    case 'moving_wall':
    case 'hex_grid': {
      const W = Math.max(1, Math.round(p.lanes));
      const spacing = FORMATION_CONST.wallSpacing * p.spread;
      const sMax = (W - 1) * 0.5 * spacing;
      const idx = spawn.formationSlot % W;
      const s = (idx - (W - 1) * 0.5) * spacing;
      const lim = (MAX_R - 20) * (MAX_R - 20) - sMax * sMax;
      const d0 = Math.min(R0, lim > 0 ? Math.sqrt(lim) : 0);
      const d = Math.max(0, d0 - v * t);
      const l = s * (d < 200 ? d / 200 : 1);
      const ca = cos(a), sa = sin(a);
      let x = ca * d - sa * l, y = sa * d + ca * l;
      const rr = Math.sqrt(x * x + y * y);
      if (rr < RMIN) {
        // Inside 200 units the member converges along the fixed ray n + t·s/200: hold it at the ring.
        const k = s / 200;
        const dx = ca - sa * k, dy = sa + ca * k;
        const dl = Math.sqrt(dx * dx + dy * dy);
        x = dx / dl * RMIN; y = dy / dl * RMIN;
      }
      out[0] = x; out[1] = y;
      break;
    }
    case 'polygon_siege': {
      const N = Math.max(3, Math.round(p.lanes));
      const Rc = Math.max(RMIN, R0 - 0.7 * v * t);
      const u0 = (spawn.formationSlot * 0.6180339887 * N) % N;
      let u = (u0 + 0.05 * t) % N;
      if (u < 0) u += N;
      const e = Math.floor(u), f = u - e;
      const a0 = a + e * TAU / N, a1 = a + (e + 1) * TAU / N;
      out[0] = (cos(a0) * (1 - f) + cos(a1) * f) * Rc;
      out[1] = (sin(a0) * (1 - f) + sin(a1) * f) * Rc;
      break;
    }

    // ------------------------------------------------------------- plain radial
    // radial_ring, crescent, twin_columns, scattered_rain, brute_column, packed_wedge,
    // cluster_drop, boss waves without an escort template.
    default:
      polar(out, a, Math.max(RMIN, R0 - v * t));
      break;
  }
  clampR(out);
}

/** Where a newly spawned enemy should be placed: its script position at its spawn tick. */
export function spawnPosition(wave: WaveDef, spawn: SpawnEntry, out: Float32Array): void {
  formationPosition(wave, spawn, spawn.tick, 0, out);
}
