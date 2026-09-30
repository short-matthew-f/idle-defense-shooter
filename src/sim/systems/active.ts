/**
 * Active edge (docs/ACTIVE.md): three small things an attentive player can do that an idle one does not need.
 * Numbers: data/active.ts (ACTIVE). Pillars: active play is an edge, never a toll; absence is never punished.
 *
 *  Tap-to-assist   `tap_assist {x, y}` → the next tick, the live enemy nearest (x, y) (reach max(assist.reach,
 *                  radius + assist.pad)) takes a free bonus shot from the tower: damageMul × ballistics.damage, crit
 *                  at ballistics.crit_chance + critBonus (this system's own PRNG). One per `cooldown` s: taps inside
 *                  the cooldown do nothing (no queue, no error). Combat only; not in the Blackout Trial.
 *                  Ev.Assist (src 'assist') is the cause of the Hit (srcTag 'assist', source 'ability').
 *  Salvage         from wave `fromWave`, a kill drops a crate with chance `chance` / `eliteChance` / `bossChance`
 *                  (own PRNG stream, reseeded per attempt), worth valueMin..valueMax × the kill's Scrap (World.killScrap:
 *                  first-clear ×3, economy.scrap_mul, Boss Scavenging and clump merges already included). At most
 *                  `maxLive` crates; each drifts from the kill to the tower in `lifeSeconds`. `collect_salvage {x, y}`
 *                  takes the crate nearest (x, y) within `tapReach`: value × chain multiplier, where collects within
 *                  `chainWindow` s of the previous one add a link (1 + chainStep × (links − 1), max chainMax); the chain
 *                  lapses after the window. A crate that reaches the tower is taken by the passive collector at
 *                  `passiveValue` × value (no chain; it does not break one). Crates keep drifting between waves; on
 *                  death the crates in flight pay passively. Scrap goes through World.addScrap (the same path as kill
 *                  Scrap: run.scrap, scrapEarned, waveScrap → Patrol rate and the wave's ScrapGain).
 *                  Ev.SalvageDrop (cause = the Kill) → Ev.SalvageCollect (src 'salvage.tap' | 'salvage.passive').
 *  Overcharge      unlocked when max(meta.deepestEver, run.deepestCleared) ≥ unlockWave. A 0..meterMax meter fills
 *                  from landed primary hits (meterPerHit, at most shotCapPerSecond per second: a token bucket) and
 *                  assist hits (meterPerTap); it never decays and empties on death (like CE). It is NOT Command
 *                  Energy. `overcharge charge` (meter full, combat) starts a hold; `release` fires a beam along the
 *                  designated enemy (else the nearest, else the aim): every enemy within beamHalfWidth + radius of the
 *                  line takes perfectMul primary shots and staggerSeconds of stagger when the hold is inside
 *                  [perfectFrom, perfectTo] s, else weakMul and weakStaggerSeconds (never a fail state). Hold time is
 *                  counted in real seconds (ticks ÷ speed multiplier). Holding past maxHoldSeconds releases weak;
 *                  `cancel` (or leaving combat) aborts and keeps the meter. Ev.Overcharge is the cause of the Hits.
 *
 * Commands are recorded in onCommand and resolved in update() (after the spatial hash is rebuilt).
 */
import type { System, InstanceWriter, HitInfo } from '../core/system';
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { ActiveUi, Command } from '../core/types';
import { ARENA_RADIUS, EnemyFlag, Ev, INST_FLAG_SCALE, InstFlag, NO_ENTITY, SALVAGE_MARK, Shape, TICK_RATE, TOWER_RADIUS } from '../core/types';
import { ACTIVE } from '../data/active';
import { Prng } from '../math/prng';
import { atan2, cos, sin } from '../math/lut';

const A = ACTIVE.assist, S = ACTIVE.salvage, O = ACTIVE.overcharge;
const MAX_CRATES = S.maxLive;
const ASSIST_CD_TICKS = Math.round(A.cooldown * TICK_RATE);
const CRATE_LIFE = Math.round(S.lifeSeconds * TICK_RATE);
const CHAIN_TICKS = S.chainWindow * TICK_RATE;
const BARREL = TOWER_RADIUS * 1.45;
const INTANGIBLE = EnemyFlag.Phased | EnemyFlag.Burrowed | EnemyFlag.Dead | EnemyFlag.Ally;
/** Tap commands remembered per tick (a burst of taps in one frame: the first one that finds something wins). */
const MAX_TAPS = 4;

