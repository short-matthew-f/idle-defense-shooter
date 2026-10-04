import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { EnemyFlag, Ev, ProjFlag, ProjKind, TICK_RATE } from '../../src/sim/core/types';
import type { SimEvent } from '../../src/sim/core/types';
import { atan2 } from '../../src/sim/math/lut';

/** An empty arena in combat with no wave script, an unkillable tower and a harmless primary. */
function arena(seed = 1, wave = 30): Sim {
  const sim = new Sim(null, seed);
  const w = sim.world;
  w.clearCombat();
  w.wave = null;
  sim.machine.setPhase('combat');
  w.run.wave = wave;
  w.stats.override('bastion.max_hp', 1e12);
  w.stats.override('ballistics.damage', 0);
  w.stats.override('ballistics.range', 0);
  w.stats.override('wave.stall_seconds', 1e6);   // behaviors in isolation: nothing here damages them, which is not a stall
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  return sim;
}

/** Shield / HP regeneration and outward knockback only work inside the primary's range (enemies/recovery.ts, core/forces.ts). */
function reach(sim: Sim, range = 600): void { sim.world.stats.override('ballistics.range', range); sim.world.rebuildStats(); }

function spawn(sim: Sim, kind: string, x: number, y: number, elite?: string[]): number {
  return sim.world.spawnEnemy(kind, x, y, { cause: -1, elite });
}

function collect(sim: Sim, ticks: number, types: number[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    const from = sim.events.nextId;
    sim.step();
    sim.events.forEachSince(from, (e) => { if (types.includes(e.type)) out.push({ ...e }); });
  }
  return out;
}

/** Pool index of the only live enemy of a kind index (tests keep them unique). */
function find(sim: Sim, gen: number): number {
  const e = sim.world.enemies;
  for (let i = 0; i < e.count; i++) if (e.gen[i] === gen && !(e.flags[i] & EnemyFlag.Dead)) return i;
  return -1;
}

