/**
 * WorldImpl: the concrete World. Owns pools, the spatial hash, the event log, derived stats and
 * the combat primitives every system uses (damage, statuses, explosions, spawns, tower damage).
 *
 * Lifetimes: enemies/projectiles killed during a tick are only flagged; `endTick()` compacts the
 * pools (see core/pools.ts), repairs cached indices (projectile targets, designations) and calls
 * System.onCompact. The HitInfo returned by `damage` is a reused object: copy what you need.
 *
 * The tick orchestration (order of phases) lives in src/sim/index.ts (Sim.step).
 */
import type { World, SharedGeometry, ProgressionSignals } from './world';
import type { System, HitInfo } from './system';
import type { ElementId, StatusId, TargetingProfile, TrialId, WeaponSystemId } from './ids';
import type { BuildState, Command, EnemyPool, Hazard, MetaState, ProjectilePool, RunState, SimEvent, TowerState, WaveDef } from './types';
import { EnemyFlag, Ev, MAX_ENEMIES, MAX_HAZARDS, MAX_PROJECTILES, NO_ENTITY, ProjFlag, TICK_DT, TICK_RATE, ARENA_RADIUS } from './types';
import { MAX_BLADES, MAX_DRONES, MAX_LASER_NODES, MAX_WELLS } from './types';   // WP3: shared geometry sizes
import { Prng } from '../math/prng';
import { atan2 } from '../math/lut';
import { createEnemyPool, createProjectilePool, allocEnemy, allocProjectile, freeEnemy, freeProjectile as poolFreeProjectile, compactEnemies, compactProjectiles } from './pools';
import { SpatialHash } from './spatial';
import { ScratchStack } from './scratch';
import { EventLogImpl, StateBit, STATUS_INDEX } from './events';
import { StatResolver } from './stats';
import { selectTarget } from './targeting';
import { bossDef, bossIndex, enemyDef, flagBitsFor, kindIndex, KIND_LIST, ELITE_LIST, BOSS_LIST } from './content';
import { enemyHp, bossHp, scrapPerKill, THREAT_SPEED_PER_LEVEL } from '../economy/curves';
import { ELEMENT_ORDER } from '../data/index';

export const STATUS_CAPS: Record<StatusId, number> = { burn: 10, poison: 20, chill: 5, shock: 5, bleed: 10, brittle: 3, marked: 1, static: 10 };
export const ELITE_HP_MUL = 2.5;
const HOOK_DEPTH_LIMIT = 12;
const SHARE_BUCKETS = 10;

type DamageOpts = Parameters<World['damage']>[2];
type ProjInit = Parameters<World['spawnProjectile']>[0];

function newHit(): HitInfo {
  return { enemy: -1, damage: 0, source: 'primary', srcTag: '', crit: false, element: null, projectile: NO_ENTITY, x: 0, y: 0, cause: -1, eventId: -1, killed: false };
}

export class WorldImpl implements World {
  readonly dt = TICK_DT;
  prng: Prng;
  enemies: EnemyPool = createEnemyPool(MAX_ENEMIES);
  projectiles: ProjectilePool = createProjectilePool(MAX_PROJECTILES);
  hazards: Hazard[] = [];
  tower: TowerState;
  run: RunState;
  build: BuildState;
  meta: MetaState;
  stats: StatResolver;
  events = new EventLogImpl();
  wave: WaveDef | null = null;
  spatial: SpatialHash;
  /** Plugin systems in SYSTEM_ORDER plus core fixed-phase systems (hooks go to all of them). */
  systems: System[] = [];
  private hookHit: System[] = []; private hookKill: System[] = []; private hookStatus: System[] = []; private hookTower: System[] = [];
  private hookDepth = 0;
  private hitStack: HitInfo[] = [];
  /** Explosion query buffers (nested explosions re-enter through hooks). */
  private explodeScratch = new ScratchStack(1024);
  private enemyGen = 1;
  private projGen = 1;
  private pendingEnemyFrees = 0;
  private pendingProjFrees = 0;
  private remapE = new Int32Array(MAX_ENEMIES);
  private remapP = new Int32Array(MAX_PROJECTILES);
  private tags: string[] = [];
  private tagMap = new Map<string, number>();
  private shareBuckets: Map<string, number>[] = [];
  private shareSecond = -1;
  /** Cached per rebuild. */
  private powerMul = 1;
  lastTowerDamageTick = -1_000_000;
  /** Scrap earned (all sources) this Prestige; the run machine measures rates from it. */
  scrapEarned = 0;
  /** Scrap earned during the current wave. */
  waveScrap = 0;
  /** Kills during the current wave. */
  waveKills = 0;
  /** WP9: attack-speed multiplier (Overdrive); see World.dynamicSpeedMul. */
  dynamicSpeedMul = 1;
  /** WP9: commands queued from inside the sim; Sim.step dispatches them at the start of the next tick. */
  pendingCommands: Command[] = [];
  enqueueCommand(cmd: Command): void { this.pendingCommands.push(cmd); }

