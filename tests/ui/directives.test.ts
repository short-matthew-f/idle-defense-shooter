import { describe, expect, it } from 'vitest';
import type { Directive } from '../../src/sim/core/types';
import {
  ACT_KINDS, COND_KINDS, defaultAction, defaultCondition, describeDirective, directiveSlots, moveItem,
  parseDirectives, serializeDirectives, validateDirective,
} from '../../src/ui/directive-model';

describe('directive model', () => {
  it('round-trips every condition and action variant', () => {
    const list: Directive[] = [];
    for (const c of COND_KINDS) for (const a of ACT_KINDS) list.push({ enabled: list.length % 2 === 0, conditions: [defaultCondition(c)], action: defaultAction(a) });
    const back = parseDirectives(serializeDirectives(list));
    expect(back.length).toBe(Math.min(12, list.length));
    expect(back).toEqual(list.slice(0, 12));
    // every variant individually survives
    for (const c of COND_KINDS) {
      const d: Directive = { enabled: true, conditions: [defaultCondition(c), defaultCondition('ce_at_least')], action: defaultAction('mode') };
      expect(parseDirectives(serializeDirectives([d]))).toEqual([d]);
    }
    for (const a of ACT_KINDS) {
      const d: Directive = { enabled: false, conditions: [], action: defaultAction(a) };
      expect(parseDirectives(serializeDirectives([d]))).toEqual([d]);
    }
  });
  it('keeps edited params and sanitizes bad input', () => {
    const d: Directive = { enabled: true, conditions: [{ kind: 'group_at_least', n: 20, radius: 120 }, { kind: 'enemy_present', enemy: 'healer' }], action: { kind: 'cast', ability: 'bombardment', at: 'largest_group' } };
    expect(parseDirectives(serializeDirectives([d]))).toEqual([d]);
    const bad = validateDirective({ conditions: [{ kind: 'nope' }, { kind: 'tower_hp_below', pct: 500 }], action: { kind: 'cast', ability: 'zzz', at: 'moon' } });
    expect(bad).toEqual({ enabled: true, conditions: [{ kind: 'tower_hp_below', pct: 99 }], action: defaultAction('cast') });
    expect(validateDirective({ action: { kind: 'explode' } })).toBeNull();
    expect(parseDirectives('not json')).toEqual([]);
  });
  it('describes rules as sentences', () => {
    const d: Directive = { enabled: true, conditions: [{ kind: 'forecast_recommends' }, { kind: 'wave_is', which: 'ordinary' }], action: { kind: 'prestige' } };
    expect(describeDirective(d)).toBe('WHEN the Forecast recommends Prestige AND wave is ordinary → Prestige');
    expect(describeDirective({ enabled: true, conditions: [{ kind: 'inner_ring_at_least', n: 5 }], action: { kind: 'cast', ability: 'repulsor_pulse', at: 'tower' } }))
      .toBe('WHEN 5+ enemies in the inner ring → Repulsor Pulse at tower');
  });
  it('reorders and counts slots', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(directiveSlots(0)).toBe(0);
    expect(directiveSlots(1)).toBe(3);
    expect(directiveSlots(10)).toBe(12);
  });
});
