import { describe, expect, it } from 'vitest';
import { Camera, FIT_MARGIN, MAX_ZOOM, MIN_ZOOM } from '../../src/render/camera';

const R = 520;

describe('Camera.fit', () => {
  it('fits the whole arena on phone portrait (width-limited)', () => {
    const c = new Camera();
    c.fit(R, 390, 844);
    // arena diameter in px never exceeds the short side
    expect(2 * R * c.baseScale).toBeLessThanOrEqual(390);
    expect(c.baseScale).toBeCloseTo(390 / (2 * R * FIT_MARGIN), 6);
    // the arena rim (right and bottom-most point) is on-screen
    const right = c.toScreen(R, 0);
    expect(right.x).toBeLessThanOrEqual(390);
    const bottom = c.toScreen(0, R);
    expect(bottom.y).toBeLessThanOrEqual(844);
  });

  it('fits the whole arena on desktop landscape (height-limited)', () => {
    const c = new Camera();
    c.fit(R, 1920, 1080);
    expect(2 * R * c.baseScale).toBeLessThanOrEqual(1080);
    expect(c.toScreen(0, -R).y).toBeGreaterThanOrEqual(0);
    expect(c.toScreen(0, R).y).toBeLessThanOrEqual(1080);
  });

  it('centers the tower in the view', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    const s = c.toScreen(0, 0);
    expect(s.x).toBeCloseTo(400, 6);
    expect(s.y).toBeCloseTo(300, 6);
  });

  it('respects bottom inset (bottom sheet) by shifting the arena up', () => {
    const c = new Camera();
    c.setInsets(0, 0, 300, 0);
    c.fit(R, 390, 844);
    const s = c.toScreen(0, 0);
    expect(s.y).toBeCloseTo((844 - 300) / 2, 6);
    expect(c.toScreen(0, R).y).toBeLessThanOrEqual(844 - 300 + 1);
  });

  it('rides high with a vertical bias and never leaves the available box', () => {
    const c = new Camera();
    c.setInsets(100, 0, 150, 0, 0.3);
    c.fit(R, 390, 844);
    const avail = 844 - 100 - 150;
    const diameter = 390;   // width-bound on a phone
    expect(c.toScreen(0, 0).y).toBeCloseTo(100 + (avail - diameter) * 0.3 + diameter / 2, 6);
    expect(c.toScreen(0, -R).y).toBeGreaterThanOrEqual(100);
    expect(c.toScreen(0, R).y).toBeLessThanOrEqual(844 - 150 + 1);
    c.setInsets(100, 0, 150, 0, 7);   // out of range clamps to the bottom
    expect(c.vBias).toBe(1);
  });

  it('survives degenerate sizes', () => {
    const c = new Camera();
    c.fit(R, 0, 0);
    expect(Number.isFinite(c.baseScale)).toBe(true);
    expect(c.baseScale).toBeGreaterThan(0);
  });
});

describe('Camera conversions', () => {
  it('toWorld and toScreen round-trip', () => {
    const c = new Camera();
    c.fit(R, 1024, 768);
    c.setZoom(2, 300, 200);
    for (const [wx, wy] of [[0, 0], [100, -50], [-300, 270], [R, 0]]) {
      const s = { x: 0, y: 0 };
      c.toScreen(wx, wy, s);
      const w = c.toWorld(s.x, s.y, { x: 0, y: 0 });
      expect(w.x).toBeCloseTo(wx, 4);
      expect(w.y).toBeCloseTo(wy, 4);
    }
  });

  it('screen +y is world +y (y down)', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    const a = c.toWorld(400, 300, { x: 0, y: 0 });
    const b = c.toWorld(400, 400, { x: 0, y: 0 });
    expect(b.y).toBeGreaterThan(a.y);
  });

  it('toWorld reuses a shared object unless given one', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    expect(c.toWorld(1, 1)).toBe(c.toWorld(2, 2));
    const out = { x: 0, y: 0 };
    expect(c.toWorld(1, 1, out)).toBe(out);
  });
});

describe('Camera zoom', () => {
  it('clamps zoom to limits', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    c.zoomBy(1000);
    expect(c.zoom).toBe(MAX_ZOOM);
    c.zoomBy(1e-6);
    expect(c.zoom).toBe(MIN_ZOOM);
  });

  it('keeps the world point under the pivot fixed', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    const px = 600, py = 200;
    const before = { ...c.toWorld(px, py) };
    c.zoomBy(2, px, py);
    const after = c.toWorld(px, py);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it('does not pan at zoom <= 1', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    c.zoomBy(0.8, 100, 100);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });

  it('limits pan when zoomed in', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    c.setZoom(2);
    c.panByPixels(-1e6, -1e6);
    expect(Math.abs(c.x)).toBeLessThanOrEqual(R);
    expect(Math.abs(c.y)).toBeLessThanOrEqual(R);
  });
});

describe('Camera shake', () => {
  it('follows the snapshot value and decays to zero', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    c.update(1 / 60, 0.8);
    expect(c.trauma).toBeCloseTo(0.8, 6);
    const mag = Math.hypot(c.shakeX, c.shakeY);
    expect(mag).toBeGreaterThan(0);
    for (let i = 0; i < 300; i++) c.update(1 / 60, 0);
    expect(c.trauma).toBe(0);
    expect(c.shakeX).toBe(0);
    expect(c.shakeY).toBe(0);
  });

  it('shake offset is bounded by maxShakePx / scale', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      c.update(1 / 60, 5); // clamped to 1
      worst = Math.max(worst, Math.abs(c.shakeX), Math.abs(c.shakeY));
    }
    expect(worst).toBeLessThanOrEqual((c.maxShakePx / c.scale) * 1.0 + 1e-6);
  });

  it('taps line up with what is drawn while shaking', () => {
    const c = new Camera();
    c.fit(R, 800, 600);
    c.update(1 / 60, 1);
    const s = c.toScreen(50, 60, { x: 0, y: 0 });
    const w = c.toWorld(s.x, s.y, { x: 0, y: 0 });
    expect(w.x).toBeCloseTo(50, 4);
    expect(w.y).toBeCloseTo(60, 4);
  });
});

describe('Camera punch (zoom kick)', () => {
  it('toScreen / toWorld include the punch, like the drawn frame (s = scale · (1 + punch))', () => {
    const c = new Camera();
    c.fit(R, 393, 793);
    const at = c.toScreen(200, -150, { x: 0, y: 0 });
    c.punch = 0.07;
    const kicked = c.toScreen(200, -150, { x: 0, y: 0 });
    expect(kicked.x - c.centerPx).toBeCloseTo((at.x - c.centerPx) * 1.07, 6);
    expect(kicked.y - c.centerPy).toBeCloseTo((at.y - c.centerPy) * 1.07, 6);
    const w = c.toWorld(kicked.x, kicked.y, { x: 0, y: 0 });
    expect(w.x).toBeCloseTo(200, 6);
    expect(w.y).toBeCloseTo(-150, 6);
    expect(c.drawScale).toBeCloseTo(c.scale * 1.07, 9);
  });

  it('zoom keeps the point under the pointer fixed during a punch', () => {
    const c = new Camera();
    c.fit(R, 393, 793);
    c.punch = 0.05;
    const before = c.toWorld(170, 450, { x: 0, y: 0 });   // inside the pan limit at zoom 2
    c.setZoom(2, 170, 450);
    const after = c.toWorld(170, 450, { x: 0, y: 0 });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('reset clears the punch', () => {
    const c = new Camera();
    c.punch = 0.07; c.reset();
    expect(c.punch).toBe(0);
  });
});
