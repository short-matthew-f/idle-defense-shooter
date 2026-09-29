/**
 * Game glue (WP7): loads the save, starts the SimClient worker, paces it from the rAF loop,
 * routes snapshots to the renderer and UiState to the DOM UI (≤ 10 Hz), wires taps / hold-aim,
 * autosaves (every 30 s, at checkpoints, when hidden) and credits offline time.
 */
import { Ev, type RenderSnapshot, type SaveState, type UiState } from '@sim/core/types';
import { sectorIndexForWave } from '@sim/data/sectors';
import { SimClient } from './sim-client';
import { TickPacer, offlineSecondsOnReturn, HIDDEN_OFFLINE_AFTER_S } from './pacing';
import { nearestEnemy } from './pick';
import { clearSave, exportToString, importFromString, loadSave, parkSave, storeSave } from './storage';
import { canInstall, initInstallPrompt, promptInstall } from './pwa';
import { GameUi } from '@ui/index';
import { prefs, resetPrefs } from '@ui/prefs';
import { offlineEstimate } from '@ui/format';
import type { UiHost } from '@ui/host';
import type { RenderApp } from './main';

const AUTOSAVE_MS = 30_000;
const UI_MIN_INTERVAL_MS = 100;
const AIM_INTERVAL_MS = 50;

export interface Game { client: SimClient; ui: GameUi; readonly paused: boolean; readonly ready: boolean; latestUi(): UiState | null }

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

  app.renderer.setBloom(prefs().bloom);

  const host: UiHost = {
    send: (cmd) => client.send(cmd),
    inspect: (i, g) => client.inspect(i, g),
    setPaused: (p) => { paused = p; app.frozen = p; pacer.reset(); if (p && aiming) endAim(); },
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
    canInstall,
    install: promptInstall,
    saveNow: () => { if (ready) client.requestSave(); },
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
    c.onEvents = (evs) => {
      ui.onEvents(evs);
      if (evs.some((e) => e.type === Ev.Checkpoint || e.type === Ev.Prestige || e.type === Ev.Ascend)) c.requestSave();
    };
    c.onSave = (s) => {
      if (resetting) return;
      s.savedAtMs = Date.now();
      lastSave = s;
      storeSave(s).catch((e) => console.warn('[save] store failed:', e));
    };
    let lastErr = '';
    c.onError = (msg) => {
      console.error('[sim]', msg);
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
      if (head !== lastErr) { lastErr = head; ui.toast(`Simulation error: ${head}`, 'warn'); }
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
  }
  function scheduleUi(): void {
    if (uiTimer) return;
    const wait = Math.max(0, UI_MIN_INTERVAL_MS - (performance.now() - lastUiAt));
    uiTimer = window.setTimeout(pushUi, wait);
  }

  // ---------------------------------------------------------------- pacing
  app.onFrame = (dt) => {
    if (!ready || paused || document.hidden) return;
    const n = pacer.step(dt, latestUi?.run.speedMultiplier ?? 1);
    if (n > 0) client.tickBudget(n);
  };

  // ---------------------------------------------------------------- offline / hidden tab
  function creditOffline(secs: number): void {
    const long = ((latestUi?.meta.prestigeRanks['prestige.long_patrol'] ?? 0) | 0) > 0;
    const est = offlineEstimate(lastSave?.run.patrolScrapPerSecond ?? 0, secs, long);
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
  window.setInterval(() => { if (ready && !document.hidden) client.requestSave(); }, AUTOSAVE_MS);

  // ---------------------------------------------------------------- input
  let aiming = false, aimAngle = 0, lastAimAt = 0, aimTimer = 0;
  const sendAim = (): void => { aimTimer = 0; lastAimAt = performance.now(); client.send({ type: 'manual_aim', active: true, angle: aimAngle }); };
  function endAim(): void {
    aiming = false;
    if (aimTimer) { clearTimeout(aimTimer); aimTimer = 0; }
    client.send({ type: 'manual_aim', active: false, angle: aimAngle });
    document.body.classList.remove('aiming');
  }
  app.input.onTap = (x, y) => {
    if (!ready) return;
    const snap = app.snapshot;
    const hit = snap && snap.instances.buffer.byteLength > 0 ? nearestEnemy(snap.instances, snap.instanceCount, x, y) : null;
    ui.tapField(x, y, hit ? hit.index : null);
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
  };
}
