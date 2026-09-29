/**
 * Sectors (design §12): waves 1–100 are five Sectors of 20 waves, each introducing
 * enemies, a palette and a finale boss. Deep Waves (101+) stay in The Court palette
 * and draw from the full roster.
 */
import type { EnemyKind, SectorId } from '../core/ids';
import type { SectorDef } from './schema';

export const SECTORS: SectorDef[] = [
  {
    id: 'outskirts', name: 'The Outskirts', waves: [1, 20],
    introduces: ['grunt', 'swarm', 'runner', 'brute', 'kamikaze', 'shielded'],
    // Amber on charcoal
    palette: { bg: [0.09, 0.09, 0.10], fg: [1.00, 0.72, 0.22], accent: [1.00, 0.46, 0.16] },
  },
  {
    id: 'hive', name: 'The Hive', waves: [21, 40],
    introduces: ['splitter', 'carrier', 'healer', 'leech', 'veteran'],
    // Acid green on dark olive
    palette: { bg: [0.11, 0.13, 0.06], fg: [0.68, 1.00, 0.20], accent: [0.90, 1.00, 0.45] },
  },
  {
    id: 'bastion_line', name: 'The Bastion Line', waves: [41, 60],
    introduces: ['armored', 'warden', 'artillery', 'charger', 'anchor'],
    // Steel blue on slate
    palette: { bg: [0.15, 0.18, 0.23], fg: [0.46, 0.66, 0.92], accent: [0.72, 0.84, 1.00] },
  },
  {
    id: 'fold', name: 'The Fold', waves: [61, 80],
    introduces: ['phase', 'burrower', 'nullifier', 'refractor'],
    // Violet on black
    palette: { bg: [0.02, 0.01, 0.04], fg: [0.70, 0.40, 1.00], accent: [0.92, 0.62, 1.00] },
  },
  {
    id: 'court', name: 'The Court', waves: [81, 100],
    introduces: ['jammer'],
    // Gold and white on navy
    palette: { bg: [0.04, 0.07, 0.19], fg: [1.00, 0.84, 0.36], accent: [0.96, 0.96, 1.00] },
  },
];

const SECTOR_ORDER: SectorId[] = ['outskirts', 'hive', 'bastion_line', 'fold', 'court'];

/** Sector index 0..4 for a wave (Deep Waves stay in The Court). */
export function sectorIndexForWave(w: number): number {
  if (w <= 20) return 0;
  if (w <= 40) return 1;
  if (w <= 60) return 2;
  if (w <= 80) return 3;
  return 4;
}

/** The Sector a wave belongs to (Deep Waves 101+ report The Court). */
export function sectorForWave(w: number): SectorDef {
  return SECTORS[sectorIndexForWave(w)];
}

export function sectorIndex(id: SectorId): number { return SECTOR_ORDER.indexOf(id); }

/**
 * First wave each enemy can appear. A Sector introduces its families gradually so
 * each one gets a few waves of spotlight before the next arrives.
 */
export const INTRO_WAVE: Record<EnemyKind, number> = {
  grunt: 1, swarm: 2, runner: 4, brute: 7, kamikaze: 11, shielded: 13,
  splitter: 21, carrier: 23, healer: 26, leech: 29, veteran: 32,
  armored: 41, warden: 43, artillery: 46, charger: 49, anchor: 52,
  phase: 61, burrower: 63, nullifier: 66, refractor: 69,
  jammer: 81,
  // Sub-units are spawned by other enemies / bosses / the clump merger, never rostered directly.
  splitter_fragment: 9999, brood: 9999, clump: 9999, boss_add: 9999, boss: 9999,
};
