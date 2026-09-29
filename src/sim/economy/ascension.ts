/**
 * Ascension and the Constellation (design §15).
 *
 *  - `ascend(m)`: allowed once wave 100 is cleared this run (run.deepestCleared ≥ 100). Pays
 *    Stars = floor(4 · (1+A) · 1.1^(D−100)) with A = Ascensions before this one, increments
 *    meta.ascension, refunds every Star spent in the Constellation (free respec at the moment of
 *    Ascending) and starts a fresh run at wave 1 (Scrap, Cores, upgrades, Anomalies reset; Echoes,
 *    Prestige nodes, Codex, Trial rewards, Frames and Stars kept). Enemy HP ×1.6^A is applied by
 *    economy/curves.enemyHp (spawnEnemy / clumps / DoT defaults all pass meta.ascension).
 *  - Per-Ascension unlocks: I Echo Engine frame, 5th socket, Echo pool; II Triads + Fusion Apex
 *    (+1 Fusion rank cap); III Prism frame + spatial formations (the generator reads ascension);
 *    IV Threat Dial 0..20; V Singularity Core frame + Deep Waves.
 *  - `buyStar(w, node)`: Constellation purchase with Stars. A node's region opens at Ascension
 *    region+1 (region 0 = Ascension I); Bridges require both Majors (NodeDef.requires).
 */
import type { WorldImpl } from '../core/world-impl';
import type { RunMachine } from '../run/machine';
import type { StarNodeDef } from '../data/schema';
import type { FrameId } from '../core/ids';
import { Ev } from '../core/types';
import { allNodes, nodeInfo } from '../core/content';
import { nodeCost, starsFor } from './curves';
import { frameUnlocked, unlockFrames } from './prestige';
import { startFresh } from '../run/prestige';
import { combineSeed } from '../math/prng';

export const ASCENSION_WAVE = 100;
/** Frames unlocked by reaching each Ascension. */
export const ASCENSION_FRAMES: Record<number, FrameId> = { 1: 'echo_engine', 3: 'prism', 5: 'singularity_core' };

/** Stars an Ascension would pay right now (0 if not allowed). */
export function ascensionStars(w: WorldImpl): number {
  return w.run.deepestCleared >= ASCENSION_WAVE ? starsFor(w.run.deepestCleared, w.meta.ascension) : 0;
}

/** Stars spent on the current Constellation (for the free respec). */
export function constellationSpent(w: WorldImpl): number {
  let total = 0;
  for (const info of allNodes()) {
    if (info.group !== 'star') continue;
    const r = w.meta.constellation[info.def.id] | 0;
    for (let k = 0; k < r; k++) total += nodeCost(info.def, k).cost;
  }
  return total;
}

export function ascend(m: RunMachine): string | null {
  const w = m.w, meta = w.meta, run = w.run;
  if (w.trial) return 'Not during a Trial';
  if (run.deepestCleared < ASCENSION_WAVE) return 'Beat wave 100 to Ascend';
  const stars = starsFor(run.deepestCleared, meta.ascension);
  const refund = constellationSpent(w);
  meta.constellation = {};
  meta.stars += stars + refund;
  meta.ascension += 1;
  for (let a = 1; a <= meta.ascension; a++) { const f = ASCENSION_FRAMES[a]; if (f) unlockFrames(meta, [f]); }
  if (run.deepestCleared > meta.deepestEver) meta.deepestEver = run.deepestCleared;
  meta.lastRunCheckpointSeconds = [];   // enemy HP changed: previous reclimb times no longer apply
  meta.keepsake = null;
  w.emit(Ev.Ascend, 'ascension', stars, meta.ascension, 0, 0, -1);
  const frame = frameUnlocked(meta, w.build.frame) ? w.build.frame : 'standard';
  startFresh(m, combineSeed(run.prestigeSeed, 0xa5c3, meta.ascension), frame, {});
  return null;
}

/** Fusion Apex / Triad gating live in economy/prestige.ts (the shop imports them from there). */
export { effectiveMaxRank, triadsUnlocked } from './prestige';

/** Deep Waves (past 100) are open from Ascension V. */
export function deepWavesUnlocked(w: WorldImpl): boolean { return w.meta.ascension >= 5; }

/** Buy one rank of a Constellation node with Stars. Returns an error or null. */
export function buyStar(w: WorldImpl, id: string): string | null {
  const meta = w.meta;
  const info = nodeInfo(id);
  if (!info || info.group !== 'star') return 'Unknown Constellation node';
  const def = info.def as StarNodeDef;
  if (def.region >= meta.ascension) return `Region revealed at Ascension ${def.region + 1}`;
  const missing = (def.requires ?? []).find((r) => (meta.constellation[r] | 0) <= 0);
  if (missing) return `Requires ${nodeInfo(missing)?.def.name ?? missing}`;
  const rank = meta.constellation[id] | 0;
  if (rank >= def.maxRank) return 'Max rank';
  const cost = nodeCost(def, rank).cost;
  if (meta.stars < cost) return 'Not enough Stars';
  meta.stars -= cost;
  meta.constellation[id] = rank + 1;
  w.emit(Ev.Purchase, id, rank + 1, cost, 0, 0, -1);
  w.rebuildStats();
  return null;
}
