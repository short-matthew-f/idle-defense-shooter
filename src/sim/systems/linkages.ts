/**
 * Linkages (design §8): 15 weapon Linkages and 10 chassis Linkages. Each is active when both halves are mounted
 * (the primary always is) and its node has rank ≥ 1; its magnitude is stats.get(nodeId) (rank-scaled per
 * data/linkages.ts). Every firing emits Ev.Linkage with src = the node id (continuous ones at most every 5 s).
 * Cross-system geometry comes from world.shared (published by the hardpoint systems earlier this tick); effects
 * on a hardpoint's own cadence go back through world.shared channels (bladeSpeedMul, laserWidthMul,
 * laserPulseRateMul, droneBoost), read by the owning system next tick.
 * Implemented elsewhere (they reshape a system's own geometry/cadence): Spotter's missile preference
 * (ordnance.ts), Bent Light (laser.ts), Event Loop (gravitics.ts).
 */
import type { System, InstanceWriter, HitInfo } from '../core/system';
import type { World } from '../core/world';
import type { ElementId } from '../core/ids';
import { Ev, INNER_RING, MAX_DRONES, MAX_ENEMIES, ProjFlag, ProjKind, Shape, TICK_DT } from '../core/types';
import { atan2, angleDiff, cos, sin } from '../math/lut';
import {
  HB_CASING, HB_CHARGED, HB_ENERGIZED, HB_PAYLOAD, HB_SLING_SHIFT, HB_SPLIT, HB_WHET, SCRATCH,
  SRC_ORDNANCE, SRC_PRIMARY, elementAt, infusedElement, launchMicrodrone, launchRackMissile, querySegment, remapArray,
  segDist2, spawnSeeker, targetableEnemy, wellAt,
} from './hardpoints/common';

export const LINK_IDS = [
  'link.primary+ordnance', 'link.primary+drones', 'link.primary+blade', 'link.primary+laser', 'link.primary+gravitics',
  'link.ordnance+drones', 'link.ordnance+blade', 'link.ordnance+laser', 'link.ordnance+gravitics',
  'link.drones+blade', 'link.drones+laser', 'link.drones+gravitics', 'link.blade+laser', 'link.blade+gravitics', 'link.laser+gravitics',
  'chassis.bastion+ordnance', 'chassis.bastion+drones', 'chassis.bastion+blade', 'chassis.bastion+laser', 'chassis.bastion+gravitics',
  'chassis.reactor+ordnance', 'chassis.reactor+drones', 'chassis.reactor+blade', 'chassis.reactor+laser', 'chassis.reactor+gravitics',
] as const;
const L_CASING = 0, L_WINGMAN = 1, L_WHET = 2, L_ENERGIZED = 3, L_SLING = 4, L_SPOTTER = 5, L_SHRAPNEL = 6, L_CHARGED = 7,
  L_PAYLOAD = 8, L_ESCORT = 9, L_MOBILE = 10, L_ASSIST = 11, L_VSTRIKE = 12, L_UNDERTOW = 13,
  L_COUNTER = 15, L_RECHARGE = 16, L_KINETIC = 17, L_LENS = 18, L_HARBOR = 19, L_HOTLOAD = 20, L_SYNC = 21, L_FLYWHEEL = 22, L_CLOCK = 23;
const N = LINK_IDS.length;
const SLING_RANGE = 80;
const ESCORT_R = 16;
const THROTTLE = 30;
const CONTINUOUS = 300;

export class LinkagesSystem implements System {
  readonly id = 'linkages';
  private on = new Uint8Array(N); private mag = new Float32Array(N); private rank = new Int8Array(N);
  private any = false;
  private lastEmit = new Int32Array(N).fill(-1_000_000);
  private evCursor = 0;
  private critDmg = 1.5; private exec = 0; private brood = false; private firstAttuned: ElementId | null = null;
  private bladeDmg = 8; private bladeEl: ElementId | null = null; private laserDps = 12; private vbDmg = 1.5; private vbLen = 200;
  private droneDmg = 6; private critMass = false; private cmThreshold = 25; private syncOn = false; private syncWindow = 30;
  private harborCd = 960; private crowd = 6;
  // runtime
  private whetStacks = 0; private whetUntil = 0; private kinStacks = 0; private kinUntil = 0; private syncUntil = 0;
  private guardSeen = 0; private shieldSeen = 0;
  private gaUntil = new Int32Array(MAX_DRONES);
  private explodedAt = new Int32Array(MAX_ENEMIES).fill(-1_000_000);
  private otherHitAt = new Int32Array(MAX_ENEMIES).fill(-1_000_000);
  private escortAt = new Int32Array(MAX_ENEMIES).fill(-1_000_000);
  private nodeCd = new Int32Array(32).fill(-1_000_000);
  private mvTimer = 0; private mvUntil = -1; private mvStart = 0;
  private harborT = 0; private harborUntil = -1;
  private flash = new Float32Array(16 * 4); private flashN = 0; private flashTick = -100;
  private picked = new Int32Array(32);

