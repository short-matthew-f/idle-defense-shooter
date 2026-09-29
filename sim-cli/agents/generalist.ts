/**
 * Generalist: round-robin across every open tree (chassis, attuned elements, mounted hardpoints,
 * then Linkages/Infusions/Fusions as one group each), buying the cheapest affordable rank in the
 * tree at the cursor. Never saves: mechanics get bought when they are the cheapest thing left.
 */
import type { ShopEntry } from '../../src/sim/core/types';
import { Agent, entryKey, scrapEntries, type AgentCtx, type Choice } from './base';

export class GeneralistAgent extends Agent {
  readonly id: string = 'generalist';
  private cursor = 0;
  constructor() {
    super();
    this.hardpointOrder = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];
    this.elementOrder = ['fire', 'frost', 'lightning', 'poison'];
    this.doctrinePref = {
      ballistics: 'piercing', bastion: 'fortress', reactor: 'overclock', fire: 'wildfire', lightning: 'chain',
      poison: 'plague', frost: 'control', ordnance: 'hunter', drones: 'wing', blade: 'greatblade', laser: 'expansion', gravitics: 'collapse',
    };
  }
  override reset(): void { super.reset(); this.cursor = 0; }
  value(_ctx: AgentCtx, e: ShopEntry): number { return e.kind === 'ability' ? 0.5 : 1; }

  override choose(ctx: AgentCtx): Choice {
    const w = ctx.w;
    const groups = new Map<string, ShopEntry[]>();
    const order: string[] = [];
    let minCost = Infinity;
    for (const e of scrapEntries(ctx)) {
      const k = entryKey(e);
      let g = groups.get(k);
      if (!g) { g = []; groups.set(k, g); order.push(k); }
      g.push(e);
      if (e.cost < minCost) minCost = e.cost;
    }
    if (order.length === 0) return { buy: null, waitScrap: Infinity };
    for (let i = 0; i < order.length; i++) {
      const k = order[(this.cursor + i) % order.length];
      let best: ShopEntry | null = null;
      for (const e of groups.get(k)!) if (e.cost <= w.run.scrap && (!best || e.cost < best.cost)) best = e;
      if (best) { this.cursor = (this.cursor + i + 1) % Math.max(1, order.length); return { buy: best, waitScrap: 0 }; }
    }
    return { buy: null, waitScrap: minCost };
  }
}
