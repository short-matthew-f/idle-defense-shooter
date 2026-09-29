/**
 * Ordnance: the missile rack (design §7). Stat keys (node id = stat key unless noted):
 *   ordnance.damage (per missile), launchers (1..5, each fires its own missile per salvo),
 *   reload (salvos per second; × reactor.global_attack_speed × dynamicSpeedMul, ÷ cooldown factor),
 *   tracking (turn rate rad/s), range, blast_radius, missile_speed,
 *   overkill_guidance (+1 retarget per rank when the target dies in flight; retargeted missiles +overkill_guidance.bonus),
 *   cluster_warheads (exotic: split into .count bomblets .damage × dmg, .radius × blast just before impact).
 * Missiles are WP3 seekers (hpBits HB_SEEK): this system steers them before the core moves them, at the
 * `tracking` rate; inside a Jammer aura they fly straight (no steering, no retarget).
 * Doctrines:
 *   hunter   profile 'elites'; +priority vs elites/bosses, +siegebreaker vs bosses;
 *            Kill Order: missile hits on an open weak point extend EnemyPool.weakPointT by 1 s (cap 4 s per opening)
 *   swarm    pods of `swarm.rockets` rockets (rocket_damage ×, rocket_blast ×), Afterburner acceleration
 *            (top speed and damage up to +afterburner), Cascade: each ordnance explosion may launch a smaller rocket
 *   bombard  Bomb Bay: `bomb_bay` shells per launcher lobbed (no en-route collision) at the densest group:
 *            ×shell_blast radius, ×shell_damage × shell_weight damage; Carpet: shells leave `shell_zone` hazards
 *            (carpet.duration s, carpet.dps × shell damage/s) that merge with overlapping zones
 * Linkage hooks read here: link.ordnance+drones (missiles prefer Marked/Spotted enemies).
 * Frame Echo Engine: every 8th salvo repeats.
 */
import type { System, InstanceWriter, HitInfo } from '../core/system';
import type { World } from '../core/world';
import type { ElementId, TargetingProfile } from '../core/ids';
import { EnemyFlag, Ev, NO_ENTITY, ProjFlag, ProjKind, Shape, TICK_DT, TOWER_RADIUS, MAX_ENEMIES } from '../core/types';
import { atan2, cos, sin } from '../math/lut';
import { frameDef } from '../core/content';
import {
  HB_CASCADE, HB_RETARGET_MASK, HB_RETARGET_SHIFT, HB_ROCKET, HB_SEEK, HB_SPLIT, SRC_ORDNANCE, SCRATCH,
  cooldownFactor, densestEnemy, elementAt, globalRate, infusedElement, jammedAt, projTargetValid, remapArray, setProjTarget,
  spawnSeeker, steerToward, targetableEnemy,
} from './hardpoints/common';

const MAX_SHELLS = 128;
const SPLIT_DIST = 40;
const RETARGET_RANGE = 260;

export class OrdnanceSystem implements System {
  readonly id = 'ordnance';
  private on = false;
  private dmg = 25; private launchers = 1; private rate = 0.4; private tracking = 2.5; private range = 380;
  private blast = 40; private speed = 300; private retargets = 0; private retargetBonus = 0.1;
  private cluster = false; private clusterN = 4; private clusterDmg = 0.4; private clusterR = 0.6;
  private hunter = false; private priority = 0; private siege = 0; private killOrder = false; private koExtend = 60; private koMax = 240;
  private swarm = false; private rockets = 3; private rocketDmg = 0.35; private rocketBlast = 0.5; private afterburner = 0;
  private cascade = false; private cascadeChance = 0.25; private cascadeDmg = 0.6;
  private bombard = false; private shells = 1; private shellDmg = 1.5; private shellBlast = 2;
  private carpet = false; private carpetDur = 3; private carpetDps = 0.2;
  private element: ElementId | null = null;
  private spotter = false; private echo = false; private profile: TargetingProfile = 'nearest';
  private timer = 0; private salvos = 0;
  private evCursor = 0;
  private picked = new Int32Array(8);
  /** Kill Order extension already granted to each enemy's current weak-point opening (ticks). */
  private koExt = new Uint16Array(MAX_ENEMIES);
  // lobbed shells (Bomb Bay): own SoA, they do not collide in flight
  private sN = 0;
  private sx = new Float32Array(MAX_SHELLS); private sy = new Float32Array(MAX_SHELLS);
  private tx = new Float32Array(MAX_SHELLS); private ty = new Float32Array(MAX_SHELLS);
  private st = new Int32Array(MAX_SHELLS); private sT = new Int32Array(MAX_SHELLS);
  private sDmg = new Float32Array(MAX_SHELLS); private sBlast = new Float32Array(MAX_SHELLS);

