/**
 * Command dispatch (applied at the start of each tick, in arrival order). Commands owned by later
 * work packages are offered to systems via System.onCommand; unclaimed ones are no-ops.
 */
import type { Command } from '../core/types';
import { Ev, NO_ENTITY } from '../core/types';
import type { RunMachine } from './machine';
import { purchase, chooseDoctrine, spendKey } from '../economy/shop';
import { allNodes } from '../core/content';
import { CORE_COSTS, REFIT_REFUND, offlineScrap } from '../economy/curves';
import { buyPrestigeNode, chooseDoctrineCmd, commandGuard, doPrestige, saveBlueprint, setThreatDial } from './prestige';   // WP8
import { endTrial, startTrial } from './trials';                                                                        // WP8
import { ascend, buyStar } from '../economy/ascension';                                                                 // WP8
import { abilitySlotCount, secondDesignatorAllowed, trialActive } from '../systems/abilities';   // WP9

/** Apply one command. Returns an error string (also stored in machine.lastError) or null. */
export function applyCommand(m: RunMachine, cmd: Command): string | null {
  const err = commandGuard(m.w, cmd) ?? dispatch(m, cmd);   // WP8: Trial mount rules
  m.lastError = err;
  return err;
}

function dispatch(m: RunMachine, cmd: Command): string | null {
  const w = m.w, run = w.run, b = w.build, t = w.tower;
  switch (cmd.type) {
    case 'buy': return purchase(w, cmd.node);
    case 'choose_doctrine': return chooseDoctrineCmd(w, cmd.tree, cmd.doctrine, cmd.second);   // WP8: explicit second doctrine
    case 'mount_hardpoint': {
      if (cmd.slot < 0 || cmd.slot >= run.hardpointSlotsOpen) return 'Slot not open';
      if (b.hardpoints[cmd.slot]) return 'Slot occupied (Refit instead)';
      if (w.stats.mounted(cmd.system)) return 'Already mounted';
      b.hardpoints[cmd.slot] = cmd.system;
      w.emit(Ev.Mounted, cmd.system, cmd.slot, 0, 0, 0, -1);
      w.rebuildStats();
      return null;
    }
    case 'refit_hardpoint': {
      const old = b.hardpoints[cmd.slot];
      if (cmd.slot < 0 || cmd.slot >= run.hardpointSlotsOpen || !old) return 'Nothing to refit';
      if (old === cmd.system || w.stats.mounted(cmd.system)) return 'Already mounted';
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
    case 'reroll_anomaly': return m.rerollDraft();
    case 'set_mode': m.setMode(cmd.mode); return null;
    case 'restart_checkpoint': m.startAttempt(true); return null;
    case 'set_speed': {
      if (cmd.speed !== 1 && run.wave > w.meta.deepestEver) return 'Speed controls only on solved waves';
      run.speedMultiplier = cmd.speed;
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
      for (const s of w.systems) s.onCommand?.(w, cmd);   // WP5: observers (boss Counters) see designations
      return null;
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
      const long = (w.meta.prestigeRanks['prestige.long_patrol'] | 0) > 0;
      const s = offlineScrap(run.patrolScrapPerSecond, cmd.elapsedSeconds, long);
      if (s > 0) { run.scrap += s; w.emit(Ev.ScrapGain, 'offline', Math.floor(cmd.elapsedSeconds), s, 0, 0, -1); }
      return null;
    }
    case 'set_setting': (w.meta.settings as Record<string, number | boolean>)[cmd.key] = cmd.value; return null;
    // --- WP8: progression (run/prestige.ts, run/trials.ts, economy/ascension.ts) ---
    case 'save_blueprint': return saveBlueprint(w, cmd.blueprint);
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
