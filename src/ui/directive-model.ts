/**
 * Directive editor model (pure): metadata for every DirectiveCondition / DirectiveAction variant,
 * defaults, human-readable sentences, validation and (de)serialization. The Record types below
 * are keyed by the unions in core/types.ts, so adding a variant there is a compile error here.
 */
import type { AbilityId, EnemyKind, TargetingProfile, WeaponSystemId, NodeId } from '@sim/core/ids';
import type { Directive, DirectiveAction, DirectiveCondition, UpgradeRule } from '@sim/core/types';
import { ABILITIES, SYSTEM_ORDER_IDS } from '@sim/data/index';
import { ENEMY_BY_KIND, KINDS } from '@sim/data/enemies';

export type CondKind = DirectiveCondition['kind'];
export type ActKind = DirectiveAction['kind'];

export interface ParamSpec {
  key: string;
  label: string;
  type: 'int' | 'pct' | 'enum';
  min?: number; max?: number; step?: number;
  options?: { value: string; label: string }[];
}

export const TARGETING_PROFILES: { value: TargetingProfile; label: string }[] = [
  { value: 'nearest', label: 'Nearest' }, { value: 'closest_to_tower', label: 'Closest to tower' },
  { value: 'lowest_hp', label: 'Lowest HP' }, { value: 'highest_hp', label: 'Highest HP' },
  { value: 'elites', label: 'Elites' }, { value: 'support', label: 'Support enemies' },
  { value: 'fastest', label: 'Fastest' }, { value: 'designated', label: 'Designated' },
];
export const SYSTEM_LABELS: Record<WeaponSystemId, string> = {
  primary: 'Primary', ordnance: 'Ordnance', drones: 'Drones', blade: 'Orbital Blade', laser: 'Laser Polygon', gravitics: 'Gravitics',
};
const SUB_UNITS = new Set<EnemyKind>(['splitter_fragment', 'brood', 'clump', 'boss_add', 'boss']);
export const ENEMY_OPTIONS: { value: string; label: string }[] = [
  { value: 'elite', label: 'Any elite' },
  ...KINDS.filter((k) => !SUB_UNITS.has(k)).map((k) => ({ value: k, label: ENEMY_BY_KIND[k]?.name ?? k })),
];
export const ABILITY_OPTIONS = ABILITIES.map((a) => ({ value: a.id, label: a.name }));
const SYSTEM_OPTIONS = SYSTEM_ORDER_IDS.map((s) => ({ value: s, label: SYSTEM_LABELS[s] }));

export interface CondMeta { label: string; params: ParamSpec[]; adept?: boolean; make(): DirectiveCondition }
export interface ActMeta { label: string; params: ParamSpec[]; autonomy?: boolean; make(): DirectiveAction }

export const CONDITIONS: Record<CondKind, CondMeta> = {
  inner_ring_at_least: { label: 'Enemies in inner ring ≥', params: [{ key: 'n', label: 'N', type: 'int', min: 1, max: 200 }], make: () => ({ kind: 'inner_ring_at_least', n: 5 }) },
  group_at_least: { label: 'Group of ≥ N within R', params: [{ key: 'n', label: 'N', type: 'int', min: 2, max: 500 }, { key: 'radius', label: 'R', type: 'int', min: 20, max: 300, step: 10 }], make: () => ({ kind: 'group_at_least', n: 12, radius: 80 }) },
  tower_hp_below: { label: 'Tower HP below', params: [{ key: 'pct', label: '%', type: 'pct', min: 1, max: 99 }], make: () => ({ kind: 'tower_hp_below', pct: 40 }) },
  barrier_broken: { label: 'Barrier broken', params: [], make: () => ({ kind: 'barrier_broken' }) },
  boss_phase: { label: 'Boss phase =', params: [{ key: 'phase', label: 'Phase', type: 'int', min: 1, max: 3 }], make: () => ({ kind: 'boss_phase', phase: 2 }) },
  boss_tell_active: { label: 'Boss tell active', params: [], adept: true, make: () => ({ kind: 'boss_tell_active' }) },
  enemy_present: { label: 'Enemy present', params: [{ key: 'enemy', label: 'Enemy', type: 'enum', options: ENEMY_OPTIONS }], make: () => ({ kind: 'enemy_present', enemy: 'elite' }) },
  ce_at_least: { label: 'Command Energy ≥', params: [{ key: 'ce', label: 'CE', type: 'int', min: 1, max: 300 }], make: () => ({ kind: 'ce_at_least', ce: 60 }) },
  wave_is: { label: 'Wave is', params: [{ key: 'which', label: 'Wave', type: 'enum', options: [{ value: 'boss', label: 'Boss' }, { value: 'ordinary', label: 'Ordinary' }] }], make: () => ({ kind: 'wave_is', which: 'boss' }) },
  forecast_recommends: { label: 'Forecast recommends Prestige', params: [], make: () => ({ kind: 'forecast_recommends' }) },
};

