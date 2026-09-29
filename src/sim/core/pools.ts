/**
 * Struct-of-arrays entity pools.
 *
 * Strategy: COMPACT pools with DEFERRED swap-remove.
 *  - Indices [0, count) are the pool's slots in use. A slot being "in use" does not mean the
 *    entity is alive for gameplay: killed/expired entities are only flagged (EnemyFlag.Dead /
 *    ProjFlag.Dead) and stay in place until the end of the tick, so every index handed out during
 *    a tick (HitInfo.enemy, event `a` fields, query results) stays valid for that whole tick.
 *    Systems iterating `0..count` must skip flagged entities (`world.alive(i)`).
 *  - At the end of the tick `compactEnemies` / `compactProjectiles` swap-remove the flagged slots
 *    in ASCENDING index order (each dead slot is filled by the current last live slot), which is
 *    fully deterministic. A remap table (old index -> new index, or -1) is produced so the World
 *    can repair every cached index (projectile targets, designations) and systems can do the
 *    same in `System.onCompact`.
 *  - `gen` is a globally unique serial per entity (never reused) that MOVES with the entity, so an
 *    EntityRef {index, gen} can be re-resolved after compaction (World.resolveEnemy).
 */
import type { EnemyPool, ProjectilePool } from './types';
import { EnemyFlag, ProjFlag, NO_ENTITY } from './types';

export function createEnemyPool(cap: number): EnemyPool {
  return {
    count: 0, capacity: cap,
    gen: new Uint32Array(cap), kind: new Uint8Array(cap),
    x: new Float32Array(cap), y: new Float32Array(cap), vx: new Float32Array(cap), vy: new Float32Array(cap),
    hp: new Float32Array(cap), maxHp: new Float32Array(cap), shield: new Float32Array(cap), maxShield: new Float32Array(cap),
    armor: new Float32Array(cap), radius: new Float32Array(cap), speed: new Float32Array(cap), angle: new Float32Array(cap),
    flags: new Uint32Array(cap), eliteMods: new Uint16Array(cap), bossId: new Int8Array(cap), bossPhase: new Uint8Array(cap),
    spawnTick: new Int32Array(cap), lastHitTick: new Int32Array(cap),
    burn: new Uint8Array(cap), burnT: new Uint16Array(cap), burnDps: new Float32Array(cap),
    poison: new Uint8Array(cap), poisonT: new Uint16Array(cap), poisonDps: new Float32Array(cap),
    chill: new Uint8Array(cap), chillT: new Uint16Array(cap),
    shock: new Uint8Array(cap), shockT: new Uint16Array(cap),
    bleed: new Uint8Array(cap), bleedT: new Uint16Array(cap),
    brittle: new Uint8Array(cap), brittleT: new Uint16Array(cap),
    markedT: new Uint16Array(cap), frozenT: new Uint16Array(cap), staggerT: new Uint16Array(cap),
    aiA: new Float32Array(cap), aiB: new Float32Array(cap), aiI: new Int32Array(cap),
    fx: new Float32Array(cap), fy: new Float32Array(cap),
    lastCause: new Int32Array(cap), clumpCount: new Uint16Array(cap),
    spawnIdx: new Int32Array(cap), formT: new Float32Array(cap), speedMul: new Float32Array(cap),
    attackT: new Uint16Array(cap), spawnEv: new Int32Array(cap), scrapMul: new Float32Array(cap), contact: new Float32Array(cap),
    burnCause: new Int32Array(cap), poisonCause: new Int32Array(cap), bleedCause: new Int32Array(cap),
    burnAcc: new Float32Array(cap), poisonAcc: new Float32Array(cap), bleedAcc: new Float32Array(cap),
    staticStacks: new Uint8Array(cap), staticT: new Uint16Array(cap), bleedDps: new Float32Array(cap),
  };
}

export function createProjectilePool(cap: number): ProjectilePool {
  return {
    count: 0, capacity: cap,
    gen: new Uint32Array(cap), kind: new Uint8Array(cap), source: new Uint8Array(cap),
    x: new Float32Array(cap), y: new Float32Array(cap), vx: new Float32Array(cap), vy: new Float32Array(cap),
    damage: new Float32Array(cap), radius: new Float32Array(cap), life: new Uint16Array(cap),
    pierce: new Uint8Array(cap), bounces: new Uint8Array(cap), target: new Int32Array(cap), targetGen: new Uint32Array(cap),
    flags: new Uint32Array(cap), element: new Uint8Array(cap), critChance: new Float32Array(cap), blast: new Float32Array(cap),
    cause: new Int32Array(cap), lastHit: new Int32Array(cap), hitMask: new Uint32Array(cap),
    tag: new Uint16Array(cap), critMul: new Float32Array(cap), retention: new Float32Array(cap), pierceSpeed: new Float32Array(cap),
    bounceRange: new Float32Array(cap), knock: new Float32Array(cap), execBonus: new Float32Array(cap), pierced: new Uint8Array(cap),
  };
}

