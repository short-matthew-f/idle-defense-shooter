#!/usr/bin/env node
// Browser end-to-end check (`npm run e2e` builds first). Starts `vite preview`, then drives Chromium through:
//   desktop 1280×800  play 90 s of sim time, quick-buy 3 nodes, tap-designate, slot + arm + cast an ability,
//                     Prestige tab (Forecast), Inspector (Space), More → Codex, More → Settings → export,
//                     IndexedDB save, import the export back (reload restores the run)
//   phone 390×844     (touch) the five tabs, badges, status strip → Battle, browser Back → Battle,
//                     More → sub-screen → Back → More → Back → Battle, render pause off Battle, arena share,
//                     nothing under the tab bar, quick buy by tap on the Upgrades screen, bulk buy
//                     (quantity Max + Ballistics "Spend here"), Boons: restart → the start-of-attempt offer card,
//                     select a card + Take → the boon is active (row under the top bar) and the offer is gone
//   phone reach       (Reachability, docs/reviews/REACHABILITY.md) a save with Spare Barrel, Second Opinion and the Third
//                     Tactical Slot: choose a second Ballistics Doctrine on the fork, the third ability slot appears,
//                     is assigned from its picker and cast, and two enemies are designated (HUD "2/2"), one cleared by a re-tap
//   phone onboard     (progressive reveal, src/ui/progression.ts) a fresh save: no tab bar, one Upgrade button that buys,
//                     a coach banner; saves at waves 5 / 6 / 10: the tab bar appears with Battle + Upgrades ("New"), Elements
//                     appears, Build + More appear; Settings → Unlock everything shows every tab, switching it off hides them
//   phone touch       (docs/TOUCH.md) More → Help → Touch test: the canvas marker lands on the tap; calibration with honest
//                     taps says "accurate" and stores nothing; a synthetic 40 px pointer offset (taps read 40 px below the
//                     finger) is measured, calibrated away (prefs touchCal), survives a reload, and Reset restores identity
// Exit code 1 on any failed check.
//
// Environment: PLAYWRIGHT_DIR (a directory holding the `playwright` package; default: the global npm root),
// CHROMIUM (browser executable; default: Playwright's own), E2E_URL (skip the preview server and test this URL),
// E2E_OUT (screenshots; default tests/e2e/out), E2E_SKIP_DESKTOP=1 / E2E_SKIP_PHONE=1 / E2E_SKIP_REACH=1 / E2E_SKIP_TOUCH=1 /
// E2E_SKIP_ONBOARD=1. The walkthroughs that need every tab run with ?showall=1 (Unlock everything for the session).
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
const URL = `${BASE}?fast=8&showall=1`;

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
  if (!process.env.E2E_SKIP_REACH) await reach();
  if (!process.env.E2E_SKIP_ONBOARD) await onboard();
  if (!process.env.E2E_SKIP_TOUCH) await touchCheck();
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
  // sample until a snapshot holds enemies (at ×8 an early wave can be cleared between two samples)
  const sample = () => page.evaluate(() => { const s = window.__citadel.app.snapshot; let n = 0; for (let i = 0; i < s.instanceCount; i++) if (s.instances[i * 12 + 9] === 4) n++; return { enemies: n, rendered: window.__citadel.app.renderer.stats.instances }; });
  let inst = await sample();
  for (let k = 0; k < 60 && inst.enemies === 0; k++) { await page.waitForTimeout(250); inst = await sample(); }
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

  // bulk buying: quantity Max, then "Spend here" on Ballistics buys the cheapest ranks there until the Scrap runs out
  await page.locator('.screen.s-upgrades .qty-opt', { hasText: 'Max' }).tap();
  await page.locator('.screen.s-upgrades .tree-chip', { hasText: 'Ballistics' }).tap();
  await page.waitForTimeout(300);
  const spend = page.locator('.screen.s-upgrades .spend-btn').first();
  await page.evaluate(() => window.__citadel.game.setFast(8));
  for (let k = 0; k < 120 && await spend.isDisabled(); k++) await page.waitForTimeout(250);
  await page.evaluate(() => window.__citadel.game.setFast(1));
  await page.waitForTimeout(300);
  const spendLabel = ((await spend.textContent()) ?? '').trim();
  const b0 = await uiOf(page);
  const bal = (u) => Object.entries(u.ranks).filter(([k]) => k.startsWith('ballistics.')).reduce((a, [, v]) => a + v, 0);
  await spend.tap();
  await page.waitForTimeout(900);
  const b1 = await uiOf(page);
  await page.screenshot({ path: `${OUT}/phone-upgrades-spend-max.png` });
  check('phone: Max + Spend here (Ballistics) spends Scrap and raises ranks', /Max ×\d+/.test(spendLabel) && b1.scrap < b0.scrap && bal(b1) > bal(b0), { spendLabel, scrap: [b0.scrap, b1.scrap], ranks: [bal(b0), bal(b1)] });
  await page.locator('.screen.s-upgrades .qty-opt').first().tap();   // back to ×1

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

  // Boons: a restart is a new attempt (not the first of the Prestige), so it offers three boons; tap a card, Take
  const boons = () => page.evaluate(() => { const u = window.__citadel.game.latestUi(); return { offer: u.run.boonOffer, boons: u.run.boons, cap: u.run.boonCap }; });
  await page.getByRole('button', { name: 'Restart from checkpoint' }).tap();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Restart', exact: true }).tap();
  for (let k = 0; k < 40 && !(await boons()).offer; k++) await page.waitForTimeout(250);
  const bo0 = await boons();
  const card = page.locator('.boon-offer .bo-card');
  const offerGeo = await page.evaluate(() => {
    const c = document.querySelector('.boon-offer').getBoundingClientRect(), l = document.querySelector('.battle-layer').getBoundingClientRect(), tb = document.querySelector('.tabbar').getBoundingClientRect(), ab = document.querySelector('.abilities').getBoundingClientRect();
    return { share: +(c.height / l.height).toFixed(3), clearOfTabs: c.bottom <= tb.top, aboveAbilities: c.bottom <= ab.top + 1 };
  });
  await page.screenshot({ path: `${OUT}/phone-boon-offer.png` });
  check('phone: a restart offers three boons in a card over the arena (≈⅓ of it, above the abilities)', bo0.offer?.length === 3 && (await card.count()) === 3 && offerGeo.share <= 0.36 && offerGeo.clearOfTabs && offerGeo.aboveAbilities, { offer: bo0.offer, offerGeo });
  const picked = bo0.offer?.[0];
  await card.first().tap();
  await page.locator('.boon-offer .bo-take').tap();
  for (let k = 0; k < 20 && (await boons()).boons.length === 0; k++) await page.waitForTimeout(150);
  await page.waitForTimeout(300);
  const bo1 = await boons();
  const rowShown = await page.locator('.boon-row:not([hidden])').isVisible();
  await page.screenshot({ path: `${OUT}/phone-boon-active.png` });
  check('phone: picking a boon makes it active and clears the offer', bo1.boons.length === 1 && bo1.boons[0] === picked && !bo1.offer && rowShown && !(await page.locator('.boon-offer').isVisible()), { bo1, rowShown });
  check('phone: zero console errors', errors.length === 0, errors);
  await ctx.close();
}

