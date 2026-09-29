/// <reference types="vite-plugin-pwa/client" />
/**
 * App boot (WP6 skeleton). Creates the canvas, Renderer, Camera and Input, and runs the
 * requestAnimationFrame loop.
 *
 *   index.html#dev            drive the renderer from the synthetic dev harness
 *   index.html#dev:stress     same, at the design budgets (1500 enemies / 4000 projectiles)
 *   index.html#dev:sector=3   pick a Sector palette (0-4); keys 1-5 also switch in dev mode
 *   anything else             empty arena; WP7 connects the SimClient at the marked hook
 *
 * Mounting UI: put DOM in `<div id="ui">` (a sibling layered above the canvas). `#ui` itself has
 * pointer-events: none so taps fall through to the canvas; give interactive children
 * `pointer-events: auto` (base.css already does this for direct children).
 */
import { ARENA_RADIUS, FX_FLOATS, INSTANCE_FLOATS, Shape, TOWER_RADIUS, type RenderSnapshot } from '@sim/core/types';
import { Camera } from '@render/camera';
import { Renderer } from '@render/renderer';
import { DevHarness, parseDevHash } from './dev-harness';
import { Input } from './input';

export interface RenderApp {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  camera: Camera;
  input: Input;
  /** Feed the latest sim snapshot (WP7 calls this from the SimClient 'snapshot' message). */
  setSnapshot(snap: RenderSnapshot | null): void;
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

async function registerPwa(): Promise<void> {
  if (!import.meta.env.PROD) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch (err) {
    console.warn('[pwa] service worker registration skipped:', err);
  }
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

  const input = new Input(canvas, camera, {
    onTap: (x, y) => { if (dev) console.debug('tap', x.toFixed(1), y.toFixed(1)); /* WP7: send designate/cast command */ },
    onAimStart: (a) => { if (dev) console.debug('aim start', a.toFixed(2)); /* WP7: manual_aim active */ },
    onAim: () => { /* WP7: manual_aim angle */ },
    onAimEnd: () => { if (dev) console.debug('aim end'); },
  });

  // WP7: connect SimClient here.
  //   const client = new SimClient(...);
  //   client.onSnapshot = (snap) => app.setSnapshot(snap);
  //   renderer.setClarity(meta.settings.clarity); renderer.setSector(sectorIndexForWave(wave));

  const app: RenderApp = {
    canvas, renderer, camera, input,
    setSnapshot(snap) { latest = snap; },
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
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
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
      snap = latest ?? idle;
    }

    renderer.render(snap, paused ? 0 : dt, camera);

    fpsFrames++;
    if (overlay && now - fpsAt >= 500) {
      const fps = (fpsFrames * 1000) / (now - fpsAt);
      const s = renderer.stats;
      fpsText = `${fps.toFixed(0)} fps | inst ${s.instances} | particles ${s.particles} | draws ${s.drawCalls} | gov ${(s.governor * 100).toFixed(0)}% | bloom ${s.bloomHdr ? 'hdr' : 'rgba8'} | dpr ${renderer.dpr}`;
      overlay.textContent = fpsText + '  [1-5 sector, c clarity, b bloom, p pause]';
      fpsFrames = 0;
      fpsAt = now;
    } else if (now - fpsAt >= 500) { fpsFrames = 0; fpsAt = now; }
  };
  requestAnimationFrame(loop);

  (window as unknown as { __citadel?: unknown }).__citadel = { app, harness, get fps() { return fpsText; } };
  return app;
}

export const app: RenderApp | null = boot();
void registerPwa();