  /** WP5: live boss tell (enemies/bosses.ts writes it; ui-state reads it). */
  bossTell: World['bossTell'] = { ability: null, ticksLeft: 0, bossIndex: -1 };
  /** WP5: pre-armor damage multiplier hook (enemies/bosses.ts installs it). */
  damageModifier: World['damageModifier'] = null;
  /** WP3: shared hardpoint geometry (systems/hardpoints publish, linkages/infusions read). */
  shared: SharedGeometry = newSharedGeometry();
  /** WP2: Phoenix Last Stand etc. (see World.dynamicPowerMul). */
  dynamicPowerMul = 1;
  /** WP2: Reactive Armor (see World.towerArmorMul). */
  towerArmorMul = 1;
  /** WP2: overflow healing accumulator (Fortress Keep drains it). */
  healOverflow = 0;
  /** WP8: the Trial being played (meta.activeTrial), or null. */
  get trial(): TrialId | null { return this.meta.activeTrial ?? null; }
  /** WP8: progression signals (systems/anomalies.ts writes them). */
  signals: ProgressionSignals = { bladeDir: 1, ghostEdges: 0, laserNodeMul: 1 };
  private hookDmg: System[] = [];
  /** WP2: element trees own the burn/poison/chill caps while attuned (cached per rebuild; 0 = use STATUS_CAPS). */
  private elemCap: Record<string, number> = { burn: 0, poison: 0, chill: 0 };

  constructor(run: RunState, build: BuildState, meta: MetaState, tower: TowerState, prng: Prng) {
    this.run = run; this.build = build; this.meta = meta; this.tower = tower; this.prng = prng;
    this.stats = new StatResolver(build, meta);
    this.spatial = new SpatialHash(this.enemies);
    for (let i = 0; i < SHARE_BUCKETS; i++) this.shareBuckets.push(new Map());
    for (const t of ['ballistics', 'ordnance', 'drones', 'blade', 'laser', 'gravitics', 'enemy']) this.tagId(t);
    this.cacheStats();
  }

  get tick(): number { return this.run.tick; }

