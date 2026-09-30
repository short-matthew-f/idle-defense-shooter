/**
 * Tactical abilities and Command Energy (design §10). WP9.
 *
 * Casting (`cast` command, also issued by Directives/Autocast through World.enqueueCommand):
 *  - rejected under the Blackout trial, outside combat, when the ability is not in one of the first
 *    `abilitySlotCount()` slots (2; +1 prestige.third_tactical_slot; +1 reactor.command.fourth_slot),
 *    while on cooldown, or when tower.ce < cost. cost = def.cost × ability.<id>.cost_mul × (0.5 in the
 *    Commander trial).
 *  - spends CE, starts the cooldown def.cooldown × max(0.2, 1 − reactor.cooldown_reduction −
 *    reactor.command.cooldowns) (Critical Relay: each crit trims 0.02 s/rank), and emits Ev.Cast
 *    (src `ability.<id>`, a = ability index, b = cost, data {ability, viaDirective, directive}).
 *    Every effect uses that event as its cause and srcTag `ability.<id>`.
 *  - onCommand returns FALSE for `cast` on purpose (other observers may watch commands); a cast that goes off
 *    calls enemies/bosses.notifyAbilityCast, which scores any boss Counter it answers.
 *
 * Effects (numbers: data/abilities.ts + base-stats `ability.<id>.*`):
 *  hunter_mark      designates the enemy (tower.designated) and applies 'marked' for `duration` s.
 *                   CONTRACT for the elements system: `enemies.markedT[i] > 0` ⇒ status application on i
 *                   × (1 + ability.hunter_mark.status_bonus). The designation is released when the mark ends.
 *  repulsor_pulse   knockback away from the tower for every enemy within `radius`, `force` units; charges and boss
 *                   dashes in progress within the radius are cancelled (enemies/bosses.stallCharge)
 *  time_field       'time_field' hazard; enemies inside move at `slow` (20%) speed via enemies.fieldSlow; a charge or
 *                   boss dash that enters it stalls (stallCharge)
 *  bombardment      explode after `fuse` s: `damage` × ballistics.damage in `radius`
 *  emp              strips shields within 220; interrupts (staggerT = `duration` s) bosses, elites and
 *                   ability-bearing enemies (healers, wardens, ranged, jammers, nullifiers, support); a boss's
 *                   tether and shield links are cut for `duration` s (enemies/bosses.empLinkCut)
 *  overdrive        World.dynamicSpeedMul × `speed` for `duration` s
 *  emergency_repair healTower(`heal` × max HP)
 *  drone_surge      `count` homing Microdrone projectiles (pierce 5, 1.5× primary damage) for 10 s; in the last
 *                   0.75 s each survivor dives at the nearest enemy and explodes (40 u, 3× primary damage)
 *  feedback_loop    (Anomaly) every successful cast recasts itself 1 s later at 50% power: same point/target, no CE,
 *                   no cooldown, no Ev.Cast (so no Counter); Ev.Anomaly `anomaly.feedback_loop` is the recast's cause
 *  missile_storm    `missiles` homing Missiles over 4 s at enemies within 200 of the point (3× primary, blast 26)
 *  singularity_bomb pulls enemies within 150 toward the point for `pull_seconds`, then explodes for
 *                   `damage` × ballistics.damage (radius 100)
 *
 * Command Energy: kills (+2) / elite kills (+12) are paid by the core (World.finishKill); this system
 * adds boss phase changes (+15 per bossPhase increase of a live boss), +1/s while tower HP < 25% in combat, and
 * reactor.command.ce_regen per second in combat. All gains go through World.gainCE (cap
 * economy.ce_cap, which reactor.command.ce_cap feeds; × (1 + reactor.energy_recycling)). CE is emptied
 * by the run machine at every attempt start (death).
 */
import type { System, InstanceWriter, HitInfo } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { AbilityId } from '../core/ids';
import type { Command, UiState } from '../core/types';
import { ARENA_RADIUS, EnemyFlag, Ev, FxKind, NO_ENTITY, ProjFlag, ProjKind, Shape, TICK_RATE, TOWER_RADIUS } from '../core/types';
import { abilityDef, allAbilities } from '../core/content';
import { cos, sin, atan2, TAU } from '../math/lut';
import { stallCharge, empLinkCut, notifyAbilityCast } from '../enemies/bosses';

