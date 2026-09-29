/**
 * Directive engine (design §11): WHEN condition AND condition → DO action, in priority order. WP9.
 *
 * The DirectivesSystem runs after the abilities system (SYSTEM_ORDER) during `between` and `combat`:
 *  - Directives (`meta.directives`) need `prestige.directives`; only the first
 *    floor(directives.slots) (3 at rank 1, +1 per rank, max 12) are evaluated.
 *  - A Directive ARMS on the first tick its conditions all hold and disarms when any fails. It may
 *    fire once armed for `directives.reaction_delay` s (0.6; Directive Tuning −0.06/rank, floor 0.3),
 *    its 1 s per-Directive cooldown has passed, and its action is executable now. At most one
 *    Directive fires per tick: the first in priority order. Firing disarms it (so a still-true rule
 *    waits the reaction delay again).
 *  - Actions become Commands queued with World.enqueueCommand (dispatched at the start of the next
 *    tick through run/commands.ts → System.onCommand, exactly like player input), flagged
 *    `viaDirective: true` (casts also carry `directive: <index>`, which lands in Ev.Cast data).
 *    Queued enemy indices are repaired in onCompact (dead targets drop the command).
 *  - Autocast (`prestige.autocast`) runs after the Directives for abilities no enabled Directive casts.
 *  - Upgrade Queue (`prestige.directives`): every 15 ticks between waves, every 2 s in combat.
 *
 * Conditions (see core/types.ts DirectiveCondition):
 *   inner_ring_at_least n      hostile enemies within INNER_RING of the tower ≥ n
 *   group_at_least n, radius   densest sampled cluster (≤ 64 samples) ≥ n
 *   tower_hp_below pct         hp < pct × maxHp (pct ≤ 1 is a fraction, > 1 a percentage)
 *   barrier_broken             maxBarrier > 0 and barrier ≤ 0
 *   boss_phase phase           live boss bossPhase === phase
 *   boss_tell_active           Adept: needs prestige.autonomy; reads world.bossTell.ticksLeft > 0 (WP5)
 *   enemy_present enemy        kind present ('elite' = any elite, 'boss' = any boss)
 *   ce_at_least ce             tower.ce ≥ ce
 *   wave_is boss|ordinary      current wave kind
 *   forecast_recommends        economy/forecast.ts forecastRecommends (tests may override with setForecastProbe)
 * Actions: cast at largest_group | nearest_threat | boss | tower; designate highest_threat | healer |
 * warden | weak_point | nearest_kamikaze; targeting (set_targeting); mode (set_mode); prestige
 * (Autonomy + meta.settings.autoPrestige; `{type:'prestige', frame: build.frame}`, WP8 implements it).
 */
import type { System } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { AbilityId } from '../core/ids';
import type { Command, Directive, DirectiveAction, DirectiveCondition } from '../core/types';
import { EnemyFlag, INNER_RING, NO_ENTITY, TICK_RATE } from '../core/types';
import { abilityDef, kindIndex } from '../core/content';
import { abilityCost, findAbilities, type AbilitiesSystem } from '../systems/abilities';
import { GroupFinder, findBoss, hostile, isTargetingProfile, nearestWith, pickDesignation } from './targeting-profiles';
import { Autocast } from './autocast';
import { runUpgradeQueue, sanitizeRules } from './upgrade-queue';
import { forecastRecommends as economyForecastRecommends } from '../economy/forecast';   // WP8

export const MAX_DIRECTIVES = 12;
const COOLDOWN_TICKS = TICK_RATE;           // per-Directive minimum interval
const MIN_DELAY_S = 0.3;
const QUEUE_BETWEEN_TICKS = 15;
const QUEUE_COMBAT_TICKS = 2 * TICK_RATE;
const DEFAULT_GROUP_R = 100;

type ForecastProbe = (w: World) => boolean;
let forecastProbe: ForecastProbe | null = null;
/** Test hook: override the forecast_recommends condition (null restores the economy Forecast). Module-global: tests only. */
export function setForecastProbe(fn: ForecastProbe | null): void { forecastProbe = fn; }
export function forecastRecommends(w: World): boolean {
  try {
    if (forecastProbe) return !!forecastProbe(w);
    return economyForecastRecommends(w as WorldImpl);
  } catch { return false; }
}

/** Adept condition source: a live boss tell (world.bossTell, written by enemies/bosses.ts). */
export function bossTellActive(w: World): boolean {
  const bt = w.bossTell;
  return bt.ticksLeft > 0 && bt.ability != null;
}

/** Number of Directive slots currently usable (0 when Directives are locked). */
export function directiveSlots(w: World): number {
  if (!w.stats.has('prestige.directives')) return 0;
  return Math.max(0, Math.min(MAX_DIRECTIVES, Math.floor(w.stats.get('directives.slots') + 1e-9)));
}

