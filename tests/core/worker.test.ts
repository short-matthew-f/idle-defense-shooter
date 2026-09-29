/**
 * Worker protocol: cmd_error for rejected player commands, and fault tolerance (a throwing step()
 * posts `error` once, keeps serving the last good snapshot, then recovers by restarting the checkpoint).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { FromWorker, ToWorker } from '../../src/sim/core/types';
import { Sim } from '../../src/sim/index';

const posted: FromWorker[] = [];
const fakeSelf = { postMessage: (m: FromWorker) => { posted.push(m); }, onmessage: null as null | ((ev: { data: ToWorker }) => void) };
const send = (m: ToWorker): void => fakeSelf.onmessage!({ data: m });
const of = <T extends FromWorker['t']>(t: T): Extract<FromWorker, { t: T }>[] => posted.filter((m) => m.t === t) as Extract<FromWorker, { t: T }>[];

describe('sim worker', () => {
  beforeAll(async () => {
    vi.stubGlobal('self', fakeSelf);
    await import('../../src/worker/sim.worker');
  });

  it('posts cmd_error for a rejected player command', () => {
    send({ t: 'init', save: null, seedOverride: 3 });
    expect(of('ready').length).toBe(1);
    send({ t: 'cmd', cmd: { type: 'buy', node: 'ballistics.damage' } });
    send({ t: 'tick_budget', ticks: 2 });
    const errs = of('cmd_error');
    expect(errs.length).toBe(1);
    expect(errs[0].cmd).toBe('buy');
    expect(errs[0].message).toMatch(/scrap/i);
  });

  it('survives a throwing step: one error, last good snapshot, recovery by restarting the checkpoint', () => {
    send({ t: 'tick_budget', ticks: 60 });
    const goodSnaps = of('snapshot').length;
    expect(goodSnaps).toBeGreaterThan(0);
    const orig = Sim.prototype.step;
    let fail = 3;
    const spy = vi.spyOn(Sim.prototype, 'step').mockImplementation(function (this: Sim) {
      if (fail-- > 0) throw new Error('boom');
      return orig.call(this);
    });
    posted.length = 0;
    send({ t: 'tick_budget', ticks: 10 });   // step throws → faulted
    send({ t: 'tick_budget', ticks: 10 });   // recovery step throws again (same error: not re-reported as 'step')
    const errors = of('error');
    expect(errors.filter((e) => e.message.startsWith('step: boom')).length).toBe(1);
    expect(errors[0].stack).toContain('boom');
    expect(of('snapshot').length).toBe(2);   // still serving frames
    const last = of('snapshot')[1].snap;
    expect(last.instanceCount).toBeGreaterThan(0);
    send({ t: 'tick_budget', ticks: 10 });   // recovery throws (3rd)
    send({ t: 'tick_budget', ticks: 10 });   // recovery succeeds, ticking resumes
    spy.mockRestore();
    const uis = of('ui');
    expect(uis.length).toBeGreaterThan(0);
    const ui = uis[uis.length - 1].ui;
    expect(ui.run.phase).toBe('between');   // restart_checkpoint → a fresh attempt
    expect(ui.run.attempts).toBeGreaterThanOrEqual(2);
    posted.length = 0;
    send({ t: 'tick_budget', ticks: 30 });
    expect(of('error').length).toBe(0);
    expect(of('ui').length).toBeGreaterThan(0);
  });

  it('answers every inspector request, even when nothing matches (SimClient pairs replies in order)', () => {
    posted.length = 0;
    send({ t: 'inspector', enemyIndex: 9999, gen: 123456 });
    send({ t: 'inspector', enemyIndex: -1, gen: 0 });
    const replies = of('inspector');
    expect(replies.length).toBe(2);
    expect(replies[0].chain).toEqual([]);
  });

  it('a save the sim cannot load posts `init: ...` and leaves the worker idle; a later init recovers', () => {
    posted.length = 0;
    send({ t: 'init', save: { version: 1 } as never });
    const errs = of('error');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/^init: Not a Citadel save/);
    expect(of('ready').length).toBe(0);
    send({ t: 'tick_budget', ticks: 5 });   // idle: no crash, nothing posted
    send({ t: 'inspector', enemyIndex: 0, gen: 0 });
    expect(of('inspector').length).toBe(1);
    send({ t: 'init', save: null, seedOverride: 2 });
    expect(of('ready').length).toBe(1);
  });
});

