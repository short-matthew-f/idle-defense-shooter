import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { AudioDirector } from '../../src/audio/director';
import { VOICE_CAP, type SoundOut } from '../../src/audio/engine';
import { Admission } from '../../src/audio/mixer';
import { SFX, SFX_IDS, SFX_INDEX, type SfxId, type SfxParams } from '../../src/audio/sfx/index';
import type { Timbre } from '../../src/audio/chain';
import type { MusicTarget } from '../../src/audio/music/player';
import { inScale, MODES, type Key } from '../../src/audio/theory';
import { Ev, type AudioDigest, type SimEvent, type UiState } from '../../src/sim/core/types';
import { StateBit } from '../../src/sim/core/events';

/** A SoundOut that runs the engine's real admission control and records what would play. */
class FakeOut implements SoundOut {
  readonly admission = new Admission(SFX_IDS.length + 12, VOICE_CAP);
  t = 0;
  key: Key = { root: 50, mode: 'dorian' };
  beatSeconds = 0.75;
  sfxLog: { id: SfxId; p: SfxParams; t: number }[] = [];
  notes: { timbre: Timbre; midi: number; at: number }[] = [];
  calls: string[] = [];
  music: MusicTarget | null = null;
  peak = 0;
  now(): number { return this.t; }
  private track(): void { this.peak = Math.max(this.peak, this.admission.voices.active(this.t)); }
  sfx(id: SfxId, p: SfxParams = {}): boolean {
    const def = SFX[id];
    if (!def) throw new Error(`no sfx ${id}`);
    const ok = !!this.admission.admit({ id: SFX_INDEX[id], priority: def.priority, minInterval: def.minInterval, dur: def.dur(p) }, this.t);
    if (ok) { this.sfxLog.push({ id, p: { ...p }, t: this.t }); this.track(); }
    return ok;
  }
  note(timbre: Timbre, midi: number, _vel: number, _pan: number, at: number, priority: number): boolean {
    const ok = !!this.admission.admit({ id: SFX_IDS.length, priority, minInterval: 0.035, dur: 0.4 }, Math.max(this.t, at));
    if (ok) { this.notes.push({ timbre, midi, at }); this.track(); }
    return ok;
  }
  setSpeed(s: number): void { this.admission.setSpeed(s); this.calls.push(`speed${s}`); }
  setMuffled(on: boolean): void { this.calls.push(`muffle${on}`); }
  setHum(): void { /* noop */ }
  setMusic(t: MusicTarget): void { this.music = t; }
  reseedMusic(seed: number): void { this.calls.push(`seed${seed}`); }
  dropBeat(): void { this.calls.push('drop'); }
  fallAway(): void { this.calls.push('fall'); }
  rebuild(): void { this.calls.push('rebuild'); }
  nextGrid(t: number): number { return Math.ceil(t / 0.0625) * 0.0625; }
}

let nextId = 1;
const ev = (type: Ev, src: string, extra: Partial<SimEvent> = {}): SimEvent => ({ id: nextId++, tick: 0, type, cause: -1, src, a: 0, b: 0, x: 0, y: 0, c: 0, ...extra });
const digest = (links: number[][], hits: SimEvent[] = [], shots = [0, 0, 0, 0, 0, 0, 0, 0]): AudioDigest => ({ links: Int32Array.from(links.flat()), hits, shots });

function ui(over: { wave?: number; phase?: UiState['run']['phase']; alive?: number; boss?: boolean; hp?: number; draft?: string[] | null } = {}): UiState {
  return {
    run: { wave: over.wave ?? 1, phase: over.phase ?? 'combat', speedMultiplier: 1, pendingDraft: over.draft ?? null },
    wave: { isBoss: !!over.boss, bossPhase: 0, enemiesAlive: over.alive ?? 5, sector: 'outskirts' },
    tower: { hp: over.hp ?? 100, maxHp: 100, shield: 0, maxShield: 0, barrier: 0, maxBarrier: 0 },
    build: { hardpoints: [], ranks: {} },
    meta: { prestigeCount: 0, ascension: 0 },
  } as unknown as UiState;
}

