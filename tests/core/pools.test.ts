import { describe, it, expect } from 'vitest';
import { createEnemyPool, createProjectilePool, allocEnemy, freeEnemy, compactEnemies, allocProjectile, freeProjectile, compactProjectiles } from '../../src/sim/core/pools';
import { EnemyFlag, NO_ENTITY } from '../../src/sim/core/types';

describe('pools', () => {
  it('allocates every typed array at capacity', () => {
    const p = createEnemyPool(16);
    for (const [k, v] of Object.entries(p)) if (ArrayBuffer.isView(v)) expect((v as unknown as ArrayLike<number>).length, k).toBe(16);
    const q = createProjectilePool(8);
    for (const [k, v] of Object.entries(q)) if (ArrayBuffer.isView(v)) expect((v as unknown as ArrayLike<number>).length, k).toBe(8);
  });

  it('alloc returns ascending indices, zeroes slots and refuses past capacity', () => {
    const p = createEnemyPool(3);
    expect([allocEnemy(p, 1), allocEnemy(p, 2), allocEnemy(p, 3)]).toEqual([0, 1, 2]);
    expect(allocEnemy(p, 4)).toBe(NO_ENTITY);
    expect(p.count).toBe(3);
    expect(p.bossId[0]).toBe(-1);
    expect(p.spawnIdx[1]).toBe(-1);
  });

  it('free is deferred; compaction swap-removes deterministically and moves gen with the entity', () => {
    const p = createEnemyPool(8);
    for (let i = 0; i < 6; i++) { const k = allocEnemy(p, 100 + i); p.hp[k] = 10 + i; }
    freeEnemy(p, 1); freeEnemy(p, 4); freeEnemy(p, 5);
    expect(p.count).toBe(6);                       // still in place during the tick
    expect(p.flags[1] & EnemyFlag.Dead).toBeTruthy();
    const remap = new Int32Array(8);
    expect(compactEnemies(p, remap)).toBe(3);
    expect(p.count).toBe(3);
    expect(Array.from(remap.subarray(0, 6))).toEqual([0, -1, 2, 1, -1, -1]);
    expect(Array.from(p.gen.subarray(0, 3))).toEqual([100, 103, 102]);
    expect(Array.from(p.hp.subarray(0, 3))).toEqual([10, 13, 12]);
    for (let i = 0; i < p.count; i++) expect(p.flags[i] & EnemyFlag.Dead).toBe(0);
  });

  it('compacts projectiles the same way', () => {
    const q = createProjectilePool(4);
    for (let i = 0; i < 4; i++) { const k = allocProjectile(q, i + 1); q.damage[k] = i; }
    freeProjectile(q, 0); freeProjectile(q, 3);
    const remap = new Int32Array(4);
    compactProjectiles(q, remap);
    expect(q.count).toBe(2);
    expect(Array.from(q.damage.subarray(0, 2))).toEqual([2, 1]);
  });
});
