/**
 * Generate a mid-game save for the browser readability check (tests/render/readability.mjs):
 *   npx tsx tests/render/gen-save.ts <wave> <out.json>
 * A generalist agent climbs from a fresh game to <wave> (seed 3; ~10 s for wave 62).
 */
import { writeFileSync } from 'node:fs';
import { newSim, Climber } from '../../sim-cli/runner';

const target = Number(process.argv[2] ?? 62);
const out = process.argv[3] ?? `save-w${target}.json`;
const cfg = { seed: 3, agent: 'generalist' as const, policy: 'active' as const, stopAtWave: target, maxSimSeconds: 12 * 3600, wallMinutes: 30, hashes: false };
const sim = newSim(cfg);
new Climber(sim, cfg).run();
writeFileSync(out, JSON.stringify(sim.save()));
console.log(`save at wave ${sim.world.run.wave} → ${out}`);
