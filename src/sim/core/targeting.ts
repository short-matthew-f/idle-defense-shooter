/**
 * Target selection by Targeting Profile (design §11). Deterministic: candidates come from the
 * spatial hash in its fixed scan order and ties break on the lower pool index.
 * A live designated enemy in range always wins ("every weapon that can reach it strongly prefers it").
 */
import type { EnemyPool, TowerState } from './types';
import { EnemyFlag, NO_ENTITY } from './types';
import type { TargetingProfile } from './ids';
import type { SpatialHash } from './spatial';
import { targetable } from './spatial';

const SCRATCH = new Int32Array(4096);
const SUPPORT = EnemyFlag.Support | EnemyFlag.Healer | EnemyFlag.Shielder;
const PRIORITY = EnemyFlag.Elite | EnemyFlag.Boss;

function inRange(p: EnemyPool, i: number, x: number, y: number, maxR: number): boolean {
  const dx = p.x[i] - x, dy = p.y[i] - y, rr = maxR + p.radius[i];
  return dx * dx + dy * dy <= rr * rr;
}

export function designatedInRange(p: EnemyPool, tower: TowerState, x: number, y: number, maxR: number): number {
  const d = tower.designated;
  if (d >= 0 && d < p.count && p.gen[d] === tower.designatedGen && targetable(p, d) && inRange(p, d, x, y, maxR)) return d;
  const d2 = tower.designated2;
  if (d2 >= 0 && d2 < p.count && p.gen[d2] === tower.designated2Gen && targetable(p, d2) && inRange(p, d2, x, y, maxR)) return d2;
  return NO_ENTITY;
}

export function selectTarget(p: EnemyPool, hash: SpatialHash, tower: TowerState, x: number, y: number, maxR: number, profile: TargetingProfile): number {
  const des = designatedInRange(p, tower, x, y, maxR);
  if (des !== NO_ENTITY) return des;
  if (profile === 'nearest' || profile === 'designated') return hash.nearest(x, y, maxR);
  const n = hash.queryRadius(x, y, maxR, SCRATCH);
  let best = NO_ENTITY, bestK1 = Infinity, bestK2 = Infinity;
  for (let k = 0; k < n; k++) {
    const i = SCRATCH[k];
    if (!targetable(p, i)) continue;
    const dx = p.x[i] - x, dy = p.y[i] - y;
    const d = dx * dx + dy * dy;
    let k1 = 0, k2 = d;
    switch (profile) {
      case 'closest_to_tower': k2 = p.x[i] * p.x[i] + p.y[i] * p.y[i]; break;
      case 'lowest_hp': k1 = p.hp[i]; break;
      case 'highest_hp': k1 = -p.hp[i]; break;
      case 'elites': k1 = (p.flags[i] & PRIORITY) !== 0 ? 0 : 1; break;
      case 'support': k1 = (p.flags[i] & SUPPORT) !== 0 ? 0 : 1; break;
      case 'fastest': k1 = -(p.speed[i] * p.speedMul[i]); break;
      default: break;
    }
    if (k1 < bestK1 || (k1 === bestK1 && (k2 < bestK2 || (k2 === bestK2 && i < best)))) { best = i; bestK1 = k1; bestK2 = k2; }
  }
  return best;
}
