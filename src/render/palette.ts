/**
 * Palettes, element colors and status icon shapes (design §12, §20).
 *
 * Readability rules encoded here:
 *  - Statuses are identified by SHAPE first (flame, bolt, droplet, flake), never hue alone.
 *  - Element colors are derived from the Okabe-Ito colorblind-safe set and differ in luminance
 *    as well as hue (orange/yellow/bluish-green/sky-blue).
 *  - Each Sector has a palette of a bright enemy color on a dark floor so enemies read by
 *    silhouette and luminance contrast, color second.
 * All colors are sRGB floats in 0..1 (the shader does no gamma conversion).
 */
import { Shape } from '@sim/core/types';
import type { ElementId, StatusId } from '@sim/core/ids';

export type RGB = readonly [number, number, number];

export const ELEMENT_ORDER: readonly ElementId[] = ['fire', 'lightning', 'poison', 'frost'];

export const ELEMENT_COLORS: Readonly<Record<ElementId, RGB>> = {
  fire: [1.0, 0.56, 0.16],       // vermillion/orange
  lightning: [0.98, 0.93, 0.36], // yellow
  poison: [0.28, 0.9, 0.6],      // bluish green
  frost: [0.4, 0.78, 1.0],       // sky blue
};

export const NEUTRAL_COLOR: RGB = [0.92, 0.94, 1.0];
export const GOLD: RGB = [1.0, 0.82, 0.3];
export const WARNING_COLOR: RGB = [1.0, 0.3, 0.3];
export const THREAT_HALO_COLOR: RGB = [1.0, 0.36, 0.3];

/**
 * Element -> color. Accepts an ElementId or the numeric encoding used by the projectile pool
 * (`element`: ElementId index + 1, 0 = none). Returns a shared constant tuple (no allocation).
 */
export function elementColor(el: ElementId | number | null | undefined): RGB {
  if (el === null || el === undefined) return NEUTRAL_COLOR;
  if (typeof el === 'number') {
    const id = ELEMENT_ORDER[el - 1];
    return id === undefined ? NEUTRAL_COLOR : ELEMENT_COLORS[id];
  }
  return ELEMENT_COLORS[el] ?? NEUTRAL_COLOR;
}

/**
 * Status icon shapes. Drawn as small layer-7 instances above an enemy.
 *   burn -> flame (triangle), shock -> bolt (shard), poison -> droplet (small circle),
 *   chill -> flake (star), bleed -> crescent, brittle -> diamond, marked -> cross, static -> ring.
 */
export const STATUS_SHAPES: Readonly<Record<StatusId, Shape>> = {
  burn: Shape.Triangle,
  shock: Shape.Shard,
  poison: Shape.Circle,
  chill: Shape.Star,
  bleed: Shape.Crescent,
  brittle: Shape.Diamond,
  marked: Shape.Cross,
  static: Shape.Ring,
};
export const STATUS_GLYPH: Readonly<Record<StatusId, string>> = {
  burn: 'flame', shock: 'bolt', poison: 'droplet', chill: 'flake',
  bleed: 'crescent', brittle: 'diamond', marked: 'cross', static: 'ring',
};
export function statusShape(id: StatusId): Shape { return STATUS_SHAPES[id]; }

export interface SectorPalette {
  id: number;
  name: string;
  /** Outside the arena. */
  bg: RGB;
  /** Arena floor at the center and at the rim. */
  floorCenter: RGB;
  floorEdge: RGB;
  /** Faint concentric rings and spokes. */
  grid: RGB;
  /** Arena boundary. */
  rim: RGB;
  /** Suggested enemy body colors and outline for the sim/dev harness. */
  enemy: RGB;
  enemyAlt: RGB;
  outline: RGB;
}

const BG: RGB = [0.043, 0.051, 0.071]; // #0b0d12

export const SECTOR_PALETTES: readonly SectorPalette[] = [
  { id: 0, name: 'Outskirts', bg: BG, floorCenter: [0.165, 0.155, 0.145], floorEdge: [0.095, 0.09, 0.092],
    grid: [0.5, 0.36, 0.16], rim: [0.95, 0.66, 0.2], enemy: [1.0, 0.72, 0.22], enemyAlt: [0.95, 0.5, 0.18], outline: [1.0, 0.93, 0.8] },
  { id: 1, name: 'The Hive', bg: BG, floorCenter: [0.115, 0.14, 0.065], floorEdge: [0.065, 0.085, 0.045],
    grid: [0.36, 0.5, 0.14], rim: [0.66, 0.92, 0.22], enemy: [0.74, 0.96, 0.26], enemyAlt: [0.5, 0.8, 0.2], outline: [0.94, 1.0, 0.8] },
  { id: 2, name: 'The Bastion Line', bg: BG, floorCenter: [0.125, 0.15, 0.2], floorEdge: [0.075, 0.09, 0.13],
    grid: [0.28, 0.4, 0.58], rim: [0.5, 0.7, 0.98], enemy: [0.6, 0.76, 0.98], enemyAlt: [0.4, 0.56, 0.88], outline: [0.9, 0.96, 1.0] },
  { id: 3, name: 'The Fold', bg: BG, floorCenter: [0.095, 0.06, 0.14], floorEdge: [0.048, 0.03, 0.08],
    grid: [0.42, 0.28, 0.64], rim: [0.72, 0.5, 1.0], enemy: [0.8, 0.58, 1.0], enemyAlt: [0.62, 0.42, 0.96], outline: [0.96, 0.9, 1.0] },
  { id: 4, name: 'The Court', bg: BG, floorCenter: [0.085, 0.11, 0.24], floorEdge: [0.05, 0.065, 0.15],
    grid: [0.55, 0.5, 0.3], rim: [1.0, 0.86, 0.4], enemy: [1.0, 0.87, 0.42], enemyAlt: [0.96, 0.96, 1.0], outline: [1.0, 1.0, 0.92] },
];

/** Sector index (0-4) for a wave number (1-based, 20 waves per Sector; Deep Waves stay on The Court). */
export function sectorIndexForWave(wave: number): number {
  const i = Math.floor((wave - 1) / 20);
  return i < 0 ? 0 : i > 4 ? 4 : i;
}