describe('audio director: events → sounds', () => {
  it('maps lifecycle and ability events to their sounds', () => {
    const o = new FakeOut();
    const d = new AudioDirector(() => o);
    d.onEvents([ev(Ev.Cast, 'ability.time_field'), ev(Ev.WaveClear, 'outskirts'), ev(Ev.Checkpoint, 'run')]);
    const ids = o.sfxLog.map((s) => s.id);
    expect(ids).toContain('ab_time_field');
    expect(ids).toContain('checkpoint');
    expect(ids).not.toContain('wave_clear');       // the checkpoint fanfare replaces it
    o.t = 5;
    d.onEvents([ev(Ev.BossTell, 'boss.breaker'), ev(Ev.CounterScored, 'repulsor_pulse'), ev(Ev.TowerDeath, 'tower'), ev(Ev.AttemptStart, 'run')]);
    const tell = o.sfxLog.find((s) => s.id === 'boss_tell');
    expect(tell?.p.dur).toBe(1.5);                   // The Breaker's tell window
    expect(o.sfxLog.some((s) => s.id === 'counter')).toBe(true);
    expect(o.calls).toEqual(expect.arrayContaining(['drop', 'fall', 'rebuild']));
  });

  it('every ability has a sound, and every status index maps to a defined sound', () => {
    for (const a of ['hunter_mark', 'repulsor_pulse', 'time_field', 'bombardment', 'emp', 'overdrive', 'emergency_repair', 'drone_surge', 'missile_storm', 'singularity_bomb']) {
      expect(SFX[`ab_${a}` as SfxId], a).toBeDefined();
    }
    const o = new FakeOut();
    const d = new AudioDirector(() => o);
    for (let s = 0; s < 9; s++) { o.t += 1; d.onEvents([ev(Ev.StatusApply, 'fire', { c: s })]); }
    expect(new Set(o.sfxLog.map((x) => x.id)).size).toBe(9);
  });

  it('a single purchase ticks at a rank pitch; a bulk buy is one arpeggio', () => {
    const o = new FakeOut();
    const d = new AudioDirector(() => o);
    d.onEvents([ev(Ev.Purchase, 'ballistics.damage', { a: 3 })]);
    o.t = 1;
    d.onEvents(Array.from({ length: 12 }, (_, i) => ev(Ev.Purchase, 'ballistics.damage', { a: 4 + i })));
    expect(o.sfxLog.map((s) => s.id)).toEqual(['purchase', 'purchase_bulk']);
    expect(o.sfxLog[1].p.n).toBe(8);
  });

  it('a long chain plays as a rising melody in key, with timbre by src', () => {
    const o = new FakeOut();
    const d = new AudioDirector(() => o);
    // "The drone shocked the frozen enemy, which caused the lightning to jump through the laser node,
    //  which detonated its poison, which killed the elite, which launched the missiles."
    const h0 = nextId++;                                                  // drone hit (in the digest links)
    const shock = ev(Ev.StatusApply, 'drones', { cause: h0, c: 1 });
    const jump = nextId++;                                                // lightning Hit (links)
    const link = ev(Ev.Linkage, 'link.laser+lightning', { cause: jump });
    const pois = ev(Ev.Explosion, 'poison', { cause: link.id, a: 40 });
    const hk = nextId++;                                                  // poison Hit (links)
    const kill = ev(Ev.Kill, 'poison', { cause: hk, c: StateBit.Elite });
    const launch = ev(Ev.Fusion, 'fusion.volatile', { cause: kill.id });
    const links = [[h0, -1, 0], [jump, shock.id, 0], [hk, pois.id, 0]];
    d.onEvents([shock, link, pois, kill, launch], digest(links, [
      { id: jump, tick: 0, type: Ev.Hit, cause: shock.id, src: 'lightning', a: 0, b: 0, x: 0, y: 0, c: 0 },
    ]));
    expect(d.chain.depthOf(launch.id)).toBe(6);
    expect(d.chain.depthOf(kill.id)).toBe(5);                             // continues the poison Hit
    const midis = o.notes.map((n) => n.midi);
    expect(midis.length).toBe(4);                                         // per-batch cap, deepest kept
    for (let i = 1; i < midis.length; i++) expect(midis[i]).toBeGreaterThan(midis[i - 1]);
    for (const m of midis) expect(inScale(m, 50, MODES.dorian)).toBe(true);
    for (let i = 1; i < o.notes.length; i++) expect(o.notes[i].at).toBeGreaterThan(o.notes[i - 1].at);
    expect(o.notes[o.notes.length - 1].timbre).toBe('shimmer');
  });

  it('UiState drives the music target: wave 1 ambient, boss phase, tension; draft chime once', () => {
    const o = new FakeOut();
    const d = new AudioDirector(() => o);
    d.onUi(ui({ wave: 1 }));
    expect(o.music?.intensity).toBeLessThan(0.2);
    expect(o.music?.bossPhase).toBe(-1);
    d.onUi(ui({ wave: 40, boss: true, alive: 60, hp: 20 }));
    expect(o.music?.sector).toBe(1);
    expect(o.music?.bossPhase).toBe(0);
    expect(o.music?.tension).toBeGreaterThan(0.5);
    d.onUi(ui({ draft: ['a', 'b'] }));
    d.onUi(ui({ draft: ['a', 'b'] }));
    expect(o.sfxLog.filter((s) => s.id === 'draft_ready').length).toBe(1);
  });

  it('screen and pause muffle the music; speed reaches the engine', () => {
    const o = new FakeOut();
    const d = new AudioDirector(() => o);
    d.setScreen('upgrades');
    d.setScreen('battle');
    d.setPaused(true);
    d.setSimSpeed(8);
    expect(o.calls).toEqual(['muffletrue', 'mufflefalse', 'muffletrue', 'speed8']);
  });

  it('is a silent no-op without an output (no Web Audio, locked, muted or hidden)', () => {
    const d = new AudioDirector(() => null);
    expect(() => {
      d.onEvents([ev(Ev.Kill, 'ballistics'), ev(Ev.Checkpoint, 'run')], digest([[nextId++, -1, 0]]));
      d.onUi(ui());
      d.onUiTap('tab');
      d.setScreen('more'); d.setPaused(true); d.setSimSpeed(4); d.resync(); d.dispose();
    }).not.toThrow();
  });
});

