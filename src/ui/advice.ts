/**
 * Purchase advice (pure, no DOM): what to show when the player has nothing affordable, and the
 * "three purchases that could help" after a death (design pillar 3: a failed attempt should reveal
 * three or four exciting purchases).
 *
 * Priorities: an open hardpoint / attunement slot (a new weapon system is the biggest step change),
 * then an unchosen Doctrine fork, then behaviour-changing mechanics, then the core damage / fire
 * rate / survival stats, then everything else. At most one suggestion per tree so the list reads
 * as a plan rather than three ranks of the same stat.
 */
import type { ShopEntry, SimEvent, UiState } from '@sim/core/types';
import type { BossId } from '@sim/core/ids';
import { BOSS_BY_ID, ENEMY_NAME } from './content';

export type Category = 'chassis' | 'elements' | 'hardpoints' | 'cross' | 'cores';

export type Suggestion =
  | { kind: 'buy'; entry: ShopEntry; affordable: boolean; eta: number | null }
  | { kind: 'slot'; cat: 'elements' | 'hardpoints'; slot: number }
  | { kind: 'doctrine'; entry: ShopEntry; tree: string };

/** The part of UiState advice reads (keeps tests small). */
export type AdviceState = Pick<UiState, 'shop'> & {
  run: Pick<UiState['run'], 'scrap' | 'hardpointSlotsOpen' | 'attunementSlotsOpen'>;
  build: Pick<UiState['build'], 'hardpoints' | 'attunements' | 'doctrines'> & Partial<Pick<UiState['build'], 'secondDoctrines'>>;
};

const CORE_STAT = /\.(damage|attack_speed|max_hp|armor|global_attack_speed|regeneration)$/;
const MECHANIC_KINDS = new Set<ShopEntry['kind']>(['mechanic', 'linkage', 'infusion', 'fusion']);

/** Higher is better. Mechanics change behaviour (design §2 pillar 2); core stats come next; ability ranks last. */
export function entryValue(e: ShopEntry): number {
  if (MECHANIC_KINDS.has(e.kind)) return 3;
  if (e.kind === 'ability') return 0.5;
  if (CORE_STAT.test(e.node)) return 2;
  return 1;
}

/** Seconds until `cost` is affordable at `rate` Scrap/s; 0 if already affordable, null if never. */
export function etaSeconds(cost: number, scrap: number, rate: number): number | null {
  if (scrap >= cost) return 0;
  if (!(rate > 0)) return null;
  return Math.ceil((cost - scrap) / rate);
}

function buyable(e: ShopEntry): boolean {
  return e.currency === 'scrap' && !e.locked && e.rank < e.maxRank && e.kind !== 'doctrine';
}

/** Cheapest Scrap purchase not yet affordable, with its ETA at the current income. */
export function nextPurchase(shop: readonly ShopEntry[], scrap: number, rate: number): { entry: ShopEntry; eta: number | null } | null {
  let best: ShopEntry | null = null;
  for (const e of shop) {
    if (!buyable(e) || e.affordable) continue;
    if (!best || e.cost < best.cost || (e.cost === best.cost && e.node < best.node)) best = e;
  }
  return best ? { entry: best, eta: etaSeconds(best.cost, scrap, rate) } : null;
}

/** Open slots that have nothing in them (index into build.hardpoints / build.attunements). */
export function openSlots(s: AdviceState): { cat: 'elements' | 'hardpoints'; slot: number }[] {
  const out: { cat: 'elements' | 'hardpoints'; slot: number }[] = [];
  for (let i = 0; i < s.run.attunementSlotsOpen; i++) if (!s.build.attunements[i]) { out.push({ cat: 'elements', slot: i }); break; }
  for (let i = 0; i < s.run.hardpointSlotsOpen; i++) if (!s.build.hardpoints[i]) { out.push({ cat: 'hardpoints', slot: i }); break; }
  return out;
}

/**
 * Doctrine forks the player can choose now for free: a tree with no Doctrine whose fork is open, or (Reachability) a
 * tree with an empty second-Doctrine slot. A change (Cores) is never suggested.
 */
export function openForks(s: AdviceState): { entry: ShopEntry; tree: string }[] {
  const seen = new Set<string>();
  const out: { entry: ShopEntry; tree: string }[] = [];
  for (const e of s.shop) {
    if (e.kind !== 'doctrine' || e.locked || !e.affordable || e.cost > 0) continue;
    const tree = e.tree as string;
    const t = tree as keyof typeof s.build.doctrines;
    if (seen.has(tree) || (s.build.doctrines[t] && (s.build.secondDoctrines ?? {})[t])) continue;
    seen.add(tree);
    out.push({ entry: e, tree });
  }
  return out;
}

