/**
 * Browser side of the offline render harness (tests/audio/render.mjs bundles this with esbuild and runs
 * it in headless Chromium). Renders SFX, a reference tone and music with OfflineAudioContext through
 * the real engine, analyzes the output in the page (peak, RMS, envelope, spectrum) and returns stats
 * plus 16-bit WAV bytes (base64). Also runs the director load test on a stepped OfflineAudioContext.
 */
import { AudioEngine, type Levels } from '../../src/audio/engine';
import { AudioDirector } from '../../src/audio/director';
import { SFX, SFX_GROUPS, SFX_IDS, type SfxId, type SfxParams } from '../../src/audio/sfx/index';
import { mixSeed } from '../../src/audio/rng';
import { encodeWav } from '../../src/audio/wav';
import { Ev, type AudioDigest, type SimEvent, type UiState } from '../../src/sim/core/types';

const SR = 44100;
/** Worst case for clipping: every level at its maximum. */
const FULL: Levels = { master: 1, sfx: 1, music: 1, muted: false, musicOn: true };

export interface Stats {
  peak: number; rmsDb: number; winRmsDb: number; nan: number; centroid: number;
  attack: number; decay: number; active: number; bands: number[]; seconds: number;
  /** Music only: short-term (3 s) RMS range in dB. */
  stMinDb?: number; stMaxDb?: number;
}

const db = (x: number): number => 20 * Math.log10(Math.max(1e-9, x));

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const xr = ar * wr - ai * wi, xi = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr; im[i + k] += xi;
      }
    }
  }
}

function analyze(buf: AudioBuffer, music = false): Stats {
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  let peak = 0, sum = 0, nan = 0;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = L[i], b = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) { nan++; continue; }
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    sum += (a * a + b * b) / 2;
    mono[i] = (a + b) / 2;
  }
  // 50 ms RMS windows (loudness of the loudest moment) and a 5 ms envelope
  const w = Math.floor(0.05 * SR);
  let winMax = 0;
  for (let i = 0; i + w <= n; i += Math.floor(w / 2)) {
    let s = 0;
    for (let k = i; k < i + w; k++) s += mono[k] * mono[k];
    winMax = Math.max(winMax, Math.sqrt(s / w));
  }
  const ew = Math.floor(0.005 * SR), env: number[] = [];
  for (let i = 0; i + ew <= n; i += ew) { let s = 0; for (let k = i; k < i + ew; k++) s += mono[k] * mono[k]; env.push(Math.sqrt(s / ew)); }
  let emax = 0, imax = 0;
  env.forEach((v, i) => { if (v > emax) { emax = v; imax = i; } });
  const first = env.findIndex((v) => v > emax * 0.01);
  let last = env.length - 1;
  while (last > 0 && env[last] < emax * 0.01) last--;
  let dec = imax;
  while (dec < env.length - 1 && env[dec] > emax * 0.0316) dec++;
  // spectrum: energy-weighted over 2048-sample frames (Hann), centroid and 16 log bands 60 Hz–16 kHz
  const N = 2048, re = new Float64Array(N), im = new Float64Array(N), power = new Float64Array(N / 2);
  for (let i = 0; i + N <= n; i += N / 2) {
    for (let k = 0; k < N; k++) { re[k] = mono[i + k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1))); im[k] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
  }
  let ps = 0, pf = 0;
  const bands = new Array(16).fill(0);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * SR) / N;
    ps += power[k]; pf += power[k] * f;
    const b = Math.floor((Math.log(f / 60) / Math.log(16000 / 60)) * 16);
    if (b >= 0 && b < 16) bands[b] += power[k];
  }
  const bsum = bands.reduce((a, b) => a + b, 0) || 1;
  const st: Partial<Stats> = {};
  if (music) {
    const sw = 3 * SR;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i + sw <= n; i += sw) { let s = 0; for (let k = i; k < i + sw; k++) s += mono[k] * mono[k]; const d = db(Math.sqrt(s / sw)); mn = Math.min(mn, d); mx = Math.max(mx, d); }
    st.stMinDb = mn; st.stMaxDb = mx;
  }
  return {
    peak, rmsDb: db(Math.sqrt(sum / Math.max(1, n))), winRmsDb: db(winMax), nan, centroid: ps > 0 ? pf / ps : 0,
    attack: Math.max(0, imax - Math.max(0, first)) * 0.005, decay: Math.max(0, dec - imax) * 0.005, active: Math.max(0, last - first) * 0.005,
    bands: bands.map((b) => b / bsum), seconds: n / SR, ...st,
  };
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function wavOf(buf: AudioBuffer, mono: boolean): string {
  if (!mono) return b64(encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate));
  const L = buf.getChannelData(0), R = buf.getChannelData(1), m = new Float32Array(L.length);
  for (let i = 0; i < m.length; i++) m[i] = (L[i] + R[i]) / 2;
  return b64(encodeWav([m], buf.sampleRate));
}

