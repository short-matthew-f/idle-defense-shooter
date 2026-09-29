/**
 * Game audio runtime (DOM side): creates the AudioContext lazily on the first user gesture, keeps the
 * iOS audio session in "playback" (a looping, silent <audio> element, plus navigator.audioSession
 * where it exists) so the silent switch does not mute the game, suspends while hidden or muted,
 * wakes the music scheduler with a coarse timer (timing itself uses the audio clock), persists
 * levels in prefs, and owns the AudioDirector that game.ts feeds.
 *
 * Without Web Audio (or before the first tap) every call is a silent no-op.
 */
import { prefs, setPref } from '@ui/prefs';
import { AudioDirector, type UiTapKind } from './director';
import { AudioEngine, DEFAULT_LEVELS, type Levels, type SoundOut } from './engine';
import { silentWav } from './wav';

export type { UiTapKind } from './director';
export type { Levels } from './engine';

const PUMP_MS = 50;

export interface GameAudio {
  readonly director: AudioDirector;
  /** Web Audio exists in this browser. */
  readonly available: boolean;
  /** The context was created and is running. */
  readonly running: boolean;
  levels(): Levels;
  /** Change and persist levels. */
  setLevels(l: Partial<Levels>): void;
  toggleMute(): boolean;
  /** Settings → Test sound (also unlocks audio: call it from the click). */
  test(): void;
  /** Subscribe to level changes (settings sliders, the mute chip). */
  onChange(fn: () => void): () => void;
  /** Diagnostics (playtests, e2e): context state, voices started / active, chain and music notes. */
  stats(): { state: string; plays: number; voices: number; chainNotes: number; musicNotes: number };
  dispose(): void;
}

let current: GameAudio | null = null;
/** The running game's audio (null before startGame, and in tests). */
export function gameAudio(): GameAudio | null { return current; }

export function loadLevels(): Levels {
  const p = prefs();
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  return {
    master: num(p.soundMaster, DEFAULT_LEVELS.master),
    sfx: num(p.soundSfx, DEFAULT_LEVELS.sfx),
    music: num(p.soundMusic, DEFAULT_LEVELS.music),
    muted: p.soundMuted === true,
    musicOn: p.musicOn !== false,
  };
}

function saveLevels(l: Levels): void {
  setPref('soundMaster', l.master); setPref('soundSfx', l.sfx); setPref('soundMusic', l.music);
  setPref('soundMuted', l.muted); setPref('musicOn', l.musicOn);
}

type Ctor = typeof AudioContext;
function contextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createGameAudio(): GameAudio {
  const Ctx = contextCtor();
  let levels = loadLevels();
  let ctx: AudioContext | null = null;
  let engine: AudioEngine | null = null;
  let silent: HTMLAudioElement | null = null;
  let pumpTimer = 0;
  let disposed = false;
  const listeners = new Set<() => void>();

  const live = (): boolean => !!ctx && ctx.state === 'running' && !document.hidden && !levels.muted;
  const out = (): SoundOut | null => (engine && live() ? engine : null);
  const director = new AudioDirector(out);

  function startPump(): void {
    if (pumpTimer || disposed) return;
    pumpTimer = window.setInterval(() => { if (engine && live()) { try { engine.pump(); } catch (e) { console.warn('[audio]', e); } } }, PUMP_MS);
  }
  function stopPump(): void { if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = 0; } }

  function playSilent(): void {
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch { /* not supported */ }
    try {
      if (!silent) {
        silent = document.createElement('audio');
        silent.src = URL.createObjectURL(new Blob([silentWav() as BlobPart], { type: 'audio/wav' }));
        silent.loop = true;
        silent.preload = 'auto';
        silent.setAttribute('playsinline', '');
        silent.setAttribute('x-webkit-airplay', 'deny');
        (silent as HTMLAudioElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
        silent.volume = 1;
      }
      const p = silent.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* blocked until a gesture; retried on the next one */ });
    } catch { /* ignore */ }
  }
  function pauseSilent(): void { try { silent?.pause(); } catch { /* ignore */ } }

  function resume(): void {
    if (!ctx || disposed) return;
    if (levels.muted || document.hidden) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); return; }
    playSilent();
    if (ctx.state !== 'running') ctx.resume().catch(() => { /* needs a gesture */ });
    startPump();
  }

  /** First gesture: create the context (and re-resume on later gestures if iOS interrupted it). */
  function unlock(): void {
    if (disposed || !Ctx) return;
    if (!ctx) {
      try {
        try { ctx = new Ctx({ latencyHint: 'balanced' }); } catch { ctx = new Ctx(); }
        engine = new AudioEngine(ctx, { levels, seed: 1 });
        ctx.addEventListener('statechange', () => { if (ctx?.state === 'running') director.resync(); });
      } catch (e) {
        console.warn('[audio] unavailable:', e);
        ctx = null; engine = null;
        return;
      }
    }
    resume();
  }

  const gestures = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
  // every gesture re-checks: the context may have been interrupted (iOS), or the session loop blocked the first time
  const onGesture = (): void => {
    if (levels.muted || document.hidden) return;
    if (!ctx || ctx.state !== 'running') unlock();
    else if (silent?.paused) playSilent();
  };
  for (const g of gestures) window.addEventListener(g, onGesture, { capture: true, passive: true });

  const onVisibility = (): void => {
    if (!ctx) return;
    if (document.hidden) { stopPump(); pauseSilent(); ctx.suspend().catch(() => {}); }
    else resume();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // light UI taps, delegated (no UI module needs to know about sound)
  const onClick = (e: Event): void => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    let kind: UiTapKind | null = null;
    if (t.closest('.tab-btn')) kind = 'tab';
    else if (t.closest('.switch')) kind = 'toggle';
    else if (t.closest('.menu-item')) kind = 'sheet';
    else if (t.closest('.btn.ctl, .chip')) kind = 'tap';
    if (kind) director.onUiTap(kind);
  };
  document.addEventListener('click', onClick, true);

  const emit = (): void => { for (const f of listeners) f(); };

  const api: GameAudio = {
    director,
    available: !!Ctx,
    get running() { return !!ctx && ctx.state === 'running'; },
    levels: () => ({ ...levels }),
    setLevels(l) {
      const wasMuted = levels.muted;
      levels = { ...levels, ...l };
      saveLevels(levels);
      engine?.setLevels(levels);
      if (ctx) {
        if (levels.muted && !wasMuted) { stopPump(); pauseSilent(); ctx.suspend().catch(() => {}); }
        else if (!levels.muted && wasMuted) unlock();
      }
      emit();
    },
    toggleMute() { api.setLevels({ muted: !levels.muted }); return levels.muted; },
    test() {
      unlock();
      // the context may still be starting: play once it runs
      const go = (): void => director.onUiTap('test');
      if (ctx && ctx.state === 'running') go(); else window.setTimeout(go, 120);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    stats: () => ({
      state: ctx ? ctx.state : Ctx ? 'locked' : 'unavailable', plays: engine?.plays ?? 0, voices: engine?.activeVoices() ?? 0,
      chainNotes: director.notesPlayed, musicNotes: engine?.music.notes ?? 0,
    }),
    dispose() {
      disposed = true;
      stopPump();
      director.dispose();
      for (const g of gestures) window.removeEventListener(g, onGesture, true);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('click', onClick, true);
      pauseSilent();
      engine?.dispose();
      ctx?.close().catch(() => {});
      if (current === api) current = null;
    },
  };
  current = api;
  return api;
}
