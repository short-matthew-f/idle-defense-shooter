#!/usr/bin/env node
// Browser end-to-end check (`npm run e2e` builds first). Starts `vite preview`, then drives Chromium through:
//   desktop 1280×800  play 90 s of sim time, quick-buy 3 nodes, tap-designate, slot + arm + cast an ability,
//                     Prestige tab (Forecast), Inspector (Space), More → Codex, More → Settings → export,
//                     IndexedDB save, import the export back (reload restores the run)
//   phone 390×844     (touch) the five tabs, badges, status strip → Battle, browser Back → Battle,
//                     More → sub-screen → Back → More → Back → Battle, render pause off Battle, arena share,
//                     nothing under the tab bar, quick buy by tap on the Upgrades screen
// Exit code 1 on any failed check.
//
// Environment: PLAYWRIGHT_DIR (a directory holding the `playwright` package; default: the global npm root),
// CHROMIUM (browser executable; default: Playwright's own), E2E_URL (skip the preview server and test this URL),
// E2E_OUT (screenshots; default tests/e2e/out), E2E_SKIP_DESKTOP=1 / E2E_SKIP_PHONE=1.
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.E2E_OUT ?? join(ROOT, 'tests', 'e2e', 'out');
mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, ROOT, (() => { try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return null; } })(), '/opt/node22/lib/node_modules'].filter(Boolean);
  for (const d of dirs) {
    try { return createRequire(join(d, 'noop.js'))('playwright'); } catch { /* next */ }
  }
  throw new Error('playwright not found: install it (npm i -g playwright) or set PLAYWRIGHT_DIR');
}
const { chromium } = loadPlaywright();
const CHROMIUM = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

// ---------------------------------------------------------------- preview server
const PORT = Number(process.env.E2E_PORT ?? 4179);
let server = null;
let BASE = process.env.E2E_URL;
if (!BASE) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  BASE = `http://localhost:${PORT}/idle-defense-shooter/`;
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(BASE); if (r.ok) break; } catch { /* not yet */ }
    if (Date.now() - t0 > 30000) { server.kill(); throw new Error('vite preview did not start'); }
    await new Promise((r) => setTimeout(r, 300));
  }
}
const URL = `${BASE}?fast=8`;

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const fail = [];
const check = (name, ok, detail) => { if (!ok) fail.push(name); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail === undefined ? '' : JSON.stringify(detail)); };
const uiOf = (page) => page.evaluate(() => { const u = window.__citadel?.game?.latestUi?.(); return u ? { wave: u.run.wave, phase: u.run.phase, scrap: u.run.scrap, play: u.run.playSeconds, cp: u.run.checkpoint, deepest: u.run.deepestCleared, ce: u.tower.ce, abilities: u.abilities, slots: u.build.abilities, ranks: u.build.ranks, speedAllowed: u.speedAllowed, nextHp: u.nextHardpointWave, nextAt: u.nextAttunementWave, activeTrial: u.activeTrial, patrol: u.run.patrolScrapPerSecond } : null; });
const waitUi = async (page, pred, timeoutMs, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const u = await uiOf(page); if (u && pred(u)) return u; await page.waitForTimeout(250); }
  throw new Error(`timeout waiting for ${label}`);
};
const enemyScreen = (page) => page.evaluate(() => {
  const c = window.__citadel; const s = c.app.snapshot; if (!s || s.instances.buffer.byteLength === 0) return null;
  const F = 12; let best = null;
  for (let i = 0; i < s.instanceCount; i++) { const o = i * F; if (s.instances[o + 9] !== 4) continue; const x = s.instances[o], y = s.instances[o + 1]; const d = Math.hypot(x, y); if (d > 480) continue; if (!best || d > best.d) best = { x, y, d }; }
  if (!best) return null;
  const p = c.app.camera.toScreen(best.x, best.y); const r = c.app.canvas.getBoundingClientRect();
  return { sx: r.left + p.x, sy: r.top + p.y, wx: best.x, wy: best.y };
});
const attachLogs = (page, errors) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
};
const skipOnboarding = async (page) => { const s = page.getByRole('button', { name: 'Skip' }); if (await s.count()) await s.first().click(); };
const tab = async (page, id) => { await page.locator(`.tabbar .tab-btn[data-tab="${id}"]`).click(); await page.waitForTimeout(350); };

