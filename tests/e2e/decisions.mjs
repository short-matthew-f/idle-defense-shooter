// Phase 2 decisions (docs/reviews/HANDBOOK-EVAL.md Phase 2 items 5 and 7), run by e2e.mjs unless E2E_SKIP_DECIDE=1.
// At 393×852 and 375×667 (DPR 2, notch insets):
//   - first Prestige (the owner's wave-28 save, tests/fixtures/owner-save-w28.txt): the ceremony shows the Forecast verdict
//   - a later Prestige (crafted: Prestige 2, Keepsake / Threat Dial / Dual Doctrine / Branch Discount owned, 2 Anomalies):
//     the modal leads with the verdict (first child), the locked Frames fold into one line, the Keepsake select sits
//     above the Frames (so above the pinned button's reach), and the confirm step names the Keepsake and the Threat Dial
//   - stay with the fight (scripted through GameUi.shell): a tab opened from a decision source pauses the run and marks
//     the Battle tab until Battle is back; a tab the player opens stays live
//   - Doctrine "Change at next checkpoint": mid-wave the fork offers it; queueing shows the pending line and
//     UiState.run.pendingDoctrines; Cancel change empties it
// Screenshots: OUT/decide-<vp>-<view>.png.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VPS = [
  { id: '393', viewport: { width: 393, height: 852 }, safe: { top: 59, bottom: 34 } },
  { id: '375', viewport: { width: 375, height: 667 }, safe: { top: 20, bottom: 0 } },
];

function ownerSave() {
  const s = readFileSync(join(ROOT, 'tests', 'fixtures', 'owner-save-w28.txt'), 'utf8').trim();
  return JSON.parse(Buffer.from(s.slice(s.indexOf(':') + 1), 'base64').toString('utf8'));
}

