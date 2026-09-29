/**
 * Drones (design §7): independent orbiting shooters. Drones are NOT enemies or projectiles: they live
 * in this system's own SoA arrays and are published to world.shared.drones (x, y, target) every tick.
 * Stat keys: drones.count (+1/rank, capped by drones.cap; Hive frame flag drone_cap_plus_50 ×1.5),
 *   drones.damage (per shot), orbit_radius, speed (units/s), attack_speed (shots/s per drone, × global rate),
 *   targeting (engage range from the drone), Targeting Profile build.targeting.drones.
 *   Exotic Payload: every payload.interval s each drone drops a Bomb (payload.radius blast, payload.damage × dmg)
 *   on the densest spot beneath it.
 * Doctrines:
 *   wing     even drones are Interceptors (+interceptor_speed flight speed, hunt kamikazes/fast enemies,
 *            +wing.interceptors damage vs fast enemies), odd drones are Gunships (× wing.gunships fire rate);
 *            Sortie: drones pursue targets anywhere and return to orbit to rearm every sortie.rearm s
 *   arc      links between neighbouring drones deal arc.link × dmg × capacitance per second to enemies crossing
 *            them (reach +4 per Capacitance rank); Faraday Web: every drone links to every other (mesh)
 *   carrier  every carrier.interval s each drone releases launch_bay Microdrones (ProjKind.Microdrone seekers,
 *            microdrone_damage × dmg, microdrone_life s); Brood: microdrones carry the drones' Infusion element
 *   support  even drones are Medics (heal support.medic × max HP per second each, fire at half rate); odd drones
 *            are Shield drones (+support.shield_drone × max HP shield capacity); Aegis Wing: drones destroy
 *            hostile projectiles within reach
 * Jammer aura: drones inside lose targeting (no shots, bombs or launches).
 * Channels read: world.shared.droneBoost[k] (Gravity Assist / Sync Burst) → speed, fire rate and damage.
 * Frame Echo Engine: every 8th drone shot repeats.
 */
