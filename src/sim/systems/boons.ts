/**
 * Mechanical boons (data/boons.ts, docs/BOONS.md). Stat boons resolve in core/stats.ts; the ones below change
 * behavior and live here. Each firing emits Ev.Anomaly with src `boon.<id>` (the Codex registers it, the
 * Inspector names it, and what follows chains from it). High-frequency ones are throttled to one event per
 * window and chain to that event. Everything uses World methods with causes; no randomness is needed.
 * Every number is BOON_TUNING (data/boons.ts); the defaults are in brackets.
 *
 *  encore          the first Ev.Fusion of each wave fires again [0.5 s] later: an [80]-unit blast of max(its
 *                  magnitude, [3] × primary damage) (source 'hazard')
 *  ricochet_rounds a primary kill flies on to the nearest other enemy within [100] u for [50%] of the killing hit
 *                  (source 'element', ≤ [8] per tick)
 *  forked_arc      primary crits hit the nearest other enemy within [120] u for [50%] of the crit (source
 *                  'element', ≤ [8] per tick)
 *  volatile_kills  kills (not by its own blasts) explode: [15%] of the victim's max HP, [60] u × blast radius
 *                  (≤ [12] per tick)
 *  static_field    lightning hits leave a [40] u hazard for [2] s at [25%] of the hit per second (one per [0.5] s)
 *  frostbite       every Chill application adds [1] more stack (its own application does not repeat)
 *  wildfire_seed   burning victims pass [1] Burn stack ([4] s, their burn dps) to up to [2] enemies within [80] u
 *  toxic_bloom     poisoned victims leave a [50] u cloud for [3] s at [8%] of their max HP per second (≤ [16] clouds)
 *  rally_drones    any kill: signals.droneRateMul = [1.4] for [2] s (drones.ts reads it)
 *  sharpened_edge  damageMul ×[1.3] for blade hits on elites and bosses
 *  focus_beam      damageMul for laser hits: +[10%] per second of contact with that enemy (contact breaks after
 *                  [0.25] s without a laser hit), up to +[50%]
 *  anchor_well     at wave start signals.wellLifeMul = [2] until the first well forms (gravitics.ts reads it)
 *  hunters_gambit  damageMul ×[1.4] on bosses, ×[0.8] on everything else
 *  stopwatch       every live enemy's fieldSlow ≥ [0.1] each tick (the statuses system turns it into speed)
 *  second_chance   World.deathGuard: the first lethal blow leaves 1 HP and [3] s invulnerability; then the boon
 *                  leaves the active list and joins run.boonSpent (never offered again this attempt)
 *  windfall        the next boss kill pays [1] extra Core (Ev.CoreDrop src boon.windfall); then it leaves the
 *                  active list (a later pick in the same attempt arms it again)
 *  trophy_hunter   elite / boss kills stack +[1%] damage (World.dynamicPowerMul, composed) up to +[10%], for the attempt
 */
import type { System, HitInfo } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { BoonId, StatusId } from '../core/ids';
import type { SimEvent } from '../core/types';
import { EnemyFlag, Ev, MAX_ENEMIES, TICK_RATE } from '../core/types';
import { BOON_TUNING as T, BOONS } from '../data/boons';

const FAR = -1_000_000;
const EXCL = new Int32Array(1);
const SCRATCH = new Int32Array(256);
/** Interned `boon.<id>` srcTags (built once; hooks never build strings). */
const TAGS = {} as Record<BoonId, string>;
for (const b of BOONS) TAGS[b.id] = `boon.${b.id}`;
const tag = (id: BoonId): string => TAGS[id];
const TAG_VOLATILE = tag('volatile_kills'), TAG_STATIC = tag('static_field'), TAG_FROST = tag('frostbite'), TAG_FORK = tag('forked_arc');

