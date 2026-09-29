/**
 * Infusions (design §8): `infuse.<system>.<element>` (3 ranks; magnitude = stats.get(id), active when the system
 * is mounted and the element attuned). The hardpoint systems themselves put the first infused element on their
 * hits (HitInfo.element → the elements system procs); this system adds each Infusion's twist and emits
 * Ev.Infusion (src = the node id) when a twist fires (steady per-hit twists at most every 0.5 s per id):
 *   ordnance  fire: burning crater 2 s (Burn stacks/s); lightning: blasts arc to 3 enemies outside the blast
 *             (mag × blast damage); poison: toxic cloud 3 s (Poison stacks/s); frost: ice patch 3 s (Chill stacks/s)
 *   drones    fire: Burn chance; lightning: chance to arc to the nearest other drone's target; poison: mag stacks
 *             on average; frost: Chill chance. Microdrones only proc these with Brood.
 *   blade     fire: fire trail along the tip for 0.6 s (Burn stacks once per enemy per pass); lightning: arc chance;
 *             poison: stacks per hit, kills contaminate the blade 2 s (double stacks); frost: Chill per hit,
 *             hits on frozen enemies shatter for +50%
 *   laser     fire/poison/frost: enemies touching a beam gain stacks each second (frost also frosts the interior
 *             every 2 s); lightning: each node arcs to the nearest enemy within 100 every second (mag × beam DPS).
 *             Prism frame: every attuned element counts as infused (rank ≥ 1).
 *   gravitics fire/poison: captives gain stacks each second (firestorm / toxic vortex); lightning: every 0.5 s arcs
 *             between mag pairs of captives; frost: collapses Chill captives (mag stacks), rank 3 freezes 1 s.
 * Ordnance explosions are read from the event log (Ev.Explosion, src ordnance…) one tick later; wells, collapses,
 * beams, nodes, blades and drones from world.shared.
 */
import type { System, InstanceWriter, HitInfo } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { ElementId, HardpointId, StatusId } from '../core/ids';
import { EnemyFlag, Ev, MAX_ENEMIES, ProjKind, Shape } from '../core/types';
import { cos, sin } from '../math/lut';
import { frameDef } from '../core/content';
import { INFUSIONS } from '../data/index';
import { ELEMENTS, ELEMENT_RGB, SCRATCH, querySegment, remapArray, targetableEnemy } from './hardpoints/common';

const SYSTEMS: readonly HardpointId[] = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];
const S_ORD = 0, S_DRN = 1, S_BLD = 2, S_LSR = 3, S_GRV = 4;
const E_FIRE = 0, E_LIGHT = 1, E_POISON = 2, E_FROST = 3;
const STATUS: readonly StatusId[] = ['burn', 'shock', 'poison', 'chill'];
const MAX_ZONES = 64;
const MAX_TRAIL = 64;
const STATUS_TICKS = 180;
const THROTTLE = 30;

function idx(s: number, e: number): number { return s * 4 + e; }

export class InfusionsSystem implements System {
  readonly id = 'infusions';
  private ids: string[] = [];
  private on = new Uint8Array(20); private mag = new Float32Array(20); private rank = new Int8Array(20);
  private perRank = new Float32Array(20);
  private any = false; private brood = false;
  private laserDps = 12;
  private lastEmit = new Int32Array(20).fill(-1_000_000);
  private evCursor = 0;
  // zones (craters / clouds / ice patches)
  private zN = 0; private zHead = 0;
  private zx = new Float32Array(MAX_ZONES); private zy = new Float32Array(MAX_ZONES); private zr = new Float32Array(MAX_ZONES);
  private zLife = new Int32Array(MAX_ZONES); private zNext = new Int32Array(MAX_ZONES); private zEl = new Uint8Array(MAX_ZONES);
  private zStacks = new Float32Array(MAX_ZONES); private zCause = new Int32Array(MAX_ZONES); private zInf = new Uint8Array(MAX_ZONES);
  // blade fire trail
  private tx = new Float32Array(MAX_TRAIL); private ty = new Float32Array(MAX_TRAIL); private tUntil = new Int32Array(MAX_TRAIL); private tHead = 0;
  private prevTipX = new Float32Array(4); private prevTipY = new Float32Array(4); private prevTipOk = new Uint8Array(4);
  private trailCd = new Int32Array(MAX_ENEMIES).fill(-1_000_000);
  private stamp = new Int32Array(MAX_ENEMIES).fill(-1);
  private contaminated = -1;

