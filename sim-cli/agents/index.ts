/** Agent registry. */
import type { DoctrineId, HardpointId, TreeId } from '../../src/sim/core/ids';
import type { Agent } from './base';
import { GreedyAgent } from './greedy';
import { SurvivalAgent } from './survival';
import { ElementalAgent } from './elemental';
import { GeneralistAgent } from './generalist';
import { RandomAgent } from './random';
import { HardpointAgent } from './hardpoint';
import { OptimizerAgent } from './optimizer';
import { doctrineProbe, PurePrimaryAgent } from './probe';

export const BASE_AGENTS = ['greedy', 'survival', 'elemental', 'generalist', 'random', 'hp_ordnance', 'hp_drones', 'hp_blade', 'hp_laser', 'hp_gravitics', 'optimizer'] as const;
export const HARDPOINT_AGENTS = ['hp_ordnance', 'hp_drones', 'hp_blade', 'hp_laser', 'hp_gravitics'] as const;

export function makeAgent(id: string): Agent {
  if (id.startsWith('doctrine:')) {
    const [tree, doc] = id.slice(9).split('.');
    return doctrineProbe(tree as TreeId, doc as DoctrineId);
  }
  if (id.startsWith('hp_')) return new HardpointAgent(id.slice(3) as HardpointId);
  switch (id) {
    case 'greedy': return new GreedyAgent();
    case 'survival': return new SurvivalAgent();
    case 'elemental': return new ElementalAgent();
    case 'generalist': return new GeneralistAgent();
    case 'random': return new RandomAgent();
    case 'optimizer': return new OptimizerAgent(true);
    case 'optimizer_lite': return new OptimizerAgent(false);
    case 'pure_ballistics': return new PurePrimaryAgent();
    default: throw new Error(`Unknown agent '${id}'`);
  }
}
