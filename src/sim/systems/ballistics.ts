/**
 * Ballistics: the primary weapon (design §5). Stat keys (node id = stat key):
 *   ballistics.damage / attack_speed (shots/s) / range / projectile_speed / crit_chance / crit_damage
 *   ballistics.target_acquisition  turret turn rate +x and lead accuracy
 *   ballistics.execution           bonus damage fraction vs enemies < 30% HP (execution.ce_refund: CE per kill)
 *   ballistics.gunstorm            exotic: every 8th attack each barrel fires a 6-round burst
 *   reactor.global_attack_speed    multiplier on the fire rate
 * Doctrines (strength 1 primary, 0.5–1 as a second doctrine):
 *   multishot     projectiles = clamp(multishot.count, 1..5) in a 20° fan (count's ranks are already scaled by the
 *                 doctrine strength in the resolver); with 2+ projectiles each deals ×(1 − multishot.penalty);
 *                 Split Sight: extra projectiles pick their own targets (nearest first)
 *   piercing      pierce = piercing.count; damage × retention × (1 + velocity) and speed × (1 + velocity) per pierce;
 *                 Last Rites: the final pierce deals ×4
 *   ricochet      bounces = ricochet.bounces within ricochet.range, ×0.8 damage per bounce; Return Fire revisits
 *   heavy_rounds  fire rate × heavy.fire_rate (0.85), damage × heavy.base_damage (1.9) × heavy.damage, radius ×
 *                 heavy.base_size (2.5) × heavy.size, knockback heavy.base_knockback (18) + heavy.knockback; Staggerhead staggers elites / interrupts bosses (staggerT)
 * Targeting: build.targeting.primary (default 'nearest'); a live designated enemy in range always wins.
 * Manual aim (tower.manualAim) overrides direction; manual shots get +10% crit chance (ProjFlag.Manual).
 */
