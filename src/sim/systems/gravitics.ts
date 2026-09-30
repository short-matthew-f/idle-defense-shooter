/**
 * Gravitics (design §7): gravity wells. Stat keys: gravitics.wells (1 → 4 main wells), gravitics.pull
 * (units/s drag toward the center), gravitics.radius, gravitics.duration (s held), gravitics.cooldown (s before a
 * collapsed well re-forms; ÷ cooldown factor), Exotic Mass Driver (captives are flung out on collapse and collide
 * with enemies they land on for mass_driver.fraction of their max HP, boss_fraction for bosses).
 * Placement: a ready well spawns where its radius catches the most enemies (candidates sampled at live enemies,
 * scored by queryRadius count, ties → lower index, never inside another active well). Anchors (Immovable) ignore
 * the pull (World.pull). Wells are published to world.shared.wells (x, y, r, captives) and collapses of this tick
 * to world.shared.collapses (for Infusions / Linkages).
 * Doctrines:
 *   collapse  implosion: collapse.base_damage × implosion × yield × (1 + per_captive × captives) in the radius;
 *             Chain Collapse: each main implosion spawns chain_collapse.count half-radius wells (1.5 s, 50% damage)
 *   lensing   projectiles passing within a well bend toward its center and gain +bend (+focus) damage once per
 *             well (ProjFlag.Lensed); Focal Point: they converge (homing) on the highest-HP enemy the well holds.
 *             Beams are lensed by the laser system.
 *   tidal     wells drift toward the tower at tidal.drift u/s, stopping tidal.drift_stop out; pull × riptide;
 *             Orbit Lock: on collapse captives orbit the tower at blade radius for orbit_lock.seconds
 * Linkage read here: chassis.reactor+gravitics (Event Loop) cuts the next cooldown per captive (≤ 50%).
 */