  init(w: World): void { this.rebuild(w); this.reset(w); }
  onAttemptStart(w: World): void { this.reset(w); }
  private reset(w: World): void { this.timer = 0; this.salvos = 0; this.sN = 0; this.koExt.fill(0); this.evCursor = w.events.nextId; }

  rebuild(w: World): void {
    const s = w.stats;
    this.on = s.mounted('ordnance');
    this.dmg = s.get('ordnance.damage');
    this.launchers = Math.max(1, Math.min(5, Math.floor(s.get('ordnance.launchers') + 1e-9)));
    this.rate = Math.max(0.01, s.get('ordnance.reload'));
    this.tracking = Math.max(0, s.get('ordnance.tracking'));
    this.range = s.get('ordnance.range');
    this.blast = Math.max(4, s.get('ordnance.blast_radius'));
    this.speed = Math.max(60, s.get('ordnance.missile_speed'));
    this.retargets = Math.max(0, Math.min(3, Math.floor(s.get('ordnance.overkill_guidance') + 1e-9)));
    this.retargetBonus = s.get('ordnance.overkill_guidance.bonus');
    this.cluster = s.has('ordnance.cluster_warheads');
    this.clusterN = Math.max(1, Math.floor(s.get('ordnance.cluster_warheads.count')));
    this.clusterDmg = s.get('ordnance.cluster_warheads.damage');
    this.clusterR = s.get('ordnance.cluster_warheads.radius');

    this.hunter = s.doctrineStrength('ordnance', 'hunter') > 0;
    this.priority = this.hunter && s.has('ordnance.hunter.priority') ? s.get('ordnance.hunter.priority') : 0;
    this.siege = this.hunter ? s.get('ordnance.hunter.siegebreaker') : 0;
    this.killOrder = this.hunter && s.has('ordnance.hunter.kill_order');
    this.koExtend = Math.round(s.get('ordnance.hunter.kill_order.extend') * 60);
    this.koMax = Math.round(s.get('ordnance.hunter.kill_order.max') * 60);

    this.swarm = s.doctrineStrength('ordnance', 'swarm') > 0 && s.has('ordnance.swarm.rockets');
    this.rockets = Math.max(1, Math.min(9, Math.floor(s.get('ordnance.swarm.rockets') + 1e-9)));
    this.rocketDmg = s.get('ordnance.swarm.rocket_damage');
    this.rocketBlast = s.get('ordnance.swarm.rocket_blast');
    this.afterburner = this.swarm ? Math.max(0, s.get('ordnance.swarm.afterburner')) : 0;
    this.cascade = this.swarm && s.has('ordnance.swarm.cascade');
    this.cascadeChance = s.get('ordnance.swarm.cascade.chance');
    this.cascadeDmg = s.get('ordnance.swarm.cascade.damage');

    this.bombard = s.doctrineStrength('ordnance', 'bombard') > 0 && s.has('ordnance.bombard.bomb_bay');
    this.shells = Math.max(1, Math.min(6, Math.floor(s.get('ordnance.bombard.bomb_bay') + 1e-9)));
    const weight = s.get('ordnance.bombard.shell_weight');
    this.shellDmg = s.get('ordnance.bombard.shell_damage') * weight;
    this.shellBlast = s.get('ordnance.bombard.shell_blast') * (1 + (weight - 1) / 3);
    this.carpet = this.bombard && s.has('ordnance.bombard.carpet');
    this.carpetDur = s.get('ordnance.bombard.carpet.duration');
    this.carpetDps = s.get('ordnance.bombard.carpet.dps');

    this.element = infusedElement(s, 'ordnance');
    this.spotter = s.has('link.ordnance+drones');
    this.echo = frameDef(w.build.frame).flags.includes('every_8th_repeats');
    this.profile = this.priority > 0 ? 'elites' : (w.build.targeting.ordnance ?? 'nearest');
  }

  update(w: World): void {
    if (!this.on) { this.sN = 0; this.evCursor = w.events.nextId; return; }
    if (this.cascade) this.scanExplosions(w); else this.evCursor = w.events.nextId;
    this.steer(w);
    this.updateShells(w);
    this.timer += this.rate * globalRate(w) / cooldownFactor(w.stats) * TICK_DT;
    let guard = 0;
    while (this.timer >= 1 && guard++ < 3) {
      if (!this.salvo(w)) { this.timer = 1; break; }
      this.timer -= 1;
      this.salvos++;
      if (this.echo && this.salvos % 8 === 0) this.salvo(w);
    }
  }

