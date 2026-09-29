/**
 * Enemy families (design §12, §17). HP is EnemyHP(w) = 10 * 1.13^w * hpMul; Scrap is
 * ScrapPerKill(w) = 1.11^w * scrapMul; contactDamage scales ×1.06^w; `threat` is the
 * Threat Budget cost the wave generator spends.
 *
 * Silhouettes: enemies read by shape first. The Shape enum has 12 silhouettes for 21
 * families, so shapes are unique within every Sector, and a shape reused across Sectors
 * always differs in size and Sector color.
 *
 * The enemy pool stores `kind` as KIND_INDEX[kind] (Uint8).
 */
import type { EnemyKind } from '../core/ids';
import { EnemyFlag, Shape } from '../core/types';
import type { EnemyDef } from './schema';

type RGB = [number, number, number];

// Sector palettes (fg family) — variations per enemy keep neighbours distinguishable.
const AMBER: RGB = [1.00, 0.72, 0.22];
const AMBER_LIGHT: RGB = [1.00, 0.86, 0.46];
const AMBER_DEEP: RGB = [0.95, 0.52, 0.14];
const AMBER_RED: RGB = [1.00, 0.36, 0.18];
const AMBER_PALE: RGB = [0.98, 0.93, 0.70];
const GREEN: RGB = [0.68, 1.00, 0.20];
const GREEN_LIGHT: RGB = [0.86, 1.00, 0.52];
const GREEN_TEAL: RGB = [0.32, 0.95, 0.58];
const GREEN_DEEP: RGB = [0.45, 0.78, 0.10];
const GREEN_YELLOW: RGB = [0.90, 0.95, 0.18];
const STEEL: RGB = [0.46, 0.66, 0.92];
const STEEL_LIGHT: RGB = [0.72, 0.84, 1.00];
const STEEL_DEEP: RGB = [0.28, 0.46, 0.80];
const STEEL_CYAN: RGB = [0.40, 0.86, 0.96];
const STEEL_GREY: RGB = [0.62, 0.68, 0.76];
const VIOLET: RGB = [0.70, 0.40, 1.00];
const VIOLET_LIGHT: RGB = [0.90, 0.70, 1.00];
const VIOLET_DEEP: RGB = [0.50, 0.22, 0.90];
const VIOLET_PINK: RGB = [1.00, 0.46, 0.90];
const GOLD: RGB = [1.00, 0.84, 0.36];
const WHITE: RGB = [0.96, 0.96, 1.00];
const RED: RGB = [1.00, 0.24, 0.24];

/** Threat ≈ hpMul × speed factor (+ a premium for support/aura roles). */
function threat(hpMul: number, speed: number, premium = 1): number {
  const t = hpMul * (0.6 + 0.4 * speed / 40) * premium;
  return Math.round(t * 100) / 100;
}

