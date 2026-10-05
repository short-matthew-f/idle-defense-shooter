/**
 * Ladder-aware offers (docs/BOONS.md "Ladder"): boons, Anomaly drafts and their rerolls never offer something the
 * player has not been shown yet. An offer is withheld (weight 0) when
 *   - its `reveal` names 'abilities' and abilities are not revealed (best wave < ABILITIES_REVEAL_WAVE, no Prestige), or
 *   - its `reveal` or `needs` names an element / hardpoint outside the content pool at the current Prestige count that
 *     the build does not own (data/content-pool.ts, the same table the UI's slot pickers use).
 * Pure in (meta, run, build): offers stay reproducible.
 */
import type { WorldImpl } from '../core/world-impl';
import type { OfferReveal } from '../data/schema';
import { abilitiesRevealed, CONTENT_POOL, poolPrestige } from '../data/content-pool';

/** Best wave cleared as the unlock ladder counts it (max of the lifetime and this run). */
export function bestWave(w: WorldImpl): number { return Math.max(w.meta.deepestEver | 0, w.run.deepestCleared | 0); }

const inPoolTable = (id: string): boolean => id in CONTENT_POOL.elements || id in CONTENT_POOL.hardpoints;

/** Is every reveal gate of this offer open for the player now? */
export function offerRevealed(w: WorldImpl, d: { needs?: readonly string[]; reveal?: readonly OfferReveal[] }): boolean {
  const pc = w.meta.prestigeCount | 0;
  const gates: readonly string[] = d.reveal ?? [];
  for (const g of gates) if (g === 'abilities' && !abilitiesRevealed(bestWave(w), pc)) return false;
  for (const list of [gates, d.needs ?? []]) {
    for (const id of list) {
      if (!inPoolTable(id) || pc >= poolPrestige(id)) continue;
      if (!(w.stats.mounted(id as never) || w.stats.attuned(id as never))) return false;
    }
  }
  return true;
}