  // ---------------------------------------------------------------------------
  // Launching
  // ---------------------------------------------------------------------------
  private pickTarget(w: World): number {
    if (this.spotter) {
      // Spotter: missiles prefer Spotted/Marked enemies in range (nearest first)
      const buf = SCRATCH.push();
      const n = w.queryRadius(0, 0, this.range, buf);
      const e = w.enemies;
      let best = NO_ENTITY, bd = Infinity;
      for (let k = 0; k < n; k++) {
        const i = buf[k];
        if (e.markedT[i] === 0 || !targetableEnemy(w, i)) continue;
        const d = e.x[i] * e.x[i] + e.y[i] * e.y[i];
        if (d < bd || (d === bd && i < best)) { bd = d; best = i; }
      }
      SCRATCH.pop();
      if (best >= 0) return best;
    }
    return w.nearestEnemy(0, 0, this.range, this.profile, 'ordnance');
  }

  /** Fire one salvo; returns false when there is nothing to shoot at. */
  private salvo(w: World): boolean {
    if (this.bombard) return this.lobVolley(w);
    const main = this.pickTarget(w);
    if (main < 0) return false;
    let np = 0;
    this.picked[np++] = main;
    for (let l = 0; l < this.launchers; l++) {
      let t = main;
      if (l > 0) {
        const o = w.nearestExcluding(0, 0, this.range, this.picked, np);
        if (o >= 0) { t = o; if (np < this.picked.length) this.picked[np++] = o; }
      }
      const off = (l - (this.launchers - 1) / 2) * 0.35;
      if (this.swarm) {
        for (let r = 0; r < this.rockets; r++) this.fire(w, t, off + (r - (this.rockets - 1) / 2) * 0.22, true);
      } else this.fire(w, t, off, false);
    }
    return true;
  }

  private damageVs(w: World, t: number, base: number): number {
    const f = w.enemies.flags[t];
    let m = 1;
    if (f & (EnemyFlag.Elite | EnemyFlag.Boss)) m += this.priority;
    if (f & EnemyFlag.Boss) m += this.siege;
    return base * m;
  }

  private fire(w: World, t: number, angleOff: number, rocket: boolean): void {
    const e = w.enemies;
    const a = atan2(e.y[t], e.x[t]) + angleOff;
    const sp = rocket ? this.speed * 0.8 : this.speed;
    spawnSeeker(w, {
      kind: rocket ? ProjKind.Rocket : ProjKind.Missile, source: SRC_ORDNANCE, srcTag: 'ordnance',
      x: cos(a) * TOWER_RADIUS, y: sin(a) * TOWER_RADIUS, angle: a, speed: sp,
      damage: this.damageVs(w, t, this.dmg * (rocket ? this.rocketDmg : 1)), radius: rocket ? 2.5 : 4,
      blast: this.blast * (rocket ? this.rocketBlast : 1), life: Math.ceil((this.range * 2.2 / sp) * 60),
      target: t, element: this.element, cause: -1, bits: rocket ? HB_ROCKET : 0,
    });
  }

  private lobVolley(w: World): boolean {
    const blast = this.blast * this.shellBlast;
    const best = densestEnemy(w, 0, 0, this.range, blast, 48);
    if (best < 0) return false;
    const e = w.enemies;
    const cx = e.x[best], cy = e.y[best];
    const n = this.launchers * this.shells;
    for (let k = 0; k < n && this.sN < MAX_SHELLS; k++) {
      const j = this.sN++;
      const jitter = k === 0 ? 0 : blast * 0.6;
      const ang = w.prng.next() * 6.283185307179586;
      const rr = jitter * w.prng.next();
      this.tx[j] = cx + cos(ang) * rr; this.ty[j] = cy + sin(ang) * rr;
      const a0 = atan2(this.ty[j], this.tx[j]);
      this.sx[j] = cos(a0) * TOWER_RADIUS; this.sy[j] = sin(a0) * TOWER_RADIUS;
      const dx = this.tx[j] - this.sx[j], dy = this.ty[j] - this.sy[j];
      this.st[j] = 0;
      this.sT[j] = Math.max(12, Math.ceil(Math.sqrt(dx * dx + dy * dy) / (this.speed * 0.6) * 60));
      this.sDmg[j] = this.dmg * this.shellDmg; this.sBlast[j] = blast;
    }
    return true;
  }

