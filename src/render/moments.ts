/**
 * Presentation-only "moments" the renderer adds on top of the sim snapshot (UX Phase 4, docs/reviews/HANDBOOK-EVAL.md):
 *
 *  - Telegraphs survive spectacle (C-18): while a boss tell is live, the player's own effects (layers 1–3: hazards,
 *    player fx, projectiles, blast cores and so their bloom) fade within a radius of the boss, and one simple in-world
 *    marker per tell shows on layer 7 with a dark under-stroke (readable over any effect):
 *      ring    — Repulsor Pulse / Missile Storm / Singularity Bomb tells (slam, hazard ring, inhale, halo, split): a ring
 *                that closes on the boss through the wind-up;
 *      cone    — Time Field tells (ram charge, dash lane, dilation): a wedge from the boss toward the tower;
 *      line    — EMP tells (shield links, tethers, revive beam): a beam line from the boss toward the tower;
 *      target  — Bombardment / designate tells (sac, gate, wall, maw, nodes): a ring with crosshair ticks;
 *      clones  — Hunter Mark (clone shuffle): the same ring around every boss-sized body (never gives the true one away).
 *    The boss is found as the largest enemy body (layer 4) in the snapshot; the tell's Counter comes from UiState.
 *    Under reduced motion the marker holds still; Clarity deepens the fade.
 *  - The hull mark: one pip per Prestige done, on an arc above the hull (≤ HULL_MARK_CAP), then a numeral.
 *  - The first-Prestige rebuild beat (C-19): the old tower (a copy of the last pre-Prestige snapshot's layer-0 tower
 *    instances) dissolves, then the live (new) hull assembles from the inside out. Reduced motion: a short crossfade.
 *
 * Nothing here feeds back into the sim (cosmetic; no determinism impact). Allocates nothing per frame in steady state.
 */
import { FxKind, INSTANCE_FLOATS, INST_FLAG_SCALE, Shape, TOWER_RADIUS, type RenderSnapshot } from '@sim/core/types';

export type TellMarkerKind = 'ring' | 'cone' | 'line' | 'target' | 'clones';

/** Each boss tell's Counter → its one marker (bosses.ts: every tell is defined by the Counter that answers it). */
const MARKER_OF: Readonly<Record<string, TellMarkerKind>> = {
  repulsor_pulse: 'ring', missile_storm: 'ring', singularity_bomb: 'ring',
  time_field: 'cone', emp: 'line', bombardment: 'target', designate: 'target', hunter_mark: 'clones',
};
export function tellMarkerFor(counter: string | null | undefined): TellMarkerKind | null {
  return counter ? MARKER_OF[counter] ?? 'ring' : null;
}

export const REBUILD_S = 2.5;
export const REBUILD_REDUCED_S = 0.7;
const DISSOLVE_S = 1.0;
/** Peak camera push-in during the beat (Camera.punch fraction: 1.6 = 2.6× closer). */
const BEAT_ZOOM = 1.6;
const ASSEMBLE_S = 1.2;
/** Tower instances (layer 0) live within this distance of the origin (hull, mounts, runes, ornament ≤ R × 3.4). */
export const TOWER_ZONE = TOWER_RADIUS * 3.6;
/** Pips up to this many Prestiges, a numeral beyond. */
export const HULL_MARK_CAP = 10;
/** Hull-mark pip half-size, pip spacing and the arc's radius, in CSS px (moments.ts writeHullMark). */
export const HULL_PIP_PX = 2.8;
export const HULL_PIP_GAP_PX = 7.4;
export const HULL_ARC_PX = 20;
/** Player effects near a live tell keep this share of their alpha (Spectacle); Clarity lowers it further. */
export const TELL_FADE = 0.2;
const MAX = 640;
const F = INSTANCE_FLOATS;
/** Amber, the tell colour of the HUD tell card (not the red of the designation reticle). */
const TELL_RGB = [1, 0.66, 0.12] as const;

export interface MomentOptions { reduced: boolean; clarity: number; pxPerUnit: number }

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Seven-segment masks for 0–9 (bits a b c d e f g). */
const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