/** Overcharge unlocked (progression feature `overcharge`): deepest wave ever or this run ≥ ACTIVE.overcharge.unlockWave. */
export function overchargeUnlocked(w: World): boolean {
  return Math.max(w.meta.deepestEver | 0, w.run.deepestCleared | 0) >= O.unlockWave;
}
/** Chain multiplier for a collect that makes `links` links. */
export function chainMultiplier(links: number): number {
  return links <= 1 ? 1 : Math.min(S.chainMax, 1 + S.chainStep * (links - 1));
}
/** Overcharge volley multiplier (primary shots per enemy) for a hold of `holdSeconds`. */
export function overchargePower(holdSeconds: number): { perfect: boolean; mul: number } {
  const perfect = holdSeconds >= O.perfectFrom && holdSeconds <= O.perfectTo;
  return { perfect, mul: perfect ? O.perfectMul : O.weakMul };
}

export class ActiveSystem implements System {
  readonly id = 'active';
  /** Own PRNG stream (salvage rolls, assist crits): never perturbs the combat stream. Reseeded per attempt. */
  private readonly rng = new Prng(1);
  private scratch = new Int32Array(4);

  // assist
  private assistCd = 0;
  private tapN = 0; private readonly tapX = new Float64Array(MAX_TAPS); private readonly tapY = new Float64Array(MAX_TAPS);
  private tracerTick = -1_000_000; private tracerX = 0; private tracerY = 0;

  // salvage crates (fixed slots, iterated ascending)
  readonly crateLive = new Uint8Array(MAX_CRATES);
  readonly crateX = new Float64Array(MAX_CRATES); readonly crateY = new Float64Array(MAX_CRATES);
  private readonly crateVx = new Float64Array(MAX_CRATES); private readonly crateVy = new Float64Array(MAX_CRATES);
  readonly crateValue = new Float64Array(MAX_CRATES);
  readonly crateLife = new Int32Array(MAX_CRATES);
  /** Tick each crate dropped (the sim-cli active policy reacts after a human delay). */
  readonly crateBorn = new Int32Array(MAX_CRATES);
  private readonly crateEv = new Int32Array(MAX_CRATES); private readonly crateKind = new Uint8Array(MAX_CRATES);
  private crateSeed = -1;
  private collectN = 0; private readonly collectX = new Float64Array(MAX_TAPS); private readonly collectY = new Float64Array(MAX_TAPS);
  /** Chain: links so far and real-time ticks left in its window. */
  chain = 0; private chainLeft = 0;

  // overcharge
  meter = 0;
  private bucket: number = O.shotCapPerSecond;
  charging = false;
  /** Hold so far in real-time ticks (sim ticks ÷ speed multiplier). */
  hold = 0;
  private release = false; private cancel = false;
  private beamTick = -1_000_000; private beamAngle = 0; private beamPerfect = false;

  init(w: World): void { this.reset(w); }
  rebuild(): void { /* no derived stats: ACTIVE is a constant table */ }
  onAttemptStart(w: World): void {
    // crates still in flight from the previous attempt of the same run pay passively (absence is never punished)
    if (this.crateSeed === w.run.prestigeSeed) this.flushCrates(w);
    this.reset(w);
  }

  private reset(w: World): void {
    this.rng.reseed((Math.imul(w.run.prestigeSeed | 0, 0x2545f491) ^ Math.imul(w.run.attempts | 0, 0x9e3779b1) ^ 0x5a17a6e) >>> 0);
    this.assistCd = 0; this.tapN = 0; this.collectN = 0;
    this.crateLive.fill(0); this.chain = 0; this.chainLeft = 0;
    this.meter = 0; this.bucket = O.shotCapPerSecond; this.charging = false; this.hold = 0; this.release = false; this.cancel = false;
    this.crateSeed = w.run.prestigeSeed;
  }

