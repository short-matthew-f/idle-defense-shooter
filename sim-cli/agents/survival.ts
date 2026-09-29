/**
 * Survival: Bastion first (Fortress), Drones on Support, Frost for control; keeps HP and armor
 * ranks ahead of the primary's damage rank.
 */
import type { ShopEntry } from '../../src/sim/core/types';
import type { AnomalyId } from '../../src/sim/core/ids';
import { Agent, entryKey, weighted, type AgentCtx, type WeightTable } from './base';

const W: WeightTable = {
  tree: { bastion: 1.4, ballistics: 1.1, drones: 1, frost: 0.9, blade: 0.8, gravitics: 0.7, ordnance: 0.6, laser: 0.6, poison: 0.6, fire: 0.5, lightning: 0.5, fusion: 0.8, reactor: 0.5, ability: 0.5 },
  tag: { defense: 1.3, damage: 1, speed: 0.9, control: 1, status: 0.7, range: 0.5, '*': 0.5 },
};

export class SurvivalAgent extends Agent {
  readonly id: string = 'survival';
  override avoidAnomalies: AnomalyId[] = ['glass_cannon', 'hungry_core', 'tithe', 'unstable_isotope'];
  constructor() {
    super();
    this.hardpointOrder = ['drones', 'blade', 'gravitics', 'ordnance', 'laser'];
    this.elementOrder = ['frost', 'poison', 'lightning', 'fire'];
    this.doctrinePref = {
      ballistics: 'piercing', bastion: 'fortress', reactor: 'overclock', fire: 'wildfire', lightning: 'chain',
      poison: 'plague', frost: 'control', ordnance: 'hunter', drones: 'support', blade: 'greatblade', laser: 'containment', gravitics: 'tidal',
    };
  }
  value(ctx: AgentCtx, e: ShopEntry): number {
    let v = weighted(W, e);
    if (entryKey(e) === 'bastion') {
      const r = ctx.w.build.ranks;
      const dmg = r['ballistics.damage'] | 0;
      // keep HP and armor ranks ahead of the primary's damage rank; otherwise Bastion competes normally
      if ((r['bastion.max_hp'] | 0) < dmg + 2 || (r['bastion.armor'] | 0) < dmg * 0.5) v *= 1.6;
      else v *= 0.6;
    }
    return v;
  }
}