export async function decisions({ browser, BASE, OUT, check, attachLogs }) {
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
    const prefs = { pointerHints: false, buyCoach: 3, qmSeen: true, onboarded: true, revealInit: true, contentInit: true };
    const load = async (save) => {
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
      }, { save, prefs });
      await page.goto(`${BASE}?fast=1`);
      await ready();
      await page.waitForTimeout(900);
    };
    const closeDialogs = async () => { for (let k = 0; k < 3; k++) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(150); } };

    // ---- 1. first Prestige: the owner's save, the ceremony carries the verdict
    const owner = ownerSave();
    owner.savedAtMs = Date.now();
    await load(owner);
    await closeDialogs();
    await page.evaluate(() => window.__citadel.game.ui.open('prestige'));
    await page.waitForTimeout(500);
    const cer = await page.evaluate(() => ({ verdict: document.querySelector('.ceremony-modal .cer-verdict')?.textContent ?? null, gain: document.querySelector('.ceremony-modal .cer-gain-val')?.textContent ?? null }));
    await page.screenshot({ path: `${OUT}/decide-${vp.id}-first-prestige.png` });
    check(`decide ${vp.id}: the first-Prestige ceremony shows the Forecast verdict`, !!cer.verdict && /Recommended now|Waiting ~\d+ min likely adds \+\d+ Echoes|Not recommended yet/.test(cer.verdict), cer);
    // end to end: Prestige from the ceremony → Prestige → Echo tiers, Tier I, the guided first Echo spend; a guided Buy spends
    await page.locator('.ceremony-modal .cer-go').tap();
    await page.waitForFunction(() => (window.__citadel.game.latestUi()?.meta.prestigeCount | 0) >= 1, null, { timeout: 8000 }).catch(() => {});
    // UX Phase 4 (C-19): the rebuild beat plays on Battle first; a tap skips it
    const beat = await page.evaluate(() => ({ skip: !!document.querySelector('.rebuild-skip'), battle: window.__citadel.game.ui.shell.battleVisible, t: window.__citadel.app.renderer.moments.beatTime }));
    await page.screenshot({ path: `${OUT}/decide-${vp.id}-rebuild-beat.png` });
    if (beat.skip) await page.locator('.rebuild-skip').tap();
    await page.waitForTimeout(700);
    check(`decide ${vp.id}: the first Prestige plays the rebuild beat on Battle (skippable with a tap)`, beat.skip && beat.battle && beat.t >= 0, beat);
    const guide = await page.evaluate(() => ({ tab: window.__citadel.game.ui.shell.tab, seg: window.__citadel.game.ui.prestigeScreen.segment,
      view: document.querySelector('.screen.s-prestige .crumb-page .crumb-label')?.textContent ?? null, tier: document.querySelector('.screen.s-prestige .crumb-tree .crumb-label')?.textContent ?? null,
      banner: (() => { const b = document.querySelector('.screen.s-prestige .ps-guide'); return !!b && !b.hidden && b.getBoundingClientRect().height > 0; })(),
      picks: [...document.querySelectorAll('.screen.s-prestige .pshop .node.guide')].filter((e) => e.offsetParent).length,
      echoes: window.__citadel.game.latestUi().meta.echoes, prestiges: window.__citadel.game.latestUi().meta.prestigeCount }));
    await page.screenshot({ path: `${OUT}/decide-${vp.id}-first-prestige-guide.png` });
    const pick = page.locator('.screen.s-prestige .pshop .node.guide .btn.buy:not(:disabled)').first();
    if (await pick.count()) { await pick.tap(); await page.waitForTimeout(600); }
    const spent = await page.evaluate(() => window.__citadel.game.latestUi().meta.echoes);
    check(`decide ${vp.id}: the ceremony's Prestige lands on Prestige → Echo tiers (Tier I) with the guided first Echo spend, and a guided Buy spends Echoes`,
      guide.prestiges >= 1 && guide.tab === 'prestige' && guide.seg === 'layers' && guide.view === 'Echo tiers' && guide.tier === 'Tier I' && guide.banner && guide.picks > 0 && spent < guide.echoes, { guide, spent });
    await closeDialogs();

    // ---- 2. a later Prestige: verdict first, locked Frames folded, choices above the Frames, summary in the confirm
    const later = ownerSave();
    Object.assign(later.meta, { prestigeCount: 2, echoes: 500, deepestEver: 45 });
    later.meta.prestigeRanks = { ...later.meta.prestigeRanks, 'prestige.keepsake': 1, 'prestige.threat_dial': 1, 'prestige.dual_doctrine': 1, 'prestige.branch_discount': 1 };
    later.run.build.anomalies = ['glass_cannon', 'spare_barrel'];
    later.savedAtMs = Date.now();
    await load(later);
    await closeDialogs();
    await page.evaluate(() => window.__citadel.game.ui.open('prestige'));
    await page.waitForTimeout(500);
    const pm = await page.evaluate(() => {
      const root = document.querySelector('.prestige-modal .prestige');
      if (!root) return null;
      const kids = [...root.children];
      const idx = (sel) => kids.findIndex((k) => k.matches(sel) || !!k.querySelector?.(sel));
      const fs = parseFloat(getComputedStyle(root.querySelector('.pr-verdict-line') ?? root).fontSize);
      return { first: kids[0]?.className ?? '', head: root.querySelector('.pr-verdict-head')?.textContent ?? '', lines: [...root.querySelectorAll('.pr-verdict-line')].map((e) => e.textContent),
        fold: root.querySelector('.pr-locked-sum')?.textContent ?? null, foldOpen: !!root.querySelector('details.pr-locked')?.open,
        moves: (() => { const f = window.__citadel.game.latestUi()?.forecast; return !!f && f.nextFrontier > f.frontier; })(),
        keep: idx('select[aria-label="Keepsake"]'), dial: idx('input[aria-label="Threat Dial"]'), frames: idx('.frame-cards'), fs };
    });
    await page.screenshot({ path: `${OUT}/decide-${vp.id}-later-prestige.png` });
    await page.locator('.prestige-modal .pr-locked-sum').first().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/decide-${vp.id}-later-prestige-frames.png` });
    check(`decide ${vp.id}: the later Prestige modal leads with the verdict, folds locked Frames, puts the choices above the Frames`,
      !!pm && pm.first.includes('pr-verdict') && /Recommended now|Waiting ~|Not recommended yet/.test(pm.head) && (!pm.moves || pm.lines.some((l) => /^Frontier: wave \d+ → \d+$/.test(l)))
      && /more Frames? locked/.test(pm.fold ?? '') && !pm.foldOpen && pm.keep >= 0 && pm.keep < pm.frames && pm.dial >= 0 && pm.dial < pm.frames && pm.fs >= 14, pm);
    await page.locator('.prestige-modal').getByRole('button', { name: 'Prestige', exact: true }).first().tap().catch(() => {});
    await page.waitForTimeout(400);
    const conf = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.textContent ?? '').join(' | '));
    await page.screenshot({ path: `${OUT}/decide-${vp.id}-later-confirm.png` });
    check(`decide ${vp.id}: the confirm step summarizes Keepsake and Threat Dial`, /Keepsake: /.test(conf) && /Threat Dial: level \d+/.test(conf) && /Branch Discount: /.test(conf), conf.slice(0, 400));
    await closeDialogs();

    // ---- 3. Doctrine "Change at next checkpoint": queue mid-wave, see it pending, cancel it
    const doc = ownerSave();
    Object.assign(doc.meta, { deepestEver: 45 });
    await load({ ...doc, savedAtMs: Date.now() });
    const save = await page.evaluate(async () => {
      const g = window.__citadel.game, ui = g.latestUi();
      const s = await g.client.requestSave();
      const docs = ui.shop.filter((e) => e.tree === 'ballistics' && e.kind === 'doctrine').map((e) => e.node.split('.')[1]);
      for (const e of ui.shop) if (e.tree === 'ballistics' && e.kind !== 'doctrine' && e.kind !== 'exotic' && e.currency === 'scrap') s.run.build.ranks[e.node] = Math.max(1, s.run.build.ranks[e.node] | 0);
      s.run.build.doctrines = { ballistics: docs[0] };
      s.run.build.secondDoctrines = {};
      s.run.build.anomalies = [];
      s.run.cores = 3;
      s.savedAtMs = Date.now();
      return { s, docs };
    });
    await load(save.s);
    await page.waitForFunction(() => window.__citadel.game.latestUi()?.run.phase === 'combat', null, { timeout: 60000 });
    // ---- 3a. stay with the fight: a tab opened from a decision source holds the run; a tab the player opens stays live
    await page.locator('.tabbar .tab-btn[data-tab="build"]').first().tap();
    await page.waitForTimeout(300);
    const own = await page.evaluate(() => window.__citadel.game.paused);
    await page.locator('.tabbar .tab-btn[data-tab="battle"]').first().tap();
    await page.waitForTimeout(300);
    await page.evaluate(() => { const sh = window.__citadel.game.ui.shell; sh.armDecision(); sh.go('build'); });
    await page.waitForTimeout(300);
    const held = await page.evaluate(() => ({ paused: window.__citadel.game.paused, mark: !!document.querySelector('.tab-btn.t-battle.held'), label: document.querySelector('.tab-btn.t-battle')?.getAttribute('aria-label') }));
    await page.screenshot({ path: `${OUT}/decide-${vp.id}-held.png` });
    await page.locator('.tabbar .tab-btn[data-tab="battle"]').first().tap();
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({ paused: window.__citadel.game.paused, mark: !!document.querySelector('.tab-btn.t-battle.held') }));
    check(`decide ${vp.id}: a decision-sourced tab holds the run until Battle (own tabs stay live)`, own === false && held.paused && held.mark && /paused for your decision/.test(held.label ?? '') && !back.paused && !back.mark, { own, held, back });
    await page.locator('.tabbar .tab-btn[data-tab="upgrades"]').first().tap();
    await page.waitForTimeout(300);
    await crumbTo(page, 'Chassis', 'Ballistics');
    await page.waitForTimeout(200);
    const btn = page.locator('.screen.s-upgrades .doctrine button[data-action="change1"]').first();
    const label = ((await btn.textContent().catch(() => '')) ?? '').trim();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    const card = await page.evaluate(() => { const c = document.querySelector('.screen.s-upgrades .doctrine:not(.chosen)'); return c ? { cap: c.querySelector('.doc-cap')?.textContent ?? '', trade: c.querySelector('.doc-trade')?.textContent ?? '' } : null; });
    await page.screenshot({ path: `${OUT}/decide-${vp.id}-fork-tradeoff.png` });
    await btn.tap().catch(() => {});
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Queue change' }).tap().catch(() => {});
    await page.waitForFunction(() => (window.__citadel.game.latestUi()?.run.pendingDoctrines ?? []).length === 1, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const pend = await page.evaluate(() => ({ q: window.__citadel.game.latestUi()?.run.pendingDoctrines ?? [], line: document.querySelector('.screen.s-upgrades .doc-pending')?.textContent ?? null }));
    await page.locator('.screen.s-upgrades .doc-pending').first().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/decide-${vp.id}-fork-pending.png` });
    check(`decide ${vp.id}: the fork card shows the capstone, a numeric tradeoff and "Change at next checkpoint"; queueing shows the pending change`,
      label.startsWith('Change at next checkpoint') && !!card && /Capstone: .+\. .+/.test(card.cap) && /\d.*Scrap · capstone/.test(card.trade) && pend.q.length === 1 && /next checkpoint/.test(pend.line ?? ''), { label, card, pend });
    await page.locator('.screen.s-upgrades .doctrine button[data-action="cancel"]').first().tap().catch(() => {});
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Cancel change' }).tap().catch(() => {});
    await page.waitForFunction(() => (window.__citadel.game.latestUi()?.run.pendingDoctrines ?? []).length === 0, null, { timeout: 5000 }).catch(() => {});
    const after = await page.evaluate(() => (window.__citadel.game.latestUi()?.run.pendingDoctrines ?? []).length);
    check(`decide ${vp.id}: Cancel change empties the queue`, after === 0, { after });
    // ---- 3b. navigation fixes (scripted; polling because headless runs on software GL)
    const rich = await page.evaluate(async () => { const s = await window.__citadel.game.client.requestSave(); s.run.scrap = 1e12; s.savedAtMs = Date.now(); return s; });
    await load(rich);
    await page.waitForFunction(() => window.__citadel.game.latestUi()?.run.phase === 'combat', null, { timeout: 60000 });
    const poll = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(typeof fn === 'string' ? `(${'()=>'}${fn})()` : fn); if (v || Date.now() - t0 > ms) return v; await page.waitForTimeout(100); } };
    const sumRanks = () => page.evaluate(() => Object.values(window.__citadel.game.latestUi().build.ranks).reduce((a, b) => a + b, 0));
    // N-01: the Upgrades tab (as a pointer ring would lead the player there) never holds the run, and a buy lands within ~1 s
    await page.locator('.tabbar .tab-btn[data-tab="upgrades"]').first().tap();
    await page.waitForTimeout(300);
    const heldOnTab = await page.evaluate(() => window.__citadel.game.paused);
    const r0 = await sumRanks();
    await page.locator('.screen.s-upgrades .node .btn.buy:not([disabled])').first().tap();
    const bought = await poll(`Object.values(window.__citadel.game.latestUi().build.ranks).reduce((a, b) => a + b, 0) > ${r0}`, 3000);
    check(`nav ${vp.id}: a guided Upgrades visit does not hold the run, and a buy there raises a rank within ~1 s`, heldOnTab === false && !!bought, { heldOnTab, r0, r1: await sumRanks() });
    await page.screenshot({ path: `${OUT}/nav-${vp.id}-upgrades-buy.png` });
    // N-01 (b): a hold from a decision source ends when the player sends any command
    await page.locator('.tabbar .tab-btn[data-tab="battle"]').first().tap();
    await page.waitForTimeout(300);
    await page.evaluate(() => { const sh = window.__citadel.game.ui.shell; sh.armDecision(); sh.go('upgrades'); });
    await page.waitForTimeout(300);
    const held2 = await page.evaluate(() => window.__citadel.game.paused);
    const r2 = await sumRanks();
    await page.locator('.screen.s-upgrades .node .btn.buy:not([disabled])').first().tap();
    const live2 = await poll(() => !window.__citadel.game.paused);
    const grew = await poll(`Object.values(window.__citadel.game.latestUi().build.ranks).reduce((a, b) => a + b, 0) > ${r2}`, 3000);
    check(`nav ${vp.id}: a decision hold ends as soon as the player buys (the buy lands)`, held2 === true && live2 === true && !!grew, { held2, live2, grew });
    // N-02 / N-03: Kill-Chain Inspector opened from another tab stays open; Back with a dialog on Battle closes it and stays in the app
    await page.locator('.tabbar .tab-btn[data-tab="upgrades"]').first().tap();
    await page.waitForTimeout(300);
    await page.locator('.tabbar .tab-btn[data-tab="more"]').first().tap();
    await page.waitForTimeout(300);
    await page.locator('.menu-item', { hasText: 'Kill-Chain Inspector' }).first().tap();
    await page.waitForTimeout(1200);
    const insp = await page.evaluate(() => ({ modal: !!document.querySelector('.modal-card'), tab: document.body.className.match(/tab-(\w+)/g) }));
    check(`nav ${vp.id}: the Kill-Chain Inspector opened from More stays open (it used to close at once)`, insp.modal, insp);
    const url0 = page.url();
    await page.goBack().catch(() => {});
    await page.waitForTimeout(600);
    const afterBack = await page.evaluate(() => ({ modal: !!document.querySelector('.modal-card'), url: location.href }));
    check(`nav ${vp.id}: Back with that dialog up on Battle closes it and does not leave the app`, !afterBack.modal && afterBack.url === url0, { afterBack, url0 });
    // closing a dialog with its own control leaves history as it was (a later Back does not eat a screen)
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    const spaceOpen = await page.evaluate(() => !!document.querySelector('.modal-card'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const closed = await page.evaluate(() => ({ modal: !!document.querySelector('.modal-card'), url: location.href }));
    check(`nav ${vp.id}: Esc closes the dialog and stays on the app`, spaceOpen && !closed.modal && closed.url === url0, { spaceOpen, ...closed });
    check(`decide ${vp.id}: no console errors`, errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }
}

/** Upgrades breadcrumb: "Page ▾" → `page`, then (optionally) "Tree ▾" → `tree` (no-ops when already on show). */
async function crumbTo(page, name, tree) {
  const S = '.screen.s-upgrades';
  const cur = ((await page.locator(`${S} .crumb-page .crumb-label`).textContent().catch(() => '')) ?? '').trim();
  if (cur !== name) {
    await page.locator(`${S} .crumb-page`).tap().catch(() => {});
    await page.waitForTimeout(250);
    await page.locator('.modal-card.popover .cm-row:not(.sub)', { hasText: name }).first().tap().catch(() => {});
    await page.waitForTimeout(300);
  }
  if (!tree) return;
  const tc = page.locator(`${S} .crumb-tree`);
  if (!(await tc.isVisible().catch(() => false)) || ((await tc.locator('.crumb-label').textContent()) ?? '').trim() === tree) return;
  await tc.tap();
  await page.waitForTimeout(250);
  await page.locator('.modal-card.popover .cm-row:not(.sub)', { hasText: tree }).first().tap().catch(() => {});
  await page.waitForTimeout(300);
}
