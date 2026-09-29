/**
 * Elemental: attunes as soon as a slot opens, pours Scrap into element trees, Fusions and
 * Infusions; Ricochet spreads statuses. Chooses the Conductor frame when it is unlocked (runner).
 */
import type { ShopEntry } from '../../src/sim/core/types';
import { Agent, weighted, type AgentCtx, type WeightTable } from './base';

const W: WeightTable = {
  tree: { fire: 2, poison: 2, lightning: 2, frost: 2, fusion: 3, ballistics: 1, laser: 0.8, drones: 0.7, ordnance: 0.6, blade: 0.6, gravitics: 0.5, reactor: 0.4, bastion: 0.35, ability: 0.3 },
  tag: { status: 1.2, damage: 1.1, speed: 0.9, range: 0.4, control: 0.6, defense: 1, '*': 0.5 },
};

export class ElementalAgent extends Agent {
  readonly id: string = 'elemental';
  readonly preferredFrame = 'conductor';
  constructor() {
    super();
    this.hardpointOrder = ['laser', 'drones', 'ordnance', 'blade', 'gravitics'];
    this.elementOrder = ['fire', 'poison', 'lightning', 'frost'];
    this.doctrinePref = {
      ballistics: 'ricochet', bastion: 'aegis', reactor: 'synchronization', fire: 'wildfire', lightning: 'storm',
      poison: 'venom', frost: 'shatter', ordnance: 'bombard', drones: 'arc', blade: 'tempest', laser: 'resonance', gravitics: 'collapse',
    };
  }
  value(_ctx: AgentCtx, e: ShopEntry): number {
    let v = weighted(W, e);
    if (e.kind === 'infusion') v *= 1.5;
    return v;
  }
}
