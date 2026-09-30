/**
 * Anomalies (design §9), the Prestige IV combat nodes (§14), the Pacifist Core Trial rule (§16) and
 * the Echo Engine frame trait for the primary (§4). WP8.
 *
 * Stat-shaped Anomalies resolve through their `effects` in core/stats.ts (Mirror Node −40% beams,
 * Cold Iron, Heavy Water, Overcharged Capacitor, Glass Cannon, Unstable Isotope radius, Tithe,
 * Hungry Core, Smolder, Martyr Plating, Feedback Loop CE). Rules in core files: Spare Barrel
 * (stats.doctrineStrength 0.5), Borrowed Blade (stats.mounted/borrowed), Recursive Warhead
 * (stats grants ordnance.cluster_warheads), Loaded Dice (core/projectiles.ts re-roll), Tithe
 * (2 Cores in World.finishKill; no between-wave heal in systems/tower.ts), Hungry Core (kill heal in
 * finishKill; World.healTower and regeneration stop), Second Opinion (systems/abilities.ts).
 * Mechanics implemented here (each firing emits Ev.Anomaly with src `anomaly.<id>` /
 * `prestige.<id>` — the Codex registers it, and the event is the chain link of what follows):
 *  seventh_shot     every 7th new primary Bullet becomes a Fireball (blast 60 × combat.blast_radius_mul,
 *                   fire element, srcTag anomaly.seventh_shot; its hits apply 2 Burn stacks)
 *  pinball          projectiles with bounces left reflect off the arena edge for free; when their life
 *                   runs out they spend one bounce to fly one more arena diameter
 *  stormglass       (elements-shared.ts ArcEngine) arc links from or to a frozen / max-Chill enemy reach 2 × range
 *  clockwork_blade  every 6 s (blade mounted): signals.bladeDir flips and a 120-unit shockwave centred on each
 *                   blade's tip (world.shared, last published) knocks enemies away from it
 *  ghost_protocol   drone kills rise as ghosts (3 s) that chase the nearest enemy, 10% of the victim's
 *                   max HP per second on contact (anomaly-owned entities, rendered here)
 *  rogue_moon       a mass orbiting at 380 u: contact damage 40% of a weight-1 enemy's HP per second,
 *                   weak pull (30 u/s within 150 u)
 *  unstable_isotope 5% of explosions (Ev.Explosion) also hit the tower for 10% of their damage
 *  hungry_core      (core) — here only the throttled Codex event on kill heals
 *  martyr_plating   without Thorns, tower hits retaliate damage × thorns.retaliation × retaliation_mul
 *  afterimage_round each new primary Bullet fires again from the tower 0.4 s later at 30%
 *  echo_chamber     every explosion repeats 0.5 s later at 40% damage and 70% radius
 *  feedback_loop    (systems/abilities.ts) every cast recasts itself 1 s later at 50% power
 *  rot_bloom        poisoned enemies that die leave a 3 s cloud: 1 Poison stack per second within 50 u
 * Prestige IV: Duplication (primary Bullets duplicate at prestige.duplication chance), Double Launch
 * (every 5th new ordnance Missile/Rocket launches twice), Conscription (elite kills fight as allies
 * for 10 s), Reversal (signals.bladeDir flips every 8 s), Ghost Edges (signals.ghostEdges = rank for
 * 2 s every 5 s), Held Open (a boss weak point closed by its script is held open +0.5 s/rank),
 * Relay Fire (every 10th new drone projectile fires a primary round at that drone's target).
 * Echo Engine: every 8th new primary Bullet repeats (ordnance/drones implement their own repeat).
 * Pacifist Core: damageMul returns 0 unless the source is status / hazard / retaliation.
 */
