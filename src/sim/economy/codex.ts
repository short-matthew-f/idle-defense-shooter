/**
 * Chain Codex (design §16). Every distinct interaction the simulation logs is an entry: each
 * Fusion, Triad, Linkage, Infusion, Anomaly and Counter `src` seen in the event log, plus kill
 * chains of 3, 5, 8 and 12 links (EventLog depth of the Kill event). An entry is discovered once:
 * `meta.codex[id] = 1` and an `Ev.Codex` event (src = entry id, a = entries discovered).
 *
 * Boons: the first pick of each boon registers `boon.<id>` (run/boons.ts); mechanical boons' Ev.Anomaly
 * (src `boon.<id>`) registers the same entry.
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
import { ANOMALIES, BOSSES, CHASSIS_LINKAGES, FUSIONS, INFUSIONS, TRIADS, WEAPON_LINKAGES } from '../data/index';

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
  drones: 'drones', blade: 'blade', laser: 'laser', gravitics: 'gravity well', bastion: 'armour', reactor: 'reactor',
};

/**
 * Anomalies whose mechanic emits Ev.Anomaly (`anomaly.<id>`; systems/anomalies.ts, core/projectiles.ts), so
 * socketing them can discover a Codex entry. Stat-shaped Anomalies never fire and get no hint.
 */
export const FIRING_ANOMALIES: ReadonlySet<string> = new Set([
  'loaded_dice', 'seventh_shot', 'pinball', 'stormglass', 'clockwork_blade', 'ghost_protocol', 'rogue_moon',
  'unstable_isotope', 'tithe', 'hungry_core', 'afterimage_round', 'echo_chamber', 'feedback_loop', 'rot_bloom', 'martyr_plating',
]);

/** A boss Counter is recorded as `counter.boss.<id>` (Ev.BossCounter src); `counter.<id>` is accepted too. */
export function bossCountered(codex: Record<string, number>, bossId: string): boolean {
  return codex[`counter.boss.${bossId}`] > 0 || codex[`counter.${bossId}`] > 0;
}

export const MAX_HINTS = 3;

/**
 * Hints for undiscovered entries within reach of the current build (≤ MAX_HINTS; UI only, allocates).
 * Non-empty whenever the build can reach an undiscovered entry (UX review S6): attuned pairs without their
 * Fusion (Triads from Ascension II), mounted pairs without their Linkage (weapon and chassis), mounted +
 * attuned without the Infusion, socketed firing Anomalies not yet fired, bosses met but never countered,
 * and the next kill-chain tier. When none of those applies but entries remain, it falls back to the
 * nearest undiscovered group (attune / mount more).
 */
export function codexHints(w: WorldImpl): string[] {
  const out: string[] = [];
  const s = w.stats, codex = w.meta.codex;
  const full = (): boolean => out.length >= MAX_HINTS;
  const seen = (id: string): boolean => codex[id] > 0;
  for (const f of FUSIONS) {
    if (full()) return out;
    if (seen(f.node.id)) continue;
    const [a, b] = f.elements;
    if (s.attuned(a) && s.attuned(b)) out.push(`Something happens when ${NOUN[a]} meets a ${ADJ[b]} enemy.`);
  }
  if (w.meta.ascension >= 2) {
    for (const t of TRIADS) {
      if (full()) return out;
      if (seen(t.node.id)) continue;
      const [a, b, c] = t.elements;
      if ([a, b, c].filter((x) => s.attuned(x)).length >= 2) out.push(`Three elements answer each other: ${NOUN[a]}, ${NOUN[b]} and ${NOUN[c]}.`);
    }
  }
  for (const l of WEAPON_LINKAGES) {
    if (full()) return out;
    if (seen(l.node.id)) continue;
    const [a, b] = l.pair;
    if (s.mounted(a as never) && s.mounted(b as never)) out.push(`Something happens when the ${NOUN[a] ?? a} and the ${NOUN[b] ?? b} work the same target.`);
  }
  for (const l of CHASSIS_LINKAGES) {
    if (full()) return out;
    if (seen(l.node.id)) continue;
    const [c, hp] = l.pair;
    if (s.mounted(hp as never)) out.push(`The ${NOUN[c] ?? c} and the ${NOUN[hp] ?? hp} could do more together.`);
  }
  for (const inf of INFUSIONS) {
    if (full()) return out;
    if (seen(inf.node.id)) continue;
    if (s.mounted(inf.system) && s.attuned(inf.element)) out.push(`The ${NOUN[inf.system] ?? inf.system} could carry ${NOUN[inf.element] ?? inf.element}.`);
  }
  for (const a of ANOMALIES) {
    if (full()) return out;
    if (!FIRING_ANOMALIES.has(a.id) || !w.build.anomalies.includes(a.id) || seen(`anomaly.${a.id}`) || seen(a.id)) continue;
    out.push(`${a.name} has not shown what it can do yet.`);
  }
  // Boons: each boon's first pick (or first firing) is an entry `boon.<id>`
  const offer = w.run.boonOffer;
  if (!full() && offer && offer.some((id) => !seen(`boon.${id}`))) out.push('A boon on offer has never been picked: choosing it records it in the Codex.');
  const met = w.run.deepestCleared + 5;
  for (const b of BOSSES) {
    if (full()) return out;
    if (b.wave > met || bossCountered(codex, b.id)) continue;
    out.push(`${b.name} can be answered during its ${b.tell.name.toLowerCase()}.`);
  }
  for (const t of CHAIN_TIERS) {
    if (full()) return out;
    if (seen(`chain.${t}`)) continue;
    out.push(`A single kill can be caused by ${t} different things in a row.`);
    break;
  }
  if (out.length === 0) {
    // nothing in reach: point at the nearest undiscovered group
    if (FUSIONS.some((f) => !seen(f.node.id))) out.push('Two attuned elements can fuse into something new.');
    if (WEAPON_LINKAGES.some((l) => !seen(l.node.id))) out.push('Two mounted weapon systems can learn to work together.');
    if (INFUSIONS.some((i) => !seen(i.node.id))) out.push('An element can ride a weapon system.');
  }
  return out;
}
