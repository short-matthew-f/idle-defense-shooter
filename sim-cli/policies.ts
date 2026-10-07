/**
 * Player policies (design §10, §11, §19): what the "player" does in combat besides buying.
 *
 *  idle       no commands at all (the purchase agent still buys and answers drafts).
 *  directive  with `prestige.directives` owned: slots AUTOMATION_SLOTS, installs AUTOMATION_DIRECTIVES once per
 *             Prestige (`set_directives`) and lets the sim's engine and Autocast run them (the Directive gap row). With `prestige.autocast` owned: slots
 *             abilities and lets the sim Autocast. Otherwise it emulates Autocast: every 3 s it casts
 *             one affordable slotted ability at the largest group, with a 0.6 s reaction delay.
 *  active     oracle-ish human: 0.2 s reaction; casts the boss's Counter when `bossTell` matches a
 *             slotted ability (or designates the boss on 'designate' tells), keeps a designation on
 *             the boss / healers / wardens, Repulsor Pulse when the inner ring holds ≥ 5 enemies,
 *             Emergency Repair below 30% HP, Bombardment into big groups with spare CE.
 *             Active-edge pieces (systems/active.ts, docs/ACTIVE.md; off with RunConfig.activeExtras = false) under
 *             human limits: at most 2 taps/s in total; each salvage crate is collected with 70% probability, 0.35 s
 *             or more after it drops; otherwise assist taps at the boss / the designated enemy / the enemy nearest
 *             the tower whenever the assist is off cooldown (aimed at the enemy's position one reaction earlier);
 *             Overcharge charged when full with ≥ 3 enemies (or a boss) up and released at the window's centre
 *             ± 0.3 s (deterministic per volley: about 3 in 4 land in the window).
 *
 * Abilities, Directives and Tells are being implemented by WP5/WP9 in parallel: this file only
 * speaks `Command`s and reads `world.bossTell` / `UiState`. A command the sim rejects is counted in
 * `noops` so reports show which commands had no effect.
 */
import type { Sim } from '../src/sim/index';
import type { WorldImpl } from '../src/sim/core/world-impl';
import type { Command, Directive } from '../src/sim/core/types';
import type { AbilityId } from '../src/sim/core/ids';
import { EnemyFlag, INNER_RING, TICK_RATE } from '../src/sim/core/types';
import { abilityDef } from '../src/sim/core/content';
import { bossForWave, BOSS_BY_ID } from '../src/sim/data/bosses';
import { applyCommand } from '../src/sim/run/commands';
import { findActive } from '../src/sim/systems/active';
import { ACTIVE } from '../src/sim/data/active';
import type { ActivePiece, PolicyId } from './types';

export interface PolicyStats { casts: number; designations: number; directivesInstalled: number; noops: Record<string, number> }

interface Pending { at: number; cmd: Command }

/**
 * The Directive set the directive policy installs (Directive gap row, runner.ts automationStart): what a player builds in
 * the editor with Directives rank 1 (3 rules) and two tactical slots (Repulsor Pulse, Bombardment). Without Autonomy
 * no rule can read a boss tell, so the rules spend CE where it pays and leave the rest to Autocast:
 *  1. on boss waves, designate an open weak point (the window a Counter opens);
 *  2. Repulsor Pulse when 5+ enemies crowd the inner ring;
 *  3. Bombardment into groups of 10+.
 * Autocast runs every slotted ability no enabled rule casts (none here) — see AUTOMATION_SLOTS.
 */
export const AUTOMATION_DIRECTIVES: Directive[] = [
  { enabled: true, conditions: [{ kind: 'wave_is', which: 'boss' }], action: { kind: 'designate', what: 'weak_point' } },
  { enabled: true, conditions: [{ kind: 'inner_ring_at_least', n: 5 }], action: { kind: 'cast', ability: 'repulsor_pulse', at: 'tower' } },
  { enabled: true, conditions: [{ kind: 'group_at_least', n: 10, radius: 90 }], action: { kind: 'cast', ability: 'bombardment', at: 'largest_group' } },
];
/** Tactical slots for the directive policy (two at Prestige 2: the bosses at 5 and 10 are countered by these two). */
export const AUTOMATION_SLOTS: AbilityId[] = ['repulsor_pulse', 'bombardment'];

