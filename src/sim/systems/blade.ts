/**
 * Orbital Blade (design §7): a blade sweeping around the tower. Stat keys:
 *   blade.damage (per hit; each enemy is hit at most once per blade per 0.25 s), blade.length,
 *   blade.rotation_speed (rad/s), blade.knockback (units, radially outward), blade.serration (Bleed chance;
 *   Bleed = blade.bleed.dps × hit damage per second per stack for blade.bleed.duration s),
 *   Exotic Deflection: the blade destroys hostile projectiles it sweeps through.
 * Geometry: blade k is the segment from radius inner_k = TOWER_RADIUS + 2 + k·length/2 to inner_k + length at
 * angle a_k (published to world.shared.blade*). Collision: blade segment vs enemy circles (swept in sub-steps
 * of ≤ 0.07 rad so fast blades cannot skip enemies).
 * Doctrines:
 *   twinning    twinning.blades blades (2 → 4) at distinct radii, extras deal twinning.edge × damage;
 *               Gyre: odd blades counter-rotate
 *   greatblade  ×greatblade.length_mul length, +greatblade.mass damage, −rotation_penalty × Great Mass rank rotation;
 *               Cleaver: +cleaver vs enemies above 50% HP; Sunder: each hit strips sunder.per_hit of the enemy's
 *               original armor and shield capacity (up to sunder.cap)
 *   tempest     Momentum: hits within 1 s stack +momentum rotation (max_stacks); Afterimage: 0.5 s ghost trail
 *               dealing afterimage × damage; Cyclone: at max Momentum, every half turn throws a CuttingArc outward
 *               (cyclone.range units, cyclone.damage × damage)
 * Channel read: world.shared.bladeSpeedMul (Whetstone crits, Kinetic Loop, Flywheel — written by linkages);
 * world.signals.bladeDir (WP8: Clockwork Blade / Reversal flip the spin direction).
 */
