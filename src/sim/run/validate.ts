/**
 * Shape validation for Commands (code-health pass). Commands arrive from the UI, Directives, the
 * headless agents, and (indirectly) from saves and devtools, so a malformed one must be rejected
 * with an error string instead of throwing inside Sim.step or writing NaN / junk keys into the build.
 * This checks shape only (types, finiteness, integer slots, known enum members); game rules
 * (costs, slots open, unlocks) stay in the command handlers.
 */
import type { Command } from '../core/types';

const HARDPOINTS: readonly string[] = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];
const ELEMENTS: readonly string[] = ['fire', 'lightning', 'poison', 'frost'];
const WEAPONS: readonly string[] = ['primary', ...HARDPOINTS];
const PROFILES: readonly string[] = ['nearest', 'closest_to_tower', 'lowest_hp', 'highest_hp', 'elites', 'support', 'fastest', 'designated'];
const MODES: readonly string[] = ['push', 'patrol'];
const SETTINGS: Readonly<Record<string, 'number' | 'boolean'>> = { clarity: 'number', autoPrestige: 'boolean', autocastOff: 'number' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): boolean => typeof v === 'string' && v.length > 0 && v.length <= 128;
const fin = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v);
const optInt = (v: unknown): boolean => v === undefined || int(v);
const optFin = (v: unknown): boolean => v === undefined || fin(v);
const optBool = (v: unknown): boolean => v === undefined || typeof v === 'boolean';
const optSlot01 = (v: unknown): boolean => v === undefined || v === 0 || v === 1;
/** Bulk-buy rank count: an integer 0..1000 (0 = Max). */
const bulkCount = (v: unknown): boolean => int(v) && (v as number) >= 0 && (v as number) <= 1000;
const oneOf = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);

/** Null when `cmd` is a well-formed Command, else a short reason ("Malformed command: ..."). */
export function validateCommand(cmd: unknown): string | null {
  if (!isObj(cmd) || typeof cmd.type !== 'string') return 'Malformed command';
  const c = cmd;
  const bad = (what: string): string => `Malformed command: ${String(c.type)}.${what}`;
  switch (c.type as Command['type']) {
    case 'buy': return !str(c.node) ? bad('node') : c.count === undefined || bulkCount(c.count) ? null : bad('count');
    case 'buy_cheapest': return !str(c.tree) ? bad('tree') : bulkCount(c.count) ? null : bad('count');
    case 'buy_prestige': case 'buy_star': return str(c.node) ? null : bad('node');
    case 'choose_doctrine': return !str(c.tree) ? bad('tree') : !str(c.doctrine) ? bad('doctrine') : optBool(c.second) ? null : bad('second');
    case 'mount_hardpoint': case 'refit_hardpoint': return !int(c.slot) ? bad('slot') : oneOf(HARDPOINTS, c.system) ? null : bad('system');
    case 'attune': return !int(c.slot) ? bad('slot') : oneOf(ELEMENTS, c.element) ? null : bad('element');
    case 'pick_anomaly': return !(c.anomaly === null || str(c.anomaly)) ? bad('anomaly') : optInt(c.replace) ? null : bad('replace');
    case 'reroll_anomaly': case 'restart_checkpoint': case 'ascend': case 'end_trial': return null;
    case 'set_mode': return oneOf(MODES, c.mode) ? null : bad('mode');
    case 'set_speed': return c.speed === 1 || c.speed === 2 || c.speed === 4 || c.speed === 8 ? null : bad('speed');
    case 'designate': return !(c.enemy === null || int(c.enemy)) ? bad('enemy') : !optSlot01(c.slot) ? bad('slot') : optBool(c.viaDirective) ? null : bad('viaDirective');
    case 'designate_at': return !fin(c.x) || !fin(c.y) ? bad('x/y') : optSlot01(c.slot) ? null : bad('slot');
    case 'manual_aim': return typeof c.active !== 'boolean' ? bad('active') : fin(c.angle) ? null : bad('angle');
    case 'cast':
      if (!str(c.ability)) return bad('ability');
      if (!fin(c.x) || !fin(c.y)) return bad('x/y');
      return optInt(c.target) && optInt(c.directive) && optBool(c.viaDirective) ? null : bad('target');
    case 'set_ability_slot': return !int(c.slot) ? bad('slot') : c.ability === null || str(c.ability) ? null : bad('ability');
    case 'set_targeting': return !oneOf(WEAPONS, c.system) ? bad('system') : oneOf(PROFILES, c.profile) ? null : bad('profile');
    case 'prestige':
      if (!str(c.frame)) return bad('frame');
      if (!optInt(c.blueprint) || !optFin(c.threatDial)) return bad('blueprint/threatDial');
      return (c.keepsake === undefined || str(c.keepsake)) && (c.discountTree === undefined || str(c.discountTree)) ? null : bad('keepsake/discountTree');
    case 'set_directives': return Array.isArray(c.directives) ? null : bad('directives');
    case 'set_upgrade_queue': return Array.isArray(c.rules) ? null : bad('rules');
    case 'save_blueprint': {
      const b = c.blueprint;
      if (!isObj(b) || !str(b.name) || !str(b.frame)) return bad('blueprint');
      if (!Array.isArray(b.hardpoints) || !Array.isArray(b.attunements) || !Array.isArray(b.upgradeQueue)) return bad('blueprint');
      return isObj(b.doctrines) && isObj(b.targeting) ? null : bad('blueprint');
    }
    case 'start_trial': return str(c.trial) ? null : bad('trial');
    // Reachability additions
    case 'clear_second_doctrine': return str(c.tree) ? null : bad('tree');
    case 'delete_blueprint': return int(c.index) ? null : bad('index');
    case 'set_threat_dial': return fin(c.level) ? null : bad('level');
    case 'offline_return': return fin(c.elapsedSeconds) && (c.elapsedSeconds as number) >= 0 ? null : bad('elapsedSeconds');
    // Boons: player-only. A command claiming to come from a Directive / Autocast is rejected outright.
    case 'pick_boon':
      if (c.viaDirective !== undefined || c.directive !== undefined) return 'Boons are picked by the player only';
      if (!str(c.boon)) return bad('boon');
      return c.replace === undefined || str(c.replace) ? null : bad('replace');
    case 'reroll_boon': case 'decline_boon':
      return c.viaDirective !== undefined || c.directive !== undefined ? 'Boons are picked by the player only' : null;
    case 'set_setting': {
      const kind = typeof c.key === 'string' && Object.prototype.hasOwnProperty.call(SETTINGS, c.key) ? SETTINGS[c.key] : undefined;
      if (!kind) return bad('key');
      if (c.key === 'autocastOff') return int(c.value) && (c.value as number) >= 0 && (c.value as number) < 0x40000000 ? null : bad('value');   // bitmask
      return kind === 'number' ? (fin(c.value) ? null : bad('value')) : typeof c.value === 'boolean' ? null : bad('value');
    }
    default: return `Unknown command ${String(c.type)}`;
  }
}
