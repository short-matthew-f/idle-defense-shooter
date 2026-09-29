/**
 * Music theory helpers (pure): modes, pentatonic subsets, scale quantization and chord building.
 * Every pitch the audio module plays (music and chain notes) goes through here, so sound effects
 * with pitch always sit in the music's key.
 *
 * Pitches are MIDI note numbers (60 = middle C). A Key is a root MIDI note plus a mode; the root's
 * octave only sets the register that `scaleNote(key, 0)` lands in.
 */

export type ModeName = 'ionian' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'aeolian';

export const MODES: Record<ModeName, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};

export const PENTATONIC_MAJOR: readonly number[] = [0, 2, 4, 7, 9];
export const PENTATONIC_MINOR: readonly number[] = [0, 3, 5, 7, 10];

export interface Key { root: number; mode: ModeName }

/** True for modes with a major third (their pentatonic is the major one). */
export function isMajorMode(mode: ModeName): boolean { return MODES[mode][2] === 4; }

/**
 * The pentatonic subset of a mode: five notes with no semitone steps, all inside the mode, so any
 * of them is consonant over the mode's drone. Major modes take the major pentatonic, minor modes the minor.
 */
export function pentatonicFor(mode: ModeName): readonly number[] {
  return isMajorMode(mode) ? PENTATONIC_MAJOR : PENTATONIC_MINOR;
}

export function midiToHz(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Is `midi` one of the scale's pitch classes (scale given as semitone offsets from `root`)? */
export function inScale(midi: number, root: number, scale: readonly number[]): boolean {
  return scale.includes(mod(Math.round(midi) - root, 12));
}

/**
 * Snap a (possibly fractional) MIDI pitch to the nearest note of the scale. Ties go down, so the
 * result never climbs past a pitch that sits exactly between two scale notes.
 */
export function quantize(midi: number, root: number, scale: readonly number[]): number {
  const base = Math.floor(midi);
  let best = base, bestD = Infinity;
  for (let d = -7; d <= 7; d++) {
    const m = base + d;
    if (!inScale(m, root, scale)) continue;
    const dist = Math.abs(midi - m);
    if (dist < bestD - 1e-9) { best = m; bestD = dist; }
  }
  return best;
}

/** The note `degree` steps up the scale from `root` (negative steps go down; octaves wrap). */
export function scaleNote(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  return root + 12 * oct + scale[mod(degree, n)];
}

/**
 * Diatonic chord on a scale degree (0 = tonic), stacked in thirds inside the mode: 3 notes = triad,
 * 4 = seventh chord, 5 = ninth. Root position, starting at the degree's note above `root`.
 */
export function chordOn(root: number, mode: ModeName, degree: number, size = 3): number[] {
  const scale = MODES[mode];
  const out: number[] = [];
  for (let k = 0; k < size; k++) out.push(scaleNote(root, scale, degree + 2 * k));
  return out;
}

/**
 * Voice a chord's pitch classes near a previous voicing (smallest total movement) inside
 * [lo, hi]: slow, smooth harmonic motion for the pad.
 */
export function voiceLead(chord: readonly number[], prev: readonly number[] | null, lo: number, hi: number): number[] {
  const pcs = chord.map((m) => mod(m, 12));
  const center = prev && prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2;
  const out: number[] = [];
  for (const pc of pcs) {
    // candidate octaves of this pitch class inside the range; pick the one nearest the previous voice (or center)
    let best = -1, bestD = Infinity;
    for (let m = lo; m <= hi; m++) {
      if (mod(m, 12) !== pc) continue;
      const target = prev && prev.length ? nearest(prev, m) : center;
      const d = Math.abs(m - target) + (out.includes(m) ? 100 : 0);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best >= 0) out.push(best);
  }
  return out.sort((a, b) => a - b);
}

function nearest(list: readonly number[], m: number): number {
  let best = list[0], d = Infinity;
  for (const x of list) { const e = Math.abs(x - m); if (e < d) { d = e; best = x; } }
  return best;
}

/** Transpose a key by semitones (keeps the mode). */
export function transpose(key: Key, semis: number): Key { return { root: key.root + semis, mode: key.mode }; }
