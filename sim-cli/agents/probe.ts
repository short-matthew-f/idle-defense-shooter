/**
 * Doctrine probe (Doctrine health test): a build committed to one tree running one Doctrine.
 *  - hardpoint trees: the hardpoint agent for that system with the Doctrine forced
 *  - element trees: attunes that element first, element-heavy weights
 *  - chassis trees: the balanced agent with that tree weighted ×2.5
 */
import type { ShopEntry } from '../../src/sim/core/types';
import type { DoctrineId, ElementId, HardpointId, TreeId } from '../../src/sim/core/ids';
import { Agent, entryKey, type AgentCtx } from './base';
import { HardpointAgent } from './hardpoint';
import { BalancedAgent } from './optimizer';

const HARDPOINTS = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];
const ELEMENTS = ['fire', 'lightning', 'poison', 'frost'];

class TreeFocusAgent extends BalancedAgent {
  override readonly id: string;
  constructor(readonly tree: TreeId, doctrine: DoctrineId) {
    super();
    this.id = `doctrine:${tree}.${doctrine}`;
    this.doctrinePref = { ...this.doctrinePref, [tree]: doctrine };
    if (ELEMENTS.includes(tree)) this.elementOrder = [tree as ElementId, ...this.elementOrder.filter((e) => e !== tree)];
  }
  override value(ctx: AgentCtx, e: ShopEntry): number {
    const v = super.value(ctx, e);
    return entryKey(e) === this.tree ? Math.max(v, 1) * 2.5 : v;
  }
}

export function doctrineProbe(tree: TreeId, doctrine: DoctrineId): Agent {
  if (HARDPOINTS.includes(tree)) {
    const a = new HardpointAgent(tree as HardpointId);
    a.doctrinePref = { ...a.doctrinePref, [tree]: doctrine };
    (a as { id: string }).id = `doctrine:${tree}.${doctrine}`;
    return a;
  }
  return new TreeFocusAgent(tree, doctrine);
}