describe('audio director: synthetic load', () => {
  it('500 events/s for 10 s (plus 2,000 hit links/s): the voice cap holds and main-thread cost stays under 1 ms p95 per frame', () => {
    const o = new FakeOut();
    const d = new AudioDirector(() => o);
    d.onUi(ui({ wave: 60, alive: 1200 }));
    const types: [Ev, string, number][] = [[Ev.Kill, 'ballistics', 0], [Ev.StatusApply, 'fire', 0], [Ev.StatusApply, 'frost', 3], [Ev.Explosion, 'ordnance', 0],
      [Ev.Fusion, 'fusion.plasma', 0], [Ev.Linkage, 'link.blade+laser', 0], [Ev.Kill, 'lightning', StateBit.Elite], [Ev.Infusion, 'infuse.laser.frost', 0], [Ev.TowerHit, 'grunt', 0]];
    let rngState = 12345;
    const rand = (): number => ((rngState = (Math.imul(rngState, 1103515245) + 12345) >>> 0) / 4294967296);
    const frameMs: number[] = [];
    let prevIds: number[] = [];
    // warm-up frames (JIT) are measured too but a handful do not move the p95
    for (let f = 0; f < 600; f++) {
      o.t = f / 60;
      const events: SimEvent[] = [];
      const links: number[][] = [];
      const hits: SimEvent[] = [];
      const nEv = 8 + (f % 3 === 0 ? 1 : 0);          // ≈ 500 / s
      for (let k = 0; k < 34; k++) {                     // ≈ 2,000 hit links / s
        const id = nextId++;
        const cause = prevIds.length && rand() < 0.6 ? prevIds[Math.floor(rand() * prevIds.length)] : -1;
        links.push([id, cause, rand() < 0.3 ? 1 : 0]);
        if (k % 4 === 0) hits.push({ id, tick: f, type: Ev.Hit, cause, src: rand() < 0.5 ? 'ballistics' : 'lightning', a: 0, b: 1, x: rand() * 800 - 400, y: 0, c: rand() < 0.1 ? StateBit.Crit : 0 });
      }
      for (let k = 0; k < nEv; k++) {
        const [type, src, c] = types[Math.floor(rand() * types.length)];
        const cause = links.length && rand() < 0.7 ? links[Math.floor(rand() * links.length)][0] : -1;
        const id = nextId++;
        events.push({ id, tick: f, type, cause, src, a: 30, b: 1, x: rand() * 800 - 400, y: 0, c });
      }
      // ids must ascend within a batch: links were allocated first, events after
      prevIds = events.map((e) => e.id);
      const t0 = performance.now();
      d.onEvents(events, digest(links, hits, [3, 10, 1, 0, 2, -30, 0, 0]));
      frameMs.push(performance.now() - t0);
    }
    frameMs.sort((a, b) => a - b);
    const p95 = frameMs[Math.floor(frameMs.length * 0.95)];
    expect(o.peak).toBeLessThanOrEqual(VOICE_CAP);
    expect(o.admission.voices.peak).toBeLessThanOrEqual(VOICE_CAP);
    expect(p95).toBeLessThan(1);
    // sounds were thinned (a small fraction of events), and chain notes stayed within budget
    expect(o.sfxLog.length).toBeLessThan(600 * 9 * 0.5);
    expect(o.notes.length).toBeLessThanOrEqual(7 * 10 + 5);
    console.log(`[audio load] p95 ${p95.toFixed(3)} ms/frame, max ${frameMs[frameMs.length - 1].toFixed(3)} ms; sfx ${o.sfxLog.length}, notes ${o.notes.length}, peak voices ${o.peak}, dropped ${o.admission.voices.dropped}, stolen ${o.admission.voices.stolen}`);
  });
});
