import { describe, expect, it } from 'vitest';
import type { AbilityId } from '../../src/sim/core/ids';
import { bossForWave } from '../../src/sim/data/bosses';
import { equipTarget, preBossInfo, preBossKey, tellDecision } from '../../src/ui/tells';
import { tellPrompt } from '../../src/ui/hud';
import { backOnModal } from '../../src/ui/modal';

const A = (x: string) => x as AbilityId;
const BOMB = A('bombardment'), REP = A('repulsor_pulse'), EMP = A('emp');

describe('tell decision', () => {
  it('is information only before abilities are revealed', () => {
    expect(tellDecision({ revealed: false, counter: BOMB, slots: [null, null] })).toBe('info');
    expect(tellDecision({ revealed: false, counter: BOMB, slots: [BOMB, null] })).toBe('info');
  });
  it('casts when slotted, equips into an empty slot, else asks before replacing', () => {
    expect(tellDecision({ revealed: true, counter: BOMB, slots: [REP, BOMB] })).toBe('cast');
    expect(tellDecision({ revealed: true, counter: BOMB, slots: [REP, null] })).toBe('equip-empty');
    expect(tellDecision({ revealed: true, counter: BOMB, slots: [REP, EMP] })).toBe('confirm-replace');
  });
  it('ignores inactive slots (beyond abilitySlots)', () => {
    expect(tellDecision({ revealed: true, counter: BOMB, slots: [REP, EMP, BOMB], usable: 2 })).toBe('confirm-replace');
    expect(tellDecision({ revealed: true, counter: BOMB, slots: [REP, EMP, null], usable: 2 })).toBe('confirm-replace');
    expect(equipTarget({ slots: [REP, null, null], usable: 2 })).toEqual({ slot: 1, replaces: null });
    expect(equipTarget({ slots: [REP, EMP] })).toEqual({ slot: 0, replaces: REP });
  });
  it('the banner text follows the decision', () => {
    const ui = (abs: (AbilityId | null)[]) => ({ build: { abilities: abs }, abilities: [], tower: { ce: 0 } }) as unknown as Parameters<typeof tellPrompt>[1];
    expect(tellPrompt(BOMB, ui([null, null]), false)).toEqual({ text: 'abilities unlock at wave 12', action: 'info' });
    expect(tellPrompt(BOMB, ui([REP, EMP]), true).action).toBe('equip');
  });
});

describe('pre-boss card', () => {
  const base = { phase: 'between', wave: 10, attempts: 1, revealed: true, bossFor: bossForWave, handled: null as string | null, slots: [REP, EMP] as (AbilityId | null)[] };
  it('shows before a boss wave when the counter is not slotted', () => {
    const c = preBossInfo(base);
    expect(c).toMatchObject({ bossName: 'Broodheart', ability: BOMB, slot: 0, replaces: REP });
    expect(preBossInfo({ ...base, slots: [REP, null] })).toMatchObject({ slot: 1, replaces: null });
  });
  it('stays away otherwise', () => {
    expect(preBossInfo({ ...base, revealed: false })).toBeNull();
    expect(preBossInfo({ ...base, phase: 'combat' })).toBeNull();
    expect(preBossInfo({ ...base, wave: 11 })).toBeNull();
    expect(preBossInfo({ ...base, slots: [BOMB, EMP] })).toBeNull();
    expect(preBossInfo({ ...base, handled: preBossKey(1, 10) })).toBeNull();
    expect(preBossInfo({ ...base, handled: preBossKey(0, 10) })).not.toBeNull();   // a new attempt shows it again
    expect(preBossInfo({ ...base, wave: 25 })).toBeNull();                          // Iron Maw: designate, no ability to equip
  });
});

describe('Back with a dialog open', () => {
  it('navigates only with no dialog; closes a dismissable one; ignores Back for a locked one', () => {
    expect(backOnModal(false, true)).toBe('navigate');
    expect(backOnModal(true, true)).toBe('close');
    expect(backOnModal(true, false)).toBe('stay');
  });
});
