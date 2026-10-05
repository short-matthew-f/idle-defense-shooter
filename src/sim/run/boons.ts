/**
 * Boon offers (docs/BOONS.md). Boons are attempt-scoped rewards the player picks; the sim never picks one.
 *
 *  When      the start of every attempt except the first of a Prestige (after a death, a restart, a save load
 *            or the end of a Trial: each resumes as a fresh attempt), and every boss wave the tower clears in
 *            Push (in practice always a first clear: attempts start after the last cleared boss).
 *            No offers in Patrol (active boons still apply there).
 *  Offer     three cards, a pure function of (prestige seed, wave, attempt index, reroll count, build): weighted
 *            toward boons whose `needs` the build has, at most one card needing something the build lacks, never
 *            an active boon, never three of one category when another is available, never a boon the unlock ladder
 *            has not revealed (run/reveal.ts: abilities / CE before wave 12, systems outside the content pool). The first offer of a Prestige
 *            draws only stat surges.
 *  Waiting   an offer waits until the player picks, rerolls or declines (no timeout). A boss clear while an
 *            offer is pending merges into it (no second offer in a row; Ev.BoonOffer 'merged'). The run holds in
 *            `between` after a boss clear while a decision is pending, at most BOSS_HOLD_TICKS (run/machine.ts).
 *  Actions   pick (at BOON_CAP the named `replace`, else the oldest, is dropped), reroll (boonRerolls + 1 Cores:
 *            1, then 2, ...), decline (free, gives nothing). Directives / Autocast / the Upgrade Queue cannot
 *            issue them (World.enqueueCommand and Sim.step drop them; validate.ts rejects `viaDirective`).
 *  Lifetime  build.boons, the offer and the queue are cleared at every attempt start (then the start offer
 *            opens) and with every new run (Prestige, Ascension, Trial start and end: the parked run comes back
 *            without its old offer and gets a fresh start offer). A save load is a fresh attempt too (active
 *            boons cleared), but an undecided offer the save carried (with its queue and paid rerolls) stays
 *            pending instead of the start offer, so a reload never trades an offer away or rerolls it for free.
 *  Used up   Second Chance, once it fires, is gone for the rest of the attempt (run.boonSpent); Windfall frees
 *            its slot too but may be offered and picked again.
 */
import type { BoonId } from '../core/ids';
import type { BoonDef } from '../data/schema';
import type { Command } from '../core/types';
import type { WorldImpl } from '../core/world-impl';
import { Ev } from '../core/types';
import { Prng, combineSeed } from '../math/prng';
import { allBoons, boonDef } from '../core/content';
import { BOON_CAP, BOON_QUEUE_CAP } from '../data/boons';
import { FUSIONS } from '../data/index';
import { registerEntry } from '../economy/codex';
import { offerRevealed } from './reveal';   // ladder-aware offers

export { BOON_CAP, BOON_QUEUE_CAP };

const RARITY_WEIGHT: Record<string, number> = { common: 3, rare: 1.5 };
const BOON_SALT = 0xb0075;
/** One-use boons that, once used, stay gone for the rest of the attempt (run.boonSpent). */
const ONCE_PER_ATTEMPT: readonly BoonId[] = ['second_chance'];

/** Is this boon used up for the current attempt (never offered or picked again until the next one)? */
export function boonUsedUp(run: { boonSpent?: BoonId[] }, id: BoonId): boolean {
  return ONCE_PER_ATTEMPT.includes(id) && !!run.boonSpent && run.boonSpent.includes(id);
}

/** The Commands only a player may send. */
export function isBoonCommand(cmd: Pick<Command, 'type'> | null | undefined): boolean {
  const t = cmd?.type;
  return t === 'pick_boon' || t === 'reroll_boon' || t === 'decline_boon';
}

/** Cores the next reroll of the pending offer costs. */
export function boonRerollCost(run: { boonRerolls: number }): number { return (run.boonRerolls | 0) + 1; }

/** Does the build have what this boon needs ('fusion' = any Fusion active)? */
export function boonNeedsMet(w: WorldImpl, b: BoonDef): boolean {
  if (!b.needs || b.needs.length === 0) return true;
  return b.needs.every((n) => n === 'fusion' ? FUSIONS.some((f) => w.stats.has(f.node.id)) : w.stats.mounted(n) || w.stats.attuned(n));
}

/**
 * Three boon ids for an offer (fewer only when the pool runs dry). Pure in (seed, wave, attempt, rerolls,
 * kind, build): the simulator and tests reproduce every offer.
 */
export function rollBoons(w: WorldImpl, wave: number, attempt: number, rerolls: number, kind: 'start' | 'boss', firstOnly: boolean): BoonId[] {
  const rng = new Prng(combineSeed(w.run.prestigeSeed, BOON_SALT, wave, attempt, rerolls, kind === 'boss' ? 1 : 0));
  const active = w.build.boons;
  const cands = allBoons().filter((b) => !active.includes(b.id) && !boonUsedUp(w.run, b.id) && offerRevealed(w, b) && (!firstOnly || b.category === 'surge'));
  const out: BoonDef[] = [];
  let lacking = 0;
  for (let pick = 0; pick < 3; pick++) {
    // never three of one category while another category is still on the table
    const sameCat = out.length === 2 && out[0].category === out[1].category ? out[0].category : null;
    const otherCat = sameCat !== null && cands.some((b) => !out.includes(b) && b.category !== sameCat);
    const items: BoonDef[] = [], weights: number[] = [];
    for (const b of cands) {
      if (out.includes(b)) continue;
      if (otherCat && b.category === sameCat) continue;
      const met = boonNeedsMet(w, b);
      if (!met && lacking >= 1) continue;
      items.push(b);
      const hasNeeds = !!b.needs && b.needs.length > 0;
      weights.push((RARITY_WEIGHT[b.rarity] ?? 1) * (!met ? 0.5 : hasNeeds ? 4 : 2));
    }
    if (items.length === 0) break;
    const b = rng.pickWeighted(items, weights);
    if (!boonNeedsMet(w, b)) lacking++;
    out.push(b);
  }
  return out.map((b) => b.id);
}

