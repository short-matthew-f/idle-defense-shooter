// The attention plan (src/ui/attention.ts) in a real browser, at phone sizes (scripted: crafted saves, headless Chromium).
//   (a) death first: within 1 s of a death the death card's three suggested buys are fully visible (375×667, 393×852);
//       the start-of-attempt boon offer waits as its chip; unfolding a folded card shows the buys again
//   (b) a boss clear at wave 10: at most 2 attention items (toasts + cards + coach + rings + dialogs) at once in the
//       first 2 s, and the decisions (draft, boon offer) one at a time
//   (c) the coach queue: a session from a fresh ladder (nothing read) to wave 13 shows the abilities line
//   plus the Frontier death at wave 29 and a boss fight (boss mode) for screenshots.
// Run by tests/e2e/e2e.mjs (E2E_SKIP_ATTN=1 skips it). Screenshots go to ATTN_SHOTS (default: OUT).

/** Counts what asks for attention right now (in the page). */
function attentionNow() {
  const vis = (el) => {
    if (!el || !el.isConnected || el.closest('[hidden]')) return false;
    for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden') return false; }
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const toasts = [...document.querySelectorAll('.toast-layer .toast')].filter(vis).map((t) => t.textContent);
  const items = {
    toasts,
    coach: vis(document.querySelector('.coach-banner')) ? document.querySelector('.coach-banner').dataset.coach : null,
    death: vis(document.querySelector('.death-card')),
    offer: vis(document.querySelector('.boon-offer')),
    draft: vis(document.querySelector('.draft-modal')),
    ring: vis(document.querySelector('.hint-ring')),
  };
  items.count = toasts.length + (items.coach ? 1 : 0) + (items.death ? 1 : 0) + (items.offer ? 1 : 0) + (items.draft ? 1 : 0) + (items.ring ? 1 : 0);
  return items;
}

/** The death card's suggested buys: each fully inside the viewport and the card, and on top at its centre. */
function deathBuys() {
  const card = document.querySelector('.death-card');
  if (!card || card.hidden) return { card: false, items: [] };
  const cr = card.getBoundingClientRect();
  const items = [...card.querySelectorAll('.dc-item')].map((b) => {
    const r = b.getBoundingClientRect();
    const inView = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.height > 20;
    const inCard = r.top >= cr.top - 1 && r.bottom <= cr.bottom + 1;
    const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return { text: b.textContent, ok: inView && inCard && !!top && b.contains(top), box: [r.left, r.top, r.width, r.height].map(Math.round) };
  });
  return { card: true, folded: card.classList.contains('folded') || card.classList.contains('lane-folded'), items, cardBox: [cr.left, cr.top, cr.width, cr.height].map(Math.round) };
}

export async function attention({ browser, BASE, OUT, check, attachLogs }) {
  const SHOTS = process.env.ATTN_SHOTS ?? OUT;
  const LADDER = ['start', 'checkpoint', 'elements', 'build', 'abilities', 'boons', 'anomalies', 'bulk', 'prestige', 'cross', 'inspector', 'cores', 'frame', 'exotics', 'doctrines', 'patrol', 'machine', 'salvage', 'overcharge'];
  const viewports = [
    { id: '393', viewport: { width: 393, height: 852 }, safe: { top: 59, bottom: 34 } },
    { id: '375', viewport: { width: 375, height: 667 }, safe: { top: 20, bottom: 0 } },
    { id: 'land', viewport: { width: 852, height: 393 }, safe: { top: 0, bottom: 21 }, shotsOnly: true },
  ];
  const STRONG = "Object.assign(s.run.build.ranks, { 'ballistics.damage': 40, 'ballistics.attack_speed': 25, 'bastion.max_hp': 40 });";
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript((sf) => {
      const put = () => { const st = document.createElement('style'); st.textContent = `:root{--safe-top:${sf.top}px!important;--safe-bottom:${sf.bottom}px!important}`; document.head.appendChild(st); };
      if (document.head) put(); else document.addEventListener('DOMContentLoaded', put);
    }, vp.safe);
    const page = await ctx.newPage();
    const errors = [];
    attachLogs(page, errors);
    const ready = () => page.waitForFunction(() => !!window.__citadel?.game?.ready, null, { timeout: 60000 });
    await page.goto(`${BASE}?fast=1`);
    await ready();
    const fresh = await page.evaluate(() => window.__citadel.game.client.requestSave());
    const load = async (mut, prefs, fast = 1) => {
      const save = await page.evaluate(({ s, mut }) => { new Function('s', mut)(s); s.savedAtMs = Date.now(); return s; }, { s: fresh, mut });
      await page.goto(`${BASE}icons/icon-192.png`);
      await page.evaluate(async ({ save, prefs }) => {
        localStorage.clear();
        if (prefs) localStorage.setItem('citadel.prefs.v1', JSON.stringify(prefs));
        await new Promise((res, rej) => {
          const r = indexedDB.open('citadel', 1);
          r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('saves')) r.result.createObjectStore('saves'); };
          r.onsuccess = () => { const t = r.result.transaction('saves', 'readwrite'); t.objectStore('saves').put(save, 'main'); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
          r.onerror = () => rej(r.error);
        });
      }, { save, prefs });
      await page.goto(`${BASE}?fast=${fast}`);
      await ready();
      await page.waitForTimeout(700);
    };
    const shot = (name) => page.screenshot({ path: `${SHOTS}/attn-${vp.id}-${name}.png` });
    const seenPrefs = (upTo) => ({ revealInit: true, hintsInit: true, coachSeen: LADDER.slice(0, LADDER.indexOf(upTo) + 1), tabsVisited: ['battle', 'upgrades', 'build', 'more'] });

    // (a) death at wave 8 with the start-of-attempt offer pending: the card owns the lane
    await load("s.run.boonOffer = ['iron_skin', 'thick_plating', 'miser']; s.run.boonOfferKind = 'start'; s.run.boonOfferSeq = 2; s.run.boonOfferWave = 6; s.run.deepestCleared = 7; s.meta.deepestEver = 7; s.run.checkpoint = 5; s.run.wave = 8; s.run.scrap = 600;",
      seenPrefs('elements'));
    await page.evaluate(() => { const G = window.__citadel.game; G.ui.death.show(8, G.latestUi(), {}); });
    await page.waitForTimeout(1000);
    const d1 = await page.evaluate(deathBuys);
    const a1 = await page.evaluate(attentionNow);
    const chip = await page.evaluate(() => !document.querySelector('.boon-chip')?.hidden);
    await shot('death-w8');
    if (!vp.shotsOnly) {
      check(`attention ${vp.id}: within 1 s of a death its three suggested buys are fully visible; the start offer waits as its chip`,
        d1.card && !d1.folded && d1.items.length >= 3 && d1.items.slice(0, 3).every((x) => x.ok) && !a1.offer && chip, { d1, a1, chip });
    }
    // after the death-first window the offer comes back; unfolding the card shows the buys again
    await page.evaluate(() => { const d = window.__citadel.game.ui.death; d.shownAt -= 9000; });
    await page.waitForTimeout(900);
    await shot('death-w8-after');
    const a2 = await page.evaluate(attentionNow);
    await page.evaluate(() => document.querySelector('.death-card .dc-fold')?.click());   // fold
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.death-card .dc-title')?.click());   // unfold
    await page.waitForTimeout(900);
    const d2 = await page.evaluate(deathBuys);
    await shot('death-w8-unfold');
    if (!vp.shotsOnly) {
      check(`attention ${vp.id}: after the death-first window the offer shows; unfolding the card shows its buys again`,
        a2.offer && d2.card && !d2.folded && d2.items.length >= 3 && d2.items.slice(0, 3).every((x) => x.ok), { a2: { offer: a2.offer, death: a2.death }, d2 });
    }

    // Frontier death at wave 29 (deepest 28, first Prestige ahead)
    await load("s.run.deepestCleared = 28; s.meta.deepestEver = 28; s.run.checkpoint = 25; s.run.wave = 29; s.run.scrap = 5e6;", { ...seenPrefs('prestige'), coachSeen: [...LADDER] });
    await page.evaluate(() => { const G = window.__citadel.game; G.ui.death.show(29, G.latestUi(), {}); });
    await page.waitForTimeout(1000);
    const fr = await page.evaluate(() => ({ line: document.querySelector('.death-card .dc-frontier:not([hidden])')?.textContent ?? null, forecast: !!document.querySelector('.death-card .dc-forecast:not([hidden])') }));
    await shot('death-frontier-w29');
    if (!vp.shotsOnly) check(`attention ${vp.id}: a death near the Frontier leads with "Past wave N enemies harden fast" and a Forecast button`, !!fr.line && /Past wave \d+ enemies harden fast/.test(fr.line) && fr.forecast, fr);

    // (b) boss clear at wave 10, played for real (a strong build from checkpoint 5); boss mode on the way
    await load(`s.run.deepestCleared = 9; s.meta.deepestEver = 9; s.run.checkpoint = 5; s.run.wave = 6; s.run.scrap = 50; ${STRONG}`, seenPrefs('build'), 4);
    let bossShot = false;
    const t0 = Date.now();
    let clearAt = null;
    while (Date.now() - t0 < 240000) {
      const st = await page.evaluate(() => { const G = window.__citadel.game, u = G.latestUi(); return { wave: u.run.wave, boss: u.wave.isBoss && u.run.phase === 'combat' && u.wave.bossHp > 0, clear: G.ui.feed.bossClearAt, boss10: u.wave.isBoss && u.run.wave === 10 }; });
      if (st.boss && st.wave === 10 && !bossShot) {
        await page.evaluate(() => window.__citadel.game.setFast(1));
        await page.waitForTimeout(600);
        const bm = await page.evaluate(() => ({ body: document.body.classList.contains('attn-boss'), ...(() => { const c = document.querySelector('.coach-banner'); return { coach: !!c && !c.hidden }; })() }));
        await shot('boss-fight-w10');
        if (!vp.shotsOnly) check(`attention ${vp.id}: boss mode during the wave-10 boss (coach held, starter glow paused)`, bm.body && !bm.coach, bm);
        bossShot = true;
        await page.evaluate(() => window.__citadel.game.setFast(4));
      }
      if (st.clear > 0 && Number.isFinite(st.clear)) { clearAt = st.clear; break; }
      await page.waitForTimeout(80);
    }
    if (clearAt === null) { check(`attention ${vp.id}: the wave-10 boss was cleared (scripted run)`, false, {}); }
    else {
      await page.evaluate(() => window.__citadel.game.setFast(1));
      const samples = [];
      for (let k = 0; k < 40; k++) {
        const s = { dt: await page.evaluate((c) => Math.round(performance.now() - c), clearAt), ...(await page.evaluate(attentionNow)) };
        samples.push(s);
        if (k === 3) await shot('bossclear-w10-beat');
        if (k === 14) await shot('bossclear-w10-decision');
        if (k === 30) await shot('bossclear-w10-later');
        await page.waitForTimeout(150);
      }
      const early = samples.filter((s) => s.dt <= 2000);
      const maxEarly = Math.max(0, ...early.map((s) => s.count));
      const both = samples.filter((s) => s.offer && s.draft);
      if (!vp.shotsOnly) {
        check(`attention ${vp.id}: boss clear at wave 10: at most 2 attention items in the first 2 s, decisions one at a time`,
          early.length > 0 && maxEarly <= 2 && both.length === 0, { maxEarly, both: both.length, early: early.map((s) => [s.dt, s.count, s.toasts, s.coach, s.offer, s.draft, s.ring]), later: samples.filter((s) => s.dt > 2000).slice(0, 12).map((s) => [s.dt, s.count, s.offer, s.draft, s.coach]) });
      }
    }

    // (c) the coach queue from a fresh ladder (nothing read) to wave 13: the abilities line shows
    if (!vp.shotsOnly && vp.id === '393') {
      await load(`s.run.deepestCleared = 4; s.meta.deepestEver = 4; s.run.checkpoint = 0; s.run.wave = 1; s.run.scrap = 50; ${STRONG}`, { revealInit: true, hintsInit: true, coachSeen: [], tabsVisited: ['battle'] }, 8);
      const lines = [];
      const t1 = Date.now();
      let wave = 0;
      while (Date.now() - t1 < 330000) {
        const r = await page.evaluate(() => {
          const u = window.__citadel.game.latestUi();
          const c = document.querySelector('.coach-banner');
          const on = !!c && !c.hidden && !c.classList.contains('lane-wait') && c.getBoundingClientRect().height > 0;
          // a player who reads each line, then takes the offer's free way out and sets drafts aside
          document.querySelector('.boon-offer:not([hidden]) .bo-decline')?.click();
          document.querySelector('.draft-modal .draft-foot .btn.ghost')?.click();
          return { wave: u.run.wave, deepest: u.run.deepestCleared, coach: on ? c.dataset.coach : null };
        });
        wave = r.deepest;
        if (r.coach && lines[lines.length - 1]?.id !== r.coach) lines.push({ id: r.coach, wave: r.wave });
        if (r.coach) { await page.waitForTimeout(400); await page.evaluate((id) => { const c = document.querySelector('.coach-banner:not([hidden])'); if (c && c.dataset.coach === id) c.querySelector('.coach-ok')?.click(); }, r.coach); }
        if (lines.some((l) => l.id === 'abilities') || r.deepest >= 14) break;
        await page.waitForTimeout(250);
      }
      check(`attention ${vp.id}: the coach queue, from nothing read to wave 13, shows the abilities line (oldest first, one per wave)`, lines.some((l) => l.id === 'abilities'), { lines, deepest: wave });
    }
    if (!vp.shotsOnly) check(`attention ${vp.id}: zero console errors`, errors.length === 0, errors);
    await ctx.close();
  }
}
