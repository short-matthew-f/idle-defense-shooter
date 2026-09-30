/**
 * Render snapshot writer (allocation-free after warmup; buffers grow geometrically if ever exceeded).
 * Draw order (design §20): 0 arena+tower, 1 hazards, 2 player fx, 3 projectiles, 4 enemies,
 * 5 enemy outlines, 6 threat halos, 7 ui-in-world. Renderer conventions (WP6 + graphics pass):
 *  - layer 4 (unflagged): exactly one body per live enemy; aux0 = hp fraction (bar drawn when 0 < aux0 < 0.999),
 *    aux1 = packed RStatus | phase | AnimKind | AnimRate (types.ts); the renderer animates it
 *  - flagged instances (layer + INST_FLAG_SCALE * InstFlag): composite parts (aux1 = body instance index),
 *    status marks, flashes, chain lines (see core/snapshot-art.ts, snapshot-fx.ts, render/frame-prep.ts)
 *  - layer 5: the enemy's own shape as outline; layer 6: the shape again, pulsed by the renderer
 *  - Line: (x,y)→(aux0,aux1), half-width = radius
 *  - Ring / Arc: aux0 = ring thickness as a fraction of the radius (0 = ~1.25 px)
 *  - layer 7 Ring with aux1 = RETICLE_MARK: the designation reticle around each live designated
 *    (tower.designated / designated2, gen-checked) or Hunter-marked enemy; app/overlay.ts enlarges these
 *
 * PRESENTATION ONLY. Nothing here writes sim state, draws from the sim PRNG or emits events: animation
 * phase comes from integer hashes of the entity generation, time from the tick and a snapshot frame
 * counter, and the per-enemy presentation state (hit-flash rate limiter, knockback wobble) lives in this
 * writer, keyed by pool index and validated by generation (tests/render/snapshot-purity.test.ts).
 */
import type { InstanceWriter } from './system';
import type { RenderSnapshot, SimEvent } from './types';
import { INSTANCE_FLOATS, FX_FLOATS, Shape, FxKind, Ev, EnemyFlag, ProjFlag, ARENA_RADIUS, TOWER_RADIUS, RETICLE_MARK, RStatus, MAX_ENEMIES } from './types';
import type { WorldImpl } from './world-impl';
import { enemyDefByIndex, bossDefByIndex, bossIndex, kindIndex, enemyDef, bossDef } from './content';
import { ROLE_CLONE } from '../enemies/behaviors/kinds';
import { atan2, sin } from '../math/lut';
import { STATUS_NAMES } from './events';
import { EnemyView, writeEnemy, atan2Approx } from './snapshot-art';
import { TowerView, writeTowerBase, writeTowerTop } from './snapshot-tower';
import { ChainLines, srcColor, PIP_DEPTH, SHAKE, PUNCH } from './snapshot-fx';

const MAX_FX = 1024;
const MIRROR_HIVE = bossIndex('mirror_hive');
const BOSS_ADD = kindIndex('boss_add');
const HALO_KIND = new Uint8Array(64);
for (const k of ['kamikaze', 'healer', 'warden', 'carrier']) HALO_KIND[kindIndex(k)] = 1;
const HEALER = kindIndex('healer');
const HALO_FLAGS = EnemyFlag.Kamikaze | EnemyFlag.Healer | EnemyFlag.Shielder | EnemyFlag.WeakPointOpen;
const SOURCE_COLORS: [number, number, number][] = [
  [1, 0.95, 0.7], [1, 0.6, 0.25], [0.45, 0.9, 1], [0.85, 0.85, 1], [1, 0.4, 0.9], [0.7, 0.5, 1],
];
const HOSTILE_COLOR: [number, number, number] = [1, 0.3, 0.3];
const WHITE: [number, number, number] = [1, 1, 1];
/** Designation reticle (layer 7): the designated outline's red, lifted a little so it reads over the outline. */
const RETICLE_COLOR: [number, number, number] = [1, 0.42, 0.42];
const RETICLE_GAP = 6;          // world units outside the body
const RETICLE_THICKNESS = 0.12; // fraction of the ring radius
const ELEMENT_COLORS: [number, number, number][] = [[1, 0.5, 0.15], [0.6, 0.8, 1], [0.5, 1, 0.3], [0.7, 0.95, 1]];
const HAZARD_COLORS: Record<string, [number, number, number]> = {
  fire_zone: [1, 0.45, 0.1], firestorm: [1, 0.35, 0.05], toxic_cloud: [0.45, 1, 0.25], ice_patch: [0.6, 0.9, 1],
  plasma_line: [0.9, 0.6, 1], shell_zone: [1, 0.7, 0.3], enemy_hazard: [1, 0.2, 0.2], time_field: [0.6, 0.7, 1], barrier_field: [0.5, 0.8, 1],
};

