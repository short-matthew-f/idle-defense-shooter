/**
 * Wave generator (WP4). Pure function of (prestigeSeed, wave, threatDial, ascension):
 * wave content is fixed per Prestige seed (design §2, §12) and never reads the build.
 *
 * Rules (§12 "Generator rules", §19, §20):
 *  - Threat Budget: budget(w) = 8 + 2.2 w (≈228 at wave 100). The Threat Dial scales HP
 *    through hpScale (1 + 0.12 T), never the count.
 *  - Roster: the current Sector's introduced enemies plus earlier Sectors, weighted toward
 *    newer families. Counter enemies are capped at 20% of the budget (35% in Ascension).
 *  - Template: chosen with Prng(waveSeed(seed, w)) among templates with minWave <= w
 *    (spatial ones only from Ascension III), excluding any whose max archetype multiplier
 *    exceeds 1.5× its median; waves ≡ 4 (mod 5) draw from the 6 flattest.
 *  - Budget is spent at budget / median Difficulty Multiplier of the chosen template.
 *  - More than MAX_SPAWNS spawns merge into Clumps (hpScale makes up the difference).
 *  - Elites from wave 8: min(1 + floor(w/12), 6) spawns (+1 per 3 Threat Dial levels) get
 *    1–2 modifiers; from Ascension V all elites share 3+ coordinated modifiers.
 *  - Boss waves spawn the boss at tick 0 plus an escort group orbiting it.
 */
import { Prng, waveSeed } from '../math/prng';
import { TAU, HALF_PI, PI } from '../math/lut';
import { TICK_RATE, MAX_ENEMIES, ARENA_RADIUS } from '../core/types';
import type { WaveDef, SpawnEntry } from '../core/types';
import type { BossId, EliteModifier, EnemyKind, FormationId } from '../core/ids';
import type { FormationDef, FormationParams } from '../data/schema';
import { ENEMY_BY_KIND, COUNTER_KINDS } from '../data/enemies';
import { BOSS_BY_ID, bossForWave } from '../data/bosses';
import { FORMATIONS, FORMATION_BY_ID, medianDifficulty, isFair } from '../data/formations';
import { SECTORS, INTRO_WAVE, sectorIndexForWave, sectorIndex } from '../data/sectors';
import { FORMATION_CONST } from './formations';

/** Hard cap on spawns per wave (design §20 entity budget). */
export const MAX_SPAWNS = MAX_ENEMIES;
const GOLDEN = 2.399963229728653;

/** Threat Budget for wave w (before template difficulty). */
export function threatBudget(wave: number): number {
  const w = wave < 1 ? 1 : wave;
  return 8 + 2.2 * w;
}