export const ACTIONS: Record<ActKind, ActMeta> = {
  cast: { label: 'Cast ability', params: [
    { key: 'ability', label: 'Ability', type: 'enum', options: ABILITY_OPTIONS },
    { key: 'at', label: 'At', type: 'enum', options: [{ value: 'largest_group', label: 'Largest group' }, { value: 'nearest_threat', label: 'Nearest threat' }, { value: 'boss', label: 'Boss' }, { value: 'tower', label: 'Tower' }] },
  ], make: () => ({ kind: 'cast', ability: 'repulsor_pulse', at: 'tower' }) },
  designate: { label: 'Designate', params: [
    { key: 'what', label: 'Target', type: 'enum', options: [{ value: 'highest_threat', label: 'Highest threat' }, { value: 'healer', label: 'A healer' }, { value: 'warden', label: 'A warden' }, { value: 'weak_point', label: 'Weak point' }, { value: 'nearest_kamikaze', label: 'Nearest kamikaze' }] },
  ], make: () => ({ kind: 'designate', what: 'highest_threat' }) },
  targeting: { label: 'Switch Targeting Profile', params: [
    { key: 'system', label: 'System', type: 'enum', options: SYSTEM_OPTIONS },
    { key: 'profile', label: 'Profile', type: 'enum', options: TARGETING_PROFILES },
  ], make: () => ({ kind: 'targeting', system: 'primary', profile: 'elites' }) },
  mode: { label: 'Switch mode', params: [{ key: 'mode', label: 'Mode', type: 'enum', options: [{ value: 'push', label: 'Push' }, { value: 'patrol', label: 'Patrol' }] }], make: () => ({ kind: 'mode', mode: 'patrol' }) },
  prestige: { label: 'Prestige', params: [], autonomy: true, make: () => ({ kind: 'prestige' }) },
};

export const COND_KINDS = Object.keys(CONDITIONS) as CondKind[];
export const ACT_KINDS = Object.keys(ACTIONS) as ActKind[];
export const MAX_CONDITIONS = 4;
export const MAX_RULES = 12;

export function defaultCondition(kind: CondKind): DirectiveCondition { return CONDITIONS[kind].make(); }
export function defaultAction(kind: ActKind): DirectiveAction { return ACTIONS[kind].make(); }
export function newDirective(): Directive {
  return { enabled: true, conditions: [defaultCondition('inner_ring_at_least')], action: defaultAction('cast') };
}

/** Rule slots from the Directives Prestige node: 3 at rank 1, +1 per further rank, max 12. */
export function directiveSlots(rank: number): number { return rank <= 0 ? 0 : Math.min(MAX_RULES, 2 + rank); }

function optLabel(p: ParamSpec | undefined, v: unknown): string {
  return p?.options?.find((o) => o.value === v)?.label ?? String(v);
}

