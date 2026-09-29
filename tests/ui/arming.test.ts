import { describe, expect, it } from 'vitest';
import { AbilityArming } from '../../src/ui/arming';

describe('ability arming', () => {
  it('arms a point ability then casts on field tap', () => {
    const a = new AbilityArming();
    const r = a.press(0, { ability: 'bombardment', ready: true, targeted: 'point' });
    expect(r).toEqual({ kind: 'armed', slot: 0, ability: 'bombardment' });
    expect(a.armed).toBe(true);
    const c = a.tapField(10, -20, null);
    expect(c).toEqual({ kind: 'command', cmd: { type: 'cast', ability: 'bombardment', x: 10, y: -20 } });
    expect(a.armed).toBe(false);
  });
  it('targets the tapped enemy when armed', () => {
    const a = new AbilityArming();
    a.press(1, { ability: 'hunter_mark', ready: true, targeted: 'enemy' });
    expect(a.tapField(1, 2, 7)).toEqual({ kind: 'command', cmd: { type: 'cast', ability: 'hunter_mark', x: 1, y: 2, target: 7 } });
  });
  it('casts self abilities immediately', () => {
    const a = new AbilityArming();
    const r = a.press(0, { ability: 'repulsor_pulse', ready: true, targeted: 'self' });
    expect(r).toEqual({ kind: 'command', cmd: { type: 'cast', ability: 'repulsor_pulse', x: 0, y: 0 } });
    expect(a.armed).toBe(false);
  });
  it('refuses when not ready or empty; toggles off on second press', () => {
    const a = new AbilityArming();
    expect(a.press(0, { ability: 'emp', ready: false, targeted: 'point' })).toEqual({ kind: 'none', reason: 'not_ready' });
    expect(a.press(0, { ability: null, ready: true, targeted: 'point' })).toEqual({ kind: 'none', reason: 'empty' });
    a.press(2, { ability: 'time_field', ready: true, targeted: 'point' });
    expect(a.press(2, { ability: 'time_field', ready: true, targeted: 'point' })).toEqual({ kind: 'disarmed' });
    expect(a.armed).toBe(false);
  });
  it('switches the armed slot', () => {
    const a = new AbilityArming();
    a.press(0, { ability: 'time_field', ready: true, targeted: 'point' });
    a.press(1, { ability: 'bombardment', ready: true, targeted: 'point' });
    expect(a.slot).toBe(1);
    expect(a.ability).toBe('bombardment');
  });
  it('designates when idle and disarms when the slot changes', () => {
    const a = new AbilityArming();
    expect(a.tapField(0, 0, 3)).toEqual({ kind: 'command', cmd: { type: 'designate', enemy: 3 } });
    expect(a.tapField(0, 0, null)).toEqual({ kind: 'none' });
    a.press(0, { ability: 'time_field', ready: true, targeted: 'point' });
    expect(a.sync(['time_field', null])).toBe(false);
    expect(a.sync(['emp', null])).toBe(true);
    expect(a.armed).toBe(false);
  });
});
