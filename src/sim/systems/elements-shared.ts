/**
 * WP2 shared helpers for the elements and fusions systems (a library, not a System: both systems
 * own their own instances, so no state is shared between systems or between Sims).
 *
 *  - QueryStack: depth-stacked scratch buffers for `world.queryRadius`. Hooks re-enter (an arc kills,
 *    the kill spreads Burn, the Burn erupts a Flashpoint...), so a loop that calls World methods while
 *    iterating query results must hold its own buffer: push() before the query, pop() after the loop.
 *  - ArcEngine: lightning arcs. A chain starts at a struck enemy (or a point) and jumps to up to N
 *    enemies within `lightning.arc_range` of the previous link, never revisiting. Each link is a
 *    `world.damage` with srcTag 'lightning' whose cause is the previous link's Hit event, so the kill
 *    chain reads "the gun shot the enemy, which caused the lightning to jump to ...".
 *    Damage per link = base × 0.9^(jumps so far) (ARC_DECAY; Cold Circuit jumps do not decay).
 *    Target preference: Arc Anchor (bosses/elites, Storm capstone) → chilled (Superconductivity) → nearest.
 *    Per-link riders: Static Charge (applies 'static'), Forked Current (extra strike from the same
 *    link), Superconductivity / Cold Circuit bonuses (Ev.Fusion / Ev.Triad inserted into the chain),
 *    Electrolysis (instant share of pending poison), Plasma (plasma_line hazard along a burning link).
 *    Stormglass (Anomaly): a link from or to a frozen or max-Chill enemy reaches 2 × lightning.arc_range.
 */
import type { World } from '../core/world';
import type { WorldImpl } from '../core/world-impl';
import type { HitInfo } from '../core/system';
import { EnemyFlag, Ev, MAX_ENEMIES } from '../core/types';
import { targetable } from '../core/spatial';
import { ScratchStack } from '../core/scratch';

export const ARC_DECAY = 0.9;
const MAX_LINKS = 64;
const ANCHOR = EnemyFlag.Boss | EnemyFlag.Elite;

/** SYSTEM_ORDER_IDS index for a hit source, or -1 for non-weapon sources. */
export function weaponIndex(source: HitInfo['source']): number {
  switch (source) {
    case 'primary': return 0; case 'ordnance': return 1; case 'drones': return 2;
    case 'blade': return 3; case 'laser': return 4; case 'gravitics': return 5;
    default: return -1;
  }
}

/** MAX_ENEMIES-sized ScratchStack (core/scratch.ts): element queries are never truncated. */
export class QueryStack extends ScratchStack {
  constructor() { super(MAX_ENEMIES); }
}

/** Remaining poison damage an enemy would still take (dps per stack × stacks × seconds left). */
export function pendingPoison(w: World, i: number): number {
  const e = w.enemies;
  return e.poisonDps[i] * e.poison[i] * (e.poisonT[i] / 60);
}
/** Remaining burn damage. */
export function pendingBurn(w: World, i: number): number {
  const e = w.enemies;
  return e.burnDps[i] * e.burn[i] * (e.burnT[i] / 60);
}

export class ArcEngine {
  readonly qs = new QueryStack();
  /** Links struck since the owner last reset it (Supercell counts these). */
  arcs = 0;
  range = 110;
  private staticCharge = 0; private staticDur = 240;
  private fork = 0;
  private anchor = false; private anchorBonus = 0.5;
  private superc = 0; private electro = 0; private plasma = 0; private plasmaDur = 1; private coldCircuit = 0;
  private stormglass = false;
  private visited: Int32Array[] = [];
  private depth = 0;

  rebuild(w: World): void {
    const s = w.stats;
    this.range = Math.max(10, s.get('lightning.arc_range'));
    const chain = s.hasDoctrine('lightning', 'chain');
    this.staticCharge = chain ? s.get('lightning.chain.static_charge') : 0;
    this.staticDur = Math.round(s.get('lightning.chain.static_charge.duration') * 60);
    this.fork = chain && s.has('lightning.chain.forked_current') ? s.get('lightning.chain.forked_current') : 0;
    this.anchor = s.hasDoctrine('lightning', 'storm') && s.has('lightning.storm.arc_anchor');
    this.anchorBonus = s.get('lightning.storm.arc_anchor.bonus');
    this.superc = s.has('fusion.superconductivity') ? s.get('fusion.superconductivity') : 0;
    this.electro = s.has('fusion.electrolysis') ? s.get('fusion.electrolysis') : 0;
    this.plasma = s.has('fusion.plasma') ? s.get('fusion.plasma') : 0;
    this.plasmaDur = s.get('fusion.plasma.duration');
    this.coldCircuit = s.has('triad.cold_circuit') ? s.get('triad.cold_circuit') : 0;
    this.stormglass = s.hasAnomaly('stormglass');
  }

  /** Stormglass: frozen or max-Chill enemies conduct lightning (their arc links reach double range). */
  private conducts(w: World, i: number): boolean {
    const e = w.enemies;
    return i >= 0 && (e.frozenT[i] > 0 || (e.chill[i] > 0 && e.chill[i] >= (w as WorldImpl).statusCap('chill')));
  }