  // -------------------------------------------------------------------------
  // Commands (recorded here, resolved in update)
  // -------------------------------------------------------------------------
  onCommand(w: World, cmd: Command): boolean {
    switch (cmd.type) {
      case 'tap_assist':
        if (this.tapN < MAX_TAPS) { this.tapX[this.tapN] = cmd.x; this.tapY[this.tapN] = cmd.y; this.tapN++; }
        return true;
      case 'collect_salvage':
        if (this.collectN < MAX_TAPS) { this.collectX[this.collectN] = cmd.x; this.collectY[this.collectN] = cmd.y; this.collectN++; }
        return true;
      case 'overcharge':
        if (cmd.action === 'charge') {
          if (!this.charging && this.canCharge(w)) { this.charging = true; this.hold = 0; this.release = false; this.cancel = false; }
        } else if (cmd.action === 'release') { if (this.charging) this.release = true; }
        else if (this.charging) this.cancel = true;
        return true;
      default: return false;
    }
  }

  private combat(w: World): boolean { return w.run.phase === 'combat' && w.tower.hp > 0; }
  canCharge(w: World): boolean { return this.combat(w) && w.trial !== 'blackout' && overchargeUnlocked(w) && this.meter >= O.meterMax - 1e-9; }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------
  update(w: World): void {
    const combat = this.combat(w);
    const speed = Math.max(1, w.run.speedMultiplier | 0);
    if (this.assistCd > 0) this.assistCd--;
    if (combat && this.bucket < O.shotCapPerSecond) this.bucket = Math.min(O.shotCapPerSecond, this.bucket + O.shotCapPerSecond / TICK_RATE);
    // taps
    for (let k = 0; k < this.collectN; k++) this.collect(w, this.collectX[k], this.collectY[k]);
    this.collectN = 0;
    if (this.tapN > 0) {
      if (combat && this.assistCd === 0 && w.trial !== 'blackout') {
        for (let k = 0; k < this.tapN; k++) if (this.assist(w, this.tapX[k], this.tapY[k])) break;
      }
      this.tapN = 0;
    }
    // salvage drift and the chain window
    if (w.run.phase === 'dead') this.flushCrates(w);
    else this.driftCrates(w);
    if (this.chain > 0) { this.chainLeft -= 1 / speed; if (this.chainLeft <= 0) { this.chain = 0; this.chainLeft = 0; } }
    // overcharge
    if (this.charging) {
      if (!combat || this.cancel) { this.charging = false; this.hold = 0; this.cancel = false; this.release = false; }
      else {
        this.hold += 1 / speed;
        if (this.release || this.hold >= O.maxHoldSeconds * TICK_RATE) this.fireOvercharge(w);
      }
    }
    if (!overchargeUnlocked(w)) this.meter = 0;
  }

  /** Nearest live, tangible hostile within max(reach, radius + pad) of (x, y), or NO_ENTITY (ties: lower index). */
  private enemyNear(w: World, x: number, y: number): number {
    const e = w.enemies;
    let best = NO_ENTITY, bestD2 = Infinity;
    for (let i = 0; i < e.count; i++) {
      if (e.flags[i] & INTANGIBLE) continue;
      const dx = e.x[i] - x, dy = e.y[i] - y, d2 = dx * dx + dy * dy;
      const reach = Math.max(A.reach, e.radius[i] + A.pad);
      if (d2 <= reach * reach && d2 < bestD2) { best = i; bestD2 = d2; }
    }
    return best;
  }

  private assist(w: World, x: number, y: number): boolean {
    const i = this.enemyNear(w, x, y);
    if (i < 0) return false;
    const e = w.enemies, s = w.stats;
    const crit = this.rng.chance(Math.max(0, s.get('ballistics.crit_chance')) + A.critBonus);
    const dmg = A.damageMul * s.get('ballistics.damage') * (crit ? Math.max(1, s.get('ballistics.crit_damage')) : 1);
    const ex = e.x[i], ey = e.y[i];
    const cause = w.emit(Ev.Assist, 'assist', i, dmg, ex, ey, -1);
    const h = w.damage(i, dmg, { source: 'ability', srcTag: 'assist', crit, cause, x: ex, y: ey });
    if (h.damage > 0) this.gainMeter(w, A.meterPerTap);
    this.assistCd = ASSIST_CD_TICKS;
    this.tracerTick = w.tick; this.tracerX = ex; this.tracerY = ey;
    return true;
  }