/** Projectile `source` index for ability projectiles (hits report source 'ability'). */
export const ABILITY_SOURCE = 255;
export const ABILITY_IDS: readonly AbilityId[] = allAbilities().map((a) => a.id);
export function abilityIndex(id: string): number { return ABILITY_IDS.indexOf(id as AbilityId); }

const MAX_SLOTS = 4;
const BOSS_PHASE_CE = 15;
const LOW_HP_CE_PER_S = 1;
const LOW_HP_FRACTION = 0.25;
const MIN_CD_MUL = 0.2;
const EMP_INTERRUPT = EnemyFlag.Boss | EnemyFlag.Elite | EnemyFlag.Healer | EnemyFlag.Shielder | EnemyFlag.Ranged
  | EnemyFlag.Jams | EnemyFlag.Nullifies | EnemyFlag.Support;
const MARK_PICK_RADIUS = 80;
const SINGULARITY_PULL = 260;           // units/s toward the point
const SINGULARITY_BLAST = 100;
const DRONE_DAMAGE_MUL = 1.5, DRONE_PIERCE = 5, DRONE_SPEED = 260, DRONE_SECONDS = 10;
/** Drone Surge's last 0.75 s: every surviving drone dives at the nearest enemy and explodes (DIVE_BLAST u, ×DIVE_MUL damage). */
const DIVE_TICKS = 45, DIVE_BLAST = 40, DIVE_MUL = 2;
/** Feedback Loop recasts waiting (fixed ring; a fifth cast inside one second is not repeated). */
const MAX_RECASTS = 4;
const MISSILE_DAMAGE_MUL = 3, MISSILE_BLAST = 26, MISSILE_SPEED = 360, MISSILE_LIFE = 3 * TICK_RATE;
const MAX_ZONES = 8;
const FX_RING = 16;

/** Is the named Trial running (world.trial)? */
export function trialActive(w: World, id: string): boolean { return w.trial === id; }

/** Tactical slots available: 2; +1 with prestige.third_tactical_slot; +1 with the Command capstone. */
export function abilitySlotCount(w: World): number {
  let n = 2;
  if (w.stats.has('prestige.third_tactical_slot')) n++;
  if (w.stats.has('reactor.command.fourth_slot')) n++;
  return Math.min(MAX_SLOTS, n);
}

/** Second Target Designator: Second Opinion anomaly or the Commander trial reward. */
export function secondDesignatorAllowed(w: World): boolean {
  return w.stats.hasAnomaly('second_opinion') || (w.meta.trials.commander ?? 0) > 0;
}

/** Is `id` in one of the usable tactical slots? */
export function abilitySlotted(w: World, id: string): boolean {
  const a = w.build.abilities, n = Math.min(a.length, abilitySlotCount(w));
  for (let k = 0; k < n; k++) if (a[k] === id) return true;
  return false;
}

/** CE cost after rank discounts and the Commander trial. */
export function abilityCost(w: World, id: string): number {
  const def = abilityDef(id);
  if (!def) return Infinity;
  const mul = Math.max(0, w.stats.get(`ability.${id}.cost_mul`));
  return def.cost * mul * (trialActive(w, 'commander') ? 0.5 : 1);
}

interface Zone { active: boolean; kind: number; x: number; y: number; r: number; start: number; end: number; cause: number; n: number; launched: number; p: number }
const Z_TIME = 0, Z_BOMB = 1, Z_SING = 2, Z_STORM = 3;

export class AbilitiesSystem implements System {
  readonly id = 'abilities';
  /** Cooldown remaining per ability (ticks, fractional). */
  readonly cd = new Float32Array(ABILITY_IDS.length);
  lastError: string | null = null;
  /** Ev.Cast id of the last successful cast (-1 if the last cast was rejected). */
  lastCastEvent = -1;
  private zones: Zone[] = [];
  private scratch = new Int32Array(2048);
  private cdMul = 1; private ceRegen = 0; private relayTicks = 0;
  private odTicks = 0; private odFactor = 1;
  private markIdx = NO_ENTITY; private markGen = 0;
  private surgeTicks = 0; private surgeTag = 0;
  /** Boss phase bookkeeping (gen → last seen bossPhase) for the +15 CE per phase change. */
  private bossGen = new Uint32Array(4); private bossSeen = new Uint8Array(4); private bossN = 0;
  private nextGen = new Uint32Array(4); private nextSeen = new Uint8Array(4);
  private fxBuf = new Float32Array(FX_RING * 5);
  private fxN = 0;

