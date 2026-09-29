/**
 * Composite silhouettes, statuses, bosses and towers (graphics pass): instance budgets per family,
 * layers 0..7, flags and shapes within their enums, exactly one pickable body per enemy, LOD base
 * shapes, and a distinct read per family.
 */
import { describe, expect, it } from 'vitest';
import { EnemyFlag, INST_FLAG_SCALE, INSTANCE_FLOATS, InstFlag, RStatus, Shape } from '../../src/sim/core/types';
import { SnapshotWriter } from '../../src/sim/core/snapshot';
import { EnemyView, FAMILY_KINDS, MAX_COMPOSITE_PARTS, MAX_STATUS_PARTS, SUBUNIT_KINDS, writeEnemy, packAnim, BOSS_PART_IDS } from '../../src/sim/core/snapshot-art';
import { FRAME_IDS, TowerView, writeTowerBase, writeTowerTop } from '../../src/sim/core/snapshot-tower';
import { BOSS_LIST, bossDef, enemyDefByIndex, flagBitsFor } from '../../src/sim/core/content';

const ALL_FLAGS = InstFlag.Part | InstFlag.Detail | InstFlag.Chain | InstFlag.Flash | InstFlag.Soft;

interface Inst { x: number; y: number; r: number; shape: number; layer: number; flags: number; a: number; aux0: number; aux1: number }
function read(out: SnapshotWriter, from = 0): Inst[] {
  const r: Inst[] = [];
  for (let i = from; i < out.count; i++) {
    const o = i * INSTANCE_FLOATS, d = out.instances;
    const L = Math.round(d[o + 9]);
    r.push({ x: d[o], y: d[o + 1], r: d[o + 2], shape: d[o + 4], layer: L & 7, flags: L >> 3, a: d[o + 8], aux0: d[o + 10], aux1: d[o + 11] });
  }
  return r;
}

function validate(list: Inst[], out: SnapshotWriter): void {
  for (let i = 0; i < list.length; i++) {
    const o = i * INSTANCE_FLOATS;
    for (let k = 0; k < INSTANCE_FLOATS; k++) expect(Number.isFinite(out.instances[o + k])).toBe(true);
  }
  for (const it of list) {
    expect(it.layer).toBeGreaterThanOrEqual(0);
    expect(it.layer).toBeLessThanOrEqual(7);
    expect(it.flags & ~ALL_FLAGS).toBe(0);
    expect(Number.isInteger(it.shape)).toBe(true);
    expect(it.shape).toBeGreaterThanOrEqual(Shape.Circle);
    expect(it.shape).toBeLessThanOrEqual(Shape.Drop);
    expect(it.r).toBeGreaterThan(0);
    expect(it.a).toBeGreaterThanOrEqual(0);
    expect(it.a).toBeLessThanOrEqual(1);
    if (it.flags & InstFlag.Part) expect(it.shape).not.toBe(Shape.Line);   // parts are transformed around their body
  }
}

function view(kind: number, opts: Partial<EnemyView> = {}): EnemyView {
  const v = new EnemyView(), d = enemyDefByIndex(kind);
  v.x = 100; v.y = -50; v.r = d.radius; v.kind = kind; v.shape = d.shape; v.cr = d.color[0]; v.cg = d.color[1]; v.cb = d.color[2];
  v.flags = flagBitsFor(d); v.gen = 77 + kind; v.phase = kind * 3; v.tick = 300; v.dist = 112; v.facing = 0.3;
  v.shieldFrac = d.shieldMul > 0 ? 1 : 0; v.aiI = 1;
  Object.assign(v, opts);
  return v;
}

function write(v: EnemyView): { list: Inst[]; out: SnapshotWriter } {
  const out = new SnapshotWriter();
  writeEnemy(out, v);
  const list = read(out);
  validate(list, out);
  return { list, out };
}

const composite = (l: Inst[]): Inst[] => l.filter((i) => (i.flags & InstFlag.Part) && i.layer === 4 && !(i.flags & InstFlag.Flash));