  init(w: World): void { this.rebuild(w); this.reset(w); }
  onAttemptStart(w: World): void { this.reset(w); }
  private reset(w: World): void {
    this.evCursor = w.events.nextId;
    this.whetStacks = 0; this.kinStacks = 0; this.syncUntil = 0; this.mvUntil = -1; this.mvTimer = 0; this.harborT = 0; this.harborUntil = -1;
    this.explodedAt.fill(-1_000_000); this.otherHitAt.fill(-1_000_000); this.escortAt.fill(-1_000_000); this.gaUntil.fill(0);
    this.shieldSeen = w.tower.shield; this.guardSeen = w.tower.shield + w.tower.barrier;
  }

  rebuild(w: World): void {
    const s = w.stats;
    this.any = false;
    for (let k = 0; k < N; k++) {
      const on = s.has(LINK_IDS[k]);
      this.on[k] = on ? 1 : 0; this.rank[k] = on ? s.rank(LINK_IDS[k]) : 0; this.mag[k] = on ? s.get(LINK_IDS[k]) : 0;
      if (on) this.any = true;
    }
    this.critDmg = s.get('ballistics.crit_damage');
    this.exec = s.has('ballistics.execution') ? s.get('ballistics.execution') : 0;
    this.brood = s.has('drones.carrier.brood');
    this.firstAttuned = null;
    for (const el of w.build.attunements) if (el) { this.firstAttuned = el; break; }
    this.bladeDmg = s.get('blade.damage'); this.bladeEl = infusedElement(s, 'blade');
    this.laserDps = s.get('laser.damage'); this.vbDmg = s.get('laser.vertex_blast.damage'); this.vbLen = s.get('laser.vertex_blast.length');
    this.droneDmg = s.get('drones.damage');
    this.critMass = s.has('reactor.critical_mass'); this.cmThreshold = s.get('reactor.critical_mass.threshold');
    this.syncOn = s.hasDoctrine('reactor', 'synchronization');
    this.syncWindow = Math.round(s.get('reactor.sync.window') * 60);
    this.harborCd = Math.max(60, Math.round((s.get('chassis.bastion+gravitics.cooldown') - this.mag[L_HARBOR]) * 60));
    this.crowd = Math.max(1, s.get('chassis.bastion+gravitics.crowd'));
  }

  private fire(w: World, k: number, a: number, b: number, x: number, y: number, cause: number, gap = 0): number {
    if (gap > 0 && w.tick - this.lastEmit[k] < gap) return cause;
    this.lastEmit[k] = w.tick;
    return w.emit(Ev.Linkage, LINK_IDS[k], a, b, x, y, cause);
  }

