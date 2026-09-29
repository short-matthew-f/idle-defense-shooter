#!/usr/bin/env node
// Readability check at wave-62 density (graphics pass). Needs a build (`npm run build`), then:
//   node tests/render/readability.mjs [--samples N] [--port 4193] [--url http://host/base/]
// Generates a wave-62 save (tests/render/gen-save.ts), plays it in Chromium at 1280×800 and at 390×844 (touch),
// freezes the sim and visual time, and for every enemy body measures the WCAG luminance contrast between its
// silhouette rim (55–85 % of the radius) and the ring just outside it (outline + knockout zone), skipping points
// that fall on other enemies. "Over effects" = enemies whose wider surroundings are lit by player effects.
// Pass: median ≥ 1.6, ≥ 30 % of enemies ≥ 2:1, and median over effects ≥ 1.5, on both viewports.
// Environment: PLAYWRIGHT_DIR, CHROMIUM as in tests/e2e/e2e.mjs.
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'tests', 'e2e', 'out');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SAMPLES = Number(arg('--samples', 4));

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, ROOT, (() => { try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return null; } })(), '/opt/node22/lib/node_modules'].filter(Boolean);
  for (const d of dirs) { try { return createRequire(join(d, 'noop.js'))('playwright'); } catch { /* next */ } }
  throw new Error('playwright not found');
}
const { chromium } = loadPlaywright();
const CHROMIUM = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

const savePath = join(OUT, 'save-w62.json');
if (!existsSync(savePath)) execSync(`npx tsx tests/render/gen-save.ts 62 ${savePath}`, { cwd: ROOT, stdio: 'inherit' });

let server = null;
let BASE = arg('--url', null);
if (!BASE) {
  const PORT = Number(arg('--port', 4193));
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  BASE = `http://localhost:${PORT}/idle-defense-shooter/`;
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(BASE); if (r.ok) break; } catch { /* not yet */ }
    if (Date.now() - t0 > 30000) { server.kill(); throw new Error('vite preview did not start'); }
    await new Promise((r) => setTimeout(r, 300));
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const VIEWPORTS = { desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true } };
const uiOf = (page) => page.evaluate(() => { const u = window.__citadel?.game?.latestUi?.(); return u ? { phase: u.run.phase, alive: u.wave.enemiesAlive } : null; });
async function waitUi(page, pred, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const u = await uiOf(page); if (u && pred(u)) return u; await page.waitForTimeout(200); } return null; }