/**
 * Up to `n` suggestions: open slots, open Doctrine forks, then the best affordable buys (value,
 * then cheapest; one per tree), then — if the list is still short — the cheapest buys you are
 * saving toward with their ETA.
 */
export function suggestPurchases(s: AdviceState, rate: number, n = 3): Suggestion[] {
  const out: Suggestion[] = [];
  const trees = new Set<string>();
  for (const sl of openSlots(s)) { if (out.length < n) out.push({ kind: 'slot', ...sl }); }
  for (const f of openForks(s)) { if (out.length < n) { out.push({ kind: 'doctrine', entry: f.entry, tree: f.tree }); trees.add(f.tree); } }
  const list = s.shop.filter(buyable);
  const pick = (cands: ShopEntry[], affordable: boolean): void => {
    cands.sort((a, b) => entryValue(b) - entryValue(a) || a.cost - b.cost || (a.node < b.node ? -1 : 1));
    for (const e of cands) {
      if (out.length >= n) return;
      const t = e.tree as string;
      if (trees.has(t)) continue;
      trees.add(t);
      out.push({ kind: 'buy', entry: e, affordable, eta: etaSeconds(e.cost, s.run.scrap, rate) });
    }
  };
  pick(list.filter((e) => e.affordable), true);
  if (out.length < n) {
    // saving toward: the cheapest few not yet affordable (value breaks ties only)
    const soon = list.filter((e) => !e.affordable).sort((a, b) => a.cost - b.cost).slice(0, 12);
    pick(soon, false);
  }
  return out;
}

/** "The Broodheart's" / "The Warden's" from a boss name with or without its "The". */
export function possessive(name: string): string { return `${/^the /i.test(name) ? name : `The ${name}`}'s`; }

function article(name: string): string { return /^[AEIOU]/i.test(name) ? `An ${name}` : `A ${name}`; }

/**
 * Who dealt the killing blow, from the Ev.TowerDeath payload ({ killer, boss?, bossPhase? }, sim S3):
 * "The Breaker (phase 2 of 3)", "A Brute", "A hazard zone", "Your own explosions"; null when unknown.
 * The payload has no hazard owner (only `killer: 'hazard'`), but the only hazards that hurt the tower are boss-made (sim/core/hazards.ts),
 * so the caller passes the wave's boss as `hazardOwner` ("The Warden's hazard zone").
 */
export function killerName(data: SimEvent['data'] | undefined, hazardOwner?: string | null): string | null {
  const k = data && typeof data.killer === 'string' ? data.killer : null;
  if (!k || k === 'enemy') return null;
  if (data!.boss) {
    const def = BOSS_BY_ID.get(k as BossId);
    const name = def?.name ?? 'The boss';
    const phase = typeof data!.bossPhase === 'number' ? data!.bossPhase : -1;
    return def && def.phases.length > 1 && phase >= 0 ? `${name} (phase ${phase + 1} of ${def.phases.length})` : name;
  }
  if (k === 'hazard') return hazardOwner ? `${possessive(hazardOwner)} hazard zone` : 'A hazard zone';
  if (k === 'self') return 'Your own explosions';
  return article(ENEMY_NAME.get(k) ?? k);
}

/** Display name of an attemptDamageTaken source ('boss' uses the wave's boss when known). */
export function damageSourceName(src: string, bossId: string | null): string {
  if (src === 'boss') return (bossId && BOSS_BY_ID.get(bossId as BossId)?.name) || 'The boss';
  if (src === 'hazard') { const o = bossId && BOSS_BY_ID.get(bossId as BossId)?.name; return o ? `${possessive(o)} hazard zones` : 'Hazard zones'; }
  if (src === 'self') return 'Your own explosions';
  if (src === 'enemy') return 'Enemy fire';
  return ENEMY_NAME.get(src) ?? src;
}

/** The source that dealt the most tower damage this attempt, with its share (0..1); null when none. */
export function topDamageSource(taken: Readonly<Record<string, number>>): { source: string; share: number } | null {
  let total = 0, best: string | null = null;
  for (const k of Object.keys(taken).sort()) {
    const v = taken[k];
    if (!(v > 0)) continue;
    total += v;
    if (best === null || v > taken[best]) best = k;
  }
  return best === null ? null : { source: best, share: taken[best] / total };
}

/** Death summary line: "Tower destroyed on wave 7 · restarting at wave 6". `killer` from killerName (or a boss name). */
export function deathHeadline(wave: number, checkpoint: number, killer: string | null): { title: string; sub: string } {
  const title = killer ? `${killer} destroyed the tower on wave ${wave}` : `Tower destroyed on wave ${wave}`;
  const sub = `Restarting at wave ${checkpoint + 1}${checkpoint > 0 ? ` (checkpoint ${checkpoint})` : ''}. Scrap and upgrades are kept.`;
  return { title, sub };
}
