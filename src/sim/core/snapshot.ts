/**
 * Render snapshot writer (allocation-free after warmup; buffers grow geometrically if ever exceeded).
 * Draw order (design §20): 0 arena+tower, 1 hazards, 2 player fx, 3 projectiles, 4 enemies,
 * 5 enemy outlines, 6 threat halos, 7 ui-in-world. Renderer conventions (WP6):
 *  - layer 4: aux0 = hp fraction (bar drawn when 0 < aux0 < 0.999), aux1 = StateBit mask (status icons)
 *  - layer 5: the enemy's own shape as outline; layer 6: the shape again, pulsed by the renderer
 *  - Line: (x,y)→(aux0,aux1), half-width = radius
 */
import type { InstanceWriter } from './system';
import type { RenderSnapshot } from './types';
import { INSTANCE_FLOATS, FX_FLOATS, Shape, FxKind, Ev, EnemyFlag, ProjFlag, ARENA_RADIUS, TOWER_RADIUS } from './types';
import type { WorldImpl } from './world-impl';
import { enemyDefByIndex, bossDefByIndex, KIND_LIST } from './content';
import { atan2 } from '../math/lut';
import { STATUS_NAMES } from './events';

const MAX_FX = 1024;
const HALO_KINDS = new Set(['kamikaze', 'healer', 'warden', 'carrier']);
const HALO_FLAGS = EnemyFlag.Kamikaze | EnemyFlag.Healer | EnemyFlag.Shielder | EnemyFlag.WeakPointOpen;
const SOURCE_COLORS: [number, number, number][] = [
  [1, 0.95, 0.7], [1, 0.6, 0.25], [0.45, 0.9, 1], [0.85, 0.85, 1], [1, 0.4, 0.9], [0.7, 0.5, 1],
];
const HOSTILE_COLOR: [number, number, number] = [1, 0.3, 0.3];
const WHITE: [number, number, number] = [1, 1, 1];
const ELEMENT_COLORS: [number, number, number][] = [[1, 0.5, 0.15], [0.6, 0.8, 1], [0.5, 1, 0.3], [0.7, 0.95, 1]];
const HAZARD_COLORS: Record<string, [number, number, number]> = {
  fire_zone: [1, 0.45, 0.1], firestorm: [1, 0.35, 0.05], toxic_cloud: [0.45, 1, 0.25], ice_patch: [0.6, 0.9, 1],
  plasma_line: [0.9, 0.6, 1], shell_zone: [1, 0.7, 0.3], enemy_hazard: [1, 0.2, 0.2], time_field: [0.6, 0.7, 1], barrier_field: [0.5, 0.8, 1],
};

export class SnapshotWriter implements InstanceWriter {
  instances = new Float32Array(INSTANCE_FLOATS * 8192);
  count = 0;
  fxBuf = new Float32Array(FX_FLOATS * MAX_FX);
  fxCount = 0;

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
}