  setSystems(systems: System[]): void {
    this.systems = systems;
    this.hookHit = systems.filter((s) => s.onHit);
    this.hookKill = systems.filter((s) => s.onKill);
    this.hookStatus = systems.filter((s) => s.onStatusApply);
    this.hookTower = systems.filter((s) => s.onTowerHit);
    this.hookDmg = systems.filter((s) => s.damageMul);   // WP2
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------
  rebuildStats(): void {
    this.stats.rebuild();
    this.cacheStats();
    for (const s of this.systems) s.rebuild(this);
  }
  private cacheStats(): void {
    const s = this.stats, t = this.tower;
    this.powerMul = s.get('combat.power_mul');
    // WP2: attuned element trees set their status caps (fire.burn_stacks, poison.stack_cap, frost.chill_stacks)
    this.elemCap.burn = s.attuned('fire') ? Math.max(1, Math.floor(s.get('fire.burn_stacks'))) : 0;
    this.elemCap.poison = s.attuned('poison') ? Math.max(1, Math.floor(s.get('poison.stack_cap'))) : 0;
    this.elemCap.chill = s.attuned('frost') ? Math.max(1, Math.floor(s.get('frost.chill_stacks'))) : 0;
    // bastion.max_hp_final multiplies after every other max-HP bonus (Glass Cannon's −50% must bite)
    const maxHp = Math.max(1, s.get('bastion.max_hp') * s.get('bastion.max_hp_final'));
    if (t.maxHp > 0 && maxHp > t.maxHp && t.hp > 0) t.hp += maxHp - t.maxHp;   // buying max HP heals the difference
    t.maxHp = maxHp;
    if (t.hp > maxHp) t.hp = maxHp;
    t.maxShield = Math.max(0, s.get('bastion.shield_capacity'));
    if (t.shield > t.maxShield) t.shield = t.maxShield;
    t.ceCap = Math.max(0, s.get('economy.ce_cap'));
    if (t.ce > t.ceCap) t.ce = t.ceCap;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------
  queryRadius(x: number, y: number, r: number, out: Int32Array): number { return this.spatial.queryRadius(x, y, r, out); }
  nearestEnemy(x: number, y: number, maxR: number, profile: TargetingProfile, _system: WeaponSystemId, prev: number = NO_ENTITY): number {
    return selectTarget(this.enemies, this.spatial, this.tower, x, y, maxR, profile, prev);
  }
  nearestExcluding(x: number, y: number, maxR: number, exclude: Int32Array, excludeCount: number): number {
    return this.spatial.nearest(x, y, maxR, exclude, excludeCount);
  }
  alive(enemy: number): boolean { return enemy >= 0 && enemy < this.enemies.count && (this.enemies.flags[enemy] & EnemyFlag.Dead) === 0; }
  resolveEnemy(index: number, gen: number): number {
    const e = this.enemies;
    if (index >= 0 && index < e.count && e.gen[index] === gen) return (e.flags[index] & EnemyFlag.Dead) === 0 ? index : NO_ENTITY;
    if (gen === 0) return NO_ENTITY;
    for (let i = 0; i < e.count; i++) if (e.gen[i] === gen) return (e.flags[i] & EnemyFlag.Dead) === 0 ? i : NO_ENTITY;
    return NO_ENTITY;
  }
  attemptSeconds(): number { return this.run.attemptTick / TICK_RATE; }
  waveSeconds(): number { return this.run.waveTick / TICK_RATE; }

  /** StateBit mask of an enemy (for event `c` fields and the chain sentence). */
  stateBits(i: number): number {
    const e = this.enemies;
    let b = 0;
    if (e.frozenT[i] > 0) b |= StateBit.Frozen;
    if (e.chill[i] > 0) b |= StateBit.Chilled;
    if (e.burn[i] > 0) b |= StateBit.Burning;
    if (e.poison[i] > 0) b |= StateBit.Poisoned;
    if (e.shock[i] > 0) b |= StateBit.Shocked;
    const f = e.flags[i];
    if (f & EnemyFlag.Elite) b |= StateBit.Elite;
    if (f & EnemyFlag.Boss) b |= StateBit.Boss;
    if (f & EnemyFlag.Clump) b |= StateBit.Clump;
    return b;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------
  emit(type: number, src: string, a: number, b: number, x: number, y: number, cause: number, data?: SimEvent['data']): number {
    return this.events.pushRaw(type as Ev, this.run.tick, src, a, b, 0, x, y, cause, data);
  }
  emitC(type: Ev, src: string, a: number, b: number, c: number, x: number, y: number, cause: number): number {
    return this.events.pushRaw(type, this.run.tick, src, a, b, c, x, y, cause);
  }
  tagId(tag: string): number {
    let id = this.tagMap.get(tag);
    if (id === undefined) { id = this.tags.length; this.tags.push(tag); this.tagMap.set(tag, id); }
    return id;
  }
  tagName(id: number): string { return this.tags[id] ?? ''; }

  // -------------------------------------------------------------------------
  // Damage
  // -------------------------------------------------------------------------
  private acquireHit(): HitInfo {
    const d = this.hookDepth;
    while (this.hitStack.length <= d) this.hitStack.push(newHit());
    return this.hitStack[d];
  }

  damage(enemy: number, amount: number, opts: DamageOpts): HitInfo {
    const h = this.acquireHit();
    const e = this.enemies;
    h.enemy = enemy; h.source = opts.source; h.srcTag = opts.srcTag; h.crit = !!opts.crit; h.element = opts.element ?? null;
    h.projectile = opts.projectile ?? NO_ENTITY; h.cause = opts.cause; h.killed = false; h.damage = 0; h.eventId = opts.cause;
    if (!this.alive(enemy) || !(amount > 0)) { h.x = opts.x ?? 0; h.y = opts.y ?? 0; return h; }
    h.x = opts.x ?? e.x[enemy]; h.y = opts.y ?? e.y[enemy];
    let dmg = amount;
    if (this.damageModifier !== null) dmg *= this.damageModifier(enemy, h.element, opts.srcTag, opts.source);   // WP5: weak points, resistances
    let toHp = 0, absorbed = 0;
    if (opts.trueDamage) {
      toHp = dmg;
    } else {
      dmg *= this.powerMul * this.dynamicPowerMul;
      for (let k = 0; k < this.hookDmg.length; k++) dmg *= this.hookDmg[k].damageMul!(this, enemy, dmg, h, !!opts.ignoreArmor);   // WP2
      const sh = e.shock[enemy];
      if (sh > 0) dmg *= 1 + 0.05 * sh;
      if (h.crit && e.brittle[enemy] > 0) dmg *= 1 + 0.15 * e.brittle[enemy];
      if (!opts.ignoreArmor) { const ar = e.armor[enemy]; if (ar > 0) dmg = (dmg * 100) / (100 + ar); }
      toHp = dmg;
      const s = e.shield[enemy];
      if (s > 0) { absorbed = s < dmg ? s : dmg; e.shield[enemy] = s - absorbed; toHp = dmg - absorbed; }
    }
    const hpBefore = e.hp[enemy] > 0 ? e.hp[enemy] : 0;
    e.hp[enemy] -= toHp;
    h.damage = dmg;
    e.lastHitTick[enemy] = this.run.tick;
    if (!opts.silent) h.eventId = this.emitC(Ev.Hit, opts.srcTag, enemy, dmg, this.stateBits(enemy), h.x, h.y, opts.cause);
    // Damage share counts effective damage (HP and shield actually removed), not overkill: an 8,000-damage
    // blast on a 50-HP enemy contributed 50. Hit events still carry the full dealt damage.
    this.recordShare(opts.srcTag, (toHp < hpBefore ? toHp : hpBefore) + absorbed);
    const killed = e.hp[enemy] <= 0;
    if (killed) { h.killed = true; e.flags[enemy] |= EnemyFlag.Dead; this.pendingEnemyFrees++; }
    if (this.hookDepth < HOOK_DEPTH_LIMIT) {
      this.hookDepth++;
      for (let k = 0; k < this.hookHit.length; k++) this.hookHit[k].onHit!(this, h);
      this.hookDepth--;
    }
    if (killed) this.finishKill(enemy, h);
    return h;
  }

  killEnemy(enemy: number, cause: number, srcTag: string): void {
    if (!this.alive(enemy)) return;
    const h = this.acquireHit();
    const e = this.enemies;
    h.enemy = enemy; h.source = 'ability'; h.srcTag = srcTag; h.crit = false; h.element = null; h.projectile = NO_ENTITY;
    h.x = e.x[enemy]; h.y = e.y[enemy]; h.cause = cause; h.eventId = cause; h.killed = true; h.damage = Math.max(0, e.hp[enemy]);
    e.hp[enemy] = 0;
    e.flags[enemy] |= EnemyFlag.Dead; this.pendingEnemyFrees++;
    this.finishKill(enemy, h);
  }

  private finishKill(i: number, h: HitInfo): void {
    const e = this.enemies, run = this.run, t = this.tower;
    const bits = this.stateBits(i);
    const killId = this.events.pushRaw(Ev.Kill, run.tick, h.srcTag, i, e.gen[i], bits, e.x[i], e.y[i], h.eventId, this.victimData(i));
    if (this.events.longestKillChain > run.longestChain) run.longestChain = this.events.longestKillChain;
    this.waveKills++;
    // Scrap
    const w = run.wave;
    const first = run.firstClears[w] ? 1 : this.stats.get('economy.first_clear_mul');
    const bossMul = (e.flags[i] & (EnemyFlag.Boss | EnemyFlag.Elite)) ? this.stats.get('economy.boss_scrap_mul') : 1;   // WP2: Boss Scavenging
    const scrap = scrapPerKill(w, e.scrapMul[i], run.threatDial) * first * this.stats.get('economy.scrap_mul') * bossMul * Math.max(1, e.clumpCount[i]);
    this.addScrap(scrap);
    // Command Energy
    const f = e.flags[i];
    this.gainCE((f & EnemyFlag.Elite) ? 12 : 1);   // balance pass: ordinary kills 2 → 1 CE (docs/BALANCE.md)
    if (this.stats.hasAnomaly('hungry_core') && t.hp > 0) t.hp = Math.min(t.maxHp, t.hp + t.maxHp * 0.01);
    // Cores
    if (f & EnemyFlag.Boss) {
      this.emit(Ev.BossKilled, h.srcTag, i, w, e.x[i], e.y[i], killId);
      if (!run.coresDroppedByBoss[w]) {
        run.coresDroppedByBoss[w] = 1;
        const n = this.stats.hasAnomaly('tithe') ? 2 : 1;
        run.cores += n;
        this.emit(Ev.CoreDrop, 'boss', n, w, e.x[i], e.y[i], killId);
      }
    } else if ((f & EnemyFlag.Elite) && this.prng.chance(this.stats.get('economy.core_drop_chance'))) {
      run.cores += 1;
      this.emit(Ev.CoreDrop, 'elite', 1, w, e.x[i], e.y[i], killId);
    }
    if (this.hookDepth < HOOK_DEPTH_LIMIT) {
      const prevEvent = h.eventId;
      h.eventId = killId;          // children of the kill chain from the Kill event
      this.hookDepth++;
      for (let k = 0; k < this.hookKill.length; k++) this.hookKill[k].onKill!(this, h);
      this.hookDepth--;
      h.eventId = prevEvent;
    }
  }

  /**
   * Kill-event payload naming the victim: { kind, elite, boss, bossId? }. The objects are cached per
   * (kind, elite) / boss id so kills never allocate; consumers copy `data` (events.copy, the worker).
   */
  private victimData(i: number): NonNullable<SimEvent['data']> {
    const e = this.enemies, f = e.flags[i];
    const boss = (f & EnemyFlag.Boss) !== 0, elite = (f & EnemyFlag.Elite) !== 0;
    const key = (boss ? 1_000_000 + e.bossId[i] * 2 : e.kind[i] * 2) + (elite ? 1 : 0);
    let d = this.victimCache.get(key);
    if (!d) {
      const kind = KIND_LIST[e.kind[i]] ?? 'grunt';
      d = boss ? { kind, elite, boss, bossId: BOSS_LIST[e.bossId[i]] ?? 'breaker' } : { kind, elite, boss };
      Object.freeze(d);
      this.victimCache.set(key, d);
    }
    return d;
  }
  private victimCache = new Map<number, NonNullable<SimEvent['data']>>();

  addScrap(amount: number): void {
    if (!(amount > 0)) return;
    this.run.scrap += amount; this.scrapEarned += amount; this.waveScrap += amount;
  }

  private recordShare(tag: string, dmg: number): void {
    const sec = Math.floor(this.run.tick / TICK_RATE);
    const b = this.shareBuckets[sec % SHARE_BUCKETS];
    if (sec !== this.shareSecond) { this.shareSecond = sec; b.clear(); }
    b.set(tag, (b.get(tag) ?? 0) + dmg);
  }
  /** Damage share by srcTag over the last 10 s (allocates; UI only). */
  damageShare(): { bySource: Record<string, number>; total: number; windowSeconds: number } {
    const sec = Math.floor(this.run.tick / TICK_RATE);
    const bySource: Record<string, number> = {};
    let total = 0;
    for (let k = 0; k < SHARE_BUCKETS; k++) {
      const s = sec - k;
      if (s < 0 || s > this.shareSecond || this.shareSecond - s >= SHARE_BUCKETS) continue;
      for (const [tag, v] of this.shareBuckets[s % SHARE_BUCKETS]) { bySource[tag] = (bySource[tag] ?? 0) + v; total += v; }
    }
    return { bySource, total, windowSeconds: SHARE_BUCKETS };
  }

  // -------------------------------------------------------------------------
  // Statuses
  // -------------------------------------------------------------------------
  statusCap(status: StatusId): number {
    let cap = STATUS_CAPS[status];
    const ec = this.elemCap[status]; if (ec) cap = ec;   // WP2: attuned element tree caps
    if (this.stats.frameFlag('statuses_plus_one')) cap += 1;
    if (status === 'burn' || status === 'poison' || status === 'chill' || status === 'shock') cap += Math.floor(this.stats.get('status.stack_cap_bonus'));   // WP8: Monochrome reward
    // Prestige IV Overflow: caps +20% per rank (data/prestige.ts), rounded down, at least +1 per owned node.
    const overflow = this.stats.rank('prestige.overflow');
    if (overflow > 0) cap = Math.max(cap + 1, Math.floor(cap * (1 + 0.2 * overflow) + 1e-9));
    return cap;
  }

  applyStatus(enemy: number, status: StatusId, stacks: number, durationTicks: number, srcTag: string, cause: number, magnitude?: number): void {
    if (!this.alive(enemy) || stacks <= 0) return;
    const e = this.enemies;
    if (this.stats.frameFlag('statuses_plus_one') && status !== 'marked') stacks += 1;
    const cap = this.statusCap(status);
    const dur = Math.min(65535, Math.max(0, durationTicks | 0));
    let n = 0;
    switch (status) {
      case 'burn': n = e.burn[enemy] = Math.min(cap, e.burn[enemy] + stacks); if (dur > e.burnT[enemy]) e.burnT[enemy] = dur;
        e.burnDps[enemy] = Math.max(e.burnDps[enemy], magnitude ?? (e.burnDps[enemy] || this.defaultDotDps())); break;
      case 'poison': n = e.poison[enemy] = Math.min(cap, e.poison[enemy] + stacks); if (dur > e.poisonT[enemy]) e.poisonT[enemy] = dur;
        e.poisonDps[enemy] = Math.max(e.poisonDps[enemy], magnitude ?? (e.poisonDps[enemy] || this.defaultDotDps())); break;
      case 'chill': n = e.chill[enemy] = Math.min(cap, e.chill[enemy] + stacks); if (dur > e.chillT[enemy]) e.chillT[enemy] = dur; break;
      case 'shock': n = e.shock[enemy] = Math.min(cap, e.shock[enemy] + stacks); if (dur > e.shockT[enemy]) e.shockT[enemy] = dur; break;
      case 'bleed': n = e.bleed[enemy] = Math.min(cap, e.bleed[enemy] + stacks); if (dur > e.bleedT[enemy]) e.bleedT[enemy] = dur;
        e.bleedDps[enemy] = Math.max(e.bleedDps[enemy], magnitude ?? (e.bleedDps[enemy] || this.defaultDotDps())); break;
      case 'brittle': n = e.brittle[enemy] = Math.min(cap, e.brittle[enemy] + stacks); if (dur > e.brittleT[enemy]) e.brittleT[enemy] = dur; break;
      case 'marked': n = 1; if (dur > e.markedT[enemy]) e.markedT[enemy] = dur; break;
      case 'static': n = e.staticStacks[enemy] = Math.min(cap, e.staticStacks[enemy] + stacks); if (dur > e.staticT[enemy]) e.staticT[enemy] = dur; break;
    }
    const id = this.emitC(Ev.StatusApply, srcTag, enemy, n, STATUS_INDEX[status] | (this.stateBits(enemy) << 8), e.x[enemy], e.y[enemy], cause);
    if (status === 'burn') e.burnCause[enemy] = id;
    else if (status === 'poison') e.poisonCause[enemy] = id;
    else if (status === 'bleed') e.bleedCause[enemy] = id;
    if (this.hookDepth < HOOK_DEPTH_LIMIT) {
      this.hookDepth++;
      for (let k = 0; k < this.hookStatus.length; k++) this.hookStatus[k].onStatusApply!(this, enemy, status, n, srcTag, id);
      this.hookDepth--;
    }
  }
  /** DoT dps per stack when the applier passes no magnitude: 4% of a wave-weight-1 enemy's HP. */
  defaultDotDps(): number { return enemyHp(this.run.wave, 1, this.meta.ascension) * 0.04; }

  freeze(enemy: number, ticks: number, srcTag: string, cause: number): void {
    if (!this.alive(enemy)) return;
    const e = this.enemies;
    if (e.flags[enemy] & EnemyFlag.Immovable) return;
    const t = Math.min(65535, ticks | 0);
    if (t > e.frozenT[enemy]) e.frozenT[enemy] = t;
    this.emitC(Ev.StatusApply, srcTag, enemy, 1, STATUS_INDEX.frozen | (this.stateBits(enemy) << 8), e.x[enemy], e.y[enemy], cause);
  }

  // -------------------------------------------------------------------------
  // Forces
  // -------------------------------------------------------------------------
  knockback(enemy: number, dx: number, dy: number, force: number): void {
    if (!this.alive(enemy)) return;
    const e = this.enemies, f = e.flags[enemy];
    if (f & EnemyFlag.Immovable) return;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l <= 1e-6) return;
    const scale = (f & EnemyFlag.Boss) ? 0.15 : (f & EnemyFlag.Clump) ? 0.3 : (f & EnemyFlag.Elite) ? 0.5 : 1;
    const k = (force * scale) / l;
    e.x[enemy] += dx * k; e.y[enemy] += dy * k;
    this.clampToArena(enemy);
  }
  pull(enemy: number, towardX: number, towardY: number, force: number): void {
    if (!this.alive(enemy)) return;
    const e = this.enemies;
    if (e.flags[enemy] & EnemyFlag.Immovable) return;
    const dx = towardX - e.x[enemy], dy = towardY - e.y[enemy];
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l <= 1e-6) return;
    const step = Math.min(l, force * TICK_DT * ((e.flags[enemy] & EnemyFlag.Boss) ? 0.15 : 1));
    e.x[enemy] += (dx / l) * step; e.y[enemy] += (dy / l) * step;
  }
  private clampToArena(i: number): void {
    const e = this.enemies, lim = ARENA_RADIUS + 120;
    const d2 = e.x[i] * e.x[i] + e.y[i] * e.y[i];
    if (d2 > lim * lim) { const k = lim / Math.sqrt(d2); e.x[i] *= k; e.y[i] *= k; }
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------
  spawnProjectile(init: ProjInit): number {
    const p = this.projectiles;
    const i = allocProjectile(p, this.projGen++);
    if (i === NO_ENTITY) return NO_ENTITY;
    p.kind[i] = init.kind ?? 0; p.source[i] = init.source ?? 0;
    p.x[i] = init.x ?? 0; p.y[i] = init.y ?? 0; p.vx[i] = init.vx ?? 0; p.vy[i] = init.vy ?? 0;
    p.damage[i] = init.damage ?? 0; p.radius[i] = init.radius ?? 3; p.life[i] = Math.min(65535, init.life ?? 120);
    p.pierce[i] = Math.min(255, init.pierce ?? 0); p.bounces[i] = Math.min(255, init.bounces ?? 0);
    const tgt = init.target ?? NO_ENTITY;
    p.target[i] = tgt; p.targetGen[i] = tgt >= 0 && tgt < this.enemies.count ? this.enemies.gen[tgt] : 0;
    p.flags[i] = (init.flags ?? 0) & ~ProjFlag.Dead;
    p.element[i] = init.element ? (ELEMENT_ORDER as readonly string[]).indexOf(init.element) + 1 : 0;
    p.critChance[i] = init.critChance ?? 0; p.blast[i] = init.blast ?? 0; p.cause[i] = init.cause ?? -1;
    p.tag[i] = init.srcTag ? this.tagId(init.srcTag) : Math.min(p.source[i], 5);
    p.critMul[i] = init.critMul ?? 1.5; p.retention[i] = init.retention ?? 1; p.pierceSpeed[i] = init.pierceSpeed ?? 0;
    p.bounceRange[i] = init.bounceRange ?? 0; p.knock[i] = init.knock ?? 0; p.execBonus[i] = init.execBonus ?? 0;
    return i;
  }
  freeProjectile(i: number): void {
    const p = this.projectiles;
    if (i >= 0 && i < p.count && (p.flags[i] & ProjFlag.Dead) === 0) { poolFreeProjectile(p, i); this.pendingProjFrees++; }
  }

  spawnEnemy(kind: string, x: number, y: number, opts?: { hpScale?: number; elite?: readonly string[]; bossId?: string | null; cause?: number; eliteHpIncluded?: boolean }): number {
    const e = this.enemies;
    const gen = this.enemyGen++;
    const i = allocEnemy(e, gen);
    if (i === NO_ENTITY) return NO_ENTITY;
    const def = enemyDef(kind);
    const w = this.run.wave, A = this.meta.ascension, dial = this.run.threatDial;
    let hp: number;
    let radius = def.radius, speed = def.speed, armor = def.armor, shieldMul = def.shieldMul;
    let flags = flagBitsFor(def);
    if (kind === 'boss') {
      const bid = opts?.bossId ?? this.wave?.bossId ?? 'breaker';
      const b = bossDef(bid, w);
      hp = bossHp(w, b.hpMul, A, 0);
      radius = b.radius; speed = b.speed; armor = b.armor; shieldMul = b.shieldMul;
      e.bossId[i] = bossIndex(bid);
      flags |= EnemyFlag.Boss;
    } else {
      hp = enemyHp(w, def.hpMul, A, 0);
    }
    hp *= opts?.hpScale ?? 1;
    let eliteBits = 0;
    if (opts?.elite && opts.elite.length) {
      if (!opts.eliteHpIncluded) hp *= ELITE_HP_MUL;
      flags |= EnemyFlag.Elite;
      for (const m of opts.elite) { const b = ELITE_LIST.indexOf(m as never); if (b >= 0) eliteBits |= 1 << b; }
    }
    if (kind === 'clump') flags |= EnemyFlag.Clump;
    e.kind[i] = kindIndex(kind);
    e.x[i] = x; e.y[i] = y;
    e.hp[i] = hp; e.maxHp[i] = hp;
    e.shield[i] = e.maxShield[i] = hp * shieldMul;
    e.armor[i] = armor; e.radius[i] = radius;
    e.speed[i] = speed * (1 + THREAT_SPEED_PER_LEVEL * dial);
    e.angle[i] = atan2(y, x);
    e.flags[i] = flags; e.eliteMods[i] = eliteBits;
    e.spawnTick[i] = this.run.tick; e.lastHitTick[i] = -1;
    e.scrapMul[i] = def.scrapMul; e.contact[i] = def.contactDamage;
    e.attackT[i] = TICK_RATE;
    e.spawnEv[i] = this.emitC(Ev.Spawn, kind, i, gen, 0, x, y, opts?.cause ?? -1);
    return i;
  }

  /** Generation serial of the most recent spawn (0 before any): gens only grow, so `gen > mark` = spawned since. */
  lastSpawnGen(): number { return this.enemyGen - 1; }

  despawnEnemy(enemy: number): void {
    if (!this.alive(enemy)) return;
    freeEnemy(this.enemies, enemy);
    this.pendingEnemyFrees++;
  }

  explode(x: number, y: number, radius: number, damage: number, opts: { source: HitInfo['source']; srcTag: string; element?: ElementId | null; cause: number; falloff?: boolean; maxHpCap?: number }): void {
    const id = this.emit(Ev.Explosion, opts.srcTag, radius, damage, x, y, opts.cause);
    const buf = this.explodeScratch.push();
    const n = this.spatial.queryRadius(x, y, radius, buf);
    const e = this.enemies, falloff = opts.falloff !== false;
    for (let k = 0; k < n; k++) {
      const i = buf[k];
      if (!this.alive(i)) continue;
      if (e.flags[i] & (EnemyFlag.Phased | EnemyFlag.Burrowed)) continue;   // intangible (design: Phase / Burrow)
      let amt = damage;
      if (falloff) { const dx = e.x[i] - x, dy = e.y[i] - y; const dist = Math.sqrt(dx * dx + dy * dy); amt *= 1 - 0.5 * Math.min(1, dist / Math.max(1, radius)); }
      if (opts.maxHpCap !== undefined) { const c = opts.maxHpCap * e.maxHp[i]; if (amt > c) amt = c; }   // per-target cap (Flashpoint)
      this.damage(i, amt, { source: opts.source, srcTag: opts.srcTag, element: opts.element ?? null, cause: id, x, y });
    }
    this.explodeScratch.pop();
  }

  addHazard(h: Hazard): void {
    if (this.hazards.length >= MAX_HAZARDS) this.hazards.shift();
    this.hazards.push(h);
  }

  // -------------------------------------------------------------------------
  // Tower
  // -------------------------------------------------------------------------
  damageTower(amount: number, enemy: number, cause: number, source: 'hazard' | 'self' | 'enemy' = 'enemy'): void {
    const t = this.tower;
    if (t.hp <= 0 || !(amount > 0)) return;
    if (t.invulnT > 0) return;
    const armor = this.stats.get('bastion.armor') * this.towerArmorMul;   // WP2: Reactive Armor
    const res = Math.min(0.9, Math.max(0, this.stats.get('bastion.resistance')));
    let dmg = amount * (armor > 0 ? 100 / (100 + armor) : 1) * (1 - res);
    const total = dmg;
    if (t.barrier > 0) {
      const a = Math.min(t.barrier, dmg); t.barrier -= a; dmg -= a;
      if (t.barrier <= 0) this.emit(Ev.BarrierBreak, 'bastion', enemy, 0, 0, 0, cause);
    }
    if (dmg > 0 && t.shield > 0) { const a = Math.min(t.shield, dmg); t.shield -= a; dmg -= a; }
    if (dmg > 0 && t.tempHp > 0) { const a = Math.min(t.tempHp, dmg); t.tempHp -= a; dmg -= a; }
    t.hp -= dmg;
    this.lastTowerDamageTick = this.run.tick;
    const live = enemy >= 0 && enemy < this.enemies.count;
    const src = live ? KIND_LIST[this.enemies.kind[enemy]] ?? 'enemy' : 'enemy';
    // UX review S3: damage taken this attempt by source, and who dealt the blow that took HP to 0
    const by = !live ? source : this.enemies.bossId[enemy] >= 0 ? 'boss' : src;
    const taken = this.run.attemptDamageTaken;
    taken[by] = (taken[by] ?? 0) + total;
    const id = this.emit(Ev.TowerHit, src, enemy, total, 0, 0, cause);
    if (this.hookDepth < HOOK_DEPTH_LIMIT) {
      this.hookDepth++;
      for (let k = 0; k < this.hookTower.length; k++) this.hookTower[k].onTowerHit!(this, total, enemy, id);
      this.hookDepth--;
    }
    if (t.hp <= 0) {
      if (!t.secondCoreUsed && this.stats.has('bastion.second_core')) {
        t.hp = 1; t.invulnT = 3 * TICK_RATE; t.secondCoreUsed = true;
        this.emit(Ev.SecondCore, 'bastion', 0, 0, 0, 0, id);
      } else { t.hp = 0; this.noteKiller(enemy, live, src, source); }
    }
  }
  /**
   * TowerDeath payload (UX review S3): `killer` = enemy kind, boss id (with `boss: true` and the boss's
   * `bossPhase`), or 'hazard' / 'self' / 'enemy'. Set by the hit that took HP to 0; systems/tower.ts emits it.
   */
  towerKiller: NonNullable<SimEvent['data']> | null = null;
  private noteKiller(enemy: number, live: boolean, kind: string, source: string): void {
    const e = this.enemies;
    if (!live) { this.towerKiller = { killer: source }; return; }
    const bi = e.bossId[enemy];
    if (bi < 0) { this.towerKiller = { killer: kind }; return; }
    // boss clones / adds carry the boss id; the phase is the true boss's (the one flagged Boss) when alive
    let phase = e.bossPhase[enemy];
    for (let i = 0; i < e.count; i++) if ((e.flags[i] & (EnemyFlag.Boss | EnemyFlag.Dead)) === EnemyFlag.Boss) { phase = e.bossPhase[i]; break; }
    this.towerKiller = { killer: BOSS_LIST[bi] ?? 'boss', boss: true, bossPhase: phase };
  }
  healTower(amount: number, cause: number): void {
    const t = this.tower;
    if (t.hp <= 0 || !(amount > 0)) return;
    if (this.stats.hasAnomaly('hungry_core')) return;   // WP8: Hungry Core stops every other heal (kills heal in finishKill)
    const before = t.hp;
    t.hp = Math.min(t.maxHp, t.hp + amount);
    if (before + amount > t.maxHp) this.healOverflow += before + amount - t.maxHp;   // WP2: Fortress Keep
    if (t.hp > before) this.emit(Ev.Heal, 'bastion', 0, t.hp - before, 0, 0, cause);
  }
  healEnemy(enemy: number, amount: number, srcTag: string, cause: number, silent = false): number {
    const e = this.enemies;
    if (!this.alive(enemy) || !(amount > 0)) return 0;
    const room = e.maxHp[enemy] - e.hp[enemy];
    const amt = amount < room ? amount : room;
    if (amt <= 0) return 0;
    e.hp[enemy] += amt;
    if (!silent) this.emit(Ev.Heal, srcTag, enemy, amt, e.x[enemy], e.y[enemy], cause);
    return amt;
  }
  gainCE(amount: number): void {
    const t = this.tower;
    if (amount > 0) amount *= 1 + this.stats.get('reactor.energy_recycling');
    t.ce = Math.max(0, Math.min(t.ceCap, t.ce + amount));
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  /** Rebuild the spatial hash (called once per tick after enemies move). */
  rebuildSpatial(): void { this.spatial.rebuild(); }

  /** Compact pools and repair cached indices. Called at the very end of every tick. */
  endTick(): void {
    if (this.pendingEnemyFrees > 0) {
      this.pendingEnemyFrees = 0;
      const oldCount = this.enemies.count;
      const remap = this.remapE;
      if (compactEnemies(this.enemies, remap) > 0) {
        const p = this.projectiles;
        for (let j = 0; j < p.count; j++) {
          const tg = p.target[j];
          if (tg >= 0) p.target[j] = tg < oldCount ? remap[tg] : NO_ENTITY;
          const lh = p.lastHit[j];
          if (lh >= 0) p.lastHit[j] = lh < oldCount ? remap[lh] : NO_ENTITY;
        }
        const t = this.tower;
        if (t.designated >= 0) t.designated = t.designated < oldCount ? remap[t.designated] : NO_ENTITY;
        if (t.designated2 >= 0) t.designated2 = t.designated2 < oldCount ? remap[t.designated2] : NO_ENTITY;
        for (const s of this.systems) s.onCompact?.(this, remap, oldCount);
      }
    }
    if (this.pendingProjFrees > 0) {
      this.pendingProjFrees = 0;
      compactProjectiles(this.projectiles, this.remapP);
    }
  }

  /** Remove every enemy, projectile and hazard (attempt restart / wave abort). */
  clearCombat(): void {
    this.enemies.count = 0; this.projectiles.count = 0; this.hazards.length = 0;
    this.pendingEnemyFrees = 0; this.pendingProjFrees = 0;
    this.tower.designated = NO_ENTITY; this.tower.designated2 = NO_ENTITY;
    this.pendingCommands.length = 0;   // WP9: Directive commands never outlive their attempt
    this.spatial.rebuild();
  }
}

/** WP3: zeroed shared hardpoint geometry buffers (sizes from the entity budgets in core/types.ts). */
function newSharedGeometry(): SharedGeometry {
  return {
    bladeCount: 0, bladeAngles: new Float32Array(MAX_BLADES), bladeInner: new Float32Array(MAX_BLADES), bladeLens: new Float32Array(MAX_BLADES), bladeSpeedMul: 1,
    laserNodeCount: 0, laserNodes: new Float32Array(MAX_LASER_NODES * 2 + 16), laserBeamCount: 0, laserBeams: new Float32Array(96 * 4),
    laserBeamWidth: 0, laserElement: 0, laserInterior: 0, laserWidthMul: 1, laserPulseRateMul: 1,
    wellCount: 0, wells: new Float32Array(MAX_WELLS * 4), collapseCount: 0, collapses: new Float32Array(MAX_WELLS * 4),
    droneCount: 0, drones: new Float32Array(MAX_DRONES * 3), droneBoost: new Float32Array(MAX_DRONES),
    jammerTick: -1, jammerCount: 0, jammers: new Float32Array(64 * 3),
  };
}