  update(w: World): void {
    const sh = w.shared, t = w.tower, tick = w.tick;
    if (!this.any) { sh.bladeSpeedMul = 1; sh.laserWidthMul = 1; sh.laserPulseRateMul = 1; sh.droneBoost.fill(0); this.evCursor = w.events.nextId; return; }
    const gas = w.stats.get('reactor.global_attack_speed') * (w.dynamicSpeedMul > 0 ? w.dynamicSpeedMul : 1);
    // --- channels
    if (tick >= this.whetUntil) this.whetStacks = 0;
    if (tick >= this.kinUntil) this.kinStacks = 0;
    let bm = (1 + this.whetStacks * this.mag[L_WHET]) * (1 + this.kinStacks * this.mag[L_KINETIC]);
    if (this.on[L_FLYWHEEL]) { bm *= 1 + Math.max(0, gas - 1) * this.mag[L_FLYWHEEL]; if (sh.bladeCount > 0) this.fire(w, L_FLYWHEEL, gas, this.rank[L_FLYWHEEL], 0, 0, -1, CONTINUOUS); }
    sh.bladeSpeedMul = bm;
    const guarded = t.shield > 0 || t.barrier > 0;
    sh.laserWidthMul = this.on[L_LENS] && guarded ? 1 + this.mag[L_LENS] : 1;
    if (this.on[L_LENS] && guarded && sh.laserBeamCount > 0) this.fire(w, L_LENS, t.shield + t.barrier, this.rank[L_LENS], 0, 0, -1, CONTINUOUS);
    sh.laserPulseRateMul = this.on[L_CLOCK] ? Math.max(0.1, 1 + (gas - 1) * this.mag[L_CLOCK]) : 1;
    if (this.on[L_CLOCK] && sh.laserNodeCount > 0) this.fire(w, L_CLOCK, gas, this.rank[L_CLOCK], 0, 0, -1, CONTINUOUS);
    this.droneChannels(w);
    // --- Counterbattery: shield break or Outer Barrier break
    if (this.on[L_COUNTER]) this.counterbattery(w);
    else this.evCursor = w.events.nextId;
    this.shieldSeen = t.shield; this.guardSeen = t.shield + t.barrier;
    // --- projectiles crossing blades / beams / wells
    if (this.on[L_CASING] || this.on[L_WHET] || this.on[L_ENERGIZED] || this.on[L_SLING] || this.on[L_CHARGED] || this.on[L_PAYLOAD]) this.projectilePass(w);
    if (this.on[L_ESCORT] && sh.droneCount > 0 && (tick & 1) === 0) this.escortBlades(w);
    if (this.on[L_MOBILE] && sh.droneCount > 0 && sh.laserNodeCount > 0) this.mobileVertex(w);
    if (this.on[L_VSTRIKE] && sh.bladeCount > 0 && sh.laserNodeCount > 0) this.vertexStrike(w);
    if (this.on[L_HARBOR]) this.safeHarbor(w);
  }

  private droneChannels(w: World): void {
    const sh = w.shared, tick = w.tick;
    const sync = this.on[L_SYNC] && tick < this.syncUntil ? this.mag[L_SYNC] : 0;
    for (let k = 0; k < sh.droneCount; k++) {
      let b = sync;
      if (this.on[L_ASSIST]) {
        if (wellAt(w, sh.drones[k * 3], sh.drones[k * 3 + 1]) >= 0) {
          if (this.gaUntil[k] <= tick) this.fire(w, L_ASSIST, k, this.rank[L_ASSIST], sh.drones[k * 3], sh.drones[k * 3 + 1], -1);
          this.gaUntil[k] = tick + 120;
        }
        if (this.gaUntil[k] > tick) b += this.mag[L_ASSIST];
      }
      sh.droneBoost[k] = b;
    }
  }

  private counterbattery(w: World): void {
    const ev = w.events, end = ev.nextId, t = w.tower;
    let trigger = -2;
    for (let id = Math.max(this.evCursor, end - 4096); id < end; id++) {
      const x = ev.byId(id);
      if (x && x.type === Ev.BarrierBreak) { trigger = id; break; }
    }
    this.evCursor = end;
    if (trigger === -2 && this.shieldSeen > 0 && t.shield <= 0 && t.maxShield > 0) trigger = -1;
    if (trigger === -2) return;
    const n = Math.max(1, Math.floor(this.mag[L_COUNTER] + 1e-9));
    const range = w.stats.get('ordnance.range');
    const cause = this.fire(w, L_COUNTER, n, this.rank[L_COUNTER], 0, 0, trigger);
    let np = 0;
    const dmg = w.stats.get('ordnance.damage');
    for (let m = 0; m < n; m++) {
      let tg = w.nearestExcluding(0, 0, range, this.picked, np);
      if (tg < 0) tg = np > 0 ? this.picked[m % np] : -1;
      else if (np < this.picked.length) this.picked[np++] = tg;
      if (tg < 0) break;
      launchRackMissile(w, tg, dmg, LINK_IDS[L_COUNTER], cause, (m - (n - 1) / 2) * 0.15);
    }
  }

