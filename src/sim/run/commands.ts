/**
 * Command dispatch (applied at the start of each tick, in arrival order). Commands owned by later
 * work packages are offered to systems via System.onCommand; unclaimed ones are no-ops.
 */
import type { Command } from '../core/types';
import { EnemyFlag, Ev, NO_ENTITY } from '../core/types';
import type { WorldImpl } from '../core/world-impl';
import type { RunMachine } from './machine';
import type { DoctrineId, TreeId } from '../core/ids';
import { doctrineChoice, purchaseCheapest, purchaseMany, spendKey } from '../economy/shop';
import { validateCommand } from './validate';
import { allNodes } from '../core/content';
import { CORE_COSTS, REFIT_REFUND, offlineScrap } from '../economy/curves';
import { buyPrestigeNode, chooseDoctrineCmd, commandGuard, doPrestige, saveBlueprint, setThreatDial } from './prestige';   // WP8
import { endTrial, startTrial } from './trials';                                                                        // WP8
import { ascend, buyStar } from '../economy/ascension';                                                                 // WP8
import { abilitySlotCount, secondDesignatorAllowed, trialActive } from '../systems/abilities';   // WP9
import { allowedSpeed } from '../economy/prestige';
import { declineBoon, pickBoon, rerollBoon } from './boons';   // Boons (player-only; see Sim.step)

/**
 * Apply one command. Returns an error string (also stored in machine.lastError) or null.
 * Malformed commands (corrupted saves, devtools, UI bugs) are rejected by shape validation first, and
 * a handler that still throws is reported as an error instead of aborting the tick.
 */
export function applyCommand(m: RunMachine, cmd: Command): string | null {
  let err = validateCommand(cmd);
  if (err === null) {
    try { err = commandGuard(m.w, cmd) ?? dispatch(m, cmd); }   // WP8: Trial mount rules
    catch (e) { err = `Command ${cmd.type} failed: ${e instanceof Error ? e.message : String(e)}`; }
  }
  m.lastError = err;
  return err;
}

