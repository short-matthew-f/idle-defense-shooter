/**
 * Game state → music intensity (pure). Intensity 0..1 decides which layers play; tension (low tower
 * HP) and boss waves add their own layers. Wave 1 sits near 0.1: nearly ambient.
 */
import type { RunPhase, UiState } from '@sim/core/types';

export interface MusicInput {
  wave: number;
  phase: RunPhase;
  enemiesAlive: number;
  isBoss: boolean;
  bossPhase: number;
  /** Tower HP fraction 0..1. */
  hp: number;
}

export function musicInputFrom(ui: Pick<UiState, 'run' | 'wave' | 'tower'>): MusicInput {
  const t = ui.tower;
  return {
    wave: ui.run.wave, phase: ui.run.phase, enemiesAlive: ui.wave.enemiesAlive, isBoss: ui.wave.isBoss,
    bossPhase: ui.wave.bossPhase, hp: t.maxHp > 0 ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 1,
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** How far into the game a wave is: 55% position inside its Sector, 45% overall depth (waves 1–61+). */
export function waveDepth(wave: number): number {
  const w = Math.max(1, wave);
  const inSector = w > 100 ? 1 : ((w - 1) % 20) / 19;
  return clamp01(0.55 * inSector + 0.45 * Math.min(1, (w - 1) / 60));
}

/** Enemies alive on a log scale: 0 → 0, ~20 → 0.5, 400+ → 1. */
export function crowd(alive: number): number { return clamp01(Math.log1p(Math.max(0, alive)) / Math.log1p(400)); }

/**
 * Target intensity. Combat: a floor, plus wave depth, plus the crowd (which counts for more deeper in
 * the game), plus a lift on boss waves. Between waves and during the draft the music settles to 60%;
 * dead is 0 (the music falls away).
 */
export function targetIntensity(m: MusicInput): number {
  if (m.phase === 'dead') return 0;
  const d = waveDepth(m.wave);
  const c = crowd(m.enemiesAlive);
  let v = 0.08 + 0.42 * d + 0.35 * c * (0.35 + 0.65 * d) + (m.isBoss ? 0.2 : 0);
  if (m.phase !== 'combat') v *= 0.6;
  return clamp01(v);
}

/** Tension from low tower HP: 0 above 45% HP, 1 at 10% and below (combat only). */
export function tensionFor(m: MusicInput): number {
  if (m.phase !== 'combat') return 0;
  return clamp01((0.45 - m.hp) / 0.35);
}

/** Exponential approach: rises over ~4 s, falls over ~9 s, so layers never pump with the wave's ebb. */
export function smoothToward(current: number, target: number, dt: number): number {
  const tau = target > current ? 4 : 9;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

export interface Layers { pad: number; bass: number; pulse: number; perc: number; lead: number; hats16: number; boss: number; tension: number }

/** Layer gains 0..1 from intensity (smooth windows, so a layer fades in rather than switching on). */
export function layersFor(intensity: number, boss: boolean, tension: number): Layers {
  const i = clamp01(intensity);
  return {
    pad: 0.8 + 0.2 * smoothstep(0, 0.4, i),
    bass: smoothstep(0.1, 0.3, i),
    pulse: smoothstep(0.24, 0.45, i),
    perc: smoothstep(0.4, 0.6, i),
    lead: smoothstep(0.5, 0.72, i),
    hats16: smoothstep(0.72, 0.92, i),
    boss: boss ? smoothstep(0.2, 0.5, i) : 0,
    tension: clamp01(tension),
  };
}
