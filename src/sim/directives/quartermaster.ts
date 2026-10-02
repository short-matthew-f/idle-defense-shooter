/**
 * Quartermaster: automation as a reward. From the first Prestige on (meta.prestigeCount ≥ 1, hard-coded here so a
 * first run can never switch it on), it keeps the repeatable STAT ranks topped up from its OWN BANK. It never makes a
 * choice for the player and never touches the player's Scrap. docs/QUARTERMASTER.md has the player-facing rules and
 * the measured effect.
 *
 * What it may buy (`quartermasterNode`): a Scrap-priced node with `kind: 'stat'` in a chassis tree (Ballistics,
 * Bastion, Reactor) or a hardpoint tree that is active (mounted). A chosen Doctrine's stat nodes count (the Doctrine
 * was the player's choice; its ramps are not). Never: mechanics, Exotics, anything Cores-priced, Doctrine choices,
 * element trees (attunement is a choice), Fusions / Triads / Linkages / Infusions, ability ranks, mounts, Refit,
 * Anomaly or Boon picks.
 *
 * The bank (run.quartermaster.bank, saved with the run):
 *  - IN: while it is on, unlocked and not idle, World.addScrap(amount) sends amount × share / 100 to the bank and the
 *    rest to run.scrap (`quartermasterShare`). Kills, salvage crates and the Reactor dividend go through addScrap.
 *    Scrap that does not (Seed Capital, offline return, Refit refunds) or that passes divert = false (the Prestige
 *    perk Checkpoint Dividend, run/prestige.ts) stays 100% the player's. scrapEarned / waveScrap count the gross.
 *  - OUT: a pass buys only from the bank (no floor, no reserve, never the player's Scrap). The player's own buys
 *    never touch the bank. The Upgrade Queue spends the player's Scrap and is unaffected.
 *  - RELEASE: switching it off, switching every tree off, or going idle (no enabled tree has anything it could ever
 *    buy: all maxed, locked or hidden, not merely unaffordable) moves the whole bank into run.scrap at once.
 *    Changing the share keeps the bank. A new Prestige / Ascension / Trial start begins a new run, so the bank resets
 *    with the run's Scrap; a death or restart keeps it, like Scrap. A Trial parks it with the main run.
 *
 * A pass runs once per second of sim time (run.tick % QM_INTERVAL_TICKS === 0), between waves and in combat (the
 * DirectivesSystem calls it after the Upgrade Queue). It orders the enabled trees (the player's order, else cheapest
 * next rank first), then goes round-robin: one rank of the cheapest eligible node per tree per round whose price fits
 * the bank, until nothing fits or QM_MAX_RANKS_PER_PASS ranks were bought. A pass that buys emits one Ev.Quartermaster
 * event first; its Purchase events name it as their cause and carry data { via: 'quartermaster' }. Stats rebuild once
 * at the end of the pass.
 *
 * Offline return (`offline_return`) only credits Scrap (all of it the player's); the Quartermaster does not run offline.
 */
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { Command, MetaState, QuartermasterRun, QuartermasterSettings, QuartermasterUi } from '../core/types';
import type { TreeId } from '../core/ids';
import { Ev, TICK_RATE } from '../core/types';
import { allNodes, type NodeInfo } from '../core/content';
import { TREES } from '../data/index';
import { purchaseRank, quoteNode } from '../economy/shop';

/** Prestiges needed before the Quartermaster works (hard-coded: no setting, save or command changes it). */
export const QM_UNLOCK_PRESTIGES = 1;
/** Ticks between passes: once per sim second. */
export const QM_INTERVAL_TICKS = TICK_RATE;
/** Most ranks one pass (= one second) buys. */
export const QM_MAX_RANKS_PER_PASS = 8;
/** The share choices (percent of incoming Scrap sent to its bank) and the default. */
export const QM_SHARES: readonly number[] = [10, 25, 50, 75, 100];
export const QM_DEFAULT_SHARE = 50;

/** Trees the Quartermaster serves, in canonical (data) order: every chassis tree, then every hardpoint tree. */
export const QM_TREES: readonly TreeId[] = TREES.filter((t) => t.category === 'chassis' || t.category === 'hardpoint').map((t) => t.id);

export function defaultQuartermasterSettings(): QuartermasterSettings {
  return { on: false, share: QM_DEFAULT_SHARE, trees: {}, order: [] };
}