try {
  if (!process.env.E2E_SKIP_DESKTOP) await desktop();
  if (!process.env.E2E_SKIP_PHONE) await phone();
} catch (e) {
  check('no exceptions', false, String(e && e.stack || e));
} finally {
  await browser.close();
  server?.kill();
}
console.log('\nSUMMARY', JSON.stringify({ fail }));
process.exit(fail.length ? 1 : 0);

// ================================================================ desktop
async function desktop() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors = [];
  attachLogs(page, consoleErrors);
  await page.goto(URL);
  await page.waitForTimeout(1200);
  await skipOnboarding(page);
  const u0 = await waitUi(page, (u) => u.phase === 'combat' && u.wave === 1, 60000, 'wave 1 combat');
  const t0 = Date.now();
  const u1 = await waitUi(page, (u) => u.play >= 90, 300000, '90 s of sim time');
  console.log(`90 s sim in ${((Date.now() - t0) / 1000).toFixed(1)} s real; wave ${u1.wave} scrap ${u1.scrap.toFixed(1)}`);
  check('UiState additions present', u1.speedAllowed === 1 && u1.nextHp === 10 && u1.nextAt === 5 && u1.activeTrial === null && typeof u1.patrol === 'number', { speedAllowed: u1.speedAllowed, nextHp: u1.nextHp, nextAt: u1.nextAt });
  const layout = await page.evaluate(() => ({ body: document.body.className, panel: !!document.querySelector('.screen.s-upgrades:not([hidden])'), battleTab: getComputedStyle(document.querySelector('.tab-btn.t-battle')).display }));
  check('desktop: side panel shows Upgrades, no Battle tab', layout.body.includes('shell-desktop') && layout.panel && layout.battleTab === 'none', layout);

  await page.evaluate(() => window.__citadel.game.setFast(1));
  const before = await uiOf(page);
  const ranksBefore = Object.values(before.ranks).reduce((a, b) => a + b, 0);
  const bought = [];
  for (let k = 0; k < 3; k++) {
    const chip = page.locator('.quick-row .btn.chip.quick').first();
    if (!(await chip.count())) break;
    bought.push((await chip.textContent())?.trim());
    await chip.click();
    await page.waitForTimeout(700);
  }
  const after = await uiOf(page);
  check('bought three cheapest nodes', Object.values(after.ranks).reduce((a, b) => a + b, 0) - ranksBefore >= 3, { bought });

  await waitUi(page, (u) => u.phase === 'combat', 60000, 'combat for tap');
  let e = null; for (let k = 0; k < 40 && !e; k++) { e = await enemyScreen(page); if (!e) await page.waitForTimeout(250); }
  const cmdBefore = await page.evaluate(() => window.__citadel.game.cmdErrors.length);
  if (e) { await page.mouse.click(e.sx, e.sy); await page.waitForTimeout(350); }
  const designated = await page.evaluate(() => {
    const s = window.__citadel.app.snapshot; const F = 12; let n = 0;
    for (let i = 0; i < s.instanceCount; i++) { const o = i * F; if ((s.instances[o + 9] === 5 && s.instances[o + 5] === 1 && Math.abs(s.instances[o + 6] - 0.3) < 1e-3) || (s.instances[o + 9] === 7 && s.instances[o + 11] !== 0)) n++; }
    return n;
  });
  const cmdAfterTap = await page.evaluate(() => window.__citadel.game.cmdErrors.slice());
  check('tap designates an enemy (designate_at)', !!e && cmdAfterTap.length === cmdBefore && designated >= 1, { enemy: e, marks: designated });

  // hold / right-click a slot opens the picker; slot Hunter Mark unless the loadout already has it
  const slots = page.locator('.ability-row .btn.ability');
  await slots.first().click({ button: 'right' });
  await page.waitForTimeout(400);
  const pickerOpen = await page.locator('.ab-picker-modal .abp-item').count();
  let slot = (await uiOf(page)).slots.indexOf('hunter_mark');
  if (slot < 0) { await page.locator('.abp-item', { hasText: 'Hunter Mark' }).first().click(); slot = 0; }
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  check('ability picker opens (hold / right-click) and Hunter Mark is slotted', pickerOpen > 0 && (await uiOf(page)).slots[slot] === 'hunter_mark', { pickerOpen, slot });
  await page.evaluate(() => window.__citadel.game.setFast(4));
  await waitUi(page, (u) => u.phase === 'combat' && u.abilities.some((a) => a.id === 'hunter_mark' && a.ready), 240000, 'Hunter Mark ready');
  await page.evaluate(() => window.__citadel.game.setFast(1));
  await page.waitForTimeout(300);
  await slots.nth(slot).click();
  await page.waitForTimeout(250);
  const armed = await page.evaluate(() => document.body.classList.contains('arming'));
  let e2 = null; for (let k = 0; k < 40 && !e2; k++) { e2 = await enemyScreen(page); if (!e2) await page.waitForTimeout(250); }
  if (e2) await page.mouse.click(e2.sx, e2.sy);
  await page.waitForTimeout(900);
  const hm = (await uiOf(page)).abilities.find((a) => a.id === 'hunter_mark');
  const errsAfterCast = await page.evaluate(() => window.__citadel.game.cmdErrors.slice());
  check('arm + cast Hunter Mark', armed && hm && hm.cooldown > 0 && errsAfterCast.length === 0, { armed, cooldown: hm?.cooldown, cmdErrors: errsAfterCast });

  await page.evaluate(() => window.__citadel.game.setFast(8));
  await waitUi(page, (u) => u.phase === 'combat', 60000, 'combat');
  await page.waitForTimeout(1500);
  const inst = await page.evaluate(() => { const s = window.__citadel.app.snapshot; let n = 0; for (let i = 0; i < s.instanceCount; i++) if (s.instances[i * 12 + 9] === 4) n++; return { enemies: n, rendered: window.__citadel.app.renderer.stats.instances }; });
  await page.screenshot({ path: `${OUT}/desktop-battle.png` });
  check('canvas shows enemy instances', inst.enemies > 0 && inst.rendered > 0, inst);

  // Prestige tab → Forecast (F opens it too)
  await tab(page, 'prestige');
  const forecast = await page.locator('.screen.s-prestige .forecast .readouts').isVisible();
  await page.screenshot({ path: `${OUT}/desktop-prestige.png` });
  check('Prestige tab shows the Forecast', forecast);
  await tab(page, 'upgrades');
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  check('F opens the Forecast', await page.locator('.screen.s-prestige .forecast').isVisible());

  // Inspector (Space)
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  const items = await page.locator('.insp-item').count();
  let sentence = '';
  if (items) {
    await page.locator('.insp-item').first().click();
    await page.waitForFunction(() => { const s = document.querySelector('.insp-sentence'); return s && s.textContent && !s.textContent.includes('Tracing'); }, null, { timeout: 5000 }).catch(() => {});
    sentence = (await page.locator('.insp-sentence').first().textContent()) ?? '';
  }
  await page.screenshot({ path: `${OUT}/desktop-inspector.png` });
  check('Inspector kill sentence', items > 0 && /killed the /.test(sentence) && !/killed the enemy\b/.test(sentence), { items, sentence });
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  // More → Codex, More → Settings
  await tab(page, 'more');
  await page.locator('.menu-item', { hasText: 'Chain Codex' }).click();
  await page.waitForTimeout(400);
  const codex = await page.locator('.screen.s-more .codex .codex-summary').isVisible();
  await page.screenshot({ path: `${OUT}/desktop-codex.png` });
  check('More → Codex', codex);
  await page.locator('.sub-back').click();
  await page.waitForTimeout(200);
  await page.locator('.menu-item', { hasText: 'Settings' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Export save' }).click();
  await page.waitForFunction(() => { const t = document.querySelector('textarea.save-text'); return t && t.value.length > 20; }, null, { timeout: 10000 });
  const exported = await page.locator('textarea.save-text').first().inputValue();
  const preImport = await uiOf(page);
  await page.screenshot({ path: `${OUT}/desktop-settings.png` });
  check('export save string', exported.startsWith('CITADEL'), `${exported.slice(0, 24)}… (${exported.length} chars)`);

  await page.evaluate(() => window.__citadel.game.client.requestSave());
  await page.waitForTimeout(800);
  const idb = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('citadel', 1);
    r.onsuccess = () => { const db = r.result; const t = db.transaction('saves', 'readonly'); const g = t.objectStore('saves').get('main'); g.onsuccess = () => res(g.result ? { version: g.result.version, wave: g.result.run?.wave, cp: g.result.run?.checkpoint } : null); g.onerror = () => res(null); };
    r.onerror = () => res(null);
  }));
  check('save exists in IndexedDB', !!idb, idb);

  await page.locator('textarea.save-text').nth(1).fill(exported);
  await page.getByRole('button', { name: 'Import', exact: true }).first().click();
  await page.waitForTimeout(400);
  await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.locator('[role="dialog"]').filter({ hasText: 'Import this save?' }).getByRole('button', { name: 'Import', exact: true }).click()]);
  await page.waitForTimeout(1500);
  await skipOnboarding(page);
  const reloaded = await waitUi(page, (u) => u.wave >= 1, 60000, 'reload after import');
  check('import restores the run', reloaded.cp === preImport.cp && reloaded.deepest === preImport.deepest && reloaded.scrap >= preImport.scrap * 0.5, { before: { cp: preImport.cp, deepest: preImport.deepest }, after: { cp: reloaded.cp, deepest: reloaded.deepest } });
  await page.waitForTimeout(3000);
  const allCmdErrors = await page.evaluate(() => window.__citadel.game.cmdErrors.slice());
  const simErrors = await page.evaluate(() => window.__citadel.game.simErrors.slice());
  check('wave advanced past 1', preImport.wave > 1 || preImport.deepest >= 1, { wave: preImport.wave });
  check('scrap increased', u1.scrap > u0.scrap);
  check('desktop: zero console errors', consoleErrors.length === 0, consoleErrors);
  check('zero cmd_errors / sim errors (after import)', allCmdErrors.length === 0 && simErrors.length === 0, { allCmdErrors, simErrors });
  await ctx.close();
}

