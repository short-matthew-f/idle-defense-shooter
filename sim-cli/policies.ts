/**
 * Player policies (design §10, §11, §19): what the "player" does in combat besides buying.
 *
 *  idle       no commands at all (the purchase agent still buys and answers drafts).
 *  directive  with `prestige.directives` owned: installs a default Directive set once per Prestige
 *             (`set_directives`) and lets the sim run it. With `prestige.autocast` owned: slots
 *             abilities and lets the sim Autocast. Otherwise it emulates Autocast: every 3 s it casts
 *             one affordable slotted ability at the largest group, with a 0.6 s reaction delay.
 *  active     oracle-ish human: 0.2 s reaction; casts the boss's Counter when `bossTell` matches a
 *             slotted ability (or designates the boss on 'designate' tells), keeps a designation on
 *             the boss / healers / wardens, Repulsor Pulse when the inner ring holds ≥ 5 enemies,
 *             Emergency Repair below 30% HP, Bombardment into big groups with spare CE.
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
import type { PolicyId } from './types';

export interface PolicyStats { casts: number; designations: number; directivesInstalled: number; noops: Record<string, number> }

interface Pending { at: number; cmd: Command }

/** Default Directive set (§11 examples plus survival and designation rules). */
export const DEFAULT_DIRECTIVES: Directive[] = [
  { enabled: true, conditions: [{ kind: 'tower_hp_below', pct: 30 }], action: { kind: 'cast', ability: 'emergency_repair', at: 'tower' } },
  { enabled: true, conditions: [{ kind: 'boss_tell_active' }], action: { kind: 'designate', what: 'weak_point' } },
  { enabled: true, conditions: [{ kind: 'inner_ring_at_least', n: 5 }], action: { kind: 'cast', ability: 'repulsor_pulse', at: 'tower' } },
  { enabled: true, conditions: [{ kind: 'group_at_least', n: 12, radius: 90 }], action: { kind: 'cast', ability: 'bombardment', at: 'largest_group' } },
  { enabled: true, conditions: [{ kind: 'wave_is', which: 'boss' }], action: { kind: 'designate', what: 'weak_point' } },
  { enabled: true, conditions: [{ kind: 'enemy_present', enemy: 'healer' }], action: { kind: 'designate', what: 'healer' } },
  { enabled: true, conditions: [{ kind: 'enemy_present', enemy: 'warden' }], action: { kind: 'designate', what: 'warden' } },
];

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

  protected decide(sim: Sim): void {
    const w = sim.world, meta = w.meta;
    if (this.installedFor !== meta.prestigeCount) {
      this.installedFor = meta.prestigeCount;
      if ((meta.prestigeRanks['prestige.directives'] | 0) > 0) {
        this.mode = 'directives';
        this.setSlots(sim, ['repulsor_pulse', 'bombardment', 'emergency_repair']);
        const err = applyCommand(sim.machine, { type: 'set_directives', directives: DEFAULT_DIRECTIVES });
        if (err) this.noop(`set_directives:${err}`); else this.stats.directivesInstalled++;
      } else if ((meta.prestigeRanks['prestige.autocast'] | 0) > 0) {
        this.mode = 'autocast';
        this.setSlots(sim, ['bombardment', 'repulsor_pulse']);
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

  protected decide(sim: Sim): void {
    const w = sim.world, run = w.run;
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

export function makePolicy(id: PolicyId): Policy {
  switch (id) {
    case 'idle': return new IdlePolicy();
    case 'directive': return new DirectivePolicy();
    case 'active': return new ActivePolicy();
  }
}