/** Save v2 → v3: a legacy reserve r (percent of Scrap kept for the player) becomes the share option nearest 100 − r. */
export function shareFromReserve(reserve: unknown): number {
  const r = typeof reserve === 'number' && Number.isFinite(reserve) ? reserve : 100 - QM_DEFAULT_SHARE;
  let best = QM_SHARES[0];
  for (const s of QM_SHARES) if (Math.abs(s - (100 - r)) < Math.abs(best - (100 - r))) best = s;
  return best;
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

/** Normalize stored / imported settings (unknown trees dropped, a share that is not offered → default). Never throws. */
export function sanitizeQuartermaster(raw: unknown): QuartermasterSettings {
  const out = defaultQuartermasterSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Partial<QuartermasterSettings>;
  out.on = r.on === true;
  if (typeof r.share === 'number' && QM_SHARES.includes(r.share)) out.share = r.share;
  if (r.trees && typeof r.trees === 'object' && !Array.isArray(r.trees)) {
    for (const t of QM_TREES) { const v = (r.trees as Record<string, unknown>)[t]; if (typeof v === 'boolean') out.trees[t] = v; }
  }
  if (Array.isArray(r.order)) for (const t of r.order) if (QM_TREES.includes(t) && !out.order.includes(t)) out.order.push(t);
  return out;
}

/** Repair a saved run state (save v3+; junk → empty). Never throws. */
export function sanitizeQuartermasterRun(raw: unknown): QuartermasterRun | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Partial<QuartermasterRun>;
  const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const bought: Partial<Record<TreeId, number>> = {};
  if (r.bought && typeof r.bought === 'object' && !Array.isArray(r.bought)) {
    for (const t of QM_TREES) { const v = (r.bought as Record<string, unknown>)[t]; if (typeof v === 'number' && Number.isFinite(v) && v > 0) bought[t] = Math.floor(v); }
  }
  return { bank: fin(r.bank), idle: r.idle === true, bought, spent: fin(r.spent) };
}

function settingsOf(meta: MetaState): QuartermasterSettings {
  let s = meta.settings.quartermaster;
  if (!s) s = meta.settings.quartermaster = defaultQuartermasterSettings();
  return s;
}

function runState(w: World): QuartermasterRun {
  let st = w.run.quartermaster;
  if (!st) st = w.run.quartermaster = { bank: 0, idle: false, bought: {}, spent: 0 };
  return st;
}

/** Move the whole bank into the player's Scrap (one Ev.Quartermaster 'quartermaster.release' event when non-empty). */
function release(w: World, st: QuartermasterRun): void {
  const amount = st.bank;
  st.bank = 0;
  if (!(amount > 0)) return;
  w.run.scrap += amount;
  w.emit(Ev.Quartermaster, 'quartermaster.release', Math.floor(amount), 0, 0, 0, -1);
}

/**
 * Percent of an addScrap income that goes to the bank right now: the share while it is on, unlocked and not idle,
 * else 0. World.addScrap calls it (creating the run state when it diverts).
 */
export function quartermasterShare(w: World): number {
  const s = w.meta.settings.quartermaster;
  if (!s || !s.on || !quartermasterUnlocked(w.meta)) return 0;
  const st = w.run.quartermaster;
  if (st?.idle) return 0;
  return QM_SHARES.includes(s.share) ? s.share : QM_DEFAULT_SHARE;
}

/** World.addScrap's split: banks share% of `amount` and returns what goes to the player's Scrap. */
export function divertIncome(w: World, amount: number): number {
  const share = quartermasterShare(w);
  if (!(share > 0)) return amount;
  const banked = (amount * share) / 100;
  runState(w).bank += banked;
  return amount - banked;
}

/** `set_quartermaster`: patch the settings. Returns an error or null. */
export function setQuartermaster(w: World, cmd: Extract<Command, { type: 'set_quartermaster' }>): string | null {
  if (!quartermasterUnlocked(w.meta)) return 'The Quartermaster unlocks after your first Prestige';
  if (cmd.share !== undefined && !QM_SHARES.includes(cmd.share)) return `Share must be one of ${QM_SHARES.join(', ')}%`;
  if (cmd.trees) for (const k of Object.keys(cmd.trees)) if (!QM_TREES.includes(k as TreeId)) return `The Quartermaster does not buy in ${k}`;
  if (cmd.order) for (const t of cmd.order) if (!QM_TREES.includes(t)) return `The Quartermaster does not buy in ${String(t)}`;
  const s = settingsOf(w.meta);
  if (cmd.on !== undefined) s.on = cmd.on;
  if (cmd.share !== undefined) s.share = cmd.share;   // the bank is kept
  if (cmd.trees) for (const t of QM_TREES) { const v = cmd.trees[t]; if (typeof v === 'boolean') s.trees[t] = v; }
  if (cmd.order) { s.order = []; for (const t of cmd.order) if (!s.order.includes(t)) s.order.push(t); }
  // Off releases the bank now; on (or a tree switch) re-checks idle now, so diversion never waits for the next pass.
  const st = runState(w);
  if (!s.on) { st.idle = false; release(w, st); }
  else settleIdle(w as WorldImpl, st, nextRanks(w as WorldImpl, enabledTrees(w as WorldImpl, s)));
  return null;
}