async function measure(vpName) {
  const ctx = await browser.newContext(VIEWPORTS[vpName]);
  const page = await ctx.newPage();
  const save = JSON.parse(readFileSync(savePath, 'utf8'));
  save.savedAtMs = Date.now();
  await page.goto(BASE + 'icons/icon-192.png');
  await page.evaluate(async (save) => {
    localStorage.setItem('citadel.prefs.v1', JSON.stringify({ onboarded: true }));
    localStorage.setItem('citadel.gfx.v1', JSON.stringify({ quality: 'high', auto: false }));
    await new Promise((res, rej) => {
      const r = indexedDB.open('citadel', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('saves')) r.result.createObjectStore('saves'); };
      r.onsuccess = () => { const t = r.result.transaction('saves', 'readwrite'); t.objectStore('saves').put(save, 'main'); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
      r.onerror = () => rej(r.error);
    });
  }, save);
  await page.goto(BASE + '?fast=2');
  await page.waitForFunction(() => !!window.__citadel?.game?.ready, null, { timeout: 60000 });
  const results = [];
  for (let s = 0; s < SAMPLES; s++) {
    await waitUi(page, (u) => u.phase === 'combat' && u.alive >= 12, 120000);
    await page.waitForTimeout(1200 + s * 700);
    const bodies = await page.evaluate(() => {
      const c = window.__citadel; c.app.frozen = true; c.game.client.setRunning(false);
      return new Promise((res) => setTimeout(() => {
        const snap = c.app.snapshot, cam = c.app.camera, rect = c.app.canvas.getBoundingClientRect();
        const out = [];
        for (let i = 0; i < snap.instanceCount; i++) {
          const o = i * 12;
          if (snap.instances[o + 9] !== 4) continue;
          const p = cam.toScreen(snap.instances[o], snap.instances[o + 1]);
          out.push({ x: rect.left + p.x, y: rect.top + p.y, r: Math.max(snap.instances[o + 2] * cam.scale, 3.5), a: snap.instances[o + 8] });
        }
        res(out);
      }, 400));
    });
    const png = await page.screenshot();
    const stats = await page.evaluate(async ({ b64, bodies, vw, vh }) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
      const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
      const D = g.getImageData(0, 0, im.width, im.height).data;
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const L = (x, y) => { const k = (Math.round(y) * im.width + Math.round(x)) * 4; return 0.2126 * lin(D[k]) + 0.7152 * lin(D[k + 1]) + 0.0722 * lin(D[k + 2]); };
      const panel = document.querySelector('.side-panel, .panel.desktop, .sheet');
      const pr = panel ? panel.getBoundingClientRect() : null;
      const out = [];
      for (const e of bodies) {
        if (e.a < 0.9) continue;   // phased / burrowed / spawning: intentionally faint
        if (e.y < 120 || e.y > vh - 130 || e.x < 10 || e.x > vw - 10) continue;
        if (pr && pr.width > 0 && pr.width < vw * 0.6 && e.x + e.r + 10 > pr.left && e.y + e.r + 10 > pr.top) continue;
        let bs = 0, bn = 0, ss = 0, sn = 0, bgs = 0, bgn = 0;
        for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; for (const f of [0.6, 0.8]) { bs += L(e.x + Math.cos(a) * e.r * f, e.y + Math.sin(a) * e.r * f); bn++; } }
        for (let k = 0; k < 48; k++) {
          const a = (k / 48) * Math.PI * 2;
          for (const rr of [e.r + 3, e.r + 5, e.r + 12]) {
            const px = e.x + Math.cos(a) * rr, py = e.y + Math.sin(a) * rr;
            let onOther = false;
            for (const o of bodies) { if (o === e) continue; const dx = px - o.x, dy = py - o.y, r2 = o.r + 4; if (dx * dx + dy * dy < r2 * r2) { onOther = true; break; } }
            if (onOther) continue;
            const v = L(px, py);
            if (rr > e.r + 10) { bgs += v; bgn++; } else { ss += v; sn++; }
          }
        }
        if (sn < 12) continue;
        const body = bs / bn, sur = ss / sn, bg = bgn ? bgs / bgn : 0;
        out.push({ ratio: (Math.max(body, sur) + 0.05) / (Math.min(body, sur) + 0.05), fx: bg > 0.06 });
      }
      return out;
    }, { b64: png.toString('base64'), bodies, vw: page.viewportSize().width, vh: page.viewportSize().height });
    results.push(...stats);
    await page.screenshot({ path: join(OUT, `readability-${vpName}-${s}.png`) });
    await page.evaluate(() => { const c = window.__citadel; c.app.frozen = false; c.game.client.setRunning(true); });
  }
  await ctx.close();
  const sorted = results.map((r) => r.ratio).sort((a, b) => a - b);
  const q = (arr, p) => arr.length ? +arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].toFixed(2) : null;
  const fx = results.filter((r) => r.fx).map((r) => r.ratio).sort((a, b) => a - b);
  const summary = { viewport: vpName, enemies: sorted.length, p10: q(sorted, 0.1), median: q(sorted, 0.5), share2: +(sorted.filter((r) => r >= 2).length / Math.max(1, sorted.length)).toFixed(3), overEffects: fx.length, overEffectsMedian: q(fx, 0.5) };
  summary.pass = sorted.length >= 20 && summary.median >= 1.6 && summary.share2 >= 0.3 && (summary.overEffectsMedian ?? 99) >= 1.5;
  return summary;
}

let failed = false;
const all = [];
try {
  for (const vp of ['desktop', 'phone']) { const s = await measure(vp); all.push(s); console.log(`${s.pass ? 'PASS' : 'FAIL'} readability ${JSON.stringify(s)}`); if (!s.pass) failed = true; }
} finally {
  await browser.close();
  server?.kill();
}
writeFileSync(join(OUT, 'readability.json'), JSON.stringify(all, null, 1));
process.exit(failed ? 1 : 0);
