/**
 * The attention plan (src/ui/attention.ts) and the pieces it orders: the boss-clear summary (feed.ts), the Frontier lines
 * (forecast.ts, death.ts) and the stalemate cause (death.ts).
 */
import { describe, it, expect } from 'vitest';
import { CELEBRATE_MS, CLEAR_COACH_MS, DEATH_FIRST_MS, coachHeld, liveBoss, planAttention, type AttnInput } from '../../src/ui/attention';
import { summaryText } from '../../src/ui/feed';
import { frontierNear, frontierText, pastFrontier } from '../../src/ui/forecast';
import { frontierLine, stalemateOf } from '../../src/ui/death';
import type { UiState } from '../../src/sim/core/types';

const base: AttnInput = { now: 100000, deathShownAt: null, deathWantFull: false, bossClearAt: -Infinity, draftWaiting: false, offerPending: false, liveBoss: false };
const plan = (x: Partial<AttnInput>) => planAttention({ ...base, ...x });

describe('attention plan', () => {
  it('death first: the card owns the lane for DEATH_FIRST_MS; the start offer waits as its chip', () => {
    const p = plan({ deathShownAt: base.now - 1000, offerPending: true });
    expect(p).toMatchObject({ deathFirst: true, offerHeld: true, coachHeld: true, hintsHeld: true, decision: null });
    const later = plan({ deathShownAt: base.now - DEATH_FIRST_MS - 1, offerPending: true });
    expect(later).toMatchObject({ deathFirst: false, offerHeld: false, decision: 'boon' });
    // the player unfolded the card: it keeps the lane past the window (unfolding always shows the buys)
    expect(plan({ deathShownAt: base.now - 30000, deathWantFull: true, offerPending: true }).offerHeld).toBe(true);
    // folded or dismissed (deathShownAt null): nothing held
    expect(plan({ offerPending: true }).offerHeld).toBe(false);
  });

  it('boss clear: one beat with no decision UI, then one decision at a time (draft first, then boon)', () => {
    const beat = plan({ bossClearAt: base.now - 500, draftWaiting: true, offerPending: true });
    expect(beat).toMatchObject({ celebrate: true, decision: null, offerHeld: true, draftHeld: true, coachHeld: true, hintsHeld: true });
    const draft = plan({ bossClearAt: base.now - CELEBRATE_MS - 1, draftWaiting: true, offerPending: true });
    expect(draft).toMatchObject({ celebrate: false, decision: 'draft', offerHeld: true, draftHeld: false, coachHeld: true });
    const boon = plan({ bossClearAt: base.now - CELEBRATE_MS - 1, offerPending: true });
    expect(boon).toMatchObject({ decision: 'boon', offerHeld: false, coachHeld: true, hintsHeld: true });
    expect(plan({})).toMatchObject({ decision: null, coachHeld: false, hintsHeld: false });
    expect(CELEBRATE_MS).toBeGreaterThanOrEqual(1500);
    expect(CELEBRATE_MS).toBeLessThanOrEqual(2000);
  });

  it('coach lines wait for the queue, except the explainer of the decision on screen', () => {
    const boon = plan({ offerPending: true });
    expect(coachHeld(boon, 'boons')).toBe(false);
    expect(coachHeld(boon, 'abilities')).toBe(true);
    expect(coachHeld(plan({ draftWaiting: true }), 'anomalies')).toBe(false);
    expect(coachHeld(plan({ bossClearAt: base.now, offerPending: true }), 'boons')).toBe(true);   // not during the beat
    expect(coachHeld(plan({}), 'abilities')).toBe(false);
  });

  it('boss mode: the offer folds to its chip, the coach and hints are held', () => {
    expect(plan({ liveBoss: true, offerPending: true })).toMatchObject({ bossMode: true, offerHeld: true, coachHeld: true, hintsHeld: true, decision: null });
    const ui = (isBoss: boolean, phase: string, bossHp: number) => ({ wave: { isBoss, bossHp }, run: { phase } }) as unknown as UiState;
    expect(liveBoss(ui(true, 'combat', 10))).toBe(true);
    expect(liveBoss(ui(true, 'combat', 0))).toBe(false);
    expect(liveBoss(ui(true, 'between', 10))).toBe(false);
    expect(liveBoss(ui(false, 'combat', 10))).toBe(false);
  });
});

describe('boss-clear summary, Frontier, stalemate', () => {
  it('one summary line from the beat, duplicates dropped', () => {
    expect(summaryText(['Boss destroyed', 'Checkpoint: wave 10', '+1 Core', 'Hardpoint slot open', '+1 Core'])).toBe('Boss destroyed · Checkpoint: wave 10 · +1 Core · Hardpoint slot open');
  });

  it('the Frontier: near from frontier − 2, past it on the wave after, the Forecast line always', () => {
    const ui = (deepest: number, wave: number, frontier?: number) => ({ run: { deepestCleared: deepest, wave }, forecast: frontier === undefined ? null : { frontier, nextFrontier: frontier + 10 } }) as unknown as UiState;
    expect(frontierNear(ui(25, 26, 28))).toBe(false);
    expect(frontierNear(ui(26, 27, 28))).toBe(true);
    expect(frontierNear(ui(26, 27))).toBe(false);
    expect(pastFrontier(ui(28, 28, 28))).toBe(false);
    expect(pastFrontier(ui(28, 29, 28))).toBe(true);
    expect(frontierText(ui(3, 4, 28))).toBe('The Frontier: past wave 28 enemies harden fast. A Prestige moves it to wave 38.');
    expect(frontierText(ui(3, 4))).toBeNull();
    expect(frontierLine(ui(27, 28, 28))).toBe('Past wave 28 enemies harden fast. A Prestige pays here.');
    expect(frontierLine(ui(10, 11, 28))).toBeNull();
    // a death past the Frontier says why even when the run's deepest-cleared is far below it (N-15)
    expect(frontierLine(ui(10, 71, 60), 71)).toBe('Past wave 60 enemies harden fast. A Prestige pays here.');
    expect(frontierLine(ui(10, 50, 60), 50)).toBeNull();
  });

  it('stalemate: read from the death payload or the wave state when the sim provides it', () => {
    const ui = (stalled: 'boss' | 'wave' | null) => ({ wave: { stalled } }) as unknown as UiState;
    expect(stalemateOf(undefined, ui(null))).toBe(false);
    expect(stalemateOf(undefined, ui('wave'))).toBe(false);
    expect(stalemateOf({ stalled: 'boss' } as never, ui(null))).toBe(true);
    expect(stalemateOf(undefined, ui('boss'))).toBe(true);
  });

  it('holds coach lines and pointer rings after a boss clear until the summary toast has gone', () => {
    const p = planAttention({ ...base, bossClearAt: base.now - CELEBRATE_MS - 100 });
    expect(p.celebrate).toBe(false);
    expect(p.coachHeld).toBe(true);
    expect(p.hintsHeld).toBe(true);
    const later = planAttention({ ...base, bossClearAt: base.now - CLEAR_COACH_MS - 1 });
    expect(later.coachHeld).toBe(false);
    expect(later.hintsHeld).toBe(false);
  });
});
