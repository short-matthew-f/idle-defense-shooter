/**
 * Presentation timing and safety (graphics pass): LOD selection with hysteresis, hit-flash timing and
 * its 3 Hz cap, the Tell pulse, the floor vignette cap, reduced-motion handling, slow-mo and the
 * auto-degrade frame monitor.
 */
import { describe, expect, it } from 'vitest';
import { AnimKind, AnimRate, FxKind, RStatus, Shape, INSTANCE_FLOATS } from '../../src/sim/core/types';
import { FLASH_GAP, FLASH_LEN, LOD_OFF, LOD_ON, SnapshotWriter, animPhase, flashAllowed, flashAt, lodFor } from '../../src/sim/core/snapshot';
import { EnemyView, packAnim } from '../../src/sim/core/snapshot-art';
import { TELL_LIFE, TELL_PULSE_CYCLES } from '../../src/render/particles';
import { Juice, MIN_PULSE_GAP_S, SLOWMO_SCALE, VIGNETTE_MAX, slowMoScale } from '../../src/render/juice';
import { AUTO_SLOW_MS, FrameMonitor, GFX_DEFAULTS, TIERS, TIER_ORDER, lowerTier, minTier, motionScales, reducedMotion, sanitizeGfx, onGfxChange, setGfxSettings, gfxSettings, resetGfxCache } from '../../src/render/quality';
import { FramePrep, DEFAULT_FRAME_OPTIONS, idleAnim } from '../../src/render/frame-prep';
import type { RenderSnapshot } from '../../src/sim/core/types';

describe('LOD selection', () => {
  it('turns composites off above LOD_ON enemies and back on only below LOD_OFF', () => {
    expect(lodFor(false, LOD_ON)).toBe(false);
    expect(lodFor(false, LOD_ON + 1)).toBe(true);
    expect(lodFor(true, LOD_OFF + 20)).toBe(true);    // hysteresis: no flicker around the threshold
    expect(lodFor(true, LOD_OFF - 1)).toBe(false);
    expect(LOD_ON).toBeGreaterThanOrEqual(550);
    expect(LOD_ON).toBeLessThanOrEqual(650);
  });
  it('quality tiers get monotonically cheaper toward Low, and Low draws base shapes only', () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const lo = TIERS[TIER_ORDER[i - 1]], hi = TIERS[TIER_ORDER[i]];
      expect(lo.maxDpr).toBeLessThanOrEqual(hi.maxDpr);
      expect(lo.particleScale).toBeLessThanOrEqual(hi.particleScale);
      expect(lo.detailMaxEnemies).toBeLessThanOrEqual(hi.detailMaxEnemies);
      expect(lo.chainMax).toBeLessThanOrEqual(hi.chainMax);
    }
    expect(TIERS.low.detail).toBe(false);
    expect(TIERS.low.bloom).toBe(false);
    expect(TIERS.high.detailMaxEnemies).toBe(LOD_ON);
    expect(minTier('high', 'medium')).toBe('medium');
    expect(lowerTier('low')).toBe('low');
  });
});