const QBUF = new Int32Array(2048);

/** Center and size of the densest group (radius r), sampling up to 48 enemies as centers. */
export function largestGroup(w: WorldImpl, r: number): { x: number; y: number; n: number; i: number } {
  const e = w.enemies;
  let best = { x: 0, y: 0, n: 0, i: -1 };
  const stride = Math.max(1, Math.floor(e.count / 48));
  for (let i = 0; i < e.count; i += stride) {
    if (e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally)) continue;
    const n = w.queryRadius(e.x[i], e.y[i], r, QBUF);
    if (n > best.n) best = { x: e.x[i], y: e.y[i], n, i };
  }
  return best;
}

export function innerRingCount(w: WorldImpl): number {
  const e = w.enemies;
  let n = 0;
  const r2 = INNER_RING * INNER_RING;
  for (let i = 0; i < e.count; i++) {
    if (e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally)) continue;
    if (e.x[i] * e.x[i] + e.y[i] * e.y[i] <= r2) n++;
  }
  return n;
}

function abilityCost(w: WorldImpl, id: AbilityId): number {
  const d = abilityDef(id);
  const mul = w.stats.get(`ability.${id}.cost_mul`);
  return (d?.cost ?? 999) * (mul > 0 ? mul : 1);
}

export abstract class Policy {
  abstract readonly id: PolicyId;
  stats: PolicyStats = { casts: 0, designations: 0, directivesInstalled: 0, noops: {} };
  protected queue: Pending[] = [];
  protected cooldownUntil: Partial<Record<AbilityId, number>> = {};

  reset(): void { this.queue = []; this.cooldownUntil = {}; }

  /** Called by the runner before every step. */
  tick(sim: Sim): void {
    const w = sim.world;
    if (this.queue.length) this.flush(sim, w.run.tick);
    this.decide(sim);
  }
  protected abstract decide(sim: Sim): void;

  protected send(sim: Sim, cmd: Command, delayTicks: number): void {
    if (delayTicks <= 0) this.exec(sim, cmd); else this.queue.push({ at: sim.world.run.tick + delayTicks, cmd });
  }
  private flush(sim: Sim, now: number): void {
    const due: Command[] = [];
    this.queue = this.queue.filter((p) => { if (p.at <= now) { due.push(p.cmd); return false; } return true; });
    for (const c of due) this.exec(sim, c);
  }
  protected exec(sim: Sim, cmd: Command): void {
    const w = sim.world;
    if (w.run.phase !== 'combat' && (cmd.type === 'cast' || cmd.type === 'designate')) return;   // the moment passed
    if (cmd.type === 'designate' && cmd.enemy !== null && !w.alive(cmd.enemy)) return;
    const before = w.events.nextId;
    const err = applyCommand(sim.machine, cmd);
    if (cmd.type === 'cast') {
      this.stats.casts++;
      const d = abilityDef(cmd.ability);
      this.cooldownUntil[cmd.ability] = w.run.tick + Math.round((d?.cooldown ?? 3) * TICK_RATE);
      if (err || w.events.nextId === before) this.noop(`cast:${err ?? 'no event'}`);
    } else if (cmd.type === 'designate') this.stats.designations++;
    if (err && cmd.type !== 'cast') this.noop(`${cmd.type}:${err}`);
  }
  protected noop(k: string): void { this.stats.noops[k] = (this.stats.noops[k] ?? 0) + 1; }

  protected slotted(w: WorldImpl, id: AbilityId): boolean { return w.build.abilities.includes(id); }
  protected ready(w: WorldImpl, id: AbilityId, reserve = 0): boolean {
    return this.slotted(w, id) && w.tower.ce >= abilityCost(w, id) + reserve && (this.cooldownUntil[id] ?? -1) <= w.run.tick;
  }
  /** Put `want` into the ability slots (in order), only sending changes. */
  protected setSlots(sim: Sim, want: AbilityId[]): void {
    const b = sim.world.build;
    for (let i = 0; i < b.abilities.length && i < want.length; i++) {
      if (b.abilities[i] === want[i]) continue;
      const err = applyCommand(sim.machine, { type: 'set_ability_slot', slot: i, ability: want[i] });
      if (err) this.noop(`set_ability_slot:${err}`);
    }
  }
}

