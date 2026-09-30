/**
 * StatResolver: DerivedStats over BuildState + MetaState + content.
 *
 * Rule (additive-multiplier convention):
 *   value(key) = (BASE(key) + Σ add.perRank·rank) × (1 + Σ mul.perRank·rank), then `set` overrides
 * where BASE(key) = BASE_STATS[key] ?? CORE_DEFAULTS[key] ?? 0. All `mul` effects on one key are
 * summed before multiplying (two +10% nodes give ×1.2, not ×1.21). Several `set` effects: the last
 * source in resolution order wins. Test/debug overrides (`override`) win over everything.
 * Final multipliers (EFFECT-AUDIT): an effect on `${key}@final` (op 'mul') multiplies `key` AFTER the additive sum,
 * each source separately: ×(1 + perRank·rank). Frame and Anomaly penalties that promise a real fraction ("primary
 * damage −25%", "beams deal 40% less damage") use it, so upgrade ranks on the same key cannot dilute them.
 *
 * Effect sources, in resolution order: tree nodes (shared, doctrine, exotic; doctrine nodes only
 * while their doctrine is active, scaled by doctrineStrength), fusions/triads (both/all elements
 * attuned), weapon/chassis linkages (both halves mounted), infusions (system mounted + element
 * attuned), ability rank nodes, Frame effects (rank 1), socketed Anomalies (rank 1), active Boons (rank 1,
 * build.boons; attempt-scoped), Prestige nodes (meta.prestigeRanks), Constellation nodes (meta.constellation).
 *
 * `rank(id)` returns the EFFECTIVE rank (0 for nodes of inactive doctrines, unmounted systems,
 * unattuned elements; +1 on Fusions for frames flagged `fusions_start_rank1`).
 */
import type { DerivedStats } from './world';
import type { BuildState, MetaState, SecondDoctrineSource } from './types';
import type { ElementId, TreeId, WeaponSystemId } from './ids';
import type { StatEffect } from '../data/schema';
import { BASE_STATS } from '../data/index';
import { allNodes, nodeInfo, frameDef, anomalyDef, boonDef, type NodeInfo } from './content';
import { metaEffects, trialHas } from '../economy/prestige';   // WP8: Trial rewards/constraints
import { codexMultiplier } from '../economy/codex';            // WP8: Codex +0.25%/entry

/** Bases the core relies on even if data/base-stats.ts lacks them. */
export const CORE_DEFAULTS: Record<string, number> = {
  'ballistics.damage': 10, 'ballistics.attack_speed': 2, 'ballistics.range': 300, 'ballistics.projectile_speed': 420,
  'ballistics.crit_chance': 0.05, 'ballistics.crit_damage': 1.5, 'ballistics.target_acquisition': 0,
  'ballistics.multishot.count': 1, 'ballistics.multishot.penalty': 0.35,
  'ballistics.piercing.count': 0, 'ballistics.piercing.retention': 0.5, 'ballistics.piercing.velocity': 0,
  'ballistics.ricochet.bounces': 0, 'ballistics.ricochet.range': 120,
  'ballistics.heavy.size': 1, 'ballistics.heavy.knockback': 0, 'ballistics.heavy.damage': 1,
  'ballistics.execution': 0, 'ballistics.execution.ce_refund': 0,
  'bastion.max_hp': 100, 'bastion.armor': 0, 'bastion.shield_capacity': 0, 'bastion.shield_recharge': 0,
  'bastion.regeneration': 0, 'bastion.resistance': 0,
  'reactor.global_attack_speed': 1, 'reactor.cooldown_reduction': 0, 'reactor.energy_recycling': 0,
  'economy.scrap_mul': 1, 'economy.ce_cap': 100, 'economy.core_drop_chance': 0.02, 'economy.first_clear_mul': 3,
  'combat.power_mul': 1,
};

/** Most tactical ability slots a build can have. */
export const MAX_TACTICAL_SLOTS = 4;

/**
 * Reachability: make `abilities` hold exactly `n` usable slots. Grows with empty (null) slots; when `n` falls,
 * trailing empty slots beyond `n` are dropped but a filled slot is never removed (it stays, inactive). Deterministic.
 */