  constructor() {
    for (const s of SYSTEMS) for (const e of ELEMENTS) this.ids.push(`infuse.${s}.${e}`);
    for (let k = 0; k < 20; k++) {
      const def = INFUSIONS.find((d) => d.id === this.ids[k]);
      const fx = def?.node.effects.find((f) => f.stat === this.ids[k]);
      this.perRank[k] = fx ? fx.perRank : 1;
    }
  }

  init(w: World): void { this.rebuild(w); this.reset(w); }
  onAttemptStart(w: World): void { this.reset(w); }
  private reset(w: World): void {
    this.evCursor = w.events.nextId; this.zN = 0; this.zHead = 0; this.tUntil.fill(0); this.prevTipOk.fill(0);
    this.trailCd.fill(-1_000_000); this.contaminated = -1;
  }

  rebuild(w: World): void {
    const s = w.stats;
    const prism = frameDef(w.build.frame).flags.includes('beams_all_elements') && s.mounted('laser');
    this.any = false;
    for (let k = 0; k < 20; k++) {
      let on = s.has(this.ids[k]);
      let mag = on ? s.get(this.ids[k]) : 0, rank = on ? s.rank(this.ids[k]) : 0;
      if (!on && prism && k >= idx(S_LSR, 0) && k < idx(S_LSR, 4) && s.attuned(ELEMENTS[k & 3])) { on = true; mag = this.perRank[k]; rank = 1; }
      this.on[k] = on ? 1 : 0; this.mag[k] = mag; this.rank[k] = rank;
      if (on) this.any = true;
    }
    this.brood = s.has('drones.carrier.brood');
    this.laserDps = s.get('laser.damage');
  }

  private emit(w: World, k: number, a: number, x: number, y: number, cause: number, gap = 0): number {
    if (gap > 0 && w.tick - this.lastEmit[k] < gap) return cause;
    this.lastEmit[k] = w.tick;
    return w.emit(Ev.Infusion, this.ids[k], a, this.rank[k], x, y, cause);
  }

  private status(w: World, i: number, el: number, stacks: number, k: number, cause: number): void {
    if (stacks <= 0 || !w.alive(i)) return;
    w.applyStatus(i, STATUS[el], stacks, STATUS_TICKS, this.ids[k], cause);
  }
  private stacksOf(w: World, v: number): number {
    const whole = Math.floor(v);
    return whole + (v - whole > 0 && w.prng.chance(v - whole) ? 1 : 0);
  }

  update(w: World): void {
    if (!this.any) { this.evCursor = w.events.nextId; return; }
    const tick = w.tick;
    if (this.on[idx(S_ORD, 0)] || this.on[idx(S_ORD, 1)] || this.on[idx(S_ORD, 2)] || this.on[idx(S_ORD, 3)]) this.explosions(w);
    else this.evCursor = w.events.nextId;
    if (this.zN > 0) this.zones(w);
    if (w.shared.wellCount > 0 || w.shared.collapseCount > 0) this.wells(w);
    if (this.on[idx(S_BLD, E_FIRE)] && w.shared.bladeCount > 0) this.bladeTrail(w);
    if (w.shared.laserBeamCount > 0 && tick % 60 === 0) this.beams(w);
    if (this.on[idx(S_LSR, E_LIGHT)] && tick % 60 === 30) this.vertexArcs(w);
    if (this.on[idx(S_LSR, E_FROST)] && tick % 120 === 0 && w.shared.laserInterior > 0) this.interiorFrost(w);
  }

  // --- Ordnance ---------------------------------------------------------------
  private explosions(w: World): void {
    const ev = w.events, end = ev.nextId;
    for (let id = Math.max(this.evCursor, end - 4096); id < end; id++) {
      const x = ev.byId(id);
      if (!x || x.type !== Ev.Explosion) continue;
      const src = x.src;
      if (src !== 'ordnance' && src !== 'link.ordnance+laser' && src !== 'chassis.bastion+ordnance') continue;
      const r = Math.max(10, x.a);
      for (let el = 0; el < 4; el++) {
        const k = idx(S_ORD, el);
        if (!this.on[k]) continue;
        if (el === E_LIGHT) { this.blastArcs(w, k, x.x, x.y, r, x.b, id); continue; }
        const cause = this.emit(w, k, 0, x.x, x.y, id, THROTTLE / 2);
        const life = el === E_FIRE ? 2 : 3;
        this.addZone(w, x.x, x.y, r, life, el, this.mag[k], cause, k);
      }
    }
    this.evCursor = ev.nextId;
  }