  private updateShells(w: World): void {
    let k = 0;
    for (let j = 0; j < this.sN; j++) {
      this.st[j]++;
      if (this.st[j] >= this.sT[j]) { this.land(w, this.tx[j], this.ty[j], this.sDmg[j], this.sBlast[j]); continue; }
      if (k !== j) {
        this.sx[k] = this.sx[j]; this.sy[k] = this.sy[j]; this.tx[k] = this.tx[j]; this.ty[k] = this.ty[j];
        this.st[k] = this.st[j]; this.sT[k] = this.sT[j]; this.sDmg[k] = this.sDmg[j]; this.sBlast[k] = this.sBlast[j];
      }
      k++;
    }
    this.sN = k;
  }

  private land(w: World, x: number, y: number, dmg: number, blast: number): void {
    const cause = w.emit(Ev.Fx, 'ordnance.bombard.shell', blast, dmg, x, y, -1);
    w.explode(x, y, blast, dmg, { source: 'ordnance', srcTag: 'ordnance', element: this.element, cause });
    if (!this.carpet) return;
    const dps = dmg * this.carpetDps, cap = blast * 3;
    // Carpet: merge into an overlapping shell zone instead of stacking a new one
    const hz = w.hazards;
    for (let k = 0; k < hz.length; k++) {
      const h = hz[k];
      if (h.kind !== 'shell_zone' || h.owner !== 'ordnance') continue;
      const dx = h.x - x, dy = h.y - y;
      const rr = h.radius + blast;
      if (dx * dx + dy * dy >= rr * rr) continue;
      const a1 = h.radius * h.radius, a2 = blast * blast;
      h.x = (h.x * a1 + x * a2) / (a1 + a2); h.y = (h.y * a1 + y * a2) / (a1 + a2);
      h.radius = Math.min(cap, Math.sqrt(a1 + a2));
      h.dps += dps;
      if (h.life < this.carpetDur) h.life = this.carpetDur;
      w.emit(Ev.Fx, 'ordnance.bombard.carpet', h.radius, h.dps, h.x, h.y, cause);
      return;
    }
    w.addHazard({ kind: 'shell_zone', x, y, radius: blast, life: this.carpetDur, dps, cause, owner: 'ordnance', srcTag: 'ordnance' });
  }

  // ---------------------------------------------------------------------------
  // Flight
  // ---------------------------------------------------------------------------
  private steer(w: World): void {
    const p = w.projectiles, e = w.enemies;
    const turn = this.tracking * TICK_DT;
    const top = this.speed * (1 + this.afterburner);
    for (let i = 0; i < p.count; i++) {
      if (p.source[i] !== SRC_ORDNANCE || (p.flags[i] & (ProjFlag.Dead | ProjFlag.Hostile)) !== 0) continue;
      const bits = p.hpBits[i];
      if ((bits & HB_SEEK) === 0) continue;
      if (bits & HB_ROCKET) {
        const vx = p.vx[i], vy = p.vy[i], sp = Math.sqrt(vx * vx + vy * vy);
        if (sp < top && sp > 1e-6) {
          const k = Math.min(1.03, top / sp);
          p.vx[i] = vx * k; p.vy[i] = vy * k;
          if (sp * k > this.speed) p.damage[i] *= sp >= this.speed ? k : (sp * k) / this.speed;
        }
      }
      if (jammedAt(w, p.x[i], p.y[i])) continue;   // Jammer: fly straight
      let ok = projTargetValid(w, i);
      if (!ok) {
        const used = (bits & HB_RETARGET_MASK) >> HB_RETARGET_SHIFT;
        if (used < this.retargets) {
          const t = w.nearestEnemy(p.x[i], p.y[i], Math.max(RETARGET_RANGE, this.range), 'nearest', 'ordnance');
          if (t >= 0) {
            setProjTarget(w, i, t);
            p.hpBits[i] = (bits & ~HB_RETARGET_MASK) | ((used + 1) << HB_RETARGET_SHIFT);
            p.damage[i] *= 1 + this.retargetBonus;
            ok = true;
          }
        }
        if (!ok) { p.target[i] = NO_ENTITY; continue; }
      }
      const t = p.target[i];
      steerToward(w, i, e.x[t], e.y[t], turn * ((bits & HB_ROCKET) ? 1.6 : 1));
      if (this.cluster && (p.hpBits[i] & HB_SPLIT) === 0 && p.kind[i] === ProjKind.Missile) {
        const dx = e.x[t] - p.x[i], dy = e.y[t] - p.y[i];
        const rr = SPLIT_DIST + e.radius[t];
        if (dx * dx + dy * dy <= rr * rr) this.split(w, i, t);
      }
    }
  }