  // Feedback Loop recasts (ability index, point, target ref, due tick, cause); rcN live entries
  private rcK = new Int32Array(MAX_RECASTS); private rcX = new Float64Array(MAX_RECASTS); private rcY = new Float64Array(MAX_RECASTS);
  private rcT = new Int32Array(MAX_RECASTS); private rcG = new Uint32Array(MAX_RECASTS); private rcDue = new Int32Array(MAX_RECASTS);
  private rcCause = new Int32Array(MAX_RECASTS); private rcN = 0;

  constructor() { for (let k = 0; k < MAX_ZONES; k++) this.zones.push({ active: false, kind: 0, x: 0, y: 0, r: 0, start: 0, end: 0, cause: -1, n: 0, launched: 0, p: 1 }); }

  init(w: World): void {
    this.rebuild(w);
    this.surgeTag = w.tagId('ability.drone_surge');
    this.reset(w);
  }
  rebuild(w: World): void {
    const s = w.stats;
    this.cdMul = Math.max(MIN_CD_MUL, 1 - s.get('reactor.cooldown_reduction') - s.get('reactor.command.cooldowns'));
    this.ceRegen = Math.max(0, s.get('reactor.command.ce_regen'));
    this.relayTicks = Math.max(0, s.get('prestige.critical_relay')) * TICK_RATE;
  }
  onAttemptStart(w: World): void { this.reset(w); }

  private reset(w: World): void {
    this.cd.fill(0);
    for (const z of this.zones) z.active = false;
    this.setOverdrive(w, 1);
    this.odTicks = 0; this.surgeTicks = 0; this.markIdx = NO_ENTITY; this.bossN = 0; this.rcN = 0;
    (w as WorldImpl).huntedGen = 0;
  }