export const ENEMIES: EnemyDef[] = [
  // ------------------------------------------------------------------ Outskirts
  {
    kind: 'grunt', name: 'Grunt', sector: 'outskirts',
    hpMul: 1, speed: 40, radius: 9, armor: 0, shieldMul: 0, scrapMul: 1, threat: threat(1, 40), contactDamage: 8,
    behavior: 'advance', flags: [], shape: Shape.Triangle, color: AMBER,
    desc: 'The baseline. Walks straight at the tower and hits it.',
  },
  {
    kind: 'swarm', name: 'Swarm', sector: 'outskirts',
    hpMul: 0.3, speed: 55, radius: 5, armor: 0, shieldMul: 0, scrapMul: 0.3, threat: threat(0.3, 55), contactDamage: 3,
    behavior: 'swarm', flags: [], shape: Shape.Circle, color: AMBER_LIGHT,
    desc: 'Tiny and numerous; arrives in packs and jitters around the pack center. Dies before damage-over-time matters.',
  },
  {
    kind: 'runner', name: 'Runner', sector: 'outskirts',
    hpMul: 0.7, speed: 90, radius: 7, armor: 0, shieldMul: 0, scrapMul: 0.7, threat: threat(0.7, 90), contactDamage: 5,
    behavior: 'runner', flags: [], shape: Shape.Shard, color: AMBER_PALE,
    desc: 'Fast and fragile. Outruns burning ground and slow projectiles.',
  },
  {
    kind: 'brute', name: 'Brute', sector: 'outskirts',
    hpMul: 4, speed: 25, radius: 16, armor: 10, shieldMul: 0, scrapMul: 4, threat: threat(4, 25), contactDamage: 20,
    behavior: 'advance', flags: [], shape: Shape.Square, color: AMBER_DEEP,
    desc: 'Slow, heavy, lightly armored. A lone Brute gives chain lightning nothing to jump to.',
  },
  {
    kind: 'kamikaze', name: 'Kamikaze', sector: 'outskirts',
    hpMul: 0.8, speed: 70, radius: 8, armor: 0, shieldMul: 0, scrapMul: 0.8, threat: threat(0.8, 70, 1.15), contactDamage: 30,
    behavior: 'kamikaze', flags: ['Kamikaze'], shape: Shape.Star, color: AMBER_RED,
    desc: 'Accelerates in the inner ring and detonates on contact for heavy damage.',
  },
  {
    kind: 'shielded', name: 'Shielded', sector: 'outskirts',
    hpMul: 1.2, speed: 35, radius: 10, armor: 0, shieldMul: 1, scrapMul: 1.5, threat: threat(1.2, 35, 1.3), contactDamage: 9,
    behavior: 'advance', flags: [], shape: Shape.Hex, color: AMBER_LIGHT,
    desc: 'Carries a shield equal to its HP. Shields ignore statuses until broken; counters plain Ballistics.',
  },
  // ------------------------------------------------------------------ The Hive
  {
    kind: 'splitter', name: 'Splitter', sector: 'hive',
    hpMul: 1.5, speed: 38, radius: 11, armor: 0, shieldMul: 0, scrapMul: 1.5, threat: threat(1.5, 38, 1.3), contactDamage: 10,
    behavior: 'advance', flags: [], shape: Shape.Diamond, color: GREEN,
    desc: 'Splits into three fragments on death.',
  },
  {
    kind: 'carrier', name: 'Carrier', sector: 'hive',
    hpMul: 3, speed: 28, radius: 15, armor: 5, shieldMul: 0, scrapMul: 3, threat: threat(3, 28, 1.4), contactDamage: 12,
    behavior: 'support', flags: ['Support'], shape: Shape.Capsule, color: GREEN_DEEP,
    desc: 'Releases brood every few seconds while it lives.',
  },
  {
    kind: 'healer', name: 'Healer', sector: 'hive',
    hpMul: 1.2, speed: 36, radius: 9, armor: 0, shieldMul: 0, scrapMul: 1.5, threat: threat(1.2, 36, 1.5), contactDamage: 5,
    behavior: 'support', auraRadius: 90, flags: ['Healer', 'Support'], shape: Shape.Cross, color: GREEN_TEAL,
    desc: 'Hangs behind the pack and heals nearby enemies.',
  },
  {
    kind: 'leech', name: 'Leech', sector: 'hive',
    hpMul: 1.5, speed: 50, radius: 9, armor: 0, shieldMul: 0, scrapMul: 1.5, threat: threat(1.5, 50), contactDamage: 6,
    behavior: 'advance', flags: [], shape: Shape.Crescent, color: GREEN_YELLOW,
    desc: 'Latches onto the tower and drains shield and barrier, healing itself.',
  },
  {
    kind: 'veteran', name: 'Veteran', sector: 'hive',
    hpMul: 2.5, speed: 42, radius: 12, armor: 15, shieldMul: 0, scrapMul: 2.5, threat: threat(2.5, 42), contactDamage: 14,
    behavior: 'advance', flags: [], shape: Shape.Triangle, color: GREEN_LIGHT,
    desc: 'A hardened grunt with armor. Frequently elite.',
  },
  // ------------------------------------------------------------------ The Bastion Line
  {
    kind: 'armored', name: 'Armored', sector: 'bastion_line',
    hpMul: 3, speed: 26, radius: 14, armor: 60, shieldMul: 0, scrapMul: 3, threat: threat(3, 26, 1.1), contactDamage: 16,
    behavior: 'advance', flags: [], shape: Shape.Square, color: STEEL_GREY,
    desc: 'Heavy plate: 60 armor blunts small, fast hits. Statuses and big hits go through.',
  },
  {
    kind: 'warden', name: 'Warden', sector: 'bastion_line',
    hpMul: 2, speed: 32, radius: 12, armor: 10, shieldMul: 0.5, scrapMul: 2.5, threat: threat(2, 32, 1.5), contactDamage: 8,
    behavior: 'aura', auraRadius: 110, flags: ['Shielder', 'Support'], shape: Shape.Ring, color: STEEL_LIGHT,
    desc: 'Projects shields onto enemies inside its ring.',
  },
  {
    kind: 'artillery', name: 'Artillery', sector: 'bastion_line',
    hpMul: 1.5, speed: 30, radius: 12, armor: 5, shieldMul: 0, scrapMul: 1.8, threat: threat(1.5, 30, 1.4), contactDamage: 12,
    behavior: 'ranged', flags: ['Ranged'], shape: Shape.Line, color: STEEL_CYAN,
    desc: 'Stops outside the melee ring and shells the tower. Punishes Blade builds.',
  },
  {
    kind: 'charger', name: 'Charger', sector: 'bastion_line',
    hpMul: 2, speed: 35, radius: 13, armor: 20, shieldMul: 0, scrapMul: 2, threat: threat(2, 60), contactDamage: 18,
    behavior: 'charger', flags: [], shape: Shape.Shard, color: STEEL_DEEP,
    desc: 'Walks, winds up, then bursts forward at four times its speed.',
  },
  {
    kind: 'anchor', name: 'Anchor', sector: 'bastion_line',
    hpMul: 5, speed: 20, radius: 18, armor: 40, shieldMul: 0, scrapMul: 5, threat: threat(5, 20), contactDamage: 25,
    behavior: 'anchor', flags: ['Immovable'], shape: Shape.Hex, color: STEEL,
    desc: 'Immune to pull, knockback and freeze; Chill slows it at half effect.',
  },
  // ------------------------------------------------------------------ The Fold
  {
    kind: 'phase', name: 'Phase', sector: 'fold',
    hpMul: 1.5, speed: 45, radius: 10, armor: 0, shieldMul: 0, scrapMul: 1.8, threat: threat(1.5, 45, 1.2), contactDamage: 10,
    behavior: 'phase', flags: [], shape: Shape.Circle, color: VIOLET_LIGHT,
    desc: 'Blinks intangible on a rhythm; projectiles pass through it while phased.',
  },
  {
    kind: 'burrower', name: 'Burrower', sector: 'fold',
    hpMul: 1.8, speed: 40, radius: 10, armor: 10, shieldMul: 0, scrapMul: 1.8, threat: threat(1.8, 40, 1.15), contactDamage: 12,
    behavior: 'burrower', flags: [], shape: Shape.Crescent, color: VIOLET,
    desc: 'Travels underground and surfaces close to the tower.',
  },
  {
    kind: 'nullifier', name: 'Nullifier', sector: 'fold',
    hpMul: 2, speed: 34, radius: 11, armor: 5, shieldMul: 0, scrapMul: 2.2, threat: threat(2, 34, 1.4), contactDamage: 8,
    behavior: 'aura', auraRadius: 100, flags: ['Nullifies', 'Support'], shape: Shape.Cross, color: VIOLET_DEEP,
    desc: 'Strips statuses from enemies inside its field. Counters Fire.',
  },
  {
    kind: 'refractor', name: 'Refractor', sector: 'fold',
    hpMul: 2.5, speed: 30, radius: 13, armor: 20, shieldMul: 0, scrapMul: 2.5, threat: threat(2.5, 30, 1.1), contactDamage: 12,
    behavior: 'advance', flags: ['Refracts'], shape: Shape.Diamond, color: VIOLET_PINK,
    desc: 'Deflects laser beams and takes 70% less beam damage.',
  },
  // ------------------------------------------------------------------ The Court
  {
    kind: 'jammer', name: 'Jammer', sector: 'court',
    hpMul: 2, speed: 36, radius: 11, armor: 10, shieldMul: 0.25, scrapMul: 2.2, threat: threat(2, 36, 1.4), contactDamage: 8,
    behavior: 'aura', auraRadius: 140, flags: ['Jams', 'Support'], shape: Shape.Star, color: GOLD,
    desc: 'Inside its radius drones lose targeting and missiles fly straight.',
  },
  // ------------------------------------------------------------------ Sub-units
  {
    kind: 'splitter_fragment', name: 'Fragment', sector: 'sub',
    hpMul: 0.4, speed: 60, radius: 6, armor: 0, shieldMul: 0, scrapMul: 0.2, threat: threat(0.4, 60), contactDamage: 4,
    behavior: 'swarm', flags: [], shape: Shape.Shard, color: GREEN_LIGHT,
    desc: 'A piece of a Splitter.',
  },
  {
    kind: 'brood', name: 'Brood', sector: 'sub',
    hpMul: 0.2, speed: 65, radius: 4, armor: 0, shieldMul: 0, scrapMul: 0.1, threat: threat(0.2, 65), contactDamage: 2,
    behavior: 'swarm', flags: [], shape: Shape.Circle, color: GREEN_YELLOW,
    desc: 'Hatchlings released by Carriers and Broodheart.',
  },
  {
    kind: 'clump', name: 'Clump', sector: 'sub',
    hpMul: 1, speed: 36, radius: 14, armor: 0, shieldMul: 0, scrapMul: 1, threat: threat(1, 36), contactDamage: 10,
    behavior: 'advance', flags: ['Clump'], shape: Shape.Hex, color: WHITE,
    desc: 'Several swarm bodies merged past the entity budget; HP (hpScale) replaces count.',
  },
  {
    kind: 'boss_add', name: 'Retainer', sector: 'sub',
    hpMul: 1.5, speed: 45, radius: 10, armor: 10, shieldMul: 0, scrapMul: 1, threat: threat(1.5, 45), contactDamage: 10,
    behavior: 'advance', flags: [], shape: Shape.Triangle, color: RED,
    desc: 'Generic minion summoned by boss scripts.',
  },
  {
    kind: 'boss', name: 'Boss', sector: 'sub',
    hpMul: 12, speed: 18, radius: 40, armor: 20, shieldMul: 0, scrapMul: 20, threat: 0, contactDamage: 40,
    behavior: 'advance', flags: ['Boss'], shape: Shape.Star, color: RED,
    desc: 'Placeholder def for the pool; real stats come from BOSSES by bossId.',
  },
];