/** Composite silhouettes drop to base shapes above this many live enemies (hysteresis below LOD_OFF). */
export const LOD_ON = 600;
export const LOD_OFF = 540;
/** Hit flash: at most one flash per enemy every FLASH_GAP snapshot frames (≤ 3 Hz), lasting FLASH_LEN frames. */
export const FLASH_GAP = 20;
export const FLASH_LEN = 6;
const KNOCK_MIN = 4;          // outward jump (units per frame) read as knockback
const KNOCK_LEN = 12;
const MAX_HEALER_PULSES = 16;
const MAX_CHAIN_OFFERS = 400;
const MAX_PICKUPS = 12;

/** Animation phase 0..63 from an entity generation (integer hash; never the sim PRNG). */
export function animPhase(gen: number): number { return Math.imul(gen ^ 0x5bd1e995, 0x9e3779b1) >>> 26; }

/** LOD with hysteresis: composites off above LOD_ON enemies, back on below LOD_OFF. */
export function lodFor(prev: boolean, enemies: number): boolean { return prev ? enemies >= LOD_OFF : enemies > LOD_ON; }

/** Hit-flash intensity for a flash that started `age` frames ago (1 → 0 over FLASH_LEN). */
export function flashAt(age: number): number { return age >= 0 && age < FLASH_LEN ? 1 - age / FLASH_LEN : 0; }

/** May a new hit start a flash `sinceLast` frames after the previous flash began? (≤ 3 Hz at 60 fps) */
export function flashAllowed(sinceLast: number): boolean { return sinceLast >= FLASH_GAP; }

export class SnapshotWriter implements InstanceWriter {
  instances = new Float32Array(INSTANCE_FLOATS * 8192);
  count = 0;
  fxBuf = new Float32Array(FX_FLOATS * MAX_FX);
  fxCount = 0;
  // ---- graphics pass: presentation state (never read by the sim)
  /** Snapshot frames written so far (animation clock that does not speed up at ×8). */
  frame = 0;
  lod = false;
  readonly chains = new ChainLines();
  readonly view = new EnemyView();
  readonly towerView = new TowerView();
  /** 0..1 muzzle flash / recoil of the primary. */
  firing = 0;
  private readonly stGen = new Uint32Array(MAX_ENEMIES);
  private readonly stOn = new Uint8Array(MAX_ENEMIES);
  private readonly seenHit = new Int32Array(MAX_ENEMIES);
  private readonly flashStart = new Int32Array(MAX_ENEMIES);
  private readonly prevD = new Float32Array(MAX_ENEMIES);
  private readonly knockStart = new Int32Array(MAX_ENEMIES);
  private readonly knockAmp = new Float32Array(MAX_ENEMIES);

  reset(): void { this.count = 0; this.fxCount = 0; }

