/// <reference types="vite-plugin-pwa/client" />
/**
 * App boot. Creates the canvas, Renderer, Camera and Input and runs the requestAnimationFrame loop.
 *
 *   index.html#dev            drive the renderer from the synthetic dev harness (no sim, no UI)
 *   index.html#dev:stress     same, at the design budgets (1500 enemies / 4000 projectiles)
 *   index.html#dev:sector=3   pick a Sector palette (0-4); keys 1-5 also switch in dev mode
 *   anything else             the game: SimClient + GameUi (see game.ts)
 *
 * Mounting UI: DOM lives in `<div id="ui">` above the canvas. `#ui` has pointer-events: none so
 * taps fall through to the canvas; its direct children get `pointer-events: auto` (base.css).
 */
import { ARENA_RADIUS, FX_FLOATS, INSTANCE_FLOATS, Shape, TOWER_RADIUS, type RenderSnapshot } from '@sim/core/types';
import { Camera } from '@render/camera';
import { Renderer } from '@render/renderer';
import { DevHarness, parseDevHash } from './dev-harness';
import { Input } from './input';
import { registerPwa } from './pwa';
import { startGame } from './game';

export interface RenderApp {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  camera: Camera;
  input: Input;
  /** Feed the latest sim snapshot (game.ts calls this from the SimClient 'snapshot' message). */
  setSnapshot(snap: RenderSnapshot | null): void;
  /** The snapshot currently drawn (for tap → enemy lookup). */
  readonly snapshot: RenderSnapshot | null;
  /** Called every animation frame before rendering with the frame's dt (s): the game paces the worker here. */
  onFrame: ((dt: number, now: number) => void) | null;
  /** Freeze visual time (Inspector pause): particles and shake stop. */
  frozen: boolean;
  /** Skip drawing (a full-screen UI tab covers the arena; saves battery). The sim and pacing keep running. */
  renderPaused: boolean;
  /** Re-fit the camera to the canvas (after insets change). */
  fit(): void;
}

function ensureCanvas(): HTMLCanvasElement {
  let canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'game';
    const host = document.getElementById('app') ?? document.body;
    host.insertBefore(canvas, host.firstChild);
  }
  return canvas;
}

/** A static snapshot with only the tower: what you see before the sim is connected. */
function makeIdleSnapshot(): RenderSnapshot {
  const inst = new Float32Array(8 * INSTANCE_FLOATS);
  let n = 0;
  const put = (shape: number, x: number, y: number, r: number, rot: number, cr: number, cg: number, cb: number, a: number, layer: number): void => {
    const o = n++ * INSTANCE_FLOATS;
    inst[o] = x; inst[o + 1] = y; inst[o + 2] = r; inst[o + 3] = rot; inst[o + 4] = shape;
    inst[o + 5] = cr; inst[o + 6] = cg; inst[o + 7] = cb; inst[o + 8] = a; inst[o + 9] = layer;
  };
  put(Shape.Ring, 0, 0, 120, 0, 0.45, 0.85, 1, 0.2, 0);
  put(Shape.Hex, 0, 0, TOWER_RADIUS + 6, 0, 0.27, 0.33, 0.44, 1, 0);
  put(Shape.Ring, 0, 0, TOWER_RADIUS + 9, 0, 0.45, 0.85, 1, 0.8, 0);
  put(Shape.Circle, 0, 0, 9, 0, 0.9, 0.98, 1, 1, 0);
  return { tick: 0, instances: inst, instanceCount: n, fx: new Float32Array(FX_FLOATS), fxCount: 0, cameraShake: 0, clarity: 0 };
}