/** Typed-array fields of a pool (everything except count/capacity), listed once for copy/reset. */
type ArrayFields<T> = { [K in keyof T]: T[K] extends ArrayLike<number> ? K : never }[keyof T];
function arrayKeys<T extends object>(pool: T): ArrayFields<T>[] {
  const keys: ArrayFields<T>[] = [];
  for (const k of Object.keys(pool) as (keyof T)[]) {
    const v = pool[k] as unknown;
    if (ArrayBuffer.isView(v)) keys.push(k as ArrayFields<T>);
  }
  return keys;   // insertion order of the literal above: deterministic
}
type NumArr = { [i: number]: number };
function copySlot(arrays: NumArr[], from: number, to: number): void {
  for (let k = 0; k < arrays.length; k++) arrays[k][to] = arrays[k][from];
}
function zeroSlot(arrays: NumArr[], i: number): void {
  for (let k = 0; k < arrays.length; k++) arrays[k][i] = 0;
}

let enemyArraysCache = new WeakMap<EnemyPool, NumArr[]>();
let projArraysCache = new WeakMap<ProjectilePool, NumArr[]>();
function enemyArrays(p: EnemyPool): NumArr[] {
  let a = enemyArraysCache.get(p);
  if (!a) { a = arrayKeys(p).map((k) => p[k] as unknown as NumArr); enemyArraysCache.set(p, a); }
  return a;
}
function projArrays(p: ProjectilePool): NumArr[] {
  let a = projArraysCache.get(p);
  if (!a) { a = arrayKeys(p).map((k) => p[k] as unknown as NumArr); projArraysCache.set(p, a); }
  return a;
}
/** For tests: drop cached array lists (pools are normally long-lived). */
export function resetPoolCaches(): void { enemyArraysCache = new WeakMap(); projArraysCache = new WeakMap(); }

/** Allocate an enemy slot at index `count` with every field zeroed; returns NO_ENTITY when full. */
export function allocEnemy(p: EnemyPool, gen: number): number {
  if (p.count >= p.capacity) return NO_ENTITY;
  const i = p.count++;
  zeroSlot(enemyArrays(p), i);
  p.gen[i] = gen >>> 0;
  p.bossId[i] = -1;
  p.spawnIdx[i] = -1;
  p.speedMul[i] = 1;
  p.clumpCount[i] = 1;
  p.lastCause[i] = -1; p.spawnEv[i] = -1; p.burnCause[i] = -1; p.poisonCause[i] = -1; p.bleedCause[i] = -1;
  p.aiI[i] = -1;
  return i;
}

/** Flag an enemy for removal at end of tick (idempotent). */
export function freeEnemy(p: EnemyPool, i: number): void {
  if (i >= 0 && i < p.count) p.flags[i] |= EnemyFlag.Dead;
}

export function allocProjectile(p: ProjectilePool, gen: number): number {
  if (p.count >= p.capacity) return NO_ENTITY;
  const i = p.count++;
  zeroSlot(projArrays(p), i);
  p.gen[i] = gen >>> 0;
  p.target[i] = NO_ENTITY; p.lastHit[i] = NO_ENTITY; p.cause[i] = -1;
  p.critMul[i] = 1.5; p.retention[i] = 1;
  return i;
}

export function freeProjectile(p: ProjectilePool, i: number): void {
  if (i >= 0 && i < p.count) p.flags[i] |= ProjFlag.Dead;
}

/**
 * Swap-remove every flagged slot. Writes remap[old] = new index (or -1 when freed) for old < count.
 * Returns the number of slots removed. Deterministic: dead slots are processed in ascending order and
 * each is filled from the highest live slot.
 */
export function compactEnemies(p: EnemyPool, remap: Int32Array): number {
  const n = p.count;
  for (let i = 0; i < n; i++) remap[i] = i;
  const arrays = enemyArrays(p);
  let last = n - 1;
  let removed = 0;
  for (let i = 0; i <= last; i++) {
    if ((p.flags[i] & EnemyFlag.Dead) === 0) continue;
    // find the highest live slot above i
    while (last > i && (p.flags[last] & EnemyFlag.Dead) !== 0) { remap[last] = -1; last--; removed++; }
    remap[i] = -1; removed++;
    if (last > i) { copySlot(arrays, last, i); remap[last] = i; last--; }
    else { last = i - 1; }
  }
  p.count = n - removed;
  return removed;
}

export function compactProjectiles(p: ProjectilePool, remap: Int32Array): number {
  const n = p.count;
  for (let i = 0; i < n; i++) remap[i] = i;
  const arrays = projArrays(p);
  let last = n - 1;
  let removed = 0;
  for (let i = 0; i <= last; i++) {
    if ((p.flags[i] & ProjFlag.Dead) === 0) continue;
    while (last > i && (p.flags[last] & ProjFlag.Dead) !== 0) { remap[last] = -1; last--; removed++; }
    remap[i] = -1; removed++;
    if (last > i) { copySlot(arrays, last, i); remap[last] = i; last--; }
    else { last = i - 1; }
  }
  p.count = n - removed;
  return removed;
}

/** Remove everything (attempt restart). */
export function clearEnemies(p: EnemyPool): void { p.count = 0; }
export function clearProjectiles(p: ProjectilePool): void { p.count = 0; }
