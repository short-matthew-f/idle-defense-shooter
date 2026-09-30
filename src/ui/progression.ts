/**
 * Progressive reveal ("unlock ladder"): which parts of the UI a player has earned. Pure, no DOM.
 *
 * Idle games layer their systems in a bit at a time; a fresh tower should face one decision (Upgrade),
 * not five tabs. The stage is derived from PROGRESS STATE every time, never from a stored flag:
 *   best wave  = max(meta.deepestEver, run.deepestCleared)   (both count waves CLEARED)
 *   prestige   = meta.prestigeCount
 * plus what the player already owns or has pending: a feature the player uses (a mounted hardpoint, an
 * attuned element, a socketed Anomaly, a pending draft or boon offer, a recommended Prestige...) is never
 * hidden. Every threshold lives in UNLOCKS below; nothing else in the UI hard-codes a wave number for this.
 *
 * Presentation-only state (which coach banners were read, which tabs were visited) lives in prefs; it
 * never decides what is visible.
 */
import type { ShopEntry, UiState } from '@sim/core/types';
import { etaSeconds, nextPurchase } from './advice';

// ---------------------------------------------------------------- the table

/** Stage thresholds on the best wave cleared (index = stage). Stage 7 = first Prestige or STAGE7_WAVE. */
export const STAGE_WAVES = [0, 5, 6, 10, 12, 15, 20] as const;
export const STAGE7_WAVE = 25;
/** Affordable rows (Scrap, unlocked, not maxed, in a visible category) that also reveal the bulk tools early. */
export const BULK_ROWS = 12;

export const FEATURE_IDS = [
  // stage 0: the tower, one Upgrade button (3 stats)
  'tapAssist',
  // stage 1: first boss cleared
  'tabbar', 'upgradesTab', 'chassisAll', 'runControls', 'salvage',
  // stage 2
  'elements',
  // stage 3
  'buildTab', 'hardpoints', 'moreTab',
  // stage 4
  'abilities', 'overcharge',
  // stage 5
  'boons', 'anomalies', 'bulk',
  // stage 6
  'prestigeTab', 'forecast', 'cross', 'inspector', 'codex',
  // stage 7
  'cores', 'frame', 'automation', 'trials', 'quartermaster',
] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export interface Unlock {
  /** Revealed once the best wave cleared reaches this (null: never by wave alone). */
  wave: number | null;
  /** Revealed once prestigeCount reaches this (null: never by Prestige alone). */
  prestige: number | null;
  /** What it shows, for docs and the Help list. */
  what: string;
}

const W = (wave: number | null, what: string, prestige: number | null = 1): Unlock => ({ wave, prestige, what });

/** THE unlock ladder. A first Prestige reveals everything (the machine is no longer new). */
export const UNLOCKS: Readonly<Record<FeatureId, Unlock>> = {
  tapAssist: W(0, 'Tap assist (active play; wired by another system)', 0),
  tabbar: W(5, 'The tab bar'),
  upgradesTab: W(5, 'Upgrades tab: all three Chassis trees'),
  chassisAll: W(5, 'Every Chassis node (stage 0 shows Damage, Fire Rate, Hull only)'),
  runControls: W(5, 'Push / Patrol and Restart chips on Battle'),
  salvage: W(5, 'Salvage (wired by another system)'),
  elements: W(6, 'Upgrades → Elements (first attunement)'),
  buildTab: W(10, 'Build tab'),
  hardpoints: W(10, 'Upgrades → Hardpoints (first hardpoint slot opens at 10)'),
  moreTab: W(10, 'More tab (Settings and Help are reachable from a Battle chip before this)'),
  abilities: W(12, 'Ability bar, Command Energy, tap-to-cast'),
  overcharge: W(12, 'Overcharge (wired by another system)'),
  boons: W(15, 'Boons on the Build tab and the boon explainer (offers themselves always show)'),
  anomalies: W(15, 'Anomalies on the Build tab and the draft explainer (drafts themselves always show)'),
  bulk: W(15, 'Suggested card, Buy all, ×1 · ×10 · Max, Spend here'),
  prestigeTab: W(20, 'Prestige tab (teaser, Forecast)'),
  forecast: W(20, 'Forecast'),
  cross: W(20, 'Upgrades → Cross (Fusions, Linkages, Infusions)'),
  inspector: W(20, 'Kill-Chain Inspector (pause)'),
  codex: W(20, 'Chain Codex'),
  cores: W(STAGE7_WAVE, 'Upgrades → Cores, Build → Cores'),
  frame: W(STAGE7_WAVE, 'Build → Frame'),
  automation: W(null, 'More → Automation (Directives, Autocast, Blueprints)'),
  trials: W(null, 'More → Trials'),
  quartermaster: W(null, 'Quartermaster (wired by another system)'),
};

