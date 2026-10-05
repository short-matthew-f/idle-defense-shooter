/** UiState builder (allocates; call ≤ 10 Hz). */
import type { UiState } from './types';
import { EnemyFlag, Ev, TICK_RATE } from './types';
import type { WorldImpl } from './world-impl';
import type { RunMachine } from '../run/machine';
import { buildShop } from '../economy/shop';
import { shopTreeTotals } from '../economy/bulk';
import { abilitySlotCount, abilityUi, secondDesignatorAllowed, trialActive } from '../systems/abilities';
import { activeUi } from '../systems/active';   // Active edge
import { bossDef, bossDefByIndex, frameDef } from './content';
import { SECTORS, SYSTEM_ORDER_IDS, TREES } from '../data/index';
import { computeForecast } from '../economy/forecast';   // WP8
import { codexHints } from '../economy/codex';           // WP8
import { attunementCap, hardpointCap, nextSlotWaves } from '../run/slots';
import { trialForbidsMount } from '../run/prestige';
import { allowedSpeed } from '../economy/prestige';
import { BOON_CAP, boonRerollCost } from '../run/boons';
import { quartermasterUi } from '../directives/quartermaster';

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
  const slots = nextSlotWaves(w);
  const shop = buildShop(w);
  return {
    tick: run.tick,
    run: {
      wave: run.wave, checkpoint: run.checkpoint, deepestCleared: run.deepestCleared, mode: run.mode, phase: run.phase,
      scrap: run.scrap, cores: run.cores, attempts: run.attempts, threatDial: run.threatDial, speedMultiplier: run.speedMultiplier,
      playSeconds: run.playSeconds, pendingDraft: run.pendingDraft ? [...run.pendingDraft] : null,
      hardpointSlotsOpen: run.hardpointSlotsOpen, attunementSlotsOpen: run.attunementSlotsOpen, longestChain: run.longestChain,
      patrolScrapPerSecond: run.patrolScrapPerSecond, ...(run.minThreatDial !== undefined ? { minThreatDial: run.minThreatDial } : {}),
      attemptDamageTaken: { ...run.attemptDamageTaken },
      // Boons (run/boons.ts); names and descriptions are looked up client-side from data/boons.ts
      boonOffer: run.boonOffer ? [...run.boonOffer] : null, boonOfferSeq: run.boonOfferSeq, boonOfferKind: run.boonOfferKind,
      boons: [...w.build.boons], boonQueueLength: run.boonQueue.length, boonCap: BOON_CAP, boonRerollCost: boonRerollCost(run),
      holdTicksLeft: m.holdTicksLeft,
    },
    activeTrial: w.meta.activeTrial ?? null,
    extraSystems: extraSystems(w),
    // Reachability additions (docs/reviews/REACHABILITY.md)
    secondDoctrine: secondDoctrines(w),
    abilitySlots: abilitySlotCount(w),
    designators: designators(w),
    slotCaps: { hardpoint: hardpointCap(w), attunement: attunementCap(w) },
    mountBlocked: mountBlocked(w),
    nextHardpointWave: slots.hardpoint,
    nextAttunementWave: slots.attunement,
    speedAllowed: allowedSpeed(run, w.meta),
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
      stalled: m.stall.stalled(),   // UX Phase 1: the death card names a boss nobody was damaging
    },
    shop,
    shopTreeTotals: shopTreeTotals(shop, run.scrap),   // approximate (economy/bulk.ts)
    abilities,
    forecast,
    stats: w.damageShare(),
    hints: codexHints(w),
    wallGaugeSeconds: forecast.wallGaugeSeconds,
    quartermaster: quartermasterUi(w),   // directives/quartermaster.ts
    recentEvents: w.events.recent(run.tick - 2 * TICK_RATE, 200, (ev) => ev.type !== Ev.Hit && ev.type !== Ev.Spawn && ev.type !== Ev.StatusTick),
    active: activeUi(w),   // Active edge (systems/active.ts)
  };
}

/** Systems that run without a hardpoint slot (Frame free mount, Borrowed Blade), for the Upgrades and Build screens. */
function extraSystems(w: WorldImpl): NonNullable<UiState['extraSystems']> {
  const out: NonNullable<UiState['extraSystems']> = [];
  for (const s of SYSTEM_ORDER_IDS) {
    if (s === 'primary' || w.build.hardpoints.includes(s) || !w.stats.mounted(s)) continue;
    out.push({ system: s, via: w.stats.borrowed(s) ? 'borrowed' : 'frame' });
  }
  return out;
}

/** Reachability: trees that can run (or run) a second Doctrine, with its strength and source. */
function secondDoctrines(w: WorldImpl): NonNullable<UiState['secondDoctrine']> {
  const out: NonNullable<UiState['secondDoctrine']> = {};
  const s = w.stats, b = w.build;
  for (const t of TREES) {
    if (!s.treeActive(t.id) || s.borrowed(t.id)) continue;
    const allowed = s.secondDoctrineAllowed(t.id);
    if (!allowed && !b.secondDoctrines[t.id]) continue;
    out[t.id] = { allowed, ...s.secondDoctrineInfo(t.id) };
  }
  return out;
}

/** Reachability: Target Designators available (0 under Blackout) and how many hold a live enemy. */
function designators(w: WorldImpl): NonNullable<UiState['designators']> {
  if (trialActive(w, 'blackout')) return { slots: 0, live: 0 };
  const t = w.tower, two = secondDesignatorAllowed(w);
  const live = (i: number, g: number): number => (i >= 0 && w.alive(i) && w.enemies.gen[i] === g ? 1 : 0);
  return { slots: two ? 2 : 1, live: live(t.designated, t.designatedGen) + (two ? live(t.designated2, t.designated2Gen) : 0) };
}

/** Reachability: hardpoints a slot picker must not offer (the Frame's free mount, Trial rules), with the reason. */
function mountBlocked(w: WorldImpl): NonNullable<UiState['mountBlocked']> {
  const out: NonNullable<UiState['mountBlocked']> = {};
  const free = frameDef(w.build.frame).freeMount;
  for (const s of SYSTEM_ORDER_IDS) {
    if (s === 'primary') continue;
    if (trialForbidsMount(w, s)) out[s] = 'Not allowed in this Trial';
    else if (free === s) out[s] = 'Mounted free by your Frame';
  }
  return out;
}