export class IdlePolicy extends Policy {
  readonly id = 'idle' as const;
  protected decide(): void { /* idle: no commands */ }
}

export class DirectivePolicy extends Policy {
  readonly id = 'directive' as const;
  private installedFor = -1;
  private nextCheck = 0;
  private mode: 'directives' | 'autocast' | 'emulated' = 'emulated';
  static readonly DELAY = Math.round(0.6 * TICK_RATE);
  constructor(private readonly directives: Directive[] = AUTOMATION_DIRECTIVES, private readonly slots: AbilityId[] = AUTOMATION_SLOTS) { super(); }

  protected decide(sim: Sim): void {
    const w = sim.world, meta = w.meta;
    if (this.installedFor !== meta.prestigeCount) {
      this.installedFor = meta.prestigeCount;
      if ((meta.prestigeRanks['prestige.directives'] | 0) > 0) {
        this.mode = 'directives';
        this.setSlots(sim, this.slots);
        const err = applyCommand(sim.machine, { type: 'set_directives', directives: this.directives });
        if (err) this.noop(`set_directives:${err}`); else this.stats.directivesInstalled++;
      } else if ((meta.prestigeRanks['prestige.autocast'] | 0) > 0) {
        this.mode = 'autocast';
        this.setSlots(sim, this.slots);
      } else {
        this.mode = 'emulated';
        this.setSlots(sim, ['bombardment', 'repulsor_pulse']);
      }
    }
    if (this.mode !== 'emulated' || w.run.phase !== 'combat' || w.run.tick < this.nextCheck) return;
    this.nextCheck = w.run.tick + 3 * TICK_RATE;
    for (const id of w.build.abilities) {
      if (!id || !this.ready(w, id)) continue;
      const def = abilityDef(id);
      if (def?.targeted === 'self') { this.send(sim, { type: 'cast', ability: id, x: 0, y: 0, viaDirective: true, directive: -1 }, DirectivePolicy.DELAY); break; }
      const g = largestGroup(w, Math.max(60, def?.radius ?? 90));
      if (g.n <= 0) continue;
      this.send(sim, { type: 'cast', ability: id, x: g.x, y: g.y, target: g.i, viaDirective: true, directive: -1 }, DirectivePolicy.DELAY);
      break;
    }
  }
}

export class ActivePolicy extends Policy {
  readonly id = 'active' as const;
  static readonly REACTION = Math.round(0.2 * TICK_RATE);
  private nextCheck = 0;
  private slotWave = -1;
  private tellHandled = false;
  private designatedGen = -1;
  private uiPoll = 0;
  /** Active-edge pieces on (default) or off (RunConfig.activeExtras = false: the pre-active-edge policy, for comparison). */
  private readonly pieces: ReadonlySet<ActivePiece>;
  constructor(extras: boolean | readonly ActivePiece[] = true) {
    super();
    this.pieces = new Set<ActivePiece>(extras === true ? ['assist', 'salvage', 'overcharge'] : extras === false ? [] : extras);
  }
  static readonly TAP_GAP = Math.ceil(TICK_RATE / 2);          // ≤ 2 taps/s
  static readonly CRATE_REACT = Math.round(0.35 * TICK_RATE);
  static readonly COLLECT_SHARE = 0.7;
  private nextTap = 0;
  private releaseAt = -1;
  private volleys = 0;
  stat = { assists: 0, collects: 0, skippedCrates: 0, volleys: 0 };

  override reset(): void { super.reset(); this.nextTap = 0; this.releaseAt = -1; }

  /** Deterministic 0..1 from integers (no PRNG draw: the policy must not perturb the sim). */
  private static u01(a: number, b: number): number {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
    return (h >>> 8) / 16777216;
  }