import type { System, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import type { ElementId } from '../core/ids';
import { Ev, MAX_BLADES, MAX_ENEMIES, ProjFlag, ProjKind, Shape, TICK_DT, TOWER_RADIUS } from '../core/types';
import { cos, sin } from '../math/lut';
import { ELEMENT_RGB, SCRATCH, SRC_BLADE, elementIndex, infusedElement, querySegment, remapArray, segDist2, targetableEnemy } from './hardpoints/common';

const HIT_CD = 15;
const MAX_SUB = 0.07;
const GHOSTS = 6;
const GHOST_EVERY = 5;
const TAU = 6.283185307179586;

export class BladeSystem implements System {
  readonly id = 'blade';
  private on = false;
  private dmg = 8; private len = 60; private rot = 3; private knock = 20; private serration = 0; private bleedFrac = 0.3; private bleedDur = 180;
  private count = 1; private edge = 0.7; private gyre = false;
  private great = false; private mass = 0; private rotPenalty = 1; private cleaver = 0; private sunder = false; private sunderStep = 0.02; private sunderCap = 0.6;
  private momentum = 0; private maxStacks = 10; private afterimage = 0; private cyclone = false; private cycloneRange = 250; private cycloneDmg = 0.6;
  private deflect = false;
  private element: ElementId | null = null;
  private hw = 4;
  private ang = new Float32Array(MAX_BLADES);
  private stacks = 0; private lastMom = -1_000_000; private cycAcc = 0;
  private lastHit = new Int32Array(MAX_ENEMIES * MAX_BLADES).fill(-1_000_000);
  private ghostHit = new Int32Array(MAX_ENEMIES).fill(-1_000_000);
  private sunderF = new Float32Array(MAX_ENEMIES);
  private ghostA = new Float32Array(MAX_BLADES * GHOSTS); private ghostT = new Int32Array(MAX_BLADES * GHOSTS).fill(-1_000_000);
  private ghostHead = 0;

  init(w: World): void { this.rebuild(w); this.reset(); }
  onAttemptStart(): void { this.reset(); }
  private reset(): void {
    this.stacks = 0; this.lastMom = -1_000_000; this.cycAcc = 0;
    this.lastHit.fill(-1_000_000); this.ghostHit.fill(-1_000_000); this.sunderF.fill(0); this.ghostT.fill(-1_000_000);
    for (let k = 0; k < MAX_BLADES; k++) this.ang[k] = (k * TAU) / MAX_BLADES;
  }

  rebuild(w: World): void {
    const s = w.stats;
    this.on = s.mounted('blade');
    this.dmg = s.get('blade.damage');
    this.len = Math.max(10, s.get('blade.length'));
    this.rot = Math.max(0, s.get('blade.rotation_speed'));
    this.knock = Math.max(0, s.get('blade.knockback'));
    this.serration = Math.max(0, s.get('blade.serration'));
    this.bleedFrac = s.get('blade.bleed.dps');
    this.bleedDur = Math.round(s.get('blade.bleed.duration') * 60);
    const twin = s.doctrineStrength('blade', 'twinning') > 0 && s.has('blade.twinning.blades');
    this.count = twin ? Math.max(1, Math.min(MAX_BLADES, Math.floor(s.get('blade.twinning.blades') + 1e-9))) : 1;
    this.edge = Math.min(1, s.get('blade.twinning.edge'));
    this.gyre = twin && s.has('blade.twinning.gyre');
    this.great = s.doctrineStrength('blade', 'greatblade') > 0 && s.has('blade.greatblade.mass');
    this.mass = this.great ? s.get('blade.greatblade.mass') : 0;
    this.rotPenalty = this.great ? Math.max(0.2, 1 - s.get('blade.greatblade.rotation_penalty') * s.rank('blade.greatblade.mass')) : 1;
    if (this.great) this.len *= s.get('blade.greatblade.length_mul');
    this.cleaver = s.doctrineStrength('blade', 'greatblade') > 0 ? s.get('blade.greatblade.cleaver') : 0;
    this.sunder = s.doctrineStrength('blade', 'greatblade') > 0 && s.has('blade.greatblade.sunder');
    this.sunderStep = s.get('blade.greatblade.sunder.per_hit');
    this.sunderCap = s.get('blade.greatblade.sunder.cap');
    const tempest = s.doctrineStrength('blade', 'tempest') > 0;
    this.momentum = tempest ? s.get('blade.tempest.momentum') : 0;
    this.maxStacks = Math.max(1, Math.floor(s.get('blade.tempest.momentum.max_stacks')));
    this.afterimage = tempest && s.has('blade.tempest.afterimage') ? s.get('blade.tempest.afterimage') : 0;
    this.cyclone = tempest && s.has('blade.tempest.cyclone');
    this.cycloneRange = s.get('blade.tempest.cyclone.range');
    this.cycloneDmg = s.get('blade.tempest.cyclone.damage');
    this.deflect = s.has('blade.deflection');
    this.element = infusedElement(s, 'blade');
    this.hw = this.great ? 7 : 4;
  }

  private inner(k: number): number { return TOWER_RADIUS + 2 + k * this.len * 0.5; }

  update(w: World): void {
    const sh = w.shared;
    if (!this.on) { sh.bladeCount = 0; return; }
    const tick = w.tick;
    if (tick - this.lastMom > 60) this.stacks = 0;
    const chan = sh.bladeSpeedMul > 0 ? sh.bladeSpeedMul : 1;
    const dyn = w.dynamicSpeedMul > 0 ? w.dynamicSpeedMul : 1;   // Overdrive / Ember Heart / Critical Mass
    const omega = this.rot * (1 + this.momentum * this.stacks) * chan * this.rotPenalty * dyn;
    const stepAbs = omega * TICK_DT;
    const nsub = Math.max(1, Math.ceil(stepAbs / MAX_SUB));
    const spin = w.signals && w.signals.bladeDir < 0 ? -1 : 1;   // WP8: Clockwork Blade / Reversal flip the spin
    for (let k = 0; k < this.count; k++) {
      const dir = (this.gyre && (k & 1) === 1 ? -1 : 1) * spin;
      const st = (stepAbs * dir) / nsub;
      for (let s = 0; s < nsub; s++) {
        this.ang[k] += st;
        this.sweep(w, k, this.ang[k], 1, false);
      }
      if (this.ang[k] > TAU) this.ang[k] -= TAU; else if (this.ang[k] < 0) this.ang[k] += TAU;
    }
    // Afterimage: record ghosts every GHOST_EVERY ticks; ghosts live 0.5 s
    if (this.afterimage > 0) {
      if (tick % GHOST_EVERY === 0) {
        this.ghostHead = (this.ghostHead + 1) % GHOSTS;
        for (let k = 0; k < this.count; k++) { this.ghostA[k * GHOSTS + this.ghostHead] = this.ang[k]; this.ghostT[k * GHOSTS + this.ghostHead] = tick; }
      }
      if (tick % 3 === 0) {
        for (let k = 0; k < this.count; k++) for (let g = 0; g < GHOSTS; g++) {
          const gi = k * GHOSTS + g;
          if (tick - this.ghostT[gi] > 30 || tick === this.ghostT[gi]) continue;
          this.sweep(w, k, this.ghostA[gi], this.afterimage, true);
        }
      }
    }
    if (this.cyclone && this.stacks >= this.maxStacks) {
      this.cycAcc += stepAbs;
      if (this.cycAcc >= Math.PI) { this.cycAcc -= Math.PI; this.throwArc(w); }
    } else this.cycAcc = 0;
    if (this.deflect) this.deflectShots(w);
    sh.bladeCount = this.count;
    for (let k = 0; k < this.count; k++) { sh.bladeAngles[k] = this.ang[k]; sh.bladeInner[k] = this.inner(k); sh.bladeLens[k] = this.len; }
  }

  private sweep(w: World, k: number, a: number, mul: number, ghost: boolean): void {
    const r0 = this.inner(k), r1 = r0 + this.len;
    const c = cos(a), s = sin(a);
    const buf = SCRATCH.push();
    const n = querySegment(w, c * r0, s * r0, c * r1, s * r1, this.hw, buf);
    const tick = w.tick;
    for (let j = 0; j < n; j++) {
      const i = buf[j];
      if (!targetableEnemy(w, i)) continue;
      if (ghost) {
        if (tick - this.ghostHit[i] < HIT_CD) continue;
        this.ghostHit[i] = tick;
      } else {
        const slot = i * MAX_BLADES + k;
        if (tick - this.lastHit[slot] < HIT_CD) continue;
        this.lastHit[slot] = tick;
      }
      this.hit(w, i, k, mul, ghost);
    }
    SCRATCH.pop();
  }

  private hit(w: World, i: number, k: number, mul: number, ghost: boolean): void {
    const e = w.enemies;
    let dmg = this.dmg * mul * (k > 0 ? this.edge : 1) * (1 + this.mass);
    if (this.cleaver > 0 && e.hp[i] > 0.5 * e.maxHp[i]) dmg *= 1 + this.cleaver;
    const h = w.damage(i, dmg, { source: 'blade', srcTag: 'blade', element: this.element, cause: -1 });
    const killed = h.killed, dealt = h.damage, ev = h.eventId;
    const tick = w.tick;
    if (!ghost && this.momentum > 0) {
      this.stacks = tick - this.lastMom <= 60 ? Math.min(this.maxStacks, this.stacks + 1) : 1;
      this.lastMom = tick;
    }
    if (killed || !w.alive(i)) return;
    if (this.knock > 0 && !ghost) w.knockback(i, e.x[i], e.y[i], this.knock);
    if (this.serration > 0 && w.prng.chance(this.serration)) w.applyStatus(i, 'bleed', 1, this.bleedDur, 'blade', ev, dealt * this.bleedFrac);
    if (this.sunder && this.sunderF[i] < this.sunderCap) {
      const prev = this.sunderF[i];
      const next = Math.min(this.sunderCap, prev + this.sunderStep);
      const k2 = (1 - next) / (1 - prev);
      e.armor[i] *= k2; e.maxShield[i] *= k2;
      if (e.shield[i] > e.maxShield[i]) e.shield[i] = e.maxShield[i];
      this.sunderF[i] = next;
      if (prev === 0) w.emit(Ev.Fx, 'blade.greatblade.sunder', i, next, e.x[i], e.y[i], ev);
    }
  }

  private throwArc(w: World): void {
    const a = this.ang[0], r = this.inner(0) + this.len;
    const sp = 360;
    const cause = w.emit(Ev.Fx, 'blade.tempest.cyclone', this.stacks, 0, cos(a) * r, sin(a) * r, -1);
    w.spawnProjectile({
      kind: ProjKind.CuttingArc, source: SRC_BLADE, srcTag: 'blade', x: cos(a) * r, y: sin(a) * r, vx: cos(a) * sp, vy: sin(a) * sp,
      damage: this.dmg * (1 + this.mass) * this.cycloneDmg, radius: 10, pierce: 255, life: Math.ceil(this.cycloneRange / sp * 60),
      element: this.element, cause,
    });
  }

  private deflectShots(w: World): void {
    const p = w.projectiles;
    for (let i = 0; i < p.count; i++) {
      if ((p.flags[i] & (ProjFlag.Hostile | ProjFlag.Dead)) !== ProjFlag.Hostile) continue;
      const px = p.x[i], py = p.y[i];
      for (let k = 0; k < this.count; k++) {
        const r0 = this.inner(k), r1 = r0 + this.len, a = this.ang[k];
        const d2 = px * px + py * py;
        if (d2 > (r1 + 12) * (r1 + 12)) continue;
        const c = cos(a), s = sin(a), rr = this.hw + p.radius[i] + 3;
        if (segDist2(px, py, c * r0, s * r0, c * r1, s * r1) > rr * rr) continue;
        w.emit(Ev.Fx, 'blade.deflection', k, p.damage[i], px, py, p.cause[i]);
        w.freeProjectile(i);
        break;
      }
    }
  }

  onCompact(w: World, remap: Int32Array, oldCount: number): void {
    const n = w.enemies.count, L = this.lastHit;
    for (let i = 0; i < oldCount; i++) {
      const j = remap[i];
      if (j < 0 || j === i) continue;
      for (let k = 0; k < MAX_BLADES; k++) L[j * MAX_BLADES + k] = L[i * MAX_BLADES + k];
    }
    for (let i = n; i < oldCount; i++) for (let k = 0; k < MAX_BLADES; k++) L[i * MAX_BLADES + k] = -1_000_000;
    remapArray(this.ghostHit, remap, oldCount, n, -1_000_000);
    remapArray(this.sunderF, remap, oldCount, n, 0);
  }

  render(w: World, out: InstanceWriter): void {
    if (!this.on) return;
    const el = elementIndex(this.element);
    const col = el > 0 ? ELEMENT_RGB[el - 1] : null;
    const r = col ? col[0] : 0.85, g = col ? col[1] : 0.88, b = col ? col[2] : 1;
    const tick = w.tick;
    for (let k = 0; k < this.count; k++) {
      const r0 = this.inner(k), r1 = r0 + this.len;
      if (this.afterimage > 0) for (let gi = 0; gi < GHOSTS; gi++) {
        const age = tick - this.ghostT[k * GHOSTS + gi];
        if (age <= 0 || age > 30) continue;
        const a = this.ghostA[k * GHOSTS + gi];
        out.push(cos(a) * r0, sin(a) * r0, this.hw * 0.8, a, Shape.Line, r, g, b, 0.35 * (1 - age / 30), 2, cos(a) * r1, sin(a) * r1);
      }
      const a = this.ang[k], c = cos(a), s = sin(a);
      out.push(c * r0, s * r0, this.hw, a, Shape.Line, r, g, b, 1, 2, c * r1, s * r1);
      out.push(c * r1, s * r1, this.hw * 1.2, a, Shape.Diamond, r, g, b, 0.9, 2);
    }
  }
}
