/**
 * Formation templates (design §12, §19). 24 launch templates plus 12 Ascension III
 * spatial templates. Motion scripts live in src/sim/enemies/formations.ts; spawn layout
 * lives in src/sim/enemies/generator.ts.
 *
 * `difficulty` is the seeded Difficulty Multiplier per build archetype, relative to the
 * baseline radial ring at equal budget (1.0). A template a system "loves" (§12 counter
 * map) sits at 0.7–0.85 for it; one that punishes it at 1.2–1.45. WP10's simulator
 * refines these per 10-wave band. `flatness` is derived from the spread of the table.
 */
import type { FormationId } from '../core/ids';
import type { FormationDef, FormationParams } from './schema';

/** Archetype keys of the difficulty tables, in a fixed order. */
export const ARCHETYPES = ['ballistics', 'fire', 'lightning', 'poison', 'frost', 'ordnance', 'drones', 'blade', 'laser', 'gravitics'] as const;
export type Archetype = typeof ARCHETYPES[number];

type Row = [number, number, number, number, number, number, number, number, number, number];
//                                  bal   fire  ltng  pois  frst  ord   drn   bld   lsr   grav
function diff(r: Row): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < ARCHETYPES.length; i++) out[ARCHETYPES[i]] = r[i];
  return out;
}

function params(p: Partial<FormationParams>): FormationParams {
  return { lanes: 1, spread: 1, tempo: 1, radialSpeed: 1, rotation: 0, escortRatio: 0, ...p };
}