  private setOverdrive(w: World, f: number): void {
    if (f === this.odFactor) return;
    w.dynamicSpeedMul = (w.dynamicSpeedMul / this.odFactor) * f;
    this.odFactor = f;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------
  onCommand(w: World, cmd: Command): boolean {
    if (cmd.type === 'cast') {
      this.lastError = this.cast(w, cmd.ability, cmd.x, cmd.y, cmd.target ?? NO_ENTITY, !!cmd.viaDirective, cmd.directive ?? -1);
      if (this.lastError) this.lastCastEvent = -1;
    }
    return false;   // observe-only: boss Counters etc. must see casts too
  }

  /** Why `id` cannot be cast right now, or null. Directives/Autocast use the same check. */
  castBlocker(w: World, id: AbilityId): string | null {
    if (trialActive(w, 'blackout')) return 'Abilities are disabled (Blackout)';
    if (w.run.phase !== 'combat' || w.tower.hp <= 0) return 'Only in combat';
    const k = abilityIndex(id);
    if (k < 0 || !abilityDef(id)) return 'Unknown ability';
    if (!abilitySlotted(w, id)) return 'Ability not slotted';
    if (this.cd[k] > 0) return 'On cooldown';
    if (w.tower.ce < abilityCost(w, id) - 1e-9) return 'Not enough Command Energy';
    return null;
  }

  cast(w: World, id: AbilityId, x: number, y: number, target: number, viaDirective: boolean, directive: number): string | null {
    const block = this.castBlocker(w, id);
    if (block) return block;
    const def = abilityDef(id)!;
    const e = w.enemies, t = w.tower, s = w.stats;
    // clamp the point into the arena
    const d2 = x * x + y * y, lim = ARENA_RADIUS;
    if (!(d2 <= lim * lim)) { if (d2 > 0 && Number.isFinite(d2)) { const k = lim / Math.sqrt(d2); x *= k; y *= k; } else { x = 0; y = 0; } }
    // Commands run at the start of the tick, before the spatial hash is rebuilt (and after last tick's
    // pool compaction): refresh it so area queries see current indices and positions.
    (w as WorldImpl).rebuildSpatial();
    if (id === 'hunter_mark') {
      if (!(target >= 0 && w.alive(target))) target = w.nearestExcluding(x, y, MARK_PICK_RADIUS, this.scratch, 0);
      if (target < 0) return 'No target';
      x = e.x[target]; y = e.y[target];
    }
    const cost = abilityCost(w, id);
    t.ce = Math.max(0, t.ce - cost);
    const k = abilityIndex(id);
    this.cd[k] = def.cooldown * TICK_RATE * this.cdMul;
    const cause = w.emit(Ev.Cast, `ability.${id}`, k, cost, x, y, -1, { ability: id, viaDirective, directive });
    this.lastCastEvent = cause;
    this.effect(w, id, x, y, target, cause, 1);
    notifyAbilityCast(w, id, x, y, target, viaDirective);   // boss Counters score only for casts that go off
    // Feedback Loop (Anomaly): the cast repeats itself 1 s later at 50% power
    if (s.hasAnomaly('feedback_loop') && this.rcN < MAX_RECASTS) {
      const r = this.rcN++;
      this.rcK[r] = k; this.rcX[r] = x; this.rcY[r] = y; this.rcCause[r] = cause;
      this.rcT[r] = target >= 0 && w.alive(target) ? target : NO_ENTITY; this.rcG[r] = this.rcT[r] >= 0 ? e.gen[target] : 0;
      this.rcDue[r] = w.tick + Math.max(1, Math.round(s.get('anomaly.feedback_loop.delay') * TICK_RATE));
    }
    return null;
  }

  /** One ability's effect at `power` (1 for a cast, anomaly.feedback_loop.power for a Feedback Loop recast). */
  private effect(w: World, id: AbilityId, x: number, y: number, target: number, cause: number, power: number): void {
    const def = abilityDef(id)!;
    const e = w.enemies, t = w.tower, s = w.stats;
    const tag = `ability.${id}`;
    const now = w.tick;
    switch (id) {
      case 'hunter_mark': {
        if (!(target >= 0 && w.alive(target))) return;
        const dur = Math.round(s.get('ability.hunter_mark.duration') * TICK_RATE * power);
        w.applyStatus(target, 'marked', 1, dur, tag, cause);
        t.designated = target; t.designatedGen = e.gen[target];
        this.markIdx = target; this.markGen = e.gen[target];
        (w as WorldImpl).huntedGen = e.gen[target];
        this.fx(FxKind.Counter, x, y, e.radius[target] * 2, 0);
        break;
      }
      case 'repulsor_pulse': {
        const r = s.get('ability.repulsor_pulse.radius'), force = s.get('ability.repulsor_pulse.force') * power;
        const n = w.queryRadius(0, 0, r, this.scratch);
        for (let j = 0; j < n; j++) { const i = this.scratch[j]; if (this.hostile(w, i)) { stallCharge(w, i); w.knockback(i, e.x[i], e.y[i], force); } }
        this.fx(FxKind.Shockwave, 0, 0, r, 1);
        break;
      }
      case 'time_field': {
        const dur = s.get('ability.time_field.duration') * power;
        this.addZone(Z_TIME, x, y, def.radius, now + Math.round(dur * TICK_RATE), cause, 0);
        w.addHazard({ kind: 'time_field', x, y, radius: def.radius, life: dur, dps: 0, cause, owner: 'ability' });
        this.fx(FxKind.Shockwave, x, y, def.radius, 2);
        break;
      }
      case 'bombardment': {
        const z = this.addZone(Z_BOMB, x, y, s.get('ability.bombardment.radius') * (s.get('combat.blast_radius_mul') || 1), now + Math.round(s.get('ability.bombardment.fuse') * TICK_RATE), cause, 0);
        if (z) z.p = power;
        break;
      }
      case 'emp': {
        const dur = Math.round(s.get('ability.emp.duration') * TICK_RATE * power);
        const n = w.queryRadius(0, 0, def.radius, this.scratch);
        for (let j = 0; j < n; j++) {
          const i = this.scratch[j];
          if (!this.hostile(w, i)) continue;
          e.shield[i] = 0;
          if ((e.flags[i] & EMP_INTERRUPT) && e.staggerT[i] < dur) e.staggerT[i] = Math.min(65535, dur);
          if (e.flags[i] & EnemyFlag.Boss) empLinkCut(w, i, dur);
        }
        this.fx(FxKind.Shockwave, 0, 0, def.radius, 3);
        break;
      }
      case 'overdrive':
        this.odTicks = Math.max(this.odTicks, Math.round(s.get('ability.overdrive.duration') * TICK_RATE * power));
        this.setOverdrive(w, Math.max(1, s.get('ability.overdrive.speed')));
        break;
      case 'emergency_repair':
        w.healTower(t.maxHp * s.get('ability.emergency_repair.heal') * power, cause);
        this.fx(FxKind.Shockwave, 0, 0, TOWER_RADIUS * 2, 4);
        break;
      case 'drone_surge': {
        const n = Math.max(power < 1 ? 1 : 0, Math.floor(s.get('ability.drone_surge.count') * power + 1e-9));
        const dmg = DRONE_DAMAGE_MUL * s.get('ballistics.damage');
        for (let j = 0; j < n; j++) {
          const a = (j / Math.max(1, n)) * TAU;
          const tg = w.nearestExcluding(0, 0, ARENA_RADIUS, this.scratch, 0);
          w.spawnProjectile({ kind: ProjKind.Microdrone, source: ABILITY_SOURCE, srcTag: tag, x: cos(a) * TOWER_RADIUS, y: sin(a) * TOWER_RADIUS,
            vx: cos(a) * DRONE_SPEED, vy: sin(a) * DRONE_SPEED, damage: dmg, radius: 4, life: DRONE_SECONDS * TICK_RATE, pierce: DRONE_PIERCE,
            target: tg, flags: ProjFlag.Homing | ProjFlag.FromDrone, cause });
        }
        this.surgeTicks = DRONE_SECONDS * TICK_RATE;
        break;
      }
      case 'missile_storm': {
        const z = this.addZone(Z_STORM, x, y, def.radius, now + Math.max(1, Math.round(def.duration * TICK_RATE)), cause,
          Math.max(0, Math.floor(s.get('ability.missile_storm.missiles') * power + 1e-9)));
        if (z) this.fx(FxKind.Tell, x, y, def.radius, 5);
        break;
      }
      case 'singularity_bomb': {
        const z = this.addZone(Z_SING, x, y, def.radius, now + Math.round(s.get('ability.singularity_bomb.pull_seconds') * TICK_RATE), cause, 0);
        if (z) z.p = power;
        break;
      }
    }
  }

  /** Feedback Loop: release recasts that are due (Ev.Anomaly cause → the recast's effects). */
  private releaseRecasts(w: World): void {
    let r = 0;
    while (r < this.rcN) {
      if (this.rcDue[r] > w.tick) { r++; continue; }
      const id = ABILITY_IDS[this.rcK[r]];
      const tg = this.rcT[r] >= 0 ? w.resolveEnemy(this.rcT[r], this.rcG[r]) : NO_ENTITY;
      if (w.run.phase === 'combat' && w.tower.hp > 0) {
        const ev = w.emit(Ev.Anomaly, 'anomaly.feedback_loop', this.rcK[r], 0, this.rcX[r], this.rcY[r], this.rcCause[r]);
        this.effect(w, id, this.rcX[r], this.rcY[r], tg, ev, Math.max(0, w.stats.get('anomaly.feedback_loop.power')));
      }
      const l = --this.rcN;
      if (l !== r) {
        this.rcK[r] = this.rcK[l]; this.rcX[r] = this.rcX[l]; this.rcY[r] = this.rcY[l]; this.rcT[r] = this.rcT[l];
        this.rcG[r] = this.rcG[l]; this.rcDue[r] = this.rcDue[l]; this.rcCause[r] = this.rcCause[l];
      }
    }
  }

  private addZone(kind: number, x: number, y: number, r: number, end: number, cause: number, n: number): Zone | null {
    let z: Zone | null = null;
    for (const c of this.zones) if (!c.active) { z = c; break; }
    if (!z) {   // all busy: replace the one ending soonest (lowest index on ties)
      for (const c of this.zones) if (!z || c.end < z.end) z = c;
    }
    z!.active = true; z!.kind = kind; z!.x = x; z!.y = y; z!.r = r; z!.end = end; z!.cause = cause; z!.n = n; z!.launched = 0; z!.p = 1;
    z!.start = -1;
    return z;
  }

  private hostile(w: World, i: number): boolean { return w.alive(i) && (w.enemies.flags[i] & EnemyFlag.Ally) === 0; }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------
  update(w: World): void {
    const t = w.tower, run = w.run, e = w.enemies;
    // Command Energy sources the core does not pay
    const phases = this.bossPhaseChanges(w);
    if (run.phase === 'combat' && t.hp > 0) {
      if (phases > 0) w.gainCE(BOSS_PHASE_CE * phases);
      if (t.hp < t.maxHp * LOW_HP_FRACTION) w.gainCE(LOW_HP_CE_PER_S / TICK_RATE);
      if (this.ceRegen > 0) w.gainCE(this.ceRegen / TICK_RATE);
    }
    // cooldowns
    for (let k = 0; k < this.cd.length; k++) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - 1);
    // overdrive
    if (this.odTicks > 0 && --this.odTicks === 0) this.setOverdrive(w, 1);
    // Hunter Mark: release the designation when the mark ends
    if (this.markIdx !== NO_ENTITY) {
      const m = w.resolveEnemy(this.markIdx, this.markGen);
      if (m < 0 || e.markedT[m] === 0) {
        if (t.designatedGen === this.markGen) { t.designated = NO_ENTITY; t.designatedGen = 0; }
        if ((w as WorldImpl).huntedGen === this.markGen) (w as WorldImpl).huntedGen = 0;
        this.markIdx = NO_ENTITY;
      } else this.markIdx = m;
    }
    if (this.rcN > 0) this.releaseRecasts(w);
    // zones
    const now = w.tick;
    for (const z of this.zones) if (z.active) this.tickZone(w, z, now);
    // drone surge: retarget drones whose target died or was already struck; at the end they dive and explode
    if (this.surgeTicks > 0) { this.surgeTicks--; this.retargetDrones(w); }
  }

