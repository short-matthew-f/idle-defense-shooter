/**
 * Input pointer mapping (docs/TOUCH.md): the world point a tap acts on must be the one drawn under the
 * finger, including when the canvas box and the camera's fitted size disagree, with the punch zoom kick and
 * shake, and with a tap calibration. "Drawn" is the renderer's transform: NDC = (world − cam)·uScale + uOffset,
 * with uScale = 2·s / view and the NDC square stretched over the canvas' CSS box.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Camera } from '../../src/render/camera';
import { Input, boxToView } from '../../src/app/input';

type Handler = (e: unknown) => void;
class FakeCanvas {
  style: Record<string, string> = {};
  rect = { left: 0, top: 0, width: 393, height: 793 };
  handlers = new Map<string, Handler>();
  addEventListener(t: string, fn: Handler): void { this.handlers.set(t, fn); }
  removeEventListener(): void { /* unused */ }
  getBoundingClientRect(): DOMRect { const r = this.rect; return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect; }
  setPointerCapture(): void { /* no-op */ }
  releasePointerCapture(): void { /* no-op */ }
  fire(type: string, id: number, x: number, y: number): void {
    this.handlers.get(type)?.({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y + 59, offsetX: x, offsetY: y });
  }
  tap(x: number, y: number): void { this.fire('pointerdown', 1, x, y); this.fire('pointerup', 1, x, y); }
}

/** Where the renderer draws world (wx, wy), in client CSS px (renderer.ts uniforms). */
function drawn(cam: Camera, c: FakeCanvas, wx: number, wy: number): { x: number; y: number } {
  const s = cam.drawScale, vw = cam.viewW, vh = cam.viewH;
  const nx = (wx - (cam.x + cam.shakeX)) * (2 * s / vw) + (2 * (cam.centerPx - vw * 0.5)) / vw;
  const ny = (wy - (cam.y + cam.shakeY)) * (-(2 * s) / vh) + (-2 * (cam.centerPy - vh * 0.5)) / vh;
  const r = c.rect;
  return { x: r.left + (nx + 1) / 2 * r.width, y: r.top + (1 - ny) / 2 * r.height };
}

const g = globalThis as unknown as { window?: unknown };
let hadWindow = false;
beforeEach(() => { hadWindow = 'window' in g; if (!hadWindow) g.window = globalThis; });
afterEach(() => { if (!hadWindow) delete g.window; });

function setup(): { cam: Camera; c: FakeCanvas; input: Input; taps: { x: number; y: number }[] } {
  const cam = new Camera();
  cam.setInsets(80, 0, 94, 0);
  cam.fit(520, 393, 793);
  const c = new FakeCanvas();
  const taps: { x: number; y: number }[] = [];
  const input = new Input(c as unknown as HTMLCanvasElement, cam, { onTap: (x, y) => taps.push({ x, y }) });
  return { cam, c, input, taps };
}
const PTS: [number, number][] = [[196, 240], [196, 400], [80, 560], [320, 640]];

describe('Input maps taps onto the drawn frame', () => {
  it('baseline: zero error', () => {
    const { cam, c, taps } = setup();
    for (const [x, y] of PTS) {
      c.tap(x, y);
      const d = drawn(cam, c, taps.at(-1)!.x, taps.at(-1)!.y);
      expect(d.x).toBeCloseTo(x, 3); expect(d.y).toBeCloseTo(y, 3);
    }
  });

  it('stale camera size (box 852 tall, camera fitted to 793): still zero error, and the app is asked to re-fit', async () => {
    const { cam, c, input, taps } = setup();
    let stale = 0;
    input.onStale = () => { stale++; };
    c.rect = { left: 0, top: 0, width: 393, height: 852 };
    for (const [x, y] of PTS) {
      c.tap(x, y);
      const d = drawn(cam, c, taps.at(-1)!.x, taps.at(-1)!.y);
      expect(d.x).toBeCloseTo(x, 3); expect(d.y).toBeCloseTo(y, 3);
    }
    await Promise.resolve();
    expect(stale).toBeGreaterThan(0);
    expect(input.staleCount).toBeGreaterThan(0);
  });

  it('what the old mapping did with that stale size: 30-50 px below the finger', () => {
    const { cam, c } = setup();
    c.rect = { left: 0, top: 0, width: 393, height: 852 };
    const old = (y: number): number => drawn(cam, c, 0, cam.toWorld(196, y).y).y - y;   // clientY − rect.top, no scaling
    expect(old(400)).toBeGreaterThan(29);
    expect(old(640)).toBeGreaterThan(45);
  });

  it('punch zoom kick and shake: zero error', () => {
    const { cam, c, taps } = setup();
    cam.punch = 0.07;
    cam.shakeX = 12; cam.shakeY = -9;
    for (const [x, y] of PTS) {
      c.tap(x, y);
      const d = drawn(cam, c, taps.at(-1)!.x, taps.at(-1)!.y);
      expect(d.x).toBeCloseTo(x, 3); expect(d.y).toBeCloseTo(y, 3);
    }
  });

  it('a tap acts on the world point under the finger when it went down (the frame changes before the lift)', () => {
    const { cam, c, taps } = setup();
    c.fire('pointerdown', 1, 200, 500);
    const want = cam.toWorld(200, 500, { x: 0, y: 0 });
    cam.shakeY = 25; cam.punch = 0.05;          // next frames shake and kick
    c.fire('pointerup', 1, 200, 500);
    expect(taps[0].x).toBeCloseTo(want.x, 3);
    expect(taps[0].y).toBeCloseTo(want.y, 3);
  });

  it('calibration removes a synthetic 40 px downward read offset', () => {
    const { cam, c, input, taps } = setup();
    input.calibration = { ax: 1, bx: 0, ay: 1, by: -40 };
    c.tap(150, 540);                             // the finger is at y 500; the device reports 540
    const d = drawn(cam, c, taps[0].x, taps[0].y);
    expect(d.x).toBeCloseTo(150, 3); expect(d.y).toBeCloseTo(500, 3);
  });

  it('the probe takes every pointer and the game sees none', () => {
    const { c, input, taps } = setup();
    const got: number[] = [];
    input.probe = (s) => got.push(s.worldY);
    c.tap(100, 300);
    expect(taps).toHaveLength(0);
    expect(got).toHaveLength(2);     // down + up
    input.probe = null;
    c.tap(100, 300);
    expect(taps).toHaveLength(1);
  });
});

describe('boxToView', () => {
  it('scales box px into the camera view and applies the calibration first', () => {
    expect(boxToView(100, 852, 393, 852, 393, 793, null, { x: 0, y: 0 })).toEqual({ x: 100, y: 793 });
    const o = boxToView(100, 440, 400, 800, 400, 800, { ax: 1, bx: 2, ay: 1, by: -40 }, { x: 0, y: 0 });
    expect(o).toEqual({ x: 102, y: 400 });
  });
});