export function syncAbilitySlots(abilities: (string | null)[], n: number): void {
  while (abilities.length < n) abilities.push(null);
  while (abilities.length > n && abilities[abilities.length - 1] === null) abilities.pop();
}

/** Suffix of a final-multiplier effect key (see the header). */
export const FINAL = '@final';

/** WP8: node granted by the Recursive Warhead Anomaly. */
const RECURSIVE_NODE = 'ordnance.cluster_warheads';

export function baseStat(key: string): number {
  const b = (BASE_STATS as Record<string, number> | undefined)?.[key];
  return b ?? CORE_DEFAULTS[key] ?? 0;
}

export class StatResolver implements DerivedStats {
  private values = new Map<string, number>();
  private ranks = new Map<string, number>();
  private overrides = new Map<string, number>();
  private add = new Map<string, number>();
  private mul = new Map<string, number>();
  private set = new Map<string, number>();
  /** `${key}@final` effects: product of (1 + perRank·rank) per key, applied after the additive sum. */
  private fin = new Map<string, number>();
  /** Incremented on every rebuild so systems can cheaply detect changes. */
  version = 0;

  constructor(public build: BuildState, public meta: MetaState) { this.rebuild(); }

  bind(build: BuildState, meta: MetaState): void { this.build = build; this.meta = meta; this.rebuild(); }

  /** Test / tooling hook: force a stat to a value (applied after `set`). Pass NaN to clear. */
  override(key: string, value: number): void {
    if (Number.isNaN(value)) this.overrides.delete(key); else this.overrides.set(key, value);
    this.rebuild();
  }
  clearOverrides(): void { this.overrides.clear(); this.rebuild(); }

  rebuild(): void {
    this.version++;
    const add = this.add, mul = this.mul, set = this.set, ranks = this.ranks, fin = this.fin;
    add.clear(); mul.clear(); set.clear(); ranks.clear(); fin.clear();
    const apply = (effects: readonly StatEffect[], scale: number): void => {
      for (let k = 0; k < effects.length; k++) {
        const e = effects[k];
        if (e.stat.endsWith(FINAL)) { const b = e.stat.slice(0, -FINAL.length); fin.set(b, (fin.get(b) ?? 1) * (1 + e.perRank * scale)); continue; }
        if (e.op === 'add') add.set(e.stat, (add.get(e.stat) ?? 0) + e.perRank * scale);
        else if (e.op === 'mul') mul.set(e.stat, (mul.get(e.stat) ?? 0) + e.perRank * scale);
        else set.set(e.stat, e.perRank * (scale > 0 ? 1 : 0));
      }
    };
    const nodes = allNodes();
    for (let i = 0; i < nodes.length; i++) {
      const info = nodes[i];
      const r = this.effectiveRank(info);
      if (r > 0) ranks.set(info.def.id, r);
      if (r <= 0) continue;
      let scale = r;
      if (info.doctrine && info.tree) scale *= this.doctrineStrength(info.tree, info.doctrine);
      if (info.def.effects.length) {
        // `set` effects apply at full value once the node has a rank
        apply(info.def.effects, scale);
      }
    }
    // ids ranked in the build but unknown to the content index (content still arriving)
    for (const id of Object.keys(this.build.ranks)) if (!ranks.has(id) && !nodeInfo(id)) { const r = this.build.ranks[id] | 0; if (r > 0) ranks.set(id, r); }
    const frame = frameDef(this.build.frame);
    apply(frame.effects, 1);
    for (const a of this.build.anomalies) { const d = anomalyDef(a); if (d) apply(d.effects, 1); }
    const boons = this.build.boons;   // Boons: attempt-scoped, rank 1 while active
    if (boons) for (const b of boons) { const d = boonDef(b); if (d) apply(d.effects, 1); }
    // WP8: Recursive Warhead grants Cluster Warheads (rank 1) without the Exotic; meta effects (Trial rewards/constraints)
    if (this.hasAnomaly('recursive_warhead') && this.mounted('ordnance') && !ranks.has(RECURSIVE_NODE)) {
      ranks.set(RECURSIVE_NODE, 1); const inf = nodeInfo(RECURSIVE_NODE); if (inf) apply(inf.def.effects, 1);
    }
    apply(metaEffects(this.meta, this.build), 1);
    const codexMul = codexMultiplier(this.meta);

    const values = this.values;
    values.clear();
    const keys = new Set<string>();
    for (const k of Object.keys(CORE_DEFAULTS)) keys.add(k);
    if (BASE_STATS) for (const k of Object.keys(BASE_STATS)) keys.add(k);
    for (const k of add.keys()) keys.add(k);
    for (const k of mul.keys()) keys.add(k);
    for (const k of set.keys()) keys.add(k);
    for (const k of fin.keys()) keys.add(k);
    for (const k of this.overrides.keys()) keys.add(k);
    for (const k of keys) {
      let v = (baseStat(k) + (add.get(k) ?? 0)) * (1 + (mul.get(k) ?? 0)) * (fin.get(k) ?? 1);
      const s = set.get(k); if (s !== undefined) v = s;
      if (k === 'combat.power_mul' || k === 'economy.scrap_mul') v *= codexMul;   // WP8: Codex bonus
      const o = this.overrides.get(k); if (o !== undefined) v = o;
      values.set(k, v);
    }
    // Reachability: the build always offers every usable tactical slot (a third / fourth slot appears the moment it is earned)
    if (this.build.abilities) syncAbilitySlots(this.build.abilities, this.tacticalSlots());
  }