function boot(): RenderApp | null {
  const canvas = ensureCanvas();
  const ui = document.getElementById('ui');

  if (!Renderer.isSupported()) {
    const msg = document.createElement('div');
    msg.className = 'fatal';
    msg.textContent = 'Project Citadel needs WebGL2, which this browser does not provide.';
    (ui ?? document.body).appendChild(msg);
    return null;
  }

  const renderer = new Renderer(canvas, { maxDpr: 2, arenaRadius: ARENA_RADIUS });
  const camera = new Camera();
  const devOpts = parseDevHash(location.hash);
  const dev = devOpts !== null;
  const harness = dev ? new DevHarness(devOpts ?? {}) : null;
  if (harness) renderer.setSector(harness.opts.sector);

  let latest: RenderSnapshot | null = null;
  const idle = makeIdleSnapshot();

  const fit = (): void => {
    renderer.resize();
    camera.fit(ARENA_RADIUS, renderer.cssWidth, renderer.cssHeight);
  };
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(canvas);

  const input = new Input(canvas, camera, dev ? {
    onTap: (x, y) => console.debug('tap', x.toFixed(1), y.toFixed(1)),
    onAimStart: (a) => console.debug('aim start', a.toFixed(2)),
    onAimEnd: () => console.debug('aim end'),
  } : {});

  const app: RenderApp = {
    canvas, renderer, camera, input,
    setSnapshot(snap) { latest = snap; },
    get snapshot() { return latest; },
    onFrame: null,
    frozen: false,
    renderPaused: false,
    fit,
  };

  // ---- dev overlay
  let overlay: HTMLDivElement | null = null;
  let fpsFrames = 0;
  let fpsAt = performance.now();
  let fpsText = '';
  if (dev && ui) {
    overlay = document.createElement('div');
    overlay.className = 'dev-overlay';
    ui.appendChild(overlay);
  }
  let devFrame = 0;
  let acc = 0;
  let paused = false;
  if (dev) {
    window.addEventListener('keydown', (e) => {
      if (e.key >= '1' && e.key <= '5') renderer.setSector(Number(e.key) - 1);
      else if (e.key === 'c') renderer.setClarity(renderer.getClarity() > 0.5 ? 0 : 1);
      else if (e.key === 'b') renderer.setBloom(!renderer.bloomOn);
      else if (e.key === 'p') paused = !paused;
    });
  }

  let last = performance.now();
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    const rawDt = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.1, rawDt);
    last = now;

    let snap: RenderSnapshot;
    if (harness) {
      if (!paused) {
        acc += dt;
        let steps = 0;
        while (acc >= 1 / 60 && steps < 4) { acc -= 1 / 60; devFrame++; steps++; }
        if (acc > 0.25) acc = 0;
      }
      snap = harness.step(devFrame);
    } else {
      app.onFrame?.(rawDt, now);   // the pacer caps long frames itself
      snap = latest && latest.instances.buffer.byteLength > 0 ? latest : idle;
    }

    if (!app.renderPaused || harness) renderer.render(snap, paused || app.frozen ? 0 : dt, camera);

    fpsFrames++;
    if (now - fpsAt >= 500) {
      const fps = (fpsFrames * 1000) / (now - fpsAt);
      const s = renderer.stats;
      fpsText = `${fps.toFixed(0)} fps | inst ${s.instances} | particles ${s.particles} | draws ${s.drawCalls} | gov ${(s.governor * 100).toFixed(0)}% | bloom ${s.bloomHdr ? 'hdr' : 'rgba8'} | dpr ${renderer.dpr}`;
      if (overlay) overlay.textContent = fpsText + '  [1-5 sector, c clarity, b bloom, p pause]';
      fpsFrames = 0;
      fpsAt = now;
    }
  };
  requestAnimationFrame(loop);

  const debug = { app, harness, game: null as unknown, get fps() { return fpsText; } };
  (window as unknown as { __citadel?: unknown }).__citadel = debug;

  // WP7: the game (SimClient + GameUi) owns everything outside the dev harness.
  if (!dev && ui) {
    startGame(app, ui).then((g) => { debug.game = g; }).catch((e) => {
      console.error('[citadel] failed to start:', e);
      const msg = document.createElement('div');
      msg.className = 'fatal';
      msg.textContent = `Project Citadel failed to start: ${e instanceof Error ? e.message : String(e)}`;
      ui.appendChild(msg);
    });
  }
  return app;
}

export const app: RenderApp | null = boot();
void registerPwa();
