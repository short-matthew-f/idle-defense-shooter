/**
 * WP10 simulator harness: shared config / result types.
 *
 * Everything here is plain JSON so results can cross process boundaries (sim-cli/pool.ts) and be
 * written to sim-out/*.json unchanged.
 */
import type { AnomalyId, BoonId, DoctrineId, ElementId, FrameId, HardpointId, TreeId } from '../src/sim/core/ids';
import type { MetaState } from '../src/sim/core/types';

export type PolicyId = 'idle' | 'directive' | 'active';

export type AgentId =
  | 'greedy' | 'survival' | 'elemental' | 'generalist' | 'random'
  | 'hp_ordnance' | 'hp_drones' | 'hp_blade' | 'hp_laser' | 'hp_gravitics'
  | 'optimizer' | 'optimizer_lite' | 'pure_ballistics'
  /** Doctrine probe: `doctrine:<tree>.<doctrine>` (see agents/index.ts). */
  | `doctrine:${string}`;

export interface RunConfig {
  /** Output name (sim-out/<name>.json). Defaults to `${agent}-${policy}-s${seed}`. */
  name?: string;
  seed: number;
  frame?: FrameId;
  agent: AgentId;
  policy: PolicyId;
  /** Hard cap on simulated seconds (default 4 h). */
  maxSimSeconds?: number;
  /** Stop once this wave has been cleared. */
  stopAtWave?: number;
  /** Threat Dial level at Prestige start (0–10). */
  threatDial?: number;
  /** Meta state to start from (Prestige upgrades, Echoes, unlocked frames). */
  prestigeMeta?: MetaState;
  /** Wall detection: stop when no new checkpoint for this many sim-minutes (default 40). */
  wallMinutes?: number;
  /** Stop when the Prestige recommendation fires (Forecast, or the computed Echo-rate rule). */
  stopAtRecommendation?: boolean;
  /** Force this Anomaly at the first draft, or 'skip' it (Anomaly cap test). */
  forceAnomaly?: AnomalyId | 'skip';
  /**
   * Boons (Boon cap test): inject this boon into every offer and pick it; once it is active, pick the first card
   * instead (never replacing it). Without it the agent picks by its heuristic (agents/base.ts boonScore).
   */
  forceBoon?: BoonId;
  /**
   * With forceBoon: what to do with an offer while the forced boon is already active. 'first' (default, the
   * --force-boon CLI rule) takes the first card; 'none' declines, so the forced boon is the only one active
   * (the Boon cap acceptance row: it measures that boon alone, see sim-cli/acceptance.ts).
   */
  boonCompanions?: 'first' | 'none';
  /** Boons: decline every offer (the Boon cap baseline). */
  noBoons?: boolean;
  /** Doctrine overrides (doctrine health probes). */
  doctrineOverrides?: Partial<Record<TreeId, DoctrineId>>;
  /** Run mode (Patrol for the offline test). */
  mode?: 'push' | 'patrol';
  /** Record per-wave event hashes (default true). */
  hashes?: boolean;
}

export interface WaveRecord {
  wave: number;
  boss: boolean;
  /** Times combat started on this wave before (and including) the first clear. */
  attemptsToClear: number;
  /** Total times combat started on this wave. */
  fights: number;
  deaths: number;
  /** Sim-seconds from first reaching the wave to its first clear. */
  secondsToClear: number | null;
  /** Sim-seconds of the clearing fight. */
  clearFightSeconds: number | null;
  firstReachAt: number;
  firstClearAt: number | null;
  scrapEarned: number;
  scrapSpent: number;
  towerDamage: number;
  damageBySrc: Record<string, number>;
  hash: number | null;
  formation: string | null;
}

export interface CheckpointRecord {
  checkpoint: number;
  /** Attempts started from the previous checkpoint until this one was set. */
  attempts: number;
  /** Times the boss wave itself was fought until cleared (1 = first try). */
  bossFights: number;
  minutes: number;
  at: number;
}

export interface EchoSample { seconds: number; deepest: number; echoes: number; rate: number; forecastRate?: number; recommended?: boolean }

export interface RunResult {
  name: string;
  config: Omit<RunConfig, 'prestigeMeta'> & { prestigeMeta?: string };
  agent: string;
  policy: PolicyId;
  seed: number;
  frame: string;
  deepestCleared: number;
  checkpoint: number;
  attempts: number;
  simSeconds: number;
  /** Player seconds (ticks ÷ 60 ÷ speed multiplier). */
  playSeconds: number;
  wallSeconds: number;
  ticks: number;
  ticksPerSecond: number;
  stopReason: 'max_time' | 'wall' | 'stop_wave' | 'recommended' | 'patrol_done';
  walled: boolean;
  /** Deepest cleared when the wall was detected. */
  wallWave: number | null;
  waves: WaveRecord[];
  checkpoints: CheckpointRecord[];
  spendByTree: Record<string, number>;
  damageBySrc: Record<string, number>;
  towerDamage: number;
  scrapEarned: number;
  echoCurve: EchoSample[];
  /** First Forecast `recommended` (from UiState.forecast) or null when the Forecast is absent. */
  forecastRecommended: { wave: number; seconds: number } | null;
  /** Computed Echo-rate recommendation (15% below peak for a full checkpoint cycle). */
  computedRecommended: { wave: number; seconds: number } | null;
  /** True peak of echoes/hour over the run. */
  echoPeak: { wave: number; seconds: number; rate: number } | null;
  forecastPresent: boolean;
  build: { hardpoints: (HardpointId | null)[]; attunements: (ElementId | null)[]; doctrines: Partial<Record<TreeId, DoctrineId>>; anomalies: AnomalyId[]; purchases: number };
  anomaliesPicked: string[];
  /** Boons picked over the climb (Ev.BoonPicked srcs, declines excluded). */
  boonsPicked?: string[];
  casts: number;
  tells: number;
  counters: number;
  designations: number;
  /** Commands the policy sent that returned an error or had no observable effect. */
  noops: Record<string, number>;
  finalHash: number;
  notes: string[];
}

export interface PrestigeChainResult {
  name: string;
  implemented: boolean;
  runs: RunResult[];
  notes: string[];
}

export interface OfflineResult {
  patrolSeconds: number;
  bossWavesFought: number;
  checkpointsSet: number;
  onlineScrapPerHour: number;
  measuredPatrolRatePerSecond: number;
  offlineScrapPerHour: number;
  ratio: number;
  notes: string[];
}

export interface AcceptRow {
  name: string;
  pass: boolean;
  skipped?: string;
  value: string;
  target: string;
  notes: string;
}
