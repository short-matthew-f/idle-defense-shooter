/**
 * Quartermaster: automation as a reward. From the first Prestige on (meta.prestigeCount ≥ 1, hard-coded here so a
 * first run can never switch it on), it keeps the repeatable STAT ranks topped up. It never makes a choice for the
 * player. docs/QUARTERMASTER.md has the player-facing rules and the measured effect.
 *
 * What it may buy (`quartermasterNode`): a Scrap-priced node with `kind: 'stat'` in a chassis tree (Ballistics,
 * Bastion, Reactor) or a hardpoint tree that is active (mounted). A chosen Doctrine's stat nodes count (the Doctrine
 * was the player's choice; its ramps are not). Never: mechanics, Exotics, anything Cores-priced, Doctrine choices,
 * element trees (attunement is a choice), Fusions / Triads / Linkages / Infusions, ability ranks, mounts, Refit,
 * Anomaly or Boon picks.
 *
 * One engine with the Upgrade Queue: both run inside the DirectivesSystem update (between and combat phases only)
 * and buy through economy/shop.ts, so prices, locks and Ev.Purchase are the shop's own. Precedence:
 *  1. the Upgrade Queue runs first on any tick both are due;
 *  2. the Quartermaster never takes Scrap below the price of the rank the Queue is saving for (its head), and
 *  3. never below `reserve`% of the Scrap on hand at the start of its pass, and
 *  4. spends only from its allowance: (100 − reserve)% of the Scrap on hand when it starts (switched on, reserve
 *     changed, a new Prestige, a load) plus (100 − reserve)% of all Scrap earned from kills since. Scrap that did
 *     not come from kills (offline return, Refit refunds, Seed Capital) stays the player's.
 *
 * A pass runs once per second of sim time (run.tick % QM_INTERVAL_TICKS === 0). It orders the enabled trees
 * (the player's order, else cheapest next rank first), then goes round-robin: one rank of the cheapest eligible
 * affordable node per tree per round, until nothing fits or QM_MAX_RANKS_PER_PASS ranks were bought. A pass that
 * buys emits one Ev.Quartermaster event first; its Purchase events name it as their cause and carry
 * data { via: 'quartermaster' }. Stats rebuild once at the end of the pass.
 *
 * Offline return (`offline_return`) only credits Scrap; it simulates no purchases, so the Quartermaster does not
 * run offline either, and the offline Scrap is not added to its allowance.
 */
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { Command, MetaState, QuartermasterRun, QuartermasterSettings, QuartermasterUi } from '../core/types';
import type { TreeId } from '../core/ids';
import { Ev, TICK_RATE } from '../core/types';
import { allNodes, nodeInfo, type NodeInfo } from '../core/content';
import { TREES } from '../data/index';
import { purchaseRank, quoteNode } from '../economy/shop';
import { ruleWants } from './upgrade-queue';

/** Prestiges needed before the Quartermaster works (hard-coded: no setting, save or command changes it). */
export const QM_UNLOCK_PRESTIGES = 1;
/** Ticks between passes: once per sim second. */
export const QM_INTERVAL_TICKS = TICK_RATE;
/** Most ranks one pass (= one second) buys. */
export const QM_MAX_RANKS_PER_PASS = 8;
/** The reserve choices (percent of Scrap kept for the player) and the default. */
export const QM_RESERVES: readonly number[] = [0, 25, 50, 75];
export const QM_DEFAULT_RESERVE = 25;

/** Trees the Quartermaster serves, in canonical (data) order: every chassis tree, then every hardpoint tree. */
export const QM_TREES: readonly TreeId[] = TREES.filter((t) => t.category === 'chassis' || t.category === 'hardpoint').map((t) => t.id);

export function defaultQuartermasterSettings(): QuartermasterSettings {
  return { on: false, reserve: QM_DEFAULT_RESERVE, trees: {}, order: [] };
}

/** THE rule: may the Quartermaster ever buy this node? (A stat ramp, Scrap-priced, in a chassis / hardpoint tree.) */
export function quartermasterNode(info: NodeInfo | undefined): boolean {
  if (!info || info.group !== 'tree' || !info.tree || !QM_TREES.includes(info.tree)) return false;
  const d = info.def;
  return d.kind === 'stat' && !info.exotic && !d.ability && !('cores' in d.cost);
}

