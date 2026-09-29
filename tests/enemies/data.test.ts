import { describe, it, expect } from 'vitest';
import type { BossId, EnemyKind, FormationId } from '../../src/sim/core/ids';
import { ENEMIES, KINDS, KIND_INDEX, ENEMY_BY_KIND, ENEMY_FLAG_BITS, enemyFlagBits, COUNTER_KINDS } from '../../src/sim/data/enemies';
import { BOSSES, BOSS_BY_ID, TELL_COUNTERS, bossForWave, graftSources, tellAttack } from '../../src/sim/data/bosses';
import { FORMATIONS, FORMATION_BY_ID, ARCHETYPES, medianDifficulty, maxDifficulty, isFair } from '../../src/sim/data/formations';
import { SECTORS, sectorForWave, INTRO_WAVE } from '../../src/sim/data/sectors';
import * as registry from '../../src/sim/data/index';

// Exhaustive lists: `satisfies Record<Union, true>` makes the compiler fail if a union member is missing.
const ALL_KINDS = Object.keys({
  grunt: true, swarm: true, runner: true, brute: true, kamikaze: true, shielded: true,
  splitter: true, carrier: true, healer: true, leech: true, veteran: true,
  armored: true, warden: true, artillery: true, charger: true, anchor: true,
  phase: true, burrower: true, nullifier: true, refractor: true, jammer: true,
  splitter_fragment: true, brood: true, clump: true, boss_add: true, boss: true,
} satisfies Record<EnemyKind, true>) as EnemyKind[];

const ALL_BOSSES = Object.keys({
  breaker: true, broodheart: true, warden: true, siege_engine: true, iron_maw: true,
  mirror_hive: true, storm_crown: true, distant_saint: true, leech_queen: true, splinter_king: true,
  null_engine: true, chronophage: true, hive_fortress: true, redline: true, grave_battery: true,
  event_horizon: true, architect: true, choir: true, last_procession: true, crown: true, deep_graft: true,
} satisfies Record<BossId, true>) as BossId[];

const ALL_FORMATIONS = Object.keys({
  radial_ring: true, tightening_spiral: true, alternating_spokes: true, crescent: true, rotating_wedge: true,
  twin_columns: true, expanding_flower: true, comet_tail: true, concentric_assault: true, synchronized_burst: true,
  serpentine: true, escort: true, scattered_rain: true, pincer: true, artillery_ring: true, moving_wall: true,
  delayed_ambush: true, annular_rush: true, brute_column: true, packed_wedge: true, flank_pair: true,
  kamikaze_ring: true, cluster_drop: true, staggered_lanes: true,
  double_helix: true, figure_eight: true, orbit_lattice: true, polygon_siege: true, gate_weave: true, tidal_ring: true,
  spiral_arms: true, hex_grid: true, safe_corridor: true, barrier_maze: true, mirror_lanes: true, hazard_bloom: true,
} satisfies Record<FormationId, true>) as FormationId[];

const ABILITY_IDS = ['hunter_mark', 'repulsor_pulse', 'time_field', 'bombardment', 'emp', 'overdrive', 'emergency_repair', 'drone_surge', 'missile_storm', 'singularity_bomb', 'designate'];
const inUnit = (c: number[]) => c.length === 3 && c.every((v) => v >= 0 && v <= 1);

