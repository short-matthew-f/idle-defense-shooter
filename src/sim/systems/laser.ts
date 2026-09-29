/**
 * Laser Polygon (design §7): orbital nodes joined by damaging beams. Stat keys:
 *   laser.nodes (2 → 5; Expansion adds laser.expansion.nodes up to laser.max_nodes), laser.radius, laser.rotation (rad/s),
 *   laser.beam_width, laser.damage (DPS per beam), laser.node_durability (node HP; enemy contact and hostile shots
 *   damage nodes, a destroyed node rebuilds after laser.node_rebuild s and its beams drop meanwhile),
 *   laser.pulse (every pulse.interval s: ×pulse.width_mul width and ×pulse.damage_mul damage for pulse.duration s;
 *   cadence ÷ cooldown factor × world.shared.laserPulseRateMul), Exotic Vertex Blast (every vertex_blast.interval s
 *   each node fires an outward beam vertex_blast.length long for vertex_blast.damage × DPS).
 * Beams: 2 nodes → one segment; n ≥ 3 → the ring k→k+1. Damage lands in 10 Hz pulses (DPS × 0.1 × beams touching).
 * Counters: Refractors (EnemyFlag.Refracts / 'refracting' elites) end any beam that touches them (the beam stops at
 * the refractor) and take 70% less beam damage.
 * Doctrines:
 *   expansion    Star Configuration also joins k→k+2 (enemies in 2+ beams take ×star.intersection_mul);
 *                Mandala: outer ring at full radius + inner star at half radius
 *   resonance    +overlap per extra beam touching an enemy; Feedback: Shock while in 2+ beams;
 *                Standing Wave: +standing_wave.per_second per second held in 2+ beams (cap standing_wave.cap)
 *   containment  enemies inside the polygon are slowed by containment.field (cap field_cap) through
 *                EnemyPool.fieldSlow; Dynamic Geometry stretches the radius toward the densest ring (±dynamic_geometry);
 *                Crush: every crush.every s the polygon contracts to half radius over 1 s, pulling the interior inward
 * Linkage/gravitics interplay implemented here: Bent Light (link.laser+gravitics) bends beams through wells;
 * Lensing (gravitics.lensing.bend + focus) boosts beams passing a well. Wells are read from world.shared.
 * Infusions: beams carry the first infused element; Prism (beams_all_elements) cycles every attuned element.
 * WP8 signals: laserNodeMul (Mirror Node: node count ×2, up to MAX_LASER_NODES), ghostEdges (Ghost Edges: that many
 * temporary chords between opposite outer nodes while > 0).
 */