describe('hit flash', () => {
  it('lasts FLASH_LEN frames and fades linearly', () => {
    expect(flashAt(0)).toBe(1);
    expect(flashAt(FLASH_LEN)).toBe(0);
    expect(flashAt(-1)).toBe(0);
    expect(flashAt(FLASH_LEN / 2)).toBeCloseTo(0.5, 5);
  });
  it('an enemy hit every frame flashes at most 3 times per second', () => {
    expect(flashAllowed(FLASH_GAP - 1)).toBe(false);
    expect(FLASH_GAP).toBeGreaterThanOrEqual(20);   // 60 fps / 20 = 3 Hz
    const w = new SnapshotWriter(), v = new EnemyView();
    let starts = 0, prev = 0;
    for (let f = 1; f <= 120; f++) {
      w.frame = f;
      w.trackEnemy(3, 42, f, 200, v);   // a new hit every frame
      if (v.flash === 1 && prev !== 1) starts++;
      prev = v.flash;
    }
    expect(starts).toBeLessThanOrEqual(6);   // 2 s
    expect(starts).toBeGreaterThanOrEqual(5);
  });
  it('a recycled pool slot (new generation) starts clean; knockback wobble decays', () => {
    const w = new SnapshotWriter(), v = new EnemyView();
    w.frame = 1; w.trackEnemy(0, 1, 50, 200, v);
    w.frame = 2; w.trackEnemy(0, 1, 51, 200, v);
    expect(v.flash).toBe(1);
    w.frame = 3; w.trackEnemy(0, 2, 51, 200, v);   // another enemy moved into slot 0
    expect(v.flash).toBe(0);
    w.frame = 4; w.trackEnemy(0, 2, 51, 230, v);   // pushed 30 units outward
    w.frame = 5; w.trackEnemy(0, 2, 51, 230, v);
    expect(Math.abs(v.wobble)).toBeGreaterThan(0);
    for (let f = 6; f < 30; f++) { w.frame = f; w.trackEnemy(0, 2, 51, 230, v); }
    expect(v.wobble).toBe(0);
  });
  it('animation phases come from an integer hash of the generation', () => {
    const seen = new Set<number>();
    for (let g = 0; g < 500; g++) { const p = animPhase(g); expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(64); seen.add(p); }
    expect(seen.size).toBeGreaterThan(40);
    expect(animPhase(17)).toBe(animPhase(17));
  });
});

describe('flash-rate and flash-alpha caps', () => {
  it('the Tell ring pulses at or under 3 Hz', () => {
    expect(TELL_PULSE_CYCLES / TELL_LIFE).toBeLessThanOrEqual(3);
  });
  it('the cue vignette is capped and pulses no faster than 3 Hz', () => {
    const j = new Juice(), m = motionScales(false, true);
    j.cue(FxKind.Punch, 10, 1, 1, 1, m);
    expect(j.vignette).toBeLessThanOrEqual(VIGNETTE_MAX);
    const first = j.vignette;
    j.update(0.05);
    j.cue(FxKind.Punch, 10, 1, 0, 0, m);   // 50 ms later: merged, colour unchanged
    expect(j.vr).toBe(1); expect(j.vg).toBe(1);
    expect(j.vignette).toBeLessThanOrEqual(first);
    expect(MIN_PULSE_GAP_S).toBeGreaterThanOrEqual(1 / 3);
  });
});

describe('reduced motion', () => {
  it('resolves the setting against the OS preference', () => {
    expect(reducedMotion('system', true)).toBe(true);
    expect(reducedMotion('system', false)).toBe(false);
    expect(reducedMotion('reduce', false)).toBe(true);
    expect(reducedMotion('full', true)).toBe(false);
  });
  it('zeroes idle animation, shake, punch and slow-mo, and softens flashes', () => {
    const r = motionScales(true, true);
    expect(r).toMatchObject({ idle: 0, shake: 0, punch: 0, slowmo: false });
    expect(r.flash).toBeLessThan(1);
    expect(motionScales(false, false).shake).toBe(0);   // Screen shake off
    const j = new Juice();
    j.cue(FxKind.Punch, 2, 1, 1, 1, r); j.cue(FxKind.Shake, 1, 1, 1, 1, r); j.cue(FxKind.SlowMo, 1, 1, 1, 1, r);
    expect(j.punch).toBe(0); expect(j.shake).toBe(0);
    expect(j.update(0.1)).toBe(1);
  });
  it('idle animation is identity with motion 0 and frozen enemies never animate', () => {
    const out = [0, 0];
    const p = packAnim(0, 17, AnimKind.Wobble, AnimRate.Normal);
    idleAnim(p, 1.3, 0, out); expect(out).toEqual([1, 0]);
    idleAnim(p, 1.3, 1, out); expect(out[0] !== 1 || out[1] !== 0).toBe(true);
    idleAnim(packAnim(RStatus.Frozen, 17, AnimKind.Wobble, AnimRate.Frozen), 1.3, 1, out); expect(out).toEqual([1, 0]);
    // amplitudes stay small (enemies stay legible)
    for (let k = 1; k <= 8; k++) for (let t = 0; t < 5; t += 0.07) {
      idleAnim(packAnim(0, 5, k, 0), t, 1, out);
      expect(out[0]).toBeGreaterThan(0.9); expect(out[0]).toBeLessThan(1.1);
      if (k !== AnimKind.Spin && k !== AnimKind.SlowSpin) expect(Math.abs(out[1])).toBeLessThanOrEqual(0.36);
    }
  });
  it('FramePrep leaves bodies and parts untouched under reduced motion and animates them otherwise', () => {
    const inst = new Float32Array(3 * INSTANCE_FLOATS);
    const put = (i: number, x: number, r: number, shape: number, layer: number, aux1: number): void => { inst.set([x, 0, r, 0, shape, 1, 1, 1, 1, layer, 1, aux1], i * INSTANCE_FLOATS); };
    put(0, 100, 10, Shape.Hex, 4, packAnim(0, 9, AnimKind.Wobble, 0));
    put(1, 110, 3, Shape.Circle, 4 + 8, 0);   // Part of body 0
    put(2, 100, 12, Shape.Hex, 5, packAnim(0, 9, AnimKind.Wobble, 0));
    const snap: RenderSnapshot = { tick: 1, instances: inst, instanceCount: 3, fx: new Float32Array(8), fxCount: 0, cameraShake: 0, clarity: 0 };
    const still = new FramePrep(10);
    still.time = 0.37;
    still.frame(snap, 0, { ...DEFAULT_FRAME_OPTIONS, motion: motionScales(true, true) });
    const d = still.sorted;
    expect(d[2]).toBe(10); expect(d[3]).toBe(0);                          // body
    expect(d[INSTANCE_FLOATS]).toBe(110); expect(d[INSTANCE_FLOATS + 2]).toBe(3);   // part
    const live = new FramePrep(10);
    live.time = 0.37;
    live.frame(snap, 0, DEFAULT_FRAME_OPTIONS);
    expect(live.sorted[3]).not.toBe(0);
    expect(live.sorted[INSTANCE_FLOATS + 1]).not.toBe(0);                   // the part swung with the body
  });
});