  push(x: number, y: number, radius: number, rot: number, shape: number, r: number, g: number, b: number, a: number, layer: number, aux0 = 0, aux1 = 0): void {
    let o = this.count * INSTANCE_FLOATS;
    if (o + INSTANCE_FLOATS > this.instances.length) {
      const g2 = new Float32Array(this.instances.length * 2); g2.set(this.instances); this.instances = g2;
    }
    const d = this.instances;
    d[o++] = x; d[o++] = y; d[o++] = radius; d[o++] = rot; d[o++] = shape; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = a; d[o++] = layer; d[o++] = aux0; d[o] = aux1;
    this.count++;
  }

  fx(kind: number, x: number, y: number, r: number, g: number, b: number, size: number, count: number): void {
    if (this.fxCount >= MAX_FX) return;
    let o = this.fxCount * FX_FLOATS;
    const d = this.fxBuf;
    d[o++] = kind; d[o++] = x; d[o++] = y; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = size; d[o] = count;
    this.fxCount++;
  }

  /** Per-enemy presentation state for pool slot i (flash / squash / knockback wobble) into `v`. */
  trackEnemy(i: number, gen: number, lastHit: number, dist: number, v: EnemyView): void {
    const f = this.frame;
    if (i >= this.stOn.length) { v.flash = 0; v.squash = 0; v.wobble = 0; return; }
    if (!this.stOn[i] || this.stGen[i] !== gen) {
      this.stOn[i] = 1; this.stGen[i] = gen; this.seenHit[i] = lastHit; this.flashStart[i] = -1000;
      this.prevD[i] = dist; this.knockStart[i] = -1000; this.knockAmp[i] = 0;
    } else {
      if (lastHit > this.seenHit[i]) {
        this.seenHit[i] = lastHit;
        if (flashAllowed(f - this.flashStart[i])) this.flashStart[i] = f;
      }
      const out = dist - this.prevD[i];
      if (out > KNOCK_MIN && f - this.knockStart[i] > 6) { this.knockStart[i] = f; this.knockAmp[i] = out > 16 ? 1 : out / 16; }
      this.prevD[i] = dist;
    }
    const fl = flashAt(f - this.flashStart[i]);
    v.flash = fl; v.squash = fl;
    const ka = f - this.knockStart[i];
    v.wobble = ka < KNOCK_LEN ? this.knockAmp[i] * 0.5 * sin(ka * 1.1) * (1 - ka / KNOCK_LEN) : 0;
  }
}

let sparks = 0, kills = 0, pickups = 0, offers = 0, shake = 0;
let W: WorldImpl | null = null;
let OUT: SnapshotWriter | null = null;