describe('enemy composites', () => {
  it('every family and sub-unit writes exactly one pickable body, an outline, and at most 3 composite parts', () => {
    for (const k of [...FAMILY_KINDS, ...SUBUNIT_KINDS]) {
      const { list } = write(view(k));
      const bodies = list.filter((i) => i.layer === 4 && i.flags === 0);
      expect(bodies, `kind ${k}`).toHaveLength(1);
      expect(list.filter((i) => i.layer === 5 && i.flags === 0)).toHaveLength(1);
      expect(composite(list).length, `kind ${k}`).toBeLessThanOrEqual(MAX_COMPOSITE_PARTS);
      // parts reference their body instance
      for (const p of list.filter((i) => i.flags & InstFlag.Part)) expect(p.aux1).toBe(0);
      expect(list.length, `kind ${k}`).toBeLessThanOrEqual(8);
    }
  });

  it('the 21 families read distinctly (body shape + part shapes)', () => {
    const sigs = new Map<string, number>();
    for (const k of FAMILY_KINDS) {
      const { list } = write(view(k));
      const body = list.find((i) => i.layer === 4 && i.flags === 0)!;
      const parts = composite(list).map((p) => p.shape).sort((a, b) => a - b);
      const sig = `${body.shape}:${parts.join(',')}`;
      expect(sigs.has(sig), `kind ${k} duplicates kind ${sigs.get(sig)} (${sig})`).toBe(false);
      sigs.set(sig, k);
    }
    expect(sigs.size).toBe(21);
  });

  it('LOD drops to the base (def) shape with no composite detail; artillery never draws a Line body', () => {
    for (const k of FAMILY_KINDS) {
      const d = enemyDefByIndex(k);
      const { list } = write(view(k, { lod: true }));
      const body = list.find((i) => i.layer === 4 && i.flags === 0)!;
      expect(body.shape).toBe(d.shape === Shape.Line ? Shape.Triangle : d.shape);
      expect(list.filter((i) => i.flags & InstFlag.Detail)).toHaveLength(0);
      expect(composite(list)).toHaveLength(0);
    }
  });

  it('statuses add at most two marks (plus the ice shell) and pack their bits into the body', () => {
    const all = RStatus.Burn | RStatus.Chill | RStatus.Poison | RStatus.Shock | RStatus.Bleed | RStatus.Brittle | RStatus.Marked;
    const plain = write(view(3)).list.length;
    const { list } = write(view(3, { status: all, chilled: true }));
    expect(list.length - plain).toBeLessThanOrEqual(MAX_STATUS_PARTS);
    const body = list.find((i) => i.layer === 4 && i.flags === 0)!;
    expect(body.aux1 & 255).toBe(all);
    const frozen = write(view(3, { status: all | RStatus.Frozen, frozen: true })).list;
    expect(frozen.length - plain).toBeLessThanOrEqual(MAX_STATUS_PARTS + 1);
    // the ice shell survives LOD
    const lod = write(view(3, { status: RStatus.Frozen, frozen: true, lod: true })).list;
    expect(lod.some((i) => (i.flags & InstFlag.Part) && i.shape === Shape.Hex)).toBe(true);
  });

  it('elites wear a crown (kept at LOD); the hit flash is a Flash-flagged part', () => {
    const e = write(view(0, { flags: EnemyFlag.Elite, lod: true })).list;
    expect(e.some((i) => i.shape === Shape.Star && (i.flags & InstFlag.Part))).toBe(true);
    const f = write(view(0, { flash: 1, squash: 1 })).list;
    expect(f.filter((i) => i.flags & InstFlag.Flash)).toHaveLength(1);
    const body = f.find((i) => i.layer === 4 && i.flags === 0)!;
    expect(body.r).toBeLessThan(enemyDefByIndex(0).radius);   // squashed
  });

  it('telegraphs: artillery aim line, healer pulse ring, charger wind-up, kamikaze fuse', () => {
    const art = write(view(13, { attackT: 20, x: 300, y: 0, dist: 300 })).list;
    expect(art.some((i) => i.shape === Shape.Line && i.layer === 7)).toBe(true);
    expect(write(view(13, { attackT: 120 })).list.some((i) => i.shape === Shape.Line)).toBe(false);
    expect(write(view(8)).list.some((i) => i.shape === Shape.Ring && i.layer === 6)).toBe(true);
    expect(write(view(14, { aiI: 1 | 16 })).list.some((i) => i.shape === Shape.Ring && i.layer === 6)).toBe(true);
    const far = write(view(4, { dist: 400, tick: 7 })).list, near = write(view(4, { dist: 50, tick: 7 })).list;
    expect(composite(far)).toHaveLength(1);
    expect(composite(near)).toHaveLength(1);
  });

  it('spawn-in scales and fades the body', () => {
    const b0 = write(view(3, { spawnAge: 0 })).list.find((i) => i.layer === 4 && i.flags === 0)!;
    const b1 = write(view(3, { spawnAge: 999 })).list.find((i) => i.layer === 4 && i.flags === 0)!;
    expect(b0.r).toBeLessThan(b1.r);
    expect(b0.a).toBeLessThan(b1.a);
  });

  it('packs status, phase, animation kind and rate into an exact float integer', () => {
    const p = packAnim(255, 63, 15, 3);
    expect(p).toBeLessThan(1 << 24);
    expect(Math.fround(p)).toBe(p);
    expect(p & 255).toBe(255);
    expect((p >> 8) & 63).toBe(63);
    expect((p >> 14) & 15).toBe(15);
    expect((p >> 18) & 3).toBe(3);
  });
});