export class Moments {
  readonly buf = new Float32Array(MAX * F);
  count = 0;
  prestigeCount = 0;
  /** Tell markers and the fade on (the readability check turns them off for its before/after frame). */
  tellsOn = true;
  /** The markers alone (the fade stays): the readability check separates the two. */
  markersOn = true;
  // ---- tell
  private counter: string | null = null;
  private tellAge = 0;
  private fadeNow = 1;
  private bossX = 0; private bossY = 0; private bossR = 0; private bossOk = false;
  /** The marker drawn this frame (tests / the readability check): kind, centre, extent (world units). */
  readonly marker = { kind: null as TellMarkerKind | null, x: 0, y: 0, r: 0 };
  // ---- rebuild beat
  private ghost = new Float32Array(0);
  private ghostN = 0;
  private beatT = -1;
  private beatDur = 0;
  private beatReduced = false;

  /** The live tell's Counter (UiState.wave.tellActive), or null. */
  setTell(counter: string | null): void {
    if (counter === this.counter) return;
    this.counter = counter;
    this.tellAge = 0;
  }

  get tellLive(): boolean { return this.counter !== null && this.bossOk; }
  get rebuilding(): boolean { return this.beatT >= 0; }
  /** Seconds into the beat (−1: none). */
  get beatTime(): number { return this.beatT; }

  /**
   * Start the rebuild beat from `snap` (the last pre-Prestige snapshot: its tower is copied now, before the buffer goes
   * back to the worker). Returns the beat's length in ms.
   */
  startRebuild(snap: RenderSnapshot | null, reduced: boolean): number {
    this.ghostN = 0;
    const src = snap && snap.instances.length >= snap.instanceCount * F ? snap.instances : null;
    if (src && snap) {
      if (this.ghost.length < snap.instanceCount * F) this.ghost = new Float32Array(Math.min(MAX, snap.instanceCount) * F);
      for (let i = 0, o = 0; i < snap.instanceCount && this.ghostN * F < this.ghost.length; i++, o += F) {
        const lf = src[o + 9];
        const layer = lf < INST_FLAG_SCALE ? Math.round(lf) : Math.round(lf) & 7;
        if (layer !== 0 || src[o] * src[o] + src[o + 1] * src[o + 1] > TOWER_ZONE * TOWER_ZONE) continue;
        this.ghost.set(src.subarray(o, o + F), this.ghostN * F);
        this.ghostN++;
      }
    }
    this.beatReduced = reduced;
    this.beatDur = reduced ? REBUILD_REDUCED_S : REBUILD_S;
    this.beatT = 0;
    return this.beatDur * 1000;
  }

  /**
   * The beat's camera push-in toward the tower (a fraction added to Camera.punch): eases in over 0.35 s, holds, eases out
   * over the last 0.4 s. None under reduced motion (that beat is a plain crossfade).
   */
  get zoomKick(): number {
    const t = this.beatT;
    if (t < 0 || this.beatReduced) return 0;
    const e = (v: number): number => { const c = clamp01(v); return c * c * (3 - 2 * c); };
    return BEAT_ZOOM * Math.min(e(t / 0.35), e((this.beatDur - t) / 0.4));
  }

  endRebuild(): void { this.beatT = -1; this.ghostN = 0; }

  /** Shatter burst at the start of the dissolve (the Particles' own fx path); none under reduced motion. */
  burst(spawn: (kind: number, x: number, y: number, r: number, g: number, b: number, size: number, count: number) => void): void {
    if (this.beatReduced || this.beatT !== 0) return;
    spawn(FxKind.Shatter, 0, 0, 0.75, 0.9, 1, TOWER_RADIUS, 22);
    spawn(FxKind.Ember, 0, 0, 1, 0.8, 0.5, TOWER_RADIUS * 1.5, 18);
  }

  private push(x: number, y: number, r: number, rot: number, shape: number, cr: number, cg: number, cb: number, a: number, layer: number, aux0 = 0, aux1 = 0): void {
    if (this.count >= MAX || a <= 0.003) return;
    const o = this.count++ * F, f = this.buf;
    f[o] = x; f[o + 1] = y; f[o + 2] = r; f[o + 3] = rot; f[o + 4] = shape;
    f[o + 5] = cr; f[o + 6] = cg; f[o + 7] = cb; f[o + 8] = a; f[o + 9] = layer; f[o + 10] = aux0; f[o + 11] = aux1;
  }