  private projectilePass(w: World): void {
    const p = w.projectiles, sh = w.shared, e = w.enemies;
    const bladeN = this.on[L_WHET] ? sh.bladeCount : 0;
    const beamN = this.on[L_ENERGIZED] || this.on[L_CHARGED] ? sh.laserBeamCount : 0;
    const wells = this.on[L_SLING] || this.on[L_PAYLOAD] ? sh.wellCount : 0;
    const B = sh.laserBeams, bw = sh.laserBeamWidth * 0.5;
    for (let i = 0; i < p.count; i++) {
      const f = p.flags[i];
      if (f & (ProjFlag.Dead | ProjFlag.Hostile)) continue;
      const src = p.source[i], x = p.x[i], y = p.y[i], bits = p.hpBits[i];
      if (src === SRC_PRIMARY) {
        // Whetstone: crossing the blade's arc → +1 pierce
        if (bladeN > 0 && (bits & HB_WHET) === 0) {
          for (let k = 0; k < bladeN; k++) {
            const a = sh.bladeAngles[k], r0 = sh.bladeInner[k], r1 = r0 + sh.bladeLens[k], c = cos(a), s = sin(a), rr = 6 + p.radius[i];
            if (segDist2(x, y, c * r0, s * r0, c * r1, s * r1) > rr * rr) continue;
            p.hpBits[i] |= HB_WHET; p.flags[i] |= ProjFlag.CrossedBlade;
            if (p.pierce[i] < 255) p.pierce[i]++;
            if (p.retention[i] <= 0) p.retention[i] = 1;
            this.fire(w, L_WHET, i, p.pierce[i], x, y, p.cause[i], THROTTLE);
            break;
          }
        }
        // Energized Rounds: crossing a beam → damage and the beam's infusion
        if (this.on[L_ENERGIZED] && beamN > 0 && (bits & HB_ENERGIZED) === 0) {
          for (let b = 0; b < beamN; b++) {
            const rr = bw + p.radius[i];
            if (segDist2(x, y, B[b * 4], B[b * 4 + 1], B[b * 4 + 2], B[b * 4 + 3]) > rr * rr) continue;
            p.hpBits[i] |= HB_ENERGIZED; p.flags[i] |= ProjFlag.CrossedBeam;
            p.damage[i] *= 1 + this.mag[L_ENERGIZED];
            if (p.element[i] === 0 && sh.laserElement > 0) p.element[i] = sh.laserElement;
            this.fire(w, L_ENERGIZED, i, sh.laserElement, x, y, p.cause[i], THROTTLE);
            break;
          }
        }
        // Slingshot: curve toward wells within 80; +damage per well passed
        if (this.on[L_SLING] && wells > 0) {
          for (let k = 0; k < wells; k++) {
            const wx = sh.wells[k * 4], wy = sh.wells[k * 4 + 1], wr = sh.wells[k * 4 + 2];
            const dx = wx - x, dy = wy - y, d2 = dx * dx + dy * dy, reach = wr + SLING_RANGE;
            if (d2 > reach * reach) continue;
            const d = Math.sqrt(d2) || 1, sp = Math.sqrt(p.vx[i] * p.vx[i] + p.vy[i] * p.vy[i]);
            const pullK = 0.06;
            let nvx = p.vx[i] / sp + (dx / d) * pullK, nvy = p.vy[i] / sp + (dy / d) * pullK;
            const nl = Math.sqrt(nvx * nvx + nvy * nvy) || 1;
            nvx /= nl; nvy /= nl;
            p.vx[i] = nvx * sp; p.vy[i] = nvy * sp;
            const bit = 1 << (HB_SLING_SHIFT + (k & 7));
            if (d2 <= wr * wr && (p.hpBits[i] & bit) === 0) {
              p.hpBits[i] |= bit;
              p.damage[i] *= 1 + this.mag[L_SLING];
              this.fire(w, L_SLING, i, k, x, y, p.cause[i], THROTTLE);
            }
          }
        }
      } else if (src === SRC_ORDNANCE && p.blast[i] > 0) {
        // Shell Casing: missiles at Marked targets gain crit chance and the primary's crit damage
        if (this.on[L_CASING] && (bits & HB_CASING) === 0) {
          const tg = p.target[i];
          if (tg >= 0 && tg < e.count && e.gen[tg] === p.targetGen[i] && e.markedT[tg] > 0) {
            p.hpBits[i] |= HB_CASING; p.flags[i] |= ProjFlag.Marked;
            p.critChance[i] += this.mag[L_CASING]; p.critMul[i] = Math.max(p.critMul[i], this.critDmg);
            this.fire(w, L_CASING, tg, p.critChance[i], x, y, p.cause[i], THROTTLE);
          }
        }
        // Charged Warheads: crossing a beam splits off 2 extra warheads that fly with the missile
        if (this.on[L_CHARGED] && beamN > 0 && (bits & (HB_CHARGED | HB_SPLIT)) === 0 && p.kind[i] !== ProjKind.Fragment) {
          for (let b = 0; b < beamN; b++) {
            const rr = bw + p.radius[i];
            if (segDist2(x, y, B[b * 4], B[b * 4 + 1], B[b * 4 + 2], B[b * 4 + 3]) > rr * rr) continue;
            p.hpBits[i] |= HB_CHARGED; p.flags[i] |= ProjFlag.CrossedBeam;
            this.chargedSplit(w, i);
            break;
          }
        }
        // Payload Well: explosions inside a well gain radius per captive
        if (this.on[L_PAYLOAD] && wells > 0 && (p.hpBits[i] & HB_PAYLOAD) === 0) {
          const k = wellAt(w, x, y);
          if (k >= 0 && sh.wells[k * 4 + 3] > 0) {
            p.hpBits[i] |= HB_PAYLOAD;
            p.blast[i] *= 1 + Math.min(1, this.mag[L_PAYLOAD] * sh.wells[k * 4 + 3]);
            this.fire(w, L_PAYLOAD, i, sh.wells[k * 4 + 3], x, y, p.cause[i], THROTTLE);
          }
        }
      }
    }
  }