import type { System, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import { ProjFlag, ProjKind, Shape, TICK_DT, TOWER_RADIUS, NO_ENTITY } from '../core/types';
import { atan2, cos, sin, angleDiff, wrapAngle, clamp } from '../math/lut';

const TURN_RATE = 10;             // rad/s base turret swing
const FAN = 0.349;                // 20° total multishot spread
const ALIGN = 0.2;                // fire when within this many radians of the desired angle
const MANUAL_CRIT = 0.1;
const GUNSTORM_EVERY = 8;
const GUNSTORM_ROUNDS = 6;

export class BallisticsSystem implements System {
  readonly id = 'ballistics';
  private timer = 0;
  private attacks = 0;
  private aim = 0;
  private dmg = 10; private rate = 2; private range = 300; private speed = 420;
  private critC = 0.05; private critM = 1.5; private ta = 0;
  private n = 1; private penalty = 0; private splitSight = false;
  private pierce = 0; private retention = 1; private pierceSpeed = 0; private lastRites = false;
  private bounces = 0; private bounceRange = 120; private returnFire = false;
  private radius = 3; private knock = 0; private stagger = false;
  private execBonus = 0; private execRefund = 0; private gunstorm = false;
  /** Reactor Targeting Logic rank 2+: shots lead moving targets exactly (else 60% + Target Acquisition). */
  private perfectLead = false;
  private picked = new Int32Array(8);
  /** Current target (index + generation) so equidistant enemies don't make the turret flip-flop. */
  private tgt = NO_ENTITY; private tgtGen = 0;

  init(w: World): void { this.rebuild(w); this.timer = 0; this.attacks = 0; this.aim = w.tower.aimAngle; }
  onAttemptStart(): void { this.timer = 0; this.attacks = 0; this.tgt = NO_ENTITY; this.tgtGen = 0; }
  onWaveStart(): void { this.tgt = NO_ENTITY; this.tgtGen = 0; }
  onCompact(_w: World, remap: Int32Array, oldCount: number): void {
    if (this.tgt >= 0) this.tgt = this.tgt < oldCount ? remap[this.tgt] : NO_ENTITY;
  }

  rebuild(w: World): void {
    const s = w.stats;
    this.dmg = s.get('ballistics.damage');
    this.rate = s.get('ballistics.attack_speed') * s.get('reactor.global_attack_speed');
    this.range = s.get('ballistics.range');
    this.speed = Math.max(60, s.get('ballistics.projectile_speed'));
    this.critC = s.get('ballistics.crit_chance');
    this.critM = s.get('ballistics.crit_damage');
    this.ta = Math.max(0, s.get('ballistics.target_acquisition'));
    this.execBonus = s.has('ballistics.execution') ? s.get('ballistics.execution') : 0;
    this.execRefund = s.has('ballistics.execution') ? s.get('ballistics.execution.ce_refund') : 0;
    this.gunstorm = s.has('ballistics.gunstorm');
    this.perfectLead = s.get('reactor.targeting_logic') >= 2;

    const ms = s.doctrineStrength('ballistics', 'multishot');
    // the resolver already scales doctrine node ranks by the doctrine's strength (a 50% second Multishot gets half the barrels)
    this.n = ms > 0 ? clamp(Math.floor(s.get('ballistics.multishot.count') + 1e-9), 1, 5) : 1;
    this.penalty = this.n > 1 ? clamp(s.get('ballistics.multishot.penalty'), 0, 0.9) : 0;
    this.splitSight = ms > 0 && s.has('ballistics.multishot.split_sight');

    const ps = s.doctrineStrength('ballistics', 'piercing');
    this.pierce = ps > 0 ? Math.max(0, Math.floor(s.get('ballistics.piercing.count') + 1e-9)) : 0;
    this.retention = ps > 0 ? clamp(s.get('ballistics.piercing.retention'), 0, 1) : 1;
    this.pierceSpeed = ps > 0 ? Math.max(0, s.get('ballistics.piercing.velocity')) : 0;
    this.lastRites = ps > 0 && s.has('ballistics.piercing.last_rites');

    const rs = s.doctrineStrength('ballistics', 'ricochet');
    this.bounces = rs > 0 ? Math.max(0, Math.floor(s.get('ballistics.ricochet.bounces') + 1e-9)) : 0;
    this.bounceRange = s.get('ballistics.ricochet.range');
    this.returnFire = rs > 0 && s.has('ballistics.ricochet.return_fire');
    if (this.pierce === 0 && this.bounces > 0) this.retention = 0.8;

    const hs = s.doctrineStrength('ballistics', 'heavy_rounds');
    if (hs > 0) {
      // inherent Heavy constants come from data (base-stats ballistics.heavy.*); they were hard-coded here
      this.rate *= 1 - (1 - s.get('ballistics.heavy.fire_rate')) * hs;
      this.dmg *= (1 + (s.get('ballistics.heavy.base_damage') - 1) * hs) * s.get('ballistics.heavy.damage');
      this.radius = 3 * (1 + (s.get('ballistics.heavy.base_size') - 1) * hs) * s.get('ballistics.heavy.size');
      this.knock = s.get('ballistics.heavy.base_knockback') * hs + s.get('ballistics.heavy.knockback');
      this.stagger = s.has('ballistics.heavy.staggerhead');
    } else { this.radius = 3; this.knock = 0; this.stagger = false; }
  }

  update(w: World): void {
    if (!w.stats.mounted('primary')) return;
    const t = w.tower;
    const manual = t.manualAim;
    const profile = w.build.targeting.primary ?? 'nearest';
    const e = w.enemies;
    const prev = this.tgt >= 0 && this.tgt < e.count && e.gen[this.tgt] === this.tgtGen ? this.tgt : NO_ENTITY;
    const target = manual || w.trial === 'commander' ? NO_ENTITY : w.nearestEnemy(0, 0, this.range, profile, 'primary', prev);   // WP8: Commander Trial — no automatic fire
    this.tgt = target; this.tgtGen = target >= 0 ? e.gen[target] : 0;
    let desired = this.aim;
    if (manual) desired = t.manualAngle;
    else if (target >= 0) desired = this.leadAngle(w, target);
    const turn = TURN_RATE * (1 + this.ta) * TICK_DT;
    const diff = angleDiff(this.aim, desired);
    this.aim = wrapAngle(this.aim + clamp(diff, -turn, turn));
    t.aimAngle = this.aim;

    this.timer += this.rate * w.dynamicSpeedMul * TICK_DT;   // WP9: Overdrive
    if (!manual && target < 0) { if (this.timer > 1) this.timer = 1; return; }
    if (!manual && Math.abs(angleDiff(this.aim, desired)) > ALIGN) { if (this.timer > 1) this.timer = 1; return; }
    let shots = 0;
    while (this.timer >= 1 && shots < 4) {
      this.timer -= 1; shots++;
      this.fire(w, manual, target);
    }
  }

  private leadAngle(w: World, i: number): number {
    const e = w.enemies;
    const x = e.x[i], y = e.y[i];
    const d = Math.sqrt(x * x + y * y);
    const tt = d / this.speed;
    const k = this.perfectLead ? 1 : Math.min(1, 0.6 + this.ta);
    return atan2(y + e.vy[i] * tt * k, x + e.vx[i] * tt * k);
  }

  private fire(w: World, manual: boolean, target: number): void {
    this.attacks++;
    const gun = this.gunstorm && this.attacks % GUNSTORM_EVERY === 0;
    const n = this.n;
    const per = this.dmg * (n > 1 ? 1 - this.penalty : 1);
    let flags = manual ? ProjFlag.Manual : 0;
    if (this.lastRites) flags |= ProjFlag.LastRites;
    if (this.returnFire) flags |= ProjFlag.ReturnFire;
    if (this.stagger) flags |= ProjFlag.Stagger;
    const crit = this.critC + (manual ? MANUAL_CRIT : 0);
    let pickedN = 0;
    if (target >= 0) this.picked[pickedN++] = target;
    for (let k = 0; k < n; k++) {
      let angle: number;
      let aimed = k === (this.splitSight ? 0 : (n - 1) >> 1) ? target : NO_ENTITY;   // the round aimed at the target names it (Targeting Logic: damage in flight)
      if (this.splitSight && k > 0 && !manual) {
        const other = w.nearestExcluding(0, 0, this.range, this.picked, pickedN);
        if (other >= 0) { this.picked[pickedN++] = other; angle = this.leadAngle(w, other); aimed = other; }
        else angle = this.aim + (k - (n - 1) / 2) * (FAN / Math.max(1, n - 1));
      } else {
        angle = n > 1 ? this.aim + (k - (n - 1) / 2) * (FAN / (n - 1)) : this.aim;
      }
      this.launch(w, angle, per, flags, crit, aimed);
      if (gun) for (let j = 1; j < GUNSTORM_ROUNDS; j++) this.launch(w, angle + (j - GUNSTORM_ROUNDS / 2) * 0.04, per, flags, crit);
    }
  }

  private launch(w: World, angle: number, damage: number, flags: number, crit: number, target: number = NO_ENTITY): void {
    const c = cos(angle), s = sin(angle);
    w.spawnProjectile({
      kind: ProjKind.Bullet, source: 0, srcTag: 'ballistics',
      x: c * TOWER_RADIUS, y: s * TOWER_RADIUS, vx: c * this.speed, vy: s * this.speed,
      damage, radius: this.radius, life: Math.ceil((this.range * 1.15 / this.speed) * 60),
      pierce: this.pierce, bounces: this.bounces, flags, critChance: crit, critMul: this.critM, cause: -1, target,
      retention: this.retention, pierceSpeed: this.pierceSpeed, bounceRange: this.bounceRange, knock: this.knock, execBonus: this.execBonus,
    });
  }

  onKill(w: World, hit: { srcTag: string }): void {
    if (this.execRefund > 0 && hit.srcTag === 'ballistics') w.gainCE(this.execRefund);
  }

  render(w: World, out: InstanceWriter): void {
    const a = w.tower.aimAngle, len = TOWER_RADIUS * 1.45;
    out.push(0, 0, 2.5, a, Shape.Line, 0.85, 0.92, 1, 1, 0, cos(a) * len, sin(a) * len);
  }
}
