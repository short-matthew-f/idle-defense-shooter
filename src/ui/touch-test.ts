/**
 * Touch test and tap calibration (More → Help → Touch test; docs/TOUCH.md).
 *
 * A full-screen layer over the live canvas (the rest of the UI hides, the field pauses). Every canvas
 * pointer goes to the test instead of the game (Input.probe):
 *   (a) a DOM crosshair at clientX / clientY (CSS, position: fixed): where the browser says you touched
 *   (b) a magenta ring the WebGL canvas draws at the world point the game computed for that touch
 *       (pointer → camera.toWorld, drawn through the renderer's overlay path like every other marker)
 *   (c) the numbers: client / page / screen / offset, visual viewport, innerHeight, scroll, the canvas box,
 *       the camera view and centre, the world point and the (b) − (a) difference in CSS px.
 * The last 10 taps are logged; Copy puts them (with the device header) on the clipboard.
 *
 * Calibrate taps: three rings drawn by the canvas (top, middle, bottom); the player taps the centre of
 * each and a per-axis linear correction is fitted (touch-cal.ts) and stored in prefs `touchCal`.
 */
import '../styles/touch.css';
import { button, h, text } from './dom';
import { setPref } from './prefs';
import type { UiCtx } from './ctx';
import type { TouchMarker } from './host';
import type { ProbeSample } from '@app/input';
import { describeCal, fitCalibration, type CalPair } from '@app/touch-cal';

const LOG_MAX = 10;
/** Calibration rings: fractions of the canvas box (x, y), spread over the height and off the tower. */
const TARGETS: readonly (readonly [number, number])[] = [[0.64, 0.24], [0.3, 0.5], [0.66, 0.76]];

let openNow: (() => void) | null = null;

const f1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
const f0 = (v: number): string => String(Math.round(v));

