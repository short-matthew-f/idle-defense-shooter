/**
 * Fusions and Triads (design §6, §15; WP2). A Fusion is live when both elements are attuned and
 * `fusion.<id>` has an effective rank ≥ 1 (the Conductor frame's `fusions_start_rank1` is folded into the
 * rank by the stat resolver); a Triad when all three are attuned and `triad.<id>` rank ≥ 1. Magnitudes are
 * the node-id stat keys (data/fusions.ts, data/base-stats.ts). Every trigger emits Ev.Fusion / Ev.Triad
 * (src = node id, a = enemy, b = magnitude) and the resulting damage chains from that event.
 *
 * Implemented here (observing hooks). Toxic Combustion and Thermal Shock are decided (and their Ev.Fusion
 * emitted, poison consumed, lockout set) at the trigger, but their explosions detonate from update() under
 * FUSION_BUDGET per tick (BurstQueue), usually the next tick, so chain reactions cannot hitch one tick.
 *   Toxic Combustion  Burn applied to an enemy with ≥ fusion.toxic_combustion.min_stacks Poison consumes the
 *                     poison: explosion (80 u) of its remaining poison damage × fusion.toxic_combustion.
 *   Thermal Shock     Burn on an enemy with ≥ 4 Chill, or Chill on one with ≥ 3 Burn: physical burst (50 u) of
 *                     fusion.thermal_shock × the triggering hit's damage (read from the StatusApply's parent
 *                     event); once per enemy per second (enemies.thermalUntil).
 *   Cryotoxin         Poison DoT on a frozen enemy is banked (damageMul → 0, enemies.bankedPoison) and released
 *                     × fusion.cryotoxin in one hit when it thaws.
 *   Polar Storm       Thermal Shock bursts also arc to triad.polar_storm enemies at full arc damage.
 *   Crucible          Thermal Shock bursts copy min(victim stacks, triad.crucible) Poison onto everything they hit.
 * Implemented inside the arc pipeline (ArcEngine, elements-shared.ts), because they change how an arc is
 * built rather than react to it: Superconductivity, Electrolysis, Plasma, Cold Circuit.
 * Implemented in the proc pipeline (elements.ts): Catalyst.
 */
import type { System, HitInfo } from '../core/system';
import type { World } from '../core/world';
import type { StatusId } from '../core/ids';
import { Ev, TICK_RATE } from '../core/types';
import { ArcEngine, BurstQueue, pendingPoison } from './elements-shared';

const TAG_TOXIC = 'fusion.toxic_combustion', TAG_THERMAL = 'fusion.thermal_shock', TAG_CRYO = 'fusion.cryotoxin';
const K_TOXIC = 1, K_THERMAL = 2;
/** Fusion bursts detonated per tick (Toxic Combustion + Thermal Shock; see BurstQueue). */
export const FUSION_BUDGET = 16;

export class FusionsSystem implements System {
  readonly id = 'fusions';
  readonly arcs = new ArcEngine();
  private bursts = new BurstQueue();
  private toxic = 0; private toxicMin = 5; private toxicR = 80; private toxicCap = 0.5;
  private thermal = 0; private chillTh = 4; private burnTh = 3; private thermalR = 50;
  private cryo = 0;
  private polar = 0; private crucible = 0; private arcFrac = 0.5; private refDmg = 10; private poisonDur = 300; private blastMul = 1;
  // Crucible state during one synchronous burst (saved/restored around nested bursts)
  private cStacks = 0; private cDps = 0; private cCause = -1; private cVictim = -1;

  init(w: World): void { this.rebuild(w); }
  onAttemptStart(): void { this.bursts.clear(); }

  rebuild(w: World): void {
    const s = w.stats;
    this.arcs.rebuild(w);
    this.blastMul = s.get('combat.blast_radius_mul') || 1;
    this.toxic = s.has(TAG_TOXIC) ? s.get(TAG_TOXIC) : 0;
    this.toxicCap = s.get('fusion.toxic_combustion.target_cap');
    this.toxicMin = s.get('fusion.toxic_combustion.min_stacks'); this.toxicR = s.get('fusion.toxic_combustion.radius') * this.blastMul;
    this.thermal = s.has(TAG_THERMAL) ? s.get(TAG_THERMAL) : 0;
    this.chillTh = s.get('fusion.thermal_shock.chill_threshold'); this.burnTh = s.get('fusion.thermal_shock.burn_threshold');
    this.thermalR = s.get('fusion.thermal_shock.radius') * this.blastMul;
    this.cryo = s.has(TAG_CRYO) ? s.get(TAG_CRYO) : 0;
    this.polar = s.has('triad.polar_storm') ? Math.round(s.get('triad.polar_storm')) : 0;
    this.crucible = s.has('triad.crucible') ? Math.round(s.get('triad.crucible')) : 0;
    this.arcFrac = s.get('lightning.arc_damage'); this.refDmg = s.get('ballistics.damage');
    this.poisonDur = Math.round(s.get('poison.duration') * TICK_RATE);
  }