async function renderSfx(id: SfxId, params: SfxParams = {}): Promise<{ stats: Stats; wav: string }> {
  const dur = SFX[id].dur(params) + 1.3;   // plus the reverb tail
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const e = new AudioEngine(ctx, { seed: 7, levels: { ...FULL, musicOn: false } });
  e.sfx(id, { ...params }, 0.02);
  const buf = await ctx.startRendering();
  return { stats: analyze(buf), wav: wavOf(buf, false) };
}

/** A 440 Hz sine at 0.25 amplitude (−12 dBFS peak) through the same effects chain: the loudness reference. */
async function renderReference(): Promise<{ stats: Stats; wav: string }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(2.3 * SR), SR);
  const e = new AudioEngine(ctx, { seed: 7, levels: { ...FULL, musicOn: false } });
  const bus = (e as unknown as { sfxBus: AudioNode }).sfxBus;
  const o = ctx.createOscillator(); o.frequency.value = 440;
  const g = ctx.createGain(); g.gain.value = 0.25;
  o.connect(g); g.connect(bus);
  o.start(0.02); o.stop(1.02);
  const buf = await ctx.startRendering();
  return { stats: analyze(buf), wav: wavOf(buf, false) };
}

async function renderMusic(sector: number, intensity: number, seconds: number, opts: { bossPhase?: number; tension?: number } = {}): Promise<{ stats: Stats; wav: string; notes: number; scheduleMs: number; renderMs: number }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const e = new AudioEngine(ctx, { seed: 1000 + sector, levels: FULL });
  e.setMusic({ sector, intensity, tension: opts.tension ?? 0, bossPhase: opts.bossPhase ?? -1 });
  e.reseedMusic(mixSeed(0, sector * 20 + 5));
  // Stepped like the live game: the context pauses every 0.2 s of audio time and the scheduler tops up its
  // 0.3 s lookahead, so only a few notes are pending at once (pre-scheduling a whole minute would make the
  // renderer carry thousands of idle nodes and overstate the cost).
  let scheduleMs = 0;
  e.pump(0);
  for (let k = 1; k * 0.2 < seconds; k++) {
    const at = k * 0.2;
    void ctx.suspend(at).then(() => { const s0 = performance.now(); e.pump(at); scheduleMs += performance.now() - s0; void ctx.resume(); });
  }
  const t1 = performance.now();
  const buf = await ctx.startRendering();
  const t2 = performance.now();
  // (render − scheduling) / audio length ≈ the audio-thread load this music costs in real time on this machine
  return { stats: analyze(buf, true), wav: wavOf(buf, true), notes: e.music.notes, scheduleMs, renderMs: t2 - t1 - scheduleMs };
}

function fakeUi(wave: number, alive: number): UiState {
  return {
    run: { wave, phase: 'combat', speedMultiplier: 1, pendingDraft: null },
    wave: { isBoss: false, bossPhase: 0, enemiesAlive: alive, sector: 'x' },
    tower: { hp: 100, maxHp: 100, shield: 0, maxShield: 0, barrier: 0, maxBarrier: 0 },
    build: { hardpoints: ['laser'], ranks: { 'laser.nodes': 2 } },
    meta: { prestigeCount: 0, ascension: 0 },
  } as unknown as UiState;
}

