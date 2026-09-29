/**
 * Synthetic RenderSnapshot generator so the renderer can be developed and eyeballed without the
 * sim. Pure function of a frame counter (deterministic): ~600 enemies in rings / spirals /
 * columns, ~800 projectiles, a rotating blade, a 5-node laser polygon, gravity wells, hazards,
 * threat halos, status icons, a boss, and a steady fx stream.
 *
 * DOM-free so it can be unit tested in Node.
 */
import { ARENA_RADIUS, FX_FLOATS, FxKind, INSTANCE_FLOATS, Shape, TOWER_RADIUS, type RenderSnapshot } from '@sim/core/types';
import { ELEMENT_COLORS, ELEMENT_ORDER, GOLD, SECTOR_PALETTES, THREAT_HALO_COLOR, type RGB } from '@render/palette';

export interface DevOptions {
  enemies: number;
  projectiles: number;
  /** Multiplier on the fx-per-frame rate. */
  fxRate: number;
  sector: number;
}

export const DEV_DEFAULTS: Readonly<DevOptions> = { enemies: 600, projectiles: 800, fxRate: 1, sector: 0 };
/** Heavy preset matching the entity budgets in design §20. */
export const DEV_STRESS: Readonly<DevOptions> = { enemies: 1500, projectiles: 4000, fxRate: 3, sector: 2 };

const TAU = Math.PI * 2;