/** Is a pass due this tick? (Once per sim second.) */
export function quartermasterDue(w: World): boolean { return w.run.tick % QM_INTERVAL_TICKS === 0; }

/** Enabled, active trees in data order. */
function enabledTrees(w: WorldImpl, s: QuartermasterSettings): TreeId[] {
  return QM_TREES.filter((t) => s.trees[t] !== false && w.stats.treeActive(t));
}

/** The next rank it could ever buy in each tree (cheapest visible, unlocked, not maxed; any price), or null. */
function nextRanks(w: WorldImpl, trees: readonly TreeId[]): ({ info: NodeInfo; cost: number } | null)[] {
  return trees.map((t) => cheapest(w, t, Infinity));
}

/** Idle = no enabled tree has anything it could ever buy: release the bank and stop diverting. Returns idle. */
function settleIdle(w: WorldImpl, st: QuartermasterRun, next: readonly ({ cost: number } | null)[]): boolean {
  st.idle = next.every((n) => n === null);
  if (st.idle) release(w, st);
  return st.idle;
}

/** Pass order: the player's order first (then the rest in data order), or cheapest next rank first. */
function passOrder(s: QuartermasterSettings, trees: readonly TreeId[], next: readonly ({ cost: number } | null)[]): TreeId[] {
  if (s.order.length) {
    const out: TreeId[] = [];
    for (const t of [...s.order, ...trees]) if (!out.includes(t) && trees.includes(t)) out.push(t);
    return out;
  }
  const price = next.map((n) => n?.cost ?? Infinity);
  const idx = trees.map((_, i) => i).sort((a, b) => (price[a] - price[b]) || (a - b));   // total order: price, then data order
  return idx.map((i) => trees[i]);
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
 * Pays only from the bank: each rank's price moves from the bank to run.scrap for exactly the purchase, so the
 * player's own Scrap is restored to the same value whatever the shop does.
 */
export function runQuartermaster(w: World): number {
  const wi = w as WorldImpl, run = w.run, meta = w.meta;
  const s = meta.settings.quartermaster;
  if (!s || !s.on || !quartermasterUnlocked(meta)) {
    const st = run.quartermaster;
    if (st) { st.idle = false; if (st.bank > 0) release(w, st); }   // nothing stays banked while it is off
    return 0;
  }
  if (run.phase !== 'between' && run.phase !== 'combat') return 0;
  const st = runState(w);
  const enabled = enabledTrees(wi, s);
  const next = nextRanks(wi, enabled);
  if (settleIdle(wi, st, next)) return 0;
  const trees = passOrder(s, enabled, next);
  let bought = 0, cause = -1;
  for (let progress = true; progress && bought < QM_MAX_RANKS_PER_PASS;) {
    progress = false;
    for (const t of trees) {
      if (bought >= QM_MAX_RANKS_PER_PASS) break;
      if (!(st.bank > 0)) break;
      const pick = cheapest(wi, t, st.bank);
      if (!pick) continue;
      if (cause < 0) cause = wi.emit(Ev.Quartermaster, 'quartermaster', Math.floor(st.bank), s.share, 0, 0, -1);
      const wallet = run.scrap;
      run.scrap = pick.cost;                      // the bank pays: exactly this rank's price, nothing of the player's
      const err = purchaseRank(wi, pick.info.def.id, cause, { via: 'quartermaster' });
      run.scrap = wallet;
      if (err !== null) continue;
      st.bank -= pick.cost; st.spent += pick.cost;
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
    unlocked: quartermasterUnlocked(w.meta), on: s.on, share: s.share, bank: st?.bank ?? 0, idle: !!s.on && !!st?.idle,
    trees: order.map((tree) => ({ tree, on: s.trees[tree] !== false, bought: st?.bought[tree] ?? 0 })),
    order: [...s.order], boughtThisRun: total, scrapSpentThisRun: st?.spent ?? 0,
  };
}
