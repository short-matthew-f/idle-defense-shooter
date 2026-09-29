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
import type { ShopEntry, UiState } from '@sim/core/types';

export type Category = 'chassis' | 'elements' | 'hardpoints' | 'cross' | 'cores';

export type Suggestion =
  | { kind: 'buy'; entry: ShopEntry; affordable: boolean; eta: number | null }
  | { kind: 'slot'; cat: 'elements' | 'hardpoints'; slot: number }
  | { kind: 'doctrine'; entry: ShopEntry; tree: string };

/** The part of UiState advice reads (keeps tests small). */
export type AdviceState = Pick<UiState, 'shop'> & {
  run: Pick<UiState['run'], 'scrap' | 'hardpointSlotsOpen' | 'attunementSlotsOpen'>;
  build: Pick<UiState['build'], 'hardpoints' | 'attunements' | 'doctrines'>;
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

/** Doctrine forks the player can choose now (a tree with no Doctrine whose fork is open). */
export function openForks(s: AdviceState): { entry: ShopEntry; tree: string }[] {
  const seen = new Set<string>();
  const out: { entry: ShopEntry; tree: string }[] = [];
  for (const e of s.shop) {
    if (e.kind !== 'doctrine' || e.locked || !e.affordable) continue;
    const tree = e.tree as string;
    if (seen.has(tree) || s.build.doctrines[tree as keyof typeof s.build.doctrines]) continue;
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

/** Death summary line: "Tower destroyed on wave 7 · restarting at wave 6". */
export function deathHeadline(wave: number, checkpoint: number, bossName: string | null): { title: string; sub: string } {
  const title = bossName ? `${bossName} destroyed the tower on wave ${wave}` : `Tower destroyed on wave ${wave}`;
  const sub = `Restarting at wave ${checkpoint + 1}${checkpoint > 0 ? ` (checkpoint ${checkpoint})` : ''}. Scrap and upgrades are kept.`;
  return { title, sub };
}
