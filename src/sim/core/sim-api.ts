/**
 * The Sim facade every consumer (worker, headless CLI, tests) uses.
 * Implemented in src/sim/index.ts (class Sim). Nothing outside src/sim may
 * reach into internals; the UI talks in Commands and reads UiState.
 */
import type { Command, EventLog, RenderSnapshot, SaveState, SimEvent, UiState } from './types';

export interface ISim {
  /** Advance exactly one 60 Hz tick. Deterministic given the same save + commands. */
  step(): void;
  /** Queue a command; applied at the start of the next step in arrival order. */
  command(cmd: Command): void;
  /** Build the render instance stream for the current tick (allocation-free after warmup). */
  snapshot(): RenderSnapshot;
  /** Plain JSON view for the UI (allocates; call ≤ 10 Hz). */
  uiState(): UiState;
  /** Serialize to a save; live combat is not saved, the run resumes at its checkpoint. */
  save(): SaveState;
  /** Kill-chain for an enemy death or the most recent death near (x,y). */
  inspect(eventId: number): { chain: SimEvent[]; sentence: string };
  readonly events: EventLog;
  readonly tick: number;
}
