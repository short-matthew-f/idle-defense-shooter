/**
 * Derived metrics over RunResults (design §19 "Metrics"): damage share by system / Linkage, spend
 * by tree vs effectiveness, attempts and minutes per checkpoint, Echo-rate curve and the Prestige
 * recommendation, Counter success, depth-at-time.
 */
import type { RunResult } from './types';
import { echoesFor } from '../src/sim/economy/curves';

export function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function mean(v: number[]): number { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; }
export function round(x: number, d = 2): number { const k = 10 ** d; return Math.round(x * k) / k; }
export function pct(x: number, d = 1): string { return Number.isFinite(x) ? `${round(x * 100, d)}%` : 'n/a'; }

const STATUS_SYSTEM: Record<string, string> = {
  burn: 'fire', ignite: 'fire', fireball: 'fire', poison: 'poison', toxic: 'poison', chill: 'frost', frozen: 'frost', shatter: 'frost',
  shock: 'lightning', arc: 'lightning', static: 'lightning', bleed: 'blade', primary: 'ballistics', retaliation: 'bastion', thorns: 'bastion',
};
const SYSTEMS = new Set(['ballistics', 'bastion', 'reactor', 'fire', 'lightning', 'poison', 'frost', 'ordnance', 'drones', 'blade', 'laser', 'gravitics']);

/**
 * Map a damage srcTag to the tree/system whose Scrap bought it (same keys as run.spentByTree):
 * `fire.fireball` → fire, `burn` → fire, `infuse.laser.fire` → laser, `link.blade+laser` → blade
 * (the first non-primary half, like shop.spendKey), `chassis.bastion+drones` → drones,
 * `fusion.*`/`triad.*` → fusion, `ability.*` → ability.
 */
export function tagSystem(tag: string): string {
  const dot = tag.indexOf('.');
  const head = dot < 0 ? tag : tag.slice(0, dot);
  if (head === 'fusion' || head === 'triad') return 'fusion';
  if (head === 'ability') return 'ability';
  if (head === 'infuse') { const p = tag.split('.'); return p[1] ?? 'infuse'; }
  if (head === 'link') { const [a, b] = tag.slice(5).split('+'); return a === 'primary' ? (b ?? 'link') : a; }
  if (head === 'chassis') { const [, b] = tag.slice(8).split('+'); return b ?? 'chassis'; }
  if (SYSTEMS.has(head)) return head;
  return STATUS_SYSTEM[head] ?? head;
}

export function shares(m: Record<string, number>): Record<string, number> {
  let t = 0;
  for (const k in m) t += m[k];
  const out: Record<string, number> = {};
  if (t <= 0) return out;
  for (const k in m) out[k] = m[k] / t;
  return out;
}

export function damageBySystem(r: RunResult): Record<string, number> {
  const m: Record<string, number> = {};
  for (const k in r.damageBySrc) { const s = tagSystem(k); m[s] = (m[s] ?? 0) + r.damageBySrc[k]; }
  return shares(m);
}
/** Share of all damage dealt by each Linkage / Chassis Linkage / Infusion / Fusion tag. */
export function damageByLinkage(r: RunResult): Record<string, number> {
  const all = shares(r.damageBySrc);
  const out: Record<string, number> = {};
  for (const k in all) if (/^(link|chassis|infuse|fusion|triad)\./.test(k)) out[k] = all[k];
  return out;
}

export interface SpendRow { system: string; spendShare: number; damageShare: number }
/** Spend share vs damage share per tree (Bastion/Reactor/abilities are non-damage trees: reported, not judged). */
export function spendVsEffect(r: RunResult): SpendRow[] {
  const sp = shares(r.spendByTree), dm = damageBySystem(r);
  const keys = new Set([...Object.keys(sp), ...Object.keys(dm)]);
  return [...keys].map((system) => ({ system, spendShare: sp[system] ?? 0, damageShare: dm[system] ?? 0 }))
    .sort((a, b) => b.spendShare - a.spendShare);
}
export const NON_DAMAGE_TREES = new Set(['bastion', 'reactor', 'ability']);

/** Cumulative probability of clearing a new boss within 1, 2, 3 attempts (attempts per checkpoint). */
export function checkpointOdds(runs: RunResult[], maxCp = Infinity): { n: number; p1: number; p2: number; p3: number; dist: number[] } {
  const a: number[] = [];
  for (const r of runs) for (const c of r.checkpoints) if (c.checkpoint <= maxCp) a.push(c.attempts);
  const n = a.length;
  const f = (k: number): number => (n ? a.filter((x) => x <= k).length / n : NaN);
  return { n, p1: f(1), p2: f(2), p3: f(3), dist: a };
}

export function checkpointMinutes(runs: RunResult[]): number[] {
  const out: number[] = [];
  for (const r of runs) for (const c of r.checkpoints) out.push(c.minutes);
  return out;
}

/** Deepest wave cleared by play-second `t`. */
export function depthAt(r: RunResult, t: number): number {
  let d = 0;
  for (const w of r.waves) if (w.firstClearAt !== null && w.firstClearAt <= t && w.wave > d) d = w.wave;
  return d;
}
/** Play-second of the first clear of wave `wave` (null if never). */
export function timeToWave(r: RunResult, wave: number): number | null {
  let best: number | null = null;
  for (const w of r.waves) if (w.wave >= wave && w.firstClearAt !== null && (best === null || w.firstClearAt < best)) best = w.firstClearAt;
  return best;
}

/** Total attempts spent on checkpoints up to `cp` (inclusive). */
export function attemptsUpTo(r: RunResult, cp: number): number {
  let s = 0;
  for (const c of r.checkpoints) if (c.checkpoint <= cp) s += c.attempts;
  return s;
}

/** Recommendation wave: the Forecast's when present, else the computed Echo-rate rule, else the peak. */
export function recommendation(r: RunResult): { wave: number; seconds: number; source: 'forecast' | 'computed' | 'peak' | 'none' } {
  if (r.forecastRecommended) return { ...r.forecastRecommended, source: 'forecast' };
  if (r.computedRecommended) return { ...r.computedRecommended, source: 'computed' };
  if (r.echoPeak) return { wave: r.echoPeak.wave, seconds: r.echoPeak.seconds, source: 'peak' };
  return { wave: NaN, seconds: NaN, source: 'none' };
}

/** Echo rate (Echoes/hour) the player would realize by Prestiging at play-second `t`. */
export function echoRateAt(r: RunResult, t: number): number {
  const d = depthAt(r, t);
  return t > 0 ? echoesFor(d, r.config.threatDial ?? 0) / (t / 3600) : 0;
}

/** Counter success: Counters scored / boss tells seen. */
export function counterRate(r: RunResult): number { return r.tells > 0 ? r.counters / r.tells : NaN; }
