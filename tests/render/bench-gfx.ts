/**
 * Graphics CPU benchmark (docs/GRAPHICS.md "Measurements"):
 *   npx tsx tests/render/bench-gfx.ts [enemies=800] [frames=600]
 * Climbs to wave 40 with the generalist agent (seed 3), tops the field up to N enemies (all 21 families,
 * 3% elite, hpScale 40 so they live), then per frame: Sim.step(), Sim.snapshot() (worker CPU) and
 * FramePrep.frame() (the renderer's CPU side: cues, particles, flag filter, animation, sort; no GL).
 * Prints mean ms and instance counts. Node timing on a desktop CPU; phones are ~3–5× slower.
 */
import { newSim, Climber } from '../../sim-cli/runner';
import { FramePrep, DEFAULT_FRAME_OPTIONS } from '../../src/render/frame-prep';

const TARGET = Number(process.argv[2] ?? 800);
const FRAMES = Number(process.argv[3] ?? 600), WARM = 120;
const cfg = { seed: 3, agent: 'generalist' as const, policy: 'active' as const, stopAtWave: 40, maxSimSeconds: 12 * 3600, wallMinutes: 30, hashes: false };
const sim = newSim(cfg);
new Climber(sim, cfg).run();
for (let i = 0; i < 20000 && sim.world.run.phase !== 'combat'; i++) sim.step();
const w = sim.world;
const KINDS = ['grunt', 'swarm', 'runner', 'brute', 'kamikaze', 'shielded', 'splitter', 'carrier', 'healer', 'leech', 'veteran', 'armored', 'warden', 'artillery', 'charger', 'anchor', 'phase', 'burrower', 'nullifier', 'refractor', 'jammer'];
let seed = 12345;
const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const prep = new FramePrep();
const opts = { ...DEFAULT_FRAME_OPTIONS, minR: 3.5 / 0.7, pxPerUnit: 0.7 };
let snapMs = 0, prepMs = 0, inst = 0, total = 0, n = 0;
for (let f = 0; f < FRAMES + WARM; f++) {
  for (let g = 0; w.enemies.count < TARGET && g < 2000; g++) {
    const a = rnd() * Math.PI * 2, r = 180 + rnd() * 320;
    w.spawnEnemy(KINDS[(rnd() * KINDS.length) | 0], Math.cos(a) * r, Math.sin(a) * r, { hpScale: 40, elite: rnd() < 0.03 ? ['armored'] : [] });
  }
  sim.step();
  const t1 = performance.now();
  const snap = sim.snapshot();
  const t2 = performance.now();
  const tot = prep.frame(snap, 1 / 60, opts);
  const t3 = performance.now();
  if (f >= WARM) { snapMs += t2 - t1; prepMs += t3 - t2; inst += snap.instanceCount; total += tot; n++; }
}
console.log(JSON.stringify({ enemies: TARGET, snapshotInstances: Math.round(inst / n), drawnInstances: Math.round(total / n), snapshotMs: +(snapMs / n).toFixed(3), renderCpuMs: +(prepMs / n).toFixed(3), cpuMs: +((snapMs + prepMs) / n).toFixed(3), parts: prep.partsDrawn, chains: prep.chainsDrawn }));