  /** A stroke with a dark under-stroke (layer 7): reads over bright effects and over the dark floor alike. */
  private ring(x: number, y: number, r: number, w: number, a: number): void {
    this.push(x, y, r, 0, Shape.Ring, 0.02, 0.01, 0.03, 0.75 * a, 7, Math.min(0.9, (w * 2.4) / r));
    this.push(x, y, r, 0, Shape.Ring, TELL_RGB[0], TELL_RGB[1], TELL_RGB[2], a, 7, Math.min(0.6, w / r));
  }
  private line(x0: number, y0: number, x1: number, y1: number, w: number, a: number): void {
    this.push(x0, y0, w * 1.9, 0, Shape.Line, 0.02, 0.01, 0.03, 0.75 * a, 7, x1, y1);
    this.push(x0, y0, w * 0.75, 0, Shape.Line, TELL_RGB[0], TELL_RGB[1], TELL_RGB[2], a, 7, x1, y1);
  }

  /** The beat's assemble factor for the live tower at normalised distance `dn` (0 centre … 1 zone edge); 1 = as drawn. */
  private assemble(dn: number): number {
    const t = this.beatT;
    if (t < 0) return 1;
    if (this.beatReduced) return clamp01(t / this.beatDur);
    if (t < DISSOLVE_S) return 0;
    const k = (t - DISSOLVE_S) / ASSEMBLE_S;
    return clamp01((k - 0.5 * dn) / 0.5);
  }

  /** Before the frame is sorted: advance timers, find the boss, write this frame's instances. `dt` real seconds. */
  build(snap: RenderSnapshot, dt: number, o: MomentOptions): number {
    this.count = 0;
    const px = 1 / Math.max(1e-6, o.pxPerUnit || 1);
    if (this.beatT >= 0) {
      this.beatT += dt;
      if (this.beatT >= this.beatDur) this.endRebuild();
    }
    this.writeGhost();
    this.writeHullMark(px);
    this.marker.kind = null;
    this.bossOk = false;
    if (this.counter !== null && this.tellsOn) {
      this.tellAge += dt;
      this.findBoss(snap);
      if (this.bossOk && this.markersOn) this.writeTell(snap, px, o.reduced);
      const target = TELL_FADE * (1 - 0.5 * o.clarity);
      this.fadeNow = o.reduced ? target : Math.max(target, this.fadeNow - dt / 0.12);
    } else this.fadeNow = 1;
    if (this.beatT >= 0 && !this.beatReduced) {
      // closing flourish: one ring expands from the finished hull
      const k = (this.beatT - DISSOLVE_S - ASSEMBLE_S) / (REBUILD_S - DISSOLVE_S - ASSEMBLE_S);
      if (k > 0 && k < 1) this.push(0, 0, TOWER_RADIUS * (1.1 + 1.6 * k), 0, Shape.Ring, 0.75, 0.92, 1, 0.8 * (1 - k), 7, Math.min(0.5, (3 * px) / (TOWER_RADIUS * (1.1 + 1.6 * k))));
    }
    return this.count;
  }

  private writeGhost(): void {
    const t = this.beatT;
    if (t < 0 || this.ghostN === 0) return;
    const g = this.ghost;
    for (let i = 0, s = 0; i < this.ghostN; i++, s += F) {
      const x = g[s], y = g[s + 1];
      const dn = clamp01(Math.sqrt(x * x + y * y) / TOWER_ZONE);
      let k: number;
      if (this.beatReduced) k = clamp01(t / this.beatDur);
      else k = clamp01((t / DISSOLVE_S - 0.4 * (1 - dn)) / 0.6);   // the ornament (outer) goes first
      if (k >= 1) continue;
      const spread = this.beatReduced ? 1 : 1 + 0.6 * k;
      const line = g[s + 4] === Shape.Line;
      this.push(x * spread, y * spread, g[s + 2] * (this.beatReduced ? 1 : 1 - 0.45 * k), g[s + 3] + (this.beatReduced ? 0 : 0.6 * k), g[s + 4],
        g[s + 5], g[s + 6], g[s + 7], g[s + 8] * (1 - k), 0, line ? g[s + 10] * spread : g[s + 10], line ? g[s + 11] * spread : g[s + 11]);
    }
  }

