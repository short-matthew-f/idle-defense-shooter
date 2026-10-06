/**
 * Game glue (WP7): loads the save, starts the SimClient worker, paces it from the rAF loop,
 * routes snapshots to the renderer and UiState to the DOM UI (≤ 10 Hz), wires taps / hold-aim,
 * autosaves (every 30 s while visible, at checkpoints, when hidden, and ~2 s after any purchase or choice; a synchronous
 * backup snapshot on pagehide / hidden: app/autosave.ts, app/storage.ts; and a command journal in localStorage that a
 * cold start replays on top of the loaded save, so a purchase is never lost: app/journal.ts) and credits offline time. A new version never
 * reloads the page under the player: it waits for a Restart tap (Game.applyUpdate / UiHost.applyUpdate) or the next
 * cold start, and installs on its own only while the page is hidden and nothing is open or pending.
 *
 * Testing aid: `?fast` (or `?fast=N`, 1–32, default 8) multiplies the tick budget per frame by N so
 * browser playtests under a slow software GPU (SwiftShader) reach later waves quickly. The sim
 * itself is unchanged (same ticks, same determinism); only real-time pacing speeds up.
 */
import { Ev, type RenderSnapshot, type SaveState, type UiState } from '@sim/core/types';
import { sectorIndexForWave } from '@sim/data/sectors';
import { SimClient } from './sim-client';
import { TickPacer, offlineSecondsOnReturn, HIDDEN_OFFLINE_AFTER_S } from './pacing';
import { CRATE_REACH_PX, STICKY_PX, nearestCrate, pickEnemy, tapReach } from './pick';
import { HapticCues } from '@ui/assist-cues';
import { buzz } from '@ui/decision-hold';
import { TapRouter, TOWER_HOLD_PX, holdOnTower } from './active-tap';
import { TOWER_RADIUS } from '@sim/core/types';
import { FieldOverlay } from './overlay';
import { parseCal } from './touch-cal';
import type { Command } from '@sim/core/types';
import { clearBackup, clearSave, exportToString, importFromString, loadSave, parkSave, storeSave, writeBackup } from './storage';
import { clearJournal, readJournal, selectReplay, trimJournal } from './journal';
import { Debouncer, SAVE_DEBOUNCE_MS, savesAfter, updateBlocker } from './autosave';
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
  /** UX Phase 1: a new version is installed and waiting (show "Update ready · Restart"). */
  readonly updateReady: boolean;
  /** Save, then activate the waiting version and reload (the Restart tap). No-op without one. */
  applyUpdate(): Promise<void>;
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
  let replayed = false;
  let paused = false;
  let resetting = false;
  let latestUi: UiState | null = null;
  let lastSave: SaveState | null = save;
  /** The latest save stored, as an export string: written synchronously to the backup on pagehide / hidden. */
  let lastSaveText: string | null = null;
  let updateApply: (() => Promise<void>) | null = null;
  let applying = false;
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

  // Never lose a purchase: a save ~2 s after the last purchase / choice (a burst saves once)
  const saveSoon = new Debouncer(() => { if (ready && !resetting) client.requestSave(); }, SAVE_DEBOUNCE_MS);
  const host: UiHost = {
    send: (cmd) => { client.send(cmd); if (ready && savesAfter(cmd)) saveSoon.poke(); },
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
      saveSoon.cancel();
      clearBackup();
      clearJournal();
      await storeSave(s);
      location.reload();
    },
    hardReset: async () => {
      resetting = true;
      saveSoon.cancel();
      await clearSave();
      clearJournal();
      resetPrefs();
      location.reload();
    },
    setInsets: (t, r, b, l, bias) => { app.camera.setInsets(t, r, b, l, bias); },
    setRenderPaused: (p) => { app.renderPaused = p; audio.director.setScreen(p ? 'other' : 'battle'); },
    canInstall,
    install: promptInstall,
    saveNow: () => { if (ready) client.requestSave(); },
    updateReady: () => updateApply !== null,
    applyUpdate: () => { void applyUpdate(); },
    touch,
    arena: () => {
      const c = app.camera, r = app.canvas.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return null;
      const sx = r.width / c.viewW, sy = r.height / c.viewH, s = c.scale;
      return {
        cx: r.left + (c.centerPx - c.x * s) * sx, cy: r.top + (c.centerPy - c.y * s) * sy,
        r: c.arenaRadius * s * sx, hold: Math.max(TOWER_HOLD_PX, TOWER_RADIUS * s + 10) * sx,
      };
    },
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
      // N-09: re-send the journaled commands the loaded save does not contain (an old save without journalSeq discards them)
      if (!replayed) {
        replayed = true;
        try {
          const entries = readJournal();
          const todo = selectReplay(entries, save?.journalSeq, !save);
          if (todo.length) c.replay(todo); else if (!save || save.journalSeq === undefined) clearJournal();
        } catch { /* never break boot */ }
      }
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
      try { lastSaveText = exportToString(s); } catch { /* keep the previous backup text */ }
      storeSave(s).then(() => trimJournal(s.journalSeq), (e) => console.warn('[save] store failed:', e));
    };
    let lastErr = '';
    let lastCmdErr = '', lastCmdErrAt = 0;
    c.onCmdError = (message, cmd) => {
      cmdErrors.push({ message, cmd });
      if (cmdErrors.length > 100) cmdErrors.shift();
      console.info(`[cmd] ${cmd} rejected: ${message}`);
      const now = performance.now();
      if (message === lastCmdErr && now - lastCmdErrAt < 1500) return;   // no toast spam for repeated taps
      // Phase 3 tap intent: a designation tap whose enemy died or moved between the frame and the sim is silent (the
      // ripple already showed where the tap landed); a toast for it reads as an error the player did not make
      if (cmd === 'designate_at') return;
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
          clearJournal();   // the journal belonged to the broken save
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
    // Phase 3: optional vibration cues (Settings → Vibration cues; only offered where navigator.vibrate exists)
    const u = latestUi;
    const cue = haptics.update(!!u.wave.tellActive && u.wave.tellTicksLeft > 0, u.tower.maxHp > 0 ? u.tower.hp / u.tower.maxHp : 1, u.run.phase === 'combat');
    if (cue && prefs().hapticCues) buzz(cue === 'tell' ? [60, 40, 60] : [90, 60, 90]);
  }
  const haptics = new HapticCues();
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
  /** Hidden / pagehide: the synchronous backup of the latest stored save, then an async fresh save. */
  function onLeave(): void {
    if (resetting) return;
    if (lastSaveText && writeBackup(lastSaveText)) trimJournal(lastSave?.journalSeq);
    saveSoon.cancel();
    if (ready) client.requestSave();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      onLeave();
      if (aiming) endAim();
      maybeApplyWhileHidden();
    } else {
      pacer.reset();
      const secs = hiddenAt ? offlineSecondsOnReturn(hiddenAt, Date.now()) : 0;
      hiddenAt = 0;
      if (secs > 0 && ready) creditOffline(secs);
    }
  });
  window.addEventListener('pagehide', onLeave);
  // New version installed (UX Phase 1, A-10): never reload under the player. It waits for the Restart tap
  // (applyUpdate; the UI shows "Update ready · Restart" from UiHost.updateReady / the 'citadel:update-ready' event)
  // or the next cold start; it installs by itself only while the page is hidden and nothing is open or pending.
  async function applyUpdate(): Promise<void> {
    const apply = updateApply;
    if (!apply || applying) return;
    applying = true;
    saveSoon.cancel();
    try {
      if (ready) { const s = await client.requestSave(); s.savedAtMs = Date.now(); try { if (writeBackup(exportToString(s))) trimJournal(s.journalSeq); } catch { /* best effort */ } await storeSave(s); trimJournal(s.journalSeq); }
    } catch (e) { console.warn('[update] save before reload failed:', e); }
    await apply();
  }
  function currentBlocker(): string | null {
    const u = latestUi;
    const active = document.activeElement;
    const input = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || (active as HTMLElement).isContentEditable);
    let sub = false;
    try { sub = !!ui.walletView().sub; } catch { /* UI not ready */ }
    return updateBlocker({
      phase: u?.run.phase, isBoss: u?.wave.isBoss, input, sub, wave: u?.run.wave, checkpoint: u?.run.checkpoint,
      decision: !!(u?.run.boonOffer?.length || u?.run.pendingDraft?.length),
      dialog: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
    });
  }
  function maybeApplyWhileHidden(): void {
    if (updateApply && document.hidden && ready && currentBlocker() === null) void applyUpdate();
  }
  onUpdateReady((apply) => {
    const first = updateApply === null;
    updateApply = apply;
    if (!first) return;
    ui.toast('Update ready: it installs when you restart the app.', 'info');
    window.dispatchEvent(new CustomEvent('citadel:update-ready'));
    maybeApplyWhileHidden();
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
    // Phase 3: weighted (boss, weak point, elite first) and sticky (a designated enemy within STICKY_PX keeps the tap)
    const hit = live ? pickEnemy(live.instances, live.instanceCount, x, y, tapReach(app.camera.scale), STICKY_PX / Math.max(1e-6, app.camera.scale)) : null;
    // Active edge (docs/ACTIVE.md, app/active-tap.ts): crates first; an enemy tap is an assist shot and a designation
    if (!paused) {
      const f = ui.ctx.features();
      const crate = live && f.salvage ? nearestCrate(live.instances, live.instanceCount, x, y, tapReach(app.camera.scale, CRATE_REACH_PX)) : null;
      const marked = !!hit?.marked;
      const route = taps.route(crate, hit, ui.abilities.arming.armed, app.camera.scale, performance.now(), marked, { assist: f.tapAssist, salvage: f.salvage });
      if (route.kind === 'collect') {
        client.send({ type: 'collect_salvage', x: route.x, y: route.y });
        overlay.tap(route.x, route.y, true, performance.now() / 1000);
        return;
      }
      if (route.kind === 'enemy' && route.assist) client.send({ type: 'tap_assist', x: route.x, y: route.y });
      if (route.kind === 'enemy' && !route.designate) { overlay.tap(route.x, route.y, true, performance.now() / 1000); return; }
    }
    overlay.tap(hit ? hit.x : x, hit ? hit.y : y, !!hit, performance.now() / 1000);   // a ripple on every tap, misses too
    ui.tapField(x, y, hit ? { x: hit.x, y: hit.y } : null);
  };
  // Active edge: hold on the tower while Overcharge is ready charges it; lifting fires (the sim times the window)
  let charging = false;
  app.input.onHoldStart = (x, y) => {
    if (!ready || paused || !latestUi?.active?.overcharge.ready || !ui.ctx.features().overcharge || ui.abilities.arming.armed) return false;
    if (!holdOnTower(x, y, TOWER_RADIUS, app.camera.scale)) return false;
    charging = true;
    client.send({ type: 'overcharge', action: 'charge' });
    ui.active.hold(true);
    return true;
  };
  app.input.onHoldEnd = (cancelled) => {
    if (!charging) return;
    charging = false;
    if (!ui.active.isCharging) return;   // the auto-release assist (or the sim) already let go
    client.send(cancelled ? { type: 'overcharge', action: 'cancel' } : { type: 'overcharge', action: 'release', hold: ui.active.heldSeconds() });
    ui.active.hold(false);
  };
  // Phase 3 tap intent: hold delay from Settings; a short unmoved aim over an enemy or crate is a tap (input.ts)
  app.input.holdDelay = () => prefs().holdDelayMs;
  app.input.tapTarget = (x, y) => {
    const snap = app.snapshot;
    if (!snap || snap.instances.buffer.byteLength === 0) return false;
    return !!pickEnemy(snap.instances, snap.instanceCount, x, y, tapReach(app.camera.scale))
      || (ui.ctx.features().salvage && !!nearestCrate(snap.instances, snap.instanceCount, x, y, tapReach(app.camera.scale, CRATE_REACH_PX)));
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
    get updateReady() { return updateApply !== null; },
    applyUpdate,
  };
}
