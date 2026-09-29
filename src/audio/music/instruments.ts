/**
 * Music instruments: pad, bass, pulse, lead, drums, tension and boss layers, all synthesized. Each
 * Sector's SectorMusic picks waveforms, cutoffs and the drum style. Everything is low-passed well
 * under the harsh range (hats are band-passed around 5–7 kHz and quiet).
 */
import { filterTo, gainTo, perc, sustain } from '../synth';
import { midiToHz } from '../theory';
import type { NoteEv } from './composer';
import type { SectorMusic } from './sectors';

export interface InstrumentCtx {
  ctx: BaseAudioContext;
  dest: AudioNode;
  noise: AudioBuffer;
  sector: SectorMusic;
  intensity: number;
  tension: number;
  rand(): number;
}

function osc(c: InstrumentCtx, type: OscillatorType, f: number, t: number, end: number, dest: AudioNode, detune = 0): OscillatorNode {
  const o = c.ctx.createOscillator();
  o.type = type; o.frequency.value = f; if (detune) o.detune.value = detune;
  o.connect(dest); o.start(t); o.stop(end);
  return o;
}

function noiseSrc(c: InstrumentCtx, t: number, dur: number, dest: AudioNode): void {
  const s = c.ctx.createBufferSource();
  s.buffer = c.noise; s.connect(dest);
  s.start(t, c.rand() * Math.max(0, c.noise.duration - dur - 0.05), dur + 0.02);
}

/** Play one composed note at audio time t. */
export function playMusicNote(c: InstrumentCtx, ev: NoteEv, t: number): void {
  const s = c.sector, v = Math.max(0, Math.min(1.2, ev.vel));
  if (v <= 0.001) return;
  const f = midiToHz(ev.midi);
  switch (ev.inst) {
    case 'pad': {
      const att = Math.min(s.pad.attack, ev.dur * 0.4), rel = Math.min(1.4, ev.dur * 0.3);
      const end = t + ev.dur + 0.05;
      const g = gainTo(c.ctx, c.dest);
      sustain(g.gain, t, att, 0.045 * v, Math.max(0, ev.dur - att - rel), rel);
      // the filter breathes over the chord instead of an LFO: opens toward the middle, settles at the end
      const cut = s.pad.cutoff * (0.8 + 0.5 * c.intensity) * (1 - 0.3 * c.tension);
      const lp = filterTo(c.ctx, g, 'lowpass', cut * 0.7, 0.6 + 2 * c.tension);
      lp.frequency.setValueAtTime(cut * 0.7, t);
      lp.frequency.linearRampToValueAtTime(cut * (1 + s.pad.wobble), t + ev.dur * 0.5);
      lp.frequency.linearRampToValueAtTime(cut * 0.8, t + ev.dur);
      osc(c, s.pad.wave, f, t, end, lp, -s.pad.detune);
      osc(c, s.pad.wave, f, t, end, lp, s.pad.detune);
      break;
    }
    case 'bass': {
      const end = t + ev.dur + 0.1;
      const g = gainTo(c.ctx, c.dest);
      sustain(g.gain, t, 0.012, 0.075 * v, Math.max(0, ev.dur - 0.08), 0.08);
      const lp = filterTo(c.ctx, g, 'lowpass', s.bass.cutoff * (0.8 + 0.6 * c.intensity), 0.8);
      osc(c, s.bass.wave, f, t, end, lp);
      osc(c, 'sine', f, t, end, g);   // clean fundamental under the filtered tone
      break;
    }
    case 'boss': {
      const end = t + ev.dur + 0.05;
      const g = gainTo(c.ctx, c.dest);
      perc(g.gain, t, 0.008, 0.085 * v, ev.dur);
      const lp = filterTo(c.ctx, g, 'lowpass', 260, 2);
      osc(c, 'sawtooth', f, t, end, lp);
      osc(c, 'sine', f, t, end, g);
      break;
    }
    case 'pulse': {
      const d = Math.max(0.12, Math.min(ev.dur * 2, s.pulse.decay));
      const end = t + d + 0.05;
      const g = gainTo(c.ctx, c.dest);
      perc(g.gain, t, 0.004, 0.045 * v, d);
      const lp = filterTo(c.ctx, g, 'lowpass', s.pulse.cutoff, 1);
      lp.frequency.setValueAtTime(s.pulse.cutoff, t);
      lp.frequency.exponentialRampToValueAtTime(s.pulse.cutoff * 0.35, t + d);
      osc(c, s.pulse.wave, f, t, end, lp);
      break;
    }
    case 'lead': {
      const end = t + ev.dur + 0.3;
      const g = gainTo(c.ctx, c.dest);
      sustain(g.gain, t, 0.05, 0.045 * v, Math.max(0, ev.dur - 0.05), 0.25);
      const lp = filterTo(c.ctx, g, 'lowpass', s.lead.cutoff, 0.7);
      const o = osc(c, s.lead.wave, f, t, end, lp);
      if (s.lead.vibrato > 0 && ev.dur > 0.25) {
        // delayed vibrato on held notes
        const lfo = c.ctx.createOscillator(); lfo.frequency.value = 5;
        const depth = c.ctx.createGain();
        depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(s.lead.vibrato * 3, t + Math.min(0.6, ev.dur));
        lfo.connect(depth); depth.connect(o.detune);
        lfo.start(t); lfo.stop(end);
      }
      break;
    }
    case 'tension': {
      const end = t + ev.dur + 0.05;
      const g = gainTo(c.ctx, c.dest);
      sustain(g.gain, t, Math.min(2, ev.dur * 0.4), 0.02 * v, Math.max(0, ev.dur * 0.4), ev.dur * 0.2);
      osc(c, 'triangle', f, t, end, g, 6);
      osc(c, 'sine', f * 2, t, end, g, -6);
      break;
    }
    case 'kick': drumKick(c, ev, t, v); break;
    case 'snare': drumSnare(c, t, v); break;
    case 'hat': {
      const d = ev.dur > 0.1 ? 0.18 : s.perc.style === 'brush' ? 0.07 : 0.04;
      const g = gainTo(c.ctx, c.dest);
      perc(g.gain, t, 0.002, 0.03 * v, d);
      const bp = filterTo(c.ctx, g, 'bandpass', s.perc.style === 'brush' ? 4500 : 6500, 0.9);
      noiseSrc(c, t, d + 0.02, bp);
      break;
    }
    case 'fill': {
      const g = gainTo(c.ctx, c.dest);
      perc(g.gain, t, 0.003, 0.12 * v, 0.22);
      const o = osc(c, 'sine', f, t, t + 0.3, g);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.2);
      break;
    }
  }
}

