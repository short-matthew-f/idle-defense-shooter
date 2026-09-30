/**
 * Game glue (WP7): loads the save, starts the SimClient worker, paces it from the rAF loop,
 * routes snapshots to the renderer and UiState to the DOM UI (≤ 10 Hz), wires taps / hold-aim,
 * autosaves (every 30 s, at checkpoints, when hidden) and credits offline time.
 *
 * Testing aid: `?fast` (or `?fast=N`, 1–32, default 8) multiplies the tick budget per frame by N so
 * browser playtests under a slow software GPU (SwiftShader) reach later waves quickly. The sim
 * itself is unchanged (same ticks, same determinism); only real-time pacing speeds up.
 */
import { Ev, type RenderSnapshot, type SaveState, type UiState } from '@sim/core/types';
import { sectorIndexForWave } from '@sim/data/sectors';
import { SimClient } from './sim-client';
import { TickPacer, offlineSecondsOnReturn, HIDDEN_OFFLINE_AFTER_S } from './pacing';
import { CRATE_REACH_PX, nearestCrate, nearestEnemy, tapReach } from './pick';
import { TapRouter, holdOnTower } from './active-tap';
import { TOWER_RADIUS } from '@sim/core/types';
import { FieldOverlay } from './overlay';
import { parseCal } from './touch-cal';
import type { Command } from '@sim/core/types';
import { clearSave, exportToString, importFromString, loadSave, parkSave, storeSave } from './storage';
import { canInstall, initInstallPrompt, promptInstall, onUpdateReady } from './pwa';
import { GameUi } from '@ui/index';
import { createGameAudio, type GameAudio } from '../audio/index';
import { prefs, resetPrefs } from '@ui/prefs';
import { offlineEstimate } from '@ui/format';
import type { TouchHost, UiHost } from '@ui/host';
import type { RenderApp } from './main';

const AUTOSAVE_MS = 30_000;
const UI_MIN_INTERVAL_MS = 100;
const AIM_INTERVAL_MS = 50;
const UPDATE_APPLY_MAX_WAIT_MS = 30_000;

export interface Game {
  client: SimClient; ui: GameUi; readonly paused: boolean; readonly ready: boolean; latestUi(): UiState | null;
  /** Rejected player commands and sim errors seen this session (debug / playtest aid). */
  readonly cmdErrors: readonly { message: string; cmd: Command['type'] }[];
  readonly simErrors: readonly string[];
  /** Tick-budget multiplier from `?fast` (1 = normal); `setFast` changes it at runtime (playtests). */
  readonly fast: number;
  setFast(n: number): void;
  /** Audio pass: the sound runtime (levels, mute, diagnostics). */
  readonly audio: GameAudio;
}

/** `?fast` / `?fast=N` query param → tick-budget multiplier (1 when absent). */
export function fastFactor(search: string): number {
  const p = new URLSearchParams(search);
  if (!p.has('fast')) return 1;
  const v = Number(p.get('fast') || 8);
  return Number.isFinite(v) ? Math.max(1, Math.min(32, Math.floor(v))) : 8;
}