/** Reaction delay in ticks. */
export function reactionDelayTicks(w: World): number {
  return Math.round(Math.max(MIN_DELAY_S, w.stats.get('directives.reaction_delay')) * TICK_RATE);
}

/** Normalize Directives from a command (drops malformed entries, caps at 12). Allocates; command-time only. */
export function sanitizeDirectives(list: unknown): Directive[] {
  if (!Array.isArray(list)) return [];
  const out: Directive[] = [];
  for (const d of list as Directive[]) {
    if (out.length >= MAX_DIRECTIVES) break;
    if (!d || typeof d !== 'object' || !d.action || typeof d.action.kind !== 'string') continue;
    out.push({ enabled: d.enabled !== false, conditions: Array.isArray(d.conditions) ? d.conditions.map((c) => ({ ...c })) : [], action: { ...d.action } as DirectiveAction });
  }
  return out;
}

export class DirectivesSystem implements System {
  readonly id = 'directives';
  private armedAt = new Int32Array(MAX_DIRECTIVES).fill(-1);
  private readyAt = new Int32Array(MAX_DIRECTIVES);
  private groups = new GroupFinder();
  private autocast = new Autocast();
  private pt = new Float32Array(3);
  private abil: AbilitiesSystem | null = null;
  private reservedCe = 0;
  private owned: AbilityId[] = [];
  private readonly skip = (id: AbilityId): boolean => this.owned.includes(id);
  /** Last Directive index that fired (tests / Inspector), -1 = none. */
  lastFired = -1;

  init(w: World): void { this.abil = findAbilities(w); this.reset(); }
  rebuild(): void { /* reads stats on demand */ }
  onAttemptStart(): void { this.reset(); }

  private reset(): void { this.armedAt.fill(-1); this.readyAt.fill(0); this.autocast.reset(); this.groups.invalidate(); }

  onCommand(w: World, cmd: Command): boolean {
    if (cmd.type === 'set_directives') { w.meta.directives = sanitizeDirectives(cmd.directives); this.armedAt.fill(-1); this.readyAt.fill(0); return true; }
    if (cmd.type === 'set_upgrade_queue') { w.meta.upgradeQueue = sanitizeRules(cmd.rules); return true; }
    return false;
  }

  update(w: World): void {
    const run = w.run;
    if (run.phase !== 'combat' && run.phase !== 'between') return;
    if (!this.abil) this.abil = findAbilities(w);
    const slots = directiveSlots(w);
    this.reservedCe = 0;
    if (slots > 0) {
      if (run.phase === 'between' ? run.phaseTicks % QUEUE_BETWEEN_TICKS === 0 : run.waveTick % QUEUE_COMBAT_TICKS === QUEUE_COMBAT_TICKS - 1) runUpgradeQueue(w);
      this.runDirectives(w, slots);
    }
    if (this.abil && w.stats.has('prestige.autocast') && run.phase === 'combat') {
      this.collectOwned(w, slots);
      this.autocast.update(w, this.abil, this.groups, reactionDelayTicks(w), this.reservedCe, this.skip);
    }
  }

  private collectOwned(w: World, slots: number): void {
    const own = this.owned;
    own.length = 0;
    const list = w.meta.directives, n = Math.min(slots, list.length);
    for (let k = 0; k < n; k++) { const a = list[k].action; if (list[k].enabled && a.kind === 'cast' && !own.includes(a.ability)) own.push(a.ability); }
  }

  private runDirectives(w: World, slots: number): void {
    const list = w.meta.directives, n = Math.min(slots, list.length), tick = w.tick;
    const delay = reactionDelayTicks(w);
    let fired = false;
    for (let k = 0; k < n; k++) {
      const d = list[k];
      if (!d || !d.enabled || !this.conditionsHold(w, d.conditions)) { this.armedAt[k] = -1; continue; }
      if (this.armedAt[k] < 0) this.armedAt[k] = tick;
      if (fired || tick < this.readyAt[k] || tick - this.armedAt[k] < delay) continue;
      if (!this.act(w, k, d.action)) continue;
      fired = true;
      this.lastFired = k;
      this.readyAt[k] = tick + COOLDOWN_TICKS;
      this.armedAt[k] = -1;
    }
    for (let k = n; k < MAX_DIRECTIVES; k++) this.armedAt[k] = -1;
  }

  // -------------------------------------------------------------------------
  // Conditions
  // -------------------------------------------------------------------------
  conditionsHold(w: World, conds: readonly DirectiveCondition[]): boolean {
    for (let k = 0; k < conds.length; k++) if (!this.holds(w, conds[k])) return false;
    return true;
  }

