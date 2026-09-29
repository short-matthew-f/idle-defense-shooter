import { describe, expect, it } from 'vitest';
import { ARENA_RADIUS, FX_FLOATS, FxKind, INSTANCE_FLOATS, Shape } from '../../src/sim/core/types';
import { DEV_DEFAULTS, DEV_STRESS, DevHarness, parseDevHash } from '../../src/app/dev-harness';

function validate(h: DevHarness): void {
  const s = h.snap;
  expect(s.instanceCount * INSTANCE_FLOATS).toBeLessThanOrEqual(s.instances.length);
  expect(s.fxCount * FX_FLOATS).toBeLessThanOrEqual(s.fx.length);
  const layersSeen = new Set<number>();
  const shapesSeen = new Set<number>();
  const errors: string[] = [];
  for (let i = 0; i < s.instanceCount; i++) {
    const o = i * INSTANCE_FLOATS;
    for (let k = 0; k < INSTANCE_FLOATS; k++) if (!Number.isFinite(s.instances[o + k])) errors.push(`nonfinite ${i}.${k}`);
    const shape = s.instances[o + 4], layer = s.instances[o + 9], alpha = s.instances[o + 8];
    if (!(Number.isInteger(shape) && shape >= Shape.Circle && shape <= Shape.Crescent)) errors.push(`shape ${i}`);
    if (!(Number.isInteger(layer) && layer >= 0 && layer <= 7)) errors.push(`layer ${i}`);
    if (!(s.instances[o + 2] > 0)) errors.push(`radius ${i}`);
    if (!(alpha >= 0 && alpha <= 1)) errors.push(`alpha ${i}`);
    for (const c of [5, 6, 7]) if (!(s.instances[o + c] >= 0 && s.instances[o + c] <= 1)) errors.push(`color ${i}`);
    // layer 4 is enemies: aux0 is the hp fraction in (0, 1]
    if (layer === 4 && !(s.instances[o + 10] > 0 && s.instances[o + 10] <= 1)) errors.push(`hp ${i}`);
    layersSeen.add(layer);
    shapesSeen.add(shape);
  }
  for (let i = 0; i < s.fxCount; i++) {
    const o = i * FX_FLOATS;
    const kind = s.fx[o];
    if (!(Number.isInteger(kind) && kind >= FxKind.Hit && kind <= FxKind.Tell)) errors.push(`fx kind ${i}`);
    for (let k = 0; k < FX_FLOATS; k++) if (!Number.isFinite(s.fx[o + k])) errors.push(`fx nonfinite ${i}.${k}`);
  }
  expect(errors.slice(0, 5)).toEqual([]);
  // the harness exercises every layer and every shape
  expect([...layersSeen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(shapesSeen.size).toBe(12);
}

describe('dev harness', () => {
  it('produces valid snapshots across many frames (default preset)', () => {
    const h = new DevHarness();
    for (const frame of [0, 1, 45, 100, 400, 1234, 9999]) {
      h.step(frame);
      validate(h);
      expect(h.snap.tick).toBe(frame);
    }
  });

  it('has roughly the advertised entity counts', () => {
    const h = new DevHarness();
    h.step(10);
    const s = h.snap;
    const byLayer = new Array(8).fill(0);
    for (let i = 0; i < s.instanceCount; i++) byLayer[s.instances[i * INSTANCE_FLOATS + 9]]++;
    expect(byLayer[4]).toBeGreaterThanOrEqual(DEV_DEFAULTS.enemies);
    expect(byLayer[5]).toBeGreaterThanOrEqual(DEV_DEFAULTS.enemies);
    expect(byLayer[3]).toBeGreaterThanOrEqual(DEV_DEFAULTS.projectiles);
  });

  it('stress preset stays within the design budgets and its buffers', () => {
    const h = new DevHarness(DEV_STRESS);
    h.step(77);
    validate(h);
    let enemies = 0, projectiles = 0;
    for (let i = 0; i < h.snap.instanceCount; i++) {
      const layer = h.snap.instances[i * INSTANCE_FLOATS + 9];
      if (layer === 4) enemies++;
      if (layer === 3) projectiles++;
    }
    expect(enemies).toBeGreaterThanOrEqual(1500);
    expect(projectiles).toBeGreaterThanOrEqual(4000);
  });

  it('is deterministic in the frame counter', () => {
    const a = new DevHarness(), b = new DevHarness();
    a.step(500); b.step(3); b.step(500);
    expect(a.snap.instanceCount).toBe(b.snap.instanceCount);
    expect(Array.from(a.snap.instances.subarray(0, a.snap.instanceCount * INSTANCE_FLOATS)))
      .toEqual(Array.from(b.snap.instances.subarray(0, b.snap.instanceCount * INSTANCE_FLOATS)));
    expect(a.snap.fxCount).toBe(b.snap.fxCount);
    expect(Array.from(a.snap.fx.subarray(0, a.snap.fxCount * FX_FLOATS)))
      .toEqual(Array.from(b.snap.fx.subarray(0, b.snap.fxCount * FX_FLOATS)));
    expect(a.snap.cameraShake).toBe(b.snap.cameraShake);
  });

  it('keeps enemies inside the arena', () => {
    const h = new DevHarness();
    for (const frame of [0, 200, 777]) {
      h.step(frame);
      for (let i = 0; i < h.snap.instanceCount; i++) {
        const o = i * INSTANCE_FLOATS;
        if (h.snap.instances[o + 9] !== 4) continue;
        expect(Math.hypot(h.snap.instances[o], h.snap.instances[o + 1])).toBeLessThanOrEqual(ARENA_RADIUS + 60);
      }
    }
  });
});

describe('parseDevHash', () => {
  it('recognizes dev hashes', () => {
    expect(parseDevHash('')).toBeNull();
    expect(parseDevHash('#play')).toBeNull();
    expect(parseDevHash('#dev')).toEqual({});
    expect(parseDevHash('#dev:stress')?.enemies).toBe(1500);
    expect(parseDevHash('#dev:sector=3')?.sector).toBe(3);
    expect(parseDevHash('#dev:stress,sector=2')).toMatchObject({ enemies: 1500, sector: 2 });
  });
});
