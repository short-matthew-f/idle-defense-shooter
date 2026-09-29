/**
 * Optimizer: beam search (width 4, depth 3) over purchase orders, Doctrine picks, hardpoint /
 * attunement choices and Anomaly picks, scored by rollouts of the real sim.
 *
 * Branching: `sim.save()` restores a run at the start of its checkpoint (live combat is never
 * saved), so the Optimizer only plans at `between` on wave checkpoint+1 — the start of every
 * attempt and the wave after each new checkpoint — where a restored branch *is* the live state
 * (up to HP/CE carried from the boss wave). Each rollout = `new Sim(clone(save))`, apply the action
 * prefix, complete the spend with the balanced default policy, then simulate until `horizonWaves`
 * waves are cleared, the tower dies, or `horizonTicks` pass.
 *
 * Score = waves cleared + progress in the wave being fought − ticks / (10 · horizon), i.e. the
 * simulated wave-clear time over a short horizon.
 *
 * `optimizer_lite` is the fallback the brief allows: a greedy lookahead of 1 (one rollout per
 * candidate action, best single action applied) — about 9× cheaper than the beam.
 */
import { Sim } from '../../src/sim/index';
import type { Command, SaveState, ShopEntry } from '../../src/sim/core/types';
import type { AnomalyId, DoctrineId, TreeId } from '../../src/sim/core/ids';
import { EnemyFlag } from '../../src/sim/core/types';
import { Prng } from '../../src/sim/math/prng';
import { treeDef } from '../../src/sim/core/content';
import { ALL_ELEMENTS, ALL_HARDPOINTS, Agent, makeCtx, scrapEntries, weighted, type AgentCtx, type WeightTable } from './base';

const BALANCED: WeightTable = {
  tree: { ballistics: 1, bastion: 0.7, reactor: 0.5, fire: 1, lightning: 1, poison: 1, frost: 0.9, ordnance: 1, drones: 1, blade: 1, laser: 1, gravitics: 1, fusion: 1.5, ability: 0.3 },
  tag: { damage: 1.2, speed: 1, defense: 0.9, status: 0.9, control: 0.6, range: 0.4, '*': 0.5 },
};

/** The default completion policy used inside rollouts and between plans. */
export class BalancedAgent extends Agent {
  readonly id: string = 'balanced';
  constructor() {
    super();
    this.doctrinePref = {
      ballistics: 'multishot', bastion: 'fortress', reactor: 'overclock', fire: 'inferno', lightning: 'chain',
      poison: 'venom', frost: 'shatter', ordnance: 'swarm', drones: 'wing', blade: 'tempest', laser: 'resonance', gravitics: 'collapse',
    };
  }
  value(_ctx: AgentCtx, e: ShopEntry): number { return weighted(BALANCED, e); }
}

interface Action { label: string; cmd: Command }
interface Scored { seq: Action[]; score: number }

export interface OptimizerStats { decisions: number; rollouts: number; rolloutTicks: number; ms: number; drafts: number }

export class OptimizerAgent extends BalancedAgent {
  override readonly id: string;
  readonly beam: boolean;
  width = 4;
  depth = 3;
  candidates = 6;
  horizonWaves = 3;
  horizonTicks = 100 * 60;
  stats: OptimizerStats = { decisions: 0, rollouts: 0, rolloutTicks: 0, ms: 0, drafts: 0 };
  private decided = '';
  private completer = new BalancedAgent();

  constructor(beam = true) {
    super();
    this.beam = beam;
    this.id = beam ? 'optimizer' : 'optimizer_lite';
  }
  override reset(): void { super.reset(); this.decided = ''; }
  override setDoctrineOverrides(o: Partial<Record<TreeId, DoctrineId>> | undefined): void { super.setDoctrineOverrides(o); this.completer.setDoctrineOverrides(o); }

  override tick(ctx: AgentCtx): void {
    const run = ctx.w.run;
    if (run.phase === 'between' && run.wave === run.checkpoint + 1 && !run.pendingDraft) {
      const key = `${run.attempts}:${run.checkpoint}:${ctx.w.meta.prestigeCount}`;
      if (key !== this.decided) { this.decided = key; this.plan(ctx); }
    }
    super.tick(ctx);
  }

  /** Draft: roll out each offer (and a skip) from the checkpoint; pick the best. */
  override pickAnomaly(ctx: AgentCtx, offers: AnomalyId[]): AnomalyId | null {
    if (offers.length <= 1) return offers[0] ?? null;
    const t0 = performance.now();
    this.stats.drafts++;
    const save = ctx.sim.save();
    let best: AnomalyId | null = offers[0], bestS = -Infinity;
    for (const id of offers) {
      const s = this.rollout(save, [], ctx, offers, id);
      if (s > bestS) { bestS = s; best = id; }
    }
    this.stats.ms += performance.now() - t0;
    return best;
  }

