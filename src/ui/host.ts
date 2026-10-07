/** What the UI needs from the app shell (main.ts implements it). The UI never touches the worker directly. */
import type { Command, SaveState, SimEvent } from '@sim/core/types';
import type { ProbeSample } from '@app/input';
import type { TouchCal } from '@app/touch-cal';

/** A marker the canvas draws for the touch test (world units; see FieldOverlay). */
export interface TouchMarker { x: number; y: number; kind: 'tap' | 'target' | 'target-dim' }

/** What the canvas mapping looks like right now (touch test readout). */
export interface TouchView {
  rect: { left: number; top: number; width: number; height: number };
  viewW: number; viewH: number; centerPx: number; centerPy: number;
  scale: number; punch: number; shakeX: number; shakeY: number; zoom: number;
  dpr: number; bufferW: number; bufferH: number; staleCount: number; lastStale: string;
}

/** The touch test / tap calibration (More → Help → Touch test; docs/TOUCH.md). */
export interface TouchHost {
  /** Route every canvas pointer to `onSample` (the field ignores them) and keep drawing the canvas. */
  begin(onSample: (s: ProbeSample) => void): void;
  end(): void;
  setMarkers(m: readonly TouchMarker[]): void;
  /** World → client CSS px where the canvas draws it now. */
  toClient(wx: number, wy: number): { x: number; y: number };
  /** Client CSS px → world as drawn now (no calibration). */
  fromClient(cx: number, cy: number): { x: number; y: number };
  view(): TouchView;
  calibration(): TouchCal | null;
  /** Apply (and the UI stores) a calibration; null = identity. */
  setCalibration(c: TouchCal | null): void;
}

/**
 * Where the arena is drawn now, in client CSS px (the camera's fit and pan; no shake or punch): its centre, its radius,
 * and the tower's hold radius (a touch there charges Overcharge; app/active-tap.ts holdOnTower). The overlay lanes keep
 * every transient overlay off the tower (lanes.ts).
 */
export interface ArenaGeom { cx: number; cy: number; r: number; hold: number }

export interface UiHost {
  send(cmd: Command): void;
  inspect(enemyIndex: number, gen: number): Promise<{ chain: SimEvent[]; sentence: string }>;
  setPaused(paused: boolean): void;
  isPaused(): boolean;
  setClarity(v: number): void;
  setBloom(on: boolean): void;
  bloomOn(): boolean;
  exportSave(): Promise<string>;
  /** Parse and migrate a save string without storing anything (the import preview); throws a readable error for a bad string. */
  parseSave(text: string): SaveState;
  importSave(text: string): Promise<void>;
  hardReset(): Promise<void>;
  /** Screen space the UI covers (px), so the camera keeps the arena clear. */
  setInsets(top: number, right: number, bottom: number, left: number, vBias?: number): void;
  /** Stop / resume drawing the arena while a full-screen tab covers it (the sim keeps running). */
  setRenderPaused(paused: boolean): void;
  canInstall(): boolean;
  install(): Promise<boolean>;
  /** Save to IndexedDB now (after major actions such as Prestige). */
  saveNow(): void;
  /**
   * UX Phase 4: start the first-Prestige rebuild beat on the canvas (call just before sending the Prestige; the old tower
   * is copied from the current snapshot). Returns its length in ms (shorter under reduced motion). Optional (tests).
   */
  rebuildBeat?(): number;
  /** Cut the rebuild beat short (a tap skips it). */
  endRebuildBeat?(): void;
  /** UX Phase 1: a new version is waiting ("Update ready · Restart" chip; window event 'citadel:update-ready' fires once). Optional. */
  updateReady?(): boolean;
  /** UX Phase 1: the Restart tap: save, activate the waiting version, reload. Optional. */
  applyUpdate?(): void;
  /** Touch test and tap calibration. */
  touch: TouchHost;
  /** The arena on screen (null before the first frame). Optional: hosts without an arena (tests) leave it out. */
  arena?(): ArenaGeom | null;
}