  private visitBuf(): Int32Array {
    while (this.visited.length <= this.depth) this.visited.push(new Int32Array(MAX_LINKS));
    return this.visited[this.depth];
  }

  /**
   * Arc from `origin` (enemy index, or -1 for a point at ox,oy) through up to `targets` enemies.
   * `baseDmg` is the undecayed per-link damage. Returns the number of enemies struck.
   */
  chain(w: World, origin: number, ox: number, oy: number, targets: number, baseDmg: number, cause: number, srcTag = 'lightning'): number {
    if (targets <= 0 || !(baseDmg > 0)) return 0;
    const e = w.enemies;
    const visited = this.visitBuf();
    this.depth++;
    let nv = 0;
    if (origin >= 0) visited[nv++] = origin;
    let prev = origin, px = ox, py = oy;
    let mult = 1, chilled = origin >= 0 && e.chill[origin] > 0 ? 1 : 0;
    let linkCause = cause, fusionDone = false, triadDone = false, struck = 0;
    for (let k = 0; k < targets && nv < MAX_LINKS - 1; k++) {
      const next = this.pick(w, px, py, visited, nv, this.range, prev);
      if (next < 0) break;
      const cc = this.coldCircuit > 0 && prev >= 0 && e.chill[prev] > 0 && e.poison[prev] > 0 && e.chill[next] > 0 && e.poison[next] > 0;
      let dmg = baseDmg * mult;
      if (cc) {
        dmg *= 1 + this.coldCircuit;
        if (!triadDone) { triadDone = true; linkCause = w.emit(Ev.Triad, 'triad.cold_circuit', next, dmg, e.x[next], e.y[next], linkCause); }
      }
      if (this.superc > 0 && chilled > 0) {
        dmg *= 1 + this.superc * chilled;
        if (!fusionDone) { fusionDone = true; linkCause = w.emit(Ev.Fusion, 'fusion.superconductivity', next, chilled, e.x[next], e.y[next], linkCause); }
      }
      visited[nv++] = next;
      const linkId = this.strike(w, prev, px, py, next, dmg, linkCause, srcTag);
      struck++;
      if (this.fork > 0 && nv < MAX_LINKS - 1 && w.prng.chance(this.fork)) {
        const f = this.pick(w, px, py, visited, nv, this.range, prev);
        if (f >= 0) { visited[nv++] = f; this.strike(w, prev, px, py, f, dmg, linkCause, srcTag); struck++; }
      }
      if (e.chill[next] > 0) chilled++;
      if (!cc) mult *= ARC_DECAY;
      prev = next; px = e.x[next]; py = e.y[next];
      linkCause = linkId;
    }
    this.depth--;
    return struck;
  }

  /** One link: damage + riders. Returns the event id later links chain from. `from` = -1 for a point source (Ball Lightning, Supercell). */
  strike(w: World, from: number, fx: number, fy: number, to: number, dmg: number, cause: number, srcTag: string): number {
    const e = w.enemies;
    if (this.anchor && (e.flags[to] & ANCHOR)) dmg *= 1 + this.anchorBonus;
    const tx = e.x[to], ty = e.y[to];
    if (this.plasma > 0 && ((from >= 0 && e.burn[from] > 0) || e.burn[to] > 0)) {
      const fid = w.emit(Ev.Fusion, 'fusion.plasma', to, dmg, tx, ty, cause);
      w.addHazard({ kind: 'plasma_line', x: fx, y: fy, x2: tx, y2: ty, radius: 6, life: this.plasmaDur, dps: this.plasma * dmg,
        element: 'fire', cause: fid, owner: 'primary', srcTag: 'fusion.plasma' });
    }
    const h = w.damage(to, dmg, { source: 'element', srcTag, element: 'lightning', cause });
    const id = h.eventId;
    this.arcs++;
    if (!w.alive(to)) return id;
    if (this.staticCharge > 0) w.applyStatus(to, 'static', 1, this.staticDur, 'lightning', id);
    if (this.electro > 0 && e.poison[to] > 0 && w.alive(to)) {
      const amt = pendingPoison(w, to) * this.electro;
      if (amt > 0) {
        const fid = w.emit(Ev.Fusion, 'fusion.electrolysis', to, amt, tx, ty, id);
        w.damage(to, amt, { source: 'fusion', srcTag: 'fusion.electrolysis', element: 'poison', cause: fid, ignoreArmor: true });
      }
    }
    return id;
  }