  private chargedSplit(w: World, i: number): void {
    const p = w.projectiles;
    const cause = this.fire(w, L_CHARGED, i, this.rank[L_CHARGED], p.x[i], p.y[i], p.cause[i]);
    const a0 = atan2(p.vy[i], p.vx[i]), sp = Math.sqrt(p.vx[i] * p.vx[i] + p.vy[i] * p.vy[i]);
    const x = p.x[i], y = p.y[i], dmg = p.damage[i] * this.mag[L_CHARGED], blast = p.blast[i] * 0.6, tg = p.target[i];
    const el = elementAt(p.element[i]), life = Math.max(20, p.life[i]);
    for (let s = -1; s <= 1; s += 2) {
      const j = spawnSeeker(w, {
        kind: ProjKind.Fragment, source: SRC_ORDNANCE, srcTag: LINK_IDS[L_CHARGED], x, y, angle: a0 + s * 0.25, speed: sp,
        damage: dmg, radius: 3, blast, life, target: tg, element: el, cause, bits: HB_SPLIT | HB_CHARGED,
      });
      if (j >= 0 && tg >= 0) w.projectiles.targetGen[j] = p.targetGen[i];
    }
  }

  private escortBlades(w: World): void {
    const sh = w.shared, tick = w.tick;
    const dmg = this.bladeDmg * this.mag[L_ESCORT];
    const buf = SCRATCH.push();
    for (let k = 0; k < sh.droneCount; k++) {
      const x = sh.drones[k * 3], y = sh.drones[k * 3 + 1], a = tick * 0.1 + k * 1.7;
      const cnt = querySegment(w, x - cos(a) * ESCORT_R, y - sin(a) * ESCORT_R, x + cos(a) * ESCORT_R, y + sin(a) * ESCORT_R, 3, buf);
      for (let j = 0; j < cnt; j++) {
        const i = buf[j];
        if (!targetableEnemy(w, i) || tick - this.escortAt[i] < 15) continue;
        this.escortAt[i] = tick;
        const cause = this.fire(w, L_ESCORT, i, k, x, y, -1, THROTTLE);
        w.damage(i, dmg, { source: 'linkage', srcTag: LINK_IDS[L_ESCORT], element: this.bladeEl, cause });
      }
    }
    SCRATCH.pop();
  }