describe('enemy data', () => {
  it('has exactly one def per EnemyKind and a stable index', () => {
    expect(ENEMIES.length).toBe(ALL_KINDS.length);
    for (const k of ALL_KINDS) expect(ENEMY_BY_KIND[k]?.kind).toBe(k);
    expect(new Set(KINDS).size).toBe(KINDS.length);
    expect([...KINDS].sort()).toEqual([...ALL_KINDS].sort());
    KINDS.forEach((k, i) => expect(KIND_INDEX[k]).toBe(i));
    expect(KINDS.length).toBeLessThan(256); // Uint8 pool storage
  });
  it('covers all 21 families across the five Sectors plus sub-units', () => {
    expect(ENEMIES.filter((e) => e.sector !== 'sub').length).toBe(21);
    for (const s of SECTORS) for (const k of s.introduces) expect(ENEMY_BY_KIND[k].sector).toBe(s.id);
  });
  it('uses the design k values', () => {
    const k: Partial<Record<EnemyKind, number>> = { swarm: 0.3, grunt: 1, runner: 0.7, brute: 4, kamikaze: 0.8, shielded: 1.2, splitter: 1.5, carrier: 3, healer: 1.2, leech: 1.5, veteran: 2.5, armored: 3, warden: 2, artillery: 1.5, charger: 2, anchor: 5, phase: 1.5, burrower: 1.8, nullifier: 2, refractor: 2.5, jammer: 2 };
    for (const [kind, v] of Object.entries(k)) expect(ENEMY_BY_KIND[kind as EnemyKind].hpMul).toBe(v);
    expect(ENEMY_BY_KIND.shielded.shieldMul).toBe(1);
    expect(ENEMY_BY_KIND.armored.armor).toBe(60);
    expect(ENEMY_BY_KIND.grunt.speed).toBe(40);
    expect(ENEMY_BY_KIND.grunt.contactDamage).toBe(8);
  });
  it('flags map to EnemyFlag names and colors are 0..1', () => {
    for (const e of ENEMIES) {
      for (const f of e.flags) expect(ENEMY_FLAG_BITS[f], `${e.kind} flag ${f}`).toBeGreaterThan(0);
      expect(inUnit(e.color), e.kind).toBe(true);
      expect(e.speed).toBeGreaterThan(0);
      expect(e.radius).toBeGreaterThan(0);
      expect(e.desc.length).toBeGreaterThan(5);
    }
    expect(enemyFlagBits(ENEMY_BY_KIND.anchor)).toBe(ENEMY_FLAG_BITS.Immovable);
    expect(enemyFlagBits(ENEMY_BY_KIND.healer)).toBe(ENEMY_FLAG_BITS.Healer | ENEMY_FLAG_BITS.Support);
  });
  it('silhouettes are unique within every Sector', () => {
    for (const s of SECTORS) {
      const shapes = ENEMIES.filter((e) => e.sector === s.id).map((e) => e.shape);
      expect(new Set(shapes).size, s.id).toBe(shapes.length);
    }
  });
  it('lists the six counter enemies', () => {
    expect([...COUNTER_KINDS].sort()).toEqual(['anchor', 'jammer', 'nullifier', 'phase', 'refractor', 'shielded']);
  });
});

describe('sector data', () => {
  it('has five Sectors of 20 waves with 0..1 palettes', () => {
    expect(SECTORS.length).toBe(5);
    SECTORS.forEach((s, i) => {
      expect(s.waves).toEqual([i * 20 + 1, i * 20 + 20]);
      for (const c of [s.palette.bg, s.palette.fg, s.palette.accent]) expect(inUnit(c)).toBe(true);
    });
  });
  it('sectorForWave maps waves to Sectors', () => {
    expect(sectorForWave(1).id).toBe('outskirts');
    expect(sectorForWave(20).id).toBe('outskirts');
    expect(sectorForWave(21).id).toBe('hive');
    expect(sectorForWave(60).id).toBe('bastion_line');
    expect(sectorForWave(61).id).toBe('fold');
    expect(sectorForWave(100).id).toBe('court');
    expect(sectorForWave(250).id).toBe('court');
  });
  it('introduces every family inside its own Sector', () => {
    for (const s of SECTORS) for (const k of s.introduces) {
      expect(INTRO_WAVE[k]).toBeGreaterThanOrEqual(s.waves[0]);
      expect(INTRO_WAVE[k]).toBeLessThanOrEqual(s.waves[1]);
    }
  });
});