/** Write the whole scene for the current tick. `fromEvent` = first event id not yet turned into fx. */
export function writeScene(w: WorldImpl, out: SnapshotWriter, fromEvent: number, clarity: number, cameraShake: number): RenderSnapshot {
  out.reset();
  out.frame++;
  const t = w.tower, tick = w.run.tick;
  // layer 0: arena + tower
  out.push(0, 0, ARENA_RADIUS, 0, Shape.Ring, 0.3, 0.36, 0.48, 0.45, 0);
  // projectiles first pass: is the primary firing right now? (a fresh round near the muzzle)
  const p = w.projectiles;
  let fresh = false;
  for (let i = 0; i < p.count && !fresh; i++) {
    if (p.source[i] !== 0 || (p.flags[i] & (ProjFlag.Hostile | ProjFlag.Dead))) continue;
    const d2 = p.x[i] * p.x[i] + p.y[i] * p.y[i];
    if (d2 < (TOWER_RADIUS * 2.4) * (TOWER_RADIUS * 2.4)) fresh = true;
  }
  out.firing = fresh ? 1 : out.firing * 0.55;
  const tv = out.towerView;
  tv.frame = w.build.frame; tv.hardpoints = w.build.hardpoints; tv.attunements = w.build.attunements;
  tv.deepest = Math.max(w.run.deepestCleared, w.run.wave - 1);
  tv.hpFrac = t.maxHp > 0 ? t.hp / t.maxHp : 0;
  tv.shieldFrac = t.shield > 0 && t.maxShield > 0 ? t.shield / t.maxShield : 0;
  tv.barrierFrac = t.barrier > 0 && t.maxBarrier > 0 ? t.barrier / t.maxBarrier : 0;
  tv.tempHp = t.tempHp > 0; tv.aim = t.aimAngle; tv.firing = out.firing; tv.tick = tick;
  tv.dronesOut = w.shared.droneCount;
  tv.boons = w.build.boons ? w.build.boons.length : 0;
  tv.range = Math.min(ARENA_RADIUS, w.stats.get('ballistics.range'));
  writeTowerBase(out, tv);
  // layer 1: hazards
  for (const h of w.hazards) {
    const c = h.element ? ELEMENT_COLORS[['fire', 'lightning', 'poison', 'frost'].indexOf(h.element)] ?? HAZARD_COLORS[h.kind] : HAZARD_COLORS[h.kind];
    const col = c ?? WHITE;
    if (h.x2 !== undefined && h.y2 !== undefined) out.push(h.x, h.y, h.radius, 0, Shape.Line, col[0], col[1], col[2], 0.5, 1, h.x2, h.y2);
    else out.push(h.x, h.y, h.radius, 0, Shape.Circle, col[0], col[1], col[2], 0.28, 1);
  }
  // layer 3: projectiles
  for (let i = 0; i < p.count; i++) {
    const f = p.flags[i];
    if (f & ProjFlag.Dead) continue;
    const rot = atan2(p.vy[i], p.vx[i]);
    let c = SOURCE_COLORS[p.source[i]] ?? SOURCE_COLORS[0];
    if (f & ProjFlag.Hostile) c = HOSTILE_COLOR;
    else if (p.element[i] > 0) c = ELEMENT_COLORS[p.element[i] - 1];
    const shape = (f & ProjFlag.Hostile) ? Shape.Diamond : p.blast[i] > 0 ? Shape.Triangle : Shape.Capsule;
    out.push(p.x[i], p.y[i], p.radius[i], rot, shape, c[0], c[1], c[2], 1, 3, (f & ProjFlag.Crit) ? 1 : 0, 0);
  }
  // layers 4–6: enemies (body, composite parts, statuses, outline, halo, telegraphs)
  writeEnemies(w, out);
  // layer 7: designation reticle (UX review S1), so the UI never has to infer designation from outline colours
  const e = w.enemies;
  const d1 = t.designated >= 0 && t.designated < e.count && e.gen[t.designated] === t.designatedGen ? t.designated : -1;
  const d2 = t.designated2 >= 0 && t.designated2 < e.count && e.gen[t.designated2] === t.designated2Gen ? t.designated2 : -1;
  for (let i = 0; i < e.count; i++) {
    if (e.flags[i] & EnemyFlag.Dead) continue;
    if (i !== d1 && i !== d2 && e.markedT[i] === 0) continue;
    const c = RETICLE_COLOR;
    out.push(e.x[i], e.y[i], e.radius[i] + RETICLE_GAP, 0, Shape.Ring, c[0], c[1], c[2], 0.95, 7, RETICLE_THICKNESS, RETICLE_MARK);
  }
  // system visuals
  for (const s of w.systems) s.render?.(w, out);
  // the primary's housing, recoil and muzzle flash sit over the ballistics barrel line
  writeTowerTop(out, tv);
  // fx and chain links from events
  sparks = 0; kills = 0; pickups = 0; offers = 0; shake = 0;
  W = w; OUT = out;
  w.events.forEachSince(fromEvent, onEvent);
  W = null; OUT = null;
  if (shake > 0) out.fx(FxKind.Shake, 0, 0, 1, 1, 1, shake, 1);
  out.chains.write(out, out.frame);
  return { tick: w.run.tick, instances: out.instances, instanceCount: out.count, fx: out.fxBuf, fxCount: out.fxCount, cameraShake, clarity };
}

