import { describe, expect, it } from 'vitest';
import { fmtNum, fmtDuration, fmtRate, fmtPct, substituteDesc, echoesFor, offlineEstimate, nextRankCost, titleCase } from '../../src/ui/format';

describe('fmtNum', () => {
  it('keeps small integers', () => {
    expect(fmtNum(0)).toBe('0');
    expect(fmtNum(52.52)).toBe('52');
    expect(fmtNum(999)).toBe('999');
    expect(fmtNum(2.57)).toBe('2.5');
  });
  it('uses suffixes and rounds down', () => {
    expect(fmtNum(1234)).toBe('1.2K');
    expect(fmtNum(1999)).toBe('1.9K');
    expect(fmtNum(3.45e6)).toBe('3.4M');
    expect(fmtNum(123456)).toBe('123K');
    expect(fmtNum(1000)).toBe('1K');
    expect(fmtNum(7.8e9)).toBe('7.8B');
    expect(fmtNum(-1500)).toBe('-1.5K');
  });
  it('falls back to scientific past the table', () => {
    expect(fmtNum(1.5e40)).toBe('1.5e40');
    expect(fmtNum(Infinity)).toBe('∞');
    expect(fmtNum(NaN)).toBe('—');
  });
  it('formats rates and percents', () => {
    expect(fmtRate(1234)).toBe('+1.2K/s');
    expect(fmtRate(0)).toBe('0/s');
    expect(fmtPct(0.153)).toBe('15%');
  });
});

describe('fmtDuration', () => {
  it('formats seconds to days', () => {
    expect(fmtDuration(45)).toBe('45s');
    expect(fmtDuration(185)).toBe('3m 5s');
    expect(fmtDuration(120)).toBe('2m');
    expect(fmtDuration(3 * 3600 + 12 * 60 + 9)).toBe('3h 12m');
    expect(fmtDuration(2 * 86400 + 4 * 3600)).toBe('2d 4h');
    expect(fmtDuration(-1)).toBe('—');
  });
});

describe('misc', () => {
  it('substitutes {v}', () => {
    expect(substituteDesc('+{v} damage per rank', 0.08)).toBe('+8% damage per rank');
    expect(substituteDesc('+{v} range', 10)).toBe('+10 range');
    expect(substituteDesc('no placeholder', 3)).toBe('no placeholder');
  });
  it('mirrors the economy formulas', () => {
    expect(echoesFor(19)).toBe(0);
    expect(echoesFor(20)).toBe(10);
    expect(echoesFor(25, 2)).toBe(Math.floor(10 * Math.pow(1.2, 5) * 1.2));
    expect(offlineEstimate(10, 3600, false)).toBe(Math.floor(10 * 3600 * 0.4));
    expect(offlineEstimate(10, 30 * 3600, false)).toBe(Math.floor(10 * 8 * 3600 * 0.4));
    expect(offlineEstimate(10, 30 * 3600, true)).toBe(Math.floor(10 * 24 * 3600 * 0.7));
    expect(offlineEstimate(10, 30 * 3600, 2)).toBe(Math.floor(10 * 16 * 3600 * 0.55));   // rank 2: 16 h and 55%
    expect(offlineEstimate(10, 3600, 1)).toBe(Math.floor(10 * 3600 * 0.475));
    expect(nextRankCost({ base: 10, growth: 1.5 }, 2)).toBe(23);
    expect(nextRankCost({ flat: [2, 4, 8] }, 5)).toBe(8);
    expect(nextRankCost({ cores: 2 }, 0)).toBe(2);
    expect(titleCase('prestige.seed_capital')).toBe('Seed Capital');
  });
});