function dispatch(m: RunMachine, cmd: Command): string | null {
  const w = m.w, run = w.run, b = w.build, t = w.tower;
  switch (cmd.type) {
    case 'buy': return purchaseMany(w, cmd.node, cmd.count);          // count 0 = Max (bulk buying)
    case 'buy_cheapest': return purchaseCheapest(w, cmd.tree, cmd.count);
    case 'choose_doctrine':
      // Reachability: `second: true` with a second Doctrine already chosen changes it (same rule as changing the first)
      if (cmd.second && b.doctrines[cmd.tree] && b.secondDoctrines[cmd.tree]) return changeSecondDoctrine(m, cmd.tree, cmd.doctrine);
      return chooseDoctrineCmd(w, cmd.tree, cmd.doctrine, cmd.second);   // WP8: explicit second doctrine
    case 'clear_second_doctrine': return clearSecondDoctrine(m, cmd.tree);   // Reachability: frees Dual Doctrine for another tree
    case 'mount_hardpoint': {
      if (cmd.slot < 0 || cmd.slot >= run.hardpointSlotsOpen) return 'Slot not open';
      if (b.hardpoints[cmd.slot]) return 'Slot occupied (Refit instead)';
      // Reachability: a Borrowed Blade (tier 1, no slot) may be mounted properly; it then runs with its full tree
      if (w.stats.mounted(cmd.system) && !w.stats.borrowed(cmd.system)) return 'Already mounted';
      b.hardpoints[cmd.slot] = cmd.system;
      w.emit(Ev.Mounted, cmd.system, cmd.slot, 0, 0, 0, -1);
      w.rebuildStats();
      return null;
    }
    case 'refit_hardpoint': {
      const old = b.hardpoints[cmd.slot];
      if (cmd.slot < 0 || cmd.slot >= run.hardpointSlotsOpen || !old) return 'Nothing to refit';
      if (old === cmd.system || (w.stats.mounted(cmd.system) && !w.stats.borrowed(cmd.system))) return 'Already mounted';
      if (run.cores < CORE_COSTS.refit) return 'Not enough Cores';
      run.cores -= CORE_COSTS.refit;
      const refund = Math.floor((run.spentByTree[old] ?? 0) * REFIT_REFUND);
      run.scrap += refund;
      run.spentByTree[old] = 0;
      for (const info of allNodes()) {
        if (info.group === 'prestige' || info.group === 'star' || info.group === 'fusion' || info.group === 'triad' || info.group === 'ability') continue;
        if (spendKey(info) === old || (info.pair && (info.pair[0] === old || info.pair[1] === old))) delete b.ranks[info.def.id];
      }
      delete b.doctrines[old]; delete b.secondDoctrines[old];
      b.hardpoints[cmd.slot] = cmd.system;
      w.emit(Ev.Mounted, cmd.system, cmd.slot, refund, 0, 0, -1);
      w.rebuildStats();
      return null;
    }
    case 'attune': {
      if (cmd.slot < 0 || cmd.slot >= run.attunementSlotsOpen) return 'Slot not open';
      if (b.attunements[cmd.slot]) return 'Slot occupied';
      if (w.stats.attuned(cmd.element)) return 'Already attuned';
      b.attunements[cmd.slot] = cmd.element;
      w.emit(Ev.Attuned, cmd.element, cmd.slot, 0, 0, 0, -1);
      w.rebuildStats();
      return null;
    }
    case 'pick_anomaly': return m.pickAnomaly(cmd.anomaly, cmd.replace);
    case 'pick_boon': return pickBoon(w, cmd.boon, cmd.replace);
    case 'reroll_boon': return rerollBoon(w);
    case 'decline_boon': return declineBoon(w);
    case 'reroll_anomaly': return m.rerollDraft();
    case 'set_mode': m.setMode(cmd.mode); return null;
    case 'restart_checkpoint': m.startAttempt(true); return null;
    case 'set_speed': {
      // Manual ×2..×8 needs Speed Controls (Prestige III) and a solved wave; Accelerated Clearing's
      // automatic speed (applied at wave start by run/prestige.ts) may also be selected. ×1 is always allowed.
      const sp = cmd.speed;
      if (sp !== 1 && sp !== 2 && sp !== 4 && sp !== 8) return 'Invalid speed';
      if (sp !== 1 && run.wave > w.meta.deepestEver) return 'Speed controls only on solved waves';
      if (sp > allowedSpeed(run, w.meta)) return (w.meta.prestigeRanks['prestige.speed_controls'] | 0) > 0 ? `×${sp} needs a higher Speed Controls rank` : 'Manual speed needs Speed Controls (Prestige III)';
      run.speedMultiplier = sp;
      return null;
    }
    case 'designate': {
      const slot = cmd.slot ?? 0;
      if (trialActive(w, 'blackout')) return 'Designator disabled (Blackout)';                    // WP9
      if (slot === 1 && !secondDesignatorAllowed(w)) return 'No second designator';              // WP9
      const i = cmd.enemy === null ? NO_ENTITY : cmd.enemy;
      if (i !== NO_ENTITY && !w.alive(i)) return 'No such enemy';
      const gen = i >= 0 ? w.enemies.gen[i] : 0;
      if (slot === 1) { t.designated2 = i; t.designated2Gen = gen; } else { t.designated = i; t.designatedGen = gen; }
      if (i !== NO_ENTITY) t.designateNext = slot === 1 ? 0 : 1;   // Reachability: the other slot is now the older one
      for (const s of w.systems) s.onCommand?.(w, cmd);   // WP5: observers (boss Counters) see designations
      return null;
    }
    case 'designate_at': {
      const i = enemyAt(w, cmd.x, cmd.y);
      if (i === NO_ENTITY) return 'No enemy there';
      // Same path as 'designate' (Blackout / second-designator rules, onCommand observers such as boss Counters).
      if (cmd.slot !== undefined) return dispatch(m, { type: 'designate', enemy: i, slot: cmd.slot });
      const pick = autoDesignateSlot(w, i);   // Reachability: tap toggles / fills the free slot / replaces the older
      return dispatch(m, pick.clear ? { type: 'designate', enemy: null, slot: pick.slot } : pick.slot === 1 ? { type: 'designate', enemy: i, slot: 1 } : { type: 'designate', enemy: i });
    }
    case 'manual_aim': if (cmd.active && trialActive(w, 'blackout')) return 'Manual aim disabled (Blackout)'; t.manualAim = cmd.active; t.manualAngle = cmd.angle; return null;
    case 'set_ability_slot': {
      const slots = abilitySlotCount(w);                                                          // WP9
      if (cmd.slot < 0 || cmd.slot >= slots) return 'No such slot';
      while (b.abilities.length < slots) b.abilities.push(null);
      if (cmd.ability) for (let k = 0; k < b.abilities.length; k++) if (b.abilities[k] === cmd.ability) b.abilities[k] = null;
      b.abilities[cmd.slot] = cmd.ability;
      w.rebuildStats();
      return null;
    }
    case 'set_targeting': b.targeting[cmd.system] = cmd.profile; return null;
    case 'set_threat_dial': return setThreatDial(w, cmd.level);   // WP8: lower only; Echoes pay at the lowest level used
    case 'offline_return': {
      const long = { capHours: w.stats.get('offline.cap_hours'), efficiency: w.stats.get('offline.efficiency') };   // EFFECT-AUDIT: every Long Patrol rank counts
      const s = offlineScrap(run.patrolScrapPerSecond, cmd.elapsedSeconds, long);
      if (s > 0) { run.scrap += s; w.emit(Ev.ScrapGain, 'offline', Math.floor(cmd.elapsedSeconds), s, 0, 0, -1); }
      return null;
    }
    case 'set_setting': (w.meta.settings as Record<string, number | boolean>)[cmd.key] = cmd.value; return null;
    // --- WP8: progression (run/prestige.ts, run/trials.ts, economy/ascension.ts) ---
    case 'save_blueprint': return saveBlueprint(w, cmd.blueprint);
    case 'delete_blueprint': {   // Reachability: free a Blueprint slot
      if (cmd.index < 0 || cmd.index >= w.meta.blueprints.length) return 'No such blueprint';
      w.meta.blueprints.splice(cmd.index, 1);
      return null;
    }
    case 'prestige': return doPrestige(m, cmd);
    case 'ascend': return ascend(m);
    case 'buy_prestige': return buyPrestigeNode(w, cmd.node);
    case 'buy_star': return buyStar(w, cmd.node);
    case 'start_trial': return startTrial(m, cmd.trial);
    case 'end_trial': return endTrial(m);
    // --- Owned by later work packages: offered to systems (System.onCommand), otherwise no-ops ---
    case 'cast':               // WP9: systems/abilities.ts (observe-only: every system sees it)
    case 'set_directives':     // WP9: directives/engine.ts
    case 'set_upgrade_queue':  // WP9: directives/engine.ts (rules run by directives/upgrade-queue.ts)
      for (const s of w.systems) if (s.onCommand?.(w, cmd)) return null;
      return null;
    default: {
      const never: never = cmd;
      return `Unknown command ${(never as { type: string }).type}`;
    }
  }
}

