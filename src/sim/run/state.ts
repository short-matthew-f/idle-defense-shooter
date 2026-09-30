/** Fresh game / run / tower state constructors. */
import type { BuildState, MetaState, RunState, TowerState } from '../core/types';
import { NO_ENTITY } from '../core/types';
import type { AbilityId, FrameId } from '../core/ids';

export const WAVE_TABLE_SIZE = 256;

export function newMeta(): MetaState {
  return {
    echoes: 0, stars: 0, prestigeCount: 0, ascension: 0, deepestEver: 0, totalPlaySeconds: 0,
    prestigeRanks: {}, constellation: {}, unlockedFrames: ['standard'], codex: {}, trials: {},
    blueprints: [], directives: [], upgradeQueue: [], keepsake: null,
    records: { deepestWave: 0, longestChain: 0, fastestWave100Seconds: null },
    settings: { clarity: 0.5, autoPrestige: false, quartermaster: { on: false, reserve: 25, trees: {}, order: [] } },   // Quartermaster: off until switched on (directives/quartermaster.ts)
  };
}

/**
 * Tactical slots a new build starts with (UX review S9): both cheap, and Repulsor Pulse is the Counter
 * for the wave-5 boss (The Breaker), so the first boss tell names an ability the player already has.
 * Saves keep whatever they stored (save/serialize.ts only falls back to this for a missing array).
 */
export const DEFAULT_ABILITIES: readonly AbilityId[] = ['repulsor_pulse', 'hunter_mark'];

export function newBuild(frame: FrameId = 'standard'): BuildState {
  return {
    frame, hardpoints: [], attunements: [], doctrines: {}, secondDoctrines: {}, ranks: {},
    anomalies: [], anomalySockets: 3, targeting: {}, abilities: [...DEFAULT_ABILITIES], boons: [],
  };
}

export function newRun(prestigeSeed: number): RunState {
  return {
    prestigeSeed: prestigeSeed >>> 0, wave: 1, checkpoint: 0, deepestCleared: 0, clearedWaves: 0,
    firstClears: new Uint8Array(WAVE_TABLE_SIZE), mode: 'push', phase: 'between', phaseTicks: 0,
    tick: 0, attemptTick: 0, waveTick: 0, scrap: 0, cores: 0, coresDroppedByBoss: new Uint8Array(WAVE_TABLE_SIZE),
    threatDial: 0, attempts: 0, attemptsPerCheckpoint: [], prestigeStartedAt: 0, playSeconds: 0, echoRateHistory: [],
    pendingDraft: null, draftWave: 0, draftQueue: [], anomaliesOfferedAt: new Uint8Array(32), hardpointSlotsOpen: 0, attunementSlotsOpen: 0,
    speedMultiplier: 1, patrolScrapPerSecond: 0, longestChain: 0, spentByTree: {}, attemptDamageTaken: {},
    boonOffer: null, boonOfferWave: 0, boonOfferKind: 'start', boonOfferSeq: 0, boonRerolls: 0, boonQueue: [], boonsSeenFirst: false, boonSpent: [],
  };
}

export function newTower(): TowerState {
  return {
    hp: 100, maxHp: 100, shield: 0, maxShield: 0, barrier: 0, maxBarrier: 0, tempHp: 0, invulnT: 0, secondCoreUsed: false,
    ce: 0, ceCap: 100, aimAngle: 0, manualAim: false, manualAngle: 0,
    designated: NO_ENTITY, designatedGen: 0, designated2: NO_ENTITY, designated2Gen: 0, lowHpTicks: 0,
  };
}