  /** Tactical ability slots: 2; +1 prestige.third_tactical_slot; +1 the Command capstone (same rule as systems/abilities.abilitySlotCount). */
  tacticalSlots(): number {
    return Math.min(MAX_TACTICAL_SLOTS, 2 + (this.has('prestige.third_tactical_slot') ? 1 : 0) + (this.has('reactor.command.fourth_slot') ? 1 : 0));
  }

  private rawRank(info: NodeInfo): number {
    const id = info.def.id;
    if (info.group === 'prestige') return this.meta.prestigeRanks[id] | 0;
    if (info.group === 'star') return this.meta.constellation[id] | 0;
    return this.build.ranks[id] | 0;
  }

  private effectiveRank(info: NodeInfo): number {
    let r = this.rawRank(info);
    switch (info.group) {
      case 'tree': {
        const t = info.tree!;
        if (!this.treeActive(t)) return 0;
        if (info.doctrine && !this.hasDoctrine(t, info.doctrine)) return 0;
        // WP8: a Borrowed Blade is tier 1 — no Doctrine, Exotic or tier 2+ nodes
        if (t === 'blade' && this.borrowed('blade') && (info.doctrine || info.exotic || info.def.tier > 1)) return 0;
        break;
      }
      case 'fusion': case 'triad': {
        if (!info.elements!.every((e) => this.attuned(e))) return 0;
        if (trialHas(this.meta.activeTrial, 'no_fusions')) return 0;   // WP8: Monochrome Trial
        if (info.group === 'fusion' && frameDef(this.build.frame).flags.includes('fusions_start_rank1')) r = Math.min(info.def.maxRank, r + 1);
        break;
      }
      case 'link': if (!this.mounted(info.pair![0] as WeaponSystemId) || !this.mounted(info.pair![1] as WeaponSystemId)) return 0; break;
      case 'chassis_link': if (!this.mounted(info.pair![1] as WeaponSystemId)) return 0; break;
      case 'infuse': if (!this.mounted(info.system!) || !this.attuned(info.elements![0])) return 0; break;
      default: break;
    }
    return r;
  }

  treeActive(tree: string): boolean {
    if (tree === 'ballistics' || tree === 'bastion' || tree === 'reactor') return true;
    if (tree === 'fire' || tree === 'lightning' || tree === 'poison' || tree === 'frost') return this.attuned(tree);
    return this.mounted(tree as WeaponSystemId);
  }