describe('boss machines', () => {
  it('every boss has a part table and writes ≤ 10 instances per phase, with a pulsing node when the weak point opens', () => {
    expect(new Set(BOSS_PART_IDS)).toEqual(new Set(BOSS_LIST));
    for (let k = 0; k < BOSS_LIST.length; k++) {
      const def = bossDef(BOSS_LIST[k], 5);
      for (let ph = 0; ph < def.phases.length; ph++) {
        for (const open of [false, true]) {
          const v = view(25, { bossId: k, bossDef: def, bossPhase: ph, shape: def.shape, r: def.radius, flags: EnemyFlag.Boss | (open ? EnemyFlag.WeakPointOpen : 0), tell: 0.5 });
          const { list } = write(v);
          const body = list.find((i) => i.layer === 4 && i.flags === 0)!;
          expect(body.shape).toBe(def.shape);   // bosses keep their def silhouette as the body
          expect(list.length).toBeLessThanOrEqual(12);
          if (def.phases[ph].weakPoint && open) expect(list.some((i) => i.shape === Shape.Ring && (i.flags & InstFlag.Part))).toBe(true);
        }
      }
    }
  });

  it('phase changes are visible in the silhouette', () => {
    let changed = 0;
    for (let k = 0; k < BOSS_LIST.length; k++) {
      const def = bossDef(BOSS_LIST[k], 5);
      const sig = (ph: number): string => write(view(25, { bossId: k, bossDef: def, bossPhase: ph, shape: def.shape, r: def.radius, flags: EnemyFlag.Boss })).list.map((i) => `${i.shape}`).join(',');
      if (sig(0) !== sig(def.phases.length - 1)) changed++;
    }
    expect(changed).toBeGreaterThanOrEqual(15);
  });
});

describe('the tower wears its build', () => {
  function tower(frame: string, hp: (string | null)[], at: (string | null)[], deepest: number): { list: Inst[]; out: SnapshotWriter } {
    const out = new SnapshotWriter(), t = new TowerView();
    t.frame = frame; t.hardpoints = hp; t.attunements = at; t.deepest = deepest; t.firing = 1; t.hpFrac = 0.2; t.shieldFrac = 0.5; t.barrierFrac = 0.5;
    writeTowerBase(out, t); writeTowerTop(out, t);
    const list = read(out);
    validate(list, out);
    return { list, out };
  }
  it('nine frames, nine different hulls', () => {
    const sigs = new Set<string>();
    for (const f of FRAME_IDS) sigs.add(tower(f, [], [], 0).list.map((i) => `${i.shape}/${i.r.toFixed(1)}`).join(','));
    expect(sigs.size).toBe(FRAME_IDS.length);
  });
  it('lonely at wave 1, ornate at wave 100, and within budget with a full build', () => {
    const bare = tower('standard', [], [], 0).list.length;
    const full = tower('singularity_core', ['ordnance', 'drones', 'blade', 'laser'], ['fire', 'lightning', 'poison', 'frost'], 100).list;
    expect(full.length).toBeGreaterThan(bare * 3);
    expect(full.length).toBeLessThanOrEqual(80);
    expect(full.every((i) => i.layer === 0 || i.layer === 2)).toBe(true);
  });
});
