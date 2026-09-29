/**
 * One agent per hardpoint system: mounts that system in the first slot, keeps ≥ 50% of the Scrap
 * spent since mounting in that system (its tree, Infusions and Linkages book under it), and runs
 * the system's best-looking Doctrine. Before the first slot opens it plays like a balanced chassis
 * builder.
 */
import type { ShopEntry } from '../../src/sim/core/types';
import type { DoctrineId, HardpointId } from '../../src/sim/core/ids';
import { Agent, entryKey, totalSpent, weighted, type AgentCtx, type WeightTable } from './base';

export const BEST_LOOKING: Record<HardpointId, DoctrineId> = {
  ordnance: 'swarm', drones: 'wing', blade: 'tempest', laser: 'resonance', gravitics: 'collapse',
};

const BASE: WeightTable = {
  tree: { ballistics: 1, bastion: 0.6, reactor: 0.5, fire: 0.8, lightning: 0.8, poison: 0.8, frost: 0.8, fusion: 1, ability: 0.3,
    ordnance: 0.6, drones: 0.6, blade: 0.6, laser: 0.6, gravitics: 0.6 },
  tag: { damage: 1.2, speed: 1, status: 0.8, defense: 1, range: 0.4, control: 0.5, '*': 0.5 },
};

export class HardpointAgent extends Agent {
  readonly id: string;
  readonly system: HardpointId;
  private spentAtMount = -1;
  private totalAtMount = 0;
  constructor(system: HardpointId) {
    super();
    this.system = system;
    this.id = `hp_${system}`;
    this.hardpointOrder = [system, ...(['ordnance', 'drones', 'blade', 'laser', 'gravitics'] as HardpointId[]).filter((s) => s !== system)];
    this.elementOrder = system === 'laser' || system === 'drones' ? ['lightning', 'fire', 'frost', 'poison'] : ['fire', 'lightning', 'poison', 'frost'];
    this.doctrinePref = {
      ballistics: 'multishot', bastion: 'fortress', reactor: 'overclock', fire: 'inferno', lightning: 'chain',
      poison: 'venom', frost: 'shatter', ordnance: 'swarm', drones: 'wing', blade: 'tempest', laser: 'resonance', gravitics: 'collapse',
      [system]: BEST_LOOKING[system],
    };
  }
  override reset(): void { super.reset(); this.spentAtMount = -1; }
  value(ctx: AgentCtx, e: ShopEntry): number {
    const w = ctx.w;
    const k = entryKey(e);
    const mine = k === this.system;
    if (!w.stats.mounted(this.system)) return weighted(BASE, e);
    if (this.spentAtMount < 0) { this.spentAtMount = w.run.spentByTree[this.system] ?? 0; this.totalAtMount = totalSpent(w); }
    const sysSpent = (w.run.spentByTree[this.system] ?? 0) - this.spentAtMount;
    const allSpent = totalSpent(w) - this.totalAtMount;
    const behind = sysSpent < 0.5 * allSpent;
    let v = weighted(BASE, e);
    if (mine) v = Math.max(v, 1) * 3;
    else if (behind) v *= 0.02;
    return v;
  }
}
