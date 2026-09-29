/**
 * Musical parameters per Sector (pure data). docs/AUDIO.md explains the choices; in short:
 *
 *   Outskirts     D Dorian, 72–84 BPM   warm and lonely: soft saw pad, sparse plucks, brushed time
 *   The Hive      E Aeolian, 96–110     pulsing and organic: 3-against-4 plucks, woody hits, busy bass
 *   Bastion Line  G Aeolian, 100–112    a steady march: root–fifth bass on the beat, snare on 2 and 4
 *   The Fold      F# Lydian, 60–70      eerie and wide: long pads, the raised 4th, big reverb and delay
 *   The Court     Bb Ionian, 80–92      grand: octave-doubled pad, rising arpeggios, timpani
 *
 * Patterns are 16 sixteenth-note steps per bar. Pulse steps: 0 rest, n = the n-th chord tone
 * (above 3: octave up). Bass steps: 0 rest, 1 root, 5 fifth, 8 octave. Drum steps: velocity 0..1.
 */
import type { Key } from '../theory';

export type PercStyle = 'brush' | 'organic' | 'march' | 'heartbeat' | 'timpani';

export interface SectorMusic {
  id: string;
  name: string;
  key: Key;
  bpm: readonly [number, number];
  barsPerChord: number;
  /** Markov weights over scale degrees 0..6: moves[d][n] = weight of going from degree d to degree n. */
  moves: readonly (readonly number[])[];
  chordSize: 3 | 4;
  pad: { wave: OscillatorType; cutoff: number; detune: number; attack: number; octaveDouble: boolean; wobble: number };
  pulse: { wave: OscillatorType; cutoff: number; decay: number; patterns: readonly (readonly number[])[] };
  bass: { wave: OscillatorType; cutoff: number; pattern: readonly number[] };
  lead: { wave: OscillatorType; cutoff: number; density: number; vibrato: number; octave: number };
  perc: { style: PercStyle; kick: readonly number[]; snare: readonly number[]; hat: readonly number[] };
  reverb: number;
  delay: number;
  /** Delay time in beats (dotted eighth = 0.75). */
  delayBeats: number;
  /** Semitones the key shifts per boss phase (phase 0, 1, 2). */
  bossShift: readonly number[];
  character: string;
}

// degrees:           0    1    2    3    4    5    6
const W = (...w: number[]): number[] => w;