import type { System, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import type { ElementId } from '../core/ids';
import { EnemyFlag, Ev, MAX_ENEMIES, MAX_LASER_NODES, ProjFlag, Shape, TICK_DT } from '../core/types';
import { cos, sin } from '../math/lut';
import { frameDef } from '../core/content';
import {
  ELEMENTS, ELEMENT_RGB, SCRATCH, contactDps, cooldownFactor, elementAt, elementIndex, isRefractor, querySegment,
  remapArray, segDist2, segParam, targetableEnemy,
} from './hardpoints/common';

const NODE_R = 7;
const MAX_BEAMS = 96;
const DMG_EVERY = 6;
const DMG_DT = DMG_EVERY / 60;
const TAU = 6.283185307179586;
const MAX_REFRACTORS = 64;

export class LaserSystem implements System {
  readonly id = 'laser';
  private on = false;
  private n = 2; private R = 110; private rotSpeed = 0.6; private width = 6; private dps = 12; private durability = 50; private rebuildT = 240;
  private pulse = false; private pulseEvery = 3; private pulseDur = 18; private pulseW = 3; private pulseD = 2;
  private vertex = false; private vertexEvery = 2; private vertexLen = 200; private vertexDmg = 1.5;
  private star = false; private starMul = 2; private mandala = false;
  private overlap = 0; private feedback = 0; private standing = false; private swPer = 0.2; private swCap = 2;
  private field = 0; private dg = 0; private crush = false; private crushEvery = 8;
  private bent = 0; private bentRank = 0; private lens = 0;
  private els = new Int8Array(4); private elN = 0;
  // runtime
  private rot = 0; private geomR = 110; private pulseT = 0; private pulseLeft = 0; private vertexT = 0; private crushT = 0; private crushing = false;
  private hp = new Float32Array(MAX_LASER_NODES); private down = new Int32Array(MAX_LASER_NODES);
  private nx = new Float32Array(MAX_LASER_NODES); private ny = new Float32Array(MAX_LASER_NODES); private na = new Float32Array(MAX_LASER_NODES);
  private total = 2;
  private bA = new Int8Array(MAX_BEAMS); private bB = new Int8Array(MAX_BEAMS); private pairN = 0;
  private bMul = new Float32Array(MAX_BEAMS); private bStar = new Uint8Array(MAX_BEAMS); private beamN = 0;
  private cnt = new Uint8Array(MAX_ENEMIES); private emul = new Float32Array(MAX_ENEMIES); private estar = new Uint8Array(MAX_ENEMIES);
  private touched = new Int32Array(MAX_ENEMIES);
  private swT = new Float32Array(MAX_ENEMIES); private swLast = new Int32Array(MAX_ENEMIES);
  private refr = new Int32Array(MAX_REFRACTORS); private refrN = 0;
  private flash = new Float32Array(32 * 4); private flashN = 0; private flashTick = -100;
  private lastBentEmit = -1_000_000;

  init(w: World): void { this.rebuild(w); this.reset(); }
  onAttemptStart(): void { this.reset(); }
  private reset(): void {
    this.rot = 0; this.pulseT = 0; this.pulseLeft = 0; this.vertexT = 0; this.crushT = 0; this.crushing = false; this.geomR = this.R;
    this.hp.fill(this.durability); this.down.fill(0); this.swT.fill(0); this.swLast.fill(-1000);
  }

  rebuild(w: World): void {
    const s = w.stats;
    this.on = s.mounted('laser');
    const base = Math.max(2, Math.min(5, Math.floor(s.get('laser.nodes') + 1e-9)));
    const exp = s.doctrineStrength('laser', 'expansion') > 0;
    const maxN = Math.max(2, Math.min(8, Math.floor(s.get('laser.max_nodes'))));
    this.n = exp ? Math.min(maxN, base + Math.max(0, Math.floor(s.get('laser.expansion.nodes') + 1e-9))) : base;
    this.star = exp && s.has('laser.expansion.star');
    this.starMul = s.get('laser.expansion.star.intersection_mul');
    this.mandala = exp && s.has('laser.expansion.mandala');
    this.R = Math.max(30, s.get('laser.radius'));
    this.rotSpeed = s.get('laser.rotation');
    this.width = Math.max(1, s.get('laser.beam_width'));
    this.dps = s.get('laser.damage');
    const dur = Math.max(1, s.get('laser.node_durability'));
    if (dur !== this.durability) { for (let k = 0; k < MAX_LASER_NODES; k++) if (this.down[k] === 0) this.hp[k] = Math.min(dur, this.hp[k] + Math.max(0, dur - this.durability)); }
    this.durability = dur;
    this.rebuildT = Math.max(1, Math.round(s.get('laser.node_rebuild') * 60));
    this.pulse = s.has('laser.pulse');
    this.pulseEvery = Math.max(0.5, s.get('laser.pulse.interval'));
    this.pulseDur = Math.max(1, Math.round(s.get('laser.pulse.duration') * 60));
    this.pulseW = s.get('laser.pulse.width_mul'); this.pulseD = s.get('laser.pulse.damage_mul');
    this.vertex = s.has('laser.vertex_blast');
    this.vertexEvery = Math.max(0.2, s.get('laser.vertex_blast.interval'));
    this.vertexLen = s.get('laser.vertex_blast.length'); this.vertexDmg = s.get('laser.vertex_blast.damage');
    const res = s.doctrineStrength('laser', 'resonance') > 0;
    this.overlap = res ? s.get('laser.resonance.overlap') : 0;
    this.feedback = res && s.has('laser.resonance.feedback') ? s.get('laser.resonance.feedback') : 0;
    this.standing = res && s.has('laser.resonance.standing_wave');
    this.swPer = s.get('laser.resonance.standing_wave.per_second'); this.swCap = s.get('laser.resonance.standing_wave.cap');
    const con = s.doctrineStrength('laser', 'containment') > 0;
    this.field = con ? Math.min(s.get('laser.containment.field_cap'), s.get('laser.containment.field')) : 0;
    this.dg = con && s.has('laser.containment.dynamic_geometry') ? s.get('laser.containment.dynamic_geometry') : 0;
    this.crush = con && s.has('laser.containment.crush');
    this.crushEvery = Math.max(2, s.get('laser.containment.crush.every'));
    this.bent = s.has('link.laser+gravitics') ? s.get('link.laser+gravitics') : 0;
    this.bentRank = s.rank('link.laser+gravitics');
    this.lens = s.doctrineStrength('gravitics', 'lensing') > 0 && s.has('gravitics.lensing.bend')
      ? s.get('gravitics.lensing.bend') + s.get('gravitics.lensing.focus') : 0;
    this.elN = 0;
    if (frameDef(w.build.frame).flags.includes('beams_all_elements')) {
      for (let k = 0; k < 4; k++) if (s.attuned(ELEMENTS[k])) this.els[this.elN++] = k + 1;
    } else {
      for (let k = 0; k < 4; k++) if (s.has(`infuse.laser.${ELEMENTS[k]}`)) { this.els[this.elN++] = k + 1; break; }
    }
    this.baseN = this.n;
    this.nodeMul = -1;   // re-applied from world.signals on the next update
    this.applyCounts(w.signals ? w.signals.laserNodeMul : 1);
  }

  /** WP8 Mirror Node: node count × signals.laserNodeMul (up to MAX_LASER_NODES; Mandala's outer ring up to 8). */
  private applyCounts(mul: number): void {
    const m = mul > 1 ? Math.floor(mul) : 1;
    if (m === this.nodeMul) return;
    this.nodeMul = m;
    this.n = Math.max(2, Math.min(this.mandala ? MAX_LASER_NODES / 2 : MAX_LASER_NODES, this.baseN * m));
    this.total = this.mandala ? Math.min(MAX_LASER_NODES, this.n * 2) : this.n;
    this.buildPairs();
  }
  private baseN = 2; private nodeMul = 1;

  private buildPairs(): void {
    const n = this.n;
    let m = 0;
    const add = (a: number, b: number, st: number): void => { if (m < MAX_BEAMS) { this.bA[m] = a; this.bB[m] = b; this.bStar[m] = st; m++; } };
    if (n === 2) add(0, 1, 0);
    else for (let k = 0; k < n; k++) add(k, (k + 1) % n, 0);
    if (this.mandala) {
      const o = n;
      if (n >= 5) for (let k = 0; k < n; k++) add(o + k, o + ((k + 2) % n), 1);
      else if (n >= 3) for (let k = 0; k < n; k++) add(o + k, o + ((k + 1) % n), 1);
      else add(o, o + 1, 1);
    } else if (this.star && n >= 4) {
      if (n === 4) { add(0, 2, 1); add(1, 3, 1); } else for (let k = 0; k < n; k++) add(k, (k + 2) % n, 1);
    }
    this.pairN = m;
  }

  /** Current effective radius (Dynamic Geometry + Crush). */
  private radius(): number {
    let r = this.geomR;
    if (this.crushing) {
      const t = this.crushT;
      r *= t < 1 ? 1 - 0.5 * t : t < 1.5 ? 0.5 + (t - 1) : 1;
    }
    return r;
  }

  update(w: World): void {
    const sh = w.shared;
    if (!this.on) { sh.laserNodeCount = 0; sh.laserBeamCount = 0; sh.laserInterior = 0; sh.laserBeamWidth = 0; return; }
    const tick = w.tick;
    if (w.signals) this.applyCounts(w.signals.laserNodeMul);
    this.rot += this.rotSpeed * TICK_DT;
    if (this.rot > TAU) this.rot -= TAU;
    this.geometry(w);
    const R = this.radius();
    const n = this.n;
    for (let k = 0; k < this.total; k++) {
      const inner = k >= n;
      const a = this.rot + ((k % n) / n) * TAU + (inner ? Math.PI / n : 0);
      const r = inner ? R * 0.5 : R;
      this.na[k] = a; this.nx[k] = cos(a) * r; this.ny[k] = sin(a) * r;
      if (this.down[k] > 0 && --this.down[k] === 0) this.hp[k] = this.durability;
    }
    this.nodeDamage(w);
    // pulse cadence
    if (this.pulse) {
      const rate = (sh.laserPulseRateMul > 0 ? sh.laserPulseRateMul : 1) / cooldownFactor(w.stats);
      this.pulseT += TICK_DT * rate;
      if (this.pulseT >= this.pulseEvery) { this.pulseT -= this.pulseEvery; this.pulseLeft = this.pulseDur; }
    }
    const pulsing = this.pulseLeft > 0;
    if (pulsing) this.pulseLeft--;
    const width = this.width * (sh.laserWidthMul > 0 ? sh.laserWidthMul : 1) * (pulsing ? this.pulseW : 1);
    this.buildBeams(w, width);
    sh.laserBeamWidth = width;
    sh.laserElement = this.elN > 0 ? this.els[0] : 0;
    sh.laserInterior = n >= 3 ? R * cos(Math.PI / n) : 0;
    let live = 0;
    for (let k = 0; k < this.total; k++) if (this.down[k] === 0) { sh.laserNodes[live * 2] = this.nx[k]; sh.laserNodes[live * 2 + 1] = this.ny[k]; live++; }
    sh.laserNodeCount = live;
    if (tick % DMG_EVERY === 0) this.beamDamage(w, width, pulsing ? this.pulseD : 1);
    if (this.field > 0 && sh.laserInterior > 0) this.contain(w, sh.laserInterior);
    if (this.vertex) {
      this.vertexT += TICK_DT;
      if (this.vertexT >= this.vertexEvery) { this.vertexT -= this.vertexEvery; this.vertexBlast(w); }
    }
  }

  private geometry(w: World): void {
    if (this.dg > 0 && w.tick % 30 === 0) {
      const lo = this.R * (1 - this.dg), hi = this.R * (1 + this.dg);
      const buf = SCRATCH.push();
      const cnt = w.queryRadius(0, 0, hi + 20, buf);
      const bins = 8, width = (hi - lo) / bins;
      let best = -1, bestC = 0;
      const e = w.enemies;
      const hist = this.touched;   // reuse as a small histogram (cleared below)
      for (let b = 0; b < bins; b++) hist[b] = 0;
      for (let j = 0; j < cnt; j++) {
        const i = buf[j];
        const d = Math.sqrt(e.x[i] * e.x[i] + e.y[i] * e.y[i]);
        if (d < lo || d >= hi) continue;
        const b = Math.min(bins - 1, Math.floor((d - lo) / width));
        hist[b]++;
      }
      for (let b = 0; b < bins; b++) if (hist[b] > bestC) { bestC = hist[b]; best = b; }
      SCRATCH.pop();
      this.geoTarget = best >= 0 ? lo + (best + 0.5) * width : this.R;
    }
    const target = this.dg > 0 ? this.geoTarget : this.R;
    const step = 40 * TICK_DT;
    this.geomR += Math.max(-step, Math.min(step, target - this.geomR));
    if (this.crush) {
      this.crushT += TICK_DT;
      if (!this.crushing && this.crushT >= this.crushEvery) {
        this.crushing = true; this.crushT = 0;
        w.emit(Ev.Fx, 'laser.containment.crush', this.n, this.geomR, 0, 0, -1);
      } else if (this.crushing && this.crushT >= 1.5) { this.crushing = false; this.crushT = 0; }
      if (this.crushing && this.crushT < 1 && this.n >= 3) {
        const interior = this.radius() * cos(Math.PI / this.n);
        const buf = SCRATCH.push();
        const cnt = w.queryRadius(0, 0, interior, buf);
        for (let j = 0; j < cnt; j++) w.pull(buf[j], 0, 0, this.geomR * 0.5);
        SCRATCH.pop();
      }
    }
  }
  private geoTarget = 110;

  private nodeDamage(w: World): void {
    const buf = SCRATCH.push();
    for (let k = 0; k < this.total; k++) {
      if (this.down[k] > 0) continue;
      const cnt = w.queryRadius(this.nx[k], this.ny[k], NODE_R, buf);
      for (let j = 0; j < cnt; j++) { const i = buf[j]; if (w.alive(i)) this.hp[k] -= contactDps(w, i) * TICK_DT; }
    }
    SCRATCH.pop();
    const p = w.projectiles;
    for (let i = 0; i < p.count; i++) {
      if ((p.flags[i] & (ProjFlag.Hostile | ProjFlag.Dead)) !== ProjFlag.Hostile) continue;
      for (let k = 0; k < this.total; k++) {
        if (this.down[k] > 0) continue;
        const dx = p.x[i] - this.nx[k], dy = p.y[i] - this.ny[k], rr = NODE_R + p.radius[i];
        if (dx * dx + dy * dy > rr * rr) continue;
        this.hp[k] -= p.damage[i];
        w.freeProjectile(i);
        break;
      }
    }
    for (let k = 0; k < this.total; k++) {
      if (this.down[k] === 0 && this.hp[k] <= 0) {
        this.down[k] = this.rebuildT; this.hp[k] = 0;
        w.emit(Ev.Fx, 'laser.node_down', k, this.rebuildT, this.nx[k], this.ny[k], -1);
      }
    }
  }

  private buildBeams(w: World, width: number): void {
    const sh = w.shared, B = sh.laserBeams, e = w.enemies;
    const hw = width * 0.5;
    // refractors this tick
    this.refrN = 0;
    for (let i = 0; i < e.count && this.refrN < MAX_REFRACTORS; i++) if ((e.flags[i] & EnemyFlag.Dead) === 0 && isRefractor(w, i)) this.refr[this.refrN++] = i;
    let m = 0;
    const cap = Math.min(MAX_BEAMS, (B.length / 4) | 0);
    let bentAny = false;
    for (let q = 0; q < this.pairN && m < cap; q++) {
      const a = this.bA[q], b = this.bB[q];
      if (a >= this.total || b >= this.total || this.down[a] > 0 || this.down[b] > 0) continue;
      const ax = this.nx[a], ay = this.ny[a];
      let bx = this.nx[b], by = this.ny[b];
      // Refractor: the beam stops at the first refractor it touches
      let tMin = 2;
      for (let r = 0; r < this.refrN; r++) {
        const i = this.refr[r], rr = e.radius[i] + hw;
        if (segDist2(e.x[i], e.y[i], ax, ay, bx, by) > rr * rr) continue;
        const t = segParam(e.x[i], e.y[i], ax, ay, bx, by);
        if (t < tMin) tMin = t;
      }
      const cut = tMin <= 1;
      if (cut) { bx = ax + (bx - ax) * tMin; by = ay + (by - ay) * tMin; }
      let mul = 1;
      // wells (previous tick's gravitics): Lensing boosts, Bent Light bends through the center
      let bendWell = -1;
      for (let k = 0; k < sh.wellCount; k++) {
        const wx = sh.wells[k * 4], wy = sh.wells[k * 4 + 1], wr = sh.wells[k * 4 + 2];
        if (segDist2(wx, wy, ax, ay, bx, by) > wr * wr) continue;
        if (this.lens > 0) mul *= 1 + this.lens;
        if (bendWell < 0) bendWell = k;
      }
      const st = this.bStar[q];
      if (this.bent > 0 && bendWell >= 0 && !cut && m + 1 < cap) {
        const wx = sh.wells[bendWell * 4], wy = sh.wells[bendWell * 4 + 1];
        const t = segParam(wx, wy, ax, ay, bx, by);
        const qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t;
        const f = Math.min(1, this.bent * 3.3);   // rank 3 → fully through the center
        const cx = qx + (wx - qx) * f, cy = qy + (wy - qy) * f;
        const bm = mul * (1 + 0.05 * this.bentRank);
        B[m * 4] = ax; B[m * 4 + 1] = ay; B[m * 4 + 2] = cx; B[m * 4 + 3] = cy; this.bMul[m] = bm; this.bStarOut[m] = st; m++;
        B[m * 4] = cx; B[m * 4 + 1] = cy; B[m * 4 + 2] = bx; B[m * 4 + 3] = by; this.bMul[m] = bm; this.bStarOut[m] = st; m++;
        bentAny = true;
        continue;
      }
      B[m * 4] = ax; B[m * 4 + 1] = ay; B[m * 4 + 2] = bx; B[m * 4 + 3] = by; this.bMul[m] = mul; this.bStarOut[m] = st; m++;
    }
    // WP8 Ghost Edges: temporary chords between non-adjacent (opposite) outer nodes
    const ghosts = w.signals ? w.signals.ghostEdges | 0 : 0;
    if (ghosts > 0 && this.n >= 4) {
      const start = ((w.run.attemptTick / 300) | 0) % this.n, half = this.n >> 1;
      for (let g = 0; g < ghosts && g < this.n && m < cap; g++) {
        const a = (start + g) % this.n, b = (a + half) % this.n;
        if (this.down[a] > 0 || this.down[b] > 0) continue;
        B[m * 4] = this.nx[a]; B[m * 4 + 1] = this.ny[a]; B[m * 4 + 2] = this.nx[b]; B[m * 4 + 3] = this.ny[b];
        this.bMul[m] = 1; this.bStarOut[m] = 0; m++;
      }
    }
    this.beamN = m;
    sh.laserBeamCount = m;
    if (bentAny && w.tick - this.lastBentEmit >= 60) {
      this.lastBentEmit = w.tick;
      w.emit(Ev.Linkage, 'link.laser+gravitics', m, this.bentRank, 0, 0, -1);
    }
  }
  private bStarOut = new Uint8Array(MAX_BEAMS);

  private beamDamage(w: World, width: number, pulseMul: number): void {
    const B = w.shared.laserBeams, e = w.enemies;
    const buf = SCRATCH.push();
    let tn = 0;
    for (let b = 0; b < this.beamN; b++) {
      const cnt = querySegment(w, B[b * 4], B[b * 4 + 1], B[b * 4 + 2], B[b * 4 + 3], width * 0.5, buf);
      for (let j = 0; j < cnt; j++) {
        const i = buf[j];
        if (!targetableEnemy(w, i)) continue;
        if (this.cnt[i] === 0) { this.touched[tn++] = i; this.emul[i] = this.bMul[b]; this.estar[i] = 0; }
        else if (this.bMul[b] > this.emul[i]) this.emul[i] = this.bMul[b];
        if (this.bStarOut[b]) this.estar[i] = 1;
        if (this.cnt[i] < 255) this.cnt[i]++;
      }
    }
    SCRATCH.pop();
    const tick = w.tick;
    for (let t = 0; t < tn; t++) {
      const i = this.touched[t];
      const c = this.cnt[i];
      this.cnt[i] = 0;
      if (!w.alive(i)) continue;
      let dmg = this.dps * DMG_DT * c * pulseMul * this.emul[i];
      if (c >= 2) {
        if (this.overlap > 0) dmg *= 1 + this.overlap * (c - 1);
        if (this.star || this.mandala) dmg *= this.starMul;
        if (this.standing) {
          const prev = this.swLast[i] === tick - DMG_EVERY ? this.swT[i] : 0;
          const now = prev + DMG_DT;
          this.swT[i] = now;
          dmg *= 1 + Math.min(this.swCap, this.swPer * now);
          if (Math.floor(now) > Math.floor(prev)) w.emit(Ev.Fx, 'laser.resonance.standing_wave', i, now, e.x[i], e.y[i], -1);
        }
        this.swLast[i] = tick;
      }
      if (isRefractor(w, i)) dmg *= 0.3;
      const el = this.elN > 0 ? elementAt(this.els[(((tick / DMG_EVERY) | 0) + i) % this.elN]) : null;
      const h = w.damage(i, dmg, { source: 'laser', srcTag: 'laser', element: el, cause: -1 });
      if (c >= 2 && this.feedback > 0 && !h.killed && w.alive(i) && e.shockT[i] < 20) {
        w.applyStatus(i, 'shock', Math.max(1, Math.round(this.feedback / 0.05)), 60, 'laser', h.eventId);
      }
    }
  }

  private contain(w: World, interior: number): void {
    const buf = SCRATCH.push();
    const cnt = w.queryRadius(0, 0, interior, buf);
    const e = w.enemies, f = this.field;
    for (let j = 0; j < cnt; j++) { const i = buf[j]; if (e.fieldSlow[i] < f) e.fieldSlow[i] = f; }
    SCRATCH.pop();
  }

  private vertexBlast(w: World): void {
    const buf = SCRATCH.push();
    const el = this.elN > 0 ? elementAt(this.els[0]) : null;
    this.flashN = 0; this.flashTick = w.tick;
    for (let k = 0; k < this.total; k++) {
      if (this.down[k] > 0) continue;
      const a = this.na[k];
      const x0 = this.nx[k], y0 = this.ny[k], x1 = x0 + cos(a) * this.vertexLen, y1 = y0 + sin(a) * this.vertexLen;
      if (this.flashN < 32) { const o = this.flashN++ * 4; this.flash[o] = x0; this.flash[o + 1] = y0; this.flash[o + 2] = x1; this.flash[o + 3] = y1; }
      const cause = w.emit(Ev.Fx, 'laser.vertex_blast', k, 0, x0, y0, -1);
      const cnt = querySegment(w, x0, y0, x1, y1, 5, buf);
      for (let j = 0; j < cnt; j++) {
        const i = buf[j];
        if (!targetableEnemy(w, i)) continue;
        w.damage(i, this.dps * this.vertexDmg * (isRefractor(w, i) ? 0.3 : 1), { source: 'laser', srcTag: 'laser', element: el, cause });
      }
    }
    SCRATCH.pop();
  }

  onCompact(w: World, remap: Int32Array, oldCount: number): void {
    const n = w.enemies.count;
    remapArray(this.swT, remap, oldCount, n, 0);
    remapArray(this.swLast, remap, oldCount, n, -1000);
  }

  render(w: World, out: InstanceWriter): void {
    if (!this.on) return;
    const sh = w.shared, B = sh.laserBeams;
    const el = elementIndex(elementAt(sh.laserElement));
    const col = el > 0 ? ELEMENT_RGB[el - 1] : null;
    const r = col ? col[0] : 1, g = col ? col[1] : 0.4, b = col ? col[2] : 0.9;
    const hw = sh.laserBeamWidth * 0.5;
    for (let k = 0; k < sh.laserBeamCount; k++) out.push(B[k * 4], B[k * 4 + 1], hw, 0, Shape.Line, r, g, b, 0.85, 2, B[k * 4 + 2], B[k * 4 + 3]);
    for (let k = 0; k < this.total; k++) {
      if (this.down[k] > 0) out.push(this.nx[k], this.ny[k], 5, 0, Shape.Ring, 0.6, 0.6, 0.7, 0.4, 2);
      else out.push(this.nx[k], this.ny[k], 6, this.na[k], Shape.Hex, r, g, b, 1, 2, this.hp[k] / this.durability, 0);
    }
    if (w.tick - this.flashTick < 8) for (let f = 0; f < this.flashN; f++) {
      const o = f * 4;
      out.push(this.flash[o], this.flash[o + 1], 2.5, 0, Shape.Line, r, g, b, 1 - (w.tick - this.flashTick) / 8, 2, this.flash[o + 2], this.flash[o + 3]);
    }
  }
}
