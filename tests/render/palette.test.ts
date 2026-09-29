import { describe, expect, it } from 'vitest';
import { Shape } from '../../src/sim/core/types';
import { ELEMENT_COLORS, ELEMENT_ORDER, NEUTRAL_COLOR, SECTOR_PALETTES, STATUS_SHAPES, elementColor, sectorIndexForWave } from '../../src/render/palette';

describe('palette', () => {
  it('maps elements by id and by projectile-pool index (+1, 0 = none)', () => {
    expect(elementColor('fire')).toBe(ELEMENT_COLORS.fire);
    ELEMENT_ORDER.forEach((id, i) => expect(elementColor(i + 1)).toBe(ELEMENT_COLORS[id]));
    expect(elementColor(0)).toBe(NEUTRAL_COLOR);
    expect(elementColor(null)).toBe(NEUTRAL_COLOR);
    expect(elementColor(99)).toBe(NEUTRAL_COLOR);
  });

  it('element colors are distinct and in range', () => {
    const seen = new Set<string>();
    for (const id of ELEMENT_ORDER) {
      const c = ELEMENT_COLORS[id];
      c.forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); });
      seen.add(c.join(','));
    }
    expect(seen.size).toBe(4);
  });

  it('the four headline statuses read by distinct shapes (never hue alone)', () => {
    const shapes = [STATUS_SHAPES.burn, STATUS_SHAPES.shock, STATUS_SHAPES.poison, STATUS_SHAPES.chill];
    expect(new Set(shapes).size).toBe(4);
    expect(new Set(Object.values(STATUS_SHAPES)).size).toBe(Object.keys(STATUS_SHAPES).length);
    expect(STATUS_SHAPES.burn).toBe(Shape.Triangle);
  });

  it('has five sector palettes and maps waves to sectors', () => {
    expect(SECTOR_PALETTES).toHaveLength(5);
    expect(sectorIndexForWave(1)).toBe(0);
    expect(sectorIndexForWave(20)).toBe(0);
    expect(sectorIndexForWave(21)).toBe(1);
    expect(sectorIndexForWave(100)).toBe(4);
    expect(sectorIndexForWave(500)).toBe(4);
  });

  it('enemy colors are brighter than the floor in every sector (silhouette contrast)', () => {
    const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (const p of SECTOR_PALETTES) expect(lum(p.enemy)).toBeGreaterThan(lum(p.floorCenter) * 3);
  });
});
