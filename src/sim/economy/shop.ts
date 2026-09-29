/**
 * Shop: every currently visible node with price, affordability and lock reason, and the purchase
 * rules. Visibility (design §4–§10):
 *  - chassis trees always; element trees when attuned; hardpoint trees when mounted
 *  - shared nodes always (locked until `requires` are owned); ability rank nodes only while slotted
 *  - doctrine choices appear as kind 'doctrine' entries with node id `${tree}.${doctrine}` once the
 *    fork is open (shared nodes owned ≥ forkRequirement); the chosen doctrine's nodes then appear
 *  - exotics (Cores) once the fork is open
 *  - Fusions (both elements attuned), weapon/chassis Linkages (both halves mounted), Infusions
 *    (system mounted + element attuned)
 * Pricing: nodeCost() × 0.85 for hardpoint trees on the Arsenal frame. Spend is recorded per tree
 * in run.spentByTree (Refit refunds 60% of it).
 */
import type { ShopEntry } from '../core/types';
import { Ev } from '../core/types';
import type { WorldImpl } from '../core/world-impl';
import type { NodeDef, TreeDef } from '../data/schema';
import type { DoctrineId, TreeId } from '../core/ids';
import { allTrees, treeDef, nodeInfo, allNodes, type NodeInfo } from '../core/content';
import { nodeCost, CORE_COSTS } from './curves';

type Eval = { visible: boolean; locked?: string; cost: number; currency: 'scrap' | 'cores'; rank: number; maxRank: number };

function forkOpen(w: WorldImpl, t: TreeDef): { open: boolean; owned: number } {
  let owned = 0;
  for (const n of t.shared) if (!n.ability && (w.build.ranks[n.id] | 0) > 0) owned++;
  return { open: owned >= t.forkRequirement, owned };
}

function costMul(w: WorldImpl, info: NodeInfo): number {
  if (w.build.frame === 'arsenal') {
    const t = info.tree ? treeDef(info.tree) : undefined;
    if ((t && t.category === 'hardpoint') || info.group === 'infuse') return 0.85;
  }
  return 1;
}

/** Tree key that a node's Scrap spend is booked under (for Refit refunds). */
export function spendKey(info: NodeInfo): string {
  switch (info.group) {
    case 'tree': return info.tree!;
    case 'infuse': return info.system!;
    case 'link': return info.pair![0] === 'primary' ? info.pair![1] : info.pair![0];
    case 'chassis_link': return info.pair![1];
    case 'ability': return 'reactor';
    default: return info.group;
  }
}

function evaluate(w: WorldImpl, info: NodeInfo): Eval {
  const def = info.def, s = w.stats;
  const rank = w.build.ranks[def.id] | 0;
  const pc = nodeCost(def, rank);
  const out: Eval = { visible: false, cost: pc.currency === 'scrap' ? Math.ceil(pc.cost * costMul(w, info)) : pc.cost, currency: pc.currency, rank, maxRank: def.maxRank };
  switch (info.group) {
    case 'tree': {
      const t = treeDef(info.tree!);
      if (!t || !s.treeActive(t.id)) return out;
      if (info.doctrine) { if (!s.hasDoctrine(t.id, info.doctrine)) return out; }
      else if (info.exotic) { const f = forkOpen(w, t); if (!f.open) out.locked = `Buy ${t.forkRequirement - f.owned} more ${t.name} nodes`; }
      break;
    }
    case 'ability': if (!info.ability || !w.build.abilities.includes(info.ability as never)) return out; break;
    case 'fusion': case 'triad': if (!info.elements!.every((e) => s.attuned(e))) return out; break;
    case 'link': if (!s.mounted(info.pair![0]) || !s.mounted(info.pair![1])) return out; break;
    case 'chassis_link': if (!s.mounted(info.pair![1])) return out; break;
    case 'infuse': if (!s.mounted(info.system!) || !s.attuned(info.elements![0])) return out; break;
    default: return out;   // prestige / star nodes are not sold here
  }
  out.visible = true;
  if (!out.locked && def.requires) {
    const missing = def.requires.find((r) => (w.build.ranks[r] | 0) <= 0);
    if (missing) out.locked = `Requires ${nodeInfo(missing)?.def.name ?? missing}`;
  }
  if (!out.locked && rank >= def.maxRank) out.locked = 'Max rank';
  return out;
}

function entryKind(info: NodeInfo): ShopEntry['kind'] {
  switch (info.group) {
    case 'fusion': case 'triad': return 'fusion';
    case 'link': case 'chassis_link': return 'linkage';
    case 'infuse': return 'infusion';
    case 'ability': return 'ability';
    default: return info.exotic || info.def.kind === 'exotic' ? 'exotic' : info.def.kind === 'mechanic' ? 'mechanic' : 'stat';
  }
}
function entryTree(info: NodeInfo): ShopEntry['tree'] {
  switch (info.group) {
    case 'fusion': case 'triad': return 'fusion';
    case 'link': case 'chassis_link': return 'link';
    case 'infuse': return 'infuse';
    case 'ability': return 'ability';
    default: return info.tree!;
  }
}

function affordable(w: WorldImpl, e: Eval): boolean {
  return !e.locked && (e.currency === 'scrap' ? w.run.scrap >= e.cost : w.run.cores >= e.cost);
}

