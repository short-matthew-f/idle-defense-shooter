/**
 * Pure formatting helpers (no DOM). Numbers round DOWN so a displayed price never looks
 * affordable when it is not (1,999 Scrap shows as 1.9K, not 2.0K).
 */

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

function trimZero(s: string): string { return s.includes('.') ? s.replace(/\.?0+$/, '') : s; }

/** 950 → "950", 1234 → "1.2K", 3.45e6 → "3.4M", 123456 → "123K", 1e40 → "1e40". */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : '—';
  const neg = n < 0;
  let v = Math.abs(n);
  if (v < 1000) {
    const s = v < 10 && v % 1 !== 0 ? trimZero((Math.floor(v * 10) / 10).toFixed(1)) : String(Math.floor(v));
    return (neg ? '-' : '') + s;
  }
  let i = 0;
  while (v >= 1000 && i < SUFFIXES.length - 1) { v /= 1000; i++; }
  if (v >= 1000) {
    // past the suffix table: scientific
    const exp = Math.floor(Math.log10(Math.abs(n)));
    const mant = Math.floor((Math.abs(n) / Math.pow(10, exp)) * 100) / 100;
    return (neg ? '-' : '') + trimZero(mant.toFixed(2)) + 'e' + exp;
  }
  const s = v < 100 ? trimZero((Math.floor(v * 10) / 10).toFixed(1)) : String(Math.floor(v));
  return (neg ? '-' : '') + s + SUFFIXES[i];
}

/** "+1.2K/s"; tiny rates keep one decimal. */
export function fmtRate(perSecond: number, unit = '/s'): string {
  if (!Number.isFinite(perSecond) || perSecond === 0) return '0' + unit;
  return (perSecond > 0 ? '+' : '') + fmtNum(perSecond) + unit;
}

/** Durations: "45s", "3m 5s", "3h 12m", "2d 4h". */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r ? `${m}m ${r}s` : `${m}m`; }
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** 0.153 → "15%"; digits for small values. */
export function fmtPct(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Per-rank value for a `{v}` placeholder: fractions (and 'mul' ops) read as percentages. */
export function fmtPerRank(v: number, op: 'add' | 'mul' | 'set' = 'add'): string {
  if (op === 'mul' || (Math.abs(v) > 0 && Math.abs(v) < 1)) return `${trimZero((v * 100).toFixed(1))}%`;
  return trimZero(v.toFixed(2));
}

/** Replace every `{v}` in a node description. */
export function substituteDesc(desc: string, v: number | undefined, op: 'add' | 'mul' | 'set' = 'add'): string {
  if (v === undefined || !desc.includes('{v}')) return desc;
  return desc.split('{v}').join(fmtPerRank(v, op));
}

/**
 * A node description's headline effect and whether more follows (pure): its first sentence, without a closing
 * parenthetical. "+16% primary damage per rank (base 10 per shot)." → "+16% primary damage per rank"; "Burn lasts
 * 3 s; +0.2 s per rank. Reapplying refreshes the duration." → "Burn lasts 3 s; +0.2 s per rank". The full text shows on tap.
 */
export function splitDesc(desc: string): { headline: string; more: boolean } {
  const d = desc.trim();
  const end = d.search(/[.!?] /);   // a sentence end (decimals like "0.6 s" have no space after the point)
  let headline = (end > 0 ? d.slice(0, end) : d).replace(/[.!?]$/, '');
  headline = headline.replace(/\s\([^()]*\)$/, '');
  return { headline, more: headline.length < d.replace(/[.!?]$/, '').length };
}

/** snake_case / dotted ids → "Title Case" (fallback names). */
export function titleCase(id: string): string {
  return id.replace(/^[a-z]+\./, '').replace(/[_.+-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** Echoes paid by a Prestige (design §17), used when the sim's Forecast is not available. */
export function echoesFor(deepest: number, dial = 0): number {
  if (deepest < 20) return 0;
  return Math.floor(10 * Math.pow(1.2, deepest - 20) * (1 + 0.1 * dial));
}

/** Offline Scrap estimate (mirrors economy/curves offlineScrap). */
export function offlineEstimate(patrolScrapPerSecond: number, elapsedSeconds: number, longPatrol: boolean | number): number {
  // Long Patrol ranks each add 4 h to the cap and 7.5 points of efficiency (8 h and 40% at rank 0, 24 h and 70% at rank 4); `true` means max rank
  const rank = Math.max(0, Math.min(4, longPatrol === true ? 4 : longPatrol === false ? 0 : Math.floor(longPatrol)));
  const cap = (8 + 4 * rank) * 3600;
  const eff = 0.4 + 0.075 * rank;
  return Math.floor(Math.max(0, patrolScrapPerSecond) * Math.min(Math.max(0, elapsedSeconds), cap) * eff);
}

/** Price of the next rank of a data node (Echo / Star shops; mirrors economy nodeCost). */
export function nextRankCost(cost: { base: number; growth: number } | { flat: number[] } | { cores: number }, rank: number): number {
  if ('cores' in cost) return cost.cores;
  if ('flat' in cost) return cost.flat[Math.min(rank, cost.flat.length - 1)] ?? 0;
  return Math.ceil(cost.base * Math.pow(cost.growth, rank));
}

/** Unit of a shop stat preview (ShopEntry.statUnit). */
export type StatUnit = '%' | 'x' | '/s' | '';

/** One resolved stat value at `digits` decimals: 13.2, "5.5%", "×1.6", "2.2/s"; large plain values use suffixes (1.2K). */
export function fmtStat(v: number, unit: StatUnit = '', digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  const dec = (x: number): string => trimZero(x.toFixed(digits));
  switch (unit) {
    case '%': return `${dec(v * 100)}%`;
    case 'x': return `×${trimZero(v.toFixed(Math.max(2, digits)))}`;
    case '/s': return `${dec(v)}/s`;
    default: return Math.abs(v) >= 1000 ? fmtNum(v) : dec(v);
  }
}

/**
 * Before → after for a shop row or the starter button (pure): "13.2 → 14.8 (+12%)". Decimals grow (to 3) until the two
 * sides differ. Percent stats show points ("5% → 6%") without a relative change; others add the relative change.
 */
export function fmtStatChange(now: number, next: number, unit: StatUnit = '', opts: { digits?: number; rel?: boolean } = {}): string {
  let d = opts.digits ?? 1, a = fmtStat(now, unit, d), b = fmtStat(next, unit, d);
  while (a === b && d < 3) { d++; a = fmtStat(now, unit, d); b = fmtStat(next, unit, d); }
  let rel = '';
  if (opts.rel !== false && unit !== '%' && now !== 0 && Number.isFinite(next)) {
    const r = (next / now - 1) * 100;
    const ar = Math.abs(r);
    const s = ar >= 10 ? Math.round(ar).toString() : trimZero(ar.toFixed(1));
    if (s !== '0') rel = ` (${r >= 0 ? '+' : '−'}${s}%)`;
  }
  return `${a} → ${b}${rel}`;
}