export function openTouchTest(ctx: UiCtx): void {
  if (openNow) return;
  const host = ctx.host, touch = host.touch;
  const root = document.getElementById('ui') ?? document.body;
  const t0 = performance.now();

  // ---------------------------------------------------------------- DOM
  const read = h('pre', { class: 'tt-read', attrs: { 'aria-live': 'polite' } });
  const hint = h('p', { class: 'tt-hint' });
  const calLine = h('p', { class: 'tt-cal' });
  const cross = h('div', { class: 'tt-cross', attrs: { 'aria-hidden': 'true' } });
  cross.hidden = true;
  const copyBtn = button('Copy log', () => void copyLog(), { class: 'btn' });
  const calBtn = button('Calibrate taps', () => startCal(), { class: 'btn primary' });
  const resetBtn = button('Reset calibration', () => resetCal(), { class: 'btn' });
  const closeBtn = button('Close', () => close(), { class: 'btn' });
  const cancelBtn = button('Cancel calibration', () => endCal(null), { class: 'btn' });
  cancelBtn.hidden = true;
  const legend = h('p', { class: 'tt-legend' },
    h('span', { class: 'tt-key cross', attrs: { 'aria-hidden': 'true' } }), 'where the browser says you touched  ',
    h('span', { class: 'tt-key ring', attrs: { 'aria-hidden': 'true' } }), 'where the game read it (drawn by the canvas)');
  const top = h('div', { class: 'tt-top' },
    h('div', { class: 'tt-title' }, h('strong', { text: 'Touch test' }), hint),
    calLine, legend, read);
  const bar = h('div', { class: 'tt-bar' }, calBtn, resetBtn, copyBtn, closeBtn, cancelBtn);
  const el = h('div', { class: 'touch-test', attrs: { role: 'dialog', 'aria-label': 'Touch test' } }, top, cross, bar);

  // ---------------------------------------------------------------- state
  const log: string[] = [];
  let taps = 0;
  let calPairs: CalPair[] | null = null;
  let targets: { x: number; y: number }[] = [];
  let tapMarker: TouchMarker | null = null;
  const prevPaused = host.isPaused();

  const env = (): string => {
    const vv = window.visualViewport;
    return `vv ${vv ? `${f0(vv.width)}×${f0(vv.height)} top ${f1(vv.offsetTop)} pageTop ${f1(vv.pageTop)} scale ${vv.scale}` : 'n/a'}  inner ${innerWidth}×${innerHeight}  scrollY ${f1(window.scrollY)}`;
  };
  const viewLine = (): string[] => {
    const v = touch.view(), r = v.rect;
    return [
      `canvas ${f1(r.left)},${f1(r.top)} ${f1(r.width)}×${f1(r.height)}  camera ${v.viewW}×${v.viewH}`,
      `centre ${f1(v.centerPx)},${f1(v.centerPy)}  dpr ${v.dpr} buf ${v.bufferW}×${v.bufferH}  zoom ${v.zoom.toFixed(2)} punch ${v.punch.toFixed(3)}`,
      ...(v.staleCount ? [`size mismatches this session: ${v.staleCount} (${v.lastStale})`] : []),
    ];
  };
  /** Keep the document unscrolled: iOS can scroll a position: fixed app by a few px. */
  const scrollCheck = (): string => {
    const se = document.scrollingElement;
    const off = Math.max(Math.abs(window.scrollY), Math.abs(window.scrollX), se ? Math.abs(se.scrollTop) : 0, Math.abs(document.body.scrollTop));
    const app = document.getElementById('app')?.getBoundingClientRect();
    const appTop = app ? app.top : 0;
    if (off > 0 || Math.abs(appTop) > 0.5) {
      window.scrollTo(0, 0);
      if (se) se.scrollTop = 0;
      document.body.scrollTop = 0;
      return `document was scrolled by ${f1(off)} px (#app top ${f1(appTop)}): reset to 0`;
    }
    return 'document not scrolled';
  };
  const idle = (): void => {
    text(read, [env(), ...viewLine(), scrollCheck()].join('\n'));
  };
  const showCal = (msg = ''): void => {
    const c = touch.calibration();
    text(calLine, `${msg ? `${msg}\n` : ''}Calibration: ${describeCal(c)}`);
    resetBtn.disabled = c === null;
  };
  const markers = (): void => {
    const m: TouchMarker[] = [];
    if (calPairs) targets.forEach((t, i) => m.push({ x: t.x, y: t.y, kind: i === calPairs!.length ? 'target' : 'target-dim' }));
    if (tapMarker) m.push(tapMarker);
    touch.setMarkers(m);
    el.dataset.targets = JSON.stringify(calPairs ? targets.map((t) => { const c = touch.toClient(t.x, t.y); return [+f1(c.x), +f1(c.y)]; }) : []);
  };

  // ---------------------------------------------------------------- samples
  const onSample = (s: ProbeSample): void => {
    cross.hidden = false;
    cross.style.transform = `translate(${s.clientX}px, ${s.clientY}px)`;
    tapMarker = { x: s.worldX, y: s.worldY, kind: 'tap' };
    const b = touch.toClient(s.worldX, s.worldY);
    const dx = b.x - s.clientX, dy = b.y - s.clientY;
    el.dataset.last = JSON.stringify({ cx: s.clientX, cy: s.clientY, bx: +b.x.toFixed(2), by: +b.y.toFixed(2), wx: +s.worldX.toFixed(2), wy: +s.worldY.toFixed(2) });
    const lines = [
      `client ${f1(s.clientX)},${f1(s.clientY)}  page ${f1(s.pageX)},${f1(s.pageY)}`,
      `screen ${f1(s.screenX)},${f1(s.screenY)}  offset ${f1(s.offsetX)},${f1(s.offsetY)}  ${s.pointerType}`,
      env(),
      ...viewLine(),
      `world ${f1(s.worldX)},${f1(s.worldY)}  canvas ring − cross: Δx ${f1(dx)} Δy ${f1(dy)} px`,
      scrollCheck(),
    ];
    text(read, lines.join('\n'));
    if (s.phase === 'down') {
      taps++;
      const v = touch.view(), r = v.rect;
      log.push(`#${taps} t=${((performance.now() - t0) / 1000).toFixed(1)}s ${s.pointerType} client ${f1(s.clientX)},${f1(s.clientY)} page ${f1(s.pageX)},${f1(s.pageY)} screen ${f1(s.screenX)},${f1(s.screenY)} offset ${f1(s.offsetX)},${f1(s.offsetY)} | ${env()} | rect ${f1(r.left)},${f1(r.top)} ${f1(r.width)}x${f1(r.height)} cam ${v.viewW}x${v.viewH} centre ${f1(v.centerPx)},${f1(v.centerPy)} zoom ${v.zoom.toFixed(2)} punch ${v.punch.toFixed(3)} | raw ${f1(s.rawX)},${f1(s.rawY)} cal ${f1(s.calX)},${f1(s.calY)} world ${f1(s.worldX)},${f1(s.worldY)} | ring-cross ${f1(dx)},${f1(dy)}`);
      if (log.length > LOG_MAX) log.shift();
      text(copyBtn, `Copy log (${log.length})`);
      if (calPairs) calTap(s);
    }
    markers();
  };

  // ---------------------------------------------------------------- calibration
  function startCal(): void {
    const v = touch.view(), r = v.rect;
    targets = TARGETS.map(([fx, fy]) => touch.fromClient(r.left + fx * r.width, r.top + fy * r.height));
    calPairs = [];
    tapMarker = null;
    cross.hidden = true;
    el.classList.add('calibrating');
    for (const b of [calBtn, resetBtn, copyBtn, closeBtn]) b.hidden = true;
    cancelBtn.hidden = false;
    text(hint, 'Tap the centre of ring 1 of 3 (the bright one).');
    markers();
  }
  function calTap(s: ProbeSample): void {
    if (!calPairs) return;
    const t = targets[calPairs.length];
    const want = touch.toClient(t.x, t.y);
    calPairs.push({ tapX: s.rawX, tapY: s.rawY, wantX: want.x - s.rect.left, wantY: want.y - s.rect.top });
    if (calPairs.length < targets.length) { text(hint, `Tap the centre of ring ${calPairs.length + 1} of 3.`); return; }
    const fit = fitCalibration(calPairs);
    const pairs = calPairs.map((p) => `(${f1(p.tapX)},${f1(p.tapY)})→(${f1(p.wantX)},${f1(p.wantY)})`).join(' ');
    log.push(`calibration ${fit.verdict}: ${describeCal(fit.cal)} shift ${f1(fit.maxShift)} residual ${f1(fit.maxResidual)} | ${pairs}`);
    if (log.length > LOG_MAX) log.shift();
    let msg: string;
    if (fit.verdict === 'accurate') {
      touch.setCalibration(null); setPref('touchCal', null);
      msg = `Your taps are accurate (within ${f1(fit.maxShift)} px). Nothing stored.`;
    } else if (fit.verdict === 'ok') {
      touch.setCalibration(fit.cal); setPref('touchCal', fit.cal);
      msg = `Calibrated: taps move by up to ${f1(fit.maxShift)} px. Saved on this device.`;
    } else if (fit.verdict === 'inconsistent') {
      msg = `Those taps disagree by up to ${f1(fit.maxResidual)} px: tap the centre of each ring. Nothing stored; try again.`;
    } else {
      msg = `That would move taps by ${f0(fit.maxShift)} px, too far for a calibration. Nothing stored.`;
    }
    endCal(msg);
  }
  function endCal(msg: string | null): void {
    calPairs = null;
    el.classList.remove('calibrating');
    for (const b of [calBtn, resetBtn, copyBtn, closeBtn]) b.hidden = false;
    cancelBtn.hidden = true;
    text(hint, 'Tap anywhere on the field.');
    el.dataset.result = msg ?? '';
    showCal(msg ?? '');
    markers();
  }
  function resetCal(): void {
    touch.setCalibration(null);
    setPref('touchCal', null);
    showCal('Calibration reset: taps are read as the browser reports them.');
  }

  // ---------------------------------------------------------------- copy / close
  async function copyLog(): Promise<void> {
    const nav = navigator as Navigator & { standalone?: boolean };
    const head = [
      `Project Citadel touch log  ${new Date().toISOString()}`,
      navigator.userAgent,
      `screen ${screen.width}×${screen.height}  dpr ${devicePixelRatio}  standalone ${String(nav.standalone)}  ${env()}`,
      ...viewLine(),
      `calibration ${describeCal(touch.calibration())}`,
    ];
    const body = [...head, ...(log.length ? log : ['(no taps yet)'])].join('\n');
    let ok = false;
    try { await navigator.clipboard.writeText(body); ok = true; } catch { /* fall back below */ }
    if (!ok) {
      const ta = h('textarea', { class: 'tt-copy', attrs: { readonly: '' } });
      ta.value = body;
      top.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      if (ok) ta.remove();
    }
    ctx.toast(ok ? 'Touch log copied' : 'Copy failed: select the text in the box and copy it', ok ? 'good' : 'warn');
  }

  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (calPairs) endCal(null); else close(); } };
  const onPop = (): void => close();
  const onResize = (): void => { if (!calPairs && !tapMarker) idle(); };
  function close(): void {
    if (!openNow) return;
    openNow = null;
    touch.end();
    host.setPaused(prevPaused);
    document.body.classList.remove('touch-testing');
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('resize', onResize);
    el.remove();
  }

  // ---------------------------------------------------------------- open
  openNow = close;
  window.scrollTo(0, 0);
  root.appendChild(el);
  document.body.classList.add('touch-testing');
  host.setPaused(true);
  touch.begin(onSample);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('popstate', onPop);
  window.addEventListener('resize', onResize);
  text(hint, 'Tap anywhere on the field.');
  idle();
  showCal();
  markers();
  calBtn.focus();
}

/** Close the touch test if it is open (tests, navigation). */
export function closeTouchTest(): void { openNow?.(); }
