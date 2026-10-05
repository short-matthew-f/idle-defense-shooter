// Phase 2 items 3, 4, 6, 8 (docs/reviews/HANDBOOK-EVAL.md), run by e2e.mjs unless E2E_SKIP_INFO=1. Scripted (crafted saves,
// headless Chromium) at 393×852 and 375×667 (DPR 2, notch insets):
//   - tapping a Forecast readout opens the info sheet (≥ 14 px text, ≥ 44 px close buttons); Back closes it and leaves the
//     Prestige tab; Esc and a tap outside close it too
//   - the Wall gauge names its unlock ("…◆150")
//   - Help lists a "What is…" glossary
//   - Prestige → Echo tiers shows the lock as "reach wave N to open Echo tier …"; no "Prestige II/III/IV" in player text
//   - the offline return card: counted vs cap, a gold Scrap figure, a big Continue button that closes it
//   - More → Trials (Unlock everything on, no Echo node bought): one collapsed card, no Start buttons
// Screenshots: OUT/info-<vp>-<view>.png.

const VPS = [
  { id: '393', viewport: { width: 393, height: 852 }, safe: { top: 59, bottom: 34 } },
  { id: '375', viewport: { width: 375, height: 667 }, safe: { top: 20, bottom: 0 } },
];
const SEEN = ['start', 'checkpoint', 'elements', 'build', 'abilities', 'boons', 'anomalies', 'bulk', 'prestige', 'cross', 'inspector', 'cores', 'frame', 'exotics', 'doctrines', 'patrol', 'machine', 'salvage', 'overcharge'];