  get(key: string): number { const v = this.values.get(key); return v !== undefined ? v : baseStat(key); }
  has(nodeId: string): boolean { return this.rank(nodeId) >= 1; }
  rank(nodeId: string): number {
    const r = this.ranks.get(nodeId);
    if (r !== undefined) return r;
    if (nodeInfo(nodeId)) return 0;   // known node with effective rank 0
    if (nodeId.startsWith('prestige.')) return this.meta.prestigeRanks[nodeId] | 0;
    if (nodeId.startsWith('star.')) return this.meta.constellation[nodeId] | 0;
    if (nodeId.startsWith('frame.')) return this.build.frame === nodeId.slice(6) ? 1 : 0;
    return this.build.ranks[nodeId] | 0;
  }
  /** Raw purchased rank regardless of doctrine/mount state (shop, refunds). */
  purchasedRank(nodeId: string): number { return this.build.ranks[nodeId] | 0; }
  doctrine(tree: string): string | null { return this.build.doctrines[tree as TreeId] ?? null; }
  hasDoctrine(tree: string, doctrine: string): boolean {
    return this.build.doctrines[tree as TreeId] === doctrine || this.build.secondDoctrines[tree as TreeId] === doctrine;
  }
  doctrineStrength(tree: string, doctrine: string): number {
    if (this.build.doctrines[tree as TreeId] === doctrine) return 1;
    if (this.build.secondDoctrines[tree as TreeId] !== doctrine) return 0;
    return this.secondDoctrineInfo(tree).strength;
  }
  /** Strength a second Doctrine in `tree` runs at, and what grants it (Reachability: the UI labels "Choose as 2nd · 60%"). */
  secondDoctrineInfo(tree: string): { strength: number; source: SecondDoctrineSource } {
    const f = this.build.frame;
    if (f === 'monolith' && tree === 'ballistics') return { strength: 1, source: 'monolith' };
    if (f === 'bulwark' && tree === 'bastion') return { strength: 1, source: 'bulwark' };
    if ((this.meta.prestigeRanks['prestige.dual_doctrine'] | 0) > 0) return { strength: 0.6, source: 'dual_doctrine' };
    if (f === 'singularity_core') return { strength: 0.6, source: 'singularity_core' };
    if (tree === 'ballistics' && this.hasAnomaly('spare_barrel')) return { strength: 0.5, source: 'spare_barrel' };
    return { strength: 0.6, source: 'dual_doctrine' };
  }
  /** May `tree` hold a second doctrine right now (Monolith, Bulwark, Singularity Core, Spare Barrel, Dual Doctrine)? */
  secondDoctrineAllowed(tree: string): boolean {
    const f = this.build.frame;
    if (f === 'monolith' && tree === 'ballistics') return true;
    if (f === 'bulwark' && tree === 'bastion') return true;
    if (f === 'singularity_core') return true;
    if (tree === 'ballistics' && this.hasAnomaly('spare_barrel')) return true;
    if ((this.meta.prestigeRanks['prestige.dual_doctrine'] | 0) > 0) {
      // Dual Doctrine: one chosen tree — the first tree that takes a second doctrine
      const used = Object.keys(this.build.secondDoctrines).filter((t) => this.build.secondDoctrines[t as TreeId]);
      return used.length === 0 || used.includes(tree);
    }
    return false;
  }
  hasAnomaly(id: string): boolean { return this.build.anomalies.includes(id as never); }
  /** Boons: is this boon active in the current attempt? */
  hasBoon(id: string): boolean { const b = this.build.boons; return !!b && b.includes(id as never); }
  mounted(system: WeaponSystemId | string): boolean {
    if (system === 'primary') return !trialHas(this.meta.activeTrial, 'no_primary');   // WP8: Hive Mind / Siege Mentality
    if (this.borrowed(system)) return true;                                              // WP8: Borrowed Blade
    if (this.build.hardpoints.includes(system as never)) return true;
    return frameDef(this.build.frame).freeMount === system;
  }
  /** WP8: mounted only through the Borrowed Blade Anomaly (no hardpoint slot; tier 1 only). */
  borrowed(system: WeaponSystemId | string): boolean {
    return system === 'blade' && this.hasAnomaly('borrowed_blade') && !this.build.hardpoints.includes('blade') && frameDef(this.build.frame).freeMount !== 'blade';
  }
  attuned(element: ElementId | string): boolean { return this.build.attunements.includes(element as never); }
  frameFlag(flag: string): boolean { return frameDef(this.build.frame).flags.includes(flag); }
  /** All resolved keys (debug / UI). */
  entries(): [string, number][] { return [...this.values.entries()]; }
}