function writeEnemies(w: WorldImpl, out: SnapshotWriter): void {
  const e = w.enemies, t = w.tower, v = out.view, tick = w.run.tick;
  out.lod = lodFor(out.lod, e.count);
  const tell = w.bossTell;
  let pulses = 0;
  for (let i = 0; i < e.count; i++) {
    const f = e.flags[i];
    if (f & EnemyFlag.Dead) continue;
    const boss = (f & EnemyFlag.Boss) !== 0 || e.bossId[i] >= 0;   // WP5: boss clones (bossId >= 0) share the boss look
    const kind = e.kind[i];
    const x = e.x[i], y = e.y[i];
    const dist = Math.sqrt(x * x + y * y);
    v.x = x; v.y = y; v.r = e.radius[i]; v.kind = kind; v.flags = f; v.eliteMods = e.eliteMods[i];
    v.gen = e.gen[i]; v.tick = tick; v.dist = dist; v.lod = out.lod;
    v.aiI = e.aiI[i]; v.aiA = e.aiA[i]; v.aiB = e.aiB[i]; v.attackT = e.attackT[i];
    const vx = e.vx[i], vy = e.vy[i];
    v.facing = vx * vx + vy * vy > 16 ? atan2Approx(vy, vx) : atan2Approx(-y, -x);
    if (boss) {
      const b = bossDefByIndex(e.bossId[i], w.run.wave);
      v.shape = b.shape; v.cr = b.color[0]; v.cg = b.color[1]; v.cb = b.color[2];
      v.bossId = e.bossId[i]; v.bossDef = b; v.bossPhase = e.bossPhase[i];
      v.tell = tell.ability !== null && tell.bossIndex === i && tell.ticksLeft > 0
        ? 1 - tell.ticksLeft / Math.max(1, Math.round(b.tell.windowSeconds * 60)) : -1;
    } else {
      const d = enemyDefByIndex(kind);
      v.shape = d.shape; v.cr = d.color[0]; v.cg = d.color[1]; v.cb = d.color[2];
      v.bossId = -1; v.bossDef = null; v.bossPhase = 0; v.tell = -1;
    }
    v.alpha = (f & EnemyFlag.Phased) ? 0.45 : 1;
    let frac = e.maxHp[i] > 0 ? e.hp[i] / e.maxHp[i] : 1;
    // Mirror Hive: its clones (boss_add, clone role, bossId set) and the true boss draw no HP bar,
    // so bars never give the real one away (the HUD boss bar still shows the true HP).
    if (e.bossId[i] >= 0 && e.bossId[i] === MIRROR_HIVE) frac = 0;
    else if (kind === BOSS_ADD && e.bossId[i] >= 0 && e.aiB[i] === ROLE_CLONE) frac = 0;
    v.hp = frac;
    // statuses (shape + motion on the body; see RStatus)
    let st = 0;
    if (e.burn[i] > 0) st |= RStatus.Burn;
    if (e.chill[i] > 0) st |= RStatus.Chill;
    if (e.frozenT[i] > 0) st |= RStatus.Frozen;
    if (e.poison[i] > 0) st |= RStatus.Poison;
    if (e.shock[i] > 0 || e.staticStacks[i] > 0) st |= RStatus.Shock;
    if (e.bleed[i] > 0) st |= RStatus.Bleed;
    if (e.brittle[i] > 0) st |= RStatus.Brittle;
    if (e.markedT[i] > 0) st |= RStatus.Marked;
    v.status = st; v.frozen = e.frozenT[i] > 0; v.chilled = e.chill[i] > 0;
    v.phase = animPhase(v.gen);
    v.spawnAge = tick - e.spawnTick[i];
    v.shieldFrac = e.maxShield[i] > 0 ? e.shield[i] / e.maxShield[i] : 0;
    v.clump = e.clumpCount[i];
    out.trackEnemy(i, v.gen, e.lastHitTick[i], dist, v);
    // outline colour (unchanged rules)
    let r = 0.05, g = 0.05, b = 0.08, a = 1;
    if (boss) { r = 1; g = 1; b = 1; }
    else if (f & EnemyFlag.Elite) { r = 1; g = 0.84; b = 0.36; }
    else if (e.frozenT[i] > 0) { r = 0.7; g = 0.95; b = 1; }
    else if (e.markedT[i] > 0 || i === t.designated || i === t.designated2) { r = 1; g = 0.3; b = 0.3; }
    if (e.shield[i] > 0) { r = 0.5; g = 0.8; b = 1; a = 1; }
    v.or = r; v.og = g; v.ob = b; v.oa = a;
    v.halo = (f & HALO_FLAGS) !== 0 || HALO_KIND[kind] === 1;
    v.allowPulse = kind === HEALER ? pulses++ < MAX_HEALER_PULSES : true;
    writeEnemy(out, v);
  }
}