/** Write the whole scene for the current tick. `fromEvent` = first event id not yet turned into fx. */
export function writeScene(w: WorldImpl, out: SnapshotWriter, fromEvent: number, clarity: number, shake: number): RenderSnapshot {
  out.reset();
  const t = w.tower;
  // layer 0: arena + tower
  out.push(0, 0, ARENA_RADIUS, 0, Shape.Ring, 0.3, 0.36, 0.48, 0.45, 0);
  const hpF = t.maxHp > 0 ? t.hp / t.maxHp : 0;
  out.push(0, 0, TOWER_RADIUS, 0, Shape.Hex, 0.78, 0.88, 1, 1, 0, hpF, 0);
  if (t.shield > 0) out.push(0, 0, TOWER_RADIUS + 6, 0, Shape.Ring, 0.45, 0.8, 1, 0.3 + 0.5 * (t.maxShield > 0 ? t.shield / t.maxShield : 0), 0);
  if (t.barrier > 0) out.push(0, 0, 70, 0, Shape.Ring, 0.55, 0.85, 1, 0.25 + 0.4 * (t.maxBarrier > 0 ? t.barrier / t.maxBarrier : 0), 0);
  // layer 1: hazards
  for (const h of w.hazards) {
    const c = h.element ? ELEMENT_COLORS[['fire', 'lightning', 'poison', 'frost'].indexOf(h.element)] ?? HAZARD_COLORS[h.kind] : HAZARD_COLORS[h.kind];
    const col = c ?? WHITE;
    if (h.x2 !== undefined && h.y2 !== undefined) out.push(h.x, h.y, h.radius, 0, Shape.Line, col[0], col[1], col[2], 0.5, 1, h.x2, h.y2);
    else out.push(h.x, h.y, h.radius, 0, Shape.Circle, col[0], col[1], col[2], 0.28, 1);
  }
  // layer 3: projectiles
  const p = w.projectiles;
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
  // layers 4–6: enemies, outlines, halos
  const e = w.enemies;
  for (let i = 0; i < e.count; i++) {
    const f = e.flags[i];
    if (f & EnemyFlag.Dead) continue;
    let shape: number, col: [number, number, number];
    if (f & EnemyFlag.Boss) { const b = bossDefByIndex(e.bossId[i], w.run.wave); shape = b.shape; col = b.color; }
    else { const d = enemyDefByIndex(e.kind[i]); shape = d.shape; col = d.color; }
    const frac = e.maxHp[i] > 0 ? e.hp[i] / e.maxHp[i] : 1;
    out.push(e.x[i], e.y[i], e.radius[i], e.angle[i], shape, col[0], col[1], col[2], (f & EnemyFlag.Phased) ? 0.45 : 1, 4, frac, w.stateBits(i));
  }
  for (let i = 0; i < e.count; i++) {
    const f = e.flags[i];
    if (f & EnemyFlag.Dead) continue;
    const shape = (f & EnemyFlag.Boss) ? bossDefByIndex(e.bossId[i], w.run.wave).shape : enemyDefByIndex(e.kind[i]).shape;
    let r = 0.05, g = 0.05, b = 0.08, a = 0.85;
    if (f & EnemyFlag.Boss) { r = 1; g = 1; b = 1; }
    else if (f & EnemyFlag.Elite) { r = 1; g = 0.84; b = 0.36; }
    else if (e.frozenT[i] > 0) { r = 0.7; g = 0.95; b = 1; }
    else if (e.markedT[i] > 0 || i === t.designated || i === t.designated2) { r = 1; g = 0.3; b = 0.3; }
    if (e.shield[i] > 0) { r = 0.5; g = 0.8; b = 1; a = 1; }
    out.push(e.x[i], e.y[i], e.radius[i] + 2, e.angle[i], shape, r, g, b, a, 5);
  }
  for (let i = 0; i < e.count; i++) {
    const f = e.flags[i];
    if (f & EnemyFlag.Dead) continue;
    if ((f & HALO_FLAGS) === 0 && !HALO_KINDS.has(KIND_LIST[e.kind[i]])) continue;
    const shape = (f & EnemyFlag.Boss) ? bossDefByIndex(e.bossId[i], w.run.wave).shape : enemyDefByIndex(e.kind[i]).shape;
    const weak = (f & EnemyFlag.WeakPointOpen) !== 0;
    out.push(e.x[i], e.y[i], e.radius[i] * 1.8, e.angle[i], shape, 1, weak ? 0.9 : 0.25, weak ? 0.2 : 0.2, 0.6, 6);
  }
  // system visuals
  for (const s of w.systems) s.render?.(w, out);
  // fx from events
  let sparks = 0;
  w.events.forEachSince(fromEvent, (ev) => {
    switch (ev.type) {
      case Ev.Hit: if (sparks++ < 512) out.fx(FxKind.Spark, ev.x, ev.y, 1, 0.95, 0.8, 3, 3); break;
      case Ev.Kill: out.fx(FxKind.Kill, ev.x, ev.y, 1, 0.75, 0.3, 10, 12); break;
      case Ev.Explosion: out.fx(FxKind.Explosion, ev.x, ev.y, 1, 0.6, 0.25, Math.max(8, ev.a), 20); break;
      case Ev.StatusApply: {
        const st = STATUS_NAMES[(ev.c ?? 0) & 0xff];
        if (st === 'burn') out.fx(FxKind.Ember, ev.x, ev.y, 1, 0.5, 0.15, 6, 4);
        else if (st === 'shock' || st === 'static') out.fx(FxKind.Arc, ev.x, ev.y, 0.6, 0.8, 1, 6, 3);
        else if (st === 'poison') out.fx(FxKind.Toxic, ev.x, ev.y, 0.5, 1, 0.3, 6, 4);
        else if (st === 'chill' || st === 'frozen') out.fx(FxKind.Frost, ev.x, ev.y, 0.7, 0.95, 1, 6, 4);
        break;
      }
      case Ev.TowerHit: out.fx(FxKind.Hit, 0, 0, 1, 0.3, 0.3, TOWER_RADIUS, 6); break;
      default: break;
    }
  });
  return { tick: w.run.tick, instances: out.instances, instanceCount: out.count, fx: out.fxBuf, fxCount: out.fxCount, cameraShake: shake, clarity };
}
