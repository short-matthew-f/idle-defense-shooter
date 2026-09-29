/**
 * Chain Codex (design §16). Every distinct interaction the simulation logs is an entry: each
 * Fusion, Triad, Linkage, Infusion, Anomaly and Counter `src` seen in the event log, plus kill
 * chains of 3, 5, 8 and 12 links (EventLog depth of the Kill event). An entry is discovered once:
 * `meta.codex[id] = 1` and an `Ev.Codex` event (src = entry id, a = entries discovered).
 *
 * Each discovered entry gives +0.25% damage and Scrap: StatResolver multiplies `combat.power_mul`
 * and `economy.scrap_mul` by `codexMultiplier(meta)` (and Prestige Echoes use it too).
 * Milestones at 10 / 25 / 50 entries unlock palettes (`meta.palettes`) and add Anomaly draft
 * weight for Rare / Paradox / Cursed offers (`codexAnomalyWeight`).
 *
 * Pure except `scanCodexEvent` / `registerEntry`, which the ProgressionSystem (run/prestige.ts)
 * calls for every new event once per tick.
 */
import type { MetaState, SimEvent } from '../core/types';
import type { WorldImpl } from '../core/world-impl';
import { Ev } from '../core/types';
import { FUSIONS, TRIADS, WEAPON_LINKAGES } from '../data/index';

export const CODEX_BONUS_PER_ENTRY = 0.0025;
export const CHAIN_TIERS = [3, 5, 8, 12] as const;
export const CODEX_MILESTONES = [10, 25, 50] as const;

/** Number of discovered Codex entries. */
export function codexCount(meta: MetaState): number {
  let n = 0;
  for (const k in meta.codex) if (meta.codex[k] > 0) n++;
  return n;
}

/** ×(1 + 0.25% per discovered entry): damage, Scrap and Echoes. */
export function codexMultiplier(meta: MetaState): number { return 1 + CODEX_BONUS_PER_ENTRY * codexCount(meta); }

/** Milestones reached (0..3). */
export function codexMilestones(meta: MetaState): number {
  const n = codexCount(meta);
  let m = 0;
  for (const t of CODEX_MILESTONES) if (n >= t) m++;
  return m;
}

/** Extra draft weight for non-Common Anomalies: +25% per milestone reached. */
export function codexAnomalyWeight(meta: MetaState, rarity: string): number {
  return rarity === 'common' ? 1 : 1 + 0.25 * codexMilestones(meta);
}

/** Register one entry. Returns true when it was new. */
export function registerEntry(w: WorldImpl, id: string, cause: number): boolean {
  const meta = w.meta;
  if (meta.codex[id] > 0) return false;
  meta.codex[id] = 1;
  const n = codexCount(meta);
  w.emit(Ev.Codex, id, n, 0, 0, 0, cause);
  for (const t of CODEX_MILESTONES) {
    if (n !== t) continue;
    const pal = `palette.${t}`;
    const list = meta.palettes ?? (meta.palettes = []);
    if (!list.includes(pal)) list.push(pal);
  }
  return true;
}

/** Codex key for an event, or null (Kill chains are handled separately). */
export function codexKey(e: SimEvent): string | null {
  switch (e.type) {
    case Ev.Fusion: case Ev.Triad: case Ev.Linkage: case Ev.Infusion: case Ev.Anomaly:
      return e.src ? e.src : null;
    case Ev.BossCounter: case Ev.CounterScored:
      return `counter.${e.src}`;
    default: return null;
  }
}

/** Look at one event; register what it discovers. Returns true when anything new was found. */
export function scanCodexEvent(w: WorldImpl, e: SimEvent): boolean {
  if (e.type === Ev.Kill) {
    const d = w.events.depthOf(e.id);
    if (d < CHAIN_TIERS[0]) return false;
    let found = false;
    for (const t of CHAIN_TIERS) if (d >= t && registerEntry(w, `chain.${t}`, e.id)) found = true;
    return found;
  }
  const key = codexKey(e);
  return key !== null && registerEntry(w, key, e.id);
}

const ADJ: Record<string, string> = { fire: 'burning', lightning: 'shocked', poison: 'poisoned', frost: 'frozen' };
const NOUN: Record<string, string> = {
  fire: 'fire', lightning: 'lightning', poison: 'poison', frost: 'frost', primary: 'gun', ordnance: 'missiles',
  drones: 'drones', blade: 'blade', laser: 'laser', gravitics: 'gravity well',
};

/** Hints for undiscovered entries within reach of the current build (≤ 3; UI only, allocates). */
export function codexHints(w: WorldImpl): string[] {
  const out: string[] = [];
  const s = w.stats, codex = w.meta.codex;
  for (const f of FUSIONS) {
    if (out.length >= 3) return out;
    if (codex[f.node.id] > 0) continue;
    const [a, b] = f.elements;
    if (s.attuned(a) && s.attuned(b)) out.push(`Something happens when ${NOUN[a]} meets a ${ADJ[b]} enemy.`);
  }
  if (w.meta.ascension >= 2) {
    for (const t of TRIADS) {
      if (out.length >= 3) return out;
      if (codex[t.node.id] > 0) continue;
      const [a, b, c] = t.elements;
      if ([a, b, c].filter((x) => s.attuned(x)).length >= 2) out.push(`Three elements answer each other: ${NOUN[a]}, ${NOUN[b]} and ${NOUN[c]}.`);
    }
  }
  for (const l of WEAPON_LINKAGES) {
    if (out.length >= 3) return out;
    if (codex[l.node.id] > 0) continue;
    const [a, b] = l.pair;
    if (s.mounted(a as never) && s.mounted(b as never)) out.push(`Something happens when the ${NOUN[a] ?? a} and the ${NOUN[b] ?? b} work the same target.`);
  }
  for (const t of CHAIN_TIERS) {
    if (out.length >= 3) return out;
    if (codex[`chain.${t}`] > 0) continue;
    out.push(`A single kill can be caused by ${t} different things in a row.`);
    break;
  }
  return out;
}
