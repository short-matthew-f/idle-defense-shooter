/**
 * Synthesis primitives shared by sound effects and music: oscillators and filtered noise with
 * percussive envelopes, FM bells and swells. Everything is generated with Web Audio nodes; there are
 * no sample files. Each primitive schedules its nodes at an absolute audio time and records its
 * sources on the Voice so a stolen voice can be stopped.
 */

export interface Voice {
  ctx: BaseAudioContext;
  /** Start time (audio clock). */
  t: number;
  /** Where the sound connects (a voice gain feeding the slot's panner). */
  out: AudioNode;
  /** Shared white-noise buffer (2 s). */
  noise: AudioBuffer;
  /** Sources created for this voice (stopped early if the voice is stolen). */
  srcs: AudioScheduledSourceNode[];
  /** 0..1 variation source (the engine's seeded generator). */
  rand(): number;
}

const MIN = 0.0001;

/** Percussive envelope: 0 → peak in `a`, exponential fall to silence over `d`. */
export function perc(p: AudioParam, t: number, a: number, peak: number, d: number): void {
  p.setValueAtTime(MIN, t);
  p.linearRampToValueAtTime(Math.max(MIN, peak), t + Math.max(0.001, a));
  p.exponentialRampToValueAtTime(MIN, t + Math.max(0.001, a) + Math.max(0.005, d));
}

/** Sustained envelope: attack, hold at peak, release, all in seconds from t. */
export function sustain(p: AudioParam, t: number, a: number, peak: number, hold: number, r: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + Math.max(0.005, a));
  p.setValueAtTime(peak, t + Math.max(0.005, a) + Math.max(0, hold));
  p.linearRampToValueAtTime(0, t + Math.max(0.005, a) + Math.max(0, hold) + Math.max(0.01, r));
}

export function gainTo(ctx: BaseAudioContext, dest: AudioNode, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  g.connect(dest);
  return g;
}

export function filterTo(ctx: BaseAudioContext, dest: AudioNode, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q;
  b.connect(dest);
  return b;
}

export interface ToneOpts {
  type?: OscillatorType;
  f: number;
  /** Glide target frequency (exponential over `glide` s, default the whole decay). */
  f1?: number;
  glide?: number;
  /** Delay from the voice start (s). */
  at?: number;
  a?: number;
  d: number;
  gain: number;
  detune?: number;
  /** Low-pass cutoff (Hz) and optional cutoff at the end of the decay. */
  lp?: number;
  lp1?: number;
  dest?: AudioNode;
}

/** One oscillator with a percussive envelope (and optional glide and low-pass). Returns its end time. */
export function tone(v: Voice, o: ToneOpts): number {
  const { ctx } = v;
  const t = v.t + (o.at ?? 0), a = o.a ?? 0.004;
  const end = t + a + o.d + 0.03;
  const g = gainTo(ctx, o.dest ?? v.out);
  perc(g.gain, t, a, o.gain, o.d);
  let into: AudioNode = g;
  if (o.lp) {
    const f = filterTo(ctx, g, 'lowpass', o.lp, 0.5);
    if (o.lp1) { f.frequency.setValueAtTime(o.lp, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, o.lp1), t + a + o.d); }
    into = f;
  }
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f1 && o.f1 !== o.f) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + (o.glide ?? a + o.d));
  if (o.detune) osc.detune.value = o.detune;
  osc.connect(into);
  osc.start(t); osc.stop(end);
  v.srcs.push(osc);
  return end;
}

export interface NoiseOpts {
  type: BiquadFilterType;
  f: number;
  f1?: number;
  q?: number;
  at?: number;
  a?: number;
  d: number;
  gain: number;
  dest?: AudioNode;
}

/** Filtered white noise with a percussive envelope (filter may sweep from f to f1). Returns its end time. */
export function noise(v: Voice, o: NoiseOpts): number {
  const { ctx } = v;
  const t = v.t + (o.at ?? 0), a = o.a ?? 0.002;
  const end = t + a + o.d + 0.03;
  const g = gainTo(ctx, o.dest ?? v.out);
  perc(g.gain, t, a, o.gain, o.d);
  const f = filterTo(ctx, g, o.type, o.f, o.q ?? 0.8);
  if (o.f1) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + a + o.d); }
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  src.connect(f);
  const off = v.rand() * Math.max(0, v.noise.duration - (end - t) - 0.05);
  src.start(t, off, end - t);
  v.srcs.push(src);
  return end;
}