let candCache: ReadonlyMap<TreeId, readonly NodeInfo[]> | null = null;
/** Eligible nodes per tree in content order (immutable content index, built once). */
function candidates(tree: TreeId): readonly NodeInfo[] {
  if (!candCache) {
    const m = new Map<TreeId, NodeInfo[]>();
    for (const t of QM_TREES) m.set(t, []);
    for (const info of allNodes()) if (quartermasterNode(info)) m.get(info.tree!)!.push(info);
    candCache = m;
  }
  return candCache.get(tree) ?? [];
}

export function quartermasterUnlocked(meta: Pick<MetaState, 'prestigeCount'>): boolean {
  return (meta.prestigeCount | 0) >= QM_UNLOCK_PRESTIGES;
}

/** Normalize stored / imported settings (unknown trees dropped, reserve snapped to a choice). Never throws. */
export function sanitizeQuartermaster(raw: unknown): QuartermasterSettings {
  const out = defaultQuartermasterSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Partial<QuartermasterSettings>;
  out.on = r.on === true;
  if (typeof r.reserve === 'number' && QM_RESERVES.includes(r.reserve)) out.reserve = r.reserve;
  if (r.trees && typeof r.trees === 'object' && !Array.isArray(r.trees)) {
    for (const t of QM_TREES) { const v = (r.trees as Record<string, unknown>)[t]; if (typeof v === 'boolean') out.trees[t] = v; }
  }
  if (Array.isArray(r.order)) for (const t of r.order) if (QM_TREES.includes(t) && !out.order.includes(t)) out.order.push(t);
  return out;
}

function settingsOf(meta: MetaState): QuartermasterSettings {
  let s = meta.settings.quartermaster;
  if (!s) s = meta.settings.quartermaster = defaultQuartermasterSettings();
  return s;
}

function runState(w: World): QuartermasterRun {
  let st = w.run.quartermaster;
  if (!st) st = w.run.quartermaster = { allowance: 0, earnedMark: (w as WorldImpl).scrapEarned ?? 0, active: false, bought: {}, spent: 0 };
  return st;
}

/** `set_quartermaster`: patch the settings. Returns an error or null. */
export function setQuartermaster(w: World, cmd: Extract<Command, { type: 'set_quartermaster' }>): string | null {
  if (!quartermasterUnlocked(w.meta)) return 'The Quartermaster unlocks after your first Prestige';
  if (cmd.reserve !== undefined && !QM_RESERVES.includes(cmd.reserve)) return `Reserve must be one of ${QM_RESERVES.join(', ')}%`;
  if (cmd.trees) for (const k of Object.keys(cmd.trees)) if (!QM_TREES.includes(k as TreeId)) return `The Quartermaster does not buy in ${k}`;
  if (cmd.order) for (const t of cmd.order) if (!QM_TREES.includes(t)) return `The Quartermaster does not buy in ${String(t)}`;
  const s = settingsOf(w.meta);
  let restart = false;
  if (cmd.on !== undefined && cmd.on !== s.on) { s.on = cmd.on; restart = true; }
  if (cmd.reserve !== undefined && cmd.reserve !== s.reserve) { s.reserve = cmd.reserve; restart = true; }
  if (cmd.trees) for (const t of QM_TREES) { const v = cmd.trees[t]; if (typeof v === 'boolean') s.trees[t] = v; }
  if (cmd.order) { s.order = []; for (const t of cmd.order) if (!s.order.includes(t)) s.order.push(t); }
  if (restart && w.run.quartermaster) w.run.quartermaster.active = false;   // the next pass starts a fresh allowance
  return null;
}

/** Is a pass due this tick? (Once per sim second.) */
export function quartermasterDue(w: World): boolean { return w.run.tick % QM_INTERVAL_TICKS === 0; }

/**
 * Scrap the Upgrade Queue is saving for: the price of the first rule that wants a rank and can be bought (the rank
 * `runUpgradeQueue` buys next or waits for), 0 when the Queue is locked, empty, satisfied or stuck on a Cores price.
 */
export function queueHold(w: WorldImpl): number {
  const rules = w.meta.upgradeQueue;
  if (!rules || rules.length === 0 || !w.stats.has('prestige.directives')) return 0;
  for (const r of rules) {
    if (!ruleWants(w, r)) continue;
    const info = nodeInfo(r.node);
    if (!info) continue;
    const q = quoteNode(w, info);
    if (!q.visible || q.locked) continue;
    if (q.currency === 'cores') { if (w.run.cores < q.cost) return 0; continue; }
    return q.cost;
  }
  return 0;
}

