/**
 * Bastion (design §5; WP2): the survival tree's doctrine mechanics. The base stats (max HP, armor,
 * shield, recharge, regeneration, resistance) are read by WorldImpl.damageTower and systems/tower.ts;
 * Second Core lives in WorldImpl.damageTower (once per wave, reset by the run machine at wave start).
 *
 *  Fortress  Fortification: at full HP, temp HP builds at bastion.fortress.fortification.rate × max HP/s up to
 *            bastion.fortress.fortification × max HP. Keep: healing past max HP (World.healOverflow, plus
 *            regeneration while full) becomes barrier, up to bastion.fortress.keep.cap × max HP, no decay.
 *  Aegis     Outer Barrier: tower.barrier/maxBarrier = bastion.aegis.barrier, a ring at
 *            bastion.aegis.barrier_radius. Enemies (not bosses/ranged/intangible) are held at the ring and
 *            make their contact attacks against it (damageTower drains barrier first); kamikazes detonate
 *            on it. Hostile projectiles entering the ring are absorbed. Restores barrier_regen × max per
 *            second after barrier_delay s without tower damage; refills at wave/attempt start.
 *            Shockwave Shield: when it breaks, pushes enemies within ring+90 u by bastion.aegis.shockwave_shield
 *            and deals shockwave_damage × max barrier. Mirror Aegis: hostile projectiles at the ring are
 *            reflected at their shooter (homing, Hostile cleared, × mirror_aegis.reflect damage; hit source
 *            'ability' so reflections never proc elements or Synchronization).
 *  Thorns    Retaliation (onTowerHit): retaliation × damage taken × retaliation_mul + retaliation_per_armor ×
 *            armor, ×(1 + armor/100) on the Bulwark frame (flag retaliation_scales_armor); srcTag
 *            'bastion.thorns'. Reactive Armor: +x armor per hit for 3 s, up to 5 stacks (World.towerArmorMul).
 *            Spite: retaliation chains to the nearest other enemy within 120 u at 60% ('bastion.spite').
 *  Phoenix   Last Stand: +x damage per 10% HP missing (World.dynamicPowerMul). Rekindle: first time each wave
 *            below 50% HP, heal x × max HP over 4 s. Ember Heart: below 25% HP, +30% speed for every system
 *            (World.dynamicSpeedMul; hardpoint systems must multiply their rates by it too).
 * dynamicPowerMul / dynamicSpeedMul / towerArmorMul follow the WP9 composition rule: divide out this
 * system's previous factor, multiply in the new one.
 */