  /** Taps, crates and Overcharge: every tick, under the human limits above. */
  private activeExtras(sim: Sim): void {
    const w = sim.world, run = w.run, s = findActive(w);
    if (!s) return;
    const now = run.tick;
    // Overcharge: charge when full with a target-rich field, release around the window centre
    if (!this.pieces.has('overcharge')) { /* piece off */ } else if (s.charging) {
      if (this.releaseAt < 0) this.releaseAt = Math.round((0.5 * (ACTIVE.overcharge.perfectFrom + ACTIVE.overcharge.perfectTo) + (ActivePolicy.u01(this.volleys, run.prestigeSeed) - 0.5) * 0.6) * TICK_RATE);
      if (s.hold >= this.releaseAt) { applyCommand(sim.machine, { type: 'overcharge', action: 'release' }); this.releaseAt = -1; this.volleys++; this.stat.volleys++; }
    } else if (s.canCharge(w) && (sim.machine.boss() >= 0 || this.alive(w) >= 3)) {
      applyCommand(sim.machine, { type: 'overcharge', action: 'charge' });
      this.releaseAt = -1;
    }
    if (now < this.nextTap) return;
    // salvage first: 70% of crates, after a reaction delay
    for (let k = 0; k < s.crateLive.length && this.pieces.has('salvage'); k++) {
      if (!s.crateLive[k] || now - s.crateBorn[k] < ActivePolicy.CRATE_REACT) continue;
      if (ActivePolicy.u01(s.crateBorn[k], k + 7 * run.prestigeSeed) >= ActivePolicy.COLLECT_SHARE) continue;
      applyCommand(sim.machine, { type: 'collect_salvage', x: s.crateX[k], y: s.crateY[k] });
      this.stat.collects++;
      this.nextTap = now + ActivePolicy.TAP_GAP;
      return;
    }
    // assist tap when off cooldown (in combat)
    if (!this.pieces.has('assist') || run.phase !== 'combat' || s.assistCooldownLeft > 0) return;
    const e = w.enemies, t = w.tower;
    let i = sim.machine.boss();
    if (i < 0 && t.designated >= 0 && w.alive(t.designated) && e.gen[t.designated] === t.designatedGen) i = t.designated;
    if (i < 0) {
      let best = Infinity;
      for (let j = 0; j < e.count; j++) {
        if (e.flags[j] & (EnemyFlag.Dead | EnemyFlag.Ally)) continue;
        const d = e.x[j] * e.x[j] + e.y[j] * e.y[j];
        if (d < best) { best = d; i = j; }
      }
    }
    if (i < 0) return;
    // the tap lands where the enemy was one reaction ago (its velocity is ~constant over 0.2 s)
    const lag = ActivePolicy.REACTION / TICK_RATE;
    this.send(sim, { type: 'tap_assist', x: e.x[i] - e.vx[i] * lag * 0.5, y: e.y[i] - e.vy[i] * lag * 0.5 }, 0);
    this.stat.assists++;
    this.nextTap = now + ActivePolicy.TAP_GAP;
  }