/** Is designator `slot` holding a live enemy? */
function designationLive(w: WorldImpl, slot: 0 | 1): number {
  const t = w.tower, i = slot === 1 ? t.designated2 : t.designated, g = slot === 1 ? t.designated2Gen : t.designatedGen;
  return i >= 0 && w.alive(i) && w.enemies.gen[i] === g ? i : NO_ENTITY;
}

/**
 * Reachability: which designator slot a tap on enemy `i` uses (designate_at without a slot). Tapping a designated
 * enemy clears it, unless a boss tell asks for a designation (re-designating scores the Counter). Otherwise slot 0
 * when free, then slot 1 when a second designator is available, else the older of the two.
 */
export function autoDesignateSlot(w: WorldImpl, i: number): { slot: 0 | 1; clear: boolean } {
  const two = secondDesignatorAllowed(w);
  const d0 = designationLive(w, 0), d1 = two ? designationLive(w, 1) : NO_ENTITY;
  const tell = w.bossTell.ability === 'designate';
  if (i === d0) return { slot: 0, clear: !tell };
  if (i === d1) return { slot: 1, clear: !tell };
  if (!two || d0 === NO_ENTITY) return { slot: 0, clear: false };
  if (d1 === NO_ENTITY) return { slot: 1, clear: false };
  return { slot: w.tower.designateNext ?? 0, clear: false };
}

/** Between waves at the start of a checkpoint (the Doctrine-change rule of economy/shop.doctrineChoice). */
function atCheckpoint(w: WorldImpl): boolean { return w.run.phase === 'between' && w.run.wave - 1 === w.run.checkpoint; }

/** Reachability: change a chosen second Doctrine (1 Core, at a checkpoint, like changing the first). */
function changeSecondDoctrine(m: RunMachine, tree: TreeId, doctrine: DoctrineId): string | null {
  const w = m.w, b = w.build;
  if (!w.stats.secondDoctrineAllowed(tree)) return 'This tree cannot run a second Doctrine';
  const c = doctrineChoice(w, tree, doctrine);   // unknown / fork closed / already chosen / checkpoint rule, and the price
  if (c.locked) return c.locked;
  if (w.run.cores < c.cost) return 'Not enough Cores';
  w.run.cores -= c.cost;
  b.secondDoctrines[tree] = doctrine;
  w.emit(Ev.DoctrineChosen, `${tree}.${doctrine}`, c.cost, 2, 0, 0, -1);
  w.rebuildStats();
  return null;
}

/** Reachability: drop the second Doctrine of `tree` (1 Core, at a checkpoint), e.g. to move Dual Doctrine to another tree. */
function clearSecondDoctrine(m: RunMachine, tree: TreeId): string | null {
  const w = m.w, b = w.build;
  if (!b.secondDoctrines[tree]) return 'No second Doctrine to clear';
  if (!atCheckpoint(w)) return 'Change only at a checkpoint';
  if (w.run.cores < CORE_COSTS.doctrine) return 'Not enough Cores';
  w.run.cores -= CORE_COSTS.doctrine;
  delete b.secondDoctrines[tree];
  w.rebuildStats();
  return null;
}

/**
 * Live enemy nearest (x, y) whose center is within max(24, radius + 8) units, or NO_ENTITY.
 * Ties resolve to the lower pool index (ascending scan, strict comparison) so the pick is deterministic.
 */
export function enemyAt(w: WorldImpl, x: number, y: number): number {
  const e = w.enemies;
  let best = NO_ENTITY, bestD2 = Infinity;
  for (let i = 0; i < e.count; i++) {
    if (e.flags[i] & (EnemyFlag.Dead | EnemyFlag.Ally)) continue;
    const dx = e.x[i] - x, dy = e.y[i] - y, d2 = dx * dx + dy * dy;
    const reach = Math.max(24, e.radius[i] + 8);
    if (d2 <= reach * reach && d2 < bestD2) { best = i; bestD2 = d2; }
  }
  return best;
}
