/**
 * Anomaly drafts (design §9): three offers weighted toward the current build; at most one offer
 * needs a system/element the build lacks. Offers are a pure function of (seed, wave, reroll count,
 * build), so a draft is reproducible. Returns [] when there is no Anomaly content.
 *
 * Drafts never auto-pick: the offer waits for the player while the run continues, and later draft
 * waves queue behind it (RunState.draftWave / draftQueue).
 */
import type { AnomalyId } from '../core/ids';
import type { AnomalyDef } from '../data/schema';
import type { WorldImpl } from '../core/world-impl';
import { Prng, combineSeed } from '../math/prng';
import { allAnomalies } from '../core/content';
import { offerRevealed } from './reveal';   // ladder-aware offers (never name an unrevealed system)
import { codexAnomalyWeight } from '../economy/codex';   // WP8: Codex milestones weight non-Common offers

const RARITY_WEIGHT: Record<string, number> = { common: 5, rare: 3, cursed: 2, paradox: 1 };

function poolAllowed(w: WorldImpl, a: AnomalyDef): boolean {
  switch (a.pool) {
    case 'base': return true;
    case 'echo': return w.meta.ascension >= 1;
    case 'paradox_extra': return (w.meta.prestigeRanks['prestige.paradox_pool'] | 0) > 0;
    case 'rot': return (w.meta.trials.pacifist_core ?? 0) > 0;
    case 'mythic': return w.meta.ascension > 5;
    default: return false;
  }
}

export function needsMet(w: WorldImpl, a: AnomalyDef): boolean {
  if (!a.needs || a.needs.length === 0) return true;
  return a.needs.every((n) => n === 'primary' || w.stats.mounted(n) || w.stats.attuned(n));
}

export function rollDraft(w: WorldImpl, wave: number, rerolls: number): AnomalyId[] {
  const rng = new Prng(combineSeed(w.run.prestigeSeed, 0xd4af7, wave, rerolls));
  const paradoxBoost = 1 + Math.max(0, w.stats.get('prestige.paradox_pool'));   // WP8: Paradox Pool +50%/rank
  const cands = allAnomalies().filter((a) => poolAllowed(w, a) && offerRevealed(w, a) && !w.build.anomalies.includes(a.id));
  const out: AnomalyId[] = [];
  let lacking = 0;
  for (let pick = 0; pick < 3; pick++) {
    const items: AnomalyDef[] = [], weights: number[] = [];
    for (const a of cands) {
      if (out.includes(a.id)) continue;
      const met = needsMet(w, a);
      if (!met && lacking >= 1) continue;
      items.push(a);
      weights.push((RARITY_WEIGHT[a.rarity] ?? 1) * (a.rarity === 'paradox' ? paradoxBoost : 1) * (met ? 3 : 1) * codexAnomalyWeight(w.meta, a.rarity));
    }
    if (items.length === 0) break;
    const a = rng.pickWeighted(items, weights);
    if (!needsMet(w, a)) lacking++;
    out.push(a.id);
  }
  return out;
}
