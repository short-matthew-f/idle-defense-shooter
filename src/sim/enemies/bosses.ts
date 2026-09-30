/**
 * Boss system (WP5): a System registered first in SYSTEM_ORDER that
 *  - runs a BossController per live boss (bosses/controller.ts): phases, tells, attacks, weak points
 *  - scores Counters (design §10): `designate` commands through onCommand (returns false so others still see them);
 *    casts through `notifyAbilityCast`, which systems/abilities.ts calls after a cast goes off (so a rejected cast —
 *    unslotted, on cooldown, Blackout, too little CE — never scores)
 *  - installs World.damageModifier (weak points, phase invulnerability, Null Engine resistance,
 *    Veteran resistance) and writes World.bossTell for the UI / Directives
 *  - hosts the enemy reaction hooks (splitter/volatile/splitting deaths, vampiric, phasing) and
 *    renders boss tells, weak points and enemy links.
 *
 * COUNTER CONTRACT (for WP9 abilities / directives):
 *   A Counter scores when, while a tell window is open (World.bossTell.ability !== null):
 *    - cast of the tell's ability:  self-targeted abilities (Repulsor Pulse, EMP) always reach;
 *      point abilities need their point within ability.radius + focus reach of the tell focus
 *      (the boss, its gate, a lane or a wall segment); Hunter Mark needs `target` = the true boss
 *      (Mirror Hive) or a point on its body. Only casts that go off count (the abilities system calls in).
 *    - designate of the expected enemy (maw_open: the boss; resistance_rotate: the node whose
 *      element is the weak one; harmony_sync: every generator in the sung order).
 *   Directive-issued commands (`viaDirective: true`) score at directives.counter_efficiency (50%):
 *   CE refund and weak-point time are scaled. A Counter emits Ev.BossCounter (cause: the tell) and
 *   Ev.CounterScored (src = ability id or 'designate', b = efficiency %), cancels the attack, opens
 *   the weak point (EnemyFlag.WeakPointOpen) for the phase's exposedSeconds (4 s default) and
 *   refunds half the ability's CE cost. `counterHint(world)` describes what would score right now.
 */
import type { System, HitInfo, InstanceWriter } from '../core/system';
import type { World } from '../core/world';
import type { AbilityId, ElementId, StatusId } from '../core/ids';
import type { Command } from '../core/types';
import type { BossCtrl, BossState, Counter } from './bosses/state';
import { EnemyFlag, Ev, FxKind, NO_ENTITY, Shape } from '../core/types';
import { abilityDef } from '../core/content';
import { cos, sin } from '../math/lut';
import { ELEMENT_ORDER } from '../data/index';
import { bossState, ctrlAt, resetBossState } from './bosses/state';
import { blockProjectiles, initCtrl, moveBoss, openWeakPoint, releaseCtrl, updateCtrl } from './bosses/controller';
import { segDist } from './bosses/common';
import { TELLS } from './bosses/registry';
import { ROLE_GEN, K, AI_DASH, AI_WINDUP } from './behaviors/kinds';
import { MOVE_DASH, MOVE_NONE } from './bosses/state';
import { onEnemyKilled, onEnemyStatus, onEnemyTowerHit, renderBehaviors, veteranMul } from './behaviors/support';

export { bossState } from './bosses/state';

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------
function scoreCounter(w: World, c: BossCtrl, ability: Counter, viaDirective: boolean): void {
  const e = w.enemies, b = c.index;
  let eff = 1;
  if (viaDirective) { eff = w.stats.get('directives.counter_efficiency'); eff = eff > 1 ? 1 : eff < 0 ? 0 : eff; }
  const id = w.emit(Ev.BossCounter, c.src, b, c.phase, e.x[b], e.y[b], c.tellEv);
  w.emit(Ev.CounterScored, ability, b, Math.round(eff * 100), e.x[b], e.y[b], id);
  c.tellActive = false; c.counterSeq++;
  if (c.move !== 0) c.move = 0;
  TELLS[c.tellId]?.countered?.(w, b, c, id);
  const wp = c.def.phases[c.phase].weakPoint;
  openWeakPoint(w, b, c, (wp?.exposedSeconds ?? 4) * eff);
  if (ability !== 'designate') {
    const def = abilityDef(ability);
    const mul = w.stats.get(`ability.${ability}.cost_mul`);
    const cost = (def?.cost ?? 0) * (mul > 0 ? mul : 1);
    if (cost > 0) w.gainCE(cost * 0.5 * eff);
  }
}

/**
 * Hook for the abilities system: an ability was cast at (x,y) (target = enemy index for targeted
 * abilities, else -1). Scores a Counter against any open tell it answers. Returns true if it scored.
 */