  private addZone(w: World, x: number, y: number, r: number, lifeS: number, el: number, stacks: number, cause: number, k: number): void {
    const j = this.zN < MAX_ZONES ? this.zN++ : (this.zHead = (this.zHead + 1) % MAX_ZONES);
    this.zx[j] = x; this.zy[j] = y; this.zr[j] = r; this.zLife[j] = Math.round(lifeS * 60); this.zNext[j] = w.tick;
    this.zEl[j] = el; this.zStacks[j] = stacks; this.zCause[j] = cause; this.zInf[j] = k;
    const kind = el === E_FIRE ? 'fire_zone' : el === E_POISON ? 'toxic_cloud' : 'ice_patch';
    w.addHazard({ kind, x, y, radius: r, life: lifeS, dps: 0, element: ELEMENTS[el], cause, owner: 'ordnance', srcTag: this.ids[k] });
  }

  private zones(w: World): void {
    const tick = w.tick;
    const buf = SCRATCH.push();
    let m = 0;
    for (let j = 0; j < this.zN; j++) {
      if (--this.zLife[j] < 0) continue;
      if (tick >= this.zNext[j]) {
        this.zNext[j] = tick + 60;
        const cnt = w.queryRadius(this.zx[j], this.zy[j], this.zr[j], buf);
        const stacks = this.stacksOf(w, this.zStacks[j]);
        for (let q = 0; q < cnt; q++) this.status(w, buf[q], this.zEl[j], stacks, this.zInf[j], this.zCause[j]);
      }
      if (m !== j) {
        this.zx[m] = this.zx[j]; this.zy[m] = this.zy[j]; this.zr[m] = this.zr[j]; this.zLife[m] = this.zLife[j]; this.zNext[m] = this.zNext[j];
        this.zEl[m] = this.zEl[j]; this.zStacks[m] = this.zStacks[j]; this.zCause[m] = this.zCause[j]; this.zInf[m] = this.zInf[j];
      }
      m++;
    }
    this.zN = m; if (this.zHead >= m) this.zHead = 0;
    SCRATCH.pop();
  }

  private blastArcs(w: World, k: number, x: number, y: number, r: number, dmg: number, cause: number): void {
    const buf = SCRATCH.push();
    const cnt = w.queryRadius(x, y, r * 2 + 40, buf);
    const e = w.enemies;
    let arcs = 0, c = cause;
    for (let q = 0; q < cnt && arcs < 3; q++) {
      const i = buf[q];
      if (!targetableEnemy(w, i)) continue;
      const dx = e.x[i] - x, dy = e.y[i] - y, rr = r + e.radius[i];
      if (dx * dx + dy * dy <= rr * rr) continue;   // outside the blast only
      if (arcs === 0) c = this.emit(w, k, i, x, y, cause, THROTTLE / 2);
      w.damage(i, Math.max(0.01, dmg * this.mag[k]), { source: 'ordnance', srcTag: this.ids[k], element: 'lightning', cause: c, x, y });
      arcs++;
    }
    SCRATCH.pop();
  }