export const SECTOR_MUSIC: readonly SectorMusic[] = [
  {
    id: 'outskirts', name: 'The Outskirts', key: { root: 50, mode: 'dorian' }, bpm: [72, 84], barsPerChord: 2, chordSize: 4,
    // i → IV (the Dorian major IV), bVII, bIII; IV → i, bVII; bVII → i, IV; bIII → IV
    moves: [W(0, 0.3, 1, 3, 0.8, 0, 2.5), W(1, 0, 0, 1, 1, 0, 1), W(0.5, 0, 0, 2, 0, 0, 1.5), W(3, 0, 0.5, 0, 0.5, 0, 2), W(2.5, 0, 0.5, 1, 0, 0, 0.5), W(1, 0, 0, 1, 0, 0, 1), W(3, 0, 1, 2, 0.5, 0, 0)],
    pad: { wave: 'sawtooth', cutoff: 900, detune: 7, attack: 2.5, octaveDouble: false, wobble: 0.1 },
    pulse: { wave: 'triangle', cutoff: 2200, decay: 0.9, patterns: [
      [1, 0, 0, 3, 0, 0, 2, 0, 0, 4, 0, 0, 3, 0, 0, 0],
      [1, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 4, 0, 0, 3, 0],
    ] },
    bass: { wave: 'triangle', cutoff: 380, pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0] },
    lead: { wave: 'triangle', cutoff: 2400, density: 0.45, vibrato: 4, octave: 12 },
    perc: { style: 'brush',
      kick: [0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0],
      hat: [0.35, 0, 0.2, 0, 0.45, 0, 0.2, 0, 0.35, 0, 0.2, 0, 0.45, 0, 0.25, 0.15] },
    reverb: 0.35, delay: 0.15, delayBeats: 0.75, bossShift: [0, 2, 3],
    character: 'warm and lonely',
  },
  {
    id: 'hive', name: 'The Hive', key: { root: 52, mode: 'aeolian' }, bpm: [96, 110], barsPerChord: 2, chordSize: 3,
    // i → VI, iv, VII; VI → VII, iv; VII → i, III; iv → i, v; III → VI; v → i
    moves: [W(0, 0, 0.8, 2, 0.6, 2.5, 2), W(1, 0, 0, 0, 0, 0, 0), W(0.5, 0, 0, 1, 0, 2, 1), W(2.5, 0, 0, 0, 1, 1, 0.5), W(2, 0, 0, 0.5, 0, 1, 0), W(0.8, 0, 0.5, 1.5, 0, 0, 2.5), W(2.5, 0, 1.5, 0.5, 0, 0.5, 0)],
    pad: { wave: 'triangle', cutoff: 1300, detune: 9, attack: 1.2, octaveDouble: false, wobble: 0.45 },
    pulse: { wave: 'square', cutoff: 1500, decay: 0.35, patterns: [
      [1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 3, 0],
      [1, 0, 3, 0, 2, 1, 0, 3, 0, 2, 1, 0, 3, 0, 2, 0],
    ] },
    bass: { wave: 'sawtooth', cutoff: 320, pattern: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 5, 0] },
    lead: { wave: 'square', cutoff: 1500, density: 0.5, vibrato: 2, octave: 12 },
    perc: { style: 'organic',
      kick: [1, 0, 0, 0.45, 0, 0, 0.8, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0.25],
      hat: [0.4, 0.15, 0.3, 0.15, 0.4, 0.15, 0.3, 0.2, 0.4, 0.15, 0.3, 0.15, 0.4, 0.2, 0.3, 0.25] },
    reverb: 0.25, delay: 0.1, delayBeats: 0.5, bossShift: [0, 2, 3],
    character: 'pulsing and organic',
  },
  {
    id: 'bastion_line', name: 'The Bastion Line', key: { root: 55, mode: 'aeolian' }, bpm: [100, 112], barsPerChord: 1, chordSize: 3,
    // i → VI → VII → i, and i → iv → v → i
    moves: [W(0.5, 0, 0.5, 2, 0.5, 2.5, 1), W(1, 0, 0, 0, 0, 0, 0), W(0.5, 0, 0, 1, 0, 1.5, 0.5), W(1, 0, 0, 0.5, 2, 0.5, 0.5), W(2.5, 0, 0, 0.3, 0.5, 1, 0), W(0.5, 0, 0.5, 0.5, 0, 0.5, 3), W(3, 0, 1, 0, 0, 0.5, 0.5)],
    pad: { wave: 'sawtooth', cutoff: 1100, detune: 5, attack: 0.9, octaveDouble: false, wobble: 0.05 },
    pulse: { wave: 'sawtooth', cutoff: 1300, decay: 0.3, patterns: [
      [1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 1, 0, 3, 0, 1, 0],
      [1, 0, 0, 0, 1, 0, 2, 0, 1, 0, 0, 0, 3, 0, 2, 0],
    ] },
    bass: { wave: 'sawtooth', cutoff: 360, pattern: [1, 0, 0, 0, 5, 0, 0, 0, 1, 0, 0, 0, 5, 0, 0, 0] },
    lead: { wave: 'sawtooth', cutoff: 1700, density: 0.45, vibrato: 3, octave: 12 },
    perc: { style: 'march',
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0.35, 0.45],
      hat: [0.35, 0, 0.25, 0, 0.35, 0, 0.25, 0, 0.35, 0, 0.25, 0, 0.35, 0, 0.25, 0] },
    reverb: 0.22, delay: 0, delayBeats: 0.5, bossShift: [0, 2, 3],
    character: 'a steady march',
  },
  {
    id: 'fold', name: 'The Fold', key: { root: 54, mode: 'lydian' }, bpm: [60, 70], barsPerChord: 4, chordSize: 4,
    // I ↔ II (the Lydian major II), vi, iii; V rarely
    moves: [W(0, 3, 1, 0, 0.3, 1.5, 0), W(3, 0, 0.5, 0, 0, 1, 0), W(0.5, 1, 0, 0, 0, 2, 0), W(1, 0, 0, 0, 0, 0, 0), W(2, 1, 0, 0, 0, 0.5, 0), W(1.5, 2, 1, 0, 0, 0, 0), W(1, 0, 0, 0, 0, 0, 0)],
    pad: { wave: 'sine', cutoff: 1600, detune: 12, attack: 4, octaveDouble: true, wobble: 0.25 },
    pulse: { wave: 'sine', cutoff: 2600, decay: 1.2, patterns: [
      [1, 0, 0, 3, 0, 0, 2, 0, 0, 4, 0, 0, 3, 0, 0, 0],
      [4, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 2, 0, 0, 0],
    ] },
    bass: { wave: 'sine', cutoff: 260, pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    lead: { wave: 'sine', cutoff: 2600, density: 0.3, vibrato: 6, octave: 12 },
    perc: { style: 'heartbeat',
      kick: [0.9, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      hat: [0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0, 0, 0, 0.25, 0, 0, 0.15] },
    reverb: 0.6, delay: 0.35, delayBeats: 0.75, bossShift: [0, 1, 3],
    character: 'eerie and wide',
  },
  {
    id: 'court', name: 'The Court', key: { root: 46, mode: 'ionian' }, bpm: [80, 92], barsPerChord: 2, chordSize: 4,
    // I → IV, vi, V; IV → I, V, ii; V → I, vi; vi → IV, ii; ii → V
    moves: [W(0, 0.5, 0.3, 2.5, 1.5, 1.5, 0), W(0.3, 0, 0, 0.5, 2.5, 0, 0), W(0.3, 0, 0, 1, 0, 2, 0), W(2.5, 1, 0, 0, 2, 0.5, 0), W(3, 0, 0.3, 0.5, 0, 1.5, 0), W(0.5, 1.5, 0, 2.5, 0.5, 0, 0), W(1, 0, 0, 0, 0, 0, 0)],
    pad: { wave: 'sawtooth', cutoff: 1500, detune: 6, attack: 1.6, octaveDouble: true, wobble: 0.1 },
    pulse: { wave: 'triangle', cutoff: 3000, decay: 0.5, patterns: [
      [1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 4, 0, 3, 0, 2, 0],
      [1, 0, 3, 0, 5, 0, 3, 0, 4, 0, 6, 0, 4, 0, 3, 0],
    ] },
    bass: { wave: 'triangle', cutoff: 420, pattern: [1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 8, 0] },
    lead: { wave: 'sawtooth', cutoff: 2000, density: 0.55, vibrato: 4, octave: 12 },
    perc: { style: 'timpani',
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0.4, 0],
      snare: [0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0, 0],
      hat: [0.3, 0, 0.2, 0, 0.3, 0, 0.2, 0, 0.3, 0, 0.2, 0, 0.3, 0, 0.2, 0] },
    reverb: 0.42, delay: 0.1, delayBeats: 0.75, bossShift: [0, 2, 3],
    character: 'grand',
  },
];

/** Sector index 0..4 (Deep Waves stay in The Court). */
export function sectorMusic(i: number): SectorMusic { return SECTOR_MUSIC[Math.max(0, Math.min(SECTOR_MUSIC.length - 1, i | 0))]; }

/** Tempo for an intensity: the Sector's range, rounded to whole BPM (it only changes at chord boundaries). */
export function tempoFor(s: SectorMusic, intensity: number): number {
  const i = Math.max(0, Math.min(1, intensity));
  return Math.round(s.bpm[0] + (s.bpm[1] - s.bpm[0]) * i);
}

/** Seconds per sixteenth-note step. */
export function stepSeconds(bpm: number): number { return 60 / bpm / 4; }