export function notifyAbilityCast(w: World, ability: AbilityId, x: number, y: number, target = NO_ENTITY, viaDirective = false): boolean {
  const s = bossState(w);
  const def = abilityDef(ability);
  const reach = def?.radius ?? 0;
  const kind = def?.targeted ?? 'point';
  let scored = false;
  for (const c of s.ctrls) {
    if (!c.active || !c.tellActive || c.tellCounter !== ability) continue;
    const e = w.enemies, b = c.index;
    let ok = false;
    if (kind === 'self') ok = true;
    else if (kind === 'enemy') {
      if (target >= 0) ok = target === b;
      else { const dx = x - e.x[b], dy = y - e.y[b], r = e.radius[b] + 12; ok = dx * dx + dy * dy <= r * r; }
    } else if (c.seg) ok = segDist(x, y, c.fx, c.fy, c.fx2, c.fy2) <= reach + c.fr;
    else { const dx = x - c.fx, dy = y - c.fy, r = reach + c.fr; ok = dx * dx + dy * dy <= r * r; }
    if (ok) { scoreCounter(w, c, ability, viaDirective); scored = true; }
  }
  return scored;
}

/** Hook for designations (the command path calls this too). Returns true if a Counter scored. */
export function notifyDesignate(w: World, enemy: number, viaDirective = false): boolean {
  if (!w.alive(enemy)) return false;
  const s = bossState(w), e = w.enemies;
  let scored = false;
  for (const c of s.ctrls) {
    if (!c.active || !c.tellActive || c.tellCounter !== 'designate') continue;
    if (c.tellId === 'harmony_sync' && c.orderN > 0) {
      if (e.gen[enemy] === c.order[c.orderPos]) {
        if (++c.orderPos >= c.orderN) { scoreCounter(w, c, 'designate', viaDirective); scored = true; }
      } else if (e.kind[enemy] === K.bossAdd && e.aiB[enemy] === ROLE_GEN) c.orderPos = 0;   // wrong note: start over
      continue;
    }
    const want = c.wantIndex >= 0 ? c.wantIndex : c.index;
    const wantGen = c.wantIndex >= 0 ? c.wantGen : c.gen;
    if (enemy === want && e.gen[enemy] === wantGen) { scoreCounter(w, c, 'designate', viaDirective); scored = true; }
  }
  return scored;
}

/**
 * What would score a Counter right now (Directives "designate a weak point", tests, UI hints).
 * Allocates: call at UI rate, not per tick.
 */
export function counterHint(w: World): { ability: Counter; bossIndex: number; x: number; y: number; targets: number[] } | null {
  const s = bossState(w), e = w.enemies;
  for (const c of s.ctrls) {
    if (!c.active || !c.tellActive) continue;
    const targets: number[] = [];
    if (c.tellCounter === 'designate') {
      if (c.tellId === 'harmony_sync' && c.orderN > 0) {
        for (let k = c.orderPos; k < c.orderN; k++) for (let j = 0; j < e.count; j++) if (e.gen[j] === c.order[k] && w.alive(j)) targets.push(j);
      } else targets.push(c.wantIndex >= 0 ? w.resolveEnemy(c.wantIndex, c.wantGen) : c.index);
    } else if (c.tellCounter === 'hunter_mark') targets.push(c.index);
    let x = c.fx, y = c.fy;
    if (c.seg) { x = (c.fx + c.fx2) * 0.5; y = (c.fy + c.fy2) * 0.5; }
    return { ability: c.tellCounter, bossIndex: c.index, x, y, targets };
  }
  return null;
}

/** The controller of a live boss (tests, Inspector). */
export function bossCtrlOf(w: World, enemy: number): BossCtrl | null { return ctrlAt(bossState(w), enemy); }

/**
 * Repulsor Pulse ("cancels charges in progress") and Time Field ("dashes and charges that enter it stall"), EFFECT-AUDIT:
 * a Charger winding up or dashing drops it and waits 3 s before the next; a boss mid-dash (charge, ram, lane dash) stops
 * where it is and deals no dash damage. Returns true if a charge was stalled.
 */
export function stallCharge(w: World, i: number): boolean {
  const e = w.enemies;
  if (!w.alive(i)) return false;
  if (e.flags[i] & EnemyFlag.Boss) {
    const c = ctrlAt(bossState(w), i);
    if (c === null || c.move !== MOVE_DASH) return false;
    c.move = MOVE_NONE; c.mDmg = 0; c.mPass = 0;
    e.vx[i] = 0; e.vy[i] = 0;
    return true;
  }
  if (e.kind[i] !== K.charger) return false;
  const st = e.aiI[i];
  if (st < 0 || (st & (AI_WINDUP | AI_DASH)) === 0) return false;
  e.aiI[i] = st & ~(AI_WINDUP | AI_DASH); e.aiA[i] = -180;
  e.vx[i] = 0; e.vy[i] = 0;
  return true;
}

