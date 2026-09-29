/**
 * Attack registry (WP5): every attack-script id listed in data/bosses.ts maps to a function, a
 * cadence (seconds between uses while its phase is active) and a stable numeric code (the `a`
 * field of the attack's Ev.Fx event). Tells live in tells.ts and run on the tell loop instead.
 *
 * Synthesis attacks:
 *  - crown_synthesis   cycles through signature attacks of earlier bosses
 *  - graft_primary     the next non-tell attack of Deep Graft source A (graftSources(wave)[0])
 *  - graft_secondary   the same for source B
 */
import type { AttackFn } from './attacks-fire';
import type { BossCtrl } from './state';
import type { World } from '../../core/world';
import { FIRE_ATTACKS } from './attacks-fire';
import { SUMMON_ATTACKS } from './attacks-summon';
import { TELLS } from './tells';
import { TELL_COUNTERS } from '../../data/bosses';
import { bossDef } from '../../core/content';

const CROWN_SET = ['stomp_wave', 'siege_volley', 'lightning_strikes', 'summon_guards', 'grave_volley', 'long_lance'];

/** Next non-tell attack of a source boss for the current phase (cycling). */
function graftPick(w: World, c: BossCtrl, which: 0 | 1): string | null {
  const def = bossDef(which === 0 ? c.graftA : c.graftB, w.run.wave);
  const ph = def.phases[Math.min(c.phase, def.phases.length - 1)];
  let n = 0;
  for (const a of ph.attacks) if (TELL_COUNTERS[a] === undefined && ATTACKS[a] !== undefined && !a.startsWith('graft') && a !== 'crown_synthesis') n++;
  if (n === 0) return null;
  let k = which === 0 ? c.graftKA++ : c.graftKB++;
  k %= n;
  for (const a of ph.attacks) {
    if (TELL_COUNTERS[a] !== undefined || ATTACKS[a] === undefined || a.startsWith('graft') || a === 'crown_synthesis') continue;
    if (k-- === 0) return a;
  }
  return null;
}

const SYNTH_ATTACKS: Record<string, AttackFn> = {
  crown_synthesis(w, b, c, cause) { const a = CROWN_SET[c.cycle++ % CROWN_SET.length]; ATTACKS[a](w, b, c, cause); },
  graft_primary(w, b, c, cause) { const a = graftPick(w, c, 0); if (a) ATTACKS[a](w, b, c, cause); },
  graft_secondary(w, b, c, cause) { const a = graftPick(w, c, 1); if (a) ATTACKS[a](w, b, c, cause); },
};

export const ATTACKS: Record<string, AttackFn> = { ...FIRE_ATTACKS, ...SUMMON_ATTACKS, ...SYNTH_ATTACKS };

/** Seconds between uses of each non-tell attack. */
export const CADENCE: Record<string, number> = {
  stomp_wave: 6, charge: 9, spawn_brood: 7, acid_spit: 5, shield_pulse: 8, summon_guards: 14,
  siege_volley: 5, deploy_turrets: 16, armor_shed: 10, devour: 8, grind: 4, spawn_clones: 12, mirror_volley: 5,
  lightning_strikes: 4, storm_orbit: 9, long_lance: 4, escort_call: 15, sanctify: 10, drain_shield: 5,
  spawn_leeches: 12, fragment_burst: 6, reform: 9, null_field: 6, node_beam: 5, time_burst: 5, rewind: 12,
  accelerate_adds: 11, spawn_wave: 9, fortify: 14, afterburn_trail: 6, dash: 5, raise_elites: 14,
  grave_volley: 5, bend_projectiles: 9, drag_drones: 10, collapse: 12, raise_barrier: 13, corridor_shift: 9,
  shield_generators: 10, choir_beam: 6, elite_gauntlet: 16, rally: 12, crown_synthesis: 5,
  graft_primary: 6, graft_secondary: 7,
};

/** Stable codes: tells first (TELL_COUNTERS order + graft_tell), then ATTACKS in declaration order. */
export const ATTACK_IDS: string[] = [...Object.keys(TELL_COUNTERS), 'graft_tell', ...Object.keys(ATTACKS)];
const CODE = new Map<string, number>(ATTACK_IDS.map((id, i) => [id, i]));
export function attackCode(id: string): number { return CODE.get(id) ?? -1; }

export function isTell(id: string): boolean { return TELL_COUNTERS[id] !== undefined || id === 'graft_tell'; }

export { TELLS };