import type { System, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import type { ElementId, TargetingProfile } from '../core/ids';
import { EnemyFlag, Ev, MAX_DRONES, NO_ENTITY, ProjFlag, ProjKind, Shape, TICK_DT, ARENA_RADIUS } from '../core/types';
import { atan2, cos, sin } from '../math/lut';
import { frameDef } from '../core/content';
import {
  HB_SEEK, SCRATCH, SRC_DRONES, densestEnemy, globalRate, infusedElement, jammedAt, launchMicrodrone, projTargetValid,
  querySegment, setProjTarget, steerToward, targetableEnemy,
} from './hardpoints/common';

const ROLE_STD = 0, ROLE_INTERCEPTOR = 1, ROLE_GUNSHIP = 2, ROLE_MEDIC = 3, ROLE_SHIELD = 4;
const SHOT_SPEED = 480;
const FAST = 60;
const ARC_PULSE = 15;
const AEGIS_REACH = 26;
const MICRO_TURN = 6;

export class DronesSystem implements System {
  readonly id = 'drones';
  private on = false;
  private n = 0; private dmg = 6; private orbitR = 90; private speed = 160; private rate = 1.2; private range = 180;
  private profile: TargetingProfile = 'nearest';
  private wing = false; private interceptBonus = 0; private interceptSpeed = 0.5; private gunshipMul = 1; private sortie = false; private rearm = 240;
  private arc = 0; private capacitance = 1; private reach = 4; private faraday = false;
  private launchBay = 0; private launchEvery = 3; private microDmg = 0.4; private microLife = 6; private brood = false;
  private medic = 0; private shieldFrac = 0; private aegis = false; private support = false;
  private payload = false; private payEvery = 5; private payR = 60; private payDmg = 3;
  private element: ElementId | null = null;
  private echo = false; private shots = 0;
  private phase = 0;
  private shieldAdded = 0; private shieldSeen = -1;
  // drone SoA
  private x = new Float32Array(MAX_DRONES); private y = new Float32Array(MAX_DRONES); private hd = new Float32Array(MAX_DRONES);
  private tgt = new Int32Array(MAX_DRONES).fill(NO_ENTITY); private tgtGen = new Uint32Array(MAX_DRONES);
  private cool = new Float32Array(MAX_DRONES); private role = new Uint8Array(MAX_DRONES);
  private mode = new Uint8Array(MAX_DRONES); private away = new Int32Array(MAX_DRONES);
  private payT = new Float32Array(MAX_DRONES); private launchT = new Float32Array(MAX_DRONES);
  private jam = new Uint8Array(MAX_DRONES);

  init(w: World): void { this.rebuild(w); this.reset(); }
  onAttemptStart(): void { this.reset(); }
  private reset(): void {
    this.phase = 0; this.shots = 0;
    for (let k = 0; k < MAX_DRONES; k++) {
      const a = (k / Math.max(1, this.n)) * 6.283185307179586;
      this.x[k] = cos(a) * this.orbitR; this.y[k] = sin(a) * this.orbitR; this.hd[k] = a + 1.5708;
      this.tgt[k] = NO_ENTITY; this.cool[k] = 0; this.mode[k] = 0; this.away[k] = 0; this.payT[k] = 0; this.launchT[k] = 0;
    }
  }

  rebuild(w: World): void {
    const s = w.stats;
    this.on = s.mounted('drones');
    const flags = frameDef(w.build.frame).flags;
    const cap = Math.floor(s.get('drones.cap') * (flags.includes('drone_cap_plus_50') ? 1.5 : 1));
    const prevN = this.n;
    this.n = this.on ? Math.max(1, Math.min(cap, MAX_DRONES, Math.floor(s.get('drones.count') + 1e-9))) : 0;
    for (let k = prevN; k < this.n; k++) { this.x[k] = cos(k) * this.orbitR; this.y[k] = sin(k) * this.orbitR; }
    this.dmg = s.get('drones.damage');
    this.orbitR = Math.max(30, s.get('drones.orbit_radius'));
    this.speed = Math.max(20, s.get('drones.speed'));
    this.rate = Math.max(0.05, s.get('drones.attack_speed'));
    this.range = Math.max(20, s.get('drones.targeting'));
    this.profile = w.build.targeting.drones ?? 'nearest';
    this.wing = s.doctrineStrength('drones', 'wing') > 0;
    this.interceptBonus = this.wing && s.has('drones.wing.interceptors') ? s.get('drones.wing.interceptors') : 0;
    this.interceptSpeed = s.get('drones.wing.interceptor_speed');
    this.gunshipMul = this.wing ? s.get('drones.wing.gunships') : 1;
    this.sortie = this.wing && s.has('drones.wing.sortie');
    this.rearm = Math.max(30, Math.round(s.get('drones.wing.sortie.rearm') * 60));
    const arcOn = s.doctrineStrength('drones', 'arc') > 0;
    this.arc = arcOn && s.has('drones.arc.link') ? s.get('drones.arc.link') : 0;
    this.capacitance = s.get('drones.arc.capacitance');
    this.reach = 4 + 4 * s.rank('drones.arc.capacitance');
    this.faraday = arcOn && s.has('drones.arc.faraday_web');
    const carrier = s.doctrineStrength('drones', 'carrier') > 0;
    this.launchBay = carrier && s.has('drones.carrier.launch_bay') ? Math.max(1, Math.floor(s.get('drones.carrier.launch_bay') + 1e-9)) : 0;
    this.launchEvery = Math.max(0.2, s.get('drones.carrier.interval'));
    this.microDmg = s.get('drones.carrier.microdrone_damage');
    this.microLife = Math.max(0.5, s.get('drones.carrier.microdrone_life'));
    this.brood = carrier && s.has('drones.carrier.brood');
    this.support = s.doctrineStrength('drones', 'support') > 0;
    this.medic = this.support && s.has('drones.support.medic') ? s.get('drones.support.medic') : 0;
    this.shieldFrac = this.support && s.has('drones.support.shield_drone') ? s.get('drones.support.shield_drone') : 0;
    this.aegis = this.support && s.has('drones.support.aegis_wing');
    this.payload = s.has('drones.payload');
    this.payEvery = Math.max(0.5, s.get('drones.payload.interval'));
    this.payR = s.get('drones.payload.radius');
    this.payDmg = s.get('drones.payload.damage');
    this.element = infusedElement(s, 'drones');
    this.echo = flags.includes('every_8th_repeats');
    for (let k = 0; k < MAX_DRONES; k++) {
      this.role[k] = this.wing ? (k % 2 === 0 ? ROLE_INTERCEPTOR : ROLE_GUNSHIP)
        : this.support ? (k % 2 === 0 ? ROLE_MEDIC : ROLE_SHIELD) : ROLE_STD;
    }
    // Shield drones: extra tower shield capacity (re-applied after every stat rebuild; idempotent)
    const t = w.tower;
    if (this.shieldAdded > 0 && t.maxShield === this.shieldSeen) t.maxShield -= this.shieldAdded;
    const shieldDrones = this.support && this.n >= 2 ? 1 : 0;
    this.shieldAdded = this.on && shieldDrones ? this.shieldFrac * t.maxHp : 0;
    t.maxShield += this.shieldAdded;
    this.shieldSeen = t.maxShield;
  }

  update(w: World): void {
    const sh = w.shared;
    if (!this.on || this.n === 0) { sh.droneCount = 0; return; }
    const n = this.n, tick = w.tick;
    const angVel = Math.min(3, this.speed / this.orbitR);
    this.phase += angVel * TICK_DT;
    const gr = globalRate(w);
    let medics = 0;
    for (let k = 0; k < n; k++) {
      const boost = sh.droneBoost[k] > 0 ? sh.droneBoost[k] : 0;
      const role = this.role[k];
      if (role === ROLE_MEDIC) medics++;
      const jam = jammedAt(w, this.x[k], this.y[k]);
      this.jam[k] = jam ? 1 : 0;
      // --- target upkeep
      let t = this.tgt[k];
      if (t >= 0 && (!targetableEnemy(w, t) || w.enemies.gen[t] !== this.tgtGen[k])) t = NO_ENTITY;
      if (t >= 0 && !this.sortie) {   // leash: non-sortie drones drop targets far outside their sensor range
        const lx = w.enemies.x[t] - this.x[k], ly = w.enemies.y[t] - this.y[k], lr = this.range * 1.5;
        if (lx * lx + ly * ly > lr * lr) t = NO_ENTITY;
      }
      if (jam) t = NO_ENTITY;
      else if (t < 0 && (tick + k) % 4 === 0) t = this.acquire(w, k);
      this.tgt[k] = t; this.tgtGen[k] = t >= 0 ? w.enemies.gen[t] : 0;
      // --- movement
      const slotA = this.phase + (k / n) * 6.283185307179586;
      let dx = cos(slotA) * this.orbitR, dy = sin(slotA) * this.orbitR;
      const pursue = t >= 0 && (this.sortie || role === ROLE_INTERCEPTOR);
      if (pursue && this.mode[k] !== 2) {
        if (this.mode[k] === 0 && this.sortie) w.emit(Ev.Fx, 'drones.wing.sortie', k, t, this.x[k], this.y[k], -1);
        this.mode[k] = 1;
        const ex = w.enemies.x[t], ey = w.enemies.y[t];
        const vx = this.x[k] - ex, vy = this.y[k] - ey, vl = Math.sqrt(vx * vx + vy * vy) || 1;
        dx = ex + (vx / vl) * 36; dy = ey + (vy / vl) * 36;
      } else if (this.mode[k] === 1) this.mode[k] = 2;
      if (this.mode[k] !== 0) {
        this.away[k]++;
        if (this.sortie && this.away[k] > this.rearm) this.mode[k] = 2;
      }
      const sp = this.speed * (role === ROLE_INTERCEPTOR ? 1 + this.interceptSpeed : 1) * (1 + boost) * TICK_DT;
      const mx = dx - this.x[k], my = dy - this.y[k], ml = Math.sqrt(mx * mx + my * my);
      if (ml <= sp) {
        this.x[k] = dx; this.y[k] = dy;
        if (this.mode[k] === 2) { this.mode[k] = 0; this.away[k] = 0; }
      } else { this.x[k] += (mx / ml) * sp; this.y[k] += (my / ml) * sp; }
      if (ml > 1e-3) this.hd[k] = atan2(my, mx);
      // --- firing
      let r = this.rate * gr * (1 + boost);
      if (role === ROLE_GUNSHIP) r *= this.gunshipMul;
      else if (role === ROLE_MEDIC) r *= 0.5;
      this.cool[k] -= r * TICK_DT;
      if (t >= 0 && this.cool[k] <= 0) {
        const ex = w.enemies.x[t] - this.x[k], ey = w.enemies.y[t] - this.y[k];
        const rr = this.range + w.enemies.radius[t];
        if (ex * ex + ey * ey <= rr * rr) {
          this.shoot(w, k, t, boost);
          this.cool[k] += 1;
          if (this.echo && ++this.shots % 8 === 0) this.shoot(w, k, t, boost);
        }
      }
      if (this.cool[k] < 0 && t < 0) this.cool[k] = 0;
      if (!jam) {
        if (this.payload) this.dropPayload(w, k);
        if (this.launchBay > 0) this.launch(w, k, t);
      }
      sh.drones[k * 3] = this.x[k]; sh.drones[k * 3 + 1] = this.y[k]; sh.drones[k * 3 + 2] = t;
    }
    sh.droneCount = n;
    if (this.medic > 0 && medics > 0 && tick % 60 === 0 && w.tower.hp < w.tower.maxHp) w.healTower(this.medic * w.tower.maxHp * medics, -1);
    if (this.arc > 0 && n >= 2 && tick % ARC_PULSE === 0) this.arcLinks(w);
    this.steerMicrodrones(w);
    if (this.aegis) this.intercept(w);
  }

  private acquire(w: World, k: number): number {
    const range = this.sortie ? ARENA_RADIUS * 2 : this.range;
    if (this.role[k] === ROLE_INTERCEPTOR) {
      const buf = SCRATCH.push();
      const cnt = w.queryRadius(this.x[k], this.y[k], range, buf);
      const e = w.enemies;
      let best = NO_ENTITY, bd = Infinity;
      for (let j = 0; j < cnt; j++) {
        const i = buf[j];
        if (!targetableEnemy(w, i) || (e.flags[i] & EnemyFlag.Kamikaze) === 0) continue;
        const dx = e.x[i] - this.x[k], dy = e.y[i] - this.y[k], d = dx * dx + dy * dy;
        if (d < bd || (d === bd && i < best)) { bd = d; best = i; }
      }
      SCRATCH.pop();
      if (best >= 0) return best;
      return w.nearestEnemy(this.x[k], this.y[k], range, 'fastest', 'drones');
    }
    return w.nearestEnemy(this.x[k], this.y[k], range, this.profile, 'drones');
  }

  private shoot(w: World, k: number, t: number, boost: number): void {
    const e = w.enemies;
    const ddx = e.x[t] - this.x[k], ddy = e.y[t] - this.y[k];
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
    const lead = dist / SHOT_SPEED * 0.8;
    const a = atan2(e.y[t] + e.vy[t] * lead - this.y[k], e.x[t] + e.vx[t] * lead - this.x[k]);
    let dmg = this.dmg * (1 + boost);
    if (this.role[k] === ROLE_INTERCEPTOR && e.speed[t] * e.speedMul[t] >= FAST) dmg *= 1 + this.interceptBonus;
    w.spawnProjectile({
      kind: ProjKind.DroneShot, source: SRC_DRONES, srcTag: 'drones', x: this.x[k], y: this.y[k],
      vx: cos(a) * SHOT_SPEED, vy: sin(a) * SHOT_SPEED, damage: dmg, radius: 2.5,
      life: Math.ceil((this.range * 1.5 / SHOT_SPEED) * 60), flags: ProjFlag.FromDrone, element: this.element, cause: -1,
    });
  }

  private dropPayload(w: World, k: number): void {
    this.payT[k] += TICK_DT;
    if (this.payT[k] < this.payEvery) return;
    const best = densestEnemy(w, this.x[k], this.y[k], 90, this.payR, 12);
    if (best < 0) return;
    this.payT[k] = 0;
    const e = w.enemies;
    const dx = e.x[best] - this.x[k], dy = e.y[best] - this.y[k], d = Math.sqrt(dx * dx + dy * dy);
    const a = atan2(dy, dx);
    const cause = w.emit(Ev.Fx, 'drones.payload', best, k, this.x[k], this.y[k], -1);
    w.spawnProjectile({
      kind: ProjKind.Bomb, source: SRC_DRONES, srcTag: 'drones', x: this.x[k], y: this.y[k], vx: cos(a) * 240, vy: sin(a) * 240,
      damage: this.payDmg * this.dmg, radius: 5, blast: this.payR, life: Math.ceil(d / 240 * 60) + 20, target: best,
      flags: ProjFlag.FromDrone, element: this.element, cause,
    });
  }

  private launch(w: World, k: number, t: number): void {
    this.launchT[k] += TICK_DT;
    if (this.launchT[k] < this.launchEvery) return;
    const tg = t >= 0 ? t : w.nearestEnemy(this.x[k], this.y[k], 250, 'nearest', 'drones');
    if (tg < 0) return;
    this.launchT[k] = 0;
    const cause = w.emit(Ev.Fx, this.brood ? 'drones.carrier.brood' : 'drones.carrier.launch_bay', tg, this.launchBay, this.x[k], this.y[k], -1);
    for (let m = 0; m < this.launchBay; m++) {
      launchMicrodrone(w, this.x[k], this.y[k], this.hd[k] + (m - (this.launchBay - 1) / 2) * 0.6, tg,
        this.microDmg * this.dmg, this.microLife, this.brood ? this.element : null, 'drones', cause);
    }
  }

  private steerMicrodrones(w: World): void {
    const p = w.projectiles, e = w.enemies;
    const turn = MICRO_TURN * TICK_DT;
    for (let i = 0; i < p.count; i++) {
      if (p.kind[i] !== ProjKind.Microdrone || (p.flags[i] & ProjFlag.Dead) || (p.hpBits[i] & HB_SEEK) === 0) continue;
      if (jammedAt(w, p.x[i], p.y[i])) continue;
      if (!projTargetValid(w, i)) {
        const t = w.nearestEnemy(p.x[i], p.y[i], 250, 'nearest', 'drones');
        setProjTarget(w, i, t);
        if (t < 0) continue;
        p.lastHit[i] = NO_ENTITY;
      }
      const t = p.target[i];
      steerToward(w, i, e.x[t], e.y[t], turn);
    }
  }

  private linked(a: number, b: number, n: number): boolean {
    if (this.faraday) return true;
    if (n === 2) return true;
    return b === a + 1 || (a === 0 && b === n - 1);
  }

  private arcLinks(w: World): void {
    const n = this.n;
    const amount = this.arc * this.dmg * this.capacitance * (ARC_PULSE / 60);
    const buf = SCRATCH.push();
    let web = false;
    const lim = this.faraday ? Math.min(n, 16) : n;
    for (let a = 0; a < lim; a++) {
      for (let b = a + 1; b < lim; b++) {
        if (!this.linked(a, b, n)) continue;
        const cnt = querySegment(w, this.x[a], this.y[a], this.x[b], this.y[b], this.reach, buf);
        if (cnt > 0 && this.faraday && !(b === a + 1 || (a === 0 && b === n - 1))) web = true;
        for (let j = 0; j < cnt; j++) {
          const i = buf[j];
          if (!w.alive(i)) continue;
          w.damage(i, amount, { source: 'drones', srcTag: 'drones', element: this.element ?? 'lightning', cause: -1 });
        }
      }
    }
    SCRATCH.pop();
    if (web) w.emit(Ev.Fx, 'drones.arc.faraday_web', n, 0, 0, 0, -1);
  }

  private intercept(w: World): void {
    const p = w.projectiles;
    const r2 = AEGIS_REACH * AEGIS_REACH;
    for (let i = 0; i < p.count; i++) {
      if ((p.flags[i] & (ProjFlag.Hostile | ProjFlag.Dead)) !== ProjFlag.Hostile) continue;
      for (let k = 0; k < this.n; k++) {
        const dx = p.x[i] - this.x[k], dy = p.y[i] - this.y[k];
        if (dx * dx + dy * dy > r2) continue;
        w.emit(Ev.Fx, 'drones.support.aegis_wing', k, p.damage[i], p.x[i], p.y[i], p.cause[i]);
        w.freeProjectile(i);
        break;
      }
    }
  }

  onCompact(_w: World, remap: Int32Array, oldCount: number): void {
    for (let k = 0; k < this.n; k++) {
      const t = this.tgt[k];
      if (t >= 0) this.tgt[k] = t < oldCount ? remap[t] : NO_ENTITY;
    }
  }

  render(w: World, out: InstanceWriter): void {
    if (!this.on) return;
    const n = this.n;
    if (this.arc > 0 && n >= 2) {
      const lim = this.faraday ? Math.min(n, 16) : n;
      for (let a = 0; a < lim; a++) for (let b = a + 1; b < lim; b++) {
        if (!this.linked(a, b, n)) continue;
        out.push(this.x[a], this.y[a], 1.2, 0, Shape.Line, 0.98, 0.93, 0.36, 0.55, 2, this.x[b], this.y[b]);
      }
    }
    for (let k = 0; k < n; k++) {
      let r = 0.45, g = 0.9, b = 1;
      const role = this.role[k];
      if (role === ROLE_INTERCEPTOR) { r = 0.6; g = 1; b = 0.85; }
      else if (role === ROLE_GUNSHIP) { r = 0.4; g = 0.65; b = 1; }
      else if (role === ROLE_MEDIC) { r = 0.4; g = 1; b = 0.5; }
      else if (role === ROLE_SHIELD) { r = 0.55; g = 0.8; b = 1; }
      const a = this.jam[k] ? 0.45 : 1;
      out.push(this.x[k], this.y[k], 6, this.hd[k], Shape.Triangle, r, g, b, a, 3);
      if (w.shared.droneBoost[k] > 0) out.push(this.x[k], this.y[k], 9, 0, Shape.Ring, 0.8, 0.6, 1, 0.5, 2);
    }
  }
}
