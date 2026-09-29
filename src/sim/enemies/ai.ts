/**
 * Enemy AI entry point (called once per tick by Sim.step, after statuses, before the spatial
 * hash rebuild). WP1 ships basic steering; WP5 grows this file with behaviors, boss scripts,
 * tells and elite modifiers.
 */
import type { World } from '../core/world';
import { steerEnemy } from './steering';

export function aiStep(world: World): void {
  const e = world.enemies;
  const n = e.count;
  for (let i = 0; i < n; i++) steerEnemy(world, i);
}
