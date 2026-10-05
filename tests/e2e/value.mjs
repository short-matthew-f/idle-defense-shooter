// Phase 2 "make value legible" (docs/reviews/HANDBOOK-EVAL.md Phase 2 items 1, 2, 9, 11), run by e2e.mjs unless
// E2E_SKIP_VALUE=1. At 393×852, 375×667 (DPR 2, notch insets) and 852×393 landscape, from a crafted save after two
// Prestiges (stage 7, abilities revealed, Unlock everything off):
//   - Battle: the dock's quick-buy chip shows, is ≥ 44 px, stays in the viewport and clear of the ability and
//     Overcharge buttons; one tap buys (the picked node gains a rank)
//   - Upgrades → Chassis: a stat row shows "a → b" whose numbers match the UiState entry (statNow, statAfter[0])
//   - the Quartermaster card once seen (prefs.qmSeen) is one row with an inline switch (data-hint quartermaster-toggle)
//   - a late-game save (every Chassis Scrap row maxed, 38.8M Scrap) leads Upgrades with the bottleneck line
// Screenshots: OUT/value-<vp>-<view>.png.

const VPS = (process.env.E2E_VALUE_VP ? (v) => v.filter((x) => x.id === process.env.E2E_VALUE_VP) : (v) => v)([
  { id: '393', viewport: { width: 393, height: 852 }, safe: { top: 59, bottom: 34 } },
  { id: '375', viewport: { width: 375, height: 667 }, safe: { top: 20, bottom: 0 } },
  { id: 'land', viewport: { width: 852, height: 393 }, safe: { top: 0, bottom: 21 } },
]);

/** "13.2" / "1.2K" / "5.5%" / "×1.6" / "2.2/s" → number (percent → fraction). */
function parseStat(s) {
  const m = /^×?(-?[\d.]+)(K|M|B|T)?(%|\/s)?$/.exec(s.trim());
  if (!m) return NaN;
  let v = Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] ?? 1);
  if (m[3] === '%') v /= 100;
  return v;
}

