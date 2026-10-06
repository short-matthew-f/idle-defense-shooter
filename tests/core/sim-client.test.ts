/** Main-thread worker wrapper (src/app/sim-client.ts) against a fake Worker. */
import { describe, it, expect } from 'vitest';
import { SimClient } from '../../src/app/sim-client';
import type { FromWorker, ToWorker } from '../../src/sim/core/types';

class FakeWorker {
  sent: ToWorker[] = [];
  onmessage: ((ev: { data: FromWorker }) => void) | null = null;
  onerror: ((ev: { message: string; preventDefault?: () => void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  postMessage(m: ToWorker): void { this.sent.push(m); }
  terminate(): void { this.terminated = true; }
  reply(m: FromWorker): void { this.onmessage?.({ data: m }); }
}

function client(): { c: SimClient; w: FakeWorker } {
  const w = new FakeWorker();
  const c = new SimClient(null, { seed: 4, worker: w as unknown as Worker });
  return { c, w };
}

describe('SimClient', () => {
  it('sends init with the seed override and forwards commands and budgets', () => {
    const { c, w } = client();
    expect(w.sent[0]).toEqual({ t: 'init', save: null, seedOverride: 4 });
    c.send({ type: 'set_mode', mode: 'patrol' });
    c.send({ type: 'set_speed', speed: 2 } as never);
    c.tickBudget(3);
    expect(w.sent.slice(1)).toEqual([{ t: 'cmd', cmd: { type: 'set_mode', mode: 'patrol' }, seq: 1 }, { t: 'cmd', cmd: { type: 'set_speed', speed: 2 } }, { t: 'tick_budget', ticks: 3 }]);
  });

  it('pairs inspector replies with requests in order and resolves saves', async () => {
    const { c, w } = client();
    const a = c.inspect(1, 1), b = c.inspect(2, 2);
    w.reply({ t: 'inspector', chain: [], sentence: 'first' });
    w.reply({ t: 'inspector', chain: [], sentence: 'second' });
    expect((await a).sentence).toBe('first');
    expect((await b).sentence).toBe('second');
    const s = c.requestSave();
    w.reply({ t: 'save', save: { version: 1 } as never });
    expect((await s).version).toBe(1);
  });

  it('surfaces worker load failures and message errors through onError', () => {
    const { c, w } = client();
    const errs: string[] = [];
    c.onError = (m) => errs.push(m);
    w.onerror?.({ message: 'SyntaxError: boom' });
    w.onmessageerror?.();
    w.reply({ t: 'error', message: 'step: x' });
    expect(errs).toEqual(['worker: SyntaxError: boom', 'worker: a message could not be deserialized', 'step: x']);
  });
});