export class BoonsSystem implements System {
  readonly id = 'boons';
  private w: World | null = null;
  // flags (cached per rebuild)
  private encore = false; private ricochet = false; private forked = false; private volatile = false; private staticField = false; private frostbite = false;
  private wildfire = false; private bloom = false; private rally = false; private edge = false; private focus = false; private anchor = false;
  private gambit = false; private stopwatch = false; private second = false; private windfall = false; private trophy = false;
  private primaryDmg = 10; private blastMul = 1;
  // per tick / wave / attempt state
  private lastEvent = 0;
  private arcs = 0; private blasts = 0; private bounces = 0;
  private encoreDone = false; private encoreDue = -1; private encoreX = 0; private encoreY = 0; private encoreDmg = 0; private encoreCause = -1;
  private staticNext = 0;
  private rallyUntil = FAR;
  private anchorArmed = false;
  private focusStart = new Int32Array(MAX_ENEMIES).fill(FAR); private focusLast = new Int32Array(MAX_ENEMIES).fill(FAR);
  private cloudEnd = new Int32Array(T.toxic_bloom.maxClouds);
  private secondUsed = false; private windfallUsed = false;
  private spent: BoonId[] = [];
  private trophyStacks = 0; private trophyFactor = 1;
  private throttle = new Map<string, number>();

  init(w: World): void {
    this.w = w;
    this.rebuild(w);
    this.lastEvent = w.events.nextId;
    this.reset(w);
  }
  onAttemptStart(w: World): void { this.reset(w); }

  private reset(w: World): void {
    this.arcs = this.blasts = this.bounces = 0;
    this.encoreDone = false; this.encoreDue = -1;
    this.staticNext = 0; this.rallyUntil = FAR; this.anchorArmed = false;
    this.focusStart.fill(FAR); this.focusLast.fill(FAR); this.cloudEnd.fill(0);
    this.secondUsed = false; this.windfallUsed = false; this.spent.length = 0;
    this.setTrophy(w, 0);
    this.throttle.clear();
    w.signals.droneRateMul = 1; w.signals.wellLifeMul = 1;
  }

  rebuild(w: World): void {
    const s = w.stats as World['stats'] & { hasBoon?(id: string): boolean };
    const has = (id: BoonId): boolean => (s.hasBoon ? s.hasBoon(id) : w.build.boons?.includes(id) === true);
    this.encore = has('encore'); this.ricochet = has('ricochet_rounds'); this.forked = has('forked_arc'); this.volatile = has('volatile_kills');
    this.staticField = has('static_field'); this.frostbite = has('frostbite'); this.wildfire = has('wildfire_seed');
    this.bloom = has('toxic_bloom'); this.rally = has('rally_drones'); this.edge = has('sharpened_edge'); this.focus = has('focus_beam');
    this.anchor = has('anchor_well'); this.gambit = has('hunters_gambit'); this.stopwatch = has('stopwatch');
    // a one-use boon picked (again) arms afresh; run.boonSpent keeps a used Second Chance from coming back
    const second = has('second_chance'), windfall = has('windfall');
    if (second && !this.second) this.secondUsed = false;
    if (windfall && !this.windfall) this.windfallUsed = false;
    this.second = second; this.windfall = windfall; this.trophy = has('trophy_hunter');
    this.primaryDmg = Math.max(0, s.get('ballistics.damage'));
    this.blastMul = s.get('combat.blast_radius_mul') || 1;
    if (!this.rally) w.signals.droneRateMul = 1;
    if (!this.anchor) { w.signals.wellLifeMul = 1; this.anchorArmed = false; }
    if (!this.trophy) this.setTrophy(w, 0);
    w.deathGuard = this.second ? this.guard : null;
  }

  /** Ev.Anomaly `boon.<id>`, at most once per `every` ticks per boon (0 = always). Returns the id, or `cause` when throttled. */
  private fire(w: World, id: string, cause: number, x = 0, y = 0, every = 0, a = 0, b = 0): number {
    if (every > 0) {
      const last = this.throttle.get(id);
      if (last !== undefined && w.tick - last < every) return cause;
      this.throttle.set(id, w.tick);
    }
    return w.emit(Ev.Anomaly, id, a, b, x, y, cause);
  }