export interface FmOpts { f: number; ratio: number; index: number; at?: number; a?: number; d: number; gain: number; dest?: AudioNode; type?: OscillatorType }

/** Two-operator FM (bells, glass, metallic pings): the modulation index decays with the note. */
export function fm(v: Voice, o: FmOpts): number {
  const { ctx } = v;
  const t = v.t + (o.at ?? 0), a = o.a ?? 0.002;
  const end = t + a + o.d + 0.03;
  const g = gainTo(ctx, o.dest ?? v.out);
  perc(g.gain, t, a, o.gain, o.d);
  const car = ctx.createOscillator();
  car.type = o.type ?? 'sine';
  car.frequency.value = o.f;
  const mod = ctx.createOscillator();
  mod.frequency.value = o.f * o.ratio;
  const mg = ctx.createGain();
  perc(mg.gain, t, a, o.index * o.f, o.d * 0.6);
  mod.connect(mg); mg.connect(car.frequency);
  car.connect(g);
  car.start(t); mod.start(t); car.stop(end); mod.stop(end);
  v.srcs.push(car, mod);
  return end;
}

export interface SwellOpts {
  type?: OscillatorType;
  f: number;
  f1?: number;
  at?: number;
  /** Rise time, hold at peak, release (s). */
  rise: number;
  hold?: number;
  release: number;
  gain: number;
  lp?: number;
  lp1?: number;
  detune?: number;
  dest?: AudioNode;
}

/** A sustained, rising sound (risers, pads, swells): linear rise, hold, release; pitch and filter may sweep over the rise. */
export function swell(v: Voice, o: SwellOpts): number {
  const { ctx } = v;
  const t = v.t + (o.at ?? 0);
  const hold = o.hold ?? 0;
  const end = t + o.rise + hold + o.release + 0.03;
  const g = gainTo(ctx, o.dest ?? v.out);
  sustain(g.gain, t, o.rise, o.gain, hold, o.release);
  let into: AudioNode = g;
  if (o.lp) {
    const f = filterTo(ctx, g, 'lowpass', o.lp, 0.9);
    if (o.lp1) { f.frequency.setValueAtTime(o.lp, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, o.lp1), t + o.rise); }
    into = f;
  }
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sawtooth';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + o.rise + hold * 0.5);
  if (o.detune) osc.detune.value = o.detune;
  osc.connect(into);
  osc.start(t); osc.stop(end);
  v.srcs.push(osc);
  return end;
}

/** Filtered noise swell (whooshes, risers, washes). */
export function noiseSwell(v: Voice, o: { type: BiquadFilterType; f: number; f1?: number; q?: number; at?: number; rise: number; hold?: number; release: number; gain: number; dest?: AudioNode }): number {
  const { ctx } = v;
  const t = v.t + (o.at ?? 0);
  const hold = o.hold ?? 0;
  const end = t + o.rise + hold + o.release + 0.03;
  const g = gainTo(ctx, o.dest ?? v.out);
  sustain(g.gain, t, o.rise, o.gain, hold, o.release);
  const f = filterTo(ctx, g, o.type, o.f, o.q ?? 1);
  if (o.f1) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + o.rise + hold); }
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  src.loop = true;
  src.connect(f);
  src.start(t, v.rand() * (v.noise.duration - 0.1));
  src.stop(end);
  v.srcs.push(src);
  return end;
}

/** A 2 s white-noise buffer (seeded, so offline renders are reproducible). */
export function makeNoise(ctx: BaseAudioContext, rand: () => number, seconds = 2): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = rand() * 2 - 1;
  return buf;
}

/**
 * Stereo reverb impulse: decorrelated noise with an exponential decay, darkened by a one-pole
 * low-pass that closes over the tail (a warm room, no metallic highs).
 */
export function makeImpulse(ctx: BaseAudioContext, rand: () => number, seconds = 2.2, decay = 3.2): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const k = 0.5 - 0.42 * x;          // filter coefficient: brighter at the start, darker in the tail
      lp += k * ((rand() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - x, decay) * (i < 32 ? i / 32 : 1);
    }
  }
  return buf;
}

/** Soft-clip curve: linear to ±0.9, then a smooth knee that never exceeds ±ceiling. */
export function softClipCurve(ceiling = 0.98, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const knee = 0.9;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + (ceiling - knee) * Math.tanh((ax - knee) / (ceiling - knee));
    c[i] = Math.sign(x) * Math.min(ceiling, y);
  }
  return c;
}