function drumKick(c: InstrumentCtx, ev: NoteEv, t: number, v: number): void {
  const st = c.sector.perc.style;
  const g = gainTo(c.ctx, c.dest);
  if (st === 'timpani') {
    // tuned: the chord root two octaves up the bass, a long soft decay
    const f = midiToHz(ev.midi + 24);
    perc(g.gain, t, 0.01, 0.14 * v, 0.8);
    const o = osc(c, 'sine', f * 1.02, t, t + 0.9, g);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.15);
    osc(c, 'triangle', f * 1.5, t, t + 0.4, g).detune.value = 8;
    return;
  }
  const [f0, f1, d, peak] = st === 'brush' ? [90, 48, 0.35, 0.15] : st === 'heartbeat' ? [70, 38, 0.3, 0.18] : st === 'organic' ? [110, 46, 0.25, 0.16] : [120, 44, 0.3, 0.19];
  perc(g.gain, t, 0.003, peak * v, d);
  const o = osc(c, 'sine', f0, t, t + d + 0.05, g);
  o.frequency.exponentialRampToValueAtTime(f1, t + d * 0.6);
  if (st === 'organic') {
    const cg = gainTo(c.ctx, c.dest);
    perc(cg.gain, t, 0.001, 0.03 * v, 0.02);
    noiseSrc(c, t, 0.03, filterTo(c.ctx, cg, 'bandpass', 1800, 2));
  }
}

function drumSnare(c: InstrumentCtx, t: number, v: number): void {
  const st = c.sector.perc.style;
  if (st === 'organic') {
    // a woody knock instead of a snare
    const g = gainTo(c.ctx, c.dest);
    perc(g.gain, t, 0.002, 0.07 * v, 0.07);
    osc(c, 'triangle', 780 + c.rand() * 60, t, t + 0.1, g);
    const ng = gainTo(c.ctx, c.dest);
    perc(ng.gain, t, 0.001, 0.03 * v, 0.04);
    noiseSrc(c, t, 0.05, filterTo(c.ctx, ng, 'bandpass', 1400, 2));
    return;
  }
  const [f, d, peak] = st === 'brush' ? [3200, 0.22, 0.045] : st === 'march' ? [2000, 0.17, 0.08] : [1800, 0.15, 0.065];
  const ng = gainTo(c.ctx, c.dest);
  perc(ng.gain, t, st === 'brush' ? 0.02 : 0.002, peak * v, d);
  noiseSrc(c, t, d + 0.03, filterTo(c.ctx, ng, 'bandpass', f, 0.8));
  if (st !== 'brush') {
    const g = gainTo(c.ctx, c.dest);
    perc(g.gain, t, 0.002, 0.05 * v, 0.07);
    osc(c, 'triangle', 185, t, t + 0.1, g);
  }
}
