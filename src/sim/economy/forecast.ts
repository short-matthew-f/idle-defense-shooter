/**
 * Prestige Forecast (design §3). All times are SIMULATED play seconds (run.playSeconds), never
 * wall clock.
 *
 *  echoesNow        prestigeEchoes(w)
 *  echoRate         echoesNow ÷ hours of play since this Prestige began
 *  peakRate         max rate over run.echoRateHistory (sampled at every checkpoint and every 60 s)
 *  nextBoss*        Echoes at the next checkpoint and the rate if it is reached at the recent pace
 *  reclimbSeconds   0.3 × the previous Prestige's time to reach this checkpoint, else 0.35 × this run's time
 *  wallGaugeSeconds seconds until the cheapest not-yet-owned behavior-changing Scrap unlock is
 *                   affordable at the Scrap income of the last 60 s (null: nothing left / no income)
 *  recommended      the rate has sat ≥15% below its peak for one full checkpoint cycle (5 waves)
 *                   and at least wave 20 is cleared
 *
 * The ProgressionSystem (run/prestige.ts) calls `trackScrap` every tick and `sampleForecast` at
 * checkpoints / every 60 s. Tracker state is per World (WeakMap; never iterated).
 */
import type { Forecast, RunState } from '../core/types';
import type { WorldImpl } from '../core/world-impl';
import { TICK_RATE } from '../core/types';
import { echoesFor } from './curves';
import { prestigeEchoes } from './prestige';
import { codexMultiplier } from './codex';
import { buildShop } from './shop';

export const RECOMMEND_DROP = 0.15;
export const RECOMMEND_WAVES = 5;
export const SAMPLE_EVERY_TICKS = 60 * TICK_RATE;
const HISTORY_CAP = 600;
const WINDOW = 60;

interface Tracker { ring: Float64Array; filled: number; lastSecond: number }
const trackers = new WeakMap<object, Tracker>();
function tracker(w: WorldImpl): Tracker {
  let t = trackers.get(w);
  if (!t) { t = { ring: new Float64Array(WINDOW + 1), filled: 0, lastSecond: -1 }; trackers.set(w, t); }
  return t;
}

/** Record cumulative Scrap earned once per simulated second (for the Wall gauge). */
export function trackScrap(w: WorldImpl): void {
  if (w.run.tick % TICK_RATE !== 0) return;
  const t = tracker(w);
  const sec = w.run.tick / TICK_RATE;
  if (sec === t.lastSecond) return;
  t.lastSecond = sec;
  t.ring[sec % (WINDOW + 1)] = w.scrapEarned;
  if (t.filled < WINDOW + 1) t.filled++;
}
export function resetForecastTracker(w: WorldImpl): void { trackers.delete(w); }

/** Scrap per second over (up to) the last 60 s. */
export function scrapIncome(w: WorldImpl): number {
  const t = tracker(w);
  if (t.filled < 2) return 0;
  const n = Math.min(WINDOW, t.filled - 1);
  const now = t.ring[t.lastSecond % (WINDOW + 1)], then = t.ring[(t.lastSecond - n) % (WINDOW + 1)];
  return Math.max(0, (now - then) / n);
}

/** Echoes per hour for a history sample. */
export function sampleRate(s: { seconds: number; echoes: number }): number {
  return s.seconds > 0 ? (s.echoes * 3600) / s.seconds : 0;
}

/** Append a history sample (checkpoints and every 60 s of play). */
export function sampleForecast(w: WorldImpl): void {
  const run = w.run, h = run.echoRateHistory;
  const s = { seconds: run.playSeconds, echoes: prestigeEchoes(w), wave: run.deepestCleared };
  const last = h[h.length - 1];
  if (last && last.seconds === s.seconds) { h[h.length - 1] = s; return; }
  h.push(s);
  if (h.length > HISTORY_CAP) {
    // thin the older half, keeping the peak sample
    let peak = 0; for (let i = 1; i < h.length; i++) if (sampleRate(h[i]) > sampleRate(h[peak])) peak = i;
    const keep = h.filter((_, i) => i >= h.length / 2 || i % 2 === 0 || i === peak);
    h.length = 0; for (const x of keep) h.push(x);
  }
}

/**
 * The recommendation rule over a history (pure; also the unit-tested core): after the peak sample,
 * the trailing samples are all ≥15% below the peak and span at least one checkpoint cycle of waves.
 */