  /**
   * Boss phase changes since last tick (bossPhase increases on live bosses, tracked by generation).
   * Reading the pool instead of scanning Ev.BossPhase keeps this O(bosses) on event-heavy ticks.
   */
  private bossPhaseChanges(w: World): number {
    const e = w.enemies;
    let changes = 0, n = 0;
    for (let i = 0; i < e.count && n < 4; i++) {
      if ((e.flags[i] & (EnemyFlag.Boss | EnemyFlag.Dead)) !== EnemyFlag.Boss) continue;
      const gen = e.gen[i], ph = e.bossPhase[i];
      let k = 0;
      while (k < this.bossN && this.bossGen[k] !== gen) k++;
      const seen = k < this.bossN ? this.bossSeen[k] : ph;
      if (ph > seen) changes += ph - seen;
      this.nextGen[n] = gen; this.nextSeen[n] = ph; n++;
    }
    // the table becomes the bosses alive this tick (double-buffered: no allocation)
    const g = this.bossGen, sn = this.bossSeen;
    this.bossGen = this.nextGen; this.bossSeen = this.nextSeen; this.nextGen = g; this.nextSeen = sn;
    this.bossN = n;
    return changes;
  }

  private tickZone(w: World, z: Zone, now: number): void {
    const e = w.enemies, s = w.stats;
    switch (z.kind) {
      case Z_TIME: {
        if (now >= z.end) { z.active = false; return; }
        const slow = 1 - Math.min(1, Math.max(0, s.get('ability.time_field.slow')));
        const n = w.queryRadius(z.x, z.y, z.r, this.scratch);
        for (let j = 0; j < n; j++) {
          const i = this.scratch[j];
          if (!this.hostile(w, i)) continue;
          if (e.fieldSlow[i] < slow) e.fieldSlow[i] = slow;
          stallCharge(w, i);   // dashes and charges that enter the field stall
        }
        return;
      }
      case Z_BOMB:
        if (now < z.end) return;
        z.active = false;
        w.explode(z.x, z.y, z.r, s.get('ability.bombardment.damage') * s.get('ballistics.damage') * z.p, { source: 'ability', srcTag: 'ability.bombardment', cause: z.cause });
        return;
      case Z_SING: {
        if (now >= z.end) {
          z.active = false;
          w.explode(z.x, z.y, SINGULARITY_BLAST * (s.get('combat.blast_radius_mul') || 1), s.get('ability.singularity_bomb.damage') * s.get('ballistics.damage') * z.p,
            { source: 'ability', srcTag: 'ability.singularity_bomb', cause: z.cause, falloff: false });
          return;
        }
        const n = w.queryRadius(z.x, z.y, z.r, this.scratch);
        for (let j = 0; j < n; j++) { const i = this.scratch[j]; if (this.hostile(w, i)) w.pull(i, z.x, z.y, SINGULARITY_PULL); }
        return;
      }
      case Z_STORM: {
        if (z.start < 0) z.start = now;
        const span = Math.max(1, z.end - z.start);
        const due = now >= z.end ? z.n : Math.min(z.n, Math.floor(((now - z.start + 1) * z.n) / span));
        while (z.launched < due) { this.launchMissile(w, z); z.launched++; }
        if (z.launched >= z.n) z.active = false;
        return;
      }
    }
  }

