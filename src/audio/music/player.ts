/**
 * Adaptive music player: a LookaheadScheduler on the audio clock asks the Composer for each
 * sixteenth-note step and plays the notes with the Sector's instruments. The director sets a target
 * (Sector, intensity, tension, boss); the player eases toward it step by step (smoothToward), so
 * layers enter and leave gradually.
 */
import { layersFor, smoothToward } from '../intensity';
import { LookaheadScheduler } from '../scheduler';
import type { Key } from '../theory';
import { Composer, type NoteEv } from './composer';
import { playMusicNote, type InstrumentCtx } from './instruments';
import { sectorMusic, type SectorMusic } from './sectors';

export interface MusicTarget {
  sector: number;
  intensity: number;
  tension: number;
  /** Boss phase (0-based) on a boss wave, -1 otherwise. */
  bossPhase: number;
}

export const LOOKAHEAD = 0.3;

export class MusicPlayer {
  readonly composer: Composer;
  private readonly sched: LookaheadScheduler;
  private readonly ic: InstrumentCtx;
  private target: MusicTarget = { sector: 0, intensity: 0.1, tension: 0, bossPhase: -1 };
  intensity = 0.1;
  tension = 0;
  private started = false;
  private evs: NoteEv[] = [];
  /** Called when the Sector's reverb/delay sends should change (engine wiring). */
  onSector: ((s: SectorMusic, bpm: number) => void) | null = null;
  /** Notes scheduled so far (tests / harness). */
  notes = 0;

  constructor(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, seed: number, rand: () => number) {
    const s = sectorMusic(0);
    this.composer = new Composer(s, seed);
    this.ic = { ctx, dest, noise, sector: s, intensity: this.intensity, tension: 0, rand };
    this.sched = new LookaheadScheduler({ lookahead: LOOKAHEAD, maxLate: 0.2 }, (step, time) => this.onStep(step, time));
  }

  get key(): Key { return this.composer.key; }
  get bpm(): number { return this.composer.bpm; }
  get beatSeconds(): number { return 60 / this.composer.bpm; }

  setTarget(t: MusicTarget): void {
    if (t.sector !== this.target.sector) {
      const s = sectorMusic(t.sector);
      this.composer.setSector(s);
    }
    this.target = { ...t };
    this.composer.setBossPhase(t.bossPhase);
  }

  /** Jump straight to the target (offline renders, tests). */
  settle(): void { this.intensity = this.target.intensity; this.tension = this.target.tension; }

  /** New wave: reseed the composer (reproducible from prestige seed and wave). */
  reseed(seed: number): void { this.composer.reseed(seed); }

  /** The next grid point (a sixteenth divided by `div`) at or after t, on the scheduler's own grid. */
  gridAfter(t: number, div = 1): number {
    if (!this.started) return t;
    const sd = 60 / this.composer.bpm / 4 / Math.max(1, div);
    const n = this.sched.nextTime;
    return n - Math.floor((n - t) / sd) * sd;
  }

  /** Schedule everything due before now + lookahead. */
  pump(now: number): number {
    if (!this.started) { this.sched.start(now + 0.05); this.started = true; }
    return this.sched.advance(now);
  }

  private onStep(step: number, time: number): number {
    const sd = 60 / this.composer.bpm / 4;
    this.intensity = smoothToward(this.intensity, this.target.intensity, sd);
    this.tension = smoothToward(this.tension, this.target.tension, sd);
    const boss = this.target.bossPhase >= 0;
    const layers = layersFor(this.intensity, boss, this.tension);
    const before = this.composer.sector;
    this.evs.length = 0;
    const dur = this.composer.step(step, { layers, intensity: this.intensity, bossPhase: this.target.bossPhase }, this.evs);
    const s = this.composer.sector;
    if (s !== this.ic.sector || before !== s) { this.ic.sector = s; this.onSector?.(s, this.composer.bpm); }
    this.ic.intensity = this.intensity;
    this.ic.tension = this.tension;
    for (const ev of this.evs) { playMusicNote(this.ic, ev, time + Math.max(0, ev.t)); this.notes++; }
    return dur;
  }
}