/** The three stage-0 stats (the most basic of Ballistics and Bastion), with first-contact names. */
export const STARTER_NODES = [
  { node: 'ballistics.damage', label: 'Damage' },
  { node: 'ballistics.attack_speed', label: 'Fire Rate' },
  { node: 'bastion.max_hp', label: 'Hull' },
] as const;
export const STARTER_IDS: ReadonlySet<string> = new Set(STARTER_NODES.map((s) => s.node));

// ---------------------------------------------------------------- state

/** The part of UiState the ladder reads (keeps tests small; every field optional beyond the core). */
export interface ProgressState {
  run: Pick<UiState['run'], 'deepestCleared'> & Partial<Pick<UiState['run'], 'pendingDraft' | 'boonOffer' | 'boons' | 'cores'>>;
  meta: Pick<UiState['meta'], 'deepestEver' | 'prestigeCount'> & Partial<Pick<UiState['meta'], 'prestigeRanks' | 'directives'>>;
  build?: Partial<Pick<UiState['build'], 'hardpoints' | 'attunements' | 'anomalies' | 'frame'>>;
  shop?: readonly ShopEntry[];
  extraSystems?: UiState['extraSystems'];
  forecast?: Pick<NonNullable<UiState['forecast']>, 'recommended'> | null;
  activeTrial?: UiState['activeTrial'];
}

export type Features = Record<FeatureId, boolean> & { showEverything: boolean };

export interface FeatureOpts {
  /** Settings → Show everything (or ?showall=1): every feature on. */
  showEverything?: boolean;
}

/** Best wave cleared, ever. */
export function bestWave(s: ProgressState): number {
  return Math.max(s.meta.deepestEver | 0, s.run.deepestCleared | 0);
}

/** 0..7 (see STAGE_WAVES). */
export function stageOf(s: ProgressState): number {
  if ((s.meta.prestigeCount | 0) >= 1) return 7;
  const w = bestWave(s);
  if (w >= STAGE7_WAVE) return 7;
  let st = 0;
  for (let i = 1; i < STAGE_WAVES.length; i++) if (w >= STAGE_WAVES[i]) st = i;
  return st;
}

/** Stage at which a feature appears by wave alone (for docs/tests; null if only by Prestige). */
export function stageOfFeature(id: FeatureId): number | null {
  const w = UNLOCKS[id].wave;
  if (w === null) return 7;
  if (w >= STAGE7_WAVE) return 7;
  let st = 0;
  for (let i = 1; i < STAGE_WAVES.length; i++) if (w >= STAGE_WAVES[i]) st = i;
  return st;
}

const CROSS_TREES = new Set(['link', 'infuse', 'fusion']);

/** Scrap rows the player could buy now in the categories they can see (reveals the bulk tools early). */
export function affordableRows(shop: readonly ShopEntry[], f: Pick<Features, 'chassisAll' | 'elements' | 'hardpoints' | 'cross'>): number {
  let n = 0;
  for (const e of shop) {
    if (!e.affordable || e.locked || e.currency !== 'scrap' || e.kind === 'doctrine' || e.rank >= e.maxRank) continue;
    if (!f.chassisAll && !STARTER_IDS.has(e.node)) continue;
    if (CROSS_TREES.has(e.tree) && !f.cross) continue;
    n++;
  }
  return n;
}

