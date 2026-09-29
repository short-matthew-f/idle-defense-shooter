import { describe, expect, it } from 'vitest';
import { SECTOR_MUSIC, sectorMusic, stepSeconds, tempoFor } from '../../src/audio/music/sectors';
import { Composer, type NoteEv } from '../../src/audio/music/composer';
import { layersFor } from '../../src/audio/intensity';
import { chordOn, inScale, MODES, pentatonicFor, transpose } from '../../src/audio/theory';

function render(sector: number, seed: number, intensity: number, bars: number, bossPhase = -1): NoteEv[][] {
  const c = new Composer(sectorMusic(sector), seed);
  c.setBossPhase(bossPhase);
  const steps: NoteEv[][] = [];
  for (let s = 0; s < bars * 16; s++) {
    const out: NoteEv[] = [];
    c.step(s, { layers: layersFor(intensity, bossPhase >= 0, 0), intensity, bossPhase }, out);
    steps.push(out);
  }
  return steps;
}
const PITCHED = new Set(['pad', 'bass', 'pulse', 'lead', 'boss']);

describe('audio music: Sector parameters', () => {
  it('five Sectors, each with its own key, mode or tempo range, and well-formed patterns', () => {
    expect(SECTOR_MUSIC.length).toBe(5);
    const sig = new Set(SECTOR_MUSIC.map((s) => `${s.key.root % 12}/${s.key.mode}`));
    expect(sig.size).toBe(5);
    for (const s of SECTOR_MUSIC) {
      expect(s.bpm[0]).toBeLessThan(s.bpm[1]);
      expect(s.bpm[0]).toBeGreaterThanOrEqual(56);
      expect(s.bpm[1]).toBeLessThanOrEqual(120);
      expect(s.moves.length).toBe(7);
      for (const row of s.moves) expect(row.length).toBe(7);
      for (const p of s.pulse.patterns) expect(p.length).toBe(16);
      for (const p of [s.bass.pattern, s.perc.kick, s.perc.snare, s.perc.hat]) expect(p.length).toBe(16);
      // chains never target a diminished chord (the one degree whose fifth is not perfect)
      for (let d = 0; d < 7; d++) {
        const ch = chordOn(s.key.root, s.key.mode, d, 3);
        const dim = ch[2] - ch[0] !== 7;
        if (dim) for (const row of s.moves) expect(row[d]).toBe(0);
      }
    }
    expect(SECTOR_MUSIC[3].bpm[1]).toBeLessThan(SECTOR_MUSIC[1].bpm[0]);   // The Fold is slower than The Hive
    expect(sectorMusic(99).id).toBe('court');
  });

  it('tempo follows intensity inside the Sector range', () => {
    for (const s of SECTOR_MUSIC) {
      expect(tempoFor(s, 0)).toBe(s.bpm[0]);
      expect(tempoFor(s, 1)).toBe(s.bpm[1]);
      expect(tempoFor(s, 0.5)).toBeGreaterThan(s.bpm[0]);
    }
    expect(stepSeconds(120)).toBeCloseTo(0.125, 9);
  });
});

