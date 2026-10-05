/**
 * Trials (design §16; unlocked by the Prestige II node `prestige.trials`). A Trial is a separate run
 * slot: `start_trial` parks the main run (meta.parkedRun = its RunSave, PRNG included) and starts a
 * fresh wave-1 run on the Standard frame with the Trial's constraint; Echo upgrades apply.
 * `end_trial` restores the parked run exactly (same RunSave) at its checkpoint.
 * meta.activeTrial marks the Trial (World.trial reads it, so it survives save/load).
 *
 * Constraints (rule table in economy/prestige.ts `trialHas`):
 *  bare_metal       hardpoint cap 0 (run/slots.ts)
 *  hive_mind        primary disabled (stats.mounted('primary') = false); only Drones may mount
 *  siege_mentality  primary disabled; only the Orbital Blade may mount
 *  monochrome       attunement cap 1 (run/slots.ts); Fusions/Triads inactive (stats.ts)
 *  blackout         no abilities / designator / manual aim (systems/abilities.ts + commands.ts, WP9)
 *  commander        no automatic primary fire (systems/ballistics.ts); abilities −50% (WP9)
 *  scatter          every ordinary wave uses the Scattered Rain formation (generateWave opts)
 *  swarmstorm       enemy count ×5, HP ×0.2 (`trialWave` post-processes the WaveDef)
 *  poverty          Scrap −75% (economy/prestige.ts metaEffects)
 *  pacifist_core    only status / hazard / retaliation damage (systems/anomalies.ts damageMul)
 * Tiers: reaching waves 30 / 60 / 90 sets meta.trials[id] = 1..3 (ProgressionSystem); the reward
 * is granted at tier 1 (frames into meta.unlockedFrames; stat rewards via metaEffects).
 */
import type { RunMachine } from './machine';
import type { WorldImpl } from '../core/world-impl';
import type { SpawnEntry, WaveDef } from '../core/types';
import type { TrialId } from '../core/ids';
import { TRIALS } from '../data/index';
import { combineSeed } from '../math/prng';
import { toRunSave, fromRunSave } from '../save/serialize';
import { prank, trialHas } from '../economy/prestige';
import { installRun, startFresh } from './prestige';

export const SWARM_COUNT = 5;
export const SWARM_HP = 0.2;

export function startTrial(m: RunMachine, id: TrialId): string | null {
  const w = m.w, meta = w.meta;
  if (prank(meta, 'prestige.trials') <= 0) return 'Trials are locked (Echo tier II)';
  if (w.trial) return 'A Trial is already running';
  const k = TRIALS.findIndex((t) => t.id === id);
  if (k < 0) return 'Unknown Trial';
  meta.parkedRun = toRunSave(w.run, w.build, w.prng.state());
  meta.activeTrial = id;
  startFresh(m, combineSeed(w.run.prestigeSeed, 0x7121a1, k, meta.prestigeCount), 'standard', {});
  return null;
}

export function endTrial(m: RunMachine): string | null {
  const w = m.w, meta = w.meta;
  if (!w.trial || !meta.parkedRun) return 'No Trial running';
  const r = fromRunSave(meta.parkedRun);
  r.run.boonOffer = null; r.run.boonQueue = []; r.run.boonRerolls = 0;   // Boons: the resumed run is a fresh attempt (start offer)
  meta.activeTrial = null;
  delete meta.parkedRun;
  installRun(m, r.run, r.build, r.prngState, false);
  return null;
}

/** Swarmstorm: every non-boss spawn becomes five at 20% HP (a pure post-process of the WaveDef). */
export function trialWave(w: WorldImpl, wave: WaveDef): WaveDef {
  if (!trialHas(w.trial, 'swarm')) return wave;
  const dec: { s: SpawnEntry; i: number }[] = [];
  let n = 0;
  for (const s of wave.spawns) {
    if (s.kind === 'boss') { dec.push({ s, i: n++ }); continue; }
    for (let k = 0; k < SWARM_COUNT; k++) {
      dec.push({ s: { ...s, elite: [...s.elite], hpScale: s.hpScale * SWARM_HP, tick: s.tick + k * 4, angle: s.angle + k * 0.07 }, i: n++ });
    }
  }
  dec.sort((a, b) => (a.s.tick - b.s.tick) || (a.i - b.i));
  return { ...wave, spawns: dec.map((d) => d.s) };
}