  // -------------------------------------------------------------------------
  // Salvage
  // -------------------------------------------------------------------------
  onKill(w: World, hit: HitInfo): void {
    const run = w.run;
    if (run.wave < S.fromWave || run.phase !== 'combat') return;
    const e = w.enemies, i = hit.enemy;
    if (i < 0 || i >= e.count || (e.flags[i] & EnemyFlag.Ally)) return;
    const boss = (e.flags[i] & EnemyFlag.Boss) !== 0, elite = (e.flags[i] & EnemyFlag.Elite) !== 0;
    const p = boss ? S.bossChance : elite ? S.eliteChance : S.chance;
    if (!this.rng.chance(p)) return;
    const base = (w as WorldImpl).killScrap[i];
    if (!(base > 0) || this.liveCrates() >= MAX_CRATES) return;   // capped: the drop is skipped (no roll spent on value)
    this.addCrate(w, e.x[i], e.y[i], base * this.rng.range(S.valueMin, S.valueMax), boss ? 2 : elite ? 1 : 0, hit.eventId);
  }

  liveCrates(): number { let n = 0; for (let k = 0; k < MAX_CRATES; k++) n += this.crateLive[k]; return n; }

  /**
   * Drop a crate worth `value` Scrap at (x, y) (clamped into the arena): emits Ev.SalvageDrop with `cause`. Returns the
   * slot, or -1 at the cap. Kills call it; tests and the dev harness may too.
   */
  addCrate(w: World, x: number, y: number, value: number, kind: 0 | 1 | 2 = 0, cause = -1): number {
    let slot = -1;
    for (let k = 0; k < MAX_CRATES; k++) if (!this.crateLive[k]) { slot = k; break; }
    if (slot < 0) return -1;
    const d0 = Math.sqrt(x * x + y * y), lim = ARENA_RADIUS - 12;
    if (d0 > lim) { x *= lim / d0; y *= lim / d0; }
    const ev = w.emit(Ev.SalvageDrop, 'salvage', value, kind, x, y, cause);
    const k = slot, tick = w.tick;
    const d = Math.sqrt(x * x + y * y);
    const travel = Math.max(0, d - (TOWER_RADIUS + 6));
    const v = d > 1e-6 ? travel / CRATE_LIFE / d : 0;
    this.crateLive[k] = 1; this.crateX[k] = x; this.crateY[k] = y; this.crateVx[k] = -x * v; this.crateVy[k] = -y * v;
    this.crateValue[k] = value; this.crateLife[k] = CRATE_LIFE; this.crateEv[k] = ev; this.crateKind[k] = kind; this.crateBorn[k] = tick;
    return slot;
  }

  private driftCrates(w: World): void {
    for (let k = 0; k < MAX_CRATES; k++) {
      if (!this.crateLive[k]) continue;
      this.crateX[k] += this.crateVx[k]; this.crateY[k] += this.crateVy[k];
      if (--this.crateLife[k] <= 0) this.payCrate(w, k, S.passiveValue, 'salvage.passive', 0);
    }
  }

  private flushCrates(w: World): void {
    for (let k = 0; k < MAX_CRATES; k++) if (this.crateLive[k]) this.payCrate(w, k, S.passiveValue, 'salvage.passive', 0);
  }