/** Open an offer now (the pending one must be resolved first). An empty roll moves on to the queue. */
export function openBoonOffer(w: WorldImpl, kind: 'start' | 'boss', wave: number): void {
  const run = w.run;
  const firstOnly = !run.boonsSeenFirst;
  const offers = rollBoons(w, wave, run.attempts, 0, kind, firstOnly);
  run.boonRerolls = 0;
  if (offers.length === 0) { nextBoonOffer(w); return; }
  run.boonOffer = offers; run.boonOfferWave = wave; run.boonOfferKind = kind;
  run.boonsSeenFirst = true;
  run.boonOfferSeq++;
  w.emit(Ev.BoonOffer, kind, run.boonOfferSeq, 0, 0, 0, -1);
}

/** The pending offer resolved: bring up the next queued boss offer, if any. */
export function nextBoonOffer(w: WorldImpl): void {
  const run = w.run;
  run.boonOffer = null; run.boonRerolls = 0;
  const next = run.boonQueue.shift();
  if (next !== undefined) openBoonOffer(w, 'boss', next);
}

/**
 * A boss was cleared (Push only): offer now. With an offer still pending the boss offer MERGES into it (UX Phase 1:
 * never two offers in a row): the pending cards stand for this boss too and nothing is queued. The player still
 * picks, rerolls or declines it; nothing is picked for them. (Queues carried by older saves still drain.)
 */
export function offerForBossClear(w: WorldImpl, wave: number): void {
  const run = w.run;
  if (run.mode !== 'push') return;
  if (run.boonOffer && run.boonOffer.length > 0) {
    w.emit(Ev.BoonOffer, 'merged', run.boonOfferSeq, run.boonRerolls, wave, 0, -1);
    return;
  }
  openBoonOffer(w, 'boss', wave);
}

/** Drop every active boon, the pending offer and the queue (attempt start, Prestige, Ascension, Trials). No stat rebuild. */
export function clearBoons(w: WorldImpl): void {
  const run = w.run;
  w.build.boons = [];
  run.boonOffer = null; run.boonRerolls = 0; run.boonQueue = []; run.boonSpent = [];
}

/** Player pick. At the cap, `replace` (an active boon) or else the oldest is dropped. */
export function pickBoon(w: WorldImpl, id: BoonId, replace?: BoonId): string | null {
  const run = w.run, b = w.build;
  if (!run.boonOffer || run.boonOffer.length === 0) return 'No boon offer pending';
  if (!run.boonOffer.includes(id)) return 'That boon is not on offer';
  if (!boonDef(id)) return 'Unknown boon';
  if (b.boons.includes(id)) return 'That boon is already active';
  if (boonUsedUp(run, id)) return `${boonDef(id)!.name} is used up for this attempt`;
  if (replace !== undefined && !b.boons.includes(replace)) return 'The boon to replace is not active';
  let dropped = -1;
  if (b.boons.length >= BOON_CAP) {
    const at = replace !== undefined ? b.boons.indexOf(replace) : 0;
    dropped = at;
    b.boons.splice(at, 1);
  }
  b.boons.push(id);
  const ev = w.emit(Ev.BoonPicked, id, b.boons.length, dropped, 0, 0, -1);
  registerEntry(w, `boon.${id}`, ev);   // Codex: first pick of each boon
  w.rebuildStats();
  nextBoonOffer(w);
  return null;
}

/** Player reroll: boonRerolls + 1 Cores. */
export function rerollBoon(w: WorldImpl): string | null {
  const run = w.run;
  if (!run.boonOffer || run.boonOffer.length === 0) return 'No boon offer pending';
  const cost = boonRerollCost(run);
  if (run.cores < cost) return `Not enough Cores (reroll costs ${cost})`;
  const offers = rollBoons(w, run.boonOfferWave, run.attempts, run.boonRerolls + 1, run.boonOfferKind, run.boonOfferSeq === 1);
  if (offers.length === 0) return 'Nothing else to offer';
  run.cores -= cost;
  run.boonRerolls++;
  run.boonOffer = offers;
  w.emit(Ev.BoonOffer, 'reroll', run.boonOfferSeq, run.boonRerolls, 0, 0, -1);
  return null;
}

/** Player decline: free, gives nothing. */
export function declineBoon(w: WorldImpl): string | null {
  const run = w.run;
  if (!run.boonOffer || run.boonOffer.length === 0) return 'No boon offer pending';
  w.emit(Ev.BoonPicked, 'decline', w.build.boons.length, -1, 0, 0, -1);
  nextBoonOffer(w);
  return null;
}