describe('slow-mo and the auto-degrade monitor', () => {
  it('slows visual time after a Counter and eases back', () => {
    expect(slowMoScale(0)).toBe(SLOWMO_SCALE);
    expect(slowMoScale(0.5)).toBeGreaterThan(SLOWMO_SCALE);
    expect(slowMoScale(2)).toBe(1);
    const j = new Juice();
    j.cue(FxKind.SlowMo, 1, 1, 1, 1, motionScales(false, true));
    expect(j.update(0.016)).toBeLessThan(1);
  });
  it('lowers quality only after a full 2 s window of long frames, ignoring hitches and the settle time', () => {
    const m = new FrameMonitor();
    m.reset(0);
    let fired = false;
    for (let t = 0; t < 3000; t += 16) fired = fired || m.push(16);
    expect(fired).toBe(false);
    m.reset(0);
    for (let k = 0; k < 20; k++) expect(m.push(1000)).toBe(false);   // tab switches / hitches ignored
    let at = -1;
    for (let t = 0, k = 0; t < 3000; t += 30, k++) if (m.push(30) && at < 0) at = t;
    expect(at).toBeGreaterThanOrEqual(1900);
    expect(at).toBeLessThanOrEqual(2100);
    expect(m.lastMean).toBeGreaterThan(AUTO_SLOW_MS);
    const s = new FrameMonitor();   // default settle: nothing in the first 4 s
    let early = false;
    for (let t = 0; t < 3900; t += 30) early = early || s.push(30);
    expect(early).toBe(false);
  });
});

describe('graphics settings store', () => {
  it('sanitizes stored values and notifies the renderer on change', () => {
    expect(sanitizeGfx(null)).toEqual(GFX_DEFAULTS);
    expect(sanitizeGfx({ quality: 'ultra', auto: 'yes', motion: 'reduce', chainLines: false })).toEqual({ ...GFX_DEFAULTS, motion: 'reduce', chainLines: false });
    resetGfxCache();
    let seen = '';
    const off = onGfxChange((g) => { seen = g.quality; });
    setGfxSettings({ quality: 'low' });
    expect(seen).toBe('low');
    expect(gfxSettings().quality).toBe('low');
    off();
    setGfxSettings({ quality: 'high' });
    expect(seen).toBe('low');
    resetGfxCache();
  });
});
