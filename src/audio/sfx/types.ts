/** Sound-effect definition contract (see sfx/index.ts for the registry and docs/AUDIO.md for the list). */
import type { Key } from '../theory';
import type { Voice } from '../synth';

export interface SfxParams {
  /** 0..1 size (explosions, kills) or strength. */
  size?: number;
  /** Extra level multiplier (0..1). */
  level?: number;
  /** MIDI pitch for pitched sounds (purchase ticks, chain notes). */
  pitch?: number;
  /** Stereo position -1..1 (the engine keeps it gentle). */
  pan?: number;
  /** Duration for sounds that follow a window (boss tell riser), s. */
  dur?: number;
  /** Count (bulk purchase arpeggio notes). */
  n?: number;
  /** Music key, for sounds that play chords or melodies in key. */
  key?: Key;
}

export interface SfxDef {
  /** Voice priority: higher steals lower when the voice cap is reached. ≥ 8 is never thinned by sim speed. */
  priority: number;
  /** Minimum seconds between two plays at ×1 speed. */
  minInterval: number;
  /** How long the voice holds its slot (s), from the params. */
  dur: (p: SfxParams) => number;
  /** Duck the music by this fraction (0 = no duck) for big moments. */
  duck?: number;
  play(v: Voice, p: SfxParams): void;
}

export const fixed = (s: number) => (): number => s;