describe('audio music: composer', () => {
  it('is reproducible from its seed, and different seeds differ', () => {
    const a = JSON.stringify(render(1, 42, 0.7, 16));
    expect(JSON.stringify(render(1, 42, 0.7, 16))).toBe(a);
    expect(JSON.stringify(render(1, 43, 0.7, 16))).not.toBe(a);
  });

  it('every pitched note is in the key (including boss-phase key shifts)', () => {
    for (let si = 0; si < 5; si++) {
      for (const phase of [-1, 0, 1, 2]) {
        const s = sectorMusic(si);
        const key = phase < 0 ? s.key : transpose(s.key, s.bossShift[phase]);
        const steps = render(si, 7 + si, 0.9, 24, phase);
        let n = 0;
        // after the first chord change, the key has switched
        for (const ev of steps.slice(16 * s.barsPerChord).flat()) {
          if (!PITCHED.has(ev.inst)) continue;
          n++;
          expect(inScale(ev.midi, key.root, MODES[key.mode]), `${s.id} phase ${phase} ${ev.inst} ${ev.midi}`).toBe(true);
        }
        expect(n).toBeGreaterThan(20);
      }
    }
  });

  it('lead notes use the pentatonic, the pulse and pad use chord tones, no harsh highs', () => {
    for (let si = 0; si < 5; si++) {
      const s = sectorMusic(si);
      for (const ev of render(si, 3, 1, 32).flat()) {
        if (ev.inst === 'lead') expect(inScale(ev.midi, s.key.root, pentatonicFor(s.key.mode))).toBe(true);
        if (PITCHED.has(ev.inst)) expect(ev.midi).toBeLessThanOrEqual(96);   // C7 at most
      }
    }
  });

  it('wave-1 intensity is only the pad; high intensity brings drums, bass, pulse and lead', () => {
    const low = render(0, 1, 0.12, 16).flat();
    const kinds = (evs: NoteEv[]): Set<string> => new Set(evs.filter((e) => e.vel > 0.05).map((e) => e.inst));
    const lk = kinds(low);
    expect(lk.has('pad')).toBe(true);
    for (const k of ['kick', 'snare', 'hat', 'lead', 'pulse']) expect(lk.has(k)).toBe(false);
    const hk = kinds(render(0, 1, 0.9, 16).flat());
    for (const k of ['pad', 'bass', 'pulse', 'kick', 'hat', 'lead']) expect(hk.has(k)).toBe(true);
  });

  it('boss waves add the boss ostinato, and phase changes shift the rhythm', () => {
    const count = (evs: NoteEv[], k: string): number => evs.filter((e) => e.inst === k).length;
    const p0 = render(2, 5, 0.8, 8, 0).flat(), p2 = render(2, 5, 0.8, 8, 2).flat();
    expect(count(p0, 'boss')).toBeGreaterThan(0);
    expect(count(render(2, 5, 0.8, 8, -1).flat(), 'boss')).toBe(0);
    expect(count(p2, 'kick')).toBeGreaterThan(count(p0, 'kick'));
  });

  it('does not repeat a 4-bar loop: over 64 bars most 4-bar windows are distinct', () => {
    for (let si = 0; si < 5; si++) {
      const steps = render(si, 11, 0.75, 64);
      const bars: string[] = [];
      for (let b = 0; b < 64; b++) bars.push(JSON.stringify(steps.slice(b * 16, b * 16 + 16).map((evs) => evs.filter((e) => e.inst !== 'hat' && e.inst !== 'kick').map((e) => `${e.inst}${e.midi}`))));
      const windows = new Set<string>();
      for (let b = 0; b + 4 <= 64; b += 4) windows.add(bars.slice(b, b + 4).join('|'));
      expect(windows.size, sectorMusic(si).id).toBeGreaterThanOrEqual(14);   // of 16 windows
    }
  });

  it('harmony moves slowly: a chord holds for the Sector bars-per-chord', () => {
    for (let si = 0; si < 5; si++) {
      const s = sectorMusic(si);
      const steps = render(si, 2, 0.5, 16);
      steps.forEach((evs, i) => {
        const pads = evs.filter((e) => e.inst === 'pad');
        if (pads.length) expect(i % (16 * s.barsPerChord)).toBe(0);
      });
    }
  });

  it('tempo drifts at most 1 BPM per bar toward the target', () => {
    const c = new Composer(sectorMusic(1), 1);
    const bpms: number[] = [];
    for (let s = 0; s < 16 * 20; s++) { c.step(s, { layers: layersFor(1, false, 0), intensity: 1, bossPhase: -1 }, []); if (s % 16 === 0) bpms.push(c.bpm); }
    for (let i = 1; i < bpms.length; i++) expect(Math.abs(bpms[i] - bpms[i - 1])).toBeLessThanOrEqual(1);
    expect(bpms[bpms.length - 1]).toBe(sectorMusic(1).bpm[1]);
  });
});