  // --- Gravitics --------------------------------------------------------------
  private wells(w: World): void {
    const sh = w.shared, tick = w.tick;
    const buf = SCRATCH.push();
    const second = tick % 60 === 0, half = tick % 30 === 0;
    for (let k = 0; k < sh.wellCount; k++) {
      const x = sh.wells[k * 4], y = sh.wells[k * 4 + 1], r = sh.wells[k * 4 + 2];
      if (!second && !half) break;
      let cnt = -1;
      for (let el = E_FIRE; el <= E_POISON; el += E_POISON - E_FIRE) {   // fire, poison
        const inf = idx(S_GRV, el);
        if (!this.on[inf] || !second) continue;
        if (cnt < 0) cnt = w.queryRadius(x, y, r, buf);
        if (cnt === 0) continue;
        const cause = this.emit(w, inf, cnt, x, y, -1);
        w.addHazard({ kind: el === E_FIRE ? 'firestorm' : 'toxic_cloud', x, y, radius: r, life: 1, dps: 0, element: ELEMENTS[el], cause, owner: 'gravitics', srcTag: this.ids[inf] });
        const stacks = this.stacksOf(w, this.mag[inf]);
        for (let q = 0; q < cnt; q++) this.status(w, buf[q], el, stacks, inf, cause);
      }
      const li = idx(S_GRV, E_LIGHT);
      if (this.on[li] && half) {
        if (cnt < 0) cnt = w.queryRadius(x, y, r, buf);
        const pairs = Math.min(Math.floor(this.mag[li] + 1e-9), cnt >> 1);
        if (pairs > 0) {
          const cause = this.emit(w, li, pairs, x, y, -1);
          const dmg = (w as WorldImpl).defaultDotDps() * 2.5 * w.stats.get('lightning.arc_damage');
          for (let p = 0; p < pairs; p++) {
            const a = buf[p * 2], b = buf[p * 2 + 1];
            if (w.alive(a)) w.damage(a, dmg, { source: 'gravitics', srcTag: this.ids[li], element: 'lightning', cause });
            if (w.alive(b)) w.damage(b, dmg, { source: 'gravitics', srcTag: this.ids[li], element: 'lightning', cause });
          }
        }
      }
    }
    const fi = idx(S_GRV, E_FROST);
    if (this.on[fi]) {
      const e = w.enemies;
      for (let c = 0; c < sh.collapseCount; c++) {
        const x = sh.collapses[c * 4], y = sh.collapses[c * 4 + 1], r = sh.collapses[c * 4 + 2];
        const cnt = w.queryRadius(x, y, r, buf);
        if (cnt === 0) continue;
        const cause = this.emit(w, fi, cnt, x, y, -1);
        const stacks = Math.max(1, Math.round(this.mag[fi]));
        for (let q = 0; q < cnt; q++) {
          const i = buf[q];
          this.status(w, i, E_FROST, stacks, fi, cause);
          if (this.rank[fi] >= 3 && w.alive(i) && (e.flags[i] & EnemyFlag.Boss) === 0) w.freeze(i, 60, this.ids[fi], cause);
        }
      }
    }
    SCRATCH.pop();
  }

  // --- Blade ------------------------------------------------------------------
  private bladeTrail(w: World): void {
    const sh = w.shared, tick = w.tick, k = idx(S_BLD, E_FIRE);
    if (tick % 6 !== 0) return;
    for (let b = 0; b < sh.bladeCount && b < 4; b++) {
      const a = sh.bladeAngles[b], r = sh.bladeInner[b] + sh.bladeLens[b];
      const x = cos(a) * r, y = sin(a) * r;
      const j = this.tHead; this.tHead = (this.tHead + 1) % MAX_TRAIL;
      this.tx[j] = x; this.ty[j] = y; this.tUntil[j] = tick + 36;
      if (this.prevTipOk[b]) {
        w.addHazard({ kind: 'fire_zone', x: this.prevTipX[b], y: this.prevTipY[b], x2: x, y2: y, radius: 6, life: 0.6, dps: 0, element: 'fire', cause: -1, owner: 'blade', srcTag: this.ids[k] });
      }
      this.prevTipX[b] = x; this.prevTipY[b] = y; this.prevTipOk[b] = 1;
    }
    const buf = SCRATCH.push();
    const stacks = this.stacksOf(w, this.mag[k]);
    let cause = -2;
    for (let j = 0; j < MAX_TRAIL; j++) {
      if (this.tUntil[j] <= tick) continue;
      const cnt = w.queryRadius(this.tx[j], this.ty[j], 10, buf);
      for (let q = 0; q < cnt; q++) {
        const i = buf[q];
        if (tick - this.trailCd[i] < 30 || !w.alive(i)) continue;
        this.trailCd[i] = tick;
        if (cause === -2) cause = this.emit(w, k, i, this.tx[j], this.ty[j], -1, THROTTLE);
        this.status(w, i, E_FIRE, stacks, k, cause);
      }
    }
    SCRATCH.pop();
  }