  onWaveStart(w: World): void {
    this.encoreDone = false; this.encoreDue = -1;
    this.anchorArmed = this.anchor;
    w.signals.wellLifeMul = this.anchor ? T.anchor_well.lifeMul : 1;
    if (this.stopwatch) this.fire(w, tag('stopwatch'), -1, 0, 0, 0, w.run.wave);
  }

  update(w: World): void {
    this.arcs = 0; this.blasts = 0; this.bounces = 0;
    // new events: the first Fusion of the wave (Encore), the first well (Anchor Well)
    const end = w.events.nextId;
    if ((this.encore && !this.encoreDone) || this.anchorArmed) (w as WorldImpl).events.forEachRange(this.lastEvent, end, this.onEvent);
    this.lastEvent = end;
    if (this.encoreDue >= 0 && w.tick >= this.encoreDue) {
      this.encoreDue = -1;
      w.explode(this.encoreX, this.encoreY, T.encore.radius * this.blastMul, this.encoreDmg, { source: 'hazard', srcTag: tag('encore'), cause: this.encoreCause, falloff: false });
    }
    if (this.rally) w.signals.droneRateMul = w.tick < this.rallyUntil ? 1 + T.rally_drones.rateBonus : 1;
    if (this.stopwatch) {
      const e = w.enemies, slow = T.stopwatch.slow;
      for (let i = 0; i < e.count; i++) if ((e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally)) === 0 && e.fieldSlow[i] < slow) e.fieldSlow[i] = slow;
    }
    if (this.spent.length) this.dropSpent(w);
  }

  /** forEachRange visitor (allocated once). */
  private readonly onEvent = (e: SimEvent): void => {
    const w = this.w!;
    if (e.type === Ev.Fusion && this.encore && !this.encoreDone) {
      this.encoreDone = true;
      this.encoreDmg = Math.max(e.b > 0 ? e.b : 0, T.encore.minPrimaryMul * this.primaryDmg);
      this.encoreX = e.x; this.encoreY = e.y;
      this.encoreCause = this.fire(w, tag('encore'), e.id, e.x, e.y, 0, 0, this.encoreDmg);
      this.encoreDue = w.tick + Math.round(T.encore.delaySeconds * TICK_RATE);
    } else if (e.type === Ev.Fx && e.src === 'gravitics.well' && this.anchorArmed) {
      this.anchorArmed = false;
      w.signals.wellLifeMul = 1;
      this.fire(w, tag('anchor_well'), e.id, e.x, e.y);
    }
  };

  /** One-use boons remove themselves from the active list (a free slot) after they fire. */
  private dropSpent(w: World): void {
    const b = w.build.boons, spent = w.run.boonSpent;
    let changed = false;
    for (const id of this.spent) {
      const k = b.indexOf(id);
      if (k >= 0) { b.splice(k, 1); changed = true; }
      if (spent && !spent.includes(id)) spent.push(id);
    }
    this.spent.length = 0;
    if (changed) w.rebuildStats();
  }

  // ---------------------------------------------------------------- hooks
  onHit(w: World, hit: HitInfo): void {
    if (this.forked && hit.crit && hit.source === 'primary' && this.arcs < T.forked_arc.perTick && hit.damage > 0) this.fork(w, hit);
    if (this.staticField && w.tick >= this.staticNext && hit.srcTag !== TAG_STATIC && hit.damage > 0
      && (hit.element === 'lightning' || hit.srcTag === 'lightning' || hit.srcTag === 'static')) {
      this.staticNext = w.tick + Math.round(T.static_field.everySeconds * TICK_RATE);
      const ev = this.fire(w, TAG_STATIC, hit.eventId, hit.x, hit.y);
      w.addHazard({ kind: 'fire_zone', x: hit.x, y: hit.y, radius: T.static_field.radius, life: T.static_field.seconds, dps: hit.damage * T.static_field.dpsFraction,
        element: 'lightning', cause: ev, owner: 'ability', srcTag: TAG_STATIC });
    }
  }

  private fork(w: World, hit: HitInfo): void {
    const i = hit.enemy, e = w.enemies;
    if (i < 0 || i >= e.count) return;
    EXCL[0] = i;
    const j = w.nearestExcluding(e.x[i], e.y[i], T.forked_arc.range, EXCL, 1);
    if (j < 0 || j === i || !w.alive(j)) return;
    this.arcs++;
    const ev = this.fire(w, TAG_FORK, hit.eventId, e.x[j], e.y[j], 0, j, hit.damage * T.forked_arc.fraction);
    w.damage(j, hit.damage * T.forked_arc.fraction, { source: 'element', srcTag: TAG_FORK, cause: ev });
  }

  onKill(w: World, hit: HitInfo): void {
    const i = hit.enemy, e = w.enemies;
    if (i < 0 || i >= e.count) return;
    const f = e.flags[i];
    if (f & EnemyFlag.Ally) return;
    const x = e.x[i], y = e.y[i], kill = hit.eventId;
    if (this.ricochet && hit.source === 'primary' && hit.damage > 0 && this.bounces < T.ricochet_rounds.perTick) {
      EXCL[0] = i;
      const j = w.nearestExcluding(x, y, T.ricochet_rounds.range, EXCL, 1);
      if (j >= 0 && j !== i && w.alive(j)) {
        this.bounces++;
        const dmg = hit.damage * T.ricochet_rounds.fraction;
        const ev = this.fire(w, tag('ricochet_rounds'), kill, e.x[j], e.y[j], 0, j, dmg);
        w.damage(j, dmg, { source: 'element', srcTag: tag('ricochet_rounds'), cause: ev });
      }
    }
    if (this.rally) {
      this.rallyUntil = w.tick + Math.round(T.rally_drones.seconds * TICK_RATE);
      this.fire(w, tag('rally_drones'), kill, x, y, 2 * TICK_RATE);
    }
    if (this.trophy && (f & (EnemyFlag.Elite | EnemyFlag.Boss)) && this.trophyStacks * T.trophy_hunter.perKill < T.trophy_hunter.max - 1e-9) {
      this.setTrophy(w, this.trophyStacks + 1);
      this.fire(w, tag('trophy_hunter'), kill, x, y, 0, this.trophyStacks);
    }
    if (this.windfall && !this.windfallUsed && (f & EnemyFlag.Boss)) {
      this.windfallUsed = true;
      const ev = this.fire(w, tag('windfall'), kill, x, y);
      w.run.cores += T.windfall.cores;
      w.emit(Ev.CoreDrop, tag('windfall'), T.windfall.cores, w.run.wave, x, y, ev);
      this.spent.push('windfall');
    }
    if (this.wildfire && e.burn[i] > 0) this.spreadBurn(w, i, x, y, kill);
    if (this.bloom && e.poison[i] > 0) this.cloud(w, i, x, y, kill);
    if (this.volatile && hit.srcTag !== TAG_VOLATILE && this.blasts < T.volatile_kills.perTick) {
      this.blasts++;
      const dmg = e.maxHp[i] * T.volatile_kills.fraction;
      const ev = this.fire(w, TAG_VOLATILE, kill, x, y, 0, 0, dmg);
      w.explode(x, y, T.volatile_kills.radius * this.blastMul, dmg, { source: 'hazard', srcTag: TAG_VOLATILE, cause: ev, falloff: false });
    }
  }

  private spreadBurn(w: World, i: number, x: number, y: number, kill: number): void {
    const e = w.enemies, dps = e.burnDps[i];
    const n = w.queryRadius(x, y, T.wildfire_seed.range, SCRATCH);
    let ev = -1, done = 0;
    for (let k = 0; k < n && done < T.wildfire_seed.targets; k++) {
      const j = SCRATCH[k];
      if (j === i || !w.alive(j) || (e.flags[j] & EnemyFlag.Ally)) continue;
      if (ev < 0) ev = this.fire(w, tag('wildfire_seed'), kill, x, y);
      w.applyStatus(j, 'burn', T.wildfire_seed.stacks, Math.round(T.wildfire_seed.seconds * TICK_RATE), tag('wildfire_seed'), ev, dps > 0 ? dps : undefined);
      done++;
    }
  }

  private cloud(w: World, i: number, x: number, y: number, kill: number): void {
    const now = w.tick;
    let slot = -1;
    for (let k = 0; k < this.cloudEnd.length; k++) if (this.cloudEnd[k] <= now) { slot = k; break; }
    if (slot < 0) return;
    this.cloudEnd[slot] = now + Math.round(T.toxic_bloom.seconds * TICK_RATE);
    const ev = this.fire(w, tag('toxic_bloom'), kill, x, y);
    w.addHazard({ kind: 'toxic_cloud', x, y, radius: T.toxic_bloom.radius, life: T.toxic_bloom.seconds, dps: w.enemies.maxHp[i] * T.toxic_bloom.dpsFraction,
      cause: ev, owner: 'ability', srcTag: tag('toxic_bloom') });
  }

  onStatusApply(w: World, enemy: number, status: StatusId, _stacks: number, srcTag: string, cause: number): void {
    if (!this.frostbite || status !== 'chill' || srcTag === TAG_FROST || !w.alive(enemy)) return;
    const e = w.enemies;
    const ev = this.fire(w, TAG_FROST, cause, e.x[enemy], e.y[enemy], TICK_RATE / 2);
    w.applyStatus(enemy, 'chill', T.frostbite.stacks, e.chillT[enemy], TAG_FROST, ev);
  }

  damageMul(w: World, i: number, _amount: number, hit: HitInfo): number {
    let m = 1;
    const f = w.enemies.flags[i];
    if (this.gambit) {
      const boss = (f & EnemyFlag.Boss) !== 0;
      m *= boss ? T.hunters_gambit.boss : T.hunters_gambit.other;
      if (boss) this.fire(w, tag('hunters_gambit'), hit.cause, w.enemies.x[i], w.enemies.y[i], 2 * TICK_RATE);
    }
    if (this.edge && hit.source === 'blade' && (f & (EnemyFlag.Elite | EnemyFlag.Boss))) {
      m *= 1 + T.sharpened_edge.bonus;
      this.fire(w, tag('sharpened_edge'), hit.cause, w.enemies.x[i], w.enemies.y[i], 2 * TICK_RATE);
    }
    if (this.focus && hit.source === 'laser') {
      const now = w.tick;
      if (now - this.focusLast[i] > Math.round(T.focus_beam.graceSeconds * TICK_RATE)) this.focusStart[i] = now;
      this.focusLast[i] = now;
      const bonus = Math.min(T.focus_beam.max, T.focus_beam.perSecond * ((now - this.focusStart[i]) / TICK_RATE));
      if (bonus > 0) {
        m *= 1 + bonus;
        if (bonus >= T.focus_beam.max - 1e-9) this.fire(w, tag('focus_beam'), hit.cause, w.enemies.x[i], w.enemies.y[i], 2 * TICK_RATE);
      }
    }
    return m;
  }

  onCompact(w: World, remap: Int32Array, oldCount: number): void {
    if (!this.focus) return;
    const s = this.focusStart, l = this.focusLast;
    for (let i = 0; i < oldCount; i++) {
      const j = remap[i];
      if (j >= 0 && j !== i) { s[j] = s[i]; l[j] = l[i]; }
    }
    for (let i = w.enemies.count; i < oldCount; i++) { s[i] = FAR; l[i] = FAR; }
  }

  /** World.deathGuard (Second Chance). */
  private readonly guard = (cause: number): number => {
    const w = this.w;
    if (!w || !this.second || this.secondUsed) return 0;
    this.secondUsed = true;
    this.fire(w, tag('second_chance'), cause);
    this.spent.push('second_chance');
    return Math.round(T.second_chance.invulnSeconds * TICK_RATE);
  };

  /** Trophy Hunter: compose World.dynamicPowerMul (divide out the previous factor, multiply in the new one). */
  private setTrophy(w: World, stacks: number): void {
    const factor = 1 + stacks * T.trophy_hunter.perKill;
    if (factor !== this.trophyFactor) {
      const cur = w.dynamicPowerMul > 0 ? w.dynamicPowerMul : 1;
      w.dynamicPowerMul = cur / this.trophyFactor * factor;
      this.trophyFactor = factor;
    }
    this.trophyStacks = stacks;
  }
}