  /** One pip per Prestige on an arc above the hull (screen up = −y), or a pip and a numeral past the cap. */
  private writeHullMark(px: number): void {
    const n = this.prestigeCount | 0;
    if (n <= 0) return;
    const a = this.assemble(0.45);
    if (a <= 0) return;
    // sized in CSS px (px = world units per CSS px), so a pip reads on a phone at any zoom: ~5.6 px across, 7.4 px apart,
    // on an arc 20–25 px from the tower's centre (inside its 34 px hold zone, outside the hull) spanning ≤ ~150°
    const pr = HULL_PIP_PX * px;
    const shown = Math.min(n, HULL_MARK_CAP);
    const R = Math.max(TOWER_RADIUS * 1.32, HULL_ARC_PX * px, (HULL_PIP_GAP_PX * px * (shown - 1)) / 2.6);
    if (n <= HULL_MARK_CAP) {
      const step = (HULL_PIP_GAP_PX * px) / R;
      const a0 = -Math.PI / 2 - ((n - 1) * step) / 2;
      for (let k = 0; k < n; k++) {
        const ang = a0 + k * step;
        const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
        this.push(x, y, pr * 1.55, 0, Shape.Circle, 0.03, 0.03, 0.06, 0.8 * a, 0);
        this.push(x, y, pr, Math.PI / 4, Shape.Diamond, 1, 0.86, 0.5, a, 0);
      }
      return;
    }
    // past the cap: one pip and the count as a seven-segment numeral above it
    this.push(0, -R, pr * 1.55, 0, Shape.Circle, 0.03, 0.03, 0.06, 0.8 * a, 0);
    this.push(0, -R, pr, Math.PI / 4, Shape.Diamond, 1, 0.86, 0.5, a, 0);
    const digits = String(Math.min(n, 999));
    const h = Math.max(7, 10 * px), w = h * 0.55, gap = w * 0.45, lw = Math.max(0.7, 1.1 * px);
    const total = digits.length * w + (digits.length - 1) * gap;
    const cy = -R - pr * 2 - h / 2 - 2 * px;
    for (let d = 0; d < digits.length; d++) {
      const m = SEG[digits.charCodeAt(d) - 48] ?? 0;
      const x0 = -total / 2 + d * (w + gap), x1 = x0 + w, yT = cy - h / 2, yM = cy, yB = cy + h / 2;
      const segs: [number, number, number, number][] = [
        [x0, yT, x1, yT], [x1, yT, x1, yM], [x1, yM, x1, yB], [x0, yB, x1, yB], [x0, yM, x0, yB], [x0, yT, x0, yM], [x0, yM, x1, yM],
      ];
      for (let k = 0; k < 7; k++) {
        if (!(m & (1 << k))) continue;
        const sg = segs[k];
        this.push(sg[0], sg[1], lw * 1.9, 0, Shape.Line, 0.03, 0.03, 0.06, 0.8 * a, 0, sg[2], sg[3]);
        this.push(sg[0], sg[1], lw * 0.6, 0, Shape.Line, 1, 0.86, 0.5, a, 0, sg[2], sg[3]);
      }
    }
  }

  private findBoss(snap: RenderSnapshot): void {
    const src = snap.instances;
    const n = Math.min(snap.instanceCount, Math.floor(src.length / F));
    let best = 0;
    for (let i = 0, o = 0; i < n; i++, o += F) {
      if (src[o + 9] !== 4) continue;   // unflagged enemy bodies only
      const r = src[o + 2];
      if (r > best) { best = r; this.bossX = src[o]; this.bossY = src[o + 1]; }
    }
    this.bossR = best;
    this.bossOk = best > 0;
  }