import type { System, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import type { ElementId } from '../core/ids';
import { EnemyFlag, Ev, FxKind, MAX_ENEMIES, MAX_WELLS, ProjFlag, Shape, TICK_DT } from '../core/types';
import { cos, sin } from '../math/lut';
import {
  HB_FOCAL, HB_LENS_SHIFT, SCRATCH, SRC_GRAVITICS, bestScore, cooldownFactor, densestEnemy, infusedElement, querySegment, remapArray,
  steerToward, targetableEnemy,
} from './hardpoints/common';

const MAIN_MAX = 4;
const TAU = 6.283185307179586;
const LENS_TURN = 2.5;    // rad/s bend toward a well center
const ORBIT_SPEED = 2;    // rad/s

export class GraviticsSystem implements System {
  readonly id = 'gravitics';
  private on = false;
  private wellsN = 1; private pull = 120; private R = 90; private duration = 180; private cooldown = 480;
  private massDriver = false; private mdFrac = 0.1; private mdBoss = 0.05;
  private collapse = false; private implosion = 1; private baseDmg = 30; private perCaptive = 0.15; private chain = false; private chainN = 2;
  private lensing = false; private lensBonus = 0; private focal = false;
  private drift = 0; private driftStop = 50; private riptide = 1; private orbitLock = false; private orbitTicks = 120;
  private eventLoop = 0;
  private element: ElementId | null = null;
  // well slots: 0..3 main, 4.. chain
  private act = new Uint8Array(MAX_WELLS); private chainW = new Uint8Array(MAX_WELLS);
  private wx = new Float32Array(MAX_WELLS); private wy = new Float32Array(MAX_WELLS); private wr = new Float32Array(MAX_WELLS);
  private life = new Int32Array(MAX_WELLS); private cd = new Float32Array(MAX_WELLS); private dmgMul = new Float32Array(MAX_WELLS);
  private caps = new Int32Array(MAX_WELLS); private maxCaps = new Int32Array(MAX_WELLS); private spin = new Float32Array(MAX_WELLS);
  private focalT = new Int32Array(MAX_WELLS);
  private orbitT = new Uint16Array(MAX_ENEMIES); private orbitA = new Float32Array(MAX_ENEMIES);
  private orbiting = 0;
  private avoid = new Float32Array(MAX_WELLS * 4);
  private fxN = 0; private fxBuf = new Float32Array(MAX_WELLS * 3 * 4);

  init(w: World): void { this.rebuild(w); this.reset(); }
  onAttemptStart(): void { this.reset(); }
  private reset(): void {
    this.act.fill(0); this.cd.fill(0); this.chainW.fill(0); this.orbitT.fill(0); this.orbiting = 0; this.fxN = 0;
  }

  rebuild(w: World): void {
    const s = w.stats;
    this.on = s.mounted('gravitics');
    this.wellsN = Math.max(1, Math.min(MAIN_MAX, Math.floor(s.get('gravitics.wells') + 1e-9)));
    this.R = Math.max(10, s.get('gravitics.radius'));
    this.duration = Math.max(1, Math.round(s.get('gravitics.duration') * 60));
    this.cooldown = Math.max(1, Math.round(s.get('gravitics.cooldown') * 60));
    this.massDriver = s.has('gravitics.mass_driver');
    this.mdFrac = s.get('gravitics.mass_driver.fraction'); this.mdBoss = s.get('gravitics.mass_driver.boss_fraction');
    this.collapse = s.doctrineStrength('gravitics', 'collapse') > 0 && s.has('gravitics.collapse.implosion');
    // Every collapse crushes its captives for gravitics.damage (the tree's damage node scales it); the Collapse
    // Doctrine multiplies that by implosion × yield.
    this.implosion = this.collapse ? s.get('gravitics.collapse.implosion') * s.get('gravitics.collapse.yield') : 1;
    this.baseDmg = s.get('gravitics.damage');
    this.perCaptive = s.get('gravitics.collapse.per_captive');
    this.chain = this.collapse && s.has('gravitics.collapse.chain_collapse');
    this.chainN = Math.max(0, Math.min(4, Math.floor(s.get('gravitics.collapse.chain_collapse.count'))));
    this.lensing = s.doctrineStrength('gravitics', 'lensing') > 0 && s.has('gravitics.lensing.bend');
    this.lensBonus = this.lensing ? s.get('gravitics.lensing.bend') + s.get('gravitics.lensing.focus') : 0;
    this.focal = this.lensing && s.has('gravitics.lensing.focal_point');
    const tidal = s.doctrineStrength('gravitics', 'tidal') > 0;
    this.drift = tidal && s.has('gravitics.tidal.drift') ? s.get('gravitics.tidal.drift') : 0;
    this.driftStop = s.get('gravitics.tidal.drift_stop');
    this.riptide = tidal ? s.get('gravitics.tidal.riptide') : 1;
    this.pull = Math.max(0, s.get('gravitics.pull')) * this.riptide;
    this.orbitLock = tidal && s.has('gravitics.tidal.orbit_lock');
    this.orbitTicks = Math.round(s.get('gravitics.tidal.orbit_lock.seconds') * 60);
    this.eventLoop = s.has('chassis.reactor+gravitics') ? s.get('chassis.reactor+gravitics') : 0;
    this.element = infusedElement(s, 'gravitics');
  }

  update(w: World): void {
    const sh = w.shared;
    sh.collapseCount = 0;
    if (!this.on) { sh.wellCount = 0; return; }
    const cf = cooldownFactor(w.stats);
    const dyn = w.dynamicSpeedMul > 0 ? w.dynamicSpeedMul : 1;   // Overdrive / Ember Heart / Critical Mass: faster re-forming
    // spawn ready main wells
    for (let k = 0; k < this.wellsN; k++) {
      if (this.act[k]) continue;
      if (this.cd[k] > 0) { this.cd[k] -= dyn; continue; }
      if (w.enemies.count === 0) continue;
      this.spawn(w, k);
    }
    // active wells
    const buf = SCRATCH.push();
    const e = w.enemies;
    for (let k = 0; k < MAX_WELLS; k++) {
      if (!this.act[k]) continue;
      this.spin[k] += 3 * TICK_DT;
      if (this.drift > 0 && !this.chainW[k]) {
        const d = Math.sqrt(this.wx[k] * this.wx[k] + this.wy[k] * this.wy[k]);
        if (d > this.driftStop) {
          const step = Math.min(d - this.driftStop, this.drift * TICK_DT);
          this.wx[k] -= (this.wx[k] / d) * step; this.wy[k] -= (this.wy[k] / d) * step;
        }
      }
      const cnt = w.queryRadius(this.wx[k], this.wy[k], this.wr[k], buf);
      let caps = 0;
      for (let j = 0; j < cnt; j++) {
        const i = buf[j];
        if (!w.alive(i) || (e.flags[i] & EnemyFlag.Ally)) continue;
        caps++;
        w.pull(i, this.wx[k], this.wy[k], this.pull);
      }
      this.caps[k] = caps;
      if (caps > this.maxCaps[k]) this.maxCaps[k] = caps;
      if (--this.life[k] <= 0) this.collapseWell(w, k, cf);
    }
    SCRATCH.pop();
    if (this.orbiting > 0) this.orbitStep(w);
    // publish
    let m = 0;
    for (let k = 0; k < MAX_WELLS; k++) {
      if (!this.act[k]) continue;
      sh.wells[m * 4] = this.wx[k]; sh.wells[m * 4 + 1] = this.wy[k]; sh.wells[m * 4 + 2] = this.wr[k]; sh.wells[m * 4 + 3] = this.caps[k];
      m++;
    }
    sh.wellCount = m;
    if (this.lensing && m > 0) this.lens(w);
  }

  private spawn(w: World, k: number): void {
    let na = 0;
    for (let j = 0; j < MAX_WELLS; j++) if (this.act[j]) {
      this.avoid[na * 4] = this.wx[j]; this.avoid[na * 4 + 1] = this.wy[j]; this.avoid[na * 4 + 2] = this.wr[j] + this.R * 0.5; na++;
    }
    // Wells only form on enemies inside the primary's range. Without the limit a well could form on a lone
    // enemy beyond every weapon's reach and re-form on it after each collapse, pinning it there forever (a
    // wave that never ends; seen with shield-regenerating enemies at r ≈ 410–640).
    const best = densestEnemy(w, 0, 0, Math.max(150, w.stats.get('ballistics.range')), this.R, 64, this.avoid, na);
    if (best < 0 || bestScore === 0) return;
    // Centre the well a quarter radius inside the cluster (toward the tower): captives are dragged inward
    // ("Wells drag enemies inward"), never held in place at the edge of the weapons' reach.
    const bx = w.enemies.x[best], by = w.enemies.y[best], br = Math.sqrt(bx * bx + by * by);
    const kIn = br > 1e-6 ? Math.max(0, br - this.R * 0.25) / br : 0;
    this.open(k, bx * kIn, by * kIn, this.R, Math.max(1, Math.round(this.duration * (w.signals?.wellLifeMul ?? 1))), 1, false);   // Boons: Anchor Well
    w.emit(Ev.Fx, 'gravitics.well', k, bestScore, this.wx[k], this.wy[k], -1);
  }

  private open(k: number, x: number, y: number, r: number, life: number, dmgMul: number, chain: boolean): void {
    this.act[k] = 1; this.chainW[k] = chain ? 1 : 0;
    this.wx[k] = x; this.wy[k] = y; this.wr[k] = r; this.life[k] = life; this.dmgMul[k] = dmgMul;
    this.caps[k] = 0; this.maxCaps[k] = 0; this.spin[k] = 0; this.focalT[k] = -1_000_000;
  }

  private collapseWell(w: World, k: number, cf: number): void {
    const sh = w.shared, e = w.enemies;
    const x = this.wx[k], y = this.wy[k], r = this.wr[k];
    this.act[k] = 0;
    const buf = SCRATCH.push();
    const cnt = w.queryRadius(x, y, r, buf);
    let caps = 0;
    for (let j = 0; j < cnt; j++) if (w.alive(buf[j])) buf[caps++] = buf[j];
    const cause = w.emit(Ev.Fx, 'gravitics.collapse', k, caps, x, y, -1);
    if (sh.collapseCount < MAX_WELLS) {
      const o = sh.collapseCount++ * 4;
      sh.collapses[o] = x; sh.collapses[o + 1] = y; sh.collapses[o + 2] = r; sh.collapses[o + 3] = caps;
    }
    if (this.fxN < MAX_WELLS * 3) { const o = this.fxN++ * 3; this.fxBuf[o] = x; this.fxBuf[o + 1] = y; this.fxBuf[o + 2] = r; }
    if (this.baseDmg > 0) {
      const dmg = this.baseDmg * this.implosion * (1 + this.perCaptive * caps) * this.dmgMul[k];
      w.explode(x, y, r, dmg, { source: 'gravitics', srcTag: 'gravitics', element: this.element, cause, falloff: false });
      if (this.chain && !this.chainW[k]) {
        let spawned = 0;
        for (let s = MAIN_MAX; s < MAX_WELLS && spawned < this.chainN; s++) {
          if (this.act[s]) continue;
          const a = w.tick * 0.7 + (spawned * TAU) / Math.max(1, this.chainN);
          this.open(s, x + cos(a) * r * 0.5, y + sin(a) * r * 0.5, r * 0.5, 90, 0.5, true);
          spawned++;
        }
        if (spawned > 0) w.emit(Ev.Fx, 'gravitics.collapse.chain_collapse', k, spawned, x, y, cause);
      }
    }
    if (this.massDriver && caps > 0) this.fling(w, buf, caps, x, y, r, cause);
    if (this.orbitLock && caps > 0) {
      const R = sh.bladeCount > 0 ? sh.bladeInner[0] + sh.bladeLens[0] * 0.6 : 70;
      for (let j = 0; j < caps; j++) {
        const i = buf[j];
        if (!w.alive(i) || (e.flags[i] & (EnemyFlag.Immovable | EnemyFlag.Boss))) continue;
        if (this.orbitT[i] === 0) this.orbiting++;
        this.orbitT[i] = this.orbitTicks;
        this.orbitA[i] = (j * TAU) / caps + w.tick * 0.01;
      }
      this.orbitR = R;
      w.emit(Ev.Fx, 'gravitics.tidal.orbit_lock', k, caps, x, y, cause);
    }
    SCRATCH.pop();
    if (!this.chainW[k]) {
      let next = Math.round(this.cooldown * cf);
      if (this.eventLoop > 0 && this.maxCaps[k] > 0) {
        const cut = Math.min(next * 0.5, this.maxCaps[k] * this.eventLoop * 60);
        next -= Math.round(cut);
        w.emit(Ev.Linkage, 'chassis.reactor+gravitics', k, cut / 60, x, y, cause);
      }
      this.cd[k] = Math.max(1, next);
    }
  }
  private orbitR = 70;

  /**
   * Mass Driver: fling captives out past the well's edge; each collides with up to 3 non-captive enemies along its
   * flight path (capsule sweep), dealing mass_driver.fraction (boss_fraction for bosses) of the thrown enemy's max HP
   * to them and to itself.
   */
  private fling(w: World, caps: Int32Array, n: number, x: number, y: number, r: number, cause: number): void {
    const e = w.enemies, tick = w.tick;
    for (let j = 0; j < n; j++) this.stamp[caps[j]] = tick;
    const hitBuf = SCRATCH.push();
    for (let j = 0; j < n; j++) {
      const i = caps[j];
      if (!w.alive(i)) continue;
      let dx = e.x[i] - x, dy = e.y[i] - y;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) { const a = j * 2.399; dx = cos(a); dy = sin(a); d = 0; }
      const x0 = e.x[i], y0 = e.y[i];
      w.knockback(i, dx, dy, Math.max(30, r + 20 - d));
      if (!w.alive(i)) continue;
      const x1 = e.x[i], y1 = e.y[i];
      if (x1 === x0 && y1 === y0) continue;   // Anchors are not thrown
      const frac = (e.flags[i] & EnemyFlag.Boss) ? this.mdBoss : this.mdFrac;
      const impact = e.maxHp[i] * frac;
      const cnt = querySegment(w, x0, y0, x1, y1, e.radius[i], hitBuf);
      let hits = 0;
      for (let q = 0; q < cnt && hits < 3; q++) {
        const o = hitBuf[q];
        if (o === i || this.stamp[o] === tick || !w.alive(o)) continue;
        w.damage(o, impact, { source: 'gravitics', srcTag: 'gravitics', cause });
        hits++;
      }
      if (hits > 0) {
        w.damage(i, impact, { source: 'gravitics', srcTag: 'gravitics', cause });
        w.emit(Ev.Fx, 'gravitics.mass_driver', i, hits, x1, y1, cause);
      }
    }
    SCRATCH.pop();
  }
  private stamp = new Int32Array(MAX_ENEMIES).fill(-1);

  private orbitStep(w: World): void {
    const e = w.enemies;
    let live = 0;
    for (let i = 0; i < e.count; i++) {
      if (this.orbitT[i] === 0) continue;
      if (!w.alive(i)) { this.orbitT[i] = 0; continue; }
      this.orbitT[i]--;
      this.orbitA[i] += ORBIT_SPEED * TICK_DT;
      const a = this.orbitA[i];
      w.pull(i, cos(a) * this.orbitR, sin(a) * this.orbitR, 100000);
      if (this.orbitT[i] > 0) live++;
    }
    this.orbiting = live;
  }

  /** Lensing: bend projectiles inside wells, boost them once per well; Focal Point converges them. */
  private lens(w: World): void {
    const p = w.projectiles, sh = w.shared;
    const turn = LENS_TURN * TICK_DT;
    for (let i = 0; i < p.count; i++) {
      const f = p.flags[i];
      if (f & (ProjFlag.Dead | ProjFlag.Hostile)) continue;
      const px = p.x[i], py = p.y[i];
      for (let k = 0; k < sh.wellCount; k++) {
        const wx = sh.wells[k * 4], wy = sh.wells[k * 4 + 1], wr = sh.wells[k * 4 + 2];
        const dx = wx - px, dy = wy - py;
        if (dx * dx + dy * dy > wr * wr) continue;
        const bit = 1 << (HB_LENS_SHIFT + (k & 7));
        if ((p.hpBits[i] & bit) === 0) {
          p.hpBits[i] |= bit;
          p.flags[i] |= ProjFlag.Lensed;
          p.damage[i] *= 1 + this.lensBonus;
          if (this.focal && (p.hpBits[i] & HB_FOCAL) === 0) this.focus(w, i, k);
        }
        if ((p.hpBits[i] & HB_FOCAL) === 0 && p.source[i] !== SRC_GRAVITICS) steerToward(w, i, wx, wy, turn);
        break;
      }
    }
  }

  private focus(w: World, i: number, k: number): void {
    const sh = w.shared, e = w.enemies, p = w.projectiles;
    const buf = SCRATCH.push();
    const cnt = w.queryRadius(sh.wells[k * 4], sh.wells[k * 4 + 1], sh.wells[k * 4 + 2], buf);
    let best = -1, bh = -1;
    for (let j = 0; j < cnt; j++) {
      const q = buf[j];
      if (!targetableEnemy(w, q)) continue;
      if (e.hp[q] > bh || (e.hp[q] === bh && q < best)) { bh = e.hp[q]; best = q; }
    }
    SCRATCH.pop();
    if (best < 0) return;
    p.target[i] = best; p.targetGen[i] = e.gen[best];
    p.hpBits[i] |= HB_FOCAL;
    p.flags[i] |= ProjFlag.Homing;   // core homing keeps converging after the well collapses
    if (w.tick - this.focalT[k & (MAX_WELLS - 1)] >= 30) {
      this.focalT[k & (MAX_WELLS - 1)] = w.tick;
      w.emit(Ev.Fx, 'gravitics.lensing.focal_point', best, i, sh.wells[k * 4], sh.wells[k * 4 + 1], p.cause[i]);
    }
  }

  onCompact(w: World, remap: Int32Array, oldCount: number): void {
    const n = w.enemies.count;
    remapArray(this.orbitT, remap, oldCount, n, 0);
    remapArray(this.orbitA, remap, oldCount, n, 0);
    remapArray(this.stamp, remap, oldCount, n, -1);
  }

  render(_w: World, out: InstanceWriter): void {
    if (!this.on) return;
    for (let k = 0; k < MAX_WELLS; k++) {
      if (!this.act[k]) continue;
      const x = this.wx[k], y = this.wy[k], r = this.wr[k];
      out.push(x, y, r, 0, Shape.Ring, 0.7, 0.5, 1, 0.55, 1);
      out.push(x, y, r * 0.18, 0, Shape.Circle, 0.35, 0.2, 0.6, 0.8, 1);
      for (let s = 0; s < 4; s++) {
        const a = this.spin[k] + (s * TAU) / 4, rr = r * (0.35 + 0.15 * (s & 1));
        out.push(x + cos(a) * rr, y + sin(a) * rr, 2.5, a, Shape.Circle, 0.8, 0.65, 1, 0.8, 1);
      }
    }
    for (let f = 0; f < this.fxN; f++) out.fx(FxKind.Shockwave, this.fxBuf[f * 3], this.fxBuf[f * 3 + 1], 0.7, 0.5, 1, this.fxBuf[f * 3 + 2], 1);
    this.fxN = 0;
  }
}
