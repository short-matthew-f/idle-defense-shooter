import { describe, expect, it } from 'vitest';
import { stepId, stepStop } from '../../src/ui/crumbs';
import { BUILD_SECS, buildAttention, buildLanding, buildStops, type BuildWaiting } from '../../src/ui/build';
import { allFeatures, features } from '../../src/ui/progression';
import { PRESTIGE_SEGS } from '../../src/ui/screens';

const feats = (best: number, prestige = 0) => features({ run: { deepestCleared: best }, meta: { deepestEver: best, prestigeCount: prestige } });
const none: BuildWaiting = { draft: false, boon: false, hardpoints: 0, attunements: 0, forks: 0 };

describe('stop walking (crumbs.ts)', () => {
  it('stepId walks a flat order and stops at either end', () => {
    expect(stepId(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(stepId(['a', 'b', 'c'], 'b', -1)).toBe('a');
    expect(stepId(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(stepId(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(stepId(['a', 'b'], 'zz', 1)).toBe('a');
  });
  it('stepStop walks a two-level order (Prestige: views with Echo tiers flattened)', () => {
    const stops = [{ cat: 'forecast', tree: '' }, ...[1, 2, 3, 4].map((t) => ({ cat: 'layers', tree: String(t) })), { cat: 'ascension', tree: '' }];
    expect(stepStop(stops, 'forecast', '', 1)).toEqual({ cat: 'layers', tree: '1' });
    expect(stepStop(stops, 'layers', '4', 1)).toEqual({ cat: 'ascension', tree: '' });
    expect(stepStop(stops, 'layers', '1', -1)).toEqual({ cat: 'forecast', tree: '' });
    expect(stepStop(stops, 'ascension', '', 1)).toBeNull();
  });
});

describe('Build sections', () => {
  it('one order, and only revealed sections (stage 3: Hardpoints and Doctrines)', () => {
    expect(BUILD_SECS.map((s) => s.id)).toEqual(['hardpoints', 'attunements', 'abilities', 'doctrines', 'boons', 'anomalies', 'cores', 'frame']);
    expect(buildStops(feats(10))).toEqual(['hardpoints', 'attunements', 'doctrines']);
    expect(buildStops(feats(5))).toEqual(['doctrines']);   // the tab itself is not shown yet (buildTab), the page list stays safe
    expect(buildStops(feats(15))).toEqual(['hardpoints', 'attunements', 'abilities', 'doctrines', 'boons', 'anomalies']);
    expect(buildStops(allFeatures())).toEqual(BUILD_SECS.map((s) => s.id));
    // a Threat Dial (an Echo upgrade) lives on the Frame page
    expect(buildStops(feats(15), true)).toContain('frame');
  });
  it('lands on what needs attention, in the tab badge order', () => {
    const all = buildStops(allFeatures());
    expect(buildAttention(none, all)).toBeNull();
    expect(buildAttention({ ...none, hardpoints: 1, forks: 2 }, all)).toBe('hardpoints');
    expect(buildAttention({ ...none, attunements: 1, forks: 2 }, all)).toBe('attunements');
    expect(buildAttention({ ...none, forks: 1 }, all)).toBe('doctrines');
    expect(buildAttention({ ...none, boon: true, hardpoints: 1 }, all)).toBe('boons');
    expect(buildAttention({ ...none, draft: true, boon: true }, all)).toBe('anomalies');
    // never lands on a section that is not revealed
    expect(buildAttention({ ...none, draft: true }, ['hardpoints', 'doctrines'])).toBeNull();
  });
  it('else the last section viewed, else the first', () => {
    const st = buildStops(feats(15));
    expect(buildLanding(st, 'hardpoints', 'boons')).toBe('hardpoints');
    expect(buildLanding(st, null, 'boons')).toBe('boons');
    expect(buildLanding(st, null, 'cores')).toBe('hardpoints');   // Cores not revealed: the first
    expect(buildLanding(st, null, '')).toBe('hardpoints');
    expect(buildLanding([], null, 'x')).toBeNull();
  });
});

describe('Prestige views', () => {
  it('Forecast, Echo tiers, Ascension, each with its lock', () => {
    expect(PRESTIGE_SEGS.map((s) => s.label)).toEqual(['Forecast', 'Echo tiers', 'Ascension']);
  });
});