  private collect(w: World, x: number, y: number): void {
    let best = -1, bestD2 = S.tapReach * S.tapReach;
    for (let k = 0; k < MAX_CRATES; k++) {
      if (!this.crateLive[k]) continue;
      const dx = this.crateX[k] - x, dy = this.crateY[k] - y, d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) { best = k; bestD2 = d2; }
    }
    if (best < 0) return;
    const links = this.chain > 0 ? this.chain + 1 : 1;
    this.chain = links;
    this.chainLeft = CHAIN_TICKS;
    this.payCrate(w, best, chainMultiplier(links), 'salvage.tap', links);
  }

  private payCrate(w: World, k: number, mul: number, src: string, links: number): void {
    const amount = this.crateValue[k] * mul;
    this.crateLive[k] = 0;
    (w as WorldImpl).addScrap(amount);
    w.emit(Ev.SalvageCollect, src, amount, links, this.crateX[k], this.crateY[k], this.crateEv[k]);
  }

  // -------------------------------------------------------------------------
  // Overcharge
  // -------------------------------------------------------------------------
  onHit(w: World, hit: HitInfo): void {
    if (hit.srcTag !== 'ballistics' || !(hit.damage > 0) || this.bucket <= 0 || this.meter >= O.meterMax) return;
    if (!overchargeUnlocked(w)) return;
    const g = Math.min(O.meterPerHit, this.bucket);
    this.bucket -= g;
    this.gainMeter(w, g);
  }

  private gainMeter(w: World, amount: number): void {
    if (!overchargeUnlocked(w) || this.charging) return;
    this.meter = Math.min(O.meterMax, this.meter + amount);
  }

  private fireOvercharge(w: World): void {
    const seconds = this.hold / TICK_RATE;
    const { perfect, mul } = overchargePower(seconds);
    this.charging = false; this.release = false; this.hold = 0; this.meter = 0;
    const e = w.enemies, t = w.tower, s = w.stats;
    // direction: the designated enemy, else the nearest to the tower, else the turret's aim
    let tgt = t.designated >= 0 && w.alive(t.designated) && e.gen[t.designated] === t.designatedGen ? t.designated : NO_ENTITY;
    if (tgt < 0) tgt = w.nearestExcluding(0, 0, ARENA_RADIUS * 2, this.scratch, 0);
    const ang = tgt >= 0 ? atan2(e.y[tgt], e.x[tgt]) : t.aimAngle;
    const c = cos(ang), sn = sin(ang);
    const dmg = mul * s.get('ballistics.damage');
    const cause = w.emit(Ev.Overcharge, 'overcharge', perfect ? 1 : 0, dmg, c * O.beamLength, sn * O.beamLength, -1);
    const stag = Math.round((perfect ? O.staggerSeconds : O.weakStaggerSeconds) * TICK_RATE);
    for (let i = 0; i < e.count; i++) {
      if (e.flags[i] & INTANGIBLE) continue;
      const along = e.x[i] * c + e.y[i] * sn;
      if (along < 0 || along > O.beamLength + e.radius[i]) continue;
      const off = Math.abs(e.y[i] * c - e.x[i] * sn);
      if (off > O.beamHalfWidth + e.radius[i]) continue;
      if (stag > e.staggerT[i]) e.staggerT[i] = Math.min(65535, stag);
      w.damage(i, dmg, { source: 'ability', srcTag: 'overcharge', cause });
    }
    this.beamTick = w.tick; this.beamAngle = ang; this.beamPerfect = perfect;
  }

  // -------------------------------------------------------------------------
  // UI / render
  // -------------------------------------------------------------------------
  uiState(w: World): ActiveUi {
    return {
      assistCooldown: this.assistCd / TICK_RATE, assistCooldownMax: A.cooldown,
      crates: this.liveCrates(), chain: this.chain, chainMul: chainMultiplier(this.chain > 0 ? this.chain + 1 : 1),
      overcharge: {
        unlocked: overchargeUnlocked(w), meter: this.meter, meterMax: O.meterMax, ready: this.canCharge(w),
        charging: this.charging, hold: this.hold / TICK_RATE, perfectFrom: O.perfectFrom, perfectTo: O.perfectTo, maxHold: O.maxHoldSeconds,
      },
    };
  }

  render(w: World, out: InstanceWriter): void {
    const now = w.tick;
    // salvage crates: soft halo (player fx, layer 2), a diamond on the UI layer tagged SALVAGE_MARK, a fuse ring
    for (let k = 0; k < MAX_CRATES; k++) {
      if (!this.crateLive[k]) continue;
      const x = this.crateX[k], y = this.crateY[k];
      const big = this.crateKind[k] === 2 ? 1.5 : this.crateKind[k] === 1 ? 1.2 : 1;
      const pulse = 1 + 0.1 * sin((now + k * 17) * 0.13);   // ~1.2 Hz, well under the 3 Hz flash rule
      const left = this.crateLife[k] / CRATE_LIFE;
      out.push(x, y, 17 * big * pulse, 0, Shape.Circle, 1, 0.78, 0.3, 0.42, 2 + INST_FLAG_SCALE * InstFlag.Soft);
      out.push(x, y, 7.5 * big, now * 0.04, Shape.Diamond, 1, 0.86, 0.42, 1, 7, 0, SALVAGE_MARK);
      out.push(x, y, 11 * big, 0, Shape.Ring, 1, 0.9, 0.55, 0.35 + 0.5 * left, 7, 0.1, 0);
    }
    // assist tracer (barrel → target), fading
    const ta = now - this.tracerTick;
    if (ta >= 0 && ta < A.tracerTicks) {
      const a = atan2(this.tracerY, this.tracerX), f = 1 - ta / A.tracerTicks;
      out.push(cos(a) * BARREL, sin(a) * BARREL, 2.4 + 2.2 * f, 0, Shape.Line, 1, 0.95, 0.7, 0.9 * f, 2, this.tracerX, this.tracerY);
    }
    // overcharge: meter pips around the tower, then the charge ring closing on the target ring
    if (overchargeUnlocked(w)) {
      const R = TOWER_RADIUS + 13, n = 12, lit = Math.floor((this.meter / O.meterMax) * n + 1e-9);
      const full = lit >= n;
      for (let j = 0; j < n; j++) {
        const a = (j / n) * 6.283185307179586 - 1.5707963267948966;
        const on = j < lit;
        out.push(cos(a) * R, sin(a) * R, on ? 2.2 : 1.5, 0, Shape.Circle, full ? 1 : 0.45, full ? 0.8 : 0.85, full ? 0.3 : 1, on ? 0.95 : 0.25, 2);
      }
      if (full && !this.charging) out.push(0, 0, R + 4 + 1.5 * sin(now * 0.1), 0, Shape.Ring, 1, 0.8, 0.3, 0.55, 2, 0.06);
      if (this.charging) {
        const h = this.hold / TICK_RATE;
        const target = TOWER_RADIUS + 44;
        const k = O.chargeSeconds > 0 ? h / O.chargeSeconds : 1;
        const inWin = h >= O.perfectFrom && h <= O.perfectTo;
        // target band (the perfect window), then the growing charge ring
        const r0 = TOWER_RADIUS + 44 * (O.perfectFrom / O.chargeSeconds), r1 = TOWER_RADIUS + 44 * (O.perfectTo / O.chargeSeconds);
        out.push(0, 0, (r0 + r1) / 2, 0, Shape.Ring, 1, 0.85, 0.35, inWin ? 0.9 : 0.4, 7, Math.min(0.5, (r1 - r0) / (r0 + r1)));
        out.push(0, 0, target, 0, Shape.Ring, 1, 1, 1, 0.5, 7, 0.03);
        const r = TOWER_RADIUS + 44 * Math.min(k, O.maxHoldSeconds / O.chargeSeconds);
        out.push(0, 0, r, 0, Shape.Ring, inWin ? 1 : 0.55, inWin ? 0.95 : 0.85, inWin ? 0.6 : 1, 0.95, 7, 0.07);
      }
    }
    // overcharge beam
    const ba = now - this.beamTick;
    if (ba >= 0 && ba < O.beamTicks) {
      const f = 1 - ba / O.beamTicks, c = cos(this.beamAngle), s = sin(this.beamAngle);
      const w0 = this.beamPerfect ? O.beamHalfWidth : O.beamHalfWidth * 0.6;
      out.push(c * BARREL, s * BARREL, w0 * (0.4 + 0.6 * f), 0, Shape.Line, 1, this.beamPerfect ? 0.85 : 0.7, this.beamPerfect ? 0.4 : 0.9, 0.3 * f, 2, c * O.beamLength, s * O.beamLength);
      out.push(c * BARREL, s * BARREL, 3 * f + 1, 0, Shape.Line, 1, 1, 0.9, 0.9 * f, 2, c * O.beamLength, s * O.beamLength);
    }
  }

}

/** The registered ActiveSystem, or null (sim-cli policy, tests, ui-state). */
export function findActive(w: World): ActiveSystem | null {
  for (const s of (w as WorldImpl).systems) if (s instanceof ActiveSystem) return s;
  return null;
}

/** UiState.active (undefined when the system is not registered). */
export function activeUi(w: WorldImpl): ActiveUi | undefined {
  return findActive(w)?.uiState(w);
}