// ================================================================ phone: reachability (second Doctrine, third slot, two designators)
async function reach() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  // the save is stored from a same-origin image URL (the game must not run and autosave over it); Chromium then asks
  // for /favicon.ico, which the preview server does not have: answer it so the console stays clean
  await ctx.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  attachLogs(page, errors);
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__citadel?.game?.ready, null, { timeout: 60000 });
  await skipOnboarding(page);
  // take the fresh save and grant: Spare Barrel + Second Opinion socketed, the Ballistics fork open with its first
  // Doctrine chosen, Prestige III's Third Tactical Slot; then park the game on another URL, store it and reload
  const save = await page.evaluate(async () => {
    const g = window.__citadel.game, ui = g.latestUi();
    const s = await g.client.requestSave();
    const docs = ui.shop.filter((e) => e.tree === 'ballistics' && e.kind === 'doctrine').map((e) => e.node.split('.')[1]);
    for (const e of ui.shop) if (e.tree === 'ballistics' && e.kind !== 'doctrine' && e.kind !== 'exotic') s.run.build.ranks[e.node] = Math.max(1, s.run.build.ranks[e.node] | 0);
    s.run.build.doctrines = { ballistics: docs[0] };
    s.run.build.anomalies = ['spare_barrel', 'second_opinion'];
    s.meta.prestigeRanks['prestige.third_tactical_slot'] = 1;
    s.meta.deepestEver = Math.max(60, s.meta.deepestEver);
    s.run.scrap = 5000; s.run.cores = 3;
    s.savedAtMs = Date.now();
    return s;
  });
  await page.goto(`${BASE}icons/icon-192.png`);
  await page.evaluate(async (save) => {
    await new Promise((res, rej) => {
      const r = indexedDB.open('citadel', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('saves')) r.result.createObjectStore('saves'); };
      r.onsuccess = () => { const t = r.result.transaction('saves', 'readwrite'); t.objectStore('saves').put(save, 'main'); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
      r.onerror = () => rej(r.error);
    });
  }, save);
  await page.goto(`${BASE}?fast=1&showall=1`);
  await page.waitForFunction(() => !!window.__citadel?.game?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await skipOnboarding(page);
  const rs = () => page.evaluate(() => { const u = window.__citadel.game.latestUi(); return { second: u.build.secondDoctrines, sd: u.secondDoctrine, slots: u.build.abilities, usable: u.abilitySlots, des: u.designators, phase: u.run.phase, abilities: u.abilities, ce: u.tower.ce }; });

  // 1. second Doctrine: the Ballistics fork offers "Choose as 2nd · 50%" (Spare Barrel); choose it
  const r0 = await rs();
  await tab(page, 'upgrades');
  await page.locator('.screen.s-upgrades .cat-tabs .tab', { hasText: 'Chassis' }).tap();
  await page.locator('.screen.s-upgrades .tree-chip', { hasText: 'Ballistics' }).tap();
  await page.waitForTimeout(300);
  const second = page.locator('.screen.s-upgrades .doctrine button[data-action="second"]');
  const label = ((await second.first().textContent()) ?? '').trim();
  await second.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/phone-reach-second-fork.png` });
  await second.first().tap();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Choose as 2nd' }).tap();
  for (let k = 0; k < 20 && !(await rs()).second.ballistics; k++) await page.waitForTimeout(150);
  const r1 = await rs();
  const tag = await page.locator('.screen.s-upgrades .doctrine.second .doc-tag').first().textContent().catch(() => null);
  await page.screenshot({ path: `${OUT}/phone-reach-second-chosen.png` });
  check('reach: a second Doctrine is offered (Spare Barrel, 50%) and chosen from the fork', r0.sd?.ballistics?.strength === 0.5 && label.startsWith('Choose as 2nd · 50%') && !!r1.second.ballistics && tag === '2nd · 50%', { label, second: r1.second, tag });

  // 2. third ability slot: three buttons on Battle; the empty one opens its picker; slot Repulsor Pulse there and cast it
  await tab(page, 'battle');
  const btns = page.locator('.ability-row .btn.ability');
  const n = await btns.count();
  await btns.nth(2).tap();
  await page.waitForTimeout(400);
  await page.locator('.abp-item', { hasText: 'Repulsor Pulse' }).first().tap();
  for (let k = 0; k < 20 && (await rs()).slots[2] !== 'repulsor_pulse'; k++) await page.waitForTimeout(150);
  const r2 = await rs();
  await page.evaluate(() => window.__citadel.game.setFast(8));
  await waitUi(page, (u) => u.phase === 'combat' && u.abilities.some((a) => a.id === 'repulsor_pulse' && a.ready), 240000, 'Repulsor Pulse ready');
  await page.evaluate(() => window.__citadel.game.setFast(1));
  await btns.nth(2).tap();
  await page.waitForTimeout(700);
  const r3 = await rs();
  const rp = r3.abilities.find((a) => a.id === 'repulsor_pulse');
  const geo = await page.evaluate(() => { const a = document.querySelector('.ability-row').getBoundingClientRect(), tb = document.querySelector('.tabbar').getBoundingClientRect(); return { rowBottom: a.bottom, tabTop: tb.top, left: a.left, right: a.right }; });
  await page.screenshot({ path: `${OUT}/phone-reach-third-slot.png` });
  check('reach: the third ability slot shows, is assigned from its picker and casts', r0.usable === 3 && r0.slots.length === 3 && n === 3 && r2.slots[2] === 'repulsor_pulse' && !!rp && rp.cooldown > 0 && geo.rowBottom <= geo.tabTop && geo.left >= 0 && geo.right <= 390, { usable: r0.usable, n, slots: r2.slots, cooldown: rp?.cooldown, geo });

  // 3. two designators: tap two enemies (both reticles, HUD 2/2), re-tap one to clear it
  await waitUi(page, (u) => u.phase === 'combat', 60000, 'combat for designators');
  const targets = async () => page.evaluate(() => {
    const c = window.__citadel, s = c.app.snapshot; if (!s || s.instances.buffer.byteLength === 0) return [];
    const out = [];
    for (let i = 0; i < s.instanceCount; i++) { const o = i * 12; if (s.instances[o + 9] !== 4) continue; const x = s.instances[o], y = s.instances[o + 1]; if (Math.hypot(x, y) > 460 || Math.hypot(x, y) < 90) continue; out.push({ x, y }); }
    out.sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y));
    const pick = []; for (const e of out) if (pick.every((p) => Math.hypot(p.x - e.x, p.y - e.y) > 60)) pick.push(e);
    const r = c.app.canvas.getBoundingClientRect();
    return pick.map((e) => { const p = c.app.camera.toScreen(e.x, e.y); return { sx: r.left + p.x, sy: r.top + p.y }; }).filter((q) => document.elementFromPoint(q.sx, q.sy) === c.app.canvas);
  });
  let two = [];
  for (let k = 0; k < 60 && two.length < 2; k++) { two = await targets(); if (two.length < 2) await page.waitForTimeout(250); }
  await page.evaluate(() => window.__citadel.game.setFast(1));
  const cmdBefore = await page.evaluate(() => window.__citadel.game.cmdErrors.length);
  for (const e of two.slice(0, 2)) { await page.touchscreen.tap(e.sx, e.sy); await page.waitForTimeout(250); }
  await page.waitForTimeout(400);
  const r4 = await rs();
  const chip = ((await page.locator('.desig-chip').textContent()) ?? '').trim();
  const reticles = await page.evaluate(() => { const s = window.__citadel.app.snapshot; let k = 0; for (let i = 0; i < s.instanceCount; i++) { const o = i * 12; if (s.instances[o + 9] === 7 && s.instances[o + 11] !== 0) k++; } return k; });
  await page.screenshot({ path: `${OUT}/phone-reach-two-designators.png` });
  const cmdErrs = await page.evaluate((n0) => window.__citadel.game.cmdErrors.slice(n0), cmdBefore);
  check('reach: two taps designate two enemies (both reticles, HUD shows 2 designators)', two.length >= 2 && r4.des?.slots === 2 && r4.des?.live === 2 && reticles >= 2 && /2\/2/.test(chip) && cmdErrs.length === 0, { taps: two.length, des: r4.des, reticles, chip, cmdErrs });
  // re-tap the enemy nearest the last tap: its designation clears (it may have moved: aim at its drawn position)
  const again = await page.evaluate((t) => {
    const c = window.__citadel, s = c.app.snapshot, r = c.app.canvas.getBoundingClientRect();
    let best = null;
    for (let i = 0; i < s.instanceCount; i++) { const o = i * 12; if (s.instances[o + 9] !== 7 || s.instances[o + 11] === 0) continue; const p = c.app.camera.toScreen(s.instances[o], s.instances[o + 1]); const d = Math.hypot(r.left + p.x - t.sx, r.top + p.y - t.sy); if (!best || d < best.d) best = { d, sx: r.left + p.x, sy: r.top + p.y }; }
    return best;
  }, two[1]);
  const before = await rs();
  if (again) await page.touchscreen.tap(again.sx, again.sy);
  await page.waitForTimeout(300);
  const r5 = await rs();
  // relative to the count just before the tap; the other designated enemy can also die in the same 300 ms, so
  // also check that no reticle is left on the enemy that was tapped (world distance from the tapped point)
  const leftOnTapped = again ? await page.evaluate((t) => {
    const c = window.__citadel, s = c.app.snapshot, r = c.app.canvas.getBoundingClientRect();
    const w = c.app.camera.toWorld((t.sx - r.left) * c.app.camera.viewW / r.width, (t.sy - r.top) * c.app.camera.viewH / r.height, { x: 0, y: 0 });
    let n = 0;
    for (let i = 0; i < s.instanceCount; i++) { const o = i * 12; if (s.instances[o + 9] === 7 && s.instances[o + 11] !== 0 && Math.hypot(s.instances[o] - w.x, s.instances[o + 1] - w.y) < 24) n++; }
    return n;
  }, again) : -1;
  check('reach: tapping a designated enemy clears it', !!again && before.des?.live >= 1 && r5.des?.live <= before.des.live - 1 && leftOnTapped === 0, { before: before.des, after: r5.des, leftOnTapped });
  check('reach: zero console errors', errors.length === 0, errors);
  await ctx.close();
}

// ================================================================ phone: progressive reveal (fresh save → first boss → Elements → Build)
async function onboard() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  attachLogs(page, errors);
  const ready = () => page.waitForFunction(() => !!window.__citadel?.game?.ready, null, { timeout: 60000 });
  const view = () => page.evaluate(() => {
    const vis = (el) => !!el && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    return {
      tabbar: vis(document.querySelector('.tabbar')),
      tabs: [...document.querySelectorAll('.tabbar .tab-btn')].filter(vis).map((b) => b.dataset.tab),
      badges: Object.fromEntries([...document.querySelectorAll('.tabbar .tab-btn')].filter(vis).map((b) => [b.dataset.tab, vis(b.querySelector('.tab-badge')) ? b.querySelector('.tab-badge').textContent : null])),
      starter: vis(document.querySelector('.starter .st-btn')),
      why: document.querySelector('.starter .st-why')?.textContent ?? '',
      coach: vis(document.querySelector('.coach-banner')) ? document.querySelector('.coach-banner .coach-text').textContent : null,
      abilities: vis(document.querySelector('.ability-row')),
      body: document.body.className,
    };
  });
  /** Store the current save with `mut` applied (a function body over `s`) and reload into it. */
  const withSave = async (mut) => {
    const save = await page.evaluate(async (src) => { const s = await window.__citadel.game.client.requestSave(); new Function('s', src)(s); s.savedAtMs = Date.now(); return s; }, mut);
    await page.goto(`${BASE}icons/icon-192.png`);
    await page.evaluate(async (save) => {
      await new Promise((res, rej) => {
        const r = indexedDB.open('citadel', 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('saves')) r.result.createObjectStore('saves'); };
        r.onsuccess = () => { const t = r.result.transaction('saves', 'readwrite'); t.objectStore('saves').put(save, 'main'); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
        r.onerror = () => rej(r.error);
      });
    }, save);
    await page.goto(`${BASE}?fast=1`);
    await ready();
    await page.waitForTimeout(900);
  };
  const tapTab = async (id) => {
    for (let k = 0; k < 4; k++) { await page.locator(`.tabbar .tab-btn[data-tab="${id}"]`).tap(); await page.waitForTimeout(400); if ((await page.evaluate(() => document.body.className)).includes(`tab-${id}`)) return true; }
    return false;
  };

  // 1. a fresh save: no tab bar, the Upgrade button, a one-line coach banner; the button buys
  await page.goto(`${BASE}?fast=8`);
  await ready();
  await page.waitForTimeout(800);
  const v0 = await view();
  await page.screenshot({ path: `${OUT}/phone-onboard-stage0.png` });
  check('onboard: a fresh save shows no tab bar, the Upgrade button and one coach line (no ability bar)', !v0.tabbar && v0.tabs.length === 0 && v0.starter && !!v0.coach && !v0.abilities && v0.body.includes('no-tabbar'), v0);
  const sum = async () => page.evaluate(() => Object.values(window.__citadel.game.latestUi().build.ranks).reduce((a, b) => a + b, 0));
  const before = await sum();
  await page.waitForFunction(() => { const b = document.querySelector('.starter .st-btn'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.evaluate(() => window.__citadel.game.setFast(1));
  await page.locator('.starter .st-btn').tap();
  await page.waitForTimeout(700);
  const after = await sum();
  check('onboard: the Upgrade button buys one of the three stats and says why', after > before && /^(Damage|Fire Rate|Hull|Next)\b/.test(v0.why), { before, after, why: v0.why });
  await page.locator('.coach-banner .coach-ok').tap();
  await page.waitForTimeout(200);
  check('onboard: "Got it" dismisses the coach banner', (await view()).coach === null);

  // 2. the first boss cleared: the tab bar appears with Battle + Upgrades; Upgrades reads "New"; no bulk tools yet
  await withSave('s.run.deepestCleared = 5; s.meta.deepestEver = 5; s.run.checkpoint = 5; s.run.wave = 6; s.run.scrap = 400;');
  const v1 = await view();
  await page.screenshot({ path: `${OUT}/phone-onboard-stage1.png` });
  check('onboard: after the first boss the tab bar shows Battle + Upgrades, Upgrades marked New', v1.tabbar && v1.tabs.join() === 'battle,upgrades' && v1.badges.upgrades === 'New' && !v1.abilities, v1);
  if (v1.coach) { await page.locator('.coach-banner .coach-ok').tap(); await page.waitForTimeout(200); }   // the boon explainer (a start-of-attempt offer is up)
  const opened = await tapTab('upgrades');
  const shop1 = await page.evaluate(() => ({
    cats: [...document.querySelectorAll('.screen.s-upgrades .cat-tabs .tab')].filter((b) => !b.hidden).map((b) => b.textContent.replace(/\d+/g, '').trim()),
    catRow: !document.querySelector('.screen.s-upgrades .cat-tabs').hidden,
    suggested: !document.querySelector('.screen.s-upgrades .quick').hidden,
    qty: !document.querySelector('.screen.s-upgrades .shop-tools').hidden,
    trees: [...document.querySelectorAll('.screen.s-upgrades .tree-chip')].map((b) => b.textContent.replace(/\d+/g, '').trim()),
  }));
  await page.screenshot({ path: `${OUT}/phone-onboard-stage1-upgrades.png` });
  check('onboard: stage 1 Upgrades is the whole Chassis, no Suggested / Buy all / quantity yet', opened && shop1.cats.join() === 'Chassis' && !shop1.catRow && !shop1.suggested && !shop1.qty && shop1.trees.join() === 'Ballistics,Bastion,Reactor', shop1);
  const v1b = await view();
  check('onboard: opening Upgrades retires its "New" badge', v1b.badges.upgrades !== 'New', v1b.badges);
  await page.keyboard.press('q');
  check('onboard: Q does nothing before the quantity selector exists', await page.evaluate(() => JSON.parse(localStorage.getItem('citadel.prefs.v1') || '{}').buyQty ?? 1) === 1);

  // 3. wave 6: Elements appears (the first real choice); 4. wave 10: Build and More appear
  await withSave('s.run.deepestCleared = 6; s.meta.deepestEver = 6; s.run.wave = 7;');
  const v2 = await view();   // coach lines show on Battle (phones)
  await tapTab('upgrades');
  const cats2 = await page.evaluate(() => [...document.querySelectorAll('.screen.s-upgrades .cat-tabs .tab')].filter((b) => !b.hidden).map((b) => b.textContent.replace(/\d+/g, '').trim()));
  check('onboard: wave 6 reveals Elements (with its coach line); still no Build tab', cats2.join() === 'Chassis,Elements' && v2.tabs.join() === 'battle,upgrades' && /element/.test(v2.coach ?? ''), { cats2, tabs: v2.tabs, coach: v2.coach });
  await withSave('s.run.deepestCleared = 10; s.meta.deepestEver = 10; s.run.checkpoint = 10; s.run.wave = 11;');
  const v3 = await view();
  await page.screenshot({ path: `${OUT}/phone-onboard-stage3.png` });
  check('onboard: wave 10 reveals Build and More (New), still no Prestige tab or ability bar', v3.tabs.join() === 'battle,upgrades,build,more' && v3.badges.build !== null && v3.badges.more === 'New' && !v3.abilities, v3);

  // 5. Settings → Unlock everything: every tab at once; switching it off hides them again (More / Settings stay)
  const unlockSwitch = async () => {
    await tapTab('more');
    if (!(await page.locator('.more-sub .sub-title', { hasText: 'Settings' }).isVisible())) await page.locator('.menu-item', { hasText: 'Settings' }).tap();
    await page.waitForTimeout(300);
    await page.locator('.set-row', { hasText: 'Unlock everything' }).locator('input[type="checkbox"]').evaluate((el) => el.click());
    await page.waitForTimeout(500);
  };
  await unlockSwitch();
  const v4 = await view();
  const onPrestige = await tapTab('prestige');
  check('onboard: Unlock everything shows every tab (Prestige opens)', v4.tabs.join() === 'battle,upgrades,build,prestige,more' && onPrestige, v4.tabs);
  await unlockSwitch();
  const v5 = await view();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('citadel.prefs.v1') || '{}').unlockAll);
  check('onboard: switching it off hides what is not earned again, Settings stays open', v5.tabs.join() === 'battle,upgrades,build,more' && v5.body.includes('tab-more') && stored === false, { tabs: v5.tabs, stored });
  check('onboard: zero console errors', errors.length === 0, errors);
  await ctx.close();
}

// ================================================================ touch offset (docs/TOUCH.md)
async function touchCheck() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  attachLogs(page, consoleErrors);
  // synthetic device offset: canvas pointer events report clientY + __touchOffsetY (hit-testing is unchanged)
  await page.addInitScript(() => {
    window.__touchOffsetY = 0;
    for (const t of ['pointerdown', 'pointermove', 'pointerup']) {
      window.addEventListener(t, (e) => {
        if (!window.__touchOffsetY || !(e.target instanceof HTMLCanvasElement)) return;
        const y = e.clientY + window.__touchOffsetY;
        Object.defineProperty(e, 'clientY', { value: y });
        Object.defineProperty(e, 'pageY', { value: y });
      }, true);
    }
  });
  await page.goto(URL);
  await page.waitForTimeout(1200);
  await skipOnboarding(page);
  await page.waitForFunction(() => !!window.__citadel?.game?.ready, null, { timeout: 60000 });
  const hook = () => page.evaluate(() => {
    const inp = window.__citadel.app.input;
    inp.onTap = (x, y) => { window.__lastTap = { x, y }; };   // measure only
  });
  /** Tap the arena with the finger at (x, y): where the drawn frame shows the world point the game acted on, minus the finger. */
  const tapError = async (x, y) => {
    await page.evaluate(() => { window.__lastTap = null; });
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(150);
    return page.evaluate(({ x, y }) => {
      const t = window.__lastTap; if (!t) return null;
      const c = window.__citadel.app, r = c.canvas.getBoundingClientRect(), p = c.camera.toScreen(t.x, t.y, { x: 0, y: 0 });
      return { dx: +(r.left + p.x * r.width / c.camera.viewW - x).toFixed(2), dy: +(r.top + p.y * r.height / c.camera.viewH - y).toFixed(2) };
    }, { x, y });
  };
  const openTest = async () => {
    await tab(page, 'more');
    await page.locator('.menu-item', { hasText: 'Help' }).first().tap();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Touch test' }).tap();
    await page.waitForTimeout(400);
  };
  const calibrate = async () => {
    await page.getByRole('button', { name: 'Calibrate taps' }).tap();
    await page.waitForTimeout(300);
    const targets = await page.evaluate(() => JSON.parse(document.querySelector('.touch-test').dataset.targets));
    for (const [x, y] of targets) { await page.touchscreen.tap(x, y); await page.waitForTimeout(200); }
    return page.evaluate(() => ({ result: document.querySelector('.touch-test').dataset.result, pref: JSON.parse(localStorage.getItem('citadel.prefs.v1') || '{}').touchCal ?? null }));
  };
  await hook();
  const honest = await tapError(120, 520);
  check('touch: a tap acts on the point drawn under the finger', honest && Math.hypot(honest.dx, honest.dy) < 1, honest);

  await openTest();
  await page.touchscreen.tap(200, 560);
  await page.waitForTimeout(300);
  const last = await page.evaluate(() => JSON.parse(document.querySelector('.touch-test').dataset.last || 'null'));
  await page.screenshot({ path: `${OUT}/phone-touch-test.png` });
  check('touch test: the canvas marker is drawn where the game read the tap (DOM crosshair)', last && Math.hypot(last.bx - last.cx, last.by - last.cy) < 0.5 && last.cx === 200 && last.cy === 560, last);
  const acc = await calibrate();
  check('touch: calibration with accurate taps stores nothing', /accurate/.test(acc.result) && acc.pref === null, acc);

  // a device that reads taps 40 px below the finger
  await page.evaluate(() => { window.__touchOffsetY = 40; });
  await page.getByRole('button', { name: 'Close' }).tap();
  await page.waitForTimeout(300);
  await page.goBack(); await page.waitForTimeout(200); await page.goBack(); await page.waitForTimeout(300);
  const off = await tapError(120, 520);
  check('touch: the synthetic offset is measured (≈ 40 px below)', off && Math.abs(off.dy - 40) < 1 && Math.abs(off.dx) < 1, off);
  await openTest();
  const cal = await calibrate();
  await page.screenshot({ path: `${OUT}/phone-touch-calibrated.png` });
  check('touch: calibration fits the offset and stores it', /Calibrated/.test(cal.result) && cal.pref && Math.abs(cal.pref.by + 40) < 1.5 && Math.abs(cal.pref.ay - 1) < 0.01, cal);
  await page.getByRole('button', { name: 'Close' }).tap();
  await page.waitForTimeout(300);
  await page.goBack(); await page.waitForTimeout(200); await page.goBack(); await page.waitForTimeout(300);
  const fixed = [await tapError(120, 520), await tapError(300, 300)];
  check('touch: with the calibration the offset is gone (< 2 px)', fixed.every((e) => e && Math.hypot(e.dx, e.dy) < 2), fixed);

  // the calibration survives a reload, and Reset restores identity
  await page.reload();
  await page.waitForFunction(() => !!window.__citadel?.game?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await hook();
  const calLoaded = await page.evaluate(() => window.__citadel.app.input.calibration);
  await page.evaluate(() => { window.__touchOffsetY = 40; });   // the init script reset it: same device again
  const reloaded = { ...(await tapError(200, 450)), by: calLoaded?.by };
  check('touch: the stored calibration applies after a reload', calLoaded && Math.hypot(reloaded.dx, reloaded.dy) < 2, reloaded);
  await openTest();
  await page.getByRole('button', { name: 'Reset calibration' }).tap();
  await page.waitForTimeout(200);
  const reset = await page.evaluate(() => ({ pref: JSON.parse(localStorage.getItem('citadel.prefs.v1') || '{}').touchCal ?? null, input: window.__citadel.app.input.calibration }));
  await page.getByRole('button', { name: 'Close' }).tap();
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => ({ probe: !!window.__citadel.app.input.probe, testing: document.body.classList.contains('touch-testing'), paused: window.__citadel.game.paused }));
  check('touch: Reset calibration restores identity; closing hands taps back to the game', reset.pref === null && reset.input === null && !closed.probe && !closed.testing && !closed.paused, { reset, closed });
  check('touch: no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5));
  await ctx.close();
}
