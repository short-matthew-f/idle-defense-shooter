/**
 * Formation scripts (WP4 replaces this stub). Given the wave, an enemy's spawn
 * entry and the current wave tick, write the position the formation wants the
 * enemy at. The AI steers toward it; contact with the tower ring is handled by the AI.
 */
import type { WaveDef, SpawnEntry } from '../core/types';
import { ARENA_RADIUS, TOWER_RADIUS, TICK_RATE } from '../core/types';
import { cos, sin } from '../math/lut';

export function formationPosition(wave: WaveDef, spawn: SpawnEntry, waveTick: number, baseSpeed: number, out: Float32Array): void {
  const t = Math.max(0, (waveTick - spawn.tick) / TICK_RATE);
  const r = Math.max(TOWER_RADIUS, ARENA_RADIUS + spawn.radiusOffset - baseSpeed * wave.params.radialSpeed * t);
  out[0] = cos(spawn.angle) * r;
  out[1] = sin(spawn.angle) * r;
}
