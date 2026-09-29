import { describe, it, expect } from 'vitest';
import { enemyHp, bossHp, scrapPerKill, echoesFor, starsFor, nodeCost, firstClearMultiplier, statCost, offlineScrap, mechanicTierCost } from '../../src/sim/economy/curves';
import type { NodeDef } from '../../src/sim/data/schema';

describe('economy curves', () => {
  it('EnemyHP follows 10·1.13^w·k·1.6^A·(1+0.12T)', () => {
    expect(enemyHp(20, 1)).toBeCloseTo(10 * Math.pow(1.13, 20), 9);
    expect(enemyHp(1, 1)).toBeCloseTo(11.3, 9);
    expect(enemyHp(10, 4, 2, 5)).toBeCloseTo(10 * Math.pow(1.13, 10) * 4 * 1.6 * 1.6 * 1.6, 6);
    expect(bossHp(5, 1.5)).toBeCloseTo(12 * 10 * Math.pow(1.13, 5) * 1.5, 9);
  });
  it('Scrap, Echoes and Stars', () => {
    expect(scrapPerKill(10, 2)).toBeCloseTo(Math.pow(1.11, 10) * 2, 9);
    expect(echoesFor(30, 0)).toBe(Math.floor(10 * Math.pow(1.2, 10)));
    expect(echoesFor(30, 0)).toBe(61);
    expect(echoesFor(19, 3)).toBe(0);
    expect(echoesFor(25, 2)).toBe(Math.floor(10 * Math.pow(1.2, 5) * 1.2));
    expect(starsFor(100, 0)).toBe(4);
    expect(starsFor(110, 1)).toBe(Math.floor(8 * Math.pow(1.1, 10)));
    expect(firstClearMultiplier()).toBe(3);
    expect(firstClearMultiplier(true)).toBe(4);
    expect(firstClearMultiplier(true, true)).toBe(5);
  });
  it('prices nodes', () => {
    const st: NodeDef = { id: 'a.b', name: '', desc: '', kind: 'stat', maxRank: 10, cost: { base: 10, growth: 1.18 }, tier: 0, effects: [] };
    expect(nodeCost(st, 0)).toEqual({ cost: 10, currency: 'scrap' });
    expect(nodeCost(st, 5).cost).toBe(Math.ceil(10 * Math.pow(1.18, 5)));
    expect(statCost(10, 1.2, 3)).toBe(Math.ceil(10 * 1.2 * 1.2 * 1.2));
    const fl: NodeDef = { ...st, kind: 'mechanic', cost: { flat: [150, 450] } };
    expect(nodeCost(fl, 1).cost).toBe(450);
    expect(nodeCost(fl, 5).cost).toBe(450);
    expect(nodeCost({ ...st, kind: 'exotic', cost: { cores: 2 } }, 0)).toEqual({ cost: 2, currency: 'cores' });
    expect(mechanicTierCost(150, 3)).toBe(9600);
  });
  it('offline Scrap is capped and discounted', () => {
    expect(offlineScrap(10, 3600, false)).toBe(Math.floor(10 * 3600 * 0.4));
    expect(offlineScrap(10, 100 * 3600, false)).toBe(Math.floor(10 * 8 * 3600 * 0.4));
    expect(offlineScrap(10, 100 * 3600, true)).toBe(Math.floor(10 * 24 * 3600 * 0.7));
  });
});
