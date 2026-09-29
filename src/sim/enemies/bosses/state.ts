/**
 * Boss controller state (WP5). One BossCtrl per live boss, pooled per World (WeakMap keyed by the
 * World, so two Sims never share state). Controllers are reused objects: no per-tick allocation.
 */
import type { World } from '../../core/world';
import type { AbilityId, BossId } from '../../core/ids';
import type { BossDef } from '../../data/schema';
import { NO_ENTITY } from '../../core/types';

export type Counter = AbilityId | 'designate';

export const MOVE_NONE = 0, MOVE_DASH = 1, MOVE_HOLD = 2, MOVE_RETREAT = 3;
export const MAX_BOSSES = 4;
export const MAX_PHASE_ATTACKS = 8;

export interface BossCtrl {
  active: boolean;
  index: number; gen: number;
  id: BossId; def: BossDef;
  /** 'boss.<id>' — srcTag for everything the boss does. */
  src: string;
  phase: number;
  /** Per-attack cooldown (ticks) for the current phase's non-tell attacks, by position in phases[phase].attacks. */
  cd: Float64Array;
  // --- tell → counter ------------------------------------------------------
  tellT: number;              // ticks until the next tell starts
  tellActive: boolean;
  tellTicks: number;          // ticks left in the window
  tellId: string;             // tell attack id (slam, brood_sac, ...)
  tellCounter: Counter;
  tellEv: number;             // Ev.BossTell id (cause of the attack / Counter)
  tellSeq: number; renderedTellSeq: number;
  counterSeq: number; renderedCounterSeq: number;
  /** Tell focus: a point (seg=false) or a segment (x,y)→(x2,y2) with reach r, for point-cast Counters. */
  fx: number; fy: number; fx2: number; fy2: number; fr: number; seg: boolean;
  /** Designate Counters: the pool index / gen expected (harmony_sync uses `order`). */
  wantIndex: number; wantGen: number;
  order: Uint32Array; orderN: number; orderPos: number;
  // --- state ---------------------------------------------------------------
  weakT: number; invulnT: number; staggerCd: number; stunT: number;
  revealT: number; linkCutT: number; tetherT: number; inhaleT: number; bendT: number; dragT: number; accelT: number;
  resisted: number;           // Null Engine: resisted element 0..4 (0 = physical/none element, 1..4 = fire..frost), -1 none
  nextResist: number;
  hpMark: number;             // hp at the last rewind mark
  // movement override
  move: number; mx: number; my: number; mSpeed: number; mDmg: number; mPass: number; mCause: number; moveT: number;
  holdR: number;              // > 0: hold at this radius instead of the default boss hold
  // Deep Graft
  graftA: BossId; graftB: BossId; graftTellK: number; graftKA: number; graftKB: number;
  /** Rotating counters for attacks that cycle (crown_synthesis, grafts). */
  cycle: number;
  lastPhaseEv: number;
}

export interface BossState {
  ctrls: BossCtrl[];
  /** Last elite deaths (Grave Battery revives): ring of positions. */
  graveX: Float64Array; graveY: Float64Array; graveN: number;
  /** Any enemy barrier walls alive (Architect) — gates the projectile blocking pass. */
  walls: number;
}

function newCtrl(): BossCtrl {
  return {
    active: false, index: NO_ENTITY, gen: 0, id: 'breaker', def: null as unknown as BossDef, src: 'boss', phase: 0,
    cd: new Float64Array(MAX_PHASE_ATTACKS),
    tellT: 0, tellActive: false, tellTicks: 0, tellId: '', tellCounter: 'repulsor_pulse', tellEv: -1, tellSeq: 0, renderedTellSeq: 0,
    counterSeq: 0, renderedCounterSeq: 0,
    fx: 0, fy: 0, fx2: 0, fy2: 0, fr: 0, seg: false, wantIndex: NO_ENTITY, wantGen: 0,
    order: new Uint32Array(4), orderN: 0, orderPos: 0,
    weakT: 0, invulnT: 0, staggerCd: 0, stunT: 0, revealT: 0, linkCutT: 0, tetherT: 0, inhaleT: 0, bendT: 0, dragT: 0, accelT: 0,
    resisted: -1, nextResist: 0, hpMark: 0,
    move: MOVE_NONE, mx: 0, my: 0, mSpeed: 0, mDmg: 0, mPass: 0, mCause: -1, moveT: 0, holdR: 0,
    graftA: 'breaker', graftB: 'broodheart', graftTellK: 0, graftKA: 0, graftKB: 0, cycle: 0, lastPhaseEv: -1,
  };
}

const STATES = new WeakMap<World, BossState>();

export function bossState(w: World): BossState {
  let s = STATES.get(w);
  if (!s) {
    const ctrls: BossCtrl[] = [];
    for (let k = 0; k < MAX_BOSSES; k++) ctrls.push(newCtrl());
    s = { ctrls, graveX: new Float64Array(8), graveY: new Float64Array(8), graveN: 0, walls: 0 };
    STATES.set(w, s);
  }
  return s;
}

/** Controller of the boss at pool index i (or null). */
export function ctrlAt(s: BossState, i: number): BossCtrl | null {
  const cs = s.ctrls;
  for (let k = 0; k < cs.length; k++) { const c = cs[k]; if (c.active && c.index === i) return c; }
  return null;
}

export function resetBossState(s: BossState): void {
  for (const c of s.ctrls) { c.active = false; c.tellActive = false; c.index = NO_ENTITY; }
  s.graveN = 0; s.walls = 0;
}

const SRC = new Map<string, string>();
/** Interned 'boss.<id>' tag (no per-call string building). */
export function bossSrc(id: string): string {
  let t = SRC.get(id);
  if (t === undefined) { t = `boss.${id}`; SRC.set(id, t); }
  return t;
}