  private writeTell(snap: RenderSnapshot, px: number, reduced: boolean): void {
    const kind = tellMarkerFor(this.counter)!;
    const bx = this.bossX, by = this.bossY, br = Math.max(this.bossR, 8 * px);
    const w = 3 * px;
    // the wind-up: a 1.2 s cycle (held still under reduced motion)
    const p = reduced ? 0.5 : (this.tellAge % 1.2) / 1.2;
    const m = this.marker;
    m.kind = kind; m.x = bx; m.y = by;
    switch (kind) {
      case 'ring': {
        const r = br * 1.25 + 10 * px + (1 - p) * br * 0.8;
        this.ring(bx, by, r, w, 1);
        m.r = r;
        break;
      }
      case 'target': {
        const r = br * 1.2 + 10 * px;
        this.ring(bx, by, r, w, 1);
        for (let k = 0; k < 4; k++) {
          const a = k * (Math.PI / 2) + Math.PI / 4;
          const c = Math.cos(a), s = Math.sin(a);
          this.line(bx + c * (r + 3 * px), by + s * (r + 3 * px), bx + c * (r + 14 * px), by + s * (r + 14 * px), w, 1);
        }
        m.r = r + 14 * px;
        break;
      }
      case 'clones': {
        const src = snap.instances, n = Math.min(snap.instanceCount, Math.floor(src.length / F));
        let drawn = 0;
        for (let i = 0, o = 0; i < n && drawn < 8; i++, o += F) {
          if (src[o + 9] !== 4 || src[o + 2] < this.bossR * 0.8) continue;
          this.ring(src[o], src[o + 1], src[o + 2] * 1.2 + 9 * px, w, 1);
          drawn++;
        }
        m.r = br * 1.2 + 9 * px;
        break;
      }
      case 'cone':
      case 'line': {
        const d = Math.sqrt(bx * bx + by * by);
        if (d < 1e-3) break;
        const ux = -bx / d, uy = -by / d;
        const L = Math.max(0, d - br - TOWER_RADIUS * 1.6);
        const sx = bx + ux * (br + 4 * px), sy = by + uy * (br + 4 * px);
        if (kind === 'line') {
          const a = reduced ? 1 : 0.75 + 0.25 * Math.sin(p * Math.PI * 2);
          this.line(sx, sy, sx + ux * L, sy + uy * L, w * 1.2, a);
          this.ring(bx, by, br * 1.15 + 8 * px, w * 0.8, 0.8);
        } else {
          const spread = 0.3;
          for (const sgn of [-1, 1]) {
            const c = Math.cos(spread * sgn), s = Math.sin(spread * sgn);
            const vx = ux * c - uy * s, vy = ux * s + uy * c;
            this.line(sx, sy, sx + vx * L, sy + vy * L, w, 1);
          }
          // chevrons marching toward the tower through the wind-up
          for (let k = 0; k < 3; k++) {
            const f = ((k + p) / 3) * 0.9;
            this.push(sx + ux * L * f, sy + uy * L * f, 7 * px + br * 0.2, Math.atan2(uy, ux), Shape.Chevron, TELL_RGB[0], TELL_RGB[1], TELL_RGB[2], 0.85, 7);
          }
        }
        m.r = L;
        break;
      }
    }
  }

  /**
   * After the sort: fade the player's effects near a live tell (layers 1–3) and run the beat on the live tower (the
   * snapshot's first `towerCount` layer-0 instances). `starts` = per-layer start indices into `sorted`.
   */
  post(sorted: Float32Array, starts: Int32Array, towerCount: number): void {
    if (this.beatT >= 0) {
      for (let i = starts[0], e = starts[0] + towerCount; i < e; i++) {
        const o = i * F;
        const x = sorted[o], y = sorted[o + 1];
        const d2 = x * x + y * y;
        if (d2 > TOWER_ZONE * TOWER_ZONE) continue;
        const k = this.assemble(Math.sqrt(d2) / TOWER_ZONE);
        if (k >= 1) continue;
        sorted[o + 8] *= k;
        if (this.beatReduced) continue;
        const fly = 1 + 1.2 * (1 - k);
        sorted[o] = x * fly; sorted[o + 1] = y * fly; sorted[o + 2] *= 0.5 + 0.5 * k;
        if (sorted[o + 4] === Shape.Line) { sorted[o + 10] *= fly; sorted[o + 11] *= fly; }
      }
    }
    if (this.counter === null || !this.tellsOn || !this.bossOk || this.fadeNow >= 1) return;
    const bx = this.bossX, by = this.bossY;
    const R = this.bossR * 2.2 + 70, R0 = R * 0.7;
    const keep = this.fadeNow;
    for (let i = starts[1], e = starts[4]; i < e; i++) {
      const o = i * F;
      const dx = sorted[o] - bx, dy = sorted[o + 1] - by;
      const d = Math.sqrt(dx * dx + dy * dy) - sorted[o + 2] * 0.5;
      if (d >= R) continue;
      const wgt = d <= R0 ? 1 : 1 - (d - R0) / (R - R0);
      sorted[o + 8] *= 1 - (1 - keep) * wgt;
    }
  }
}