  private mobileVertex(w: World): void {
    const sh = w.shared, tick = w.tick;
    this.mvTimer += TICK_DT;
    if (this.mvTimer >= 6) {
      this.mvTimer -= 6; this.mvUntil = tick + 180; this.mvStart = (this.mvStart + 1) % Math.max(1, sh.droneCount);
      this.fire(w, L_MOBILE, Math.min(this.rank[L_MOBILE], sh.droneCount), this.mvStart, 0, 0, -1);
    }
    if (tick >= this.mvUntil || tick % 6 !== 0) return;
    const n = Math.min(Math.max(1, Math.floor(this.mag[L_MOBILE] + 1e-9)), sh.droneCount);
    const hw = Math.max(3, sh.laserBeamWidth * 0.5), dmg = this.laserDps * 0.1;
    const buf = SCRATCH.push();
    for (let m = 0; m < n; m++) {
      const k = (this.mvStart + m) % sh.droneCount;
      const x = sh.drones[k * 3], y = sh.drones[k * 3 + 1];
      for (let q = 0; q < 2 && q < sh.laserNodeCount; q++) {
        const node = this.nearestNode(sh, x, y, q);
        const nx = sh.laserNodes[node * 2], ny = sh.laserNodes[node * 2 + 1];
        const cnt = querySegment(w, x, y, nx, ny, hw, buf);
        for (let j = 0; j < cnt; j++) {
          const i = buf[j];
          if (!targetableEnemy(w, i)) continue;
          w.damage(i, dmg, { source: 'linkage', srcTag: LINK_IDS[L_MOBILE], element: elementAt(sh.laserElement), cause: -1 });
        }
      }
    }
    SCRATCH.pop();
  }

  /** Index of the (rank+1)-th nearest live laser node to (x,y). */
  private nearestNode(sh: World['shared'], x: number, y: number, rank: number): number {
    let b0 = -1, d0 = Infinity, b1 = -1, d1 = Infinity;
    for (let k = 0; k < sh.laserNodeCount; k++) {
      const dx = sh.laserNodes[k * 2] - x, dy = sh.laserNodes[k * 2 + 1] - y, d = dx * dx + dy * dy;
      if (d < d0) { b1 = b0; d1 = d0; b0 = k; d0 = d; } else if (d < d1) { b1 = k; d1 = d; }
    }
    return rank === 0 ? b0 : (b1 >= 0 ? b1 : b0);
  }

  private vertexStrike(w: World): void {
    const sh = w.shared, tick = w.tick;
    const buf = SCRATCH.push();
    for (let q = 0; q < sh.laserNodeCount && q < 32; q++) {
      if (tick - this.nodeCd[q] < 120) continue;
      const nx = sh.laserNodes[q * 2], ny = sh.laserNodes[q * 2 + 1];
      const d = Math.sqrt(nx * nx + ny * ny), na = atan2(ny, nx);
      let passed = false;
      for (let k = 0; k < sh.bladeCount && !passed; k++) {
        const r0 = sh.bladeInner[k], r1 = r0 + sh.bladeLens[k];
        if (d < r0 - 14 || d > r1 + 14) continue;
        if (Math.abs(angleDiff(sh.bladeAngles[k], na)) * Math.max(1, d) <= 12) passed = true;
      }
      if (!passed) continue;
      this.nodeCd[q] = tick;
      const cause = this.fire(w, L_VSTRIKE, q, this.rank[L_VSTRIKE], nx, ny, -1);
      const x1 = nx + cos(na) * this.vbLen, y1 = ny + sin(na) * this.vbLen;
      if (this.flashTick !== tick) { this.flashN = 0; this.flashTick = tick; }
      if (this.flashN < 16) { const o = this.flashN++ * 4; this.flash[o] = nx; this.flash[o + 1] = ny; this.flash[o + 2] = x1; this.flash[o + 3] = y1; }
      const cnt = querySegment(w, nx, ny, x1, y1, 5, buf);
      const dmg = this.laserDps * this.vbDmg * this.mag[L_VSTRIKE];
      for (let j = 0; j < cnt; j++) {
        const i = buf[j];
        if (!targetableEnemy(w, i)) continue;
        w.damage(i, dmg, { source: 'linkage', srcTag: LINK_IDS[L_VSTRIKE], element: elementAt(sh.laserElement), cause });
      }
    }
    SCRATCH.pop();
  }

