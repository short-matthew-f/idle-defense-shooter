/**
 * Elements (design §6, WP2): Fire, Lightning, Poison and Frost as one System.
 *
 * Carrying an element: the primary weapon (hit.source 'primary') carries EVERY attuned element natively.
 * Hardpoint hits (ordnance/drones/blade/laser/gravitics) proc the one element in `hit.element`
 * (Infusions: set `element` on the projectile, or pass `element` in world.damage/explode opts) when
 * that element is attuned. Element damage itself uses source 'element' / 'fusion' / 'status' / 'hazard'
 * and never re-procs, so there are no proc loops.
 *
 * Base procs per hit (world.prng, fixed order fire → lightning → poison → frost):
 *   Fire      fire.burn_chance → 1 Burn stack for fire.burn_duration s at fire.burn_damage × hit damage per stack/s
 *   Lightning lightning.arc_chance → arc to lightning.arc_targets enemies (ArcEngine, elements-shared.ts),
 *             lightning.arc_damage × hit damage per link; every link is an Ev.Hit caused by the previous link
 *   Poison    poison.application stacks (fraction = chance of one more), poison.damage × primary damage per stack/s
 *   Frost     frost.chill_chance → 1 Chill stack for frost.chill_duration s
 * Stack caps: while attuned, fire.burn_stacks / poison.stack_cap / frost.chill_stacks are the World's
 * status caps (WorldImpl.statusCap); Conductor +1 and Overflow ×2 still apply there.
 *
 * Doctrines and exotics (every node id in data/elements.ts):
 *   Fire   spread_on_death; Wildfire Flashpoint (max Burn → explosion + Burn stacks, Tinderbox radius,
 *          Conflagration passes every stack and chains); Inferno: every Nth primary BULLET (counted as it
 *          leaves the barrel, see scanProjectiles) becomes a Fireball (ProjKind.Fireball with a blast; its
 *          explosion applies fire.inferno.fireball.stacks Burn), crits always ignite, Sunburst embers;
 *          Meteor Round: every 5th of this system's Fireballs leaves a fire_zone hazard.
 *   Lightning  Chain: Forked Current, Static Charge (consumed by the next weapon hit for +x% — damageMul),
 *          Discharge (dying Static carriers arc to 5); Storm: Ball Lightning (system-owned orbs, not
 *          projectiles), Arc Anchor; Supercell: 40 arc links in 2 s → 6 s storm striking random enemies.
 *   Poison Plague: Contagion, Incubation, Plague Carrier (most-poisoned enemy, re-chosen every second);
 *          Venom: Virulence and Corrosion (damageMul; Corrosion scales damage as if armor were stripped —
 *          enemies.armor is never mutated so it cannot drift), Toxic Burst (at the stack cap);
 *          Pandemic: every poison.pandemic.interval s poisoned elites/bosses seed half their stacks into 2 enemies.
 *   Frost  Control: Deep Freeze (world.freeze at max Chill, 5 s lockout; bosses/Immovable get an 80% slow
 *          through enemies.fieldSlow), Permafrost (stacks fall off one at a time), Glacial Shot (every 5th
 *          bullet pierces all and applies max Chill); Shatter: Brittle (status + damageMul), Fracture, Iceburst.
 *          Absolute Zero: enemies at max Chill have their attack timer (enemies.attackT) run at half speed —
 *          this system adds one tick back every other tick after the AI decremented it. WP5 boss ability
 *          cooldowns should run at ×0.5 while `chill >= statusCap('chill')` and `stats.has('frost.absolute_zero')`.
 */
