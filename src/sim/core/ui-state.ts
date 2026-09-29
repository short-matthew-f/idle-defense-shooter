/** UiState builder (allocates; call ≤ 10 Hz). */
import type { UiState } from './types';
import type { AbilityId } from './ids';
import { EnemyFlag, Ev, TICK_RATE } from './types';
import type { WorldImpl } from './world-impl';
import type { RunMachine } from '../run/machine';
import { buildShop } from '../economy/shop';
import { abilityUi } from '../systems/abilities';
import { abilityDef, bossDef, bossDefByIndex } from './content';
import { SECTORS } from '../data/index';
import { computeForecast } from '../economy/forecast';   // WP8
import { codexHints } from '../economy/codex';           // WP8

function copy<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

export function buildUiState(w: WorldImpl, m: RunMachine): UiState {
  const run = w.run, t = w.tower, e = w.enemies;
  const forecast = computeForecast(w);   // WP8
  let alive = 0;
  for (let i = 0; i < e.count; i++) if ((e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally)) === 0) alive++;
  const wave = w.wave;
  const bi = m.boss();
  const isBoss = wave ? wave.isBoss : run.wave % 5 === 0;
  const bossId = wave?.bossId ?? null;
  const bdef = bi >= 0 ? bossDefByIndex(e.bossId[bi], run.wave) : bossId ? bossDef(bossId, run.wave) : null;
  const total = wave ? wave.spawns.length + (wave.isBoss && !wave.spawns.some((s) => s.kind === 'boss') ? 1 : 0) : 0;
  const spawned = wave ? m.cursor + (total > wave.spawns.length ? 1 : 0) : 0;
  const sector = wave?.sector ?? SECTORS.find((s) => run.wave >= s.waves[0] && run.wave <= s.waves[1])?.id ?? 'outskirts';
  const abilities: UiState['abilities'] = abilityUi(w);   // WP9: cost, cooldown remaining, ready
  return {
    tick: run.tick,
    run: {
      wave: run.wave, checkpoint: run.checkpoint, deepestCleared: run.deepestCleared, mode: run.mode, phase: run.phase,
      scrap: run.scrap, cores: run.cores, attempts: run.attempts, threatDial: run.threatDial, speedMultiplier: run.speedMultiplier,
      playSeconds: run.playSeconds, pendingDraft: run.pendingDraft ? [...run.pendingDraft] : null,
      hardpointSlotsOpen: run.hardpointSlotsOpen, attunementSlotsOpen: run.attunementSlotsOpen, longestChain: run.longestChain,
    },
    tower: { hp: t.hp, maxHp: t.maxHp, shield: t.shield, maxShield: t.maxShield, barrier: t.barrier, maxBarrier: t.maxBarrier, tempHp: t.tempHp, ce: t.ce, ceCap: t.ceCap },
    build: copy(w.build),
    meta: copy(w.meta),
    wave: {
      sector, isBoss, bossId, bossPhase: bi >= 0 ? e.bossPhase[bi] : 0,
      bossHp: bi >= 0 ? e.hp[bi] : 0, bossMaxHp: bi >= 0 ? e.maxHp[bi] : 0,
      bossPhaseMarks: bdef ? bdef.phases.map((p) => p.hpFraction).filter((f) => f < 1) : [],
      tellActive: w.bossTell.ability, tellTicksLeft: w.bossTell.ticksLeft,   // WP5
      enemiesAlive: alive, enemiesTotal: total, spawned,
      formation: wave?.formation ?? null,
      progress: total > 0 ? Math.min(1, (spawned - alive) / total) : 0,
      weakPointOpen: bi >= 0 && (e.flags[bi] & EnemyFlag.WeakPointOpen) !== 0,
    },
    shop: buildShop(w),
    abilities,
    forecast,
    stats: w.damageShare(),
    hints: codexHints(w),
    wallGaugeSeconds: forecast.wallGaugeSeconds,
    recentEvents: w.events.recent(run.tick - 2 * TICK_RATE, 200, (ev) => ev.type !== Ev.Hit && ev.type !== Ev.Spawn && ev.type !== Ev.StatusTick),
  };
}