  /** Cluster Warheads: replace missile i with bomblets fanning onto its target. */
  private split(w: World, i: number, t: number): void {
    const p = w.projectiles;
    const x = p.x[i], y = p.y[i];
    const base = atan2(p.vy[i], p.vx[i]);
    const sp = Math.sqrt(p.vx[i] * p.vx[i] + p.vy[i] * p.vy[i]);
    const dmg = p.damage[i] * this.clusterDmg, blast = p.blast[i] * this.clusterR, el = p.element[i];
    const tag = w.tagName(p.tag[i]);
    const cause = w.emit(Ev.Fx, 'ordnance.cluster_warheads', t, this.clusterN, x, y, p.cause[i]);
    w.freeProjectile(i);
    for (let k = 0; k < this.clusterN; k++) {
      const a = base + (k - (this.clusterN - 1) / 2) * 0.3;
      spawnSeeker(w, {
        kind: ProjKind.Fragment, source: SRC_ORDNANCE, srcTag: tag, x, y, angle: a, speed: sp,
        damage: dmg, radius: 3, blast, life: 40, target: t, element: elementAt(el),
        cause, bits: HB_SPLIT,
      });
    }
  }

  /** Cascade: each ordnance explosion (since the last scan) may launch a smaller rocket at a new target. */
  private scanExplosions(w: World): void {
    const ev = w.events, end = ev.nextId;
    for (let id = Math.max(this.evCursor, end - 4096); id < end; id++) {
      const x = ev.byId(id);
      if (!x || x.type !== Ev.Explosion || x.src !== 'ordnance') continue;
      if (!w.prng.chance(this.cascadeChance)) continue;
      const t = w.nearestEnemy(x.x, x.y, 220, 'nearest', 'ordnance');
      if (t < 0) continue;
      const a = atan2(w.enemies.y[t] - x.y, w.enemies.x[t] - x.x);
      const cause = w.emit(Ev.Fx, 'ordnance.swarm.cascade', t, 0, x.x, x.y, id);
      spawnSeeker(w, {
        kind: ProjKind.Rocket, source: SRC_ORDNANCE, srcTag: 'ordnance', x: x.x, y: x.y, angle: a, speed: this.speed * 0.8,
        damage: Math.max(0.01, x.b * this.cascadeDmg), radius: 2, blast: Math.max(8, x.a * 0.8), life: 90,
        target: t, element: this.element, cause, bits: HB_ROCKET | HB_CASCADE,
      });
    }
    this.evCursor = ev.nextId;
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------
  onHit(w: World, hit: HitInfo): void {
    if (!this.killOrder || hit.source !== 'ordnance') return;
    const e = w.enemies, i = hit.enemy;
    if (!w.alive(i)) return;
    if ((e.flags[i] & EnemyFlag.WeakPointOpen) === 0) { this.koExt[i] = 0; return; }
    if (this.koExt[i] >= this.koMax) return;
    const add = Math.min(this.koExtend, this.koMax - this.koExt[i]);
    this.koExt[i] += add;
    e.weakPointT[i] = Math.min(65535, e.weakPointT[i] + add);
    w.emit(Ev.Fx, 'ordnance.hunter.kill_order', i, add, e.x[i], e.y[i], hit.eventId);
  }

  onCompact(w: World, remap: Int32Array, oldCount: number): void {
    remapArray(this.koExt, remap, oldCount, w.enemies.count, 0);
  }

  render(w: World, out: InstanceWriter): void {
    if (!this.on) return;
    for (let j = 0; j < this.sN; j++) {
      const f = this.st[j] / Math.max(1, this.sT[j]);
      const x = this.sx[j] + (this.tx[j] - this.sx[j]) * f, y = this.sy[j] + (this.ty[j] - this.sy[j]) * f;
      const lift = 4 * f * (1 - f);   // arc height → drawn size
      out.push(x, y, 3.5 + 4 * lift, 0, Shape.Circle, 1, 0.7, 0.3, 1, 3);
      out.push(this.tx[j], this.ty[j], this.sBlast[j] * (1 - f * 0.5), 0, Shape.Ring, 1, 0.55, 0.2, 0.35 * f, 7);
    }
  }
}
