/**
 * Purchase-agent base (WP10). An agent is a deterministic policy over the shop (`buildShop`, the
 * same data the UI reads) plus hardpoint / attunement / doctrine / exotic / Anomaly-draft choices.
 *
 * Commands are applied with `applyCommand` between two `sim.step()` calls. That is exactly what
 * `Sim.step()` does with queued commands at the start of the next tick, so it is equivalent to
 * `sim.command()` + `step()`, but the agent sees the error string immediately and can buy several
 * ranks between two ticks.
 *
 * Cost control: the shop (≈1 ms to build) is rebuilt only when the build changed
 * (`stats.version`), and a shopping pass only runs when Scrap reached the price of the next thing
 * the agent would buy (`waitScrap`), Cores changed, or slots/drafts need an answer.
 */
import type { Sim } from '../../src/sim/index';
import type { WorldImpl } from '../../src/sim/core/world-impl';
import type { Command, ShopEntry } from '../../src/sim/core/types';
import type { AnomalyId, DoctrineId, ElementId, HardpointId, TreeId } from '../../src/sim/core/ids';
import type { Prng } from '../../src/sim/math/prng';
import { applyCommand } from '../../src/sim/run/commands';
import { buildShop, spendKey } from '../../src/sim/economy/shop';
import { anomalyDef, nodeInfo, treeDef, type NodeInfo } from '../../src/sim/core/content';
import type { PolicyId } from '../types';

export const ALL_HARDPOINTS: HardpointId[] = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];
export const ALL_ELEMENTS: ElementId[] = ['fire', 'lightning', 'poison', 'frost'];
export const ALL_TREES: TreeId[] = ['ballistics', 'bastion', 'reactor', 'fire', 'lightning', 'poison', 'frost', 'ordnance', 'drones', 'blade', 'laser', 'gravitics'];

export interface AgentCtx {
  sim: Sim;
  readonly w: WorldImpl;
  rng: Prng;
  policy: PolicyId;
  /** Apply a command now (between ticks). Returns the sim's error string or null. */
  apply(cmd: Command): string | null;
  /** Current shop (cached per build version). Do not mutate. */
  shop(): ShopEntry[];
  purchases: number;
}

export function makeCtx(sim: Sim, rng: Prng, policy: PolicyId): AgentCtx {
  let cache: ShopEntry[] | null = null;
  let cacheVer = -1;
  let cacheBuild: unknown = null;
  const ctx: AgentCtx = {
    sim, rng, policy, purchases: 0,
    get w() { return sim.world; },
    apply(cmd: Command) {
      const err = applyCommand(sim.machine, cmd);
      if (!err && cmd.type === 'buy') ctx.purchases++;
      return err;
    },
    shop() {
      const w = sim.world;
      if (!cache || cacheVer !== w.stats.version || cacheBuild !== w.build) { cache = buildShop(w); cacheVer = w.stats.version; cacheBuild = w.build; }
      return cache;
    },
  };
  return ctx;
}

/** Tree/system key a shop entry's spend is booked under (matches run.spentByTree). */
export function entryKey(e: ShopEntry): string {
  const info = nodeInfo(e.node);
  if (!info) return e.tree;
  if (info.group === 'ability') return 'ability';
  if (info.group === 'fusion' || info.group === 'triad') return 'fusion';
  return spendKey(info);
}
export function entryInfo(e: ShopEntry): NodeInfo | undefined { return nodeInfo(e.node); }
export function entryTags(e: ShopEntry): readonly string[] { return nodeInfo(e.node)?.def.tags ?? []; }

export function affordable(w: WorldImpl, e: ShopEntry): boolean {
  if (e.locked) return false;
  return e.currency === 'scrap' ? w.run.scrap >= e.cost : w.run.cores >= e.cost;
}

/** Scrap entries the agent may buy (not doctrines/exotics; ability ranks only for non-idle policies). */
export function scrapEntries(ctx: AgentCtx): ShopEntry[] {
  const out: ShopEntry[] = [];
  for (const e of ctx.shop()) {
    if (e.currency !== 'scrap' || e.locked || e.kind === 'doctrine') continue;
    if (e.kind === 'ability' && ctx.policy === 'idle') continue;
    out.push(e);
  }
  return out;
}

export function totalSpent(w: WorldImpl): number {
  let s = 0;
  for (const k in w.run.spentByTree) s += w.run.spentByTree[k];
  return s;
}

/** Tier-weighted "how much a rank matters" before agent weights: mechanics change behavior. */
export function kindValue(e: ShopEntry): number {
  switch (e.kind) {
    case 'stat': return 1;
    case 'mechanic': return e.tier >= 3 ? 25 : e.tier === 2 ? 10 : 6;
    case 'linkage': case 'infusion': return 2;
    case 'fusion': return 3;
    case 'ability': return 1.5;
    default: return 1;
  }
}

export interface Choice { buy: ShopEntry | null; waitScrap: number }

