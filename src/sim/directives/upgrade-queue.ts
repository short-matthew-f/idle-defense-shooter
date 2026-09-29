/**
 * Upgrade Queue (design §11): an ordered Scrap/Core buy list with keep-pace rules. WP9.
 *
 * Unlocked by `prestige.directives`. The Directives system calls `runUpgradeQueue` during the
 * `between` phase and every 2 s of combat. Rules (`meta.upgradeQueue`) are walked in order:
 *  - a rule is SATISFIED (skipped) when its node is at `maxRank` (rule cap or the node's own max),
 *    or, for `keepWithin: { of, ranks }`, while rank(node) ≥ rank(of) − ranks
 *    ("keep Barrier within 3 ranks of Armor" buys Barrier only when it falls more than 3 behind);
 *  - an UNAVAILABLE rule (unknown node, not visible, locked by requirements) is skipped;
 *  - otherwise the rule wants a rank: buy it through economy/shop.ts `purchase` and re-walk from the
 *    top; if it is unaffordable, STOP — later rules wait (the queue saves up for its head).
 * At most `maxBuys` purchases per call.
 */
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { UpgradeRule } from '../core/types';
import { nodeInfo } from '../core/content';
import { purchase } from '../economy/shop';

const MAX_BUYS = 32;

function purchasedRank(w: World, node: string): number { return w.build.ranks[node] | 0; }

/** Does this rule want another rank right now? */
export function ruleWants(w: World, r: UpgradeRule): boolean {
  const info = nodeInfo(r.node);
  const cap = Math.min(r.maxRank ?? Infinity, info ? info.def.maxRank : Infinity);
  const rank = purchasedRank(w, r.node);
  if (rank >= cap) return false;
  if (r.keepWithin) return rank < purchasedRank(w, r.keepWithin.of) - Math.max(0, r.keepWithin.ranks);
  return true;
}

/** Normalize rules from a command (drops malformed entries). Allocates; command-time only. */
export function sanitizeRules(rules: unknown): UpgradeRule[] {
  if (!Array.isArray(rules)) return [];
  const out: UpgradeRule[] = [];
  for (const r of rules as UpgradeRule[]) {
    if (!r || typeof r.node !== 'string' || !r.node) continue;
    const rule: UpgradeRule = { node: r.node };
    if (typeof r.maxRank === 'number' && r.maxRank >= 0) rule.maxRank = Math.floor(r.maxRank);
    if (r.keepWithin && typeof r.keepWithin.of === 'string') rule.keepWithin = { of: r.keepWithin.of, ranks: Math.max(0, Math.floor(Number(r.keepWithin.ranks) || 0)) };
    out.push(rule);
  }
  return out;
}

/** Walk the queue once; returns the number of ranks bought. */
export function runUpgradeQueue(w: World, maxBuys = MAX_BUYS): number {
  const rules = w.meta.upgradeQueue;
  if (!rules || rules.length === 0) return 0;
  let bought = 0;
  let k = 0;
  while (k < rules.length && bought < maxBuys) {
    const r = rules[k];
    if (!ruleWants(w, r)) { k++; continue; }
    const err = purchase(w as WorldImpl, r.node);
    if (err === null) { bought++; k = 0; continue; }
    if (err === 'Not enough Scrap' || err === 'Not enough Cores') break;   // save up for the head of the queue
    k++;                                                                   // unavailable / locked: skip
  }
  return bought;
}