  private launchMissile(w: World, z: Zone): void {
    const e = w.enemies;
    const n = w.queryRadius(z.x, z.y, z.r, this.scratch);
    let tg = NO_ENTITY, seen = 0;
    // cycle deterministically through the enemies near the point
    for (let j = 0; j < n && tg < 0; j++) { const i = this.scratch[j]; if (this.hostile(w, i) && seen++ === z.launched % Math.max(1, n)) tg = i; }
    if (tg < 0) for (let j = 0; j < n; j++) { const i = this.scratch[j]; if (this.hostile(w, i)) { tg = i; break; } }
    const tx = tg >= 0 ? e.x[tg] : z.x, ty = tg >= 0 ? e.y[tg] : z.y;
    const a = atan2(ty, tx) + ((z.launched % 5) - 2) * 0.25;
    w.spawnProjectile({ kind: ProjKind.Missile, source: ABILITY_SOURCE, srcTag: 'ability.missile_storm',
      x: cos(a) * TOWER_RADIUS, y: sin(a) * TOWER_RADIUS, vx: cos(a) * MISSILE_SPEED, vy: sin(a) * MISSILE_SPEED,
      damage: MISSILE_DAMAGE_MUL * w.stats.get('ballistics.damage'), radius: 4, life: MISSILE_LIFE, blast: MISSILE_BLAST * (w.stats.get('combat.blast_radius_mul') || 1),
      target: tg, flags: ProjFlag.Homing, cause: z.cause });
  }