/** Stable kind order (the pool stores this index). Append only; never reorder. */
export const KINDS: EnemyKind[] = [
  'grunt', 'swarm', 'runner', 'brute', 'kamikaze', 'shielded',
  'splitter', 'carrier', 'healer', 'leech', 'veteran',
  'armored', 'warden', 'artillery', 'charger', 'anchor',
  'phase', 'burrower', 'nullifier', 'refractor',
  'jammer',
  'splitter_fragment', 'brood', 'clump', 'boss_add',
  'boss',
];

export const KIND_INDEX: Record<EnemyKind, number> = (() => {
  const r = {} as Record<EnemyKind, number>;
  for (let i = 0; i < KINDS.length; i++) r[KINDS[i]] = i;
  return r;
})();

/** Enemy defs by kind (and by pool index via ENEMY_BY_INDEX). */
export const ENEMY_BY_KIND: Record<EnemyKind, EnemyDef> = (() => {
  const r = {} as Record<EnemyKind, EnemyDef>;
  for (const d of ENEMIES) r[d.kind] = d;
  return r;
})();
export const ENEMY_BY_INDEX: EnemyDef[] = KINDS.map((k) => ENEMY_BY_KIND[k]);

/** EnemyFlag bit for each flag name used in EnemyDef.flags. */
export const ENEMY_FLAG_BITS: Record<string, number> = {
  Elite: EnemyFlag.Elite, Boss: EnemyFlag.Boss, Immovable: EnemyFlag.Immovable, Phased: EnemyFlag.Phased,
  Burrowed: EnemyFlag.Burrowed, Refracts: EnemyFlag.Refracts, Jams: EnemyFlag.Jams, Nullifies: EnemyFlag.Nullifies,
  Shielder: EnemyFlag.Shielder, Healer: EnemyFlag.Healer, Kamikaze: EnemyFlag.Kamikaze, Ranged: EnemyFlag.Ranged,
  Support: EnemyFlag.Support, WeakPointOpen: EnemyFlag.WeakPointOpen, Reviving: EnemyFlag.Reviving, Dead: EnemyFlag.Dead,
  Clump: EnemyFlag.Clump, Ally: EnemyFlag.Ally,
};

/** Spawn-time EnemyFlag bitfield for a def. */
export function enemyFlagBits(def: EnemyDef): number {
  let bits = 0;
  for (const f of def.flags) bits |= ENEMY_FLAG_BITS[f] ?? 0;
  return bits;
}

/** Kinds that exist to counter specific systems (capped share of a wave's budget, §12). */
export const COUNTER_KINDS: EnemyKind[] = ['anchor', 'refractor', 'jammer', 'nullifier', 'phase', 'shielded'];