  // --- Laser ------------------------------------------------------------------
  private beams(w: World): void {
    const fire = this.on[idx(S_LSR, E_FIRE)], poison = this.on[idx(S_LSR, E_POISON)], frost = this.on[idx(S_LSR, E_FROST)];
    if (!fire && !poison && !frost) return;
    const sh = w.shared, B = sh.laserBeams, tick = w.tick;
    const buf = SCRATCH.push();
    const hw = Math.max(1, sh.laserBeamWidth * 0.5);
    const cf = fire ? this.emit(w, idx(S_LSR, E_FIRE), sh.laserBeamCount, 0, 0, -1) : -1;
    const cp = poison ? this.emit(w, idx(S_LSR, E_POISON), sh.laserBeamCount, 0, 0, -1) : -1;
    const cc = frost ? this.emit(w, idx(S_LSR, E_FROST), sh.laserBeamCount, 0, 0, -1) : -1;
    const sf = fire ? this.stacksOf(w, this.mag[idx(S_LSR, E_FIRE)]) : 0;
    const sp = poison ? this.stacksOf(w, this.mag[idx(S_LSR, E_POISON)]) : 0;
    const sc = frost ? this.stacksOf(w, this.mag[idx(S_LSR, E_FROST)]) : 0;
    for (let b = 0; b < sh.laserBeamCount; b++) {
      const cnt = querySegment(w, B[b * 4], B[b * 4 + 1], B[b * 4 + 2], B[b * 4 + 3], hw, buf);
      for (let q = 0; q < cnt; q++) {
        const i = buf[q];
        if (this.stamp[i] === tick || !targetableEnemy(w, i)) continue;
        this.stamp[i] = tick;
        if (fire) this.status(w, i, E_FIRE, sf, idx(S_LSR, E_FIRE), cf);
        if (poison) this.status(w, i, E_POISON, sp, idx(S_LSR, E_POISON), cp);
        if (frost) this.status(w, i, E_FROST, sc, idx(S_LSR, E_FROST), cc);
      }
    }
    SCRATCH.pop();
  }

  private vertexArcs(w: World): void {
    const sh = w.shared, k = idx(S_LSR, E_LIGHT);
    let cause = -2;
    for (let q = 0; q < sh.laserNodeCount; q++) {
      const x = sh.laserNodes[q * 2], y = sh.laserNodes[q * 2 + 1];
      const t = w.nearestEnemy(x, y, 100, 'nearest', 'laser');
      if (t < 0) continue;
      if (cause === -2) cause = this.emit(w, k, t, x, y, -1);
      w.damage(t, this.laserDps * this.mag[k], { source: 'laser', srcTag: this.ids[k], element: 'lightning', cause, x, y });
    }
  }

  private interiorFrost(w: World): void {
    const k = idx(S_LSR, E_FROST);
    const buf = SCRATCH.push();
    const cnt = w.queryRadius(0, 0, w.shared.laserInterior, buf);
    if (cnt > 0) {
      const cause = this.emit(w, k, cnt, 0, 0, -1);
      for (let q = 0; q < cnt; q++) this.status(w, buf[q], E_FROST, 1, k, cause);
    }
    SCRATCH.pop();
  }

  // --- Hooks (drones, blade) --------------------------------------------------
  onHit(w: World, hit: HitInfo): void {
    if (!this.any || hit.killed) return;
    const i = hit.enemy;
    if (!w.alive(i)) return;
    if (hit.source === 'drones' && hit.srcTag === 'drones') {
      const pj = hit.projectile;
      if (pj >= 0 && pj < w.projectiles.count && w.projectiles.kind[pj] === ProjKind.Microdrone && !this.brood) return;
      for (let el = 0; el < 4; el++) {
        const k = idx(S_DRN, el);
        if (!this.on[k]) continue;
        if (el === E_POISON) {
          const st = this.stacksOf(w, this.mag[k]);
          if (st > 0) this.status(w, i, el, st, k, this.emit(w, k, i, hit.x, hit.y, hit.eventId, THROTTLE));
          continue;
        }
        if (!w.prng.chance(this.mag[k])) continue;
        const cause = this.emit(w, k, i, hit.x, hit.y, hit.eventId, el === E_LIGHT ? 0 : THROTTLE);
        if (el === E_LIGHT) this.relay(w, i, hit.x, hit.y, hit.damage, k, cause);
        else this.status(w, i, el, 1, k, cause);
      }
      return;
    }
    if (hit.source === 'blade' && hit.srcTag === 'blade') {
      const li = idx(S_BLD, E_LIGHT);
      if (this.on[li] && w.prng.chance(this.mag[li])) this.bladeArc(w, i, hit.x, hit.y, hit.damage, li, hit.eventId);
      const pi = idx(S_BLD, E_POISON);
      if (this.on[pi] && w.alive(i)) {
        const contaminated = w.tick < this.contaminated;
        const st = this.stacksOf(w, this.mag[pi]) * (contaminated ? 2 : 1);
        this.status(w, i, E_POISON, st, pi, contaminated ? this.emit(w, pi, i, hit.x, hit.y, hit.eventId, THROTTLE) : hit.eventId);
      }
      const fi = idx(S_BLD, E_FROST);
      if (this.on[fi] && w.alive(i)) {
        if (w.enemies.frozenT[i] > 0) {
          const cause = this.emit(w, fi, i, hit.x, hit.y, hit.eventId);
          w.damage(i, hit.damage * 0.5, { source: 'blade', srcTag: this.ids[fi], element: 'frost', cause });
        }
        this.status(w, i, E_FROST, this.stacksOf(w, this.mag[fi]), fi, hit.eventId);
      }
    }
  }