  private retargetDrones(w: World): void {
    const p = w.projectiles, tag = this.surgeTag;
    for (let i = 0; i < p.count; i++) {
      if (p.tag[i] !== tag || (p.flags[i] & ProjFlag.Dead)) continue;
      if (p.blast[i] === 0 && p.life[i] <= DIVE_TICKS) {
        // the drone's last 0.75 s: dive at the nearest enemy; its next impact is an explosion
        const nt = w.nearestExcluding(p.x[i], p.y[i], ARENA_RADIUS * 2, this.scratch, 0);
        p.target[i] = nt; p.targetGen[i] = nt >= 0 ? w.enemies.gen[nt] : 0;
        p.pierce[i] = 0; p.blast[i] = DIVE_BLAST * (w.stats.get('combat.blast_radius_mul') || 1); p.damage[i] *= DIVE_MUL;
        p.hitMask[i] = 0; p.lastHit[i] = NO_ENTITY;
        continue;
      }
      if (p.blast[i] > 0) continue;   // diving: keep the dive target
      const cur = p.target[i];
      if (cur >= 0 && cur !== p.lastHit[i] && w.alive(cur)) continue;
      this.scratch[0] = p.lastHit[i];
      const nt = w.nearestExcluding(p.x[i], p.y[i], ARENA_RADIUS * 2, this.scratch, p.lastHit[i] >= 0 ? 1 : 0);
      p.target[i] = nt; p.targetGen[i] = nt >= 0 ? w.enemies.gen[nt] : 0;
    }
  }