  update(w: World): void {
    if (this.bursts.length > 0) this.drain(w);
    if (this.cryo <= 0) return;
    const e = w.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.bankedPoison[i] <= 0 || e.frozenT[i] > 0 || !w.alive(i)) continue;
      const amt = e.bankedPoison[i] * this.cryo;
      e.bankedPoison[i] = 0;
      const fid = w.emit(Ev.Fusion, TAG_CRYO, i, amt, e.x[i], e.y[i], e.poisonCause[i]);
      w.damage(i, amt, { source: 'fusion', srcTag: TAG_CRYO, element: 'poison', cause: fid, ignoreArmor: true });
    }
  }

  onStatusApply(w: World, i: number, status: StatusId, _n: number, _tag: string, id: number): void {
    const e = w.enemies;
    if (status === 'burn') {
      if (this.toxic > 0 && e.poison[i] >= this.toxicMin) this.toxicCombustion(w, i, id);
      if (this.thermal > 0 && e.chill[i] >= this.chillTh && w.alive(i)) this.thermalShock(w, i, id);
    } else if (status === 'chill') {
      if (this.thermal > 0 && e.burn[i] >= this.burnTh) this.thermalShock(w, i, id);
    }
  }

  private toxicCombustion(w: World, i: number, cause: number): void {
    const e = w.enemies;
    const dmg = pendingPoison(w, i) * this.toxic;
    const x = e.x[i], y = e.y[i];
    const fid = w.emit(Ev.Fusion, TAG_TOXIC, i, dmg, x, y, cause);
    e.poison[i] = 0; e.poisonT[i] = 0;
    if (dmg > 0 && this.bursts.push(w, K_TOXIC, i, dmg, 0, 0, fid, this.toxicR * 0.5) < 0) this.toxicBoom(w, x, y, dmg, fid);
  }
  private toxicBoom(w: World, x: number, y: number, dmg: number, fid: number): void {
    w.explode(x, y, this.toxicR, dmg, { source: 'fusion', srcTag: TAG_TOXIC, element: 'fire', cause: fid, falloff: true, maxHpCap: this.toxicCap });
  }

  private drain(w: World): void {
    const q = this.bursts, e = w.enemies;
    for (let k = 0; k < FUSION_BUDGET; k++) {
      const s = q.shift();
      if (s < 0) break;
      const i = w.resolveEnemy(q.enemy[s], q.gen[s]);
      const x = i >= 0 ? e.x[i] : q.x[s], y = i >= 0 ? e.y[i] : q.y[s];
      const kind = q.kind[s], dmg = q.dmg[s], trig = q.a[s], cause = q.cause[s];
      if (kind === K_TOXIC) this.toxicBoom(w, x, y, dmg, cause);
      else this.thermalBoom(w, i, x, y, dmg, trig, cause);
    }
  }

  /** Damage of the hit that caused StatusApply `id` (Hit / Explosion / Triad / Fusion parents carry it in `b`). */
  private triggerDamage(w: World, id: number): number {
    const sa = w.events.byId(id);
    const parent = sa ? w.events.byId(sa.cause) : undefined;
    if (parent && parent.b > 0 && (parent.type === Ev.Hit || parent.type === Ev.Explosion || parent.type === Ev.Triad || parent.type === Ev.Fusion)) return parent.b;
    return this.refDmg;
  }

  private thermalShock(w: World, i: number, cause: number): void {
    const e = w.enemies, tick = w.tick;
    if (e.thermalUntil[i] > tick) return;
    e.thermalUntil[i] = tick + TICK_RATE;
    const trig = this.triggerDamage(w, cause);
    const dmg = trig * this.thermal;
    const x = e.x[i], y = e.y[i];
    const fid = w.emit(Ev.Fusion, TAG_THERMAL, i, dmg, x, y, cause);
    if (this.bursts.push(w, K_THERMAL, i, dmg, trig, 0, fid, this.thermalR * 0.5) < 0) this.thermalBoom(w, i, x, y, dmg, trig, fid);
  }

  /** Thermal Shock detonation; `i` = victim index or -1 if it died meanwhile. */
  private thermalBoom(w: World, i: number, x: number, y: number, dmg: number, trig: number, fid: number): void {
    const e = w.enemies;
    const ps = this.cStacks, pd = this.cDps, pc = this.cCause, pv = this.cVictim;
    this.cStacks = 0; this.cVictim = i;
    if (this.crucible > 0 && i >= 0 && e.poison[i] > 0) {
      this.cStacks = Math.min(e.poison[i], this.crucible); this.cDps = e.poisonDps[i]; this.cVictim = i;
      this.cCause = w.emit(Ev.Triad, 'triad.crucible', i, this.cStacks, x, y, fid);
    }
    w.explode(x, y, this.thermalR, dmg, { source: 'fusion', srcTag: TAG_THERMAL, element: null, cause: fid, falloff: false });
    this.cStacks = ps; this.cDps = pd; this.cCause = pc; this.cVictim = pv;
    if (this.polar > 0) {
      const tid = w.emit(Ev.Triad, 'triad.polar_storm', i, this.polar, x, y, fid);
      this.arcs.chain(w, i, x, y, this.polar, this.arcFrac * trig, tid);   // i = -1: arcs from the burst point
    }
  }

  onHit(w: World, hit: HitInfo): void {
    if (this.cStacks > 0 && hit.srcTag === TAG_THERMAL && hit.enemy !== this.cVictim && w.alive(hit.enemy)) {
      w.applyStatus(hit.enemy, 'poison', this.cStacks, this.poisonDur, 'triad.crucible', this.cCause, this.cDps);
    }
  }

  damageMul(w: World, i: number, amount: number, hit: HitInfo): number {
    if (this.cryo > 0 && hit.srcTag === 'poison' && hit.source === 'status' && w.enemies.frozenT[i] > 0) {
      w.enemies.bankedPoison[i] += amount;
      return 0;
    }
    return 1;
  }
}