  private safeHarbor(w: World): void {
    const tick = w.tick;
    if (tick < this.harborUntil) {
      const buf = SCRATCH.push();
      const cnt = w.queryRadius(0, 0, INNER_RING, buf);
      const e = w.enemies;
      for (let j = 0; j < cnt; j++) { const i = buf[j]; if (w.alive(i)) w.knockback(i, e.x[i], e.y[i], 120 * TICK_DT); }
      SCRATCH.pop();
      return;
    }
    if (this.harborT > 0) { this.harborT--; return; }
    if (tick % 10 !== 0) return;
    const buf = SCRATCH.push();
    const cnt = w.queryRadius(0, 0, INNER_RING, buf);
    let n = 0;
    for (let j = 0; j < cnt; j++) if (targetableEnemy(w, buf[j])) n++;
    SCRATCH.pop();
    if (n < this.crowd) return;
    this.harborUntil = tick + 180; this.harborT = this.harborCd;
    this.fire(w, L_HARBOR, n, this.rank[L_HARBOR], 0, 0, -1);
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------
  onHit(w: World, hit: HitInfo): void {
    if (!this.any) return;
    const i = hit.enemy, tick = w.tick;
    if (i < 0 || i >= MAX_ENEMIES) return;
    const src = hit.source;
    if (src === 'primary') {
      this.otherHitAt[i] = tick;
      if (hit.crit) {
        if (this.on[L_CASING] && !hit.killed && w.alive(i)) {
          const cause = this.fire(w, L_CASING, i, 0, hit.x, hit.y, hit.eventId, THROTTLE);
          w.applyStatus(i, 'marked', 1, 180, LINK_IDS[L_CASING], cause);
        }
        if (this.on[L_WHET]) {
          this.whetStacks = Math.min(5, this.whetStacks + 1); this.whetUntil = tick + 60;
          this.fire(w, L_WHET, this.whetStacks, 0, hit.x, hit.y, hit.eventId, THROTTLE);
        }
      }
      return;
    }
    if (src === 'drones' && hit.srcTag === 'drones') {
      const pj = hit.projectile;
      const micro = pj >= 0 && pj < w.projectiles.count && w.projectiles.kind[pj] === ProjKind.Microdrone;
      if (this.on[L_WINGMAN] && (!micro || this.brood) && !hit.killed && w.alive(i) && w.prng.chance(Math.min(1, this.mag[L_WINGMAN]))) {
        let dmg = hit.damage * this.mag[L_WINGMAN];
        if (this.exec > 0 && w.enemies.hp[i] < 0.3 * w.enemies.maxHp[i]) dmg *= 1 + this.exec;
        const cause = this.fire(w, L_WINGMAN, i, 0, hit.x, hit.y, hit.eventId, THROTTLE);
        w.damage(i, dmg, { source: 'linkage', srcTag: LINK_IDS[L_WINGMAN], element: this.firstAttuned, cause });
      }
      if (this.on[L_SPOTTER] && !hit.killed && w.alive(i) && w.enemies.markedT[i] < 60) {
        const cause = this.fire(w, L_SPOTTER, i, 0, hit.x, hit.y, hit.eventId, THROTTLE);
        w.applyStatus(i, 'marked', 1, 120, LINK_IDS[L_SPOTTER], cause);
      }
      if (this.on[L_SYNC] && this.syncOn && tick - this.otherHitAt[i] <= this.syncWindow) {
        if (tick >= this.syncUntil) this.fire(w, L_SYNC, i, this.rank[L_SYNC], hit.x, hit.y, hit.eventId);
        this.syncUntil = tick + 120;
      }
      return;
    }
    if (src === 'ordnance' || src === 'blade' || src === 'laser' || src === 'gravitics') this.otherHitAt[i] = tick;
    if (src === 'ordnance') { this.explodedAt[i] = tick; return; }
    if (src === 'blade' && hit.srcTag === 'blade' && !hit.killed && w.alive(i)) {
      if (this.on[L_SHRAPNEL] && tick - this.explodedAt[i] <= 60) {
        const cause = this.fire(w, L_SHRAPNEL, i, 0, hit.x, hit.y, hit.eventId, THROTTLE);
        w.damage(i, hit.damage * this.mag[L_SHRAPNEL], { source: 'linkage', srcTag: LINK_IDS[L_SHRAPNEL], cause });
      }
      if (this.on[L_UNDERTOW] && w.alive(i) && wellAt(w, w.enemies.x[i], w.enemies.y[i]) >= 0) {
        const cause = this.fire(w, L_UNDERTOW, i, 0, hit.x, hit.y, hit.eventId, THROTTLE);
        w.damage(i, hit.damage * this.mag[L_UNDERTOW], { source: 'linkage', srcTag: LINK_IDS[L_UNDERTOW], cause });
      }
    }
  }

  onKill(w: World, hit: HitInfo): void {
    if (!this.any) return;
    if (hit.source === 'ordnance' && this.on[L_SPOTTER] && w.prng.chance(this.mag[L_SPOTTER])) {
      const cause = this.fire(w, L_SPOTTER, hit.enemy, 1, hit.x, hit.y, hit.eventId);
      const tg = w.nearestEnemy(hit.x, hit.y, 250, 'nearest', 'drones');
      launchMicrodrone(w, hit.x, hit.y, 0, tg, this.droneDmg * w.stats.get('drones.carrier.microdrone_damage'), 5, null, 'drones', cause);
    }
    if (hit.source === 'drones' && this.on[L_RECHARGE]) {
      const t = w.tower;
      if (t.maxShield > 0 && t.shield < t.maxShield) {
        t.shield = Math.min(t.maxShield, t.shield + this.mag[L_RECHARGE] * t.maxShield);
        this.fire(w, L_RECHARGE, hit.enemy, t.shield, hit.x, hit.y, hit.eventId, THROTTLE);
      }
    }
    if (this.on[L_HOTLOAD] && this.critMass && w.enemies.count >= this.cmThreshold && w.prng.chance(this.mag[L_HOTLOAD])) {
      const tg = w.nearestEnemy(0, 0, w.stats.get('ordnance.range'), 'nearest', 'ordnance');
      if (tg >= 0) {
        const cause = this.fire(w, L_HOTLOAD, tg, w.enemies.count, hit.x, hit.y, hit.eventId);
        launchRackMissile(w, tg, w.stats.get('ordnance.damage'), 'ordnance', cause);
      }
    }
  }

  onTowerHit(w: World, _damage: number, _enemy: number, cause: number): void {
    if (!this.on[L_KINETIC]) return;
    const t = w.tower, guard = t.shield + t.barrier;
    if (guard < this.guardSeen - 1e-6) {
      this.kinStacks = Math.min(5, this.kinStacks + 1); this.kinUntil = w.tick + 60;
      this.fire(w, L_KINETIC, this.kinStacks, this.guardSeen - guard, 0, 0, cause, THROTTLE);
    }
    this.guardSeen = guard;
  }

  onCompact(w: World, remap: Int32Array, oldCount: number): void {
    const n = w.enemies.count;
    remapArray(this.explodedAt, remap, oldCount, n, -1_000_000);
    remapArray(this.otherHitAt, remap, oldCount, n, -1_000_000);
    remapArray(this.escortAt, remap, oldCount, n, -1_000_000);
  }

  render(w: World, out: InstanceWriter): void {
    if (!this.any) return;
    const sh = w.shared, tick = w.tick;
    if (this.on[L_ESCORT]) for (let k = 0; k < sh.droneCount; k++) {
      const x = sh.drones[k * 3], y = sh.drones[k * 3 + 1], a = tick * 0.1 + k * 1.7;
      out.push(x - cos(a) * ESCORT_R, y - sin(a) * ESCORT_R, 1.5, a, Shape.Line, 0.85, 0.88, 1, 0.9, 2, x + cos(a) * ESCORT_R, y + sin(a) * ESCORT_R);
    }
    if (this.on[L_MOBILE] && tick < this.mvUntil && sh.laserNodeCount > 0) {
      const n = Math.min(Math.max(1, Math.floor(this.mag[L_MOBILE] + 1e-9)), sh.droneCount);
      for (let m = 0; m < n; m++) {
        const k = (this.mvStart + m) % Math.max(1, sh.droneCount);
        const x = sh.drones[k * 3], y = sh.drones[k * 3 + 1];
        for (let q = 0; q < 2 && q < sh.laserNodeCount; q++) {
          const node = this.nearestNode(sh, x, y, q);
          out.push(x, y, Math.max(1.5, sh.laserBeamWidth * 0.4), 0, Shape.Line, 1, 0.4, 0.9, 0.7, 2, sh.laserNodes[node * 2], sh.laserNodes[node * 2 + 1]);
        }
      }
    }
    if (tick - this.flashTick < 8) for (let f = 0; f < this.flashN; f++) {
      const o = f * 4;
      out.push(this.flash[o], this.flash[o + 1], 3, 0, Shape.Line, 1, 0.85, 1, 1 - (tick - this.flashTick) / 8, 2, this.flash[o + 2], this.flash[o + 3]);
    }
    if (tick < this.harborUntil) out.push(0, 0, INNER_RING, 0, Shape.Ring, 0.7, 0.5, 1, 0.45, 1);
  }
}