import type { System, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import { EnemyFlag, Ev, ProjFlag, Shape, TICK_RATE, NO_ENTITY } from '../core/types';
import { growth } from '../math/lut';
import { CONTACT_GROWTH } from '../economy/curves';
import { targetable } from '../core/spatial';
import { QueryStack, nearestN } from './elements-shared';

const HELD = EnemyFlag.Boss | EnemyFlag.Ranged | EnemyFlag.Ally | EnemyFlag.Dead;
const SHOCK_REACH = 90;
const REKINDLE_PULSES = 16;
const REKINDLE_EVERY = 15;   // 16 pulses × 15 ticks = 4 s

export class BastionSystem implements System {
  readonly id = 'bastion';
  private qs = new QueryStack();
  private near = new Int32Array(2);
  // fortress
  private fortCap = 0; private fortRate = 0.02; private keep = false; private keepCap = 0.25;
  // aegis
  private aegis = 0; private barrierR = 70; private regen = 0.1; private delay = 300;
  private shockwave = 0; private shockFrac = 0.5; private mirror = false; private reflect = 1;
  // thorns
  private retaliation = 0; private perArmor = 1; private retMul = 1; private bulwark = false;
  private reactive = 0; private reactiveDur = 180; private reactiveMax = 5; private spite = false; private spiteChain = 0.6; private spiteR = 120;
  // phoenix
  private lastStand = 0; private rekindle = 0; private rekindleTh = 0.5; private ember = false; private emberTh = 0.25; private emberSpeed = 0.3;
  private regenRate = 0;
  // runtime
  private reactiveStacks = 0; private reactiveUntil = 0;
  private appliedArmor = 1; private appliedPower = 1; private appliedSpeed = 1;
  private rekindleUsed = false; private rekindleLeft = 0; private rekindlePulse = 0; private rekindleCause = -1;
  private mirrorTag = 0;

  init(w: World): void { this.mirrorTag = w.tagId('bastion.mirror_aegis'); this.rebuild(w); this.refill(w); }

  rebuild(w: World): void {
    const s = w.stats;
    const fort = s.hasDoctrine('bastion', 'fortress'), aeg = s.hasDoctrine('bastion', 'aegis');
    const th = s.hasDoctrine('bastion', 'thorns'), ph = s.hasDoctrine('bastion', 'phoenix');
    this.fortCap = fort && s.has('bastion.fortress.fortification') ? s.get('bastion.fortress.fortification') : 0;
    this.fortRate = s.get('bastion.fortress.fortification.rate');
    this.keep = fort && s.has('bastion.fortress.keep'); this.keepCap = s.get('bastion.fortress.keep.cap');
    this.aegis = aeg ? Math.max(0, s.get('bastion.aegis.barrier')) : 0;
    this.barrierR = s.get('bastion.aegis.barrier_radius'); this.regen = s.get('bastion.aegis.barrier_regen');
    this.delay = Math.round(s.get('bastion.aegis.barrier_delay') * TICK_RATE);
    this.shockwave = aeg && s.has('bastion.aegis.shockwave_shield') ? s.get('bastion.aegis.shockwave_shield') : 0;
    this.shockFrac = s.get('bastion.aegis.shockwave_damage');
    this.mirror = aeg && s.has('bastion.aegis.mirror_aegis'); this.reflect = s.get('bastion.aegis.mirror_aegis.reflect');
    this.retaliation = th ? s.get('bastion.thorns.retaliation') : 0;
    this.perArmor = s.get('bastion.thorns.retaliation_per_armor'); this.retMul = s.get('bastion.thorns.retaliation_mul');
    this.bulwark = (w as WorldImpl).stats.frameFlag('retaliation_scales_armor');
    this.reactive = th && s.has('bastion.thorns.reactive_armor') ? s.get('bastion.thorns.reactive_armor') : 0;
    this.reactiveDur = Math.round(s.get('bastion.thorns.reactive_armor.duration') * TICK_RATE);
    this.reactiveMax = s.get('bastion.thorns.reactive_armor.max_stacks');
    this.spite = th && s.has('bastion.thorns.spite'); this.spiteChain = s.get('bastion.thorns.spite.chain'); this.spiteR = s.get('bastion.thorns.spite.range');
    this.lastStand = ph ? s.get('bastion.phoenix.last_stand') : 0;
    this.rekindle = ph && s.has('bastion.phoenix.rekindle') ? s.get('bastion.phoenix.rekindle') : 0;
    this.rekindleTh = s.get('bastion.phoenix.rekindle.threshold');
    this.ember = ph && s.has('bastion.phoenix.ember_heart');
    this.emberTh = s.get('bastion.phoenix.ember_heart.threshold'); this.emberSpeed = s.get('bastion.phoenix.ember_heart.speed');
    this.regenRate = s.hasAnomaly('hungry_core') ? 0 : Math.max(0, s.get('bastion.regeneration'));
    const t = w.tower;
    const maxB = this.maxBarrier(w);
    if (maxB > t.maxBarrier && t.maxBarrier >= 0) t.barrier += Math.min(maxB - t.maxBarrier, this.aegis);   // buying barrier fills the difference
    t.maxBarrier = maxB;
    if (t.barrier > maxB) t.barrier = maxB;
  }

  private maxBarrier(w: World): number { return this.aegis + (this.keep ? this.keepCap * w.tower.maxHp : 0); }

  private refill(w: World): void {
    const t = w.tower;
    t.maxBarrier = this.maxBarrier(w);
    t.barrier = Math.max(t.barrier, this.aegis);
    if (t.barrier > t.maxBarrier) t.barrier = t.maxBarrier;
  }
  onWaveStart(w: World): void { this.rekindleUsed = false; this.rekindleLeft = 0; this.refill(w); }
  onAttemptStart(w: World): void {
    w.tower.barrier = 0;
    this.reactiveStacks = 0; this.rekindleUsed = false; this.rekindleLeft = 0;
    this.refill(w);
  }

  update(w: World): void {
    const t = w.tower, tick = w.tick;
    const alive = t.hp > 0;
    // --- Fortress
    const maxB = this.maxBarrier(w);
    t.maxBarrier = maxB;
    if (this.keep && alive) {
      let over = w.healOverflow;
      if (t.hp >= t.maxHp) over += this.regenRate * w.dt;
      if (over > 0) t.barrier = Math.min(maxB, t.barrier + over);
    }
    w.healOverflow = 0;
    if (this.fortCap > 0 && alive && t.hp >= t.maxHp) {
      const cap = this.fortCap * t.maxHp;
      if (t.tempHp < cap) t.tempHp = Math.min(cap, t.tempHp + this.fortRate * t.maxHp * w.dt);
    }
    // --- Aegis
    if (this.aegis > 0 && alive) {
      if (t.barrier < this.aegis && tick - (w as WorldImpl).lastTowerDamageTick >= this.delay) {
        t.barrier = Math.min(this.aegis, t.barrier + this.aegis * this.regen * w.dt);
      }
      if (t.barrier > 0) { this.holdEnemies(w); this.screenProjectiles(w); }
    }
    // --- Thorns: Reactive Armor
    if (this.reactiveStacks > 0 && tick >= this.reactiveUntil) this.reactiveStacks = 0;
    const armorMul = 1 + this.reactive * this.reactiveStacks;
    if (armorMul !== this.appliedArmor) { w.towerArmorMul = (w.towerArmorMul / this.appliedArmor) * armorMul; this.appliedArmor = armorMul; }
    // --- Phoenix
    const frac = t.maxHp > 0 ? t.hp / t.maxHp : 1;
    const power = this.lastStand > 0 && alive ? 1 + this.lastStand * Math.floor((1 - frac) * 10 + 1e-9) : 1;
    if (power !== this.appliedPower) { w.dynamicPowerMul = (w.dynamicPowerMul / this.appliedPower) * power; this.appliedPower = power; }
    const speed = this.ember && alive && frac < this.emberTh ? 1 + this.emberSpeed : 1;
    if (speed !== this.appliedSpeed) { w.dynamicSpeedMul = (w.dynamicSpeedMul / this.appliedSpeed) * speed; this.appliedSpeed = speed; }
    if (this.rekindle > 0 && alive && w.run.phase === 'combat') {
      if (!this.rekindleUsed && frac < this.rekindleTh) {
        this.rekindleUsed = true; this.rekindleLeft = REKINDLE_PULSES;
        this.rekindlePulse = (this.rekindle * t.maxHp) / REKINDLE_PULSES;
        this.rekindleCause = w.emit(Ev.Heal, 'bastion.rekindle', 0, this.rekindle * t.maxHp, 0, 0, -1);
      }
      if (this.rekindleLeft > 0 && tick % REKINDLE_EVERY === 0) { this.rekindleLeft--; w.healTower(this.rekindlePulse, this.rekindleCause); }
    }
  }

  /** Aegis: keep grounded enemies outside the ring; their contact attacks strike the barrier. */
  private holdEnemies(w: World): void {
    const e = w.enemies, t = w.tower;
    const R = this.barrierR;
    const g = growth(CONTACT_GROWTH, w.run.wave);
    for (let i = 0; i < e.count && t.barrier > 0; i++) {
      if ((e.flags[i] & HELD) || !targetable(e, i)) continue;
      const x = e.x[i], y = e.y[i], rr = R + e.radius[i];
      const d2 = x * x + y * y;
      if (d2 >= (rr + 0.5) * (rr + 0.5)) continue;   // at the ring counts as touching it
      const d = Math.sqrt(d2);
      if (d > 1e-6) { e.x[i] = (x / d) * rr; e.y[i] = (y / d) * rr; }
      e.vx[i] = 0; e.vy[i] = 0;
      if (e.attackT[i] > 0 || e.staggerT[i] > 0 || e.frozenT[i] > 0) continue;
      const dmg = e.contact[i] * g * Math.max(1, e.clumpCount[i]);
      if (e.flags[i] & EnemyFlag.Kamikaze) {
        const id = w.emit(Ev.Explosion, 'kamikaze', 24, dmg, e.x[i], e.y[i], e.spawnEv[i]);
        w.damageTower(dmg, i, id);
        w.despawnEnemy(i);
      } else {
        e.attackT[i] = TICK_RATE;
        w.damageTower(dmg, i, e.spawnEv[i]);
      }
    }
  }

  /** Aegis: hostile projectiles reaching the ring are absorbed, or reflected with Mirror Aegis. */
  private screenProjectiles(w: World): void {
    const p = w.projectiles, R2 = this.barrierR * this.barrierR;
    for (let i = 0; i < p.count; i++) {
      const f = p.flags[i];
      if ((f & ProjFlag.Hostile) === 0 || (f & ProjFlag.Dead)) continue;
      const x = p.x[i], y = p.y[i];
      if (x * x + y * y > R2) continue;
      if (this.mirror) {
        p.flags[i] = (f & ~ProjFlag.Hostile) | ProjFlag.Homing;
        p.vx[i] = -p.vx[i]; p.vy[i] = -p.vy[i];
        p.damage[i] *= this.reflect; p.tag[i] = this.mirrorTag; p.source[i] = 255;
        p.lastHit[i] = NO_ENTITY; p.hitMask[i] = 0; p.life[i] = 10 * TICK_RATE;
      } else if (w.tower.barrier > 0) {
        w.damageTower(p.damage[i], p.target[i], p.cause[i]);
        w.freeProjectile(i);
      }
    }
  }

  onTowerHit(w: World, damage: number, enemy: number, cause: number): void {
    const t = w.tower;
    // damageTower emits BarrierBreak immediately before this TowerHit (id = cause − 1)
    const brk = t.barrier <= 0 ? w.events.byId(cause - 1) : undefined;
    if (brk && brk.type === Ev.BarrierBreak && brk.tick === w.tick) {
      if (this.shockwave > 0) this.shock(w, brk.id);
    }
    if (this.reactive > 0) {
      if (this.reactiveStacks < this.reactiveMax) this.reactiveStacks++;
      this.reactiveUntil = w.tick + this.reactiveDur;
    }
    if (this.retaliation > 0 && w.alive(enemy)) {
      const armor = w.stats.get('bastion.armor') * w.towerArmorMul;
      let dmg = damage * this.retaliation * this.retMul + armor * this.perArmor;
      if (this.bulwark) dmg *= 1 + armor / 100;
      const e = w.enemies, x = e.x[enemy], y = e.y[enemy];
      const h = w.damage(enemy, dmg, { source: 'retaliation', srcTag: 'bastion.thorns', cause });
      const hid = h.eventId;
      if (this.spite) {
        const m = nearestN(w, this.qs, x, y, this.spiteR, enemy, 1, this.near);
        if (m > 0) w.damage(this.near[0], dmg * this.spiteChain, { source: 'retaliation', srcTag: 'bastion.spite', cause: hid });
      }
    }
  }

  private shock(w: World, cause: number): void {
    const e = w.enemies, R = this.barrierR + SHOCK_REACH;
    const dmg = this.aegis * this.shockFrac;
    if (dmg > 0) w.explode(0, 0, R, dmg, { source: 'retaliation', srcTag: 'bastion.shockwave', cause, falloff: false });
    const buf = this.qs.push();
    const n = w.queryRadius(0, 0, R, buf);
    for (let k = 0; k < n; k++) { const j = buf[k]; if (w.alive(j)) w.knockback(j, e.x[j], e.y[j], this.shockwave); }
    this.qs.pop();
  }

  render(w: World, out: InstanceWriter): void {
    const t = w.tower;
    if (t.tempHp > 0) out.push(0, 0, 30, 0, Shape.Ring, 1, 0.85, 0.5, 0.35, 2);
    if (this.appliedSpeed > 1) out.push(0, 0, 34, 0, Shape.Ring, 1, 0.45, 0.15, 0.5, 2);
  }
}
