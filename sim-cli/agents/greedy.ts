/**
 * Greedy DPS: cheapest damage / attack speed / crit first. Ballistics + Ordnance/Blade,
 * Fire + Lightning, Multishot. Buys almost no defense (a trickle of Bastion so contact damage
 * does not end every attempt at wave 3).
 */
import type { ShopEntry } from '../../src/sim/core/types';
import { Agent, weighted, type AgentCtx, type WeightTable } from './base';

const W: WeightTable = {
  tree: { ballistics: 1, ordnance: 1, blade: 1, fire: 1, lightning: 1, drones: 0.7, laser: 0.7, gravitics: 0.4, poison: 0.6, frost: 0.3, fusion: 1, reactor: 0.6, bastion: 0.12, ability: 0.3 },
  tag: { damage: 1.2, speed: 1, status: 0.8, range: 0.3, control: 0.2, defense: 1, active: 0.2, mechanical: 1, '*': 0.5 },
};

export class GreedyAgent extends Agent {
  readonly id: string = 'greedy';
  constructor() {
    super();
    this.hardpointOrder = ['ordnance', 'blade', 'drones', 'laser', 'gravitics'];
    this.elementOrder = ['fire', 'lightning', 'poison', 'frost'];
    this.doctrinePref = {
      ballistics: 'multishot', bastion: 'phoenix', reactor: 'overclock', fire: 'inferno', lightning: 'chain',
      poison: 'venom', frost: 'shatter', ordnance: 'swarm', drones: 'wing', blade: 'twinning', laser: 'resonance', gravitics: 'collapse',
    };
  }
  value(_ctx: AgentCtx, e: ShopEntry): number { return weighted(W, e); }
}