describe('enemy behaviors', () => {
  it('splitter spawns three fragments caused by its Kill event', () => {
    const sim = arena();
    const w = sim.world;
    const i = spawn(sim, 'splitter', 300, 0);
    const from = sim.events.nextId;
    w.damage(i, 1e15, { source: 'primary', srcTag: 'test', cause: -1 });
    let killId = -1;
    const frags: SimEvent[] = [];
    sim.events.forEachSince(from, (e) => { if (e.type === Ev.Kill) killId = e.id; if (e.type === Ev.Spawn && e.src === 'splitter_fragment') frags.push({ ...e }); });
    expect(killId).toBeGreaterThanOrEqual(0);
    expect(frags.length).toBe(3);
    for (const f of frags) expect(f.cause).toBe(killId);
  });

  it('healer heals nearby wounded enemies', () => {
    const sim = arena();
    const w = sim.world;
    spawn(sim, 'healer', 400, 0);
    const g = spawn(sim, 'grunt', 420, 0);
    const gen = w.enemies.gen[g];
    w.damage(g, w.enemies.maxHp[g] * 0.5, { source: 'primary', srcTag: 'test', cause: -1 });
    const before = w.enemies.hp[g];
    const heals = collect(sim, 90, [Ev.Heal]);
    const gi = find(sim, gen);
    expect(w.enemies.hp[gi]).toBeGreaterThan(before);
    expect(heals.some((h) => h.src === 'healer')).toBe(true);
  });

  it('warden projects shields onto enemies inside its ring', () => {
    const sim = arena();
    const w = sim.world;
    spawn(sim, 'warden', 400, 0);
    const g = spawn(sim, 'grunt', 430, 20);
    const gen = w.enemies.gen[g];
    expect(w.enemies.shield[g]).toBe(0);
    sim.run(40);
    const gi = find(sim, gen);
    expect(w.enemies.shield[gi]).toBeGreaterThan(0);
    expect(w.enemies.maxShield[gi]).toBeGreaterThan(0);
  });

  it('artillery holds range and lobs hostile shells that damage the tower', () => {
    const sim = arena();
    const w = sim.world;
    const i = spawn(sim, 'artillery', 480, 0);
    const gen = w.enemies.gen[i];
    let minD = Infinity, shells = 0;
    const hits: SimEvent[] = [];
    for (let t = 0; t < 30 * TICK_RATE; t++) {
      const from = sim.events.nextId;
      sim.step();
      sim.events.forEachSince(from, (e) => { if (e.type === Ev.TowerHit) hits.push({ ...e }); });
      const a = find(sim, gen);
      minD = Math.min(minD, Math.hypot(w.enemies.x[a], w.enemies.y[a]));
      const p = w.projectiles;
      for (let j = 0; j < p.count; j++) if ((p.flags[j] & ProjFlag.Hostile) && p.kind[j] === ProjKind.Shell && p.blast[j] > 0) shells++;
    }
    expect(minD).toBeGreaterThanOrEqual(320);
    expect(shells).toBeGreaterThan(0);
    expect(hits.some((h) => h.src === 'artillery')).toBe(true);
    expect(w.tower.hp).toBeLessThan(w.tower.maxHp);
  });

  it('charger telegraphs, then dashes at 4× speed', () => {
    const sim = arena();
    const w = sim.world;
    const i = spawn(sim, 'charger', 380, 0);
    const gen = w.enemies.gen[i];
    const speed = w.enemies.speed[i];
    let maxStep = 0, paused = 0;
    let px = w.enemies.x[i], py = w.enemies.y[i];
    for (let t = 0; t < 8 * TICK_RATE; t++) {
      sim.step();
      const a = find(sim, gen);
      const d = Math.hypot(w.enemies.x[a] - px, w.enemies.y[a] - py);
      if (d < 1e-6 && Math.hypot(w.enemies.x[a], w.enemies.y[a]) > 100) paused++;
      maxStep = Math.max(maxStep, d);
      px = w.enemies.x[a]; py = w.enemies.y[a];
    }
    expect(paused).toBeGreaterThanOrEqual(30);                      // ~0.6 s wind-up
    expect(maxStep).toBeGreaterThan((speed * 3.5) / TICK_RATE);    // dash step
  });

  it('phase blinks intangible (1.5 s of every 4 s) and is untargetable while phased', () => {
    const sim = arena();
    const w = sim.world;
    const i = spawn(sim, 'phase', 480, 0);
    const gen = w.enemies.gen[i];
    let phased = 0, untargetableWhilePhased = true, targetableWhenSolid = true;
    for (let t = 0; t < 240; t++) {
      sim.step();
      const a = find(sim, gen);
      const tgt = w.nearestEnemy(0, 0, 2000, 'nearest', 'primary');
      if (w.enemies.flags[a] & EnemyFlag.Phased) { phased++; if (tgt !== -1) untargetableWhilePhased = false; }
      else if (tgt !== a) targetableWhenSolid = false;
    }
    expect(phased).toBeGreaterThanOrEqual(85);
    expect(phased).toBeLessThanOrEqual(95);
    expect(untargetableWhilePhased).toBe(true);
    expect(targetableWhenSolid).toBe(true);
  });

  it('nullifier strips a burn from enemies in its field', () => {
    const sim = arena();
    const w = sim.world;
    spawn(sim, 'nullifier', 400, 0);
    const g = spawn(sim, 'grunt', 420, 0);
    const gen = w.enemies.gen[g];
    w.applyStatus(g, 'burn', 3, 600, 'fire', -1);
    expect(w.enemies.burn[g]).toBeGreaterThan(0);
    sim.run(31);
    expect(w.enemies.burn[find(sim, gen)]).toBe(0);
  });

  it('burrower travels Burrowed (untargetable) and surfaces near radius 200', () => {
    const sim = arena();
    const w = sim.world;
    const i = spawn(sim, 'burrower', 480, 0);
    const gen = w.enemies.gen[i];
    sim.step();
    expect(w.enemies.flags[find(sim, gen)] & EnemyFlag.Burrowed).toBeTruthy();
    expect(w.nearestEnemy(0, 0, 2000, 'nearest', 'primary')).toBe(-1);
    let surfacedAt = -1;
    for (let t = 0; t < 20 * TICK_RATE && surfacedAt < 0; t++) {
      sim.step();
      const a = find(sim, gen);
      if (!(w.enemies.flags[a] & EnemyFlag.Burrowed)) surfacedAt = Math.hypot(w.enemies.x[a], w.enemies.y[a]);
    }
    expect(surfacedAt).toBeGreaterThan(150);
    expect(surfacedAt).toBeLessThanOrEqual(201);
  });

  it('kamikaze explodes on contact (Explosion fx event) and damages the tower', () => {
    const sim = arena();
    const w = sim.world;
    spawn(sim, 'kamikaze', 90, 0);
    const evs = collect(sim, 3 * TICK_RATE, [Ev.Explosion, Ev.TowerHit]);
    const boom = evs.find((e) => e.type === Ev.Explosion && e.src === 'kamikaze');
    expect(boom).toBeDefined();
    expect(evs.some((e) => e.type === Ev.TowerHit && e.cause === boom!.id)).toBe(true);
    expect(w.enemies.count).toBe(0);
    const snap = sim.snapshot();
    expect(snap.fxCount).toBeGreaterThan(0);
  });

  it('carrier releases brood caused by its own Spawn event', () => {
    const sim = arena();
    const w = sim.world;
    const i = spawn(sim, 'carrier', 480, 0);
    const spawnEv = w.enemies.spawnEv[i];
    const evs = collect(sim, 5 * TICK_RATE, [Ev.Spawn]);
    const brood = evs.filter((e) => e.src === 'brood');
    expect(brood.length).toBeGreaterThanOrEqual(3);
    for (const b of brood) expect(b.cause).toBe(spawnEv);
  });

  it('leech tethers to the tower and drains it', () => {
    const sim = arena();
    const w = sim.world;
    w.tower.shield = w.tower.maxShield;
    spawn(sim, 'leech', 110, 0);
    const evs = collect(sim, 2 * TICK_RATE, [Ev.TowerHit]);
    expect(evs.filter((e) => e.src === 'leech').length).toBeGreaterThanOrEqual(2);
    const snap = sim.snapshot();
    let line = false;
    for (let k = 0; k < snap.instanceCount; k++) { const o = k * 12; if (snap.instances[o + 4] === 8 && snap.instances[o + 9] === 3) line = true; }
    expect(line).toBe(true);
  });

  it('shielded regenerates its shield after 3 s without damage; veteran hardens with time', () => {
    const sim = arena();
    const w = sim.world;
    reach(sim);
    const s = spawn(sim, 'shielded', 480, 0);
    const v = spawn(sim, 'veteran', 480, 40);
    const sGen = w.enemies.gen[s], vGen = w.enemies.gen[v];
    w.damage(s, w.enemies.maxShield[s] * 0.8, { source: 'primary', srcTag: 'test', cause: -1 });
    const low = w.enemies.shield[s];
    sim.run(2 * TICK_RATE);
    expect(w.enemies.shield[find(sim, sGen)]).toBeCloseTo(low, 3);
    sim.run(3 * TICK_RATE);
    expect(w.enemies.shield[find(sim, sGen)]).toBeGreaterThan(low);
    const vi = find(sim, vGen);
    const mul = w.damageModifier!(vi, null, 'test', 'primary');
    expect(mul).toBeGreaterThan(0.8);
    expect(mul).toBeLessThan(0.95);
  });

  it('refractor faces the tower; anchor ignores knockback; brute resists part of it', () => {
    const sim = arena();
    const w = sim.world;
    reach(sim);
    const r = spawn(sim, 'refractor', 300, 200);
    const a = spawn(sim, 'anchor', -300, 0);
    const b = spawn(sim, 'brute', 0, 400);
    const g = spawn(sim, 'grunt', 0, -400);
    const gens = [r, a, b, g].map((i) => w.enemies.gen[i]);
    sim.step();
    const ri = find(sim, gens[0]);
    expect(w.enemies.angle[ri]).toBeCloseTo(atan2(-w.enemies.y[ri], -w.enemies.x[ri]), 2);
    const pos = gens.map((gn) => { const i = find(sim, gn); return [w.enemies.x[i], w.enemies.y[i]]; });
    for (const gn of gens.slice(1)) { const i = find(sim, gn); w.knockback(i, w.enemies.x[i], w.enemies.y[i], 40); }
    const ai = find(sim, gens[1]);
    expect(w.enemies.x[ai]).toBeCloseTo(pos[1][0], 5);
    sim.step();
    const outward = (k: number): number => { const i = find(sim, gens[k]); return Math.hypot(w.enemies.x[i], w.enemies.y[i]) - Math.hypot(pos[k][0], pos[k][1]); };
    expect(outward(2)).toBeLessThan(outward(3) - 5);
  });

  it('separation pushes overlapping enemies apart', () => {
    const sim = arena();
    const w = sim.world;
    const i = spawn(sim, 'brute', 400, 0);
    const j = spawn(sim, 'brute', 401, 0);
    const gi = w.enemies.gen[i], gj = w.enemies.gen[j];
    w.enemies.speed[i] = 0; w.enemies.speed[j] = 0;
    sim.run(30);
    const a = find(sim, gi), b = find(sim, gj);
    expect(Math.hypot(w.enemies.x[a] - w.enemies.x[b], w.enemies.y[a] - w.enemies.y[b])).toBeGreaterThan(10);
  });

  it('wave-end guarantee: hidden enemies are forced targetable after 20 s', () => {
    const sim = arena();
    const w = sim.world;
    const i = spawn(sim, 'burrower', 480, 0);
    const gen = w.enemies.gen[i];
    w.enemies.speed[i] = 0;                          // never reaches the surfacing radius
    sim.run(19 * TICK_RATE);
    expect(w.enemies.flags[find(sim, gen)] & EnemyFlag.Burrowed).toBeTruthy();
    sim.run(2 * TICK_RATE);
    expect(w.enemies.flags[find(sim, gen)] & EnemyFlag.Burrowed).toBeFalsy();
    expect(w.nearestEnemy(0, 0, 2000, 'nearest', 'primary')).toBe(find(sim, gen));
  });

  it('determinism: a mixed arena hashes identically on two fresh Sims', () => {
    const run = (): number => {
      const sim = arena(77);
      const kinds = ['swarm', 'runner', 'brute', 'kamikaze', 'shielded', 'splitter', 'carrier', 'healer', 'leech', 'veteran',
        'armored', 'warden', 'artillery', 'charger', 'anchor', 'phase', 'burrower', 'nullifier', 'refractor', 'jammer'];
      kinds.forEach((k, n) => { const a = (n / kinds.length) * 6.283; spawn(sim, k, Math.cos(a) * 480, Math.sin(a) * 480); });
      sim.world.stats.override('ballistics.damage', 30);
      sim.world.stats.override('ballistics.range', 400);
      sim.world.rebuildStats();
      sim.run(1500);
      return sim.events.hash();
    };
    expect(run()).toBe(run());
  });
});