  private holds(w: World, c: DirectiveCondition): boolean {
    const t = w.tower, e = w.enemies;
    switch (c.kind) {
      case 'inner_ring_at_least': return this.groups.countNear(w, 0, 0, INNER_RING) >= c.n;
      case 'group_at_least': return this.groups.largest(w, c.radius > 0 ? c.radius : DEFAULT_GROUP_R, this.pt) >= c.n;
      case 'tower_hp_below': { const f = c.pct > 1 ? c.pct / 100 : c.pct; return t.hp > 0 && t.hp < t.maxHp * f; }
      case 'barrier_broken': return t.maxBarrier > 0 && t.barrier <= 0;
      case 'boss_phase': { const b = findBoss(w); return b >= 0 && e.bossPhase[b] === c.phase; }
      case 'boss_tell_active': return w.stats.has('prestige.autonomy') && bossTellActive(w);
      case 'enemy_present': {
        if (c.enemy === 'elite') return nearestWith(w, 0, 0, EnemyFlag.Elite) >= 0;
        if (c.enemy === 'boss') return findBoss(w) >= 0;
        const ki = kindIndex(c.enemy);
        for (let i = 0; i < e.count; i++) if (e.kind[i] === ki && hostile(w, i)) return true;
        return false;
      }
      case 'ce_at_least': return t.ce >= c.ce;
      case 'wave_is': { const boss = w.wave ? w.wave.isBoss : w.run.wave % 5 === 0; return c.which === 'boss' ? boss : !boss; }
      case 'forecast_recommends': return forecastRecommends(w);
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  /** Execute `a` if it can do something now; returns whether a command was queued. */
  private act(w: World, index: number, a: DirectiveAction): boolean {
    const e = w.enemies, t = w.tower;
    switch (a.kind) {
      case 'cast': {
        if (!this.abil || this.abil.castBlocker(w, a.ability) !== null) return false;
        const cost = abilityCost(w, a.ability);
        if (t.ce - this.reservedCe < cost - 1e-9) return false;
        if (!this.castPoint(w, a.ability, a.at)) return false;
        this.reservedCe += cost;
        const tg = this.pt[2] | 0;
        w.enqueueCommand({ type: 'cast', ability: a.ability, x: this.pt[0], y: this.pt[1], ...(tg >= 0 ? { target: tg } : {}), viaDirective: true, directive: index });
        return true;
      }
      case 'designate': {
        const i = pickDesignation(w, a.what);
        if (i < 0 || (t.designated === i && t.designatedGen === e.gen[i])) return false;
        w.enqueueCommand({ type: 'designate', enemy: i, slot: 0, viaDirective: true });
        return true;
      }
      case 'targeting':
        if (!isTargetingProfile(a.profile) || (w.build.targeting[a.system] ?? 'nearest') === a.profile) return false;
        w.enqueueCommand({ type: 'set_targeting', system: a.system, profile: a.profile });
        return true;
      case 'mode':
        if (w.run.mode === a.mode) return false;
        w.enqueueCommand({ type: 'set_mode', mode: a.mode });
        return true;
      case 'prestige':
        if (!w.stats.has('prestige.autonomy') || !w.meta.settings.autoPrestige) return false;
        w.enqueueCommand({ type: 'prestige', frame: w.build.frame });
        return true;
    }
    return false;
  }

  /** Aim point (+ enemy) for a Directive cast into this.pt; false when there is nothing to aim at. */
  private castPoint(w: World, id: AbilityId, at: 'largest_group' | 'nearest_threat' | 'boss' | 'tower'): boolean {
    const pt = this.pt, e = w.enemies;
    pt[0] = 0; pt[1] = 0; pt[2] = NO_ENTITY;
    const def = abilityDef(id);
    const enemyTargeted = def?.targeted === 'enemy';
    let i = NO_ENTITY;
    switch (at) {
      case 'tower':
        if (!enemyTargeted) return true;
        i = nearestWith(w, 0, 0, 0);
        break;
      case 'boss': i = findBoss(w); break;
      case 'nearest_threat': i = nearestWith(w, 0, 0, 0); break;
      case 'largest_group': {
        const r = def && def.radius > 0 ? def.radius : DEFAULT_GROUP_R;
        if (this.groups.largest(w, r, pt) <= 0) return false;
        if (!enemyTargeted) return true;
        i = nearestWith(w, pt[0], pt[1], 0);
        break;
      }
    }
    if (i < 0) return false;
    pt[0] = e.x[i]; pt[1] = e.y[i]; pt[2] = i;
    return true;
  }

  /** Repair enemy indices inside queued Directive commands after pool compaction. */
  onCompact(w: World, remap: Int32Array, oldCount: number): void {
    const q = (w as WorldImpl).pendingCommands;
    if (!q) return;
    for (let k = q.length - 1; k >= 0; k--) {
      const c = q[k];
      if (c.type === 'designate' && c.enemy !== null && c.enemy >= 0) {
        const r = c.enemy < oldCount ? remap[c.enemy] : -1;
        if (r < 0) q.splice(k, 1); else c.enemy = r;
      } else if (c.type === 'cast' && c.target !== undefined && c.target >= 0) {
        c.target = c.target < oldCount ? remap[c.target] : -1;
      }
    }
  }
}