/** Every feature on or off for this state. Monotone in the best wave and in prestigeCount. */
export function features(s: ProgressState, opts: FeatureOpts = {}): Features {
  const all = !!opts.showEverything;
  const best = bestWave(s);
  const pc = s.meta.prestigeCount | 0;
  const f = {} as Features;
  for (const id of FEATURE_IDS) {
    const u = UNLOCKS[id];
    f[id] = all || (u.wave !== null && best >= u.wave) || (u.prestige !== null && pc >= u.prestige);
  }
  f.showEverything = all;
  if (all) return f;

  // ---- never hide what the player owns, uses, or has pending
  const b = s.build ?? {};
  const shop = s.shop ?? [];
  const ranked = (pred: (e: ShopEntry) => boolean): boolean => shop.some((e) => e.rank > 0 && pred(e));
  if ((b.attunements ?? []).some(Boolean)) f.elements = true;
  if ((b.hardpoints ?? []).some(Boolean) || (s.extraSystems ?? []).length > 0) f.hardpoints = true;
  const draft = !!s.run.pendingDraft && s.run.pendingDraft.length > 0;
  if (draft || (b.anomalies ?? []).length > 0) f.anomalies = true;
  if ((s.run.boonOffer && s.run.boonOffer.length > 0) || (s.run.boons ?? []).length > 0) f.boons = true;
  if (ranked((e) => e.tree === 'ability')) f.abilities = true;
  if (ranked((e) => CROSS_TREES.has(e.tree))) f.cross = true;
  if (ranked((e) => e.kind === 'exotic')) f.cores = true;
  if (ranked((e) => !STARTER_IDS.has(e.node) && e.kind !== 'ability')) f.chassisAll = true;
  if (b.frame && b.frame !== 'standard') f.frame = true;
  if (s.forecast?.recommended) { f.prestigeTab = true; f.forecast = true; }
  const pr = s.meta.prestigeRanks ?? {};
  if ((pr['prestige.directives'] | 0) > 0 || (pr['prestige.blueprint_slots'] | 0) > 0 || (s.meta.directives ?? []).length > 0) f.automation = true;
  if ((pr['prestige.trials'] | 0) > 0 || !!s.activeTrial) f.trials = true;
  if (!f.bulk && affordableRows(shop, f) >= BULK_ROWS) f.bulk = true;

  // ---- consistency: a category needs its screen, a screen needs the tab bar
  if (f.elements || f.hardpoints || f.cross || f.cores || f.bulk) { f.upgradesTab = true; f.chassisAll = true; }
  if (f.hardpoints || f.anomalies) f.buildTab = true;
  if (f.buildTab) f.moreTab = true;
  if (f.forecast) f.prestigeTab = true;
  if (f.automation || f.trials || f.inspector || f.codex) f.moreTab = true;
  if (f.upgradesTab) f.runControls = true;
  f.tabbar = f.upgradesTab || f.buildTab || f.prestigeTab || f.moreTab;
  if (f.tabbar) f.upgradesTab = true;
  return f;
}

/** Every feature on (tests, and the default before the first UiState). */
export function allFeatures(): Features {
  return features({ run: { deepestCleared: 0 }, meta: { deepestEver: 0, prestigeCount: 0 } }, { showEverything: true });
}

// ---------------------------------------------------------------- stage 0: the Upgrade button

export type StarterReason = 'hull' | 'pressure' | 'damage' | 'rate' | 'saving';
export interface StarterPick {
  entry: ShopEntry;
  label: string;
  affordable: boolean;
  reason: StarterReason;
  /** One line: why this one. */
  why: string;
  /** Seconds until affordable at the current income (0 = now, null = unknown). */
  eta: number | null;
}
/** What the pick reads (a slice of UiState). */
export type StarterState = Pick<UiState, 'shop'> & {
  run: Pick<UiState['run'], 'scrap'> & Partial<Pick<UiState['run'], 'attemptDamageTaken' | 'phase'>>;
  tower: Pick<UiState['tower'], 'hp' | 'maxHp'>;
  wave: Pick<UiState['wave'], 'enemiesAlive'>;
};

