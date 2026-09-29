/** What the UI needs from the app shell (main.ts implements it). The UI never touches the worker directly. */
import type { Command, SimEvent } from '@sim/core/types';

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
  canInstall(): boolean;
  install(): Promise<boolean>;
  /** Save to IndexedDB now (after major actions such as Prestige). */
  saveNow(): void;
}