export async function value({ browser, BASE, OUT, check, attachLogs }) {
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
      s.meta.prestigeCount = 2; s.meta.deepestEver = 60; s.meta.echoes = 3000;
      s.run.deepestCleared = 30; s.run.checkpoint = 30; s.run.wave = 31; s.run.scrap = 52345; s.run.cores = 5;
      s.run.hardpointSlotsOpen = 1; s.run.build.hardpoints = ['ordnance'];
      s.run.build.ranks = { 'ballistics.damage': 12, 'ballistics.attack_speed': 10, 'bastion.max_hp': 8, 'ballistics.crit_chance': 3 };
      s.savedAtMs = Date.now();
      return s;
    });
    const load = async (save, prefs) => {
      await page.goto(`${BASE}icons/icon-192.png`);
      await page.evaluate(async ({ save, prefs }) => {
        localStorage.clear();
        // past the onboarding, hints and the first-run coach; the Quartermaster card already seen
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
    const prefs = { pointerHints: false, buyCoach: 3, qmSeen: true, onboarded: true };
    await load(base, prefs);
    const tapTab = async (id) => { await page.locator(`.tabbar .tab-btn[data-tab="${id}"], .rail .tab-btn[data-tab="${id}"]`).first().tap(); await page.waitForTimeout(400); };

    // ---- Battle: the quick-buy chip
    await tapTab('battle').catch(() => {});
    await page.waitForFunction(() => { const b = document.querySelector('.btn.quick-buy'); return !!b && !b.hidden && b.getBoundingClientRect().height > 0; }, null, { timeout: 15000 }).catch(() => {});
    const geo = await page.evaluate(() => {
      const r = (el) => { const q = el.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height }; };
      const chip = document.querySelector('.btn.quick-buy');
      if (!chip || chip.hidden) return null;
      const others = [...document.querySelectorAll('.btn.ability, .btn.oc-btn')].filter((e) => e.getBoundingClientRect().height > 0).map(r);
      const name = chip.querySelector('.qb-name')?.textContent ?? '';
      const fs = Math.min(...[...chip.querySelectorAll('.qb-name, .price')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
      return { chip: r(chip), others, name, fs, vw: innerWidth, vh: innerHeight, ready: chip.classList.contains('ready'), label: chip.getAttribute('aria-label') };
    });
    await page.screenshot({ path: `${OUT}/value-${vp.id}-battle.png` });
    const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    check(`value ${vp.id}: the Battle dock shows a quick-buy chip (≥ 44 px, ≥ 14 px text, in view, clear of the ability and Overcharge buttons)`,
      !!geo && geo.chip.h >= 44 && geo.fs >= 14 && geo.chip.l >= 0 && geo.chip.r <= geo.vw && geo.chip.b <= geo.vh && geo.others.length >= 2 && !geo.others.some((o) => hit(geo.chip, o)), geo);
    if (geo?.ready) {
      const before = await page.evaluate(() => { const u = window.__citadel.game.ui.ctx.state(); return { scrap: u.run.scrap, ranks: { ...u.build.ranks } }; });
      const top = await page.evaluate(() => { const r = document.querySelector('.btn.quick-buy').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e ? `${e.tagName}.${e.className}` : null; });
      await page.locator('.btn.quick-buy').tap();
      await page.waitForFunction((b) => { const u = window.__citadel.game.ui.ctx.state(); return Object.keys(u.build.ranks).some((k) => (u.build.ranks[k] | 0) > (b[k] | 0)); }, before.ranks, { timeout: 4000 }).catch(() => {});
      const after = await page.evaluate(() => { const u = window.__citadel.game.ui.ctx.state(); return { scrap: u.run.scrap, ranks: { ...u.build.ranks } }; });
      const gained = Object.keys(after.ranks).filter((k) => (after.ranks[k] | 0) > (before.ranks[k] | 0));
      check(`value ${vp.id}: one tap on the quick-buy chip buys a rank`, gained.length >= 1, { gained, label: geo.label, top, phase: await page.evaluate(() => { const u = window.__citadel.game.ui.ctx.state(); return [u.run.phase, u.run.wave, u.run.scrap]; }).catch((e) => String(e)), scrapBefore: before.scrap });
    } else check(`value ${vp.id}: the quick-buy chip has something affordable in this save`, false, geo);

    // ---- Upgrades → Chassis: before → after on a stat row, matching UiState
    await tapTab('upgrades');
    await page.locator('.screen.s-upgrades .cat-tabs .tab:has-text("Chassis")').first().tap().catch(() => {});
    await page.waitForTimeout(400);
    const rows = await page.evaluate(() => {
      const ui = window.__citadel.game.ui.ctx.state();
      const by = new Map(ui.shop.map((e) => [e.node, e]));
      return [...document.querySelectorAll('.screen.s-upgrades .node')].filter((n) => { const s = n.querySelector('.node-stat'); return s && !s.hidden && s.textContent; })
        .map((n) => { const e = by.get(n.dataset.node); return { node: n.dataset.node, text: n.querySelector('.node-stat').textContent, now: e?.statNow, next: e?.statAfter?.[0], unit: e?.statUnit, fs: parseFloat(getComputedStyle(n.querySelector('.node-stat')).fontSize) }; });
    });
    await page.screenshot({ path: `${OUT}/value-${vp.id}-upgrades-chassis.png` });
    const okRow = (r) => {
      const m = /([^\s]+) → ([^\s]+)/.exec(r.text);
      if (!m || r.now === undefined || r.next === undefined) return false;
      const a = parseStat(m[1]), b = parseStat(m[2]);
      const tol = (v) => Math.max(0.051 * (r.unit === '%' ? 0.01 : 1), Math.abs(v) * 0.01);   // one shown decimal, or a K/M suffix
      return Math.abs(a - r.now) <= tol(r.now) && Math.abs(b - r.next) <= tol(r.next) && r.fs >= 14;
    };
    check(`value ${vp.id}: Chassis stat rows show "a → b" matching the UiState entry`, rows.length >= 3 && rows.every(okRow) && rows.some((r) => r.node === 'ballistics.damage'), rows.slice(0, 6));

    // ---- the Quartermaster, seen before: one row with an inline switch
    const qm = await page.evaluate(() => {
      const row = document.querySelector('.screen.s-upgrades .qm-row');
      const sw = document.querySelector('.screen.s-upgrades .qm-inline[data-hint="quartermaster-toggle"]');
      const card = document.querySelector('.screen.s-upgrades .qm-card');
      const r = row?.getBoundingClientRect();
      return { row: !!row && r.height > 0, h: r?.height ?? 0, sw: !!sw && !sw.hidden && sw.getBoundingClientRect().height >= 44, cardHidden: !card || card.hidden };
    });
    await page.evaluate(() => { const b = document.querySelector('.screen.s-upgrades .shop-body'); if (b) b.scrollTop = 0; });
    await page.screenshot({ path: `${OUT}/value-${vp.id}-qm-folded.png` });
    check(`value ${vp.id}: the Quartermaster, seen before, is one row (≤ 60 px) with an inline switch`, qm.row && qm.sw && qm.cardHidden && qm.h <= 60, qm);

    // ---- late game: every Chassis Scrap row maxed and 38.8M Scrap → the bottleneck line
    // two passes: max the chassis rows and choose a Doctrine per chassis tree, then max the Doctrine rows that appear
    let late = base;
    for (let pass = 0; pass < 2; pass++) {
      late = await page.evaluate((save) => {
        const ui = window.__citadel.game.ui.ctx.state();
        const ranks = { ...save.run.build.ranks }, doctrines = { ...save.run.build.doctrines };
        const chassis = ['ballistics', 'bastion', 'reactor'];
        for (const e of ui.shop) {
          if (e.kind === 'doctrine' && chassis.includes(e.tree) && !doctrines[e.tree]) doctrines[e.tree] = e.node.slice(e.tree.length + 1);
          else if ([...chassis, 'ability'].includes(e.tree) && e.currency === 'scrap' && e.kind !== 'doctrine') ranks[e.node] = e.maxRank;
        }
        return { ...save, run: { ...save.run, scrap: 38.8e6, build: { ...save.run.build, ranks, doctrines } } };
      }, late);
      await load(late, prefs);
    }
    await tapTab('upgrades');
    await page.locator('.screen.s-upgrades .cat-tabs .tab:has-text("Chassis")').first().tap().catch(() => {});
    await page.waitForTimeout(500);
    const bn = await page.evaluate(() => {
      const b = document.querySelector('.screen.s-upgrades .bottleneck');
      const btn = b?.querySelector('button');
      return { shown: !!b && !b.hidden && b.getBoundingClientRect().height > 0, text: b?.textContent ?? '', btnH: btn?.getBoundingClientRect().height ?? 0 };
    });
    await page.screenshot({ path: `${OUT}/value-${vp.id}-bottleneck.png` });
    check(`value ${vp.id}: late-game Upgrades leads with the bottleneck line and a Forecast button`, bn.shown && /Echoes or Prestige/.test(bn.text) && bn.btnH >= 44, bn);
    if (bn.shown) {
      await page.locator('.screen.s-upgrades .bottleneck button').tap();
      await page.waitForTimeout(500);
      const onForecast = await page.evaluate(() => !!document.querySelector('.screen.s-prestige:not([hidden])') || /Forecast/.test(document.querySelector('.screen:not([hidden]) h2, .screen:not([hidden]) .seg-btn.active')?.textContent ?? ''));
      check(`value ${vp.id}: the bottleneck button opens the Forecast`, onForecast);
    }
    check(`value ${vp.id}: no page errors`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
}