/**
 * Load test: 500 events/s and 2,000 hit links/s through the director into the real engine for
 * `seconds`, one batch per 1/60 s of audio time (a stepped OfflineAudioContext), measuring the
 * main-thread cost per frame (director + node creation + music scheduling) and the voice peak.
 */
async function loadTest(seconds = 10, eventsPerSec = 500, linksPerSec = 2000): Promise<{ p50: number; p95: number; max: number; voicesPeak: number; plays: number; dropped: number; stolen: number; stats: Stats; wav: string; notes: number }> {
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + 1.5) * SR), SR);
  const e = new AudioEngine(ctx, { seed: 11, levels: FULL });
  const d = new AudioDirector(() => e);
  const frameMs: number[] = [];
  let seed = 99;
  const rand = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const kinds: [Ev, string, number][] = [[Ev.Kill, 'ballistics', 0], [Ev.StatusApply, 'fire', 0], [Ev.StatusApply, 'frost', 3], [Ev.StatusApply, 'poison', 2], [Ev.Explosion, 'ordnance', 0],
    [Ev.Fusion, 'fusion.plasma', 0], [Ev.Linkage, 'link.blade+laser', 0], [Ev.Kill, 'lightning', 32], [Ev.Infusion, 'infuse.laser.frost', 0], [Ev.TowerHit, 'grunt', 0]];
  let id = 1;
  let prev: number[] = [];
  const frames = seconds * 60;
  const perFrame = eventsPerSec / 60, linksPerFrame = linksPerSec / 60;
  d.onUi(fakeUi(60, 1200));
  e.pump(0);
  for (let f = 1; f <= frames; f++) {
    void ctx.suspend(f / 60).then(() => {
      const t0 = performance.now();
      const links: number[] = [];
      const hits: SimEvent[] = [];
      const nl = Math.floor(linksPerFrame + rand());
      for (let k = 0; k < nl; k++) {
        const hid = id++;
        const cause = prev.length && rand() < 0.6 ? prev[Math.floor(rand() * prev.length)] : -1;
        links.push(hid, cause, rand() < 0.3 ? 1 : 0);
        if (k % 4 === 0) hits.push({ id: hid, tick: f, type: Ev.Hit, cause, src: rand() < 0.4 ? 'ballistics' : rand() < 0.5 ? 'lightning' : 'laser', a: 0, b: 1, x: rand() * 900 - 450, y: 0, c: rand() < 0.1 ? 256 : 0 });
      }
      const events: SimEvent[] = [];
      const ne = Math.floor(perFrame + rand());
      for (let k = 0; k < ne; k++) {
        const [type, src, c] = kinds[Math.floor(rand() * kinds.length)];
        const cause = links.length && rand() < 0.7 ? links[3 * Math.floor(rand() * (links.length / 3))] : -1;
        events.push({ id: id++, tick: f, type, cause, src, a: 20 + rand() * 100, b: 1, x: rand() * 900 - 450, y: 0, c });
      }
      prev = events.map((x) => x.id);
      const digest: AudioDigest = { links: Int32Array.from(links), hits, shots: [4, 30, 1, -100, 2, 200, 0, 0] };
      d.onEvents(events, digest);
      if (f % 6 === 0) d.onUi(fakeUi(60, 1200));
      e.pump();
      frameMs.push(performance.now() - t0);
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  frameMs.sort((a, b) => a - b);
  const v = e.admission.voices;
  return {
    p50: frameMs[Math.floor(frameMs.length * 0.5)], p95: frameMs[Math.floor(frameMs.length * 0.95)], max: frameMs[frameMs.length - 1],
    voicesPeak: v.peak, plays: e.plays, dropped: v.dropped, stolen: v.stolen, stats: analyze(buf), wav: wavOf(buf, true), notes: d.notesPlayed,
  };
}

const api = { SFX_IDS, SFX_GROUPS, renderSfx, renderReference, renderMusic, loadTest };
(globalThis as unknown as { CitadelAudio: typeof api }).CitadelAudio = api;