/** Enabled, active trees in pass order: the player's order first (then the rest in data order), or cheapest next rank first. */
function passOrder(w: WorldImpl, s: QuartermasterSettings): TreeId[] {
  const out: TreeId[] = [];
  const add = (t: TreeId): void => { if (!out.includes(t) && s.trees[t] !== false && w.stats.treeActive(t)) out.push(t); };
  if (s.order.length) { for (const t of s.order) add(t); for (const t of QM_TREES) add(t); return out; }
  for (const t of QM_TREES) add(t);
  const price = out.map((t) => cheapest(w, t, Infinity)?.cost ?? Infinity);
  const idx = out.map((_, i) => i).sort((a, b) => (price[a] - price[b]) || (a - b));   // total order: price, then data order
  return idx.map((i) => out[i]);
}

/** Cheapest eligible, visible, unlocked node in `tree` whose next rank costs ≤ limit (ties: content order). */
function cheapest(w: WorldImpl, tree: TreeId, limit: number): { info: NodeInfo; cost: number } | null {
  let best: NodeInfo | null = null, bestCost = Infinity;
  for (const info of candidates(tree)) {
    const q = quoteNode(w, info);
    if (!q.visible || q.locked || q.currency !== 'scrap' || q.cost > limit) continue;
    if (q.cost < bestCost) { best = info; bestCost = q.cost; }
  }
  return best ? { info: best, cost: bestCost } : null;
}

/**
 * One pass (the DirectivesSystem calls it when `quartermasterDue`; tests may call it directly). Returns ranks bought.
 * Updates the allowance even while off (so switching on never spends Scrap earned while it was off).
 */
export function runQuartermaster(w: World): number {
  const wi = w as WorldImpl, run = w.run, meta = w.meta;
  if (run.phase !== 'between' && run.phase !== 'combat') return 0;
  const st = runState(w);
  const s = meta.settings.quartermaster;
  const earned = wi.scrapEarned;
  if (!s || !s.on || !quartermasterUnlocked(meta)) { st.active = false; st.earnedMark = earned; return 0; }
  const keep = QM_RESERVES.includes(s.reserve) ? s.reserve / 100 : QM_DEFAULT_RESERVE / 100;
  if (!st.active) { st.active = true; st.allowance = run.scrap * (1 - keep); }
  else st.allowance += Math.max(0, earned - st.earnedMark) * (1 - keep);
  st.earnedMark = earned;
  st.allowance = Math.max(0, Math.min(st.allowance, run.scrap));
  const floor = Math.max(run.scrap * keep, queueHold(wi));
  const trees = passOrder(wi, s);
  let bought = 0, cause = -1;
  for (let progress = true; progress && bought < QM_MAX_RANKS_PER_PASS;) {
    progress = false;
    for (const t of trees) {
      if (bought >= QM_MAX_RANKS_PER_PASS) break;
      const limit = Math.min(st.allowance, run.scrap - floor);
      if (!(limit > 0)) break;
      const pick = cheapest(wi, t, limit);
      if (!pick) continue;
      if (cause < 0) cause = wi.emit(Ev.Quartermaster, 'quartermaster', Math.floor(run.scrap), Math.floor(st.allowance), 0, 0, -1);
      if (purchaseRank(wi, pick.info.def.id, cause, { via: 'quartermaster' }) !== null) continue;
      st.allowance -= pick.cost; st.spent += pick.cost;
      st.bought[t] = (st.bought[t] ?? 0) + 1;
      bought++; progress = true;
    }
  }
  if (bought > 0) wi.rebuildStats();
  return bought;
}

/** UiState.quartermaster. Allocates (≤ 10 Hz). */
export function quartermasterUi(w: WorldImpl): QuartermasterUi {
  const s = w.meta.settings.quartermaster ?? defaultQuartermasterSettings();
  const st = w.run.quartermaster;
  const order: TreeId[] = [];
  for (const t of [...s.order, ...QM_TREES]) if (!order.includes(t) && w.stats.treeActive(t)) order.push(t);
  let total = 0;
  for (const t of QM_TREES) total += st?.bought[t] ?? 0;
  return {
    unlocked: quartermasterUnlocked(w.meta), on: s.on, reserve: s.reserve,
    trees: order.map((tree) => ({ tree, on: s.trees[tree] !== false, bought: st?.bought[tree] ?? 0 })),
    order: [...s.order], boughtThisRun: total, scrapSpentThisRun: st?.spent ?? 0,
  };
}