  private actions(ctx: AgentCtx): Action[] {
    const w = ctx.w, b = w.build, run = w.run;
    const out: Action[] = [];
    for (let i = 0; i < run.hardpointSlotsOpen; i++) {
      if (b.hardpoints[i]) continue;
      for (const s of ALL_HARDPOINTS) if (!w.stats.mounted(s)) out.push({ label: `mount ${s}`, cmd: { type: 'mount_hardpoint', slot: i, system: s } });
      break;
    }
    for (let i = 0; i < run.attunementSlotsOpen; i++) {
      if (b.attunements[i]) continue;
      for (const e of ALL_ELEMENTS) if (!w.stats.attuned(e)) out.push({ label: `attune ${e}`, cmd: { type: 'attune', slot: i, element: e } });
      break;
    }
    for (const e of ctx.shop()) {
      if (e.kind !== 'doctrine' || e.locked || e.cost > 0) continue;
      const tree = e.tree as TreeId;
      if (b.doctrines[tree]) continue;
      for (const d of treeDef(tree)?.doctrines ?? []) {
        if (this.overrides[tree] && this.overrides[tree] !== d.id) continue;
        out.push({ label: `doctrine ${tree}.${d.id}`, cmd: { type: 'choose_doctrine', tree, doctrine: d.id } });
      }
      break;   // one fork per decision keeps the branching factor bounded
    }
    const buys = scrapEntries(ctx).filter((e) => e.cost <= run.scrap)
      .map((e) => ({ e, r: this.value(ctx, e) / Math.max(1, e.cost) }))
      .filter((x) => x.r > 0)
      .sort((a, b2) => b2.r - a.r || (a.e.node < b2.e.node ? -1 : 1))
      .slice(0, this.candidates);
    for (const x of buys) out.push({ label: `buy ${x.e.node}`, cmd: { type: 'buy', node: x.e.node } });
    return out;
  }

  private plan(ctx: AgentCtx): void {
    const acts = this.actions(ctx);
    if (acts.length === 0) return;
    const t0 = performance.now();
    this.stats.decisions++;
    const save = ctx.sim.save();
    let beams: Scored[] = [{ seq: [], score: this.rollout(save, [], ctx) }];
    let best = beams[0];
    const depth = this.beam ? this.depth : 1;
    const width = this.beam ? this.width : 1;
    for (let d = 0; d < depth; d++) {
      const next: Scored[] = [];
      for (const bm of beams) {
        for (const a of acts) {
          if (bm.seq.some((x) => x.label === a.label && a.cmd.type !== 'buy')) continue;
          if (a.cmd.type !== 'buy' && bm.seq.some((x) => x.cmd.type === a.cmd.type && (a.cmd.type !== 'choose_doctrine' || (x.cmd as { tree: string }).tree === (a.cmd as { tree: string }).tree))) continue;
          const seq = [...bm.seq, a];
          const s = this.rollout(save, seq, ctx);
          if (s > -Infinity) next.push({ seq, score: s });
        }
      }
      if (next.length === 0) break;
      next.sort((x, y) => y.score - x.score || x.seq.length - y.seq.length);
      beams = next.slice(0, width);
      if (beams[0].score > best.score) best = beams[0];
    }
    for (const a of best.seq) ctx.apply(a.cmd);
    this.waitScrap = 0;
    this.stats.ms += performance.now() - t0;
  }

  /** Simulate a branch from `save`; returns the horizon score (−∞ if the prefix is illegal). */
  private rollout(save: SaveState, seq: Action[], live: AgentCtx, draft?: AnomalyId[], pick?: AnomalyId): number {
    this.stats.rollouts++;
    const sim = new Sim(structuredClone(save));
    const ctx = makeCtx(sim, new Prng(0x0b7), 'idle');
    if (draft && pick) {
      sim.world.run.pendingDraft = [...draft];
      if (sim.machine.pickAnomaly(pick, sim.world.build.anomalies.length >= sim.world.build.anomalySockets ? this.replaceIndex(ctx) : undefined)) return -Infinity;
    }
    for (const a of seq) if (ctx.apply(a.cmd)) return -Infinity;
    const c = this.completer;
    c.reset();
    // follow the live agent's already-made doctrine choices
    c.setDoctrineOverrides({ ...this.overrides, ...live.w.build.doctrines });
    const w = sim.world;
    const startCleared = w.run.deepestCleared;
    let cleared = 0, prev = w.run.phase, t = 0;
    for (; t < this.horizonTicks; t++) {
      c.tick(ctx);
      sim.step();
      const ph = w.run.phase;
      if (ph !== prev) {
        if (prev === 'combat' && ph === 'wave_clear') { cleared++; if (cleared >= this.horizonWaves) break; }
        if (ph === 'dead') break;
        prev = ph;
      }
    }
    this.stats.rolloutTicks += t;
    let progress = 0;
    if (w.run.phase === 'combat' || w.run.phase === 'dead') {
      const bi = sim.machine.boss();
      if (bi >= 0) progress = 1 - w.enemies.hp[bi] / Math.max(1, w.enemies.maxHp[bi]);
      else if (w.wave) {
        let alive = 0;
        for (let i = 0; i < w.enemies.count; i++) if ((w.enemies.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally)) === 0) alive++;
        progress = Math.max(0, Math.min(1, (sim.machine.cursor - alive) / Math.max(1, w.wave.spawns.length)));
      }
      progress *= 0.95;
    }
    void startCleared;
    return cleared + progress - t / (10 * this.horizonTicks);
  }
}