  onKill(w: World, hit: HitInfo): void {
    const k = idx(S_BLD, E_POISON);
    if (!this.on[k] || hit.srcTag !== 'blade') return;
    if (w.tick >= this.contaminated) this.emit(w, k, hit.enemy, hit.x, hit.y, hit.eventId);
    this.contaminated = w.tick + 120;
  }

  /** Relay Shock: arc from the hit to the target of the nearest other drone. */
  private relay(w: World, from: number, x: number, y: number, dmg: number, k: number, cause: number): void {
    const sh = w.shared;
    if (sh.droneCount < 2) return;
    let shooter = -1, sd = Infinity;
    for (let d = 0; d < sh.droneCount; d++) {
      const dx = sh.drones[d * 3] - x, dy = sh.drones[d * 3 + 1] - y, dd = dx * dx + dy * dy;
      if (dd < sd) { sd = dd; shooter = d; }
    }
    let other = -1, od = Infinity;
    for (let d = 0; d < sh.droneCount; d++) {
      if (d === shooter) continue;
      const tg = sh.drones[d * 3 + 2];
      if (tg < 0 || tg === from || !targetableEnemy(w, tg)) continue;
      const dx = sh.drones[d * 3] - sh.drones[shooter * 3], dy = sh.drones[d * 3 + 1] - sh.drones[shooter * 3 + 1], dd = dx * dx + dy * dy;
      if (dd < od) { od = dd; other = tg; }
    }
    if (other < 0) other = w.nearestEnemy(x, y, 120, 'nearest', 'drones');
    if (other < 0 || other === from) return;
    w.damage(other, dmg * 0.5, { source: 'drones', srcTag: this.ids[k], element: 'lightning', cause, x, y });
  }

  private bladeArc(w: World, from: number, x: number, y: number, dmg: number, k: number, parent: number): void {
    const buf = SCRATCH.push();
    const cnt = w.queryRadius(x, y, 90, buf);
    let arcs = 0, cause = parent;
    for (let q = 0; q < cnt && arcs < 2; q++) {
      const i = buf[q];
      if (i === from || !targetableEnemy(w, i)) continue;
      if (arcs === 0) cause = this.emit(w, k, i, x, y, parent);
      w.damage(i, dmg * 0.5, { source: 'blade', srcTag: this.ids[k], element: 'lightning', cause, x, y });
      arcs++;
    }
    SCRATCH.pop();
  }

  onCompact(w: World, remap: Int32Array, oldCount: number): void {
    const n = w.enemies.count;
    remapArray(this.trailCd, remap, oldCount, n, -1_000_000);
    remapArray(this.stamp, remap, oldCount, n, -1);
  }

  render(w: World, out: InstanceWriter): void {
    if (!this.any) return;
    const tick = w.tick;
    if (this.on[idx(S_BLD, E_FIRE)]) {
      const c = ELEMENT_RGB[E_FIRE];
      for (let j = 0; j < MAX_TRAIL; j++) {
        const left = this.tUntil[j] - tick;
        if (left <= 0) continue;
        out.push(this.tx[j], this.ty[j], 4 + left * 0.1, 0, Shape.Circle, c[0], c[1], c[2], 0.25 + left / 72, 2);
      }
    }
  }
}