  private alive(w: WorldImpl): number {
    const e = w.enemies; let n = 0;
    for (let i = 0; i < e.count; i++) if (!(e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally))) n++;
    return n;
  }

  protected decide(sim: Sim): void {
    const w = sim.world, run = w.run;
    if (this.pieces.size) this.activeExtras(sim);
    if (run.phase === 'between' && this.slotWave !== run.wave) { this.slotWave = run.wave; this.slotFor(sim, run.wave); }
    if (run.phase !== 'combat' || run.tick < this.nextCheck) return;
    this.nextCheck = run.tick + ActivePolicy.REACTION;
    const R = ActivePolicy.REACTION;
    const t = w.tower;
    const bi = sim.machine.boss();
    const counter = run.wave % 5 === 0 ? this.counterFor(run.wave) : null;
    const reserve = counter && counter !== 'designate' && this.slotted(w, counter) ? abilityCost(w, counter) : 0;

    // 1. Boss tell → Counter
    const tell = this.readTell(sim, bi);
    if (tell && !this.tellHandled) {
      if (tell === 'designate') {
        if (bi >= 0) { this.send(sim, { type: 'designate', enemy: bi }, R); this.tellHandled = true; }
      } else if (this.ready(w, tell)) {
        const x = bi >= 0 ? w.enemies.x[bi] : 0, y = bi >= 0 ? w.enemies.y[bi] : 0;
        this.send(sim, { type: 'cast', ability: tell, x, y, ...(bi >= 0 ? { target: bi } : {}) }, R);
        this.tellHandled = true;
      }
    } else if (!tell) this.tellHandled = false;

    // 2. Emergency Repair below 30% HP (overrides the Counter reserve)
    if (t.hp < t.maxHp * 0.3 && this.ready(w, 'emergency_repair')) this.send(sim, { type: 'cast', ability: 'emergency_repair', x: 0, y: 0 }, R);
    // 3. Repulsor when the inner ring is crowded
    else if (this.ready(w, 'repulsor_pulse', counter === 'repulsor_pulse' ? 0 : reserve) && counter !== 'repulsor_pulse' && innerRingCount(w) >= 5) {
      this.send(sim, { type: 'cast', ability: 'repulsor_pulse', x: 0, y: 0 }, R);
    }
    // 4. Bombardment into big groups with spare CE
    else if (this.ready(w, 'bombardment', counter === 'bombardment' ? 0 : reserve) && counter !== 'bombardment') {
      const g = largestGroup(w, 90);
      if (g.n >= 8) this.send(sim, { type: 'cast', ability: 'bombardment', x: g.x, y: g.y }, R);
    }

    // 5. Designation: boss, else healer / warden
    const cur = t.designated;
    const curOk = cur >= 0 && w.alive(cur) && w.enemies.gen[cur] === this.designatedGen;
    let want = -1;
    if (bi >= 0) want = bi;
    else {
      const e = w.enemies;
      for (let i = 0; i < e.count; i++) {
        const f = e.flags[i];
        if (f & (EnemyFlag.Dead | EnemyFlag.Ally)) continue;
        if (f & (EnemyFlag.Healer | EnemyFlag.Shielder)) { want = i; break; }
      }
    }
    if (want >= 0 && (!curOk || cur !== want) && !(curOk && bi < 0 && (w.enemies.flags[cur] & (EnemyFlag.Healer | EnemyFlag.Shielder)))) {
      this.designatedGen = w.enemies.gen[want];
      this.send(sim, { type: 'designate', enemy: want }, R);
    }
  }

  private readTell(sim: Sim, bi: number): AbilityId | 'designate' | null {
    const w = sim.world as WorldImpl & { bossTell?: { ability: AbilityId | 'designate' | null } };
    if (w.bossTell) return w.bossTell.ability ?? null;
    if (bi < 0) return null;
    if (w.run.tick >= this.uiPoll) { this.uiPoll = w.run.tick + 12; return sim.uiState().wave.tellActive ?? null; }
    return null;
  }

  private counterFor(wave: number): AbilityId | 'designate' | null {
    const id = bossForWave(wave);
    return id ? (BOSS_BY_ID[id]?.tell.counter ?? null) : null;
  }

  private slotFor(sim: Sim, wave: number): void {
    const c = wave % 5 === 0 ? this.counterFor(wave) : null;
    const n = sim.world.build.abilities.length;
    const want: AbilityId[] = [];
    if (c && c !== 'designate') want.push(c);
    for (const a of ['emergency_repair', 'repulsor_pulse', 'bombardment'] as AbilityId[]) if (!want.includes(a)) want.push(a);
    this.setSlots(sim, want.slice(0, n));
  }
}

export function makePolicy(id: PolicyId, cfg?: { activeExtras?: boolean | ActivePiece[] }): Policy {
  switch (id) {
    case 'idle': return new IdlePolicy();
    case 'directive': return new DirectivePolicy();
    case 'active': return new ActivePolicy(cfg?.activeExtras ?? true);
  }
}