  /**
   * Next arc target near (x,y): anchors first (Storm), then chilled (Superconductivity), then nearest. `from` is the
   * enemy the arc leaves (-1 for a point): with Stormglass a link from or to a conducting enemy reaches 2 × range.
   */
  pick(w: World, x: number, y: number, visited: Int32Array, nv: number, range = this.range, from = -1): number {
    const e = w.enemies;
    const buf = this.qs.push();
    const glass = this.stormglass, fromGlass = glass && this.conducts(w, from);
    const n = w.queryRadius(x, y, glass ? 2 * range : range, buf);
    let best = -1, bestTier = 3, bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const j = buf[k];
      if (!w.alive(j) || !targetable(e, j)) continue;
      let seen = false;
      for (let v = 0; v < nv; v++) if (visited[v] === j) { seen = true; break; }
      if (seen) continue;
      const tier = this.anchor && (e.flags[j] & ANCHOR) ? 0 : this.superc > 0 && e.chill[j] > 0 ? 1 : 2;
      const dx = e.x[j] - x, dy = e.y[j] - y, d = dx * dx + dy * dy;
      if (glass && !fromGlass) {   // beyond normal reach (the hash's rule: range + target radius) only a conducting target links
        const rr = range + e.radius[j];
        if (d > rr * rr && !this.conducts(w, j)) continue;
      }
      if (tier < bestTier || (tier === bestTier && (d < bestD || (d === bestD && j < best)))) { best = j; bestTier = tier; bestD = d; }
    }
    this.qs.pop();
    return best;
  }
}

/**
 * Up to `k` nearest live, targetable enemies within r of (x,y), excluding `exclude`; written to `out`
 * nearest first (ties: lower index). Returns the count.
 */
export function nearestN(w: World, qs: QueryStack, x: number, y: number, r: number, exclude: number, k: number, out: Int32Array): number {
  const e = w.enemies;
  const buf = qs.push();
  const n = w.queryRadius(x, y, r, buf);
  let m = 0;
  for (; m < k && m < out.length; m++) {
    let best = -1, bestD = Infinity;
    for (let q = 0; q < n; q++) {
      const j = buf[q];
      if (j === exclude || !w.alive(j) || !targetable(e, j)) continue;
      let taken = false;
      for (let t = 0; t < m; t++) if (out[t] === j) { taken = true; break; }
      if (taken) continue;
      const dx = e.x[j] - x, dy = e.y[j] - y, d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && j < best)) { best = j; bestD = d; }
    }
    if (best < 0) break;
    out[m] = best;
  }
  qs.pop();
  return m;
}

/**
 * Deferred area bursts (Flashpoint, Toxic Combustion, Thermal Shock). Triggers found inside hooks are
 * queued and detonated by the owning system's update() under a per-tick budget, oldest first. This turns
 * a synchronous chain reaction through a clumped wave (burst → statuses → more bursts, all inside one
 * World.damage call stack) into a wave front that advances a few dozen bursts per tick: no single-tick
 * hitch, bounded work per tick, identical results for every seed. Entries keep the enemy's generation
 * so a burst whose source died still detonates where it stood.
 * Coalescing: a new burst within `mergeR` of one of the last MERGE_SCAN pending bursts of the same kind
 * merges into it (damage summed, riders a/b take the max, the first cause is kept). In a packed clump this
 * turns hundreds of overlapping explosions into a few large ones that hit the same enemies for the same total.
 */
const MERGE_SCAN = 16;
export class BurstQueue {
  readonly cap: number;
  kind: Uint8Array; enemy: Int32Array; gen: Uint32Array; x: Float32Array; y: Float32Array;
  dmg: Float32Array; a: Float32Array; b: Float32Array; cause: Int32Array;
  private head = 0; private n = 0;
  constructor(cap = 2048) {
    this.cap = cap;
    this.kind = new Uint8Array(cap); this.enemy = new Int32Array(cap); this.gen = new Uint32Array(cap);
    this.x = new Float32Array(cap); this.y = new Float32Array(cap); this.dmg = new Float32Array(cap);
    this.a = new Float32Array(cap); this.b = new Float32Array(cap); this.cause = new Int32Array(cap);
  }
  get length(): number { return this.n; }
  clear(): void { this.head = 0; this.n = 0; }
  /** Returns the slot written, or -1 when full (the caller then detonates immediately). */
  push(w: World, kind: number, enemy: number, dmg: number, a: number, b: number, cause: number, mergeR = 0): number {
    const e = w.enemies;
    if (mergeR > 0) {
      const x = e.x[enemy], y = e.y[enemy], r2 = mergeR * mergeR;
      for (let q = 0; q < MERGE_SCAN && q < this.n; q++) {
        const k = (this.head + this.n - 1 - q) % this.cap;
        if (this.kind[k] !== kind) continue;
        const dx = this.x[k] - x, dy = this.y[k] - y;
        if (dx * dx + dy * dy > r2) continue;
        this.dmg[k] += dmg;
        if (a > this.a[k]) this.a[k] = a;
        if (b > this.b[k]) this.b[k] = b;
        return k;
      }
    }
    if (this.n >= this.cap) return -1;
    const k = (this.head + this.n++) % this.cap;
    this.kind[k] = kind; this.enemy[k] = enemy; this.gen[k] = e.gen[enemy]; this.x[k] = e.x[enemy]; this.y[k] = e.y[enemy];
    this.dmg[k] = dmg; this.a[k] = a; this.b[k] = b; this.cause[k] = cause;
    return k;
  }
  /** Pop the oldest entry's slot index, or -1. The slot stays valid until the next push. */
  shift(): number {
    if (this.n === 0) return -1;
    const k = this.head;
    this.head = (this.head + 1) % this.cap; this.n--;
    return k;
  }
}