function hash32(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Deterministic value in [0,1) from an integer key. */
function rnd(n: number): number { return hash32(n) / 4294967296; }

export class DevHarness {
  readonly opts: DevOptions;
  readonly snap: RenderSnapshot;
  private readonly maxInstances: number;
  private n = 0;
  private fxN = 0;

  constructor(opts: Partial<DevOptions> = {}) {
    this.opts = { ...DEV_DEFAULTS, ...opts };
    const o = this.opts;
    this.maxInstances = o.enemies * 2 + o.projectiles + o.enemies / 10 + 512;
    const maxFx = Math.ceil(60 * o.fxRate) + 16;
    this.snap = {
      tick: 0,
      instances: new Float32Array(this.maxInstances * INSTANCE_FLOATS),
      instanceCount: 0,
      fx: new Float32Array(maxFx * FX_FLOATS),
      fxCount: 0,
      cameraShake: 0,
      clarity: 0,
    };
  }

  /** Fill (and return) the reused snapshot for `frame`. */
  step(frame: number): RenderSnapshot {
    this.n = 0;
    this.fxN = 0;
    const o = this.opts;
    const snap = this.snap;
    const pal = SECTOR_PALETTES[Math.max(0, Math.min(SECTOR_PALETTES.length - 1, o.sector | 0))];
    this.writeArena(frame);
    this.writeEnemies(frame, pal.enemy, pal.enemyAlt, pal.outline);
    this.writeGravity(frame);
    this.writeHazards(frame);
    this.writeWeapons(frame);
    this.writeProjectiles(frame);
    this.writeBoss(frame, pal.enemy, pal.outline);
    this.writeFx(frame);
    snap.tick = frame;
    snap.instanceCount = this.n;
    snap.fxCount = this.fxN;
    // burst shake on big explosions (every 45 frames), decaying
    const ph = frame % 45;
    snap.cameraShake = ph < 12 ? 0.55 * (1 - ph / 12) : 0;
    return snap;
  }

  private put(shape: number, x: number, y: number, r: number, rot: number, c: RGB, a: number, layer: number, aux0 = 0, aux1 = 0): void {
    const f = this.snap.instances;
    let o = this.n * INSTANCE_FLOATS;
    if (o + INSTANCE_FLOATS > f.length) return;
    f[o++] = x; f[o++] = y; f[o++] = r; f[o++] = rot; f[o++] = shape;
    f[o++] = c[0]; f[o++] = c[1]; f[o++] = c[2]; f[o++] = a; f[o++] = layer; f[o++] = aux0; f[o++] = aux1;
    this.n++;
  }

  private fx(kind: number, x: number, y: number, c: RGB, size: number, count: number): void {
    const f = this.snap.fx;
    const o = this.fxN * FX_FLOATS;
    if (o + FX_FLOATS > f.length) return;
    f[o] = kind; f[o + 1] = x; f[o + 2] = y; f[o + 3] = c[0]; f[o + 4] = c[1]; f[o + 5] = c[2]; f[o + 6] = size; f[o + 7] = count;
    this.fxN++;
  }

  private readonly tmpC: [number, number, number] = [0, 0, 0];
  private shade(c: RGB, k: number): RGB {
    const t = this.tmpC;
    t[0] = Math.min(1, c[0] * k); t[1] = Math.min(1, c[1] * k); t[2] = Math.min(1, c[2] * k);
    return t;
  }

  // ---------------------------------------------------------------- layers

  private writeArena(frame: number): void {
    const aim = frame * 0.021;
    const cyan: RGB = [0.45, 0.85, 1.0];
    const slate: RGB = [0.27, 0.33, 0.44];
    // range ring + tower (layer 0: under all effects)
    this.put(Shape.Ring, 0, 0, 300, 0, cyan, 0.16, 0, 0.012);
    this.put(Shape.Ring, 0, 0, 120, 0, cyan, 0.22, 0, 0.02);
    this.put(Shape.Hex, 0, 0, TOWER_RADIUS + 6, 0, slate, 1, 0);
    this.put(Shape.Ring, 0, 0, TOWER_RADIUS + 9, 0, cyan, 0.8, 0, 0.12);
    this.put(Shape.Triangle, Math.cos(aim) * 15, Math.sin(aim) * 15, 13, aim, cyan, 1, 0);
    this.put(Shape.Circle, 0, 0, 9, 0, [0.9, 0.98, 1.0], 1, 0);
  }

  private writeEnemies(frame: number, main: RGB, alt: RGB, outline: RGB): void {
    const total = this.opts.enemies;
    const nRingA = Math.floor(total * 0.3);
    const nRingB = Math.floor(total * 0.2);
    const nSpiral = Math.floor(total * 0.25);
    const nCol = Math.floor(total * 0.1);
    const nRain = Math.floor(total * 0.07);
    const nElite = Math.floor(total * 0.05);
    const nFlank = Math.max(0, total - nRingA - nRingB - nSpiral - nCol - nRain - nElite);

    // A: contracting ring of grunts (circles); every 6th one carries a threat halo (kamikaze)
    for (let i = 0; i < nRingA; i++) {
      const ang = (i / nRingA) * TAU + frame * 0.0015;
      const rad = ARENA_RADIUS - 20 - ((frame * 0.42 + (i % 3) * 14) % 430);
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      const kami = i % 6 === 0;
      const hp = 0.35 + 0.65 * rnd(i * 7 + 1);
      this.body(Shape.Circle, x, y, kami ? 7.5 : 6, ang + Math.PI, kami ? alt : main, hp < 0.9 ? hp : 1, outline, kami);
    }
    // B: counter-rotating ring of squares
    for (let i = 0; i < nRingB; i++) {
      const ang = (i / nRingB) * TAU - frame * 0.004;
      const rad = 380 - Math.sin(frame * 0.01 + i * 0.05) * 30;
      this.body(Shape.Square, Math.cos(ang) * rad, Math.sin(ang) * rad, 6.5, ang + frame * 0.03, alt, 0.5 + 0.5 * rnd(i * 5 + 2), outline, false);
    }
    // C: tightening spiral of triangles
    for (let i = 0; i < nSpiral; i++) {
      const s = (i / nSpiral);
      const rad = 60 + ((s * 420 + frame * 0.55) % 440);
      const ang = s * 9.5 + frame * 0.0035;
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      this.body(Shape.Triangle, x, y, 6.5, ang + Math.PI * 0.5 + 0.6, main, 1, outline, false);
    }
    // D: twin columns of hexes (brutes) marching in
    for (let i = 0; i < nCol; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const j = (i / 2) | 0;
      const dirA = 0.9;
      const dist = ARENA_RADIUS - ((frame * 0.8 + j * 26) % 500);
      const x = Math.cos(dirA) * dist - Math.sin(dirA) * side * 22;
      const y = Math.sin(dirA) * dist + Math.cos(dirA) * side * 22;
      this.body(Shape.Hex, x, y, 10, dirA + Math.PI + j * 0.1, alt, 0.3 + 0.7 * rnd(i * 3 + 9), outline, false);
    }
    // E: scattered rain of diamonds (runners), hashed lanes
    for (let i = 0; i < nRain; i++) {
      const ang = rnd(i * 13 + 5) * TAU;
      const speed = 1.1 + rnd(i * 17 + 3) * 0.9;
      const rad = ARENA_RADIUS - ((frame * speed + rnd(i * 19 + 7) * 500) % 500);
      this.body(Shape.Diamond, Math.cos(ang) * rad, Math.sin(ang) * rad, 5.5, ang + Math.PI, main, 1, outline, false);
    }
    // F: elites (stars) orbiting mid-range; damaged
    for (let i = 0; i < nElite; i++) {
      const ang = (i / Math.max(1, nElite)) * TAU + frame * 0.006;
      const rad = 245 + Math.sin(frame * 0.02 + i) * 20;
      this.body(Shape.Star, Math.cos(ang) * rad, Math.sin(ang) * rad, 12, frame * 0.02 + i, this.shade(main, 1.1), 0.25 + 0.6 * rnd(i * 11 + 4), outline, i % 3 === 0);
    }
    // G: flank capsules sweeping across
    for (let i = 0; i < nFlank; i++) {
      const t = ((frame * 0.006 + i / Math.max(1, nFlank)) % 1);
      const x = -450 + t * 900;
      const y = -260 + Math.sin(t * 9 + i) * 40 - (i % 2) * 20;
      const k = i % 3;
      this.body(k === 0 ? Shape.Cross : k === 1 ? Shape.Crescent : Shape.Capsule, x, y, 8, k === 1 ? Math.PI : 0, alt, 1, outline, k === 0);
    }
    // status icons above a handful of enemies (shape reads before hue): flame, bolt, droplet, flake
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * TAU + frame * 0.004;
      const rad = 200 + (i % 3) * 40;
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      const el = ELEMENT_ORDER[i % 4];
      const shape = [Shape.Triangle, Shape.Shard, Shape.Circle, Shape.Star][i % 4];
      this.put(Shape.Hex, x, y, 9, ang, main, 1, 4, 0.7);
      this.put(shape, x, y - 15, 4.5, shape === Shape.Shard ? -Math.PI * 0.5 : -Math.PI * 0.5, ELEMENT_COLORS[el], 1, 7);
    }
    // designation reticle
    const ra = frame * 0.02;
    this.put(Shape.Ring, Math.cos(ra) * 330, Math.sin(ra) * 330, 16, 0, GOLD, 0.9, 7, 0.14);
  }

  private body(shape: number, x: number, y: number, r: number, rot: number, c: RGB, hp: number, outline: RGB, halo: boolean): void {
    if (halo) this.put(Shape.Circle, x, y, r * 2.3, 0, THREAT_HALO_COLOR, 0.75, 6);
    this.put(shape, x, y, r, rot, c, 1, 4, hp);
    this.put(shape, x, y, r, rot, outline, 0.55, 5);
  }

  private writeGravity(frame: number): void {
    const purple: RGB = [0.7, 0.5, 1.0];
    for (let k = 0; k < 3; k++) {
      const a = k * (TAU / 3) + 0.6;
      const x = Math.cos(a) * 230, y = Math.sin(a) * 230;
      const p = frame * 0.03 + k * 2;
      this.put(Shape.Circle, x, y, 70, 0, purple, 0.06, 1);
      for (let j = 0; j < 3; j++) {
        const t = ((p * 0.25 + j / 3) % 1);
        this.put(Shape.Ring, x, y, 90 * (1 - t) + 6, 0, purple, 0.7 * (0.3 + t), 1, 0);
      }
      this.put(Shape.Circle, x, y, 6, 0, [1, 1, 1], 0.9, 2);
    }
  }

  private writeHazards(frame: number): void {
    const pulse = 0.75 + 0.25 * Math.sin(frame * 0.07);
    this.put(Shape.Circle, -190, 130, 48, 0, ELEMENT_COLORS.fire, 0.5 * pulse, 1);
    this.put(Shape.Circle, 210, -120, 62, 0, ELEMENT_COLORS.poison, 0.45 * pulse, 1);
    this.put(Shape.Circle, 60, 280, 52, 0, ELEMENT_COLORS.frost, 0.5, 1);
    this.put(Shape.Circle, -260, -190, 40, 0, ELEMENT_COLORS.fire, 0.5 * pulse, 1);
    this.put(Shape.Circle, 300, 200, 34, 0, ELEMENT_COLORS.poison, 0.45, 1);
    this.put(Shape.Line, -120, -330, 5, 0, [1, 0.3, 0.6], 0.55 * pulse, 1, 140, -290);
  }

  private writeWeapons(frame: number): void {
    // rotating blade (two Lines)
    const bl = frame * 0.07;
    const c: RGB = [0.55, 0.95, 1.0];
    for (let k = 0; k < 2; k++) {
      const a = bl + k * Math.PI;
      this.put(Shape.Line, Math.cos(a) * 34, Math.sin(a) * 34, 3.2, 0, c, 0.95, 2, Math.cos(a) * 150, Math.sin(a) * 150);
      this.put(Shape.Star, Math.cos(a) * 150, Math.sin(a) * 150, 9, a, [1, 1, 1], 1, 2);
    }
    // laser polygon: 5 orbiting nodes, pentagram of Lines between all pairs
    const nodes = 5;
    const lc: RGB = [1.0, 0.45, 0.7];
    const nx = [0, 0, 0, 0, 0], ny = [0, 0, 0, 0, 0];
    for (let k = 0; k < nodes; k++) {
      const a = frame * 0.012 + (k / nodes) * TAU;
      const rad = 175 + Math.sin(frame * 0.02 + k) * 12;
      nx[k] = Math.cos(a) * rad; ny[k] = Math.sin(a) * rad;
    }
    for (let i = 0; i < nodes; i++) {
      for (let j = i + 1; j < nodes; j++) {
        this.put(Shape.Line, nx[i], ny[i], 1.8, 0, lc, 0.8, 2, nx[j], ny[j]);
      }
      this.put(Shape.Circle, nx[i], ny[i], 6, 0, [1, 0.9, 0.95], 1, 3);
      this.put(Shape.Ring, nx[i], ny[i], 11, 0, lc, 0.9, 3, 0.2);
    }
    // drones: small diamonds orbiting the tower
    for (let k = 0; k < 6; k++) {
      const a = -frame * 0.025 + (k / 6) * TAU;
      this.put(Shape.Diamond, Math.cos(a) * 60, Math.sin(a) * 60, 5, a, [0.6, 1.0, 0.85], 1, 3);
    }
  }

  private writeProjectiles(frame: number): void {
    const total = this.opts.projectiles;
    const arms = 24;
    for (let j = 0; j < total; j++) {
      const arm = j % arms;
      const ang = (arm / arms) * TAU + Math.sin(frame * 0.004 + arm) * 0.3 + (j % 7) * 0.006;
      const dist = 26 + ((frame * (4.5 + (j % 5) * 0.6) + j * 13.7) % 500);
      const x = Math.cos(ang) * dist, y = Math.sin(ang) * dist;
      const el = ELEMENT_COLORS[ELEMENT_ORDER[(j >> 2) & 3]];
      if (j % 9 === 0) this.put(Shape.Capsule, x, y, 5, ang, el, 1, 3);
      else this.put(Shape.Circle, x, y, 2.6, 0, el, 0.8, 3);
    }
  }

  private writeBoss(frame: number, main: RGB, outline: RGB): void {
    const x = Math.cos(frame * 0.004) * 150, y = -110 + Math.sin(frame * 0.006) * 30;
    const hp = 0.55 + 0.4 * Math.sin(frame * 0.01);
    this.put(Shape.Hex, x, y, 46, frame * 0.004, this.shade(main, 0.9), 1, 4, hp);
    this.put(Shape.Hex, x, y, 46, frame * 0.004, outline, 0.7, 5);
    this.put(Shape.Ring, x, y, 30, 0, outline, 0.5, 7, 0.06);
    this.put(Shape.Circle, x, y, 12, 0, [1, 0.95, 0.85], 1, 4, 1);
    this.put(Shape.Circle, x, y, 70, 0, THREAT_HALO_COLOR, 0.8, 6);
  }

  private writeFx(frame: number): void {
    const o = this.opts;
    const rate = o.fxRate;
    const per = Math.max(1, Math.round(rate));
    for (let k = 0; k < per; k++) {
      const key = frame * 64 + k * 8;
      const rp = (i: number): number => rnd(key + i);
      const rx = (i: number): number => Math.cos(rp(i) * TAU) * Math.sqrt(rp(i + 1)) * 400;
      const ry = (i: number): number => Math.sin(rp(i) * TAU) * Math.sqrt(rp(i + 1)) * 400;
      this.fx(FxKind.Hit, rx(0), ry(0), ELEMENT_COLORS.lightning, 8, 4);
      this.fx(FxKind.Spark, rx(2), ry(2), [1, 0.9, 0.6], 8, 3);
      this.fx(FxKind.Ember, -190 + (rp(4) - 0.5) * 60, 130 + (rp(5) - 0.5) * 60, ELEMENT_COLORS.fire, 40, 3);
      this.fx(FxKind.Toxic, 210 + (rp(6) - 0.5) * 80, -120 + (rp(7) - 0.5) * 80, ELEMENT_COLORS.poison, 50, 2);
      this.fx(FxKind.Frost, 60 + (rp(8) - 0.5) * 70, 280 + (rp(9) - 0.5) * 70, ELEMENT_COLORS.frost, 40, 2);
      if (frame % 3 === k % 3) this.fx(FxKind.Kill, rx(10), ry(10), [1, 0.78, 0.35], 8, 10);
      if (frame % 4 === 0) this.fx(FxKind.Muzzle, Math.cos(frame * 0.021) * 26, Math.sin(frame * 0.021) * 26, [1, 0.95, 0.7], 14, 2);
      if (frame % 8 === k) this.fx(FxKind.Arc, rx(12), ry(12), ELEMENT_COLORS.lightning, 90, 6);
      this.fx(FxKind.Trail, Math.cos(rp(14) * TAU) * 300, Math.sin(rp(14) * TAU) * 300, [0.9, 0.95, 1], 3, 1);
    }
    if (frame % 45 === 0) {
      const ex = Math.cos(rnd(frame) * TAU) * 200, ey = Math.sin(rnd(frame) * TAU) * 200;
      this.fx(FxKind.Explosion, ex, ey, ELEMENT_COLORS.fire, 60, 20);
      this.fx(FxKind.Shockwave, ex, ey, [1, 0.8, 0.5], 110, 1);
    }
    if (frame % 400 === 100) this.fx(FxKind.Counter, 0, 0, GOLD, 170, 12);
    if (frame % 25 === 0) {
      const bx = Math.cos(frame * 0.004) * 150, by = -110 + Math.sin(frame * 0.006) * 30;
      this.fx(FxKind.Tell, bx, by, [1, 0.35, 0.3], 80, 1);
    }
  }
}

/** Parse `#dev`, `#dev:stress`, `#dev:sector=3`, `#dev:stress,sector=2`; null if the hash is not a dev hash. */
export function parseDevHash(hash: string): Partial<DevOptions> | null {
  if (!hash.startsWith('#dev')) return null;
  const rest = hash.slice(4).replace(/^[:?&=-]+/, '');
  let out: Partial<DevOptions> = {};
  for (const part of rest.split(/[,&]/)) {
    if (part === 'stress') out = { ...out, ...DEV_STRESS };
    const m = /^sector=(\d)$/.exec(part);
    if (m) out.sector = Number(m[1]);
  }
  return out;
}