export abstract class Agent {
  abstract readonly id: string;
  /** Mount order when hardpoint slots open. */
  hardpointOrder: HardpointId[] = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];
  /** Attune order when attunement slots open. */
  elementOrder: ElementId[] = ['fire', 'lightning', 'poison', 'frost'];
  /** Fixed Doctrine per tree (first choice when the fork opens). */
  doctrinePref: Partial<Record<TreeId, DoctrineId>> = {};
  /** Anomalies this agent avoids unless nothing else is offered. */
  avoidAnomalies: AnomalyId[] = [];
  /** Accept an affordable buy whose value/cost is at least this fraction of the best target's (else save). */
  patience = 0.5;

  protected waitScrap = 0;
  protected lastVer = -1;
  protected lastCores = -1;
  protected lastBuild: unknown = null;
  protected overrides: Partial<Record<TreeId, DoctrineId>> = {};

  setDoctrineOverrides(o: Partial<Record<TreeId, DoctrineId>> | undefined): void { this.overrides = { ...(o ?? {}) }; }

  /** Forget cached thresholds (new Prestige / branch). */
  reset(): void { this.waitScrap = 0; this.lastVer = -1; this.lastCores = -1; this.lastBuild = null; }

  doctrineFor(tree: TreeId): DoctrineId | undefined {
    const o = this.overrides[tree];
    if (o) return o;
    const p = this.doctrinePref[tree];
    if (p) return p;
    return treeDef(tree)?.doctrines[0]?.id;
  }

  /** Called before every sim step by the runner. Cheap unless there is something to decide. */
  tick(ctx: AgentCtx): void {
    const w = ctx.w, run = w.run;
    if (run.pendingDraft && run.pendingDraft.length > 0) this.handleDraft(ctx);
    if (this.slotsPending(w)) { this.fillSlots(ctx); this.waitScrap = 0; }
    if (run.scrap >= this.waitScrap || w.stats.version !== this.lastVer || run.cores !== this.lastCores || w.build !== this.lastBuild) this.shopPass(ctx);
  }

  protected slotsPending(w: WorldImpl): boolean {
    const b = w.build, run = w.run;
    for (let i = 0; i < run.hardpointSlotsOpen; i++) if (!b.hardpoints[i]) return true;
    for (let i = 0; i < run.attunementSlotsOpen; i++) if (!b.attunements[i]) return true;
    return false;
  }

  fillSlots(ctx: AgentCtx): void {
    const w = ctx.w, b = w.build, run = w.run;
    for (let i = 0; i < run.hardpointSlotsOpen; i++) {
      if (b.hardpoints[i]) continue;
      const sys = this.pickHardpoint(ctx);
      if (!sys || ctx.apply({ type: 'mount_hardpoint', slot: i, system: sys })) break;
    }
    for (let i = 0; i < run.attunementSlotsOpen; i++) {
      if (b.attunements[i]) continue;
      const el = this.pickElement(ctx);
      if (!el || ctx.apply({ type: 'attune', slot: i, element: el })) break;
    }
  }
  pickHardpoint(ctx: AgentCtx): HardpointId | null {
    for (const s of [...this.hardpointOrder, ...ALL_HARDPOINTS]) if (!ctx.w.stats.mounted(s)) return s;
    return null;
  }
  pickElement(ctx: AgentCtx): ElementId | null {
    for (const e of [...this.elementOrder, ...ALL_ELEMENTS]) if (!ctx.w.stats.attuned(e)) return e;
    return null;
  }

  /** Draft: the offer with the most matching `needs`; ties keep offer order; avoided ones last. */
  handleDraft(ctx: AgentCtx): void {
    const w = ctx.w, offers = w.run.pendingDraft as AnomalyId[];
    const pick = this.pickAnomaly(ctx, offers);
    const replace = w.build.anomalies.length >= w.build.anomalySockets ? 0 : undefined;
    const err = ctx.apply({ type: 'pick_anomaly', anomaly: pick, ...(replace !== undefined ? { replace } : {}) });
    if (err) ctx.apply({ type: 'pick_anomaly', anomaly: null });
  }
  pickAnomaly(ctx: AgentCtx, offers: AnomalyId[]): AnomalyId | null {
    let best: AnomalyId | null = null, bestScore = -Infinity;
    for (const id of offers) {
      const s = anomalyMatchScore(ctx.w, id) - (this.avoidAnomalies.includes(id) ? 10 : 0);
      if (s > bestScore) { bestScore = s; best = id; }
    }
    return best;
  }

  /** One shopping pass: doctrines, exotics, then Scrap purchases until the agent wants to save. */
  shopPass(ctx: AgentCtx): void {
    const w = ctx.w;
    this.chooseDoctrines(ctx);
    this.buyExotics(ctx);
    let guard = 0;
    for (;;) {
      if (guard++ > 400) break;
      const c = this.choose(ctx);
      if (!c.buy) { this.waitScrap = c.waitScrap; break; }
      const err = ctx.apply({ type: 'buy', node: c.buy.node });
      if (err) { this.waitScrap = w.run.scrap + 1 + Math.max(1, w.run.scrap * 0.05); break; }
      this.afterBuy(ctx, c.buy);
    }
    this.lastVer = w.stats.version; this.lastCores = w.run.cores; this.lastBuild = w.build;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected afterBuy(_ctx: AgentCtx, _e: ShopEntry): void { /* hook */ }

  chooseDoctrines(ctx: AgentCtx): void {
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (const e of ctx.shop()) {
        if (e.kind !== 'doctrine' || e.locked || e.cost > 0) continue;
        const tree = e.tree as TreeId;
        const doc = e.node.slice(tree.length + 1) as DoctrineId;
        const cur = ctx.w.build.doctrines[tree];
        const want = cur ? this.secondDoctrineFor(tree, cur) : this.doctrineFor(tree);
        if (want !== doc) continue;
        if (!ctx.apply({ type: 'choose_doctrine', tree, doctrine: doc })) { changed = true; break; }
      }
      if (!changed) break;
    }
  }
  /** Second Doctrine (Spare Barrel, Dual Doctrine, Monolith, Bulwark): the first other one listed. */
  secondDoctrineFor(tree: TreeId, first: DoctrineId): DoctrineId | undefined {
    return treeDef(tree)?.doctrines.find((d) => d.id !== first)?.id;
  }

  /** Exotics (2 Cores): buy for the tree the agent invested most in. */
  buyExotics(ctx: AgentCtx): void {
    const w = ctx.w;
    if (w.run.cores < 2) return;
    const ex = ctx.shop().filter((e) => e.kind === 'exotic' && !e.locked && e.currency === 'cores');
    if (!ex.length) return;
    const order = this.exoticOrder(ctx);
    ex.sort((a, b) => order(b) - order(a) || (a.node < b.node ? -1 : 1));
    for (const e of ex) { if (w.run.cores < e.cost) break; ctx.apply({ type: 'buy', node: e.node }); }
  }
  protected exoticOrder(ctx: AgentCtx): (e: ShopEntry) => number {
    const spent = ctx.w.run.spentByTree;
    return (e) => spent[e.tree] ?? 0;
  }

  /** Value of one rank of `e` for this agent (0 = never buy). */
  abstract value(ctx: AgentCtx, e: ShopEntry): number;

  /**
   * Default chooser: best value/cost over every visible, unlocked Scrap entry. Buy it if affordable;
   * otherwise buy the best affordable entry whose ratio is ≥ patience × best, else save.
   */
  choose(ctx: AgentCtx): Choice {
    const w = ctx.w;
    const entries = scrapEntries(ctx);
    let best: ShopEntry | null = null, bestR = 0;
    const ratios = new Map<ShopEntry, number>();
    for (const e of entries) {
      const v = this.value(ctx, e);
      if (!(v > 0)) continue;
      const r = v / Math.max(1, e.cost);
      ratios.set(e, r);
      if (r > bestR || (r === bestR && best && e.cost < best.cost)) { bestR = r; best = e; }
    }
    if (!best) return { buy: null, waitScrap: Infinity };
    if (w.run.scrap >= best.cost) return { buy: best, waitScrap: 0 };
    let alt: ShopEntry | null = null, altR = 0, wait = best.cost;
    for (const [e, r] of ratios) {
      if (r < this.patience * bestR) continue;
      if (e.cost < wait) wait = e.cost;
      if (w.run.scrap >= e.cost && r > altR) { altR = r; alt = e; }
    }
    return alt ? { buy: alt, waitScrap: 0 } : { buy: null, waitScrap: wait };
  }
}