/** Enemies alive at once that mean "they arrive faster than you kill them". */
export const PRESSURE_ALIVE = 8;
/** Tower health below which Hull comes first. */
export const HULL_HP_FRAC = 0.6;

const WHY: Record<StarterReason, (label: string) => string> = {
  hull: () => 'Hull: the tower is taking heavy hits',
  pressure: () => 'Fire Rate: enemies arrive faster than you kill them',
  damage: () => 'Damage: every shot hits harder',
  rate: () => 'Fire Rate: more shots, faster kills',
  saving: (l) => `${l}: next upgrade, keep killing to afford it`,
};

/**
 * The stat the big Upgrade button buys next, and why (one line). Survival first when the tower is hurt or
 * took most of its health in damage this attempt, Fire Rate when enemies pile up, else the cheaper of
 * Damage / Fire Rate (they alternate). If the preferred stat is not affordable but another is, that one
 * (with its own reason). Nothing affordable: the cheapest (advice.nextPurchase over the three), flagged 'saving'.
 */
export function starterPick(s: StarterState, rate = 0): StarterPick | null {
  const byId = new Map(s.shop.map((e) => [e.node, e]));
  interface Cand { node: string; label: string; e: ShopEntry }
  const cands: Cand[] = [];
  for (const x of STARTER_NODES) {
    const e = byId.get(x.node);
    if (e && !e.locked && e.rank < e.maxRank) cands.push({ node: x.node, label: x.label, e });
  }
  if (!cands.length) return null;
  const find = (node: string): Cand | undefined => cands.find((c) => c.node === node);
  const hpFrac = s.tower.maxHp > 0 ? s.tower.hp / s.tower.maxHp : 1;
  let taken = 0;
  for (const v of Object.values(s.run.attemptDamageTaken ?? {})) if (v > 0) taken += v;
  const hurt = s.run.phase !== 'dead' && (hpFrac < HULL_HP_FRAC || (s.tower.maxHp > 0 && taken >= s.tower.maxHp * 0.75));
  const order: { node: string; reason: StarterReason }[] = [];
  if (hurt) order.push({ node: 'bastion.max_hp', reason: 'hull' });
  if (s.wave.enemiesAlive >= PRESSURE_ALIVE) order.push({ node: 'ballistics.attack_speed', reason: 'pressure' });
  const dmg = find('ballistics.damage'), fr = find('ballistics.attack_speed');
  const calm: { node: string; reason: StarterReason }[] = [{ node: 'ballistics.damage', reason: 'damage' }, { node: 'ballistics.attack_speed', reason: 'rate' }];
  if (dmg && fr && fr.e.cost < dmg.e.cost) calm.reverse();
  order.push(...calm, { node: 'bastion.max_hp', reason: 'hull' });
  const seen = new Set<string>();
  const ranked = order.filter((o) => (seen.has(o.node) ? false : (seen.add(o.node), true)));
  for (const o of ranked) {
    const c = find(o.node);
    if (c && c.e.affordable) return { entry: c.e, label: c.label, affordable: true, reason: o.reason, why: WHY[o.reason](c.label), eta: 0 };
  }
  // nothing affordable: what to save for (the cheapest of the three, with its ETA)
  const next = nextPurchase(cands.map((c) => c.e), s.run.scrap, rate);
  const best = next ? cands.find((c) => c.e === next.entry) : undefined;
  if (!best || !next) return null;
  return { entry: best.e, label: best.label, affordable: false, reason: 'saving', why: WHY.saving(best.label), eta: next.eta ?? etaSeconds(best.e.cost, s.run.scrap, rate) };
}