export function describeCondition(c: DirectiveCondition): string {
  const m = CONDITIONS[c.kind];
  switch (c.kind) {
    case 'inner_ring_at_least': return `${c.n}+ enemies in the inner ring`;
    case 'group_at_least': return `a group of ${c.n}+ within ${c.radius}`;
    case 'tower_hp_below': return `tower HP < ${c.pct}%`;
    case 'barrier_broken': return 'the barrier is broken';
    case 'boss_phase': return `boss phase = ${c.phase}`;
    case 'boss_tell_active': return 'a boss tell is active';
    case 'enemy_present': return `${optLabel(m.params[0], c.enemy)} present`;
    case 'ce_at_least': return `CE ≥ ${c.ce}`;
    case 'wave_is': return `wave is ${c.which}`;
    case 'forecast_recommends': return 'the Forecast recommends Prestige';
  }
}

export function describeAction(a: DirectiveAction): string {
  switch (a.kind) {
    case 'cast': return `${ABILITIES.find((x) => x.id === a.ability)?.name ?? a.ability} at ${optLabel(ACTIONS.cast.params[1], a.at).toLowerCase()}`;
    case 'designate': return `designate ${optLabel(ACTIONS.designate.params[0], a.what).toLowerCase()}`;
    case 'targeting': return `${SYSTEM_LABELS[a.system]} targets ${optLabel(ACTIONS.targeting.params[1], a.profile).toLowerCase()}`;
    case 'mode': return a.mode === 'push' ? 'switch to Push' : 'switch to Patrol';
    case 'prestige': return 'Prestige';
  }
}

export function describeDirective(d: Directive): string {
  const when = d.conditions.length ? d.conditions.map(describeCondition).join(' AND ') : 'always';
  return `WHEN ${when} → ${describeAction(d.action)}`;
}

function clampInt(v: unknown, p: ParamSpec, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, n));
}

/** Sanitize a param bag against a spec, falling back to `base` values. */
function sanitize<T extends { kind: string }>(raw: Record<string, unknown>, spec: ParamSpec[], base: T): T {
  const out: Record<string, unknown> = { ...base };
  for (const p of spec) {
    const v = raw[p.key];
    if (p.type === 'enum') out[p.key] = p.options?.some((o) => o.value === v) ? v : (base as Record<string, unknown>)[p.key];
    else out[p.key] = clampInt(v, p, (base as Record<string, unknown>)[p.key] as number);
  }
  return out as T;
}

export function validateCondition(raw: unknown): DirectiveCondition | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind as CondKind;
  if (!(kind in CONDITIONS)) return null;
  return sanitize(r, CONDITIONS[kind].params, defaultCondition(kind));
}

export function validateAction(raw: unknown): DirectiveAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind as ActKind;
  if (!(kind in ACTIONS)) return null;
  return sanitize(r, ACTIONS[kind].params, defaultAction(kind));
}

export function validateDirective(raw: unknown): Directive | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const action = validateAction(r.action);
  if (!action) return null;
  const conds = Array.isArray(r.conditions) ? r.conditions.map(validateCondition).filter((c): c is DirectiveCondition => c !== null) : [];
  return { enabled: r.enabled !== false, conditions: conds.slice(0, MAX_CONDITIONS), action };
}

/** Directive list ↔ compact JSON (copy/paste between saves, and the editor's dirty check). */
export function serializeDirectives(list: readonly Directive[]): string {
  return JSON.stringify(list.map((d) => ({ enabled: d.enabled, conditions: d.conditions, action: d.action })));
}
export function parseDirectives(text: string): Directive[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.map(validateDirective).filter((d): d is Directive => d !== null).slice(0, MAX_RULES);
}

/** Move item i by delta (−1 up, +1 down); returns a new array. */
export function moveItem<T>(list: readonly T[], i: number, delta: number): T[] {
  const j = i + delta;
  const out = list.slice();
  if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
  const [x] = out.splice(i, 1);
  out.splice(j, 0, x);
  return out;
}

export function describeUpgradeRule(r: UpgradeRule, name: (id: NodeId) => string): string {
  let s = `Buy ${name(r.node)}`;
  if (r.maxRank !== undefined) s += ` up to rank ${r.maxRank}`;
  if (r.keepWithin) s += `, within ${r.keepWithin.ranks} ranks of ${name(r.keepWithin.of)}`;
  return s;
}

export type { AbilityId };