/** Number of an Anomaly's `needs` the build satisfies (no needs = 0.5: generic). */
export function anomalyMatchScore(w: WorldImpl, id: AnomalyId): number {
  const d = anomalyDef(id);
  if (!d) return 0;
  if (!d.needs || d.needs.length === 0) return 0.5;
  let n = 0;
  for (const x of d.needs) if (x === 'primary' || w.stats.mounted(x) || w.stats.attuned(x)) n++;
  return n - (n < d.needs.length ? 0.75 : 0);
}

/** Weighted value helper shared by the weight-table agents. */
export interface WeightTable {
  /** Weight by spend key (tree, hardpoint, 'fusion', 'ability'). '*' = default. */
  tree: Record<string, number>;
  /** Multiplier by node tag (first matching tag in the node's list wins the max). '*' = untagged. */
  tag?: Record<string, number>;
  /** Exact node overrides. */
  node?: Record<string, number>;
}

export function weighted(t: WeightTable, e: ShopEntry): number {
  const n = t.node?.[e.node];
  if (n !== undefined) return n * kindValue(e);
  const k = entryKey(e);
  const tw = t.tree[k] ?? t.tree['*'] ?? 0;
  if (!(tw > 0)) return 0;
  let tm = 1;
  if (t.tag && e.kind === 'stat') {
    const tags = entryTags(e);
    if (tags.length === 0) tm = t.tag['*'] ?? 1;
    else { tm = 0; for (const g of tags) tm = Math.max(tm, t.tag[g] ?? t.tag['*'] ?? 1); }
  }
  return tw * tm * kindValue(e);
}
