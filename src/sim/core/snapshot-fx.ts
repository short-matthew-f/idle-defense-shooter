/**
 * Event-driven presentation for the render snapshot (graphics pass): colours by source, kill-chain link
 * lines, and the fx requests (deaths, pips, pickups, camera cues) made from the events of a frame.
 * Presentation only: reads the event log (byId / depthOf) and never writes sim state.
 */
import { Ev, FxKind, INST_FLAG_SCALE, InstFlag, Shape } from './types';
import type { SimEvent } from './types';

export type RGB3 = readonly [number, number, number];

// ------------------------------------------------------------------ colours by source tag
const ELEMENT: Record<string, RGB3> = {
  fire: [1, 0.56, 0.16], burn: [1, 0.56, 0.16], lightning: [0.98, 0.93, 0.36], static: [0.98, 0.93, 0.36], shock: [0.98, 0.93, 0.36],
  poison: [0.28, 0.9, 0.6], frost: [0.4, 0.78, 1], chill: [0.4, 0.78, 1], frozen: [0.6, 0.9, 1], bleed: [0.9, 0.2, 0.25],
};
const SYSTEM: Record<string, RGB3> = {
  ballistics: [1, 0.95, 0.72], primary: [1, 0.95, 0.72], ordnance: [1, 0.6, 0.25], drones: [0.45, 0.9, 1], blade: [0.82, 0.88, 1],
  laser: [1, 0.42, 0.88], gravitics: [0.72, 0.5, 1], bastion: [0.55, 0.8, 1], retaliation: [0.55, 0.8, 1], reactor: [1, 0.85, 0.4],
  tower: [0.55, 0.8, 1], ability: [1, 1, 1], anomaly: [1, 0.5, 0.85], fusion: [1, 0.7, 0.95], triad: [1, 1, 0.8],
  enemy: [1, 0.3, 0.3], hazard: [1, 0.5, 0.3], elite: [1, 0.84, 0.36], vampiric: [0.9, 0.2, 0.3],
};
const FUSION: Record<string, RGB3> = {
  toxic_combustion: [0.75, 0.85, 0.2], superconductivity: [0.7, 0.9, 1], thermal_shock: [1, 0.75, 0.6],
  electrolysis: [0.6, 1, 0.55], plasma: [0.95, 0.6, 1], cryotoxin: [0.35, 0.95, 0.9],
};
const NEUTRAL: RGB3 = [1, 0.85, 0.5];
const cache = new Map<string, RGB3>();

/** Colour of an event source tag: element first (infusions, statuses), then fusion, then system. */
export function srcColor(src: string): RGB3 {
  const hit = cache.get(src);
  if (hit) return hit;
  let c: RGB3 = NEUTRAL;
  if (ELEMENT[src]) c = ELEMENT[src];
  else if (SYSTEM[src]) c = SYSTEM[src];
  else {
    const parts = src.split(/[.+]/);
    const head = parts[0];
    if (head === 'infuse') c = ELEMENT[parts[2] ?? ''] ?? SYSTEM[parts[1] ?? ''] ?? NEUTRAL;
    else if (head === 'fusion') c = FUSION[parts[1] ?? ''] ?? SYSTEM.fusion;
    else if (head === 'link' || head === 'chassis') c = ELEMENT[parts[1] ?? ''] ?? SYSTEM[parts[1] ?? ''] ?? SYSTEM[parts[2] ?? ''] ?? NEUTRAL;
    else if (ELEMENT[head]) c = ELEMENT[head];
    else if (SYSTEM[head]) c = SYSTEM[head];
    else for (const p of parts) { const e = ELEMENT[p] ?? SYSTEM[p]; if (e) { c = e; break; } }
  }
  if (cache.size < 512) cache.set(src, c);
  return c;
}

// ------------------------------------------------------------------ chain lines
/**
 * Event types whose position is a place a player chain can start from. Spawn is left out on purpose:
 * enemies' own attacks are caused by their Spawn event (a kamikaze blast would draw a line from the rim).
 */
const SPATIAL = new Uint8Array(64);
for (const t of [Ev.Hit, Ev.Kill, Ev.Explosion, Ev.StatusApply, Ev.StatusTick, Ev.Fusion, Ev.Triad, Ev.Linkage, Ev.Infusion, Ev.Anomaly, Ev.Cast, Ev.BossCounter]) SPATIAL[t] = 1;
/** Child types that draw a link from their cause. */
const LINKABLE = new Uint8Array(64);
for (const t of [Ev.Hit, Ev.Kill, Ev.Explosion, Ev.StatusApply, Ev.Fusion, Ev.Triad, Ev.Linkage, Ev.Infusion, Ev.Anomaly]) LINKABLE[t] = 1;

export const CHAIN_MAX = 64;
/** Lifetime in snapshot frames (~0.4 s at 60 fps). */
export const CHAIN_LIFE = 24;
/** Only links at least this deep (a new system joined the chain) draw. */
export const CHAIN_MIN_DEPTH = 2;
/** Kill-chain depth at which a kill shows pips. */
export const PIP_DEPTH = 3;