  onHit(_w: World, hit: HitInfo): void {
    if (!hit.crit || this.relayTicks <= 0) return;
    for (let k = 0; k < this.cd.length; k++) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - this.relayTicks);
  }

  onCompact(_w: World, remap: Int32Array, oldCount: number): void {
    if (this.markIdx >= 0) this.markIdx = this.markIdx < oldCount ? remap[this.markIdx] : NO_ENTITY;
  }

  // -------------------------------------------------------------------------
  // UI / render
  // -------------------------------------------------------------------------
  uiEntries(w: World): UiState['abilities'] {
    const out: UiState['abilities'] = [];
    const a = w.build.abilities, n = Math.min(a.length, abilitySlotCount(w));
    for (let k = 0; k < n; k++) {
      const id = a[k];
      if (!id || !abilityDef(id)) continue;
      const cost = abilityCost(w, id);
      const cd = this.cd[abilityIndex(id)] / TICK_RATE;
      out.push({ id, cost, cooldown: cd, ready: cd <= 0 && w.tower.ce >= cost && !trialActive(w, 'blackout') });
    }
    return out;
  }

  private fx(kind: number, x: number, y: number, size: number, color: number): void {
    const o = (this.fxN % FX_RING) * 5;
    this.fxBuf[o] = kind; this.fxBuf[o + 1] = x; this.fxBuf[o + 2] = y; this.fxBuf[o + 3] = size; this.fxBuf[o + 4] = color;
    this.fxN++;
  }

  render(w: World, out: InstanceWriter): void {
    const now = w.tick, e = w.enemies;
    for (const z of this.zones) {
      if (!z.active) continue;
      const left = Math.max(0, z.end - now);
      switch (z.kind) {
        case Z_TIME: out.push(z.x, z.y, z.r, now * 0.01, Shape.Ring, 0.6, 0.7, 1, 0.55 + 0.3 * Math.min(1, left / 60), 1); break;
        case Z_BOMB: out.push(z.x, z.y, z.r, 0, Shape.Ring, 1, 0.45, 0.2, 0.4 + 0.4 * ((now >> 4) & 1), 7); out.push(z.x, z.y, 8, 0, Shape.Cross, 1, 0.45, 0.2, 1, 7); break;
        case Z_SING: {
          const f = Math.min(1, left / 120);
          out.push(z.x, z.y, z.r * (0.3 + 0.7 * f), now * 0.2, Shape.Ring, 0.7, 0.4, 1, 0.7, 2);
          out.push(z.x, z.y, 10 + 6 * (1 - f), -now * 0.3, Shape.Star, 0.85, 0.6, 1, 1, 2);
          break;
        }
        case Z_STORM: out.push(z.x, z.y, z.r, 0, Shape.Ring, 1, 0.75, 0.3, 0.3, 1); break;
      }
    }
    if (this.odTicks > 0) out.push(0, 0, TOWER_RADIUS + 10, now * 0.3, Shape.Ring, 1, 0.55, 0.15, 0.8, 2);
    if (this.markIdx >= 0 && this.markIdx < e.count) out.push(e.x[this.markIdx], e.y[this.markIdx], e.radius[this.markIdx] + 8, now * 0.05, Shape.Cross, 1, 0.25, 0.25, 0.9, 7);
    const n = Math.min(this.fxN, FX_RING);
    for (let k = 0; k < n; k++) {
      const o = ((this.fxN - n + k) % FX_RING) * 5;
      const c = FX_COLORS[this.fxBuf[o + 4] | 0] ?? FX_COLORS[0];
      out.fx(this.fxBuf[o], this.fxBuf[o + 1], this.fxBuf[o + 2], c[0], c[1], c[2], this.fxBuf[o + 3], 24);
    }
    this.fxN = 0;
  }
}

const FX_COLORS: [number, number, number][] = [
  [1, 0.3, 0.3], [0.7, 0.9, 1], [0.6, 0.7, 1], [0.5, 0.8, 1], [0.4, 1, 0.5], [1, 0.75, 0.3],
];

/** The registered AbilitiesSystem (WP9-internal lookup for Directives / Autocast / UI), or null. */
export function findAbilities(w: World): AbilitiesSystem | null {
  for (const s of (w as WorldImpl).systems) if (s instanceof AbilitiesSystem) return s;
  return null;
}

/** UiState.abilities for the world's AbilitiesSystem (empty list if the system is not registered). */
export function abilityUi(w: WorldImpl): UiState['abilities'] {
  return findAbilities(w)?.uiEntries(w) ?? [];
}