import type { System, HitInfo, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { StatusId } from '../core/ids';
import { EnemyFlag, Ev, ProjFlag, ProjKind, Shape, ARENA_RADIUS, TICK_RATE } from '../core/types';
import { cos, sin, TAU } from '../math/lut';
import { ArcEngine, BurstQueue, QueryStack, nearestN, pendingBurn, pendingPoison, weaponIndex } from './elements-shared';

export const TAG = {
  fireball: 'fire.fireball', meteor: 'fire.meteor_round', sunburst: 'fire.sunburst', flashpoint: 'fire.flashpoint',
  glacial: 'frost.glacial_shot', iceburst: 'frost.iceburst', toxicBurst: 'poison.toxic_burst',
  contagion: 'poison.contagion', carrier: 'poison.plague_carrier', pandemic: 'poison.pandemic',
  ball: 'lightning.ball', supercell: 'lightning.supercell', discharge: 'lightning',
} as const;

const MAX_BALLS = 32;
const BALL_SPEED = 45;
const BALL_ZAP_TICKS = 15;
const BALL_ZAPS = 3;
const STORM_TICKS = 12;
const EMBER_SPEED = 220;
const BOSS_FREEZE_SLOW = 0.8;
const PERSIST = EnemyFlag.Boss | EnemyFlag.Immovable;
/** Flashpoints detonated per tick (the rest wait in FIFO order; see BurstQueue). */
export const FLASH_BUDGET = 16;

export class ElementsSystem implements System {
  readonly id = 'elements';
  readonly arcs = new ArcEngine();
  private qs = new QueryStack();
  private bursts = new BurstQueue();
  private near = new Int32Array(8);
  private zapSeen = new Int32Array(8);

  // attunement
  private fire = false; private lightning = false; private poison = false; private frost = false;
  private refDmg = 10; private critMul = 1.5; private blastMul = 1;
  // fire
  private burnChance = 0; private burnDur = 180; private burnFrac = 0.2;
  private spread = 0; private spreadN = 2; private spreadR = 60;
  private flash = 0; private flashR = 60; private conflag = false; private flashStacks = 1; private flashSrcCap = 1; private flashTgtCap = 0.25; private flashInherit = 0.5;
  private fbEvery = 0; private fbMul = 1; private fbR = 60; private fbStacks = 2; private critsIgnite = 0;
  private sunburst = false; private embers = 8; private emberRange = 90;
  private meteor = false; private meteorEvery = 5; private meteorR = 80; private meteorDur = 4;
  // lightning
  private arcChance = 0; private arcTargets = 2; private arcFrac = 0.5;
  private staticCharge = 0; private discharge = false; private dischargeN = 5;
  private balls = 0; private ballEvery = 240; private ballR = 60; private voltage = 1;
  private supercell = false; private scArcs = 40; private scDur = 360; private scR = 250;
  // poison
  private poisonApp = 0; private poisonFrac = 0.08; private poisonDur = 300;
  private contagion = 0; private contagionR = 80; private incubation = 1; private carrier = false; private carrierR = 70;
  private virulence = 0; private corrosion = 0; private corrosionCap = 0.6; private toxicBurst = false;
  private pandemic = false; private pandemicEvery = 120; private pandemicN = 2;
  // frost
  private chillChance = 0; private chillDur = 120; private deepFreeze = 0; private freezeLock = 300;
  private permafrost = 0; private glacialEvery = 0; private brittle = 0; private fracture = 0; private brittleOn = false;
  private iceburst = false; private iceR = 70; private iceFrac = 0.2; private absZero = false;
  // triad
  private catalyst = 0;

  // runtime state
  private lastGen = 0; private shots = 0; private glacialShots = 0; private fireballs = 0;
  private burstCause = -1;
  private consumedEnemy = -1; private consumedTick = -1;
  private ballX = new Float32Array(MAX_BALLS); private ballY = new Float32Array(MAX_BALLS);
  private ballVx = new Float32Array(MAX_BALLS); private ballVy = new Float32Array(MAX_BALLS);
  private ballCause = new Int32Array(MAX_BALLS); private ballN = 0;
  private ring = new Uint16Array(1); private ringSum = 0; private lastArcs = 0;
  private stormUntil = -1; private stormCause = -1;
  private tagBallistics = 0; private tagFireball = 0; private tagMeteor = 0; private tagGlacial = 0; private tagSunburst = 0;

  init(w: World): void {
    this.tagBallistics = w.tagId('ballistics'); this.tagFireball = w.tagId(TAG.fireball); this.tagMeteor = w.tagId(TAG.meteor);
    this.tagGlacial = w.tagId(TAG.glacial); this.tagSunburst = w.tagId(TAG.sunburst);
    this.rebuild(w);
    this.reset(w);
  }
  onAttemptStart(w: World): void { this.reset(w); }

  private reset(w: World): void {
    this.shots = 0; this.glacialShots = 0; this.fireballs = 0; this.ballN = 0; this.burstCause = -1; this.bursts.clear();
    this.ring.fill(0); this.ringSum = 0; this.lastArcs = this.arcs.arcs; this.stormUntil = -1;
    const p = w.projectiles;
    let g = this.lastGen;
    for (let i = 0; i < p.count; i++) if (p.gen[i] > g) g = p.gen[i];
    this.lastGen = g;
  }

  rebuild(w: World): void {
    const s = w.stats;
    this.arcs.rebuild(w);
    this.fire = s.attuned('fire'); this.lightning = s.attuned('lightning'); this.poison = s.attuned('poison'); this.frost = s.attuned('frost');
    this.refDmg = s.get('ballistics.damage'); this.critMul = Math.max(1, s.get('ballistics.crit_damage'));
    this.blastMul = s.get('combat.blast_radius_mul') || 1;
    // fire
    this.burnChance = s.get('fire.burn_chance'); this.burnDur = Math.round(s.get('fire.burn_duration') * TICK_RATE);
    this.burnFrac = s.get('fire.burn_damage');
    this.spread = s.has('fire.spread_on_death') ? Math.floor(s.get('fire.spread_on_death')) : 0;
    this.spreadN = s.get('fire.spread_on_death.targets'); this.spreadR = s.get('fire.spread_on_death.radius');
    const wild = s.hasDoctrine('fire', 'wildfire'), inferno = s.hasDoctrine('fire', 'inferno');
    this.flash = wild && s.has('fire.wildfire.flashpoint') ? s.get('fire.wildfire.flashpoint') : 0;
    this.flashR = s.get('fire.wildfire.flashpoint.radius') * (s.get('fire.wildfire.tinder') || 1) * this.blastMul;
    this.flashSrcCap = s.get('fire.wildfire.flashpoint.source_cap'); this.flashTgtCap = s.get('fire.wildfire.flashpoint.target_cap'); this.flashInherit = s.get('fire.wildfire.flashpoint.inherit');
    this.conflag = wild && s.has('fire.wildfire.spread');
    this.fbEvery = inferno && s.has('fire.inferno.fireball_every') ? Math.max(2, Math.round(s.get('fire.inferno.fireball_every'))) : 0;
    this.fbMul = s.get('fire.inferno.fireball_damage') || 1;
    this.fbR = s.get('fire.inferno.fireball.radius') * this.fbMul * this.blastMul; this.fbStacks = s.get('fire.inferno.fireball.stacks');
    this.critsIgnite = inferno && s.has('fire.inferno.crits_ignite') ? s.get('fire.inferno.crits_ignite') : 0;
    this.sunburst = inferno && s.has('fire.inferno.sunburst');
    this.embers = s.get('fire.inferno.sunburst.embers'); this.emberRange = s.get('fire.inferno.sunburst.range');
    this.meteor = s.has('fire.meteor_round'); this.meteorEvery = Math.max(1, Math.round(s.get('fire.meteor_round.every')));
    this.meteorR = s.get('fire.meteor_round.radius') * this.blastMul; this.meteorDur = s.get('fire.meteor_round.duration');
    // lightning
    this.arcChance = s.get('lightning.arc_chance'); this.arcTargets = Math.min(5, Math.max(1, Math.round(s.get('lightning.arc_targets'))));
    this.arcFrac = s.get('lightning.arc_damage');
    const chain = s.hasDoctrine('lightning', 'chain'), storm = s.hasDoctrine('lightning', 'storm');
    this.staticCharge = chain ? s.get('lightning.chain.static_charge') : 0;
    this.discharge = chain && s.has('lightning.chain.discharge'); this.dischargeN = s.get('lightning.chain.discharge.targets');
    this.balls = storm && s.has('lightning.storm.ball_lightning') ? Math.floor(s.get('lightning.storm.ball_lightning')) : 0;
    this.ballEvery = Math.max(1, Math.round(s.get('lightning.storm.ball_lightning.interval') * TICK_RATE));
    this.voltage = s.get('lightning.storm.voltage') || 1;
    this.ballR = s.get('lightning.storm.ball_lightning.zap_radius') * (1 + 0.5 * (this.voltage - 1));
    this.supercell = s.has('lightning.supercell'); this.scArcs = s.get('lightning.supercell.arcs');
    this.scDur = Math.round(s.get('lightning.supercell.duration') * TICK_RATE); this.scR = s.get('lightning.supercell.radius');
    const win = Math.max(1, Math.round(s.get('lightning.supercell.window') * TICK_RATE));
    if (this.ring.length !== win) { this.ring = new Uint16Array(win); this.ringSum = 0; }
    // poison
    this.poisonApp = s.get('poison.application'); this.poisonFrac = s.get('poison.damage');
    this.poisonDur = Math.round(s.get('poison.duration') * TICK_RATE);
    const plague = s.hasDoctrine('poison', 'plague'), venom = s.hasDoctrine('poison', 'venom');
    this.contagion = plague && s.has('poison.plague.contagion') ? s.get('poison.plague.contagion') : 0;
    this.contagionR = s.get('poison.plague.contagion.radius'); this.incubation = plague ? s.get('poison.plague.incubation') || 1 : 1;
    this.carrier = plague && s.has('poison.plague.plague_carrier'); this.carrierR = s.get('poison.plague.plague_carrier.radius');
    this.virulence = venom ? s.get('poison.venom.virulence') : 0;
    this.corrosion = venom && s.has('poison.venom.corrosion') ? s.get('poison.venom.corrosion') : 0;
    this.corrosionCap = s.get('poison.venom.corrosion.cap');
    this.toxicBurst = venom && s.has('poison.venom.toxic_burst');
    this.pandemic = s.has('poison.pandemic'); this.pandemicEvery = Math.max(1, Math.round(s.get('poison.pandemic.interval') * TICK_RATE));
    this.pandemicN = Math.min(this.near.length, Math.max(1, Math.round(s.get('poison.pandemic.targets'))));
    // frost
    this.chillChance = s.get('frost.chill_chance'); this.chillDur = Math.round(s.get('frost.chill_duration') * TICK_RATE);
    const control = s.hasDoctrine('frost', 'control'), shatter = s.hasDoctrine('frost', 'shatter');
    this.deepFreeze = control && s.has('frost.control.deep_freeze') ? s.get('frost.control.deep_freeze') : 0;
    this.freezeLock = Math.round(s.get('frost.control.deep_freeze.lockout') * TICK_RATE);
    this.permafrost = control && s.has('frost.control.permafrost') ? s.get('frost.control.permafrost') : 0;
    this.glacialEvery = control && s.has('frost.control.glacial_shot') ? Math.max(1, Math.round(s.get('frost.control.glacial_shot.every'))) : 0;
    this.brittle = shatter ? s.get('frost.shatter.brittle') : 0; this.brittleOn = this.brittle > 0;
    this.fracture = shatter && s.has('frost.shatter.fracture') ? s.get('frost.shatter.fracture') : 0;
    this.iceburst = shatter && s.has('frost.shatter.iceburst') && this.brittleOn;
    this.iceR = s.get('frost.shatter.iceburst.radius') * this.blastMul; this.iceFrac = s.get('frost.shatter.iceburst.fraction');
    this.absZero = s.has('frost.absolute_zero');
    this.catalyst = s.has('triad.catalyst') ? s.get('triad.catalyst') : 0;
  }

  private cap(w: World, st: StatusId): number { return (w as WorldImpl).statusCap(st); }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------
  update(w: World): void {
    if (this.bursts.length > 0) this.drainFlashpoints(w);
    if (this.fbEvery > 0 || this.glacialEvery > 0) this.scanProjectiles(w);
    else this.lastGen = this.maxGen(w);
    if (this.lightning) {
      if (this.balls > 0) this.updateBalls(w);
      if (this.supercell) this.updateSupercell(w);
    }
    if (this.poison) {
      if (this.carrier && w.tick % TICK_RATE === 0) this.plagueCarrier(w);
      if (this.pandemic && w.tick % this.pandemicEvery === 0) this.doPandemic(w);
    }
    if (this.frost && (this.permafrost > 0 || this.deepFreeze > 0 || this.absZero)) this.frostTick(w);
  }

  private maxGen(w: World): number {
    const p = w.projectiles;
    return p.count > 0 && p.gen[p.count - 1] > this.lastGen ? p.gen[p.count - 1] : this.lastGen;
  }

  /**
   * Fireball / Glacial Shot conversion. Projectiles allocated this tick form a suffix of the pool with
   * generations above `lastGen` (allocation appends; compaction only runs at end of tick), and Ballistics
   * runs before this system, so every primary bullet is seen exactly once, the tick it is fired.
   */
  private scanProjectiles(w: World): void {
    const p = w.projectiles;
    const last = this.lastGen;
    let maxG = last, from = p.count;
    while (from > 0 && p.gen[from - 1] > last) { from--; if (p.gen[from] > maxG) maxG = p.gen[from]; }
    for (let i = from; i < p.count; i++) {
      if (p.flags[i] & (ProjFlag.Dead | ProjFlag.Hostile)) continue;
      if (p.kind[i] !== ProjKind.Bullet || p.source[i] !== 0 || p.tag[i] !== this.tagBallistics) continue;
      this.shots++;
      if (this.fbEvery > 0 && this.shots % this.fbEvery === 0) {
        this.fireballs++;
        const meteor = this.meteor && this.fireballs % this.meteorEvery === 0;
        p.kind[i] = ProjKind.Fireball; p.blast[i] = this.fbR; p.damage[i] *= this.fbMul;
        p.pierce[i] = 0; p.bounces[i] = 0; p.element[i] = 1; p.radius[i] = Math.max(p.radius[i], 5);
        p.tag[i] = meteor ? this.tagMeteor : this.tagFireball;
      } else if (this.glacialEvery > 0 && ++this.glacialShots % this.glacialEvery === 0) {
        p.pierce[i] = 255; p.retention[i] = 1; p.element[i] = 4; p.bounces[i] = 0; p.tag[i] = this.tagGlacial;
      }
    }
    this.lastGen = maxG;
  }

  private updateBalls(w: World): void {
    const e = w.enemies;
    if (w.tick % this.ballEvery === 0 && e.count > 0) {
      const cause = w.emit(Ev.Fx, TAG.ball, this.balls, 0, 0, 0, -1);
      const off = (w.tick / this.ballEvery) * 0.7;
      for (let k = 0; k < this.balls && this.ballN < MAX_BALLS; k++) {
        const a = off + (TAU * k) / this.balls, b = this.ballN++;
        this.ballX[b] = cos(a) * 26; this.ballY[b] = sin(a) * 26;
        this.ballVx[b] = cos(a) * BALL_SPEED; this.ballVy[b] = sin(a) * BALL_SPEED; this.ballCause[b] = cause;
      }
    }
    const zap = w.tick % BALL_ZAP_TICKS === 0;
    const dmg = this.arcFrac * this.refDmg * this.voltage;
    let k = 0;
    for (let b = 0; b < this.ballN; b++) {
      const x = this.ballX[b] + this.ballVx[b] * w.dt, y = this.ballY[b] + this.ballVy[b] * w.dt;
      if (x * x + y * y > ARENA_RADIUS * ARENA_RADIUS) continue;
      this.ballX[k] = x; this.ballY[k] = y; this.ballVx[k] = this.ballVx[b]; this.ballVy[k] = this.ballVy[b]; this.ballCause[k] = this.ballCause[b];
      k++;
    }
    this.ballN = k;
    if (!zap) return;
    for (let b = 0; b < this.ballN; b++) {
      let nv = 0;
      for (let z = 0; z < BALL_ZAPS; z++) {
        const t = this.arcs.pick(w, this.ballX[b], this.ballY[b], this.zapSeen, nv, this.ballR);
        if (t < 0) break;
        this.zapSeen[nv++] = t;
        this.arcs.strike(w, -1, this.ballX[b], this.ballY[b], t, dmg, this.ballCause[b], TAG.ball);
      }
    }
  }

  private updateSupercell(w: World): void {
    const now = this.arcs.arcs, fresh = Math.min(65535, now - this.lastArcs);
    this.lastArcs = now;
    const slot = w.tick % this.ring.length;
    this.ringSum += fresh - this.ring[slot];
    this.ring[slot] = fresh;
    const tick = w.tick;
    if (this.ringSum >= this.scArcs && tick >= this.stormUntil) {
      this.stormUntil = tick + this.scDur;
      this.stormCause = w.emit(Ev.Fx, TAG.supercell, this.ringSum, this.scDur, 0, 0, -1);
      this.ring.fill(0); this.ringSum = 0;
    }
    if (tick < this.stormUntil && tick % STORM_TICKS === 0) {
      const buf = this.qs.push();
      const n = w.queryRadius(0, 0, this.scR, buf);
      if (n > 0) {
        const j = buf[w.prng.int(0, n - 1)];
        if (w.alive(j)) this.arcs.strike(w, -1, 0, 0, j, this.arcFrac * this.refDmg, this.stormCause, TAG.supercell);
      }
      this.qs.pop();
    }
  }

  private plagueCarrier(w: World): void {
    const e = w.enemies;
    let c = -1, best = 0;
    for (let i = 0; i < e.count; i++) if (w.alive(i) && e.poison[i] > best) { best = e.poison[i]; c = i; }
    if (c < 0) return;
    const buf = this.qs.push();
    const n = w.queryRadius(e.x[c], e.y[c], this.carrierR, buf);
    const dps = e.poisonDps[c] * this.incubation, cause = e.poisonCause[c];
    for (let k = 0; k < n; k++) {
      const j = buf[k];
      if (j !== c && w.alive(j)) w.applyStatus(j, 'poison', 1, this.poisonDur, TAG.carrier, cause, dps);
    }
    this.qs.pop();
  }

  private doPandemic(w: World): void {
    const e = w.enemies;
    const n0 = e.count;
    for (let i = 0; i < n0; i++) {
      if (!w.alive(i) || e.poison[i] < 2 || (e.flags[i] & (EnemyFlag.Elite | EnemyFlag.Boss)) === 0) continue;
      const half = e.poison[i] >> 1, dps = e.poisonDps[i], cause = e.poisonCause[i];
      const m = nearestN(w, this.qs, e.x[i], e.y[i], ARENA_RADIUS, i, this.pandemicN, this.near);
      for (let k = 0; k < m; k++) w.applyStatus(this.near[k], 'poison', half, this.poisonDur, TAG.pandemic, cause, dps);
    }
  }

  private frostTick(w: World): void {
    const e = w.enemies, tick = w.tick;
    const linger = Math.max(1, Math.round(this.permafrost * TICK_RATE));
    const chillCap = this.cap(w, 'chill');
    for (let i = 0; i < e.count; i++) {
      if (!w.alive(i)) continue;
      if (this.permafrost > 0 && e.chill[i] > 1 && e.chillT[i] <= 1) { e.chill[i]--; e.chillT[i] = linger; }
      if (e.bossSlowUntil[i] > tick && e.fieldSlow[i] < BOSS_FREEZE_SLOW) e.fieldSlow[i] = BOSS_FREEZE_SLOW;
      if (this.absZero && e.chill[i] >= chillCap && e.attackT[i] > 0 && (tick & 1) === 1 && e.attackT[i] < 65535) e.attackT[i]++;
    }
  }

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------
  onHit(w: World, hit: HitInfo): void {
    const i = hit.enemy;
    if (i < 0) return;
    const src = hit.source;
    if (src === 'element') { this.onHitElement(w, hit); return; }
    if (weaponIndex(src) < 0) return;
    const tag = hit.srcTag;
    if (tag === TAG.sunburst) { this.burn(w, i, 1, hit.damage, hit.eventId); return; }
    if (tag === TAG.fireball || tag === TAG.meteor) this.fireballHit(w, hit, tag === TAG.meteor);
    else if (tag === TAG.glacial) w.applyStatus(i, 'chill', this.cap(w, 'chill'), this.chillDur, 'frost', hit.eventId);
    const el = hit.element, primary = src === 'primary';
    let landed = 0;   // bit per element: 1 fire, 2 lightning, 4 poison
    if (this.fire && (primary || el === 'fire') && this.procFire(w, hit, false)) landed |= 1;
    if (this.lightning && (primary || el === 'lightning') && this.procLightning(w, i, hit.damage, hit.eventId, false)) landed |= 2;
    if (this.poison && (primary || el === 'poison') && this.procPoison(w, i, primary ? this.refDmg : hit.damage, hit.eventId, false)) landed |= 4;
    if (this.frost && (primary || el === 'frost') && w.prng.chance(this.chillChance)) w.applyStatus(i, 'chill', 1, this.chillDur, 'frost', hit.eventId);
    if (landed !== 0 && this.catalyst > 0 && w.alive(i) && w.prng.chance(this.catalyst)) {
      const e = w.enemies;
      const tid = w.emit(Ev.Triad, 'triad.catalyst', i, hit.damage, e.x[i], e.y[i], hit.eventId);
      if (!(landed & 1)) this.burn(w, i, 1, hit.damage, tid);
      if (!(landed & 2)) this.procLightning(w, i, hit.damage, tid, true);
      if (!(landed & 4)) this.procPoison(w, i, this.refDmg, tid, true);
    }
  }

  private burn(w: World, i: number, stacks: number, dmg: number, cause: number): void {
    w.applyStatus(i, 'burn', stacks, this.burnDur, 'fire', cause, this.burnFrac * dmg);
  }

  private procFire(w: World, hit: HitInfo, forced: boolean): boolean {
    let stacks = forced || w.prng.chance(this.burnChance) ? 1 : 0;
    if (hit.crit && this.critsIgnite > 0) stacks = 1 + Math.round(this.critsIgnite);
    if (stacks <= 0) return false;
    this.burn(w, hit.enemy, stacks, hit.damage, hit.eventId);
    return true;
  }

  private procLightning(w: World, i: number, dmg: number, cause: number, forced: boolean): boolean {
    if (!forced && !w.prng.chance(this.arcChance)) return false;
    const e = w.enemies;
    this.arcs.chain(w, i, e.x[i], e.y[i], this.arcTargets, this.arcFrac * dmg, cause);
    return true;
  }

  private procPoison(w: World, i: number, ref: number, cause: number, forced: boolean): boolean {
    const whole = Math.floor(this.poisonApp);
    let stacks = whole + (w.prng.chance(this.poisonApp - whole) ? 1 : 0);
    if (forced && stacks < 1) stacks = 1;
    if (stacks <= 0) return false;
    w.applyStatus(i, 'poison', stacks, this.poisonDur, 'poison', cause, this.poisonFrac * ref);
    return true;
  }

  private fireballHit(w: World, hit: HitInfo, meteor: boolean): void {
    this.burn(w, hit.enemy, Math.max(1, Math.round(this.fbStacks)), hit.damage, hit.eventId);
    if (hit.cause === this.burstCause) return;        // once per explosion (hit.cause = Explosion event)
    this.burstCause = hit.cause;
    const x = hit.x, y = hit.y;
    if (meteor) {
      w.addHazard({ kind: 'fire_zone', x, y, radius: this.meteorR, life: this.meteorDur, dps: this.burnFrac * hit.damage * this.fbStacks,
        element: 'fire', cause: hit.cause, owner: 'primary', srcTag: TAG.meteor });
    }
    if (this.sunburst) {
      const n = Math.max(1, Math.round(this.embers));
      const life = Math.ceil((this.emberRange / EMBER_SPEED) * TICK_RATE);
      for (let k = 0; k < n; k++) {
        const a = (TAU * k) / n;
        w.spawnProjectile({ kind: ProjKind.Fragment, source: 0, srcTag: TAG.sunburst, x, y, vx: cos(a) * EMBER_SPEED, vy: sin(a) * EMBER_SPEED,
          damage: hit.damage * 0.1, radius: 3, life, element: 'fire', cause: hit.cause });
      }
    }
  }

  onStatusApply(w: World, i: number, status: StatusId, n: number, srcTag: string, id: number): void {
    const e = w.enemies;
    if (status === 'burn') {
      if (this.flash > 0 && n >= this.cap(w, 'burn') && e.flashUntil[i] <= w.tick && (srcTag !== TAG.flashpoint || this.conflag)) this.flashpoint(w, i, id);
    } else if (status === 'chill') {
      if (n >= this.cap(w, 'chill')) this.maxChill(w, i, id);
    } else if (status === 'poison') {
      if (this.toxicBurst && n >= this.cap(w, 'poison')) this.burst(w, i, n, id);
    }
  }

  /** Queue a Flashpoint (detonated by drainFlashpoints, FLASH_BUDGET per tick). */
  private flashpoint(w: World, i: number, cause: number): void {
    const e = w.enemies;
    // erupt once per Burn episode: "reaching" max stacks, not every refresh while at max
    e.flashUntil[i] = w.tick + Math.max(TICK_RATE, e.burnT[i]);
    const dmg = Math.max(1e-3, Math.min(pendingBurn(w, i) * this.flash, this.flashSrcCap * e.maxHp[i])), stacks = this.conflag ? e.burn[i] : 1, dps = e.burnDps[i] * this.flashInherit;
    if (this.bursts.push(w, 1, i, dmg, stacks, dps, cause, this.flashR * 0.5) < 0) this.detonateFlash(w, e.x[i], e.y[i], dmg, stacks, dps, cause);
  }
  private drainFlashpoints(w: World): void {
    const q = this.bursts, e = w.enemies;
    for (let k = 0; k < FLASH_BUDGET; k++) {
      const s = q.shift();
      if (s < 0) break;
      const i = w.resolveEnemy(q.enemy[s], q.gen[s]);
      const x = i >= 0 ? e.x[i] : q.x[s], y = i >= 0 ? e.y[i] : q.y[s];
      this.detonateFlash(w, x, y, q.dmg[s], q.a[s], q.b[s], q.cause[s]);
    }
  }
  private detonateFlash(w: World, x: number, y: number, dmg: number, stacks: number, dps: number, cause: number): void {
    const ps = this.flashStacks, pd = this.flashDps;
    this.flashStacks = stacks; this.flashDps = dps;
    w.explode(x, y, this.flashR, dmg, { source: 'element', srcTag: TAG.flashpoint, element: 'fire', cause, falloff: true, maxHpCap: this.flashTgtCap });
    this.flashStacks = ps; this.flashDps = pd;
  }
  private flashDps = 0;

  private maxChill(w: World, i: number, cause: number): void {
    const e = w.enemies, tick = w.tick;
    if (this.deepFreeze > 0 && e.freezeLockUntil[i] <= tick) {
      e.freezeLockUntil[i] = tick + this.freezeLock;
      const dur = Math.round(this.deepFreeze * TICK_RATE);
      if (e.flags[i] & PERSIST) e.bossSlowUntil[i] = tick + dur;
      else w.freeze(i, dur, 'frost', cause);
    }
    if (this.brittleOn) w.applyStatus(i, 'brittle', 1, Math.max(e.chillT[i], 2 * TICK_RATE), 'frost', cause);
  }

  private burst(w: World, i: number, n: number, cause: number): void {
    const e = w.enemies;
    const dmg = pendingPoison(w, i), t = e.poisonT[i];
    const h = w.damage(i, dmg, { source: 'element', srcTag: TAG.toxicBurst, element: 'poison', cause, ignoreArmor: true });
    const id = h.eventId;
    if (!w.alive(i)) return;
    const half = n >> 1;
    e.poison[i] = 0;
    if (half > 0) w.applyStatus(i, 'poison', half, t, 'poison', id, e.poisonDps[i]);
  }

  onKill(w: World, hit: HitInfo): void {
    const i = hit.enemy, e = w.enemies, kid = hit.eventId;
    if (i < 0 || i >= e.count) return;
    const x = e.x[i], y = e.y[i];
    if (this.spread > 0 && e.burn[i] > 0) {
      const m = nearestN(w, this.qs, x, y, this.spreadR, i, Math.min(this.near.length, this.spreadN), this.near);
      const dps = e.burnDps[i];
      for (let k = 0; k < m; k++) w.applyStatus(this.near[k], 'burn', this.spread, this.burnDur, 'fire', kid, dps);
    }
    if (this.contagion > 0 && e.poison[i] > 0) {
      const m = nearestN(w, this.qs, x, y, this.contagionR, i, 1, this.near);
      if (m > 0) w.applyStatus(this.near[0], 'poison', Math.max(1, Math.round(e.poison[i] * this.contagion)), this.poisonDur, TAG.contagion, kid, e.poisonDps[i] * this.incubation);
    }
    if (this.iceburst && e.brittle[i] > 0) {
      w.explode(x, y, this.iceR, e.maxHp[i] * this.iceFrac, { source: 'element', srcTag: TAG.iceburst, element: 'frost', cause: kid, falloff: false });
    }
    if (this.discharge && (e.staticStacks[i] > 0 || (this.consumedEnemy === i && this.consumedTick === w.tick))) {
      e.staticStacks[i] = 0;
      this.arcs.chain(w, i, x, y, this.dischargeN, this.arcFrac * this.refDmg, kid);
    }
  }

  /** Element hits that are not procs: Flashpoint / Iceburst riders (source 'element'). */
  private onHitElement(w: World, hit: HitInfo): void {
    if (hit.srcTag === TAG.flashpoint) w.applyStatus(hit.enemy, 'burn', Math.max(1, this.flashStacks), this.burnDur, TAG.flashpoint, hit.eventId, this.flashDps);
    else if (hit.srcTag === TAG.iceburst) w.applyStatus(hit.enemy, 'chill', 3, this.chillDur, 'frost', hit.eventId);
  }

  damageMul(w: World, i: number, _amount: number, hit: HitInfo, ignoreArmor: boolean): number {
    const e = w.enemies;
    let m = 1;
    if (this.staticCharge > 0 && e.staticStacks[i] > 0 && (weaponIndex(hit.source) >= 0 || hit.source === 'ability' || hit.source === 'linkage')) {
      m *= 1 + this.staticCharge;
      e.staticStacks[i] = 0; e.staticT[i] = 0;
      this.consumedEnemy = i; this.consumedTick = w.tick;
    }
    if (this.brittleOn && e.brittle[i] > 0) {
      m *= 1 + this.brittle;
      if (hit.crit && this.fracture > 0) m *= (this.critMul + this.fracture) / this.critMul;
    }
    const p = e.poison[i];
    if (p > 0) {
      if (this.virulence > 0 && p > 5 && hit.srcTag === 'poison') m *= 1 + this.virulence * (p - 5);
      if (this.corrosion > 0 && !ignoreArmor && e.armor[i] > 0) {
        const ar = e.armor[i], strip = Math.min(this.corrosionCap, this.corrosion * p);
        m *= (100 + ar) / (100 + ar * (1 - strip));
      }
    }
    return m;
  }

  render(_w: World, out: InstanceWriter): void {
    for (let b = 0; b < this.ballN; b++) out.push(this.ballX[b], this.ballY[b], 7, 0, Shape.Circle, 0.6, 0.8, 1, 0.9, 2);
    if (_w.tick < this.stormUntil) out.push(0, 0, this.scR, 0, Shape.Ring, 0.55, 0.75, 1, 0.22, 2);
  }
}