/** Spawn window in ticks. Ordinary waves: 18–40 s of spawns (+ ~12 s travel ⇒ 30–52 s). Bosses: 12 s of escorts. */
export function waveDuration(wave: number): number {
  const w = wave < 1 ? 1 : Math.floor(wave);
  if (w % 5 === 0) return 12 * TICK_RATE;
  const extra = 0.22 * (w - 1);
  return Math.round((18 + (extra > 22 ? 22 : extra)) * TICK_RATE);
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------
const ROSTER_KINDS: EnemyKind[] = [
  'grunt', 'swarm', 'runner', 'brute', 'kamikaze', 'shielded',
  'splitter', 'carrier', 'healer', 'leech', 'veteran',
  'armored', 'warden', 'artillery', 'charger', 'anchor',
  'phase', 'burrower', 'nullifier', 'refractor',
  'jammer',
];
/** Enemies spawned in packs (one roster pick = a pack). */
const PACK: Partial<Record<EnemyKind, number>> = { swarm: 4, runner: 2, kamikaze: 2 };
/** Per-kind roster weight adjustments (support roles should be sprinkled, not massed). */
const KIND_WEIGHT: Partial<Record<EnemyKind, number>> = {
  grunt: 1.6, carrier: 0.5, healer: 0.55, warden: 0.5, nullifier: 0.55, jammer: 0.6, anchor: 0.6, artillery: 0.7,
};
/** Templates that feature a kind get it weighted up. */
const FEATURED: Partial<Record<FormationId, Partial<Record<EnemyKind, number>>>> = {
  brute_column: { brute: 4, armored: 2, anchor: 1.5, veteran: 1.5 },
  kamikaze_ring: { kamikaze: 5 },
  artillery_ring: { artillery: 5 },
  delayed_ambush: { burrower: 5 },
  annular_rush: { runner: 2, charger: 2 },
  escort: { brute: 1.5, veteran: 1.5 },
  scattered_rain: { runner: 1.5 },
};
const COUNTER_SET: Record<string, true> = (() => { const r: Record<string, true> = {}; for (const k of COUNTER_KINDS) r[k] = true; return r; })();
const SUB_KINDS: Record<string, true> = { splitter_fragment: true, brood: true, clump: true, boss_add: true, boss: true };

interface RosterEntry { kind: EnemyKind; weight: number }

/** Roster for wave w: introduced kinds, weighted toward the current Sector. */
export function rosterForWave(wave: number, formation: FormationId | null = null): RosterEntry[] {
  const cur = sectorIndexForWave(wave);
  const feat = formation ? FEATURED[formation] : undefined;
  const out: RosterEntry[] = [];
  for (const kind of ROSTER_KINDS) {
    const intro = INTRO_WAVE[kind];
    if (intro > wave) continue;
    const def = ENEMY_BY_KIND[kind];
    const s = def.sector === 'sub' ? 0 : sectorIndex(def.sector);
    const age = cur - s;                                   // 0 = current Sector
    let weight = age <= 0 ? 1 : age === 1 ? 0.6 : 0.4;
    if (wave > 100) weight = age <= 0 ? 1 : 0.7;           // Deep Waves: full mixed roster
    if (wave - intro < 3) weight *= 1.5;                   // spotlight on a new family
    weight *= KIND_WEIGHT[kind] ?? 1;
    if (feat && feat[kind]) weight *= feat[kind] as number;
    out.push({ kind, weight });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Template choice
// ---------------------------------------------------------------------------
function candidateTemplates(wave: number, ascension: number): FormationDef[] {
  const out: FormationDef[] = [];
  for (const f of FORMATIONS) {
    if (f.minWave > wave) continue;
    if (f.spatial && ascension < 3) continue;
    if (!isFair(f)) continue;
    out.push(f);
  }
  return out;
}

function pickTemplate(rng: Prng, wave: number, ascension: number): FormationDef {
  let cands = candidateTemplates(wave, ascension);
  if (cands.length === 0) cands = [FORMATION_BY_ID.radial_ring];
  if (wave % 5 === 4) {
    const sorted = cands.slice().sort((a, b) => (b.flatness - a.flatness) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    cands = sorted.slice(0, 6);
  }
  return rng.pick(cands);
}

function varyParams(rng: Prng, d: FormationParams): FormationParams {
  const lanes = d.lanes >= 3 ? d.lanes + rng.int(-1, 1) : d.lanes;
  const spread = d.spread * rng.range(0.9, 1.1);
  const tempo = d.tempo * rng.range(0.85, 1.15);
  const radialSpeed = d.radialSpeed * rng.range(0.92, 1.08);
  const rotation = d.rotation * rng.range(0.85, 1.15) * (rng.chance(0.5) ? -1 : 1);
  return { lanes, spread, tempo, radialSpeed, rotation, escortRatio: d.escortRatio };
}

// ---------------------------------------------------------------------------
// Budget spending
// ---------------------------------------------------------------------------
interface Pick { kind: EnemyKind; scale: number }

function spend(rng: Prng, roster: RosterEntry[], budget: number, counterCap: number, preferred?: Partial<Record<EnemyKind, number>>): Pick[] {
  const kinds = roster.map((r) => r.kind);
  const weights = roster.map((r) => r.weight * (preferred?.[r.kind] ?? 1));
  const picks: Pick[] = [];
  let spent = 0, counterSpent = 0;
  let guard = 0;
  while (spent < budget && guard++ < 100000) {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) break;
    const i = pickIndex(rng, weights, total);
    const kind = kinds[i];
    const def = ENEMY_BY_KIND[kind];
    const pack = PACK[kind] ?? 1;
    const cost = def.threat * pack;
    if (COUNTER_SET[kind] && counterSpent + cost > counterCap) { weights[i] = 0; continue; }
    // Don't let a heavy last pick overshoot by more than half of itself.
    if (spent > 0 && spent + cost > budget + cost * 0.5) {
      weights[i] = 0;
      continue;
    }
    for (let k = 0; k < pack; k++) picks.push({ kind, scale: 1 });
    spent += cost;
    if (COUNTER_SET[kind]) counterSpent += cost;
  }
  if (picks.length === 0) picks.push({ kind: 'grunt', scale: 1 });
  return picks;
}

function pickIndex(rng: Prng, weights: number[], total: number): number {
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0 && weights[i] > 0) return i; }
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
  return 0;
}

/** Past the spawn cap, merge same-kind picks (swarm-like ones into Clumps); hpScale replaces count. */
function mergeToCap(picks: Pick[], cap: number): Pick[] {
  if (picks.length <= cap) return picks;
  const m = Math.ceil(picks.length / (cap - 32));
  const buckets = new Map<EnemyKind, Pick[]>();
  const order: EnemyKind[] = [];
  for (const p of picks) {
    let b = buckets.get(p.kind);
    if (!b) { b = []; buckets.set(p.kind, b); order.push(p.kind); }
    b.push(p);
  }
  const merged: Pick[] = [];
  for (const kind of order) {
    const b = buckets.get(kind) as Pick[];
    const def = ENEMY_BY_KIND[kind];
    const toClump = def.behavior === 'swarm';
    for (let i = 0; i < b.length; i += m) {
      const n = Math.min(m, b.length - i);
      if (n === 1) { merged.push(b[i]); continue; }
      if (toClump) merged.push({ kind: 'clump', scale: n * def.hpMul / ENEMY_BY_KIND.clump.hpMul });
      else merged.push({ kind, scale: n });
    }
  }
  // Interleave back so kinds stay mixed through the wave (deterministic stride).
  const out: Pick[] = [];
  const stride = 7;
  const used = new Uint8Array(merged.length);
  for (let s = 0; s < stride; s++) for (let i = s; i < merged.length; i += stride) if (!used[i]) { used[i] = 1; out.push(merged[i]); }
  return out.slice(0, cap);
}

// ---------------------------------------------------------------------------
// Layout: tick / angle / radiusOffset / slot / lane per template
// ---------------------------------------------------------------------------
interface Ctx { rng: Prng; p: FormationParams; D: number; a0: number }

function entry(pk: Pick, tick: number, angle: number, radiusOffset: number, slot: number, lane: number): SpawnEntry {
  return { tick: Math.max(0, Math.floor(tick)), kind: pk.kind, angle: wrap(angle), radiusOffset, elite: [], hpScale: pk.scale, formationSlot: slot, lane };
}
function wrap(a: number): number { a = a % TAU; return a < 0 ? a + TAU : a; }

function layoutRings(c: Ctx, picks: Pick[], ringSize: number, t0: number, t1: number, laneFromRing = false): SpawnEntry[] {
  const out: SpawnEntry[] = [];
  const N = picks.length;
  const P = Math.max(1, Math.ceil(N / Math.max(1, ringSize)));
  const lanes = Math.max(1, Math.round(c.p.lanes));
  for (let j = 0; j < P; j++) {
    const from = Math.floor(j * N / P), to = Math.floor((j + 1) * N / P);
    const m = to - from;
    const tick = t0 + (P > 1 ? j * (t1 - t0) / P : 0);
    const off = c.a0 + (j & 1) * (PI_OVER(m));
    for (let i = 0; i < m; i++) {
      out.push(entry(picks[from + i], tick, off + i * TAU / m, 0, i, laneFromRing ? j : i % lanes));
    }
  }
  return out;
}
function PI_OVER(m: number): number { return m > 0 ? TAU / (2 * m) : 0; }

function layoutArms(c: Ctx, picks: Pick[], arms: number, armOffset: number): SpawnEntry[] {
  const out: SpawnEntry[] = [];
  const N = picks.length;
  for (let i = 0; i < N; i++) {
    const arm = i % arms;
    out.push(entry(picks[i], i * c.D / N, c.a0 + arm * armOffset, 0, Math.floor(i / arms), arm));
  }
  return out;
}

function layoutStreams(c: Ctx, picks: Pick[], lanes: number, angleOf: (lane: number) => number, stagger = 0): SpawnEntry[] {
  const out: SpawnEntry[] = [];
  const N = picks.length;
  const perLane = Math.ceil(N / lanes);
  const span = Math.max(1, c.D - stagger * (lanes - 1));
  const step = Math.min(90, Math.max(8, span / Math.max(1, perLane)));
  for (let i = 0; i < N; i++) {
    const lane = i % lanes, k = Math.floor(i / lanes);
    out.push(entry(picks[i], lane * stagger + k * step, angleOf(lane), 0, k, lane));
  }
  return out;
}

/** Ring size: `lanes` members per ring, but at least `minPulses` rings of >= `minSize`. */
function ringSize(N: number, lanes: number, minSize: number, minPulses: number): number {
  return Math.max(minSize, Math.min(lanes, Math.ceil(N / minPulses)));
}

function groups(N: number, size: number): number { return Math.max(1, Math.ceil(N / size)); }

function layout(id: FormationId, c: Ctx, picks: Pick[]): SpawnEntry[] {
  const { rng, p, D, a0 } = c;
  const N = picks.length;
  const lanes = Math.max(1, Math.round(p.lanes));
  const out: SpawnEntry[] = [];
  switch (id) {
    // Ring templates: at least three pulses so small early waves still last 30 s.
    case 'radial_ring':
      return layoutRings(c, picks, ringSize(N, Math.max(6, lanes), 4, 3), 0, D);
    case 'concentric_assault':
    case 'tidal_ring':
      return layoutRings(c, picks, ringSize(N, Math.max(8, lanes), 6, 3), 0, D);
    case 'orbit_lattice':
      return layoutRings(c, picks, ringSize(N, Math.max(8, lanes), 6, 3), 0, D, true);
    case 'annular_rush':
      return layoutRings(c, picks, Math.max(Math.min(lanes, N), Math.ceil(N / 3)), 0, D);
    case 'kamikaze_ring':
      return layoutRings(c, picks, ringSize(N, Math.max(8, lanes), 6, 2), 0, D);
    case 'synchronized_burst': {
      const B = Math.min(5, groups(N, 20));
      for (let j = 0; j < B; j++) {
        const from = Math.floor(j * N / B), to = Math.floor((j + 1) * N / B), m = to - from;
        const base = a0 + j * GOLDEN;
        for (let i = 0; i < m; i++) out.push(entry(picks[from + i], j * D / B, base + i * TAU / m + rng.range(-0.05, 0.05), 0, i, i % lanes));
      }
      return out;
    }
    case 'tightening_spiral':
    case 'spiral_arms':
      return layoutArms(c, picks, lanes, TAU / lanes);
    case 'double_helix':
      return layoutArms(c, picks, 2, PI);
    case 'alternating_spokes': {
      const L = Math.max(2, lanes);
      const pulses = Math.ceil(N / L);
      const step = Math.min(90, D / Math.max(1, pulses));
      for (let i = 0; i < N; i++) {
        const spoke = i % L, k = Math.floor(i / L);
        out.push(entry(picks[i], k * step + (spoke & 1) * step * 0.5, a0 + spoke * TAU / L, 0, k, spoke));
      }
      return out;
    }
    case 'crescent': {
      const C = groups(N, 12);
      const half = 0.7 * p.spread;
      for (let g = 0; g < C; g++) {
        const from = Math.floor(g * N / C), to = Math.floor((g + 1) * N / C), m = to - from;
        const center = a0 + g * GOLDEN;
        for (let i = 0; i < m; i++) {
          const u = m > 1 ? (i / (m - 1)) * 2 - 1 : 0;
          out.push(entry(picks[from + i], g * D / C, center + u * half, 45 * (1 - u * u), i, g));
        }
      }
      return out;
    }
    case 'rotating_wedge':
    case 'packed_wedge': {
      const rotating = id === 'rotating_wedge';
      const C = groups(N, 10);
      const gap = rotating ? 0.05 : 0.035;
      for (let g = 0; g < C; g++) {
        const from = Math.floor(g * N / C), to = Math.floor((g + 1) * N / C), m = to - from;
        const center = a0 + g * (rotating ? HALF_PI : GOLDEN);
        const t0 = g * D / C;
        let row = 0, col = 0;
        for (let k = 0; k < m; k++) {
          const tick = Math.floor(t0 + row * 12);
          const ang = center + (col - row / 2) * gap + (rotating ? p.rotation * tick / TICK_RATE : 0);
          out.push(entry(picks[from + k], tick, ang, 0, k, g));
          col++;
          if (col > row) { row++; col = 0; }
        }
      }
      return out;
    }
    case 'twin_columns': {
      const C = groups(N, 20);
      for (let g = 0; g < C; g++) {
        const from = Math.floor(g * N / C), to = Math.floor((g + 1) * N / C), m = to - from;
        const center = a0 + g * GOLDEN;
        for (let k = 0; k < m; k++) {
          const col = k & 1, row = k >> 1;
          out.push(entry(picks[from + k], g * D / C + row * 24, center + (col ? 1 : -1) * 0.045 * p.spread, 0, row, col));
        }
      }
      return out;
    }
    case 'brute_column': {
      const C = groups(N, 14);
      for (let g = 0; g < C; g++) {
        const from = Math.floor(g * N / C), to = Math.floor((g + 1) * N / C);
        const col = picks.slice(from, to).map((pk, i) => ({ pk, i }));
        col.sort((x, y) => (ENEMY_BY_KIND[y.pk.kind].threat - ENEMY_BY_KIND[x.pk.kind].threat) || (x.i - y.i));
        const center = a0 + g * GOLDEN;
        for (let k = 0; k < col.length; k++) out.push(entry(col[k].pk, g * D / C + k * 22, center, 0, k, g));
      }
      return out;
    }
    case 'expanding_flower':
    case 'hazard_bloom': {
      const P = Math.max(3, lanes);
      const perPetal = Math.ceil(N / P);
      const step = Math.max(12, D / Math.max(1, Math.ceil(perPetal / 2)));
      for (let i = 0; i < N; i++) {
        const petal = i % P, k = Math.floor(i / P);
        out.push(entry(picks[i], Math.floor(k / 2) * step, a0 + petal * TAU / P, 0, k, petal));
      }
      return out;
    }
    case 'comet_tail': {
      const C = groups(N, 40);
      for (let g = 0; g < C; g++) {
        const from = Math.floor(g * N / C), to = Math.floor((g + 1) * N / C), m = to - from;
        const center = a0 + g * GOLDEN;
        const t0 = g * D / C;
        const H = Math.max(1, Math.ceil(m * 0.3));
        // The tail stretches over ~70% of this comet's share of the spawn window (at least 8 ticks apart).
        // Balance pass: with one comet (N ≤ 40) the whole wave used to arrive in ~3.5 s, a burst that
        // killed early towers dozens of times on wave 6.
        const step = Math.max(8, Math.floor(((D / C) * 0.7) / Math.max(1, m - H)));
        for (let k = 0; k < m; k++) {
          if (k < H) out.push(entry(picks[from + k], t0 + (k % 3) * 4, center + rng.range(-0.07, 0.07), rng.range(0, 30), k, g));
          else out.push(entry(picks[from + k], t0 + 20 + (k - H) * step, center, 0, k, g));
        }
      }
      return out;
    }
    case 'serpentine':
    case 'figure_eight':
    case 'barrier_maze':
      return layoutStreams(c, picks, Math.max(1, lanes), (l) => a0 + l * TAU / Math.max(1, lanes));
    case 'mirror_lanes': {
      const pairs = Math.max(1, lanes);
      return layoutStreams(c, picks, pairs * 2, (l) => a0 + Math.floor(l / 2) * TAU / pairs);
    }
    case 'gate_weave':
      return layoutStreams(c, picks, Math.max(2, lanes), (l) => a0 + l * TAU / Math.max(2, lanes));
    case 'staggered_lanes': {
      const L = Math.max(2, lanes);
      return layoutStreams(c, picks, L, (l) => a0 + l * TAU / L, Math.floor(D / (2 * L)));
    }
    case 'scattered_rain':
      for (let i = 0; i < N; i++) out.push(entry(picks[i], rng.int(0, Math.max(0, D - 1)), rng.next() * TAU, rng.range(-120, 50), i, 0));
      return out;
    case 'pincer':
    case 'flank_pair': {
      const pincer = id === 'pincer';
      const sweep = pincer ? Math.min(HALF_PI, FORMATION_CONST.pincerSweep * p.spread) : FORMATION_CONST.flankOffset;
      const C = groups(N, 30);
      for (let g = 0; g < C; g++) {
        const from = Math.floor(g * N / C), to = Math.floor((g + 1) * N / C), m = to - from;
        const meet = a0 + g * GOLDEN;
        const span = D / C;
        const waves = Math.max(1, Math.ceil(m / 10));
        for (let k = 0; k < m; k++) {
          const side = k & 1, j = k >> 1;
          const start = side === 0 ? meet - sweep : meet + sweep;
          const jitter = ((j % 5) - 2) * 0.05;
          const tick = g * span + Math.floor(j / 5) * (span / waves);
          out.push(entry(picks[from + k], tick, start + jitter, 0, j, side));
        }
      }
      return out;
    }
    case 'artillery_ring': {
      const guns: Pick[] = [], screen: Pick[] = [];
      for (const pk of picks) (pk.kind === 'artillery' ? guns : screen).push(pk);
      out.push(...layoutRings(c, screen, Math.max(8, lanes), 0, Math.floor(D * 0.6)));
      const G = groups(guns.length, Math.max(4, lanes));
      for (let g = 0; g < G; g++) {
        const from = Math.floor(g * guns.length / G), to = Math.floor((g + 1) * guns.length / G), m = to - from;
        for (let i = 0; i < m; i++) out.push(entry(guns[from + i], D * 0.15 + g * (D * 0.8) / G, a0 + (g + 0.5) * 0.3 + i * TAU / m, 0, i, 1));
      }
      return out;
    }
    case 'delayed_ambush': {
      const amb: Pick[] = [], bait: Pick[] = [];
      for (const pk of picks) (pk.kind === 'burrower' ? amb : bait).push(pk);
      // Guarantee an ambush: with no burrowers, a fifth of the bait drops in instead.
      if (amb.length === 0) { const n = Math.ceil(bait.length / 5); for (let i = 0; i < n; i++) amb.push(bait.pop() as Pick); }
      out.push(...layoutRings(c, bait, Math.max(8, lanes * 2), 0, Math.floor(D * 0.45)));
      const R = FORMATION_CONST.ambushRadius;
      for (let i = 0; i < amb.length; i++) {
        const tick = D * 0.45 + (amb.length > 1 ? i * (D * 0.5) / amb.length : 0);
        out.push(entry(amb[i], tick, rng.next() * TAU, (R - ARENA_RADIUS) + rng.range(-20, 20), i, 1));
      }
      return out;
    }
    case 'moving_wall':
    case 'hex_grid': {
      const W = Math.max(1, lanes);
      const rows = Math.ceil(N / W);
      const hex = id === 'hex_grid';
      const rowsPerWall = 3;
      const walls = hex ? Math.min(6, rows) : Math.max(1, Math.ceil(rows / rowsPerWall));
      const layers = hex ? Math.ceil(rows / walls) : rowsPerWall;
      const layerStep = Math.max(24, Math.min(40, D / Math.max(1, hex ? layers : rows)));
      for (let r = 0; r < rows; r++) {
        const from = r * W, to = Math.min(N, from + W), m = to - from;
        const wall = hex ? r % walls : Math.floor(r / rowsPerWall);
        const layer = hex ? Math.floor(r / walls) : r % rowsPerWall;
        const normal = hex ? a0 + wall * PI / 3 : a0 + wall * GOLDEN;
        const t0 = hex ? 0 : wall * D / walls;
        const offset = Math.floor((W - m) / 2);
        for (let i = 0; i < m; i++) out.push(entry(picks[from + i], t0 + layer * layerStep, normal, 0, offset + i, r));
      }
      return out;
    }
    case 'cluster_drop': {
      const C = groups(N, 8);
      for (let g = 0; g < C; g++) {
        const from = Math.floor(g * N / C), to = Math.floor((g + 1) * N / C), m = to - from;
        const center = rng.next() * TAU;
        const cr = rng.range(-150, -40);
        for (let k = 0; k < m; k++) out.push(entry(picks[from + k], g * D / C + (k % 3) * 2, center + rng.range(-0.045, 0.045), cr + rng.range(-14, 14), k, g));
      }
      return out;
    }
    case 'safe_corridor': {
      const width = 0.9;
      const RS = 12;
      const P = groups(N, RS);
      for (let i = 0; i < N; i++) {
        const rel = width * 0.5 + rng.next() * (TAU - width);
        const lane = rel < PI ? 0 : 1;
        out.push(entry(picks[i], Math.floor(i / RS) * D / P, a0 + rel, 0, i, lane));
      }
      return out;
    }
    case 'polygon_siege': {
      const P = groups(N, 24);
      for (let g = 0; g < P; g++) {
        const from = Math.floor(g * N / P), to = Math.floor((g + 1) * N / P), m = to - from;
        for (let k = 0; k < m; k++) out.push(entry(picks[from + k], g * D / P + (k % 4) * 3, a0 + g * 0.5, 0, k, g));
      }
      return out;
    }
    case 'escort':
    default: {
      // Cores = the heaviest ~1/(1+ratio) of picks; escorts orbit them.
      const ratio = Math.max(1, p.escortRatio);
      const idx = picks.map((pk, i) => ({ pk, i }));
      idx.sort((x, y) => (ENEMY_BY_KIND[y.pk.kind].threat * y.pk.scale - ENEMY_BY_KIND[x.pk.kind].threat * x.pk.scale) || (x.i - y.i));
      const coreCount = Math.max(1, Math.round(N / (1 + ratio)));
      const cores = idx.slice(0, coreCount).sort((x, y) => x.i - y.i);
      const escorts = idx.slice(coreCount).sort((x, y) => x.i - y.i);
      const G = groups(coreCount, 3);
      for (let g = 0; g < G; g++) {
        const cf = Math.floor(g * coreCount / G), ct = Math.floor((g + 1) * coreCount / G);
        const ef = Math.floor(g * escorts.length / G), et = Math.floor((g + 1) * escorts.length / G);
        const center = a0 + g * GOLDEN;
        const tick = g * D / G;
        for (let k = cf; k < ct; k++) out.push(entry(cores[k].pk, tick, center + (k - cf - 1) * 0.035, 0, k - cf, 0));
        for (let k = ef; k < et; k++) out.push(entry(escorts[k].pk, tick, center, 0, k - ef, 1));
      }
      return out;
    }
  }
}

/** Compress spawn ticks proportionally if a layout's row/tail offsets ran past the window. */
function fitWindow(spawns: SpawnEntry[], D: number): void {
  let max = 0;
  for (const s of spawns) if (s.tick > max) max = s.tick;
  if (max <= D - 1) return;
  const k = (D - 1) / max;
  for (const s of spawns) s.tick = Math.floor(s.tick * k);
}

// ---------------------------------------------------------------------------
// Elites
// ---------------------------------------------------------------------------
const ELITE_UNLOCK: [EliteModifier, number][] = [
  ['hardened', 8], ['swift', 8], ['regenerating', 8], ['shielded_elite', 13], ['volatile', 11],
  ['splitting', 21], ['commanding', 21], ['vampiric', 29], ['anchored', 52], ['phasing', 61],
  ['refracting', 69], ['jamming', 81],
];

function eliteMods(wave: number): EliteModifier[] {
  const out: EliteModifier[] = [];
  for (const [m, w] of ELITE_UNLOCK) if (wave >= w) out.push(m);
  return out;
}

function drawMods(rng: Prng, pool: EliteModifier[], n: number): EliteModifier[] {
  const bag = pool.slice();
  rng.shuffle(bag);
  return bag.slice(0, Math.min(n, bag.length));
}

/** Number of elite spawns in an ordinary wave. */
export function eliteCount(wave: number, threatDial: number): number {
  if (wave < 8) return 0;
  return Math.min(1 + Math.floor(wave / 12), 6) + Math.floor(Math.max(0, threatDial) / 3);
}

function applyElites(rng: Prng, spawns: SpawnEntry[], wave: number, threatDial: number, ascension: number, forceAll: boolean): void {
  const eligible: number[] = [];
  for (let i = 0; i < spawns.length; i++) if (!SUB_KINDS[spawns[i].kind]) eligible.push(i);
  if (eligible.length === 0) return;
  const pool = eliteMods(Math.max(8, wave));
  const n = forceAll ? eligible.length : Math.min(eligible.length, eliteCount(wave, threatDial));
  if (n <= 0) return;
  rng.shuffle(eligible);
  const chosen = eligible.slice(0, n).sort((a, b) => a - b);
  const coordinated = ascension >= 5 ? drawMods(rng, pool, Math.min(pool.length, 3 + Math.floor((ascension - 5) / 3))) : null;
  const twoChance = Math.min(0.8, wave / 100);
  for (const i of chosen) {
    const mods = coordinated ? coordinated.slice() : drawMods(rng, pool, rng.chance(twoChance) ? 2 : 1);
    spawns[i].elite = mods;
    spawns[i].hpScale *= 2 + 0.5 * mods.length;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function generateWave(prestigeSeed: number, wave: number, threatDial: number, ascension: number,
  /** WP8 addition: Scatter Trial — every ordinary wave uses a spread formation (Scattered Rain). */ opts?: { scatter?: boolean }): WaveDef {
  const w = wave < 1 ? 1 : Math.floor(wave);
  const rng = new Prng(waveSeed(prestigeSeed, w));
  const sectorDef = SECTORS[sectorIndexForWave(w)];
  const bossId: BossId | null = bossForWave(w);
  const isBoss = bossId !== null;
  const budget = threatBudget(w);
  const dial = threatDial > 0 ? threatDial : 0;
  const dialScale = 1 + 0.12 * dial;
  const counterCap = (ascension > 0 ? 0.35 : 0.2) * budget;
  const D = waveDuration(w);
  const a0 = rng.next() * TAU;

  let formation: FormationId | null;
  let params: FormationParams;
  let spawns: SpawnEntry[];

  if (isBoss) {
    const boss = BOSS_BY_ID[bossId as BossId];
    formation = 'escort';
    params = varyParams(rng, FORMATION_BY_ID.escort.defaults);
    params.rotation = 0;
    const roster = rosterForWave(w);
    const pref: Partial<Record<EnemyKind, number>> = {};
    for (const ad of boss.adds ?? []) pref[ad.kind] = 4;
    const picks = spend(rng, roster, budget * 0.25, counterCap, pref);
    spawns = [{ tick: 0, kind: 'boss', angle: a0, radiusOffset: 0, elite: [], hpScale: 1, formationSlot: 0, lane: 0 }];
    // Escorts come in batches of 8 (one orbit shell each, cycling 4 shells) spread over the window.
    const batches = Math.ceil(picks.length / 8);
    for (let k = 0; k < picks.length; k++) {
      const batch = k >> 3;
      spawns.push(entry(picks[k], Math.min(D - 1, batch * Math.min(90, D / batches)), a0, 0, k, 1));
    }
    for (const s of spawns) s.hpScale *= dialScale;
    applyElites(rng, spawns, w, dial, ascension, bossId === 'last_procession');
    // The boss itself is never an elite.
    spawns[0].elite = [];
    spawns[0].hpScale = dialScale;
  } else {
    let tpl = pickTemplate(rng, w, ascension);
    if (opts?.scatter) tpl = FORMATION_BY_ID.scattered_rain;   // WP8: same RNG draws, spread layout
    formation = tpl.id;
    params = varyParams(rng, tpl.defaults);
    const roster = rosterForWave(w, tpl.id);
    const eff = budget / medianDifficulty(tpl);
    const picks = mergeToCap(spend(rng, roster, eff, counterCap), MAX_SPAWNS);
    spawns = layout(tpl.id, { rng, p: params, D, a0 }, picks);
    fitWindow(spawns, D);
    for (const s of spawns) s.hpScale *= dialScale;
    applyElites(rng, spawns, w, dial, ascension, false);
  }

  // Deterministic total order: tick, then original index.
  const dec = spawns.map((s, i) => ({ s, i }));
  dec.sort((x, y) => (x.s.tick - y.s.tick) || (x.i - y.i));
  spawns = dec.map((d) => d.s);

  return { wave: w, sector: sectorDef.id, isBoss, bossId, formation, threatBudget: budget, spawns, params, durationTicks: D };
}

/** One-line wave summary for the UI, e.g. "Wave 17 · The Outskirts · Tightening Spiral · 38 enemies, 2 elites". */
export function describeWave(def: WaveDef): string {
  const sector = SECTORS.find((s) => s.id === def.sector)?.name ?? def.sector;
  let elites = 0, enemies = 0;
  for (const s of def.spawns) { if (s.kind === 'boss') continue; enemies++; if (s.elite.length > 0) elites++; }
  if (def.isBoss && def.bossId) {
    const boss = BOSS_BY_ID[def.bossId];
    let text = `Wave ${def.wave} · ${sector} · ${boss.name} · boss + ${enemies} ${enemies === 1 ? 'escort' : 'escorts'}`;
    if (elites > 0) text += `, ${elites} ${elites === 1 ? 'elite' : 'elites'}`;
    return text;
  }
  const name = def.formation ? FORMATION_BY_ID[def.formation].name : 'Open Field';
  let text = `Wave ${def.wave} · ${sector} · ${name} · ${enemies} ${enemies === 1 ? 'enemy' : 'enemies'}`;
  if (elites > 0) text += `, ${elites} ${elites === 1 ? 'elite' : 'elites'}`;
  return text;
}