export async function startGame(app: RenderApp, uiRoot: HTMLElement): Promise<Game> {
  initInstallPrompt();
  let save: SaveState | null = null;
  try { save = await loadSave(); } catch (e) { console.warn('[save] load failed:', e); }

  let client = new SimClient(save);
  let ready = false;
  let paused = false;
  let resetting = false;
  let latestUi: UiState | null = null;
  let lastSave: SaveState | null = save;
  let sector = -1;
  let hiddenAt = 0;
  const pacer = new TickPacer();
  let fast = fastFactor(location.search);
  const cmdErrors: { message: string; cmd: Command['type'] }[] = [];
  const simErrors: string[] = [];

  app.renderer.setBloom(prefs().bloom);
  // audio pass: lazy Web Audio (unlocked by the first tap); a silent no-op without Web Audio
  const audio = createGameAudio();

  // ---------------------------------------------------------------- touch test / tap calibration
  const overlay = new FieldOverlay();
  app.input.calibration = parseCal(prefs().touchCal);
  const boxScale = (): { r: DOMRect; kx: number; ky: number } => {
    const r = app.canvas.getBoundingClientRect(), c = app.camera;
    return { r, kx: c.viewW > 0 ? r.width / c.viewW : 1, ky: c.viewH > 0 ? r.height / c.viewH : 1 };
  };
  const touch: TouchHost = {
    begin: (onSample) => { app.input.probe = onSample; app.forceRender = true; },
    end: () => { app.input.probe = null; app.forceRender = false; overlay.setMarkers([]); },
    setMarkers: (m) => overlay.setMarkers(m),
    toClient: (wx, wy) => {
      const { r, kx, ky } = boxScale();
      const p = app.camera.toScreen(wx, wy, { x: 0, y: 0 });
      return { x: r.left + p.x * kx, y: r.top + p.y * ky };
    },
    fromClient: (cx, cy) => {
      const { r, kx, ky } = boxScale();
      return app.camera.toWorld((cx - r.left) / kx, (cy - r.top) / ky, { x: 0, y: 0 });
    },
    view: () => {
      const r = app.canvas.getBoundingClientRect(), c = app.camera;
      return {
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        viewW: c.viewW, viewH: c.viewH, centerPx: c.centerPx, centerPy: c.centerPy,
        scale: c.scale, punch: c.punch, shakeX: c.shakeX, shakeY: c.shakeY, zoom: c.zoom,
        dpr: window.devicePixelRatio || 1, bufferW: app.canvas.width, bufferH: app.canvas.height,
        staleCount: app.input.staleCount, lastStale: app.input.lastStale,
      };
    },
    calibration: () => app.input.calibration,
    setCalibration: (c) => { app.input.calibration = c; },
  };

  const host: UiHost = {
    send: (cmd) => client.send(cmd),
    inspect: (i, g) => client.inspect(i, g),
    setPaused: (p) => { paused = p; app.frozen = p; pacer.reset(); if (p && aiming) endAim(); audio.director.setPaused(p); },
    isPaused: () => paused,
    setClarity: (v) => { app.renderer.setClarity(v); client.setClarity(v); },
    setBloom: (on) => app.renderer.setBloom(on),
    bloomOn: () => app.renderer.bloomOn,
    exportSave: async () => { const s = await client.requestSave(); s.savedAtMs = Date.now(); return exportToString(s); },
    importSave: async (text) => {
      const s = importFromString(text);
      resetting = true;
      await storeSave(s);
      location.reload();
    },
    hardReset: async () => {
      resetting = true;
      await clearSave();
      resetPrefs();
      location.reload();
    },
    setInsets: (t, r, b, l) => { app.camera.setInsets(t, r, b, l); },
    setRenderPaused: (p) => { app.renderPaused = p; audio.director.setScreen(p ? 'other' : 'battle'); },
    canInstall,
    install: promptInstall,
    saveNow: () => { if (ready) client.requestSave(); },
    touch,
  };

  const ui = new GameUi(uiRoot, host);

  // ---------------------------------------------------------------- worker wiring
  const wire = (c: SimClient): void => {
    c.onSnapshot = (snap: RenderSnapshot) => {
      const prev = app.snapshot;
      app.setSnapshot(snap);
      if (prev && prev !== snap && prev.instances.buffer.byteLength > 0) c.releaseSnapshot(prev);
    };
    c.onReady = (s) => {
      ready = true;
      latestUi = s;
      app.renderer.setClarity(s.meta.settings.clarity);
      syncSector(s);
      ui.onReady(s);
      c.wantSnapshot();
      // cold-start offline credit
      if (save && save.savedAtMs > 0) {
        const secs = (Date.now() - save.savedAtMs) / 1000;
        if (secs >= HIDDEN_OFFLINE_AFTER_S) creditOffline(secs);
      }
    };
    c.onUi = (s) => { latestUi = s; scheduleUi(); };
    c.onEvents = (evs, digest) => {
      if (evs.length) {
        ui.onEvents(evs);
        if (evs.some((e) => e.type === Ev.Checkpoint || e.type === Ev.Prestige || e.type === Ev.Ascend)) c.requestSave();
      }
      audio.director.onEvents(evs, digest);
    };
    c.onSave = (s) => {
      if (resetting) return;
      s.savedAtMs = Date.now();
      lastSave = s;
      storeSave(s).catch((e) => console.warn('[save] store failed:', e));
    };
    let lastErr = '';
    let lastCmdErr = '', lastCmdErrAt = 0;
    c.onCmdError = (message, cmd) => {
      cmdErrors.push({ message, cmd });
      if (cmdErrors.length > 100) cmdErrors.shift();
      console.info(`[cmd] ${cmd} rejected: ${message}`);
      const now = performance.now();
      if (message === lastCmdErr && now - lastCmdErrAt < 1500) return;   // no toast spam for repeated taps
      lastCmdErr = message; lastCmdErrAt = now;
      ui.toast(message, 'warn');
    };
    c.onError = (msg, stack) => {
      simErrors.push(msg);
      console.error('[sim]', msg, stack ?? '');
      if (!ready && save) {
        // The save crashed the sim on init: park it (never overwritten) and start fresh.
        const bad = save; save = null;
        void parkSave(bad, 'broken').then(() => {
          c.terminate();
          client = new SimClient(null);
          wire(client);
          ui.toast('Your save could not be loaded. A backup was kept; starting fresh.', 'warn');
        });
        return;
      }
      const head = msg.split('\n')[0];
      if (head !== lastErr) { lastErr = head; ui.toast(`Simulation error (recovering): ${head}`, 'warn'); }
    };
  };
  wire(client);

  function syncSector(s: UiState): void {
    const si = sectorIndexForWave(s.run.wave);
    if (si !== sector) { sector = si; app.renderer.setSector(si); }
  }

  // ---------------------------------------------------------------- UI throttle (≤ 10 Hz)
  let uiTimer = 0, lastUiAt = 0;
  function pushUi(): void {
    uiTimer = 0;
    lastUiAt = performance.now();
    if (!latestUi) return;
    syncSector(latestUi);
    ui.update(latestUi);
    audio.director.setSimSpeed(latestUi.run.speedMultiplier * fast);
    audio.director.onUi(latestUi);
  }
  function scheduleUi(): void {
    if (uiTimer) return;
    const wait = Math.max(0, UI_MIN_INTERVAL_MS - (performance.now() - lastUiAt));
    uiTimer = window.setTimeout(pushUi, wait);
  }

  // ---------------------------------------------------------------- pacing
  app.onFrame = (dt, now) => {
    const snap = app.snapshot;
    const live = snap && snap.instances.buffer.byteLength > 0 ? snap : null;
    const on = overlay.build(live ? live.instances : null, live ? live.instanceCount : 0, app.camera.scale, now / 1000, aiming ? aimAngle : null);
    app.renderer.setOverlay(overlay.buf, on);
    if (!ready || paused || document.hidden) return;
    const n = pacer.step(dt, (latestUi?.run.speedMultiplier ?? 1) * fast);
    if (n > 0) client.tickBudget(n);
  };

  // ---------------------------------------------------------------- offline / hidden tab
  function creditOffline(secs: number): void {
    const long = (latestUi?.meta.prestigeRanks['prestige.long_patrol'] ?? 0) | 0;   // rank: each adds 4 h of cap and 7.5 points of efficiency
    const est = offlineEstimate(latestUi?.run.patrolScrapPerSecond ?? lastSave?.run.patrolScrapPerSecond ?? 0, secs, long);
    client.send({ type: 'offline_return', elapsedSeconds: secs });
    ui.expectOffline(secs, est);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      if (ready) client.requestSave();
      if (aiming) endAim();
    } else {
      pacer.reset();
      const secs = hiddenAt ? offlineSecondsOnReturn(hiddenAt, Date.now()) : 0;
      hiddenAt = 0;
      if (secs > 0 && ready) creditOffline(secs);
    }
  });
  window.addEventListener('pagehide', () => { if (ready) client.requestSave(); });
  // New version installed: reload at a quiet moment (between waves, or after 30 s at most), after saving.
  onUpdateReady((apply) => {
    ui.toast('A new version is ready; it installs between waves.', 'info');
    const started = Date.now();
    let applying = false;
    const tryApply = (): void => {
      if (applying) return;
      const phase = latestUi?.run.phase;
      const quiet = !ready || phase === 'between' || phase === 'dead' || phase === 'wave_clear';
      if (!quiet && Date.now() - started < UPDATE_APPLY_MAX_WAIT_MS) { window.setTimeout(tryApply, 1000); return; }
      applying = true;
      const go = (): void => { void apply(); };
      if (ready) client.requestSave().then((s) => { s.savedAtMs = Date.now(); return storeSave(s); }).then(go, go);
      else go();
    };
    tryApply();
  });
  window.setInterval(() => { if (ready && !document.hidden) client.requestSave(); }, AUTOSAVE_MS);

  // ---------------------------------------------------------------- input
  let aiming = false, aimAngle = 0, lastAimAt = 0, aimTimer = 0;
  const taps = new TapRouter();
  const sendAim = (): void => { aimTimer = 0; lastAimAt = performance.now(); client.send({ type: 'manual_aim', active: true, angle: aimAngle }); };
  function endAim(): void {
    aiming = false;
    if (aimTimer) { clearTimeout(aimTimer); aimTimer = 0; }
    client.send({ type: 'manual_aim', active: false, angle: aimAngle });
    document.body.classList.remove('aiming');
  }
  app.input.onTap = (x, y) => {
    if (!ready) return;
    // The sim resolves which enemy a tap means (designate_at); the drawn snapshot only gates the tap
    // (was an enemy near?) and snaps ability casts onto the tapped enemy (aim assist).
    // Reach is at least ~22 CSS px (a thumb), not 24 world units (under 8 px on a phone).
    const snap = app.snapshot;
    const live = snap && snap.instances.buffer.byteLength > 0 ? snap : null;
    const hit = live ? nearestEnemy(live.instances, live.instanceCount, x, y, tapReach(app.camera.scale)) : null;
    // Active edge (docs/ACTIVE.md, app/active-tap.ts): crates first; an enemy tap is an assist shot and a designation
    if (!paused) {
      const crate = live ? nearestCrate(live.instances, live.instanceCount, x, y, tapReach(app.camera.scale, CRATE_REACH_PX)) : null;
      const route = taps.route(crate, hit, ui.abilities.arming.armed, app.camera.scale, performance.now());
      if (route.kind === 'collect') {
        client.send({ type: 'collect_salvage', x: route.x, y: route.y });
        overlay.tap(route.x, route.y, true, performance.now() / 1000);
        return;
      }
      if (route.kind === 'enemy' && route.assist) client.send({ type: 'tap_assist', x: route.x, y: route.y });
      if (route.kind === 'enemy' && !route.designate) { overlay.tap(route.x, route.y, true, performance.now() / 1000); return; }
    }
    if (!paused) overlay.tap(hit ? hit.x : x, hit ? hit.y : y, !!hit, performance.now() / 1000);
    ui.tapField(x, y, hit ? { x: hit.x, y: hit.y } : null);
  };
  // Active edge: hold on the tower while Overcharge is ready charges it; lifting fires (the sim times the window)
  let charging = false;
  app.input.onHoldStart = (x, y) => {
    if (!ready || paused || !latestUi?.active?.overcharge.ready || ui.abilities.arming.armed) return false;
    if (!holdOnTower(x, y, TOWER_RADIUS, app.camera.scale)) return false;
    charging = true;
    client.send({ type: 'overcharge', action: 'charge' });
    ui.active.hold(true);
    return true;
  };
  app.input.onHoldEnd = (cancelled) => {
    if (!charging) return;
    charging = false;
    client.send(cancelled ? { type: 'overcharge', action: 'cancel' } : { type: 'overcharge', action: 'release', hold: ui.active.heldSeconds() });
    ui.active.hold(false);
  };
  app.input.onAimStart = (a) => {
    if (!ready || paused) return;
    aiming = true; aimAngle = a;
    document.body.classList.add('aiming');
    sendAim();
  };
  app.input.onAim = (a) => {
    if (!aiming) return;
    aimAngle = a;
    const since = performance.now() - lastAimAt;
    if (since >= AIM_INTERVAL_MS) sendAim();
    else if (!aimTimer) aimTimer = window.setTimeout(sendAim, AIM_INTERVAL_MS - since);
  };
  app.input.onAimEnd = () => { if (aiming) endAim(); };

  return {
    get client() { return client; },
    ui,
    get paused() { return paused; },
    get ready() { return ready; },
    latestUi: () => latestUi,
    cmdErrors,
    simErrors,
    get fast() { return fast; },
    setFast: (n: number) => { fast = Math.max(1, Math.min(32, Math.floor(n) || 1)); pacer.reset(); },
    audio,
  };
}
