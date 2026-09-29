/**
 * Random Legal: every choice uniform over the legal options, from a Prng seeded by the run seed.
 * Buys a uniformly random affordable entry (Scrap or Core priced) until nothing is affordable.
 */
import type { ShopEntry } from '../../src/sim/core/types';
import type { AnomalyId, DoctrineId, ElementId, HardpointId, TreeId } from '../../src/sim/core/ids';
import { ALL_ELEMENTS, ALL_HARDPOINTS, Agent, affordable, type AgentCtx, type Choice } from './base';
import { treeDef } from '../../src/sim/core/content';

export class RandomAgent extends Agent {
  readonly id: string = 'random';
  private chosen: Partial<Record<TreeId, DoctrineId>> = {};
  value(): number { return 1; }
  override reset(): void { super.reset(); this.chosen = {}; }
  override pickHardpoint(ctx: AgentCtx): HardpointId | null {
    const opts = ALL_HARDPOINTS.filter((s) => !ctx.w.stats.mounted(s));
    return opts.length ? ctx.rng.pick(opts) : null;
  }
  override pickElement(ctx: AgentCtx): ElementId | null {
    const opts = ALL_ELEMENTS.filter((s) => !ctx.w.stats.attuned(s));
    return opts.length ? ctx.rng.pick(opts) : null;
  }
  override doctrineFor(tree: TreeId): DoctrineId | undefined {
    return this.overrides[tree] ?? this.chosen[tree];
  }
  override chooseDoctrines(ctx: AgentCtx): void {
    for (const e of ctx.shop()) {
      if (e.kind !== 'doctrine' || e.locked || e.cost > 0) continue;
      const tree = e.tree as TreeId;
      if (ctx.w.build.doctrines[tree] || this.chosen[tree]) continue;
      const docs = treeDef(tree)?.doctrines ?? [];
      if (docs.length) this.chosen[tree] = this.overrides[tree] ?? ctx.rng.pick(docs).id;
    }
    super.chooseDoctrines(ctx);
  }
  override pickAnomaly(ctx: AgentCtx, offers: AnomalyId[]): AnomalyId | null { return offers.length ? ctx.rng.pick(offers) : null; }
  override buyExotics(ctx: AgentCtx): void {
    const ex = ctx.shop().filter((e) => e.kind === 'exotic' && affordable(ctx.w, e));
    if (ex.length && ctx.rng.chance(0.5)) ctx.apply({ type: 'buy', node: ctx.rng.pick(ex).node });
  }
  override choose(ctx: AgentCtx): Choice {
    const opts: ShopEntry[] = [];
    let min = Infinity;
    for (const e of ctx.shop()) {
      if (e.currency !== 'scrap' || e.locked || e.kind === 'doctrine') continue;
      if (e.kind === 'ability' && ctx.policy === 'idle') continue;
      if (e.cost < min) min = e.cost;
      if (e.cost <= ctx.w.run.scrap) opts.push(e);
    }
    return opts.length ? { buy: ctx.rng.pick(opts), waitScrap: 0 } : { buy: null, waitScrap: min };
  }
}