describe('boss data', () => {
  it('has one def per BossId; ordinary bosses map to waves 5..100', () => {
    expect(BOSSES.length).toBe(ALL_BOSSES.length);
    for (const id of ALL_BOSSES) expect(BOSS_BY_ID[id]?.id).toBe(id);
    const waves = BOSSES.filter((b) => b.id !== 'deep_graft').map((b) => b.wave);
    expect(waves).toEqual(Array.from({ length: 20 }, (_, i) => (i + 1) * 5));
    for (const b of BOSSES) expect(b.wave % 5).toBe(0);
    for (let w = 5; w <= 100; w += 5) expect(BOSS_BY_ID[bossForWave(w) as BossId].wave).toBe(w);
    expect(bossForWave(105)).toBe('deep_graft');
    expect(bossForWave(17)).toBeNull();
  });
  it('finales have 3 phases, others 2, with descending hpFraction marks', () => {
    for (const b of BOSSES) {
      const finale = b.wave % 20 === 0 || b.id === 'deep_graft';
      expect(b.phases.length, b.id).toBe(finale ? 3 : 2);
      expect(b.phases[0].hpFraction).toBe(1);
      for (let i = 1; i < b.phases.length; i++) expect(b.phases[i].hpFraction).toBeLessThan(b.phases[i - 1].hpFraction);
      if (finale && b.id !== 'deep_graft') expect(b.hpMul).toBe(1.3);
      for (const ph of b.phases) expect(ph.attacks.length).toBeGreaterThan(0);
    }
  });
  it('tells use valid counters and windows; attacks start with a known tell', () => {
    for (const b of BOSSES) {
      expect(ABILITY_IDS).toContain(b.tell.counter);
      expect(b.tell.windowSeconds).toBeGreaterThanOrEqual(1);
      expect(b.tell.windowSeconds).toBeLessThanOrEqual(1.5);
      expect(b.tell.everySeconds).toBeGreaterThanOrEqual(8);
      expect(b.tell.everySeconds).toBeLessThanOrEqual(14);
      expect(inUnit(b.color)).toBe(true);
      if (b.id !== 'deep_graft') expect(tellAttack(b), b.id).not.toBeNull();
      if (b.id !== 'deep_graft' && b.id !== 'crown') expect(TELL_COUNTERS[tellAttack(b) as string]).toBe(b.tell.counter);
      for (const a of b.adds ?? []) expect(ENEMY_BY_KIND[a.kind]).toBeDefined();
    }
    for (const id of ['iron_maw', 'null_engine', 'choir'] as BossId[]) expect(BOSS_BY_ID[id].tell.counter).toBe('designate');
    for (const c of Object.values(TELL_COUNTERS)) expect(ABILITY_IDS).toContain(c);
  });
  it('graft sources are two distinct ordinary bosses', () => {
    for (let w = 105; w <= 2000; w += 5) {
      const [a, b] = graftSources(w);
      expect(a).not.toBe(b);
      expect(a).not.toBe('deep_graft');
      expect(b).not.toBe('deep_graft');
    }
  });
});

describe('formation data', () => {
  it('has one def per FormationId: 24 launch + 12 spatial', () => {
    expect(FORMATIONS.length).toBe(ALL_FORMATIONS.length);
    for (const id of ALL_FORMATIONS) expect(FORMATION_BY_ID[id]?.id).toBe(id);
    expect(FORMATIONS.filter((f) => !f.spatial).length).toBe(24);
    expect(FORMATIONS.filter((f) => f.spatial).length).toBe(12);
  });
  it('difficulty tables cover every archetype; radial ring is the 1.0 baseline', () => {
    for (const f of FORMATIONS) {
      for (const a of ARCHETYPES) {
        expect(f.difficulty[a], `${f.id}.${a}`).toBeGreaterThanOrEqual(0.7);
        expect(f.difficulty[a], `${f.id}.${a}`).toBeLessThanOrEqual(1.45);
      }
      expect(f.flatness).toBeGreaterThanOrEqual(0);
      expect(f.flatness).toBeLessThanOrEqual(1);
      expect(isFair(f)).toBe(maxDifficulty(f) <= 1.5 * medianDifficulty(f));
    }
    expect(FORMATION_BY_ID.radial_ring.flatness).toBe(1);
    for (const a of ARCHETYPES) expect(FORMATION_BY_ID.radial_ring.difficulty[a]).toBe(1);
  });
  it('follows the counter map for favored formations', () => {
    expect(FORMATION_BY_ID.twin_columns.difficulty.ballistics).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.packed_wedge.difficulty.ballistics).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.tightening_spiral.difficulty.fire).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.tightening_spiral.difficulty.lightning).toBeGreaterThanOrEqual(1.2);
    expect(FORMATION_BY_ID.comet_tail.difficulty.fire).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.alternating_spokes.difficulty.lightning).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.scattered_rain.difficulty.drones).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.brute_column.difficulty.poison).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.annular_rush.difficulty.frost).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.cluster_drop.difficulty.ordnance).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.flank_pair.difficulty.drones).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.kamikaze_ring.difficulty.blade).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.concentric_assault.difficulty.laser).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.moving_wall.difficulty.laser).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.pincer.difficulty.gravitics).toBeLessThanOrEqual(0.85);
    expect(FORMATION_BY_ID.artillery_ring.difficulty.blade).toBeGreaterThanOrEqual(1.2);
  });
});

describe('registry', () => {
  it('data/index re-exports the WP4 tables', () => {
    expect(registry.ENEMIES).toBe(ENEMIES);
    expect(registry.BOSSES).toBe(BOSSES);
    expect(registry.FORMATIONS).toBe(FORMATIONS);
    expect(registry.SECTORS).toBe(SECTORS);
  });
});