// ================================================================ phone
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  attachLogs(page, errors);
  await page.goto(URL);
  await page.waitForTimeout(1200);
  await skipOnboarding(page);
  await waitUi(page, (u) => u.phase === 'combat', 60000, 'phone combat');
  await waitUi(page, (u) => u.play >= 40, 240000, 'phone: 40 s of sim time');
  await page.evaluate(() => window.__citadel.game.setFast(1));
  const state = () => page.evaluate(() => ({
    body: document.body.className,
    active: [...document.querySelectorAll('.tab-btn.active')].map((e) => e.dataset.tab),
    visible: [...document.querySelectorAll('.screen')].filter((s) => !s.hidden).map((s) => s.className),
    renderPaused: window.__citadel.app.renderPaused,
    hist: history.state,
  }));

  const s0 = await state();
  const geo = await page.evaluate(() => {
    const top = document.querySelector('.topbar').getBoundingClientRect();
    const tb = document.querySelector('.tabbar').getBoundingClientRect();
    const ab = document.querySelector('.abilities').getBoundingClientRect();
    return { top: top.bottom, tabTop: tb.top, tabH: tb.height, abBottom: ab.bottom, arena: (innerHeight - top.bottom - tb.height) / innerHeight };
  });
  await page.screenshot({ path: `${OUT}/phone-battle.png` });
  check('phone: Battle is the arena (no screen, rendering on)', s0.body.includes('shell-phone') && s0.body.includes('tab-battle') && s0.visible.length === 0 && s0.renderPaused === false && s0.active.join() === 'battle', s0);
  check('phone: arena ≥ 60% of the height, abilities clear of the tab bar', geo.arena >= 0.6 && geo.abBottom <= geo.tabTop && geo.tabH >= 56 && geo.tabH <= 64 + 40, geo);

  // quick buy by tap on the Upgrades screen
  await tab(page, 'upgrades');
  const s1 = await state();
  check('phone: Upgrades is a full screen; render paused; history entry pushed', s1.body.includes('tab-upgrades') && s1.visible.some((c) => c.includes('s-upgrades')) && s1.renderPaused === true && s1.hist?.tab === 'upgrades', s1);
  const r0 = await uiOf(page);
  const chip = page.locator('.screen.s-upgrades .quick-row .btn.chip.quick').first();
  if (await chip.count()) { await chip.tap(); await page.waitForTimeout(700); }
  const r1 = await uiOf(page);
  const sum = (u) => Object.values(u.ranks).reduce((a, b) => a + b, 0);
  check('phone: quick chip buys by tap', !(await chip.count()) || sum(r1) > sum(r0), { before: sum(r0), after: sum(r1) });
  await page.screenshot({ path: `${OUT}/phone-upgrades.png` });

  for (const id of ['build', 'prestige', 'more']) {
    await tab(page, id);
    const s = await state();
    await page.screenshot({ path: `${OUT}/phone-${id}.png` });
    check(`phone: ${id} tab`, s.visible.length === 1 && s.visible[0].includes(`s-${id}`) && s.active.join() === id && s.hist?.tab === id, s);
  }
  // Back from any tab returns to Battle (tab switches replace the entry)
  await page.goBack();
  await page.waitForTimeout(500);
  const s2 = await state();
  check('phone: browser Back from a tab → Battle', s2.body.includes('tab-battle') && s2.renderPaused === false, s2);

  // More → Settings (sub-screen) → Back → More → Back → Battle
  await tab(page, 'more');
  await page.locator('.menu-item', { hasText: 'Settings' }).tap();
  await page.waitForTimeout(400);
  const s3 = await state();
  const subVisible = await page.locator('.more-sub .sub-title', { hasText: 'Settings' }).isVisible();
  await page.goBack(); await page.waitForTimeout(400);
  const s4 = await state();
  const listVisible = await page.locator('.more-list').isVisible();
  await page.goBack(); await page.waitForTimeout(400);
  const s5 = await state();
  check('phone: sub-screen Back → More list → Battle', subVisible && s3.hist?.sub === 'settings' && s4.body.includes('tab-more') && listVisible && s5.body.includes('tab-battle'), { s3: s3.hist, s4: s4.hist, s5: s5.hist });

  // the status strip returns to Battle
  await tab(page, 'build');
  const strip = page.locator('.status-strip');
  const stripText = (await strip.textContent()) ?? '';
  await strip.tap();
  await page.waitForTimeout(400);
  const s6 = await state();
  check('phone: status strip shows wave / HP / Scrap and returns to Battle', /Wave \d+/.test(stripText) && s6.body.includes('tab-battle') && s6.hist?.tab === 'battle', { stripText, s6 });

  // badges are wired (at least the Upgrades count once something is affordable)
  const badges = await page.evaluate(() => [...document.querySelectorAll('.tab-btn')].map((b) => ({ tab: b.dataset.tab, badge: b.querySelector('.tab-badge:not([hidden])')?.textContent ?? null, label: b.getAttribute('aria-label') })));
  check('phone: tab buttons carry labels (badges in aria-label)', badges.every((b) => b.label && b.label.length > 0), badges);

  // nothing but the tab bar lives in the tab bar's box (Battle and a screen)
  const overlap = async () => page.evaluate(() => {
    const tb = document.querySelector('.tabbar').getBoundingClientRect();
    const bad = [];
    for (const el of document.querySelectorAll('#ui button, #ui .toast, #ui .death-card')) {
      if (el.closest('.tabbar, .modal-layer')) continue;
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      let p = el, hidden = false; while (p) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden') { hidden = true; break; } p = p.parentElement; }
      if (hidden) continue;
      const sc = el.closest('.screen, .shop-body');
      if (sc && sc.getBoundingClientRect().bottom <= tb.top + 0.5) continue;   // clipped by its scroller
      if (r.bottom > tb.top + 0.5 && r.top < tb.bottom) bad.push(el.className);
    }
    return bad;
  });
  const ovBattle = await overlap();
  await tab(page, 'upgrades');
  const ovUpgrades = await overlap();
  check('phone: nothing overlaps the tab bar', ovBattle.length === 0 && ovUpgrades.length === 0, { ovBattle, ovUpgrades });
  await page.goBack();
  await page.waitForTimeout(300);
  check('phone: zero console errors', errors.length === 0, errors);
  await ctx.close();
}