export async function info({ browser, BASE, OUT, check, attachLogs }) {
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript((s) => {
      const put = () => { const st = document.createElement('style'); st.textContent = `:root{--safe-top:${s.top}px!important;--safe-bottom:${s.bottom}px!important}`; document.head.appendChild(st); };
      if (document.head) put(); else document.addEventListener('DOMContentLoaded', put);
    }, vp.safe);
    const page = await ctx.newPage();
    const errors = [];
    attachLogs(page, errors);
    const ready = () => page.waitForFunction(() => !!window.__citadel?.game?.ready, null, { timeout: 60000 });
    await page.goto(`${BASE}?fast=1`);
    await ready();
    const base = await page.evaluate(async () => {
      const s = await window.__citadel.game.client.requestSave();
      s.meta.deepestEver = 30; s.run.deepestCleared = 30; s.run.checkpoint = 30; s.run.wave = 31; s.run.scrap = 5000; s.run.cores = 3;
      s.run.build.ranks = { 'ballistics.damage': 12, 'ballistics.attack_speed': 10, 'bastion.max_hp': 8 };
      s.savedAtMs = Date.now();
      return s;
    });
    const load = async (url) => {
      await page.goto(`${BASE}icons/icon-192.png`);
      await page.evaluate(async ({ save, prefs }) => {
        localStorage.clear();
        localStorage.setItem('citadel.prefs.v1', JSON.stringify(prefs));
        await new Promise((res, rej) => {
          const r = indexedDB.open('citadel', 1);
          r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('saves')) r.result.createObjectStore('saves'); };
          r.onsuccess = () => { const t = r.result.transaction('saves', 'readwrite'); t.objectStore('saves').put(save, 'main'); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
          r.onerror = () => rej(r.error);
        });
      }, { save: base, prefs: { revealInit: true, hintsInit: true, coachSeen: SEEN, tabsVisited: ['battle', 'upgrades', 'build', 'prestige', 'more'] } });
      await page.goto(url);
      await ready();
      await page.waitForTimeout(700);
    };
    const go = async (tab, sub) => { await page.evaluate(([t, s]) => window.__citadel.game.ui.shell.go(t, s ?? null), [tab, sub]); await page.waitForTimeout(450); };
    const sheet = () => page.locator('.info-sheet:visible');
    const sheetBox = () => page.evaluate(() => {
      const c = document.querySelector('.info-sheet'); if (!c) return null;
      const r = c.getBoundingClientRect(), ok = c.querySelector('.info-ok')?.getBoundingClientRect(), x = c.querySelector('.modal-head button')?.getBoundingClientRect();
      return { bottom: Math.round(r.bottom), top: Math.round(r.top), w: Math.round(r.width), okH: Math.round(ok?.height ?? 0), xW: Math.round(x?.width ?? 0), xH: Math.round(x?.height ?? 0),
        font: parseFloat(getComputedStyle(c.querySelector('.info-text')).fontSize), text: c.querySelector('.info-text').textContent, title: c.querySelector('.modal-title').textContent };
    });

    // 1. a Forecast readout opens the sheet; Back closes it and the Prestige tab stays
    await load(`${BASE}?fast=1`);
    await go('prestige');
    await page.evaluate(() => window.__citadel.game.ui.prestigeScreen.select('forecast'));
    await page.waitForTimeout(300);
    const wallSub = (await page.locator('.readout:has(.ro-label:has-text("Wall gauge")) .ro-sub').textContent()) ?? '';
    check(`info ${vp.id}: the Wall gauge names its unlock ("…◆N")`, /◆\d/.test(wallSub) || /next new behaviour|Only stat ranks/.test(wallSub), { wallSub });
    await page.locator('.readout:has(.ro-label:has-text("Reclimb"))').tap();
    await page.waitForTimeout(350);
    const b = await sheetBox();
    await page.screenshot({ path: `${OUT}/info-${vp.id}-sheet.png` });
    check(`info ${vp.id}: tapping a Forecast readout opens the info sheet (bottom sheet, text ≥ 14 px, close ≥ 44 px)`,
      !!b && b.title === 'Reclimb' && b.text.length > 20 && b.font >= 14 && b.okH >= 44 && b.xW >= 44 && b.xH >= 44 && b.bottom >= vp.viewport.height - 2, b);
    await page.goBack();
    await page.waitForTimeout(450);
    check(`info ${vp.id}: Back closes the sheet and the Prestige tab stays`, (await sheet().count()) === 0 && (await page.evaluate(() => window.__citadel.game.ui.shell.tab)) === 'prestige');
    await page.locator('.readout:has(.ro-label:has-text("Wall gauge"))').tap();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check(`info ${vp.id}: Esc closes the sheet`, (await sheet().count()) === 0);
    await page.locator('.readout:has(.ro-label:has-text("Echo rate"))').tap();
    await page.waitForTimeout(300);
    await page.touchscreen.tap(vp.viewport.width / 2, 40);   // outside the sheet: the backdrop
    await page.waitForTimeout(250);
    check(`info ${vp.id}: a tap outside closes the sheet`, (await sheet().count()) === 0);

    // 2. the Echo tiers screen: the lock names the tier and the wave
    await page.locator('.screen.s-prestige .seg-btn:has-text("Echo tiers")').tap();
    await page.waitForTimeout(400);
    const tiers = await page.evaluate(() => ({ text: document.querySelector('.screen.s-prestige')?.textContent ?? '', folds: [...document.querySelectorAll('.ps-fold')].filter((e) => e.offsetParent).map((e) => e.textContent) }));
    await page.evaluate(() => [...document.querySelectorAll('.ps-fold')].find((e) => e.offsetParent)?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/info-${vp.id}-echo-tiers.png` });
    check(`info ${vp.id}: Echo tiers: named "Echo tier I–IV" with locks that state the wave; no "Prestige II/III/IV"`,
      /Echo tier I: Inheritance/.test(tiers.text) && tiers.folds.some((f) => /reach wave 40 to open Echo tier II/.test(f)) && !/Prestige (II|III|IV)\b/.test(tiers.text), tiers.folds);

    // 3. Help: the "What is…" glossary
    await go('more', 'help');
    const gloss = await page.evaluate(() => { const h = [...document.querySelectorAll('.help .sec-title')].find((e) => e.textContent === 'What is…'); h?.scrollIntoView({ block: 'start' }); return [...document.querySelectorAll('.help .gloss dt')].map((e) => e.textContent); });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/info-${vp.id}-help.png` });
    check(`info ${vp.id}: Help lists a "What is…" glossary of the revealed features (Scrap yes, Ascension tiers no)`, gloss.includes('Scrap') && gloss.includes('Wall gauge') && gloss.length >= 8, gloss);

    // 4. the offline return card
    await go('battle');
    await page.evaluate(() => window.__citadel.game.ui.expectOffline(40000, 123456));
    await page.waitForTimeout(4600);
    const off = await page.evaluate(() => {
      const m = document.querySelector('.offline-modal'); if (!m) return null;
      const g = m.querySelector('.off-val'), c = m.querySelector('.off-continue').getBoundingClientRect();
      return { counted: m.querySelector('.off-counted')?.textContent, color: getComputedStyle(g).color, contH: Math.round(c.height), contW: Math.round(c.width), bottom: Math.round(c.bottom), text: m.textContent };
    });
    await page.screenshot({ path: `${OUT}/info-${vp.id}-offline.png` });
    const scrapRgb = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--scrap)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    check(`info ${vp.id}: offline card: counted vs cap, gold Scrap figure, a Continue button ≥ 44 px, the next boss`,
      !!off && /Counted 11 h of your 8 h cap|Counted 8 h of your 8 h cap/.test(off.counted ?? '') && off.color === scrapRgb && off.contH >= 44 && off.contW >= 200 && /Next boss: wave 35/.test(off.text) && off.bottom <= vp.viewport.height, { off, scrapRgb });
    await page.locator('.offline-modal .off-continue').tap();
    await page.waitForTimeout(300);
    check(`info ${vp.id}: Continue closes the offline card`, (await page.locator('.offline-modal').count()) === 0);

    // 5. Trials without the Echo node: one collapsed card
    await load(`${BASE}?fast=1&showall=1`);
    await go('more', 'trials');
    await page.waitForTimeout(300);
    const tr = await page.evaluate(() => ({ cards: document.querySelectorAll('.trials .trial').length, starts: [...document.querySelectorAll('.trials button')].length, head: document.querySelector('.trials .tl-head')?.textContent }));
    await page.screenshot({ path: `${OUT}/info-${vp.id}-trials.png` });
    check(`info ${vp.id}: locked Trials collapse into one card with the real gate`, tr.cards === 0 && tr.starts === 0 && /^\d+ Trials unlock at: Reach wave 40 · buy Trials \(120 Echoes\)/.test(tr.head ?? ''), tr);
    check(`info ${vp.id}: zero console errors`, errors.length === 0, errors);
    await ctx.close();
  }
}