/** Flatness in 0..1: 1 = every archetype finds it equally hard. */
function flatnessOf(d: Record<string, number>): number {
  let lo = Infinity, hi = -Infinity;
  for (const k of ARCHETYPES) { const v = d[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const f = 1 - (hi - lo) / 0.8;
  return Math.round((f < 0 ? 0 : f > 1 ? 1 : f) * 1000) / 1000;
}

type Seed = Omit<FormationDef, 'flatness'>;
function def(s: Seed): FormationDef { return { ...s, flatness: flatnessOf(s.difficulty) }; }

export const FORMATIONS: FormationDef[] = [
  // ---------------------------------------------------------------- launch templates (24)
  def({ id: 'radial_ring', name: 'Radial Ring', desc: 'Evenly spaced rings; every lane advances at once.', shapeClass: 'ring', minWave: 1,
    defaults: params({ lanes: 12 }),
    difficulty: diff([1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]) }),
  def({ id: 'tightening_spiral', name: 'Tightening Spiral', desc: 'Spiral arms whose angle advances as they close in.', shapeClass: 'spiral', minWave: 3,
    defaults: params({ lanes: 3, spread: 1 }),
    difficulty: diff([1.05, 0.75, 1.35, 0.95, 1.0, 0.9, 1.05, 0.95, 1.1, 1.05]) }),
  def({ id: 'alternating_spokes', name: 'Alternating Spokes', desc: 'Spokes that surge and stall in alternation.', shapeClass: 'spokes', minWave: 5,
    defaults: params({ lanes: 8, tempo: 0.5 }),
    difficulty: diff([0.95, 1.1, 0.8, 1.0, 1.0, 1.0, 1.05, 1.1, 0.95, 0.75]) }),
  def({ id: 'crescent', name: 'Crescent', desc: 'Arcs with leading horns and a trailing center.', shapeClass: 'crescent', minWave: 2,
    defaults: params({ lanes: 1, spread: 1 }),
    difficulty: diff([1.1, 0.95, 0.95, 1.0, 1.0, 0.9, 1.0, 1.05, 0.9, 1.0]) }),
  def({ id: 'rotating_wedge', name: 'Rotating Wedge', desc: 'A wedge that turns around the tower as it closes.', shapeClass: 'wedge', minWave: 9,
    defaults: params({ lanes: 1, rotation: 0.08 }),
    difficulty: diff([0.85, 1.0, 1.05, 1.0, 1.05, 0.95, 1.1, 1.0, 1.2, 1.1]) }),
  def({ id: 'twin_columns', name: 'Twin Columns', desc: 'Two files marching side by side.', shapeClass: 'column', minWave: 4,
    defaults: params({ lanes: 2 }),
    difficulty: diff([0.75, 1.05, 1.1, 0.9, 1.0, 1.0, 1.05, 1.1, 0.9, 1.15]) }),
  def({ id: 'expanding_flower', name: 'Expanding Flower', desc: 'Petals bloom outward, then fold in on the tower.', shapeClass: 'flower', minWave: 14,
    defaults: params({ lanes: 5, radialSpeed: 0.9 }),
    difficulty: diff([1.1, 0.9, 0.95, 1.0, 1.05, 1.05, 0.95, 1.0, 1.15, 0.9]) }),
  def({ id: 'comet_tail', name: 'Comet Tail', desc: 'A dense head followed by a long curving tail.', shapeClass: 'comet', minWave: 6,
    defaults: params({ lanes: 1 }),
    difficulty: diff([0.9, 0.75, 1.0, 0.95, 1.0, 0.85, 1.1, 1.05, 1.2, 1.0]) }),
  def({ id: 'concentric_assault', name: 'Concentric Assault', desc: 'Full rings arriving in pulses.', shapeClass: 'concentric', minWave: 16,
    defaults: params({ lanes: 16, tempo: 0.6 }),
    difficulty: diff([1.05, 1.0, 1.0, 1.05, 0.95, 1.1, 1.05, 0.95, 0.75, 1.1]) }),
  def({ id: 'synchronized_burst', name: 'Synchronized Burst', desc: 'Everything spawns at once from every angle and dashes in.', shapeClass: 'burst', minWave: 12,
    defaults: params({ lanes: 16 }),
    difficulty: diff([1.2, 1.1, 1.0, 1.15, 0.95, 1.1, 1.0, 0.9, 0.9, 0.95]) }),
  def({ id: 'serpentine', name: 'Serpentine', desc: 'Snaking lines whose angle oscillates as they close.', shapeClass: 'serpentine', minWave: 8,
    defaults: params({ lanes: 3 }),
    difficulty: diff([1.1, 0.85, 1.2, 0.95, 1.0, 1.1, 0.95, 1.05, 1.15, 1.05]) }),
  def({ id: 'escort', name: 'Escort', desc: 'Heavy cores with escorts orbiting them.', shapeClass: 'escort', minWave: 10,
    defaults: params({ lanes: 2, escortRatio: 3 }),
    difficulty: diff([1.1, 1.05, 0.9, 0.9, 1.0, 0.9, 1.0, 1.05, 1.1, 0.95]) }),
  def({ id: 'scattered_rain', name: 'Scattered Rain', desc: 'Random angles, random start radii, all wave long.', shapeClass: 'scatter', minWave: 7,
    defaults: params({ lanes: 1 }),
    difficulty: diff([1.15, 1.25, 0.8, 1.15, 1.1, 1.35, 0.7, 1.2, 1.1, 0.8]) }),
  def({ id: 'pincer', name: 'Pincer', desc: 'Two groups from opposite sides sweep round to close on one flank.', shapeClass: 'pincer', minWave: 11,
    defaults: params({ lanes: 2 }),
    difficulty: diff([1.25, 1.05, 1.0, 1.05, 1.0, 1.1, 0.9, 0.95, 1.05, 0.75]) }),
  def({ id: 'artillery_ring', name: 'Artillery Ring', desc: 'A gun line that stops near radius 330 and holds behind a screen.', shapeClass: 'artillery', minWave: 46,
    defaults: params({ lanes: 8 }),
    difficulty: diff([0.9, 1.1, 1.0, 0.95, 1.05, 0.85, 0.8, 1.45, 0.95, 1.2]) }),
  def({ id: 'moving_wall', name: 'Moving Wall', desc: 'Straight line segments sweeping across the arena.', shapeClass: 'wall', minWave: 18,
    defaults: params({ lanes: 9, radialSpeed: 0.9 }),
    difficulty: diff([0.95, 0.95, 0.9, 1.0, 1.05, 1.05, 1.1, 1.15, 0.75, 1.1]) }),
  def({ id: 'delayed_ambush', name: 'Delayed Ambush', desc: 'A bait wave, then burrowers surface near radius 200.', shapeClass: 'ambush', minWave: 63,
    defaults: params({ lanes: 6 }),
    difficulty: diff([1.0, 1.15, 1.05, 1.2, 0.95, 1.25, 0.95, 0.85, 1.1, 1.0]) }),
  def({ id: 'annular_rush', name: 'Annular Rush', desc: 'A dense full ring rushing in fast.', shapeClass: 'rush', minWave: 15,
    defaults: params({ lanes: 20, radialSpeed: 1.35 }),
    difficulty: diff([1.15, 1.1, 1.0, 1.3, 0.75, 1.05, 1.1, 0.8, 0.95, 0.95]) }),
  def({ id: 'brute_column', name: 'Brute Column', desc: 'A single heavy file, biggest bodies in front.', shapeClass: 'column', minWave: 8,
    defaults: params({ lanes: 1 }),
    difficulty: diff([0.8, 1.0, 1.3, 0.75, 0.95, 1.0, 1.05, 1.05, 0.9, 1.15]) }),
  def({ id: 'packed_wedge', name: 'Packed Wedge', desc: 'A tight triangle driven straight in.', shapeClass: 'wedge', minWave: 5,
    defaults: params({ lanes: 1 }),
    difficulty: diff([0.75, 0.9, 0.9, 1.0, 1.0, 0.85, 1.15, 1.05, 1.1, 0.95]) }),
  def({ id: 'flank_pair', name: 'Flank Pair', desc: 'Two groups either side of the front, curling inward.', shapeClass: 'pincer', minWave: 9,
    defaults: params({ lanes: 2 }),
    difficulty: diff([1.2, 1.05, 1.0, 1.05, 1.0, 1.1, 0.75, 1.0, 1.1, 0.9]) }),
  def({ id: 'kamikaze_ring', name: 'Kamikaze Ring', desc: 'A ring that halts at mid-range, then dives together.', shapeClass: 'ring', minWave: 12,
    defaults: params({ lanes: 12 }),
    difficulty: diff([1.15, 1.1, 1.0, 1.35, 0.85, 1.05, 1.1, 0.75, 0.9, 0.9]) }),
  def({ id: 'cluster_drop', name: 'Cluster Drop', desc: 'Tight clusters dropped inside the perimeter.', shapeClass: 'cluster', minWave: 10,
    defaults: params({ lanes: 4 }),
    difficulty: diff([1.05, 0.85, 0.85, 0.95, 1.0, 0.7, 1.0, 1.2, 1.15, 1.0]) }),
  def({ id: 'staggered_lanes', name: 'Staggered Lanes', desc: 'Lanes that start one after another at slightly different speeds.', shapeClass: 'lanes', minWave: 3,
    defaults: params({ lanes: 6 }),
    difficulty: diff([0.95, 1.0, 1.05, 1.0, 0.95, 1.0, 1.0, 1.05, 0.95, 1.0]) }),

  // ---------------------------------------------------------------- Ascension III spatial (12)
  def({ id: 'double_helix', name: 'Double Helix', desc: 'Two interleaved spirals turning opposite ways.', shapeClass: 'spiral', minWave: 1, spatial: true,
    defaults: params({ lanes: 2, spread: 1 }),
    difficulty: diff([1.1, 0.85, 1.3, 1.0, 1.0, 0.95, 1.05, 1.0, 1.15, 0.95]) }),
  def({ id: 'figure_eight', name: 'Figure Eight', desc: 'Lanes weave across each other in figure-eight loops.', shapeClass: 'serpentine', minWave: 1, spatial: true,
    defaults: params({ lanes: 4 }),
    difficulty: diff([1.15, 0.9, 1.1, 1.0, 1.0, 1.1, 0.9, 1.0, 1.2, 0.95]) }),
  def({ id: 'orbit_lattice', name: 'Orbit Lattice', desc: 'Rings that orbit in alternating directions as they decay inward.', shapeClass: 'ring', minWave: 1, spatial: true,
    defaults: params({ lanes: 10, rotation: 0.09 }),
    difficulty: diff([1.05, 1.0, 0.95, 1.0, 0.95, 1.05, 1.0, 0.9, 0.85, 1.1]) }),
  def({ id: 'polygon_siege', name: 'Polygon Siege', desc: 'Enemies walk the edges of a shrinking polygon.', shapeClass: 'wall', minWave: 1, spatial: true,
    defaults: params({ lanes: 6 }),
    difficulty: diff([1.0, 1.0, 0.95, 1.05, 1.0, 1.05, 1.05, 1.1, 0.8, 1.0]) }),
  def({ id: 'gate_weave', name: 'Gate Weave', desc: 'Lanes swap angles mid-approach as if through gates.', shapeClass: 'lanes', minWave: 1, spatial: true,
    defaults: params({ lanes: 6 }),
    difficulty: diff([1.1, 1.0, 1.0, 1.0, 1.0, 1.15, 0.85, 1.0, 1.1, 0.9]) }),
  def({ id: 'tidal_ring', name: 'Tidal Ring', desc: 'A ring that breathes in and out while it closes.', shapeClass: 'ring', minWave: 1, spatial: true,
    defaults: params({ lanes: 14, tempo: 0.4 }),
    difficulty: diff([1.05, 1.0, 1.0, 1.05, 0.9, 1.05, 1.0, 0.95, 0.85, 1.05]) }),
  def({ id: 'spiral_arms', name: 'Spiral Arms', desc: 'Four to six galaxy arms wheeling inward.', shapeClass: 'spiral', minWave: 1, spatial: true,
    defaults: params({ lanes: 5, spread: 1.3 }),
    difficulty: diff([1.05, 0.8, 1.25, 0.95, 1.0, 0.9, 1.05, 1.0, 1.15, 1.0]) }),
  def({ id: 'hex_grid', name: 'Hex Grid', desc: 'Six walls advancing from the six hex directions.', shapeClass: 'wall', minWave: 1, spatial: true,
    defaults: params({ lanes: 7, radialSpeed: 0.9 }),
    difficulty: diff([0.95, 0.95, 0.9, 1.0, 1.05, 1.0, 1.1, 1.1, 0.8, 1.05]) }),
  def({ id: 'safe_corridor', name: 'Safe Corridor', desc: 'Everything arrives except along one corridor, which it squeezes toward.', shapeClass: 'crescent', minWave: 1, spatial: true,
    defaults: params({ lanes: 1, spread: 1 }),
    difficulty: diff([1.05, 0.95, 0.95, 1.0, 1.0, 0.95, 1.05, 1.05, 0.95, 0.9]) }),
  def({ id: 'barrier_maze', name: 'Barrier Maze', desc: 'Zig-zag paths as if threading a maze of barriers.', shapeClass: 'serpentine', minWave: 1, spatial: true,
    defaults: params({ lanes: 4 }),
    difficulty: diff([1.1, 0.9, 1.1, 0.95, 1.0, 1.05, 0.95, 1.05, 1.2, 1.0]) }),
  def({ id: 'mirror_lanes', name: 'Mirror Lanes', desc: 'Mirrored pairs of snaking lanes.', shapeClass: 'serpentine', minWave: 1, spatial: true,
    defaults: params({ lanes: 3 }),
    difficulty: diff([1.05, 0.9, 1.15, 1.0, 1.0, 1.05, 0.95, 1.0, 1.1, 0.95]) }),
  def({ id: 'hazard_bloom', name: 'Hazard Bloom', desc: 'Turning petals that bloom and fold around hazard fields.', shapeClass: 'flower', minWave: 1, spatial: true,
    defaults: params({ lanes: 6, radialSpeed: 0.9, rotation: 0.05 }),
    difficulty: diff([1.1, 0.9, 1.0, 1.0, 1.05, 1.05, 0.95, 1.0, 1.15, 0.9]) }),
];

export const FORMATION_BY_ID: Record<FormationId, FormationDef> = (() => {
  const r = {} as Record<FormationId, FormationDef>;
  for (const f of FORMATIONS) r[f.id] = f;
  return r;
})();

/** Median of a template's Difficulty Multipliers across archetypes. */
export function medianDifficulty(f: FormationDef): number {
  const v: number[] = [];
  for (const k of ARCHETYPES) v.push(f.difficulty[k] ?? 1);
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 === 0 ? (v[m - 1] + v[m]) / 2 : v[m];
}

/** Largest archetype multiplier in a template's table. */
export function maxDifficulty(f: FormationDef): number {
  let hi = 0;
  for (const k of ARCHETYPES) { const v = f.difficulty[k] ?? 1; if (v > hi) hi = v; }
  return hi;
}

/** §12 rule 2: a template is excluded when any archetype exceeds 1.5× its median. */
export function isFair(f: FormationDef): boolean { return maxDifficulty(f) <= 1.5 * medianDifficulty(f); }