/** Event → fx / chain-link mapping (a module-level callback: forEachSince allocates no closure per frame). */
function onEvent(ev: SimEvent): void {
  const w = W!, out = OUT!;
  switch (ev.type) {
    case Ev.Hit: {
      if (sparks++ < 512) { const c = srcColor(ev.src); out.fx(FxKind.Spark, ev.x, ev.y, 0.5 + 0.5 * c[0], 0.5 + 0.5 * c[1], 0.45 + 0.4 * c[2], 3, 3); }
      break;
    }
    case Ev.Kill: {
      const data = ev.data;
      const kind = data && typeof data.kind === 'string' ? data.kind : 'grunt';
      const isBoss = !!(data && data.boss);
      const def = isBoss ? bossDef(typeof data?.bossId === 'string' ? data.bossId : null, w.run.wave) : enemyDef(kind);
      const r = def.radius;
      const kc = srcColor(ev.src);
      const body = def.color;
      out.fx(FxKind.Kill, ev.x, ev.y, kc[0], kc[1], kc[2], Math.max(8, r * 1.1), Math.min(16, 5 + r * 0.45));
      out.fx(FxKind.Shatter, ev.x, ev.y, body[0], body[1], body[2], r, Math.min(isBoss ? 28 : 12, 3 + r * 0.35));
      const depth = w.events.depthOf(ev.id);
      if (depth >= PIP_DEPTH) out.fx(FxKind.ChainPips, ev.x, ev.y - r - 7, 1, 0.84, 0.36, 3, Math.min(depth, 8));
      if (++kills % 3 === 1 && pickups++ < MAX_PICKUPS) out.fx(FxKind.Pickup, ev.x, ev.y, 1, 0.82, 0.3, 2.6, 1 + (r > 12 ? 1 : 0));
      break;
    }
    case Ev.Explosion: {
      out.fx(FxKind.Explosion, ev.x, ev.y, 1, 0.6, 0.25, Math.max(8, ev.a), 20);
      const s = ev.src === 'enemy' && ev.x * ev.x + ev.y * ev.y < 160 * 160 ? SHAKE.enemyBlast : Math.min(SHAKE.explosionMax, (ev.a / 100) * SHAKE.explosionPer100);
      if (s > shake) shake = s;
      break;
    }
    case Ev.StatusApply: {
      const st = STATUS_NAMES[(ev.c ?? 0) & 0xff];
      if (st === 'burn') out.fx(FxKind.Ember, ev.x, ev.y, 1, 0.5, 0.15, 6, 4);
      else if (st === 'shock' || st === 'static') out.fx(FxKind.Arc, ev.x, ev.y, 0.6, 0.8, 1, 6, 3);
      else if (st === 'poison') out.fx(FxKind.Toxic, ev.x, ev.y, 0.5, 1, 0.3, 6, 4);
      else if (st === 'chill' || st === 'frozen') out.fx(FxKind.Frost, ev.x, ev.y, 0.7, 0.95, 1, 6, 4);
      break;
    }
    case Ev.TowerHit: out.fx(FxKind.Hit, 0, 0, 1, 0.3, 0.3, TOWER_RADIUS, 6); break;
    case Ev.BossPhase:
      out.fx(FxKind.Shockwave, ev.x, ev.y, 1, 0.9, 0.7, 170, 1);
      if (SHAKE.bossPhase > shake) shake = SHAKE.bossPhase;
      break;
    case Ev.BossKilled:
      out.fx(FxKind.Punch, ev.x, ev.y, 1, 0.85, 0.5, PUNCH.bossKilled, 1);
      out.fx(FxKind.Shockwave, ev.x, ev.y, 1, 0.95, 0.8, 260, 1);
      if (SHAKE.bossKilled > shake) shake = SHAKE.bossKilled;
      break;
    case Ev.CounterScored:
      out.fx(FxKind.Punch, ev.x, ev.y, 1, 0.95, 0.4, PUNCH.counter, 1);
      out.fx(FxKind.SlowMo, ev.x, ev.y, 1, 1, 1, 1, 1);
      break;
    case Ev.Prestige: out.fx(FxKind.Punch, 0, 0, 0.8, 0.6, 1, PUNCH.prestige, 1); break;
    case Ev.CoreDrop: out.fx(FxKind.PickupCore, ev.x, ev.y, 0.75, 0.55, 1, 4.5, Math.max(1, Math.min(4, ev.a))); break;
    // Active edge (systems/active.ts): assist muzzle flash + hit, salvage pickup motes, Overcharge release
    case Ev.Assist: {
      const d = Math.sqrt(ev.x * ev.x + ev.y * ev.y) || 1, k = (TOWER_RADIUS * 1.45) / d;
      out.fx(FxKind.Muzzle, ev.x * k, ev.y * k, 1, 0.92, 0.6, 7, 3);
      out.fx(FxKind.Hit, ev.x, ev.y, 1, 0.9, 0.55, 10, 7);
      break;
    }
    case Ev.SalvageDrop: out.fx(FxKind.Spark, ev.x, ev.y, 1, 0.85, 0.4, 3, 4); break;
    case Ev.SalvageCollect:
      if (ev.src === 'salvage.tap') {
        out.fx(FxKind.Pickup, ev.x, ev.y, 1, 0.85, 0.35, 3.2, 3);
        out.fx(FxKind.Shockwave, ev.x, ev.y, 1, 0.9, 0.5, 26 + 6 * Math.min(4, ev.b), 1);
      } else out.fx(FxKind.Pickup, ev.x, ev.y, 1, 0.8, 0.35, 2.4, 1);
      break;
    case Ev.Overcharge:
      out.fx(FxKind.Shockwave, 0, 0, 1, 0.85, 0.4, ev.a ? 120 : 70, 1);
      out.fx(FxKind.Muzzle, ev.x * 0.06, ev.y * 0.06, 1, 0.9, 0.5, ev.a ? 16 : 10, 6);
      if (ev.a) out.fx(FxKind.Punch, 0, 0, 1, 0.85, 0.4, PUNCH.counter * 0.6, 1);
      break;
    case Ev.BarrierBreak:
      out.fx(FxKind.Shockwave, 0, 0, 0.55, 0.85, 1, 90, 1);
      if (SHAKE.barrierBreak > shake) shake = SHAKE.barrierBreak;
      break;
    default: break;
  }
  if (ev.cause >= 0 && offers < MAX_CHAIN_OFFERS) {
    const log = w.events;
    const d = log.depthOf(ev.id);
    if (d >= 2) {
      offers++;
      out.chains.offer(ev, log.byId(ev.cause), d, log.depthOf(ev.cause), out.frame);
    }
  }
}
