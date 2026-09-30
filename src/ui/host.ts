/** What the UI needs from the app shell (main.ts implements it). The UI never touches the worker directly. */
import type { Command, SimEvent } from '@sim/core/types';
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

export interface UiHost {
  send(cmd: Command): void;
  inspect(enemyIndex: number, gen: number): Promise<{ chain: SimEvent[]; sentence: string }>;
  setPaused(paused: boolean): void;
  isPaused(): boolean;
  setClarity(v: number): void;
  setBloom(on: boolean): void;
  bloomOn(): boolean;
  exportSave(): Promise<string>;
  importSave(text: string): Promise<void>;
  hardReset(): Promise<void>;
  /** Screen space the UI covers (px), so the camera keeps the arena clear. */
  setInsets(top: number, right: number, bottom: number, left: number): void;
  /** Stop / resume drawing the arena while a full-screen tab covers it (the sim keeps running). */
  setRenderPaused(paused: boolean): void;
  canInstall(): boolean;
  install(): Promise<boolean>;
  /** Save to IndexedDB now (after major actions such as Prestige). */
  saveNow(): void;
  /** Touch test and tap calibration. */
  touch: TouchHost;
}