/**
 * Slot to (re)use for a new link of depth `depth` at frame `frame`: an expired slot first, else the
 * shallowest (then oldest) live slot if the new link is at least as deep; -1 = drop the new link.
 * Deepest chains win when more than CHAIN_MAX links compete.
 */
export function chooseChainSlot(depths: Int32Array, born: Int32Array, frame: number, life: number, depth: number): number {
  let worst = -1, worstD = 1 << 30, worstB = 1 << 30;
  for (let k = 0; k < depths.length; k++) {
    if (frame - born[k] >= life) return k;
    const d = depths[k], b = born[k];
    if (d < worstD || (d === worstD && b < worstB)) { worst = k; worstD = d; worstB = b; }
  }
  return depth >= worstD ? worst : -1;
}

export class ChainLines {
  readonly x0 = new Float32Array(CHAIN_MAX); readonly y0 = new Float32Array(CHAIN_MAX);
  readonly x1 = new Float32Array(CHAIN_MAX); readonly y1 = new Float32Array(CHAIN_MAX);
  readonly cr = new Float32Array(CHAIN_MAX); readonly cg = new Float32Array(CHAIN_MAX); readonly cb = new Float32Array(CHAIN_MAX);
  readonly depth = new Int32Array(CHAIN_MAX);
  readonly born = new Int32Array(CHAIN_MAX).fill(-1 << 20);
  /** Links offered this frame (for tests / stats). */
  offered = 0;
  /** Fast reject: within `rejectFrame`, every slot is live and at least `rejectBelow` deep. */
  private rejectFrame = -1;
  private rejectBelow = 0;

  reset(): void { this.born.fill(-1 << 20); this.offered = 0; this.rejectFrame = -1; }

  add(x0: number, y0: number, x1: number, y1: number, c: RGB3, depth: number, frame: number): boolean {
    this.offered++;
    if (frame === this.rejectFrame && depth < this.rejectBelow) return false;
    const k = chooseChainSlot(this.depth, this.born, frame, CHAIN_LIFE, depth);
    if (k < 0) {
      // nothing expires until the frame changes: remember the floor so shallower offers skip the scan
      let min = 1 << 30;
      for (let j = 0; j < CHAIN_MAX; j++) if (this.depth[j] < min) min = this.depth[j];
      this.rejectFrame = frame; this.rejectBelow = min;
      return false;
    }
    if (frame === this.rejectFrame) this.rejectFrame = -1;
    this.x0[k] = x0; this.y0[k] = y0; this.x1[k] = x1; this.y1[k] = y1;
    this.cr[k] = c[0]; this.cg[k] = c[1]; this.cb[k] = c[2];
    this.depth[k] = depth; this.born[k] = frame;
    return true;
  }

  /** Offer the link cause → child when it is a real, visible chain link. Returns true when kept. */
  offer(child: SimEvent, parent: SimEvent | undefined, depth: number, parentDepth: number, frame: number): boolean {
    if (!parent || depth < CHAIN_MIN_DEPTH || depth <= parentDepth || !LINKABLE[child.type] || !SPATIAL[parent.type]) return false;
    const dx = child.x - parent.x, dy = child.y - parent.y;
    if (dx * dx + dy * dy < 36) return false;
    if (parent.x === 0 && parent.y === 0 && parent.type !== Ev.Explosion) return false;   // not a place
    return this.add(parent.x, parent.y, child.x, child.y, srcColor(child.src), depth, frame);
  }

  /** Emit live links deepest first (the renderer may cap the count per quality tier). Layer 2, flag Chain. */
  write(out: { push(x: number, y: number, radius: number, rot: number, shape: number, r: number, g: number, b: number, a: number, layer: number, aux0?: number, aux1?: number): void }, frame: number): number {
    let n = 0;
    const layer = 2 + INST_FLAG_SCALE * InstFlag.Chain;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < CHAIN_MAX; k++) {
        const age = frame - this.born[k];
        if (age < 0 || age >= CHAIN_LIFE) continue;
        const deep = this.depth[k] >= 4;
        if ((pass === 0) !== deep) continue;
        const f = 1 - age / CHAIN_LIFE;
        const w = 0.7 + 0.18 * Math.min(6, this.depth[k]);
        out.push(this.x0[k], this.y0[k], w, 0, Shape.Line, this.cr[k], this.cg[k], this.cb[k], 0.85 * f * f, layer, this.x1[k], this.y1[k]);
        n++;
      }
    }
    return n;
  }

  live(frame: number): number {
    let n = 0;
    for (let k = 0; k < CHAIN_MAX; k++) { const age = frame - this.born[k]; if (age >= 0 && age < CHAIN_LIFE) n++; }
    return n;
  }
}

// ------------------------------------------------------------------ camera / time cues
/** Screen-shake trauma per event (presentation tuning; the renderer honours the Screen shake setting). */
export const SHAKE = { explosionPer100: 0.1, explosionMax: 0.22, enemyBlast: 0.35, bossPhase: 0.45, bossKilled: 0.85, barrierBreak: 0.5 } as const;
/** Camera punch strength (renderer: zoom kick + floor vignette pulse). */
export const PUNCH = { counter: 1, bossKilled: 1.4, prestige: 2 } as const;