/** Every visible node, doctrine choice and exotic, in content order. Allocates (UI ≤ 10 Hz). */
export function buildShop(w: WorldImpl): ShopEntry[] {
  const out: ShopEntry[] = [];
  const seen = new Set<string>();
  const push = (info: NodeInfo): void => {
    if (seen.has(info.def.id)) return;
    seen.add(info.def.id);
    const ev = evaluate(w, info);
    if (!ev.visible) return;
    const d: NodeDef = info.def;
    out.push({ node: d.id, tree: entryTree(info), name: d.name, desc: d.desc, rank: ev.rank, maxRank: ev.maxRank, cost: ev.cost, currency: ev.currency,
      affordable: affordable(w, ev), kind: entryKind(info), ...(ev.locked ? { locked: ev.locked } : {}), tier: d.tier });
  };
  for (const t of allTrees()) {
    if (!w.stats.treeActive(t.id)) continue;
    for (const n of t.shared) { const info = nodeInfo(n.id); if (info) push(info); }
    for (const d of t.doctrines) {
      if (w.stats.hasDoctrine(t.id, d.id)) { for (const n of d.nodes) { const info = nodeInfo(n.id); if (info) push(info); } continue; }
      const choice = doctrineChoice(w, t.id, d.id);
      out.push({ node: `${t.id}.${d.id}`, tree: t.id, name: d.name, desc: d.identity, rank: 0, maxRank: 1, cost: choice.cost, currency: 'cores',
        affordable: !choice.locked && w.run.cores >= choice.cost, kind: 'doctrine', ...(choice.locked ? { locked: choice.locked } : {}), tier: 2 });
    }
    const ex = nodeInfo(t.exotic.id); if (ex) push(ex);
  }
  for (const info of allNodes()) if (info.group !== 'tree' && info.group !== 'prestige' && info.group !== 'star') push(info);
  return out;
}

/** Can `doctrine` be chosen in `tree` right now, and for how many Cores? */
export function doctrineChoice(w: WorldImpl, tree: TreeId, doctrine: DoctrineId): { cost: number; locked?: string; second: boolean } {
  const t = treeDef(tree);
  if (!t || !t.doctrines.some((d) => d.id === doctrine)) return { cost: 0, locked: 'Unknown doctrine', second: false };
  if (!w.stats.treeActive(tree)) return { cost: 0, locked: 'Tree not available', second: false };
  const f = forkOpen(w, t);
  if (!f.open) return { cost: 0, locked: `Buy ${t.forkRequirement - f.owned} more ${t.name} nodes`, second: false };
  const cur = w.build.doctrines[tree];
  if (cur === doctrine || w.build.secondDoctrines[tree] === doctrine) return { cost: 0, locked: 'Already chosen', second: false };
  if (!cur) return { cost: 0, second: false };
  if (!w.build.secondDoctrines[tree] && w.stats.secondDoctrineAllowed(tree)) return { cost: 0, second: true };
  const atCheckpoint = w.run.phase === 'between' && w.run.wave - 1 === w.run.checkpoint;
  if (!atCheckpoint) return { cost: CORE_COSTS.doctrine, locked: 'Change only at a checkpoint', second: false };
  return { cost: CORE_COSTS.doctrine, second: false };
}

/** Choose (free the first time per tree) or change (1 Core, at a checkpoint) a doctrine. Returns an error or null. */
export function chooseDoctrine(w: WorldImpl, tree: TreeId, doctrine: DoctrineId): string | null {
  const c = doctrineChoice(w, tree, doctrine);
  if (c.locked) return c.locked;
  if (w.run.cores < c.cost) return 'Not enough Cores';
  w.run.cores -= c.cost;
  if (c.second) w.build.secondDoctrines[tree] = doctrine;
  else w.build.doctrines[tree] = doctrine;
  w.emit(Ev.DoctrineChosen, `${tree}.${doctrine}`, c.cost, c.second ? 2 : 1, 0, 0, -1);
  w.rebuildStats();
  return null;
}

/** Buy one rank of `nodeId` (or choose a doctrine via its `${tree}.${doctrine}` entry id). Returns an error or null. */
export function purchase(w: WorldImpl, nodeId: string): string | null {
  const info = nodeInfo(nodeId);
  if (!info) {
    const dot = nodeId.indexOf('.');
    if (dot > 0) {
      const tree = nodeId.slice(0, dot) as TreeId, doc = nodeId.slice(dot + 1) as DoctrineId;
      const t = treeDef(tree);
      if (t && t.doctrines.some((d) => d.id === doc)) return chooseDoctrine(w, tree, doc);
    }
    return 'Unknown node';
  }
  const ev = evaluate(w, info);
  if (!ev.visible) return 'Not available';
  if (ev.locked) return ev.locked;
  if (ev.currency === 'scrap') {
    if (w.run.scrap < ev.cost) return 'Not enough Scrap';
    w.run.scrap -= ev.cost;
    const key = spendKey(info);
    w.run.spentByTree[key] = (w.run.spentByTree[key] ?? 0) + ev.cost;
  } else {
    if (w.run.cores < ev.cost) return 'Not enough Cores';
    w.run.cores -= ev.cost;
  }
  const r = (w.build.ranks[nodeId] | 0) + 1;
  w.build.ranks[nodeId] = r;
  w.emit(Ev.Purchase, nodeId, r, ev.cost, 0, 0, -1);
  w.rebuildStats();
  return null;
}

/** Price/lock view of a single node (agents, Upgrade Queue). */
export function shopEntryFor(w: WorldImpl, nodeId: string): ShopEntry | undefined {
  return buildShop(w).find((e) => e.node === nodeId);
}