import type { System, HitInfo, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { ElementId } from '../core/ids';
import type { SimEvent } from '../core/types';
import { ARENA_RADIUS, EnemyFlag, Ev, NO_ENTITY, ProjFlag, ProjKind, Shape, TICK_RATE, TOWER_RADIUS } from '../core/types';
import { cos, sin } from '../math/lut';
import { enemyHp } from '../economy/curves';
import { ELEMENT_ORDER, SYSTEM_ORDER_IDS } from '../data/index';
import { trialHas } from '../economy/prestige';

const FIRE_EL = ELEMENT_ORDER.indexOf('fire') + 1;
const SKIP_FLAGS = ProjFlag.Dead | ProjFlag.Hostile | ProjFlag.Echo | ProjFlag.Duplicate;
const Q = 256;               // delayed primary echoes
const XQ = 64;               // delayed explosions
const MAX_ALLIES = 48, MAX_CLOUDS = 32;
const SCRATCH = new Int32Array(1024);
const INIT = {
  kind: 0, source: 0, x: 0, y: 0, vx: 0, vy: 0, damage: 0, radius: 3, life: 60, pierce: 0, bounces: 0, target: NO_ENTITY,
  flags: 0, element: null as ElementId | null, critChance: 0, blast: 0, cause: -1, srcTag: '', critMul: 1.5, retention: 1,
  pierceSpeed: 0, bounceRange: 0, knock: 0, execBonus: 0,
};

function elementOf(i: number): ElementId | null { return i > 0 ? (ELEMENT_ORDER[i - 1] as ElementId) : null; }
function sourceFor(src: string): HitInfo['source'] {
  const dot = src.indexOf('.');
  const head = dot > 0 ? src.slice(0, dot) : src;
  if (head === 'ballistics' || head === 'primary') return 'primary';
  if ((SYSTEM_ORDER_IDS as readonly string[]).includes(head)) return head as HitInfo['source'];
  if (head === 'fusion' || head === 'triad') return 'fusion';
  if (head === 'link' || head === 'chassis') return 'linkage';
  if (head === 'ability') return 'ability';
  return 'hazard';
}

export class AnomaliesSystem implements System {
  readonly id = 'anomalies';
  private lastGen = 0; private cloneGen = 0; private lastEvent = 0;
  private primaryShots = 0; private missiles = 0; private droneShots = 0;
  // cached per rebuild
  private seventh = 0; private dup = 0; private afterimage = false; private pinball = false; private doubleLaunch = false;
  private relayFire = false; private echoEngine = false; private ghost = false; private conscription = false;
  private rotBloom = false; private martyr = false; private isotope = false; private echoChamber = false;
  private moon = false; private clockwork = false; private reversal = false; private ghostEdges = 0; private heldOpen = 0;
  private hungry = false; private blastMul = 1; private moonR = 380;
  // delayed primary echoes (Afterimage Round), SoA ring
  private qDue = new Int32Array(Q); private qF = new Float64Array(Q * 12); private qHead = 0; private qTail = 0;
  // delayed explosions (Echo Chamber)
  private xDue = new Int32Array(XQ); private xF = new Float64Array(XQ * 5); private xSrc: string[] = new Array(XQ).fill(''); private xHead = 0; private xTail = 0;
  // allies (Ghost Protocol, Conscription)
  private ax = new Float32Array(MAX_ALLIES); private ay = new Float32Array(MAX_ALLIES); private attl = new Int32Array(MAX_ALLIES);
  private adps = new Float32Array(MAX_ALLIES); private acause = new Int32Array(MAX_ALLIES); private akind = new Uint8Array(MAX_ALLIES); private allies = 0;
  // rot clouds
  private rx = new Float32Array(MAX_CLOUDS); private ry = new Float32Array(MAX_CLOUDS); private rttl = new Int32Array(MAX_CLOUDS); private rcause = new Int32Array(MAX_CLOUDS); private clouds = 0;
  // held open (boss gen, remaining ticks, forced)
  private hoGen = new Uint32Array(8); private hoRemain = new Int32Array(8); private hoForced = new Uint8Array(8);
  private moonX = 0; private moonY = 0;
  private throttle = new Map<string, number>();

  init(w: World): void {
    this.rebuild(w);
    const p = w.projectiles;
    let g = 0; for (let i = 0; i < p.count; i++) if (p.gen[i] > g) g = p.gen[i];
    this.lastGen = this.cloneGen = g;
    this.lastEvent = w.events.nextId;
    this.qHead = this.qTail = this.xHead = this.xTail = 0;
    this.allies = this.clouds = 0;
    this.primaryShots = this.missiles = this.droneShots = 0;
    this.throttle.clear();
    w.signals.bladeDir = 1; w.signals.ghostEdges = 0;
  }
  onAttemptStart(w: World): void { this.init(w); }

  rebuild(w: World): void {
    const s = w.stats as WorldImpl['stats'];
    const has = (id: string): boolean => s.hasAnomaly(id);
    this.seventh = has('seventh_shot') ? Math.max(1, Math.floor(s.get('anomaly.seventh_shot.every'))) : 0;
    this.dup = Math.max(0, s.get('prestige.duplication'));
    this.afterimage = has('afterimage_round'); this.pinball = has('pinball');
    this.doubleLaunch = s.rank('prestige.double_launch') > 0; this.relayFire = s.rank('prestige.relay_fire') > 0;
    this.echoEngine = s.frameFlag('every_8th_repeats');
    this.ghost = has('ghost_protocol'); this.conscription = s.rank('prestige.conscription') > 0;
    this.rotBloom = has('rot_bloom'); this.martyr = has('martyr_plating'); this.isotope = has('unstable_isotope');
    this.echoChamber = has('echo_chamber'); this.moon = has('rogue_moon');
    this.clockwork = has('clockwork_blade'); this.reversal = s.rank('prestige.reversal') > 0;
    this.ghostEdges = s.rank('prestige.ghost_edges'); this.heldOpen = Math.round(Math.max(0, s.get('prestige.held_open')) * TICK_RATE);
    this.hungry = has('hungry_core');
    this.blastMul = s.get('combat.blast_radius_mul') || 1;
    this.moonR = s.get('anomaly.rogue_moon.orbit') || 380;
    w.signals.laserNodeMul = has('mirror_node') ? Math.max(1, s.get('anomaly.mirror_node.count_mul')) : 1;
    // projectiles already in flight when the set of effects changes are not "new"
    const p = w.projectiles;
    for (let i = 0; i < p.count; i++) if (p.gen[i] > this.lastGen) this.lastGen = p.gen[i];
  }

  /** Ev.Anomaly, at most once per `every` ticks per tag (high-frequency passives). Returns the id or `cause`. */
  private fire(w: World, tag: string, cause: number, x = 0, y = 0, every = 0): number {
    if (every > 0) {
      const last = this.throttle.get(tag);
      if (last !== undefined && w.tick - last < every) return cause;
      this.throttle.set(tag, w.tick);
    }
    return w.emit(Ev.Anomaly, tag, 0, 0, x, y, cause);
  }

  update(world: World): void {
    const w = world as WorldImpl;
    this.scanProjectiles(w);
    if (this.pinball) this.pinballTick(w);
    this.releaseEchoes(w);
    this.scanEvents(w);
    this.releaseExplosions(w);
    this.bladeTick(w);
    if (this.allies) this.alliesTick(w);
    if (this.moon) this.moonTick(w);
    if (this.clouds) this.cloudsTick(w);
    if (this.heldOpen > 0) this.heldOpenTick(w);
  }

  // ---------------------------------------------------------------------------
  // New projectiles (Seventh Shot, Duplication, Afterimage, Double Launch, Relay Fire, Echo Engine)
  // ---------------------------------------------------------------------------
  private scanProjectiles(w: WorldImpl): void {
    if (!(this.seventh || this.dup > 0 || this.afterimage || this.doubleLaunch || this.relayFire || this.echoEngine)) return;
    const p = w.projectiles, n = p.count, last = this.lastGen;
    let maxG = last;
    for (let i = 0; i < n; i++) {
      const g = p.gen[i];
      if (g <= last) continue;
      if (g > maxG) maxG = g;
      if (p.flags[i] & SKIP_FLAGS) continue;
      const src = p.source[i], kind = p.kind[i];
      if (src === 0 && kind === ProjKind.Bullet) {
        this.primaryShots++;
        if (this.seventh && this.primaryShots % this.seventh === 0) this.toFireball(w, i);
        if (this.echoEngine && this.primaryShots % 8 === 0) this.clone(w, i, 0.05, 1, ProjFlag.Echo, 'frame.echo_engine');
        if (this.dup > 0 && w.prng.chance(this.dup)) this.clone(w, i, 0.08, 1, ProjFlag.Duplicate, 'prestige.duplication');
        if (this.afterimage) this.queueEcho(w, i);
      } else if (src === 1 && this.doubleLaunch && (kind === ProjKind.Missile || kind === ProjKind.Rocket)) {
        if (++this.missiles % 5 === 0) this.clone(w, i, 0.15, 1, ProjFlag.Duplicate, 'prestige.double_launch');
      } else if (src === 2 && this.relayFire) {
        if (++this.droneShots % 10 === 0) this.relay(w, i);
      }
    }
    this.lastGen = Math.max(maxG, this.cloneGen);
  }

  private spawn(w: WorldImpl): number {
    const j = w.spawnProjectile(INIT);
    if (j >= 0 && w.projectiles.gen[j] > this.cloneGen) this.cloneGen = w.projectiles.gen[j];
    return j;
  }

  private loadInit(w: WorldImpl, i: number): void {
    const p = w.projectiles;
    INIT.kind = p.kind[i]; INIT.source = p.source[i]; INIT.x = p.x[i]; INIT.y = p.y[i]; INIT.vx = p.vx[i]; INIT.vy = p.vy[i];
    INIT.damage = p.damage[i]; INIT.radius = p.radius[i]; INIT.life = p.life[i]; INIT.pierce = p.pierce[i]; INIT.bounces = p.bounces[i];
    INIT.target = p.target[i]; INIT.flags = p.flags[i] & ~ProjFlag.Dead; INIT.element = elementOf(p.element[i]); INIT.critChance = p.critChance[i];
    INIT.blast = p.blast[i]; INIT.cause = p.cause[i]; INIT.srcTag = w.tagName(p.tag[i]); INIT.critMul = p.critMul[i]; INIT.retention = p.retention[i];
    INIT.pierceSpeed = p.pierceSpeed[i]; INIT.bounceRange = p.bounceRange[i]; INIT.knock = p.knock[i]; INIT.execBonus = p.execBonus[i];
  }

  private clone(w: WorldImpl, i: number, angle: number, dmgMul: number, flag: number, tag: string): number {
    const p = w.projectiles;
    this.loadInit(w, i);
    const c = cos(angle), s = sin(angle);
    INIT.vx = p.vx[i] * c - p.vy[i] * s; INIT.vy = p.vx[i] * s + p.vy[i] * c;
    INIT.damage *= dmgMul; INIT.flags |= flag;
    INIT.cause = this.fire(w, tag, p.cause[i], p.x[i], p.y[i]);
    return this.spawn(w);
  }

  private toFireball(w: WorldImpl, i: number): void {
    const p = w.projectiles;
    p.cause[i] = this.fire(w, 'anomaly.seventh_shot', p.cause[i], p.x[i], p.y[i]);
    p.kind[i] = ProjKind.Fireball; p.blast[i] = 60 * this.blastMul; p.element[i] = FIRE_EL;
    p.tag[i] = w.tagId('anomaly.seventh_shot'); p.pierce[i] = 0;
    if (p.radius[i] < 5) p.radius[i] = 5;
  }

  private relay(w: WorldImpl, i: number): void {
    const p = w.projectiles, e = w.enemies;
    const t = p.target[i];
    let dx = p.vx[i], dy = p.vy[i];
    if (t >= 0 && w.alive(t)) { dx = e.x[t]; dy = e.y[t]; }
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 1e-6) return;
    const speed = Math.max(60, w.stats.get('ballistics.projectile_speed'));
    const ux = dx / d, uy = dy / d;
    INIT.kind = ProjKind.Bullet; INIT.source = 0; INIT.x = ux * TOWER_RADIUS; INIT.y = uy * TOWER_RADIUS; INIT.vx = ux * speed; INIT.vy = uy * speed;
    INIT.damage = w.stats.get('ballistics.damage'); INIT.radius = 3; INIT.life = Math.ceil((w.stats.get('ballistics.range') * 1.15 / speed) * TICK_RATE) + 30;
    INIT.pierce = 0; INIT.bounces = 0; INIT.target = t >= 0 && w.alive(t) ? t : NO_ENTITY; INIT.flags = ProjFlag.Duplicate; INIT.element = null;
    INIT.critChance = w.stats.get('ballistics.crit_chance'); INIT.blast = 0; INIT.srcTag = 'ballistics'; INIT.critMul = w.stats.get('ballistics.crit_damage');
    INIT.retention = 1; INIT.pierceSpeed = 0; INIT.bounceRange = 0; INIT.knock = 0; INIT.execBonus = 0;
    INIT.cause = this.fire(w, 'prestige.relay_fire', p.cause[i], p.x[i], p.y[i]);
    this.spawn(w);
  }

  private queueEcho(w: WorldImpl, i: number): void {
    const next = (this.qTail + 1) % Q;
    if (next === this.qHead) return;   // full: drop
    const p = w.projectiles, k = this.qTail, f = this.qF, o = k * 12;
    this.qDue[k] = w.tick + Math.round(w.stats.get('anomaly.afterimage_round.delay') * TICK_RATE);
    f[o] = p.x[i]; f[o + 1] = p.y[i]; f[o + 2] = p.vx[i]; f[o + 3] = p.vy[i];
    f[o + 4] = p.damage[i] * w.stats.get('anomaly.afterimage_round.damage'); f[o + 5] = p.radius[i]; f[o + 6] = p.life[i];
    f[o + 7] = p.pierce[i]; f[o + 8] = p.bounces[i]; f[o + 9] = p.critChance[i]; f[o + 10] = p.critMul[i]; f[o + 11] = p.cause[i];
    this.qTail = next;
  }

  private releaseEchoes(w: WorldImpl): void {
    while (this.qHead !== this.qTail && this.qDue[this.qHead] <= w.tick) {
      const f = this.qF, o = this.qHead * 12;
      INIT.kind = ProjKind.Bullet; INIT.source = 0; INIT.x = f[o]; INIT.y = f[o + 1]; INIT.vx = f[o + 2]; INIT.vy = f[o + 3];
      INIT.damage = f[o + 4]; INIT.radius = f[o + 5]; INIT.life = f[o + 6]; INIT.pierce = f[o + 7]; INIT.bounces = f[o + 8];
      INIT.target = NO_ENTITY; INIT.flags = ProjFlag.Echo; INIT.element = null; INIT.critChance = f[o + 9]; INIT.blast = 0;
      INIT.srcTag = 'ballistics'; INIT.critMul = f[o + 10]; INIT.retention = 1; INIT.pierceSpeed = 0; INIT.bounceRange = 0; INIT.knock = 0; INIT.execBonus = 0;
      INIT.cause = this.fire(w, 'anomaly.afterimage_round', f[o + 11], f[o], f[o + 1]);
      this.spawn(w);
      this.qHead = (this.qHead + 1) % Q;
    }
  }

  private pinballTick(w: WorldImpl): void {
    const p = w.projectiles, R = ARENA_RADIUS;
    for (let i = 0; i < p.count; i++) {
      if ((p.flags[i] & (ProjFlag.Dead | ProjFlag.Hostile)) || p.bounces[i] === 0) continue;
      const x = p.x[i], y = p.y[i], d2 = x * x + y * y;
      if (d2 >= (R - 4) * (R - 4)) {
        const d = Math.sqrt(d2), nx = x / d, ny = y / d, vn = p.vx[i] * nx + p.vy[i] * ny;
        if (vn > 0) {
          p.vx[i] -= 2 * vn * nx; p.vy[i] -= 2 * vn * ny;
          p.x[i] = nx * (R - 6); p.y[i] = ny * (R - 6);
          p.lastHit[i] = NO_ENTITY; p.hitMask[i] = 0;
          p.cause[i] = this.fire(w, 'anomaly.pinball', p.cause[i], p.x[i], p.y[i], TICK_RATE);
        }
      }
      if (p.life[i] <= 2) {
        const sp = Math.sqrt(p.vx[i] * p.vx[i] + p.vy[i] * p.vy[i]);
        if (sp > 1) { p.bounces[i]--; p.life[i] = Math.min(65535, Math.ceil((2 * R / sp) * TICK_RATE)); }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Event-driven (Unstable Isotope, Echo Chamber, Tithe)
  // ---------------------------------------------------------------------------
  private scanEvents(w: WorldImpl): void {
    const end = w.events.nextId;
    if (!(this.isotope || this.echoChamber || w.stats.hasAnomaly('tithe'))) { this.lastEvent = end; return; }
    this.scanW = w;
    w.events.forEachRange(this.lastEvent, end, this.onScanEvent);
    this.lastEvent = end;
  }
  /** scanEvents' visitor, allocated once (per-tick closures were GC churn); reads the world from scanW. */
  private scanW: WorldImpl | null = null;
  private readonly onScanEvent = (e: SimEvent): void => {
    const w = this.scanW!;
    if (e.type === Ev.Explosion) {
        if (this.isotope && e.src !== 'anomaly.unstable_isotope' && w.prng.chance(w.stats.get('anomaly.unstable_isotope.self_chance'))) {
          const ev = this.fire(w, 'anomaly.unstable_isotope', e.id, e.x, e.y);
          // capped per detonation: with Flashpoint-scale explosion volume the uncapped 10% was self-destruction
          w.damageTower(Math.min(e.b * w.stats.get('anomaly.unstable_isotope.self_damage'), w.tower.maxHp * w.stats.get('anomaly.unstable_isotope.self_cap')), -1, ev, 'self');
        }
        if (this.echoChamber && e.src !== 'anomaly.echo_chamber') this.queueExplosion(w, e);
      } else if (e.type === Ev.CoreDrop && e.src === 'boss' && e.a >= 2 && w.stats.hasAnomaly('tithe')) {
        this.fire(w, 'anomaly.tithe', e.id, e.x, e.y);
      }
  };

  private queueExplosion(w: WorldImpl, e: SimEvent): void {
    const next = (this.xTail + 1) % XQ;
    if (next === this.xHead) return;
    const k = this.xTail, o = k * 5, s = w.stats;
    this.xDue[k] = w.tick + Math.round(s.get('anomaly.echo_chamber.delay') * TICK_RATE);
    this.xF[o] = e.x; this.xF[o + 1] = e.y; this.xF[o + 2] = e.a * s.get('anomaly.echo_chamber.radius');
    this.xF[o + 3] = e.b * s.get('anomaly.echo_chamber.damage'); this.xF[o + 4] = e.id; this.xSrc[k] = e.src;
    this.xTail = next;
  }

  private releaseExplosions(w: WorldImpl): void {
    while (this.xHead !== this.xTail && this.xDue[this.xHead] <= w.tick) {
      const o = this.xHead * 5, f = this.xF;
      const ev = this.fire(w, 'anomaly.echo_chamber', f[o + 4], f[o], f[o + 1]);
      w.explode(f[o], f[o + 1], f[o + 2], f[o + 3], { source: sourceFor(this.xSrc[this.xHead]), srcTag: 'anomaly.echo_chamber', cause: ev });
      this.xHead = (this.xHead + 1) % XQ;
    }
  }

  // ---------------------------------------------------------------------------
  // Blade clock (Clockwork Blade, Reversal), laser signals (Ghost Edges)
  // ---------------------------------------------------------------------------
  private bladeTick(w: WorldImpl): void {
    const at = w.run.attemptTick, sg = w.signals;
    const edgeP = 5 * TICK_RATE;
    const laser = this.ghostEdges > 0 && w.stats.mounted('laser');
    sg.ghostEdges = laser && at % edgeP < 2 * TICK_RATE ? this.ghostEdges : 0;
    if (laser && at > 0 && at % edgeP === 0) this.fire(w, 'prestige.ghost_edges', -1);
    if (!w.stats.mounted('blade') || at <= 0) return;
    const cp = Math.max(1, Math.round(w.stats.get('anomaly.clockwork_blade.period') * TICK_RATE));
    if (this.clockwork && at % cp === 0) {
      sg.bladeDir = -sg.bladeDir;
      const ev = this.fire(w, 'anomaly.clockwork_blade', -1);
      // the shockwave bursts from each blade's tip (geometry the blade published last tick), pushing enemies away from it
      const r = w.stats.get('anomaly.clockwork_blade.shockwave_radius'), sh = w.shared;
      for (let b = 0; b < sh.bladeCount; b++) {
        const a = sh.bladeAngles[b], tip = sh.bladeInner[b] + sh.bladeLens[b], bx = cos(a) * tip, by = sin(a) * tip;
        const n = w.queryRadius(bx, by, r, SCRATCH);
        for (let k = 0; k < n; k++) { const i = SCRATCH[k]; if (w.alive(i)) w.knockback(i, w.enemies.x[i] - bx, w.enemies.y[i] - by, 40); }
        w.emit(Ev.Fx, 'anomaly.clockwork_blade', b, r, bx, by, ev);
      }
    } else if (this.reversal && at % (8 * TICK_RATE) === 0) {
      sg.bladeDir = -sg.bladeDir;
      this.fire(w, 'prestige.reversal', -1);
    }
  }

  // ---------------------------------------------------------------------------
  // Anomaly-owned entities: allies, Rogue Moon, rot clouds
  // ---------------------------------------------------------------------------
  private addAlly(x: number, y: number, ticks: number, dps: number, cause: number, kind: number): void {
    if (this.allies >= MAX_ALLIES) return;
    const k = this.allies++;
    this.ax[k] = x; this.ay[k] = y; this.attl[k] = ticks; this.adps[k] = dps; this.acause[k] = cause; this.akind[k] = kind;
  }

  private alliesTick(w: WorldImpl): void {
    const e = w.enemies, step = 160 / TICK_RATE, pulse = w.tick % 15 === 0;
    let k = 0;
    while (k < this.allies) {
      if (--this.attl[k] <= 0) {
        const l = --this.allies;
        this.ax[k] = this.ax[l]; this.ay[k] = this.ay[l]; this.attl[k] = this.attl[l]; this.adps[k] = this.adps[l]; this.acause[k] = this.acause[l]; this.akind[k] = this.akind[l];
        continue;
      }
      const t = w.nearestEnemy(this.ax[k], this.ay[k], 240, 'nearest', 'drones');
      if (t >= 0) {
        const dx = e.x[t] - this.ax[k], dy = e.y[t] - this.ay[k], d = Math.sqrt(dx * dx + dy * dy);
        if (d > e.radius[t] + 8) { const m = Math.min(step, d) / (d || 1); this.ax[k] += dx * m; this.ay[k] += dy * m; }
        else if (pulse) w.damage(t, this.adps[k] * 0.25, { source: 'drones', srcTag: this.akind[k] ? 'prestige.conscription' : 'anomaly.ghost_protocol', cause: this.acause[k] });
      }
      k++;
    }
  }

  private moonTick(w: WorldImpl): void {
    const a = (w.run.attemptTick * 0.6) / TICK_RATE;
    const mx = this.moonX = cos(a) * this.moonR, my = this.moonY = sin(a) * this.moonR;
    if (w.run.phase !== 'combat') return;
    const e = w.enemies;
    const n = w.queryRadius(mx, my, 150, SCRATCH);
    const pulse = w.tick % 15 === 0;
    let cause = -2;
    for (let k = 0; k < n; k++) {
      const i = SCRATCH[k];
      if (!w.alive(i)) continue;
      w.pull(i, mx, my, 30);
      if (!pulse) continue;
      const dx = e.x[i] - mx, dy = e.y[i] - my, rr = 16 + e.radius[i];
      if (dx * dx + dy * dy > rr * rr) continue;
      if (cause === -2) cause = this.fire(w, 'anomaly.rogue_moon', -1, mx, my);
      w.damage(i, 0.4 * enemyHp(w.run.wave, 1, w.meta.ascension) * 0.25, { source: 'hazard', srcTag: 'anomaly.rogue_moon', cause });
    }
  }

  private cloudsTick(w: WorldImpl): void {
    const pulse = w.tick % TICK_RATE === 0;
    let k = 0;
    while (k < this.clouds) {
      if (pulse) {
        const n = w.queryRadius(this.rx[k], this.ry[k], 50, SCRATCH);
        for (let j = 0; j < n; j++) { const i = SCRATCH[j]; if (w.alive(i)) w.applyStatus(i, 'poison', 1, 3 * TICK_RATE, 'anomaly.rot_bloom', this.rcause[k]); }
      }
      if (--this.rttl[k] <= 0) {
        const l = --this.clouds;
        this.rx[k] = this.rx[l]; this.ry[k] = this.ry[l]; this.rttl[k] = this.rttl[l]; this.rcause[k] = this.rcause[l];
        continue;
      }
      k++;
    }
  }

  /** Held Open: when a boss script closes its weak point, keep it open `heldOpen` ticks longer. */
  private heldOpenTick(w: WorldImpl): void {
    const e = w.enemies;
    for (let i = 0; i < e.count; i++) {
      const f = e.flags[i];
      if ((f & EnemyFlag.Boss) === 0 || (f & EnemyFlag.Dead)) continue;
      let s = -1;
      for (let k = 0; k < 8; k++) if (this.hoGen[k] === e.gen[i]) { s = k; break; }
      if (s < 0) { s = e.gen[i] % 8; this.hoGen[s] = e.gen[i]; this.hoRemain[s] = 0; this.hoForced[s] = 0; }
      const open = (f & EnemyFlag.WeakPointOpen) !== 0;
      if (open && !this.hoForced[s]) this.hoRemain[s] = this.heldOpen;
      else if (this.hoRemain[s] > 0) {
        if (!this.hoForced[s]) this.fire(w, 'prestige.held_open', -1, e.x[i], e.y[i]);
        e.flags[i] |= EnemyFlag.WeakPointOpen; this.hoRemain[s]--; this.hoForced[s] = 1;
      } else if (this.hoForced[s]) { e.flags[i] &= ~EnemyFlag.WeakPointOpen; this.hoForced[s] = 0; }
    }
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------
  onHit(world: World, hit: HitInfo): void {
    const w = world as WorldImpl;
    if (hit.srcTag === 'anomaly.seventh_shot' && !hit.killed) w.applyStatus(hit.enemy, 'burn', 2, 3 * TICK_RATE, 'anomaly.seventh_shot', hit.eventId);
  }

  onKill(world: World, hit: HitInfo): void {
    const w = world as WorldImpl, e = w.enemies, i = hit.enemy;
    if (this.hungry) this.fire(w, 'anomaly.hungry_core', hit.eventId, hit.x, hit.y, TICK_RATE);
    if (this.ghost && hit.source === 'drones' && hit.srcTag !== 'anomaly.ghost_protocol' && hit.srcTag !== 'prestige.conscription') {
      const ev = this.fire(w, 'anomaly.ghost_protocol', hit.eventId, hit.x, hit.y);
      this.addAlly(e.x[i], e.y[i], Math.round(w.stats.get('anomaly.ghost_protocol.seconds') * TICK_RATE), 0.1 * e.maxHp[i], ev, 0);
    }
    if (this.conscription && (e.flags[i] & EnemyFlag.Elite) && !(e.flags[i] & EnemyFlag.Boss)) {
      const ev = this.fire(w, 'prestige.conscription', hit.eventId, hit.x, hit.y);
      this.addAlly(e.x[i], e.y[i], 10 * TICK_RATE, 0.03 * e.maxHp[i], ev, 1);
    }
    if (this.rotBloom && e.poison[i] > 0 && this.clouds < MAX_CLOUDS) {
      const ev = this.fire(w, 'anomaly.rot_bloom', hit.eventId, e.x[i], e.y[i]);
      const k = this.clouds++;
      this.rx[k] = e.x[i]; this.ry[k] = e.y[i]; this.rttl[k] = 3 * TICK_RATE; this.rcause[k] = ev;
      w.addHazard({ kind: 'toxic_cloud', x: e.x[i], y: e.y[i], radius: 50, life: 3, dps: 0, element: 'poison', cause: ev, owner: 'ability', srcTag: 'anomaly.rot_bloom' });
    }
  }

  onTowerHit(world: World, damage: number, enemy: number, cause: number): void {
    if (!this.martyr || enemy < 0 || !world.alive(enemy) || world.stats.hasDoctrine('bastion', 'thorns')) return;
    const s = world.stats;
    const dmg = damage * s.get('bastion.thorns.retaliation') * s.get('bastion.thorns.retaliation_mul');
    if (dmg > 0) world.damage(enemy, dmg, { source: 'retaliation', srcTag: 'anomaly.martyr_plating', cause });
  }

  /** Pacifist Core Trial: only statuses, hazards and Retaliation deal damage. */
  damageMul(world: World, _enemy: number, _amount: number, hit: HitInfo): number {
    if (!trialHas(world.trial, 'pacifist')) return 1;
    return hit.source === 'status' || hit.source === 'hazard' || hit.source === 'retaliation' ? 1 : 0;
  }

  render(w: World, out: InstanceWriter): void {
    if (this.moon) out.push(this.moonX, this.moonY, 16, 0, Shape.Circle, 0.75, 0.7, 0.95, 1, 2);
    for (let k = 0; k < this.allies; k++) {
      const c = this.akind[k] ? 0.95 : 0.6;
      out.push(this.ax[k], this.ay[k], 7, 0, Shape.Diamond, c, 0.9, 1, 0.7, 2);
    }
    if (w.signals.ghostEdges > 0) out.push(0, 0, 60, 0, Shape.Ring, 1, 0.4, 0.9, 0.25, 2);
  }
}