/**
 * EMP on a boss (EFFECT-AUDIT: "interrupts enemy abilities, tethers and shield links for 3 s"): cuts its feeding tether
 * and generator / pulse shield links for `ticks` (the same link cut its own Counters apply).
 */
export function empLinkCut(w: World, i: number, ticks: number): void {
  const c = (w.enemies.flags[i] & EnemyFlag.Boss) ? ctrlAt(bossState(w), i) : null;
  if (c !== null && c.linkCutT < ticks) { c.linkCutT = ticks; c.tetherT = 0; }
}

/** aiStep calls this for bosses: true when the controller moved the boss itself. */
export function bossMovement(w: World, i: number): boolean {
  const c = ctrlAt(bossState(w), i);
  return c !== null && moveBoss(w, c, i);
}

// ---------------------------------------------------------------------------
// Damage modifier
// ---------------------------------------------------------------------------
function resistedMatch(resisted: number, element: ElementId | null): boolean {
  if (resisted === 0) return element === null;
  return element !== null && ELEMENT_ORDER[resisted - 1] === element;
}

function makeModifier(w: World, s: BossState): NonNullable<World['damageModifier']> {
  return (enemy: number, element: ElementId | null): number => {
    const e = w.enemies;
    let m = 1;
    if (e.kind[enemy] === K.veteran) m *= veteranMul(w, enemy);
    if (e.flags[enemy] & EnemyFlag.Boss) {
      const c = ctrlAt(s, enemy);
      if (c !== null) {
        if (c.invulnT > 0) return 0;
        // exposed: the script's own window, or one held open by Kill Order / Held Open (they keep the flag set; EFFECT-AUDIT)
        if (c.weakT > 0 || (e.flags[enemy] & EnemyFlag.WeakPointOpen)) {
          const t = w.tower;
          const des = (t.designated === enemy && t.designatedGen === e.gen[enemy]) || (t.designated2 === enemy && t.designated2Gen === e.gen[enemy]);
          m *= des ? 2 : 1.5;
        }
        if (c.resisted >= 0 && resistedMatch(c.resisted, element)) m *= 0.3;
      }
    }
    return m;
  };
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export class BossSystem implements System {
  readonly id = 'bosses';

  init(w: World): void {
    const s = bossState(w);
    resetBossState(s);
    w.damageModifier = makeModifier(w, s);
    w.bossTell.ability = null; w.bossTell.ticksLeft = 0; w.bossTell.bossIndex = NO_ENTITY;
  }
  rebuild(): void { /* no stat caches */ }
  onAttemptStart(w: World): void { this.reset(w); }
  onWaveStart(w: World): void { this.reset(w); }
  onWaveEnd(w: World): void { this.reset(w); }

  private reset(w: World): void {
    resetBossState(bossState(w));
    w.bossTell.ability = null; w.bossTell.ticksLeft = 0; w.bossTell.bossIndex = NO_ENTITY;
  }

  update(w: World): void {
    const s = bossState(w), e = w.enemies;
    // adopt new bosses
    for (let i = 0; i < e.count; i++) {
      if ((e.flags[i] & (EnemyFlag.Boss | EnemyFlag.Dead)) !== EnemyFlag.Boss || ctrlAt(s, i) !== null) continue;
      for (const c of s.ctrls) if (!c.active) { initCtrl(w, c, i); break; }
    }
    const tell = w.bossTell;
    tell.ability = null; tell.ticksLeft = 0; tell.bossIndex = NO_ENTITY;
    for (const c of s.ctrls) {
      if (!c.active) continue;
      if (!updateCtrl(w, c)) { releaseCtrl(w, c); continue; }
      if (c.tellActive && tell.ability === null) { tell.ability = c.tellCounter; tell.ticksLeft = c.tellTicks; tell.bossIndex = c.index; }
    }
    if (s.walls > 0) blockProjectiles(w, s);   // Architect walls outlive their builder until they expire
  }

  onCommand(w: World, cmd: Command): boolean {
    // casts score from systems/abilities.ts once the cast actually goes off (EFFECT-AUDIT: a cast the abilities system
    // rejects — not slotted, on cooldown, Blackout — used to score here from the bare command)
    if (cmd.type === 'designate' && cmd.enemy !== null) {
      notifyDesignate(w, cmd.enemy, !!(cmd as { viaDirective?: boolean }).viaDirective);
    }
    return false;
  }

  onKill(w: World, hit: HitInfo): void {
    const e = w.enemies, i = hit.enemy, f = e.flags[i];
    if (f & EnemyFlag.Boss) {
      const s = bossState(w), c = ctrlAt(s, i);
      if (c) { releaseCtrl(w, c); if (w.bossTell.bossIndex === i) { w.bossTell.ability = null; w.bossTell.ticksLeft = 0; w.bossTell.bossIndex = NO_ENTITY; } }
      return;
    }
    if (f & EnemyFlag.Elite) {
      const s = bossState(w), k = s.graveN & 7;
      s.graveX[k] = e.x[i]; s.graveY[k] = e.y[i]; if (s.graveN < 8) s.graveN++;
    }
    onEnemyKilled(w, i, hit.eventId);
  }

  onTowerHit(w: World, damage: number, enemy: number, cause: number): void { onEnemyTowerHit(w, damage, enemy, cause); }

  onStatusApply(w: World, enemy: number, status: StatusId): void { onEnemyStatus(w, enemy, status); }

  onCompact(w: World, remap: Int32Array, oldCount: number): void {
    for (const c of bossState(w).ctrls) {
      if (!c.active) continue;
      if (c.index >= 0 && c.index < oldCount) c.index = remap[c.index];
      if (c.wantIndex >= 0) c.wantIndex = c.wantIndex < oldCount ? remap[c.wantIndex] : NO_ENTITY;
    }
  }

  render(w: World, out: InstanceWriter): void {
    const s = bossState(w), e = w.enemies;
    for (const c of s.ctrls) {
      if (!c.active) continue;
      const b = w.resolveEnemy(c.index, c.gen);
      if (b < 0) continue;
      const x = e.x[b], y = e.y[b], r = e.radius[b];
      const col = c.def.color;
      if (c.tellSeq !== c.renderedTellSeq) { c.renderedTellSeq = c.tellSeq; out.fx(FxKind.Tell, x, y, 1, 0.35, 0.3, r * 2.2, 1); }
      if (c.counterSeq !== c.renderedCounterSeq) { c.renderedCounterSeq = c.counterSeq; out.fx(FxKind.Counter, x, y, 1, 0.95, 0.4, r * 2, 14); }
      if (c.tellActive) {
        const k = c.tellTicks / Math.max(1, Math.round(c.def.tell.windowSeconds * 60));
        out.push(x, y, r * (1.3 + 0.5 * k), 0, Shape.Ring, 1, 0.35, 0.3, 0.9, 7);
        if (c.seg) out.push(c.fx, c.fy, 4, 0, Shape.Line, 1, 0.45, 0.3, 0.8, 7, c.fx2, c.fy2);
        else if (c.tellId === 'gate_open') out.push(c.fx, c.fy, 30, 0, Shape.Ring, 1, 0.45, 0.3, 0.9, 7);
        const want = c.wantIndex >= 0 ? w.resolveEnemy(c.wantIndex, c.wantGen) : NO_ENTITY;
        if (c.tellCounter === 'designate' && want >= 0 && want !== b) out.push(e.x[want], e.y[want], e.radius[want] * 1.8, 0, Shape.Cross, 1, 0.9, 0.3, 0.9, 7);
        if (c.tellId === 'harmony_sync') {
          for (let k2 = c.orderPos; k2 < c.orderN; k2++) {
            for (let j = 0; j < e.count; j++) {
              if (e.gen[j] !== c.order[k2] || !w.alive(j)) continue;
              for (let n = 0; n <= k2 - c.orderPos; n++) out.push(e.x[j], e.y[j], e.radius[j] + 5 + 5 * n, 0, Shape.Ring, 1, 1, 1, 0.9, 7);
            }
          }
        }
      }
      if (c.revealT > 0) out.push(x, y, r * 1.35, 0, Shape.Star, 1, 1, 1, 1, 7);
      if (c.weakT > 0 || (e.flags[b] & EnemyFlag.WeakPointOpen)) {
        const wp = c.def.phases[c.phase].weakPoint;
        const a = e.angle[b] + (wp?.angle ?? 0), d = wp?.radius ?? 0;
        out.push(x + cos(a) * d, y + sin(a) * d, 10, 0, Shape.Circle, 1, 0.9, 0.2, 0.9, 6);
      }
      if (c.tetherT > 0) out.push(x, y, 2.5, 0, Shape.Line, col[0], col[1], col[2], 0.8, 3, 0, 0);
      if (c.inhaleT > 0) out.push(x, y, 360, 0, Shape.Ring, 0.6, 0.4, 1, 0.35, 7);
      if (c.id === 'null_engine' || c.id === 'choir') {
        for (let j = 0; j < e.count; j++) {
          if (e.kind[j] !== K.bossAdd || !w.alive(j) || e.aiB[j] !== ROLE_GEN || c.linkCutT > 0) continue;
          out.push(e.x[j], e.y[j], 1.5, 0, Shape.Line, 0.8, 0.9, 1, 0.6, 3, x, y);
        }
      }
      if (c.resisted >= 0) out.push(x, y, r + 8, 0, Shape.Hex, 0.7, 0.7, 0.8, 0.5, 5);
    }
    renderBehaviors(w, out);
  }
}
