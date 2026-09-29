import { describe, expect, it } from 'vitest';
import { HoldGesture, HOLD_DELAY_MS, MAX_HOLD_FIRES, TOUCH_HOLD_DELAY_MS } from '../../src/ui/hold';

/** Count fires for a scripted gesture. */
function fires(actions: { kind: string }[]): number { return actions.filter((a) => a.kind === 'fire').length; }

describe('hold-to-buy gesture', () => {
  it('mouse: fires on press, then repeats after the hold delay; the click does not double-fire', () => {
    const g = new HoldGesture();
    const a = g.down('mouse', 0, 0);
    expect(a).toEqual({ kind: 'fire', next: HOLD_DELAY_MS });
    expect(fires([g.tick(true), g.tick(true), g.tick(true)])).toBe(3);
    g.up();
    expect(g.click(1)).toBe(false);
  });

  it('touch tap: nothing on touch-down, exactly one fire on the click', () => {
    const g = new HoldGesture();
    expect(g.down('touch', 10, 10)).toEqual({ kind: 'wait', next: TOUCH_HOLD_DELAY_MS });
    g.up();
    expect(g.click(1)).toBe(true);
    expect(g.click(1)).toBe(false);   // a stray second click never fires
  });

  it('touch swipe (scrolling the list) never buys', () => {
    const g = new HoldGesture();
    g.down('touch', 100, 100);
    expect(g.move(100, 104).kind).toBe('none');        // within slop
    expect(g.move(100, 80).kind).toBe('stop');         // a scroll
    expect(g.tick(true).kind).toBe('stop');            // a late timer does nothing
    expect(g.click(1)).toBe(false);
  });

  it('touch: the browser taking the gesture (pointercancel) never buys', () => {
    const g = new HoldGesture();
    g.down('touch', 0, 0);
    g.cancel();
    expect(g.tick(true).kind).toBe('stop');
    expect(g.click(1)).toBe(false);
  });

  it('touch hold repeats and suppresses the release click', () => {
    const g = new HoldGesture();
    g.down('touch', 0, 0);
    expect(fires([g.tick(true), g.tick(true)])).toBe(2);
    expect(g.move(0, 50).kind).toBe('none');          // once repeating, a wobble does not cancel
    g.up();
    expect(g.click(1)).toBe(false);
  });

  it('stops when the button disappears or is disabled, and after the bound', () => {
    const g = new HoldGesture();
    g.down('mouse', 0, 0);
    expect(g.tick(false).kind).toBe('stop');
    const h = new HoldGesture();
    h.down('mouse', 0, 0);
    let n = 1;
    for (let i = 0; i < 1000; i++) { const a = h.tick(true); if (a.kind !== 'fire') break; n++; }
    expect(n).toBe(MAX_HOLD_FIRES);
  });

  it('repeat cadence speeds up but never below the floor', () => {
    const g = new HoldGesture();
    g.down('mouse', 0, 0);
    const delays: number[] = [];
    for (let i = 0; i < 30; i++) { const a = g.tick(true); if (a.kind === 'fire') delays.push(a.next); }
    expect(delays[1]).toBeLessThan(delays[0]);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(40);
  });

  it('keyboard activation always fires once', () => {
    const g = new HoldGesture();
    expect(g.click(0)).toBe(true);
  });
});
