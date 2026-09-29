/**
 * Wave generator (WP4 replaces this stub). Pure function of (prestigeSeed, wave,
 * threatDial, ascension): wave content is fixed per Prestige seed (design §2, §12).
 */
import { Prng, waveSeed } from '../math/prng';
import { TICK_RATE } from '../core/types';
import type { WaveDef, SpawnEntry } from '../core/types';
import { TAU } from '../math/lut';

export function generateWave(prestigeSeed: number, wave: number, threatDial: number, ascension: number): WaveDef {
  const rng = new Prng(waveSeed(prestigeSeed, wave));
  const isBoss = wave % 5 === 0;
  const count = isBoss ? 0 : 6 + Math.floor(wave * 1.5);
  const spawns: SpawnEntry[] = [];
  const base = rng.next() * TAU;
  for (let i = 0; i < count; i++) {
    spawns.push({ tick: Math.floor((i / count) * 20 * TICK_RATE), kind: 'grunt', angle: base + (i / count) * TAU, radiusOffset: 0, elite: [], hpScale: 1 + 0.12 * threatDial, formationSlot: i, lane: 0 });
  }
  void ascension;
  return { wave, sector: 'outskirts', isBoss, bossId: isBoss ? 'breaker' : null, formation: 'radial_ring', threatBudget: count, spawns, params: { lanes: 1, spread: 1, tempo: 1, radialSpeed: 1, rotation: 0, escortRatio: 0 }, durationTicks: 20 * TICK_RATE };
}