export function isRecommended(history: readonly { seconds: number; echoes: number; wave?: number }[], deepestCleared: number): boolean {
  if (deepestCleared < 20 || history.length < 2) return false;
  let peak = 0, peakIdx = -1;
  for (let i = 0; i < history.length; i++) { const r = sampleRate(history[i]); if (r > peak) { peak = r; peakIdx = i; } }
  if (peak <= 0) return false;
  const limit = (1 - RECOMMEND_DROP) * peak;
  let k = history.length - 1;
  if (k <= peakIdx || sampleRate(history[k]) > limit) return false;
  while (k - 1 > peakIdx && sampleRate(history[k - 1]) <= limit) k--;
  // k = first sample of the trailing run below the limit; it must have lasted a checkpoint cycle
  const start = history[k].wave ?? 0;
  const now = Math.max(history[history.length - 1].wave ?? 0, deepestCleared);
  return now - start >= RECOMMEND_WAVES;
}

function pace(run: RunState): number {
  const h = run.echoRateHistory;
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1], b = h[i];
    const dw = (b.wave ?? 0) - (a.wave ?? 0);
    if (dw > 0 && b.seconds > a.seconds) return (b.seconds - a.seconds) / dw;
  }
  return run.deepestCleared > 0 ? run.playSeconds / run.deepestCleared : 60;
}

/** Cheapest not-yet-maxed behavior-changing Scrap unlock in the shop (mechanic/fusion/linkage/infusion), or null. */
function cheapestMechanic(w: WorldImpl): number | null {
  let best: number | null = null;
  for (const e of buildShop(w)) {
    if (e.currency !== 'scrap') continue;
    if (e.kind !== 'mechanic' && e.kind !== 'fusion' && e.kind !== 'linkage' && e.kind !== 'infusion') continue;
    if (e.locked || e.rank >= e.maxRank) continue;
    if (best === null || e.cost < best) best = e.cost;
  }
  return best;
}

export function wallGaugeSeconds(w: WorldImpl): number | null {
  const price = cheapestMechanic(w);
  if (price === null) return null;
  if (w.run.scrap >= price) return 0;
  const inc = scrapIncome(w);
  return inc > 0 ? (price - w.run.scrap) / inc : null;
}

/** Full Forecast for the UI (allocates; ≤ 10 Hz). */
export function computeForecast(w: WorldImpl): Forecast {
  const run = w.run, meta = w.meta;
  const echoesNow = prestigeEchoes(w);
  const hours = run.playSeconds / 3600;
  const echoRate = hours > 0 ? echoesNow / hours : 0;
  const curve = run.echoRateHistory.map((s) => ({ seconds: s.seconds, rate: sampleRate(s) }));
  let peakRate = echoRate;
  for (const c of curve) if (c.rate > peakRate) peakRate = c.rate;
  const T = Math.min(run.threatDial, run.minThreatDial ?? run.threatDial);
  const nextCp = (Math.floor(run.deepestCleared / 5) + 1) * 5;
  const nextBossEchoes = Math.floor(echoesFor(nextCp, T) * Math.max(0, w.stats.get('economy.echo_mul')) * codexMultiplier(meta) + 1e-9);
  const nextSec = run.playSeconds + (nextCp - run.deepestCleared) * pace(run);
  const nextBossRate = nextSec > 0 ? (nextBossEchoes * 3600) / nextSec : 0;
  const k = Math.floor(run.deepestCleared / 5);
  const prev = meta.lastRunCheckpointSeconds?.[k];
  const reclimbSeconds = prev && prev > 0 ? prev * 0.3 : run.playSeconds * 0.35;
  const hist = run.echoRateHistory.concat([{ seconds: run.playSeconds, echoes: echoesNow, wave: run.deepestCleared }]);
  return {
    echoesNow, echoRate, peakRate, nextBossEchoes, nextBossRate, reclimbSeconds,
    wallGaugeSeconds: wallGaugeSeconds(w),
    recommended: isRecommended(hist, run.deepestCleared),
    curve,
  };
}

/** Directive condition `forecast_recommends` (cheap: no shop scan). */
export function forecastRecommends(w: WorldImpl): boolean {
  const run = w.run;
  if (run.deepestCleared < 20) return false;
  const h = run.echoRateHistory;
  const cur = { seconds: run.playSeconds, echoes: prestigeEchoes(w), wave: run.deepestCleared };
  return isRecommended(h.length ? [...h, cur] : [cur], run.deepestCleared);
}
