// Overlay overlap checker (the overlay lanes: src/ui/lanes.ts). `auditOverlays` runs IN THE PAGE
// (page.evaluate(auditOverlays, opts)): it measures every transient / floating overlay on Battle and the targets they must
// never hide, and returns the boxes, the arena geometry and a list of findings. Self-contained (Playwright serialises the
// function), no imports. Used by tests/e2e/e2e.mjs ("phone overlays").
//
// Overlays: coach banner, toasts, pointer ring + label, boon offer card, death card, boss bar (+ tell), armed hint,
// salvage floaters, open modals (reported, never flagged: a modal blocks on purpose).
// Protected targets: the tower's hold zone (arena centre), the Upgrade button and the starter stats, the ability buttons,
// the Overcharge button, the quick-buy chip, the tab bar, the top bar (wave / Scrap / HP), the boss bar, each run control and the boon chip,
// the pointer ring's current target, the coach banner's buttons and the boon offer's Take.
// Findings (kind); the first five are hard rules (the e2e fails on them), the last three are measures:
//   cover        an overlay covers a protected target by more than `tol` px in both directions
//   pair         two overlays overlap each other
//   clip         an overlay reaches outside the safe viewport (notch, home indicator)
//   centre       an overlay touches the tower's hold zone (a touch there charges Overcharge)
//   deadtap      part of an overlay over the arena takes taps without being a control (should be pointer-events: none);
//                the death card (a scrollable card) is measured but not flagged
//   arena        an overlay covers more than `arenaMax` of the arena circle
//   rim          an overlay covers more than `rimMax` of the on-screen spawn rim
//   range        an overlay covers more than `rangeMax` of the primary range disc
export function auditOverlays(opts = {}) {
  const tol = opts.tol ?? 4, arenaMax = opts.arenaMax ?? 0.15, rimMax = opts.rimMax ?? 0.3, rangeMax = opts.rangeMax ?? 0.2;
  const deadMax = opts.deadMax ?? 400;   // px² of dead-tap area per overlay tolerated (a few px of padding)
  const vw = innerWidth, vh = innerHeight;
  const cs = getComputedStyle(document.documentElement);
  const px = (v) => parseFloat(v) || 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding:var(--safe-top,0px) var(--safe-right,0px) var(--safe-bottom,0px) var(--safe-left,0px)';
  document.body.appendChild(probe);
  const ps = getComputedStyle(probe);
  const safe = { top: px(ps.paddingTop), right: px(ps.paddingRight), bottom: px(ps.paddingBottom), left: px(ps.paddingLeft) };
  probe.remove();
  void cs;

  const shown = (el) => {
    if (!el || !el.isConnected || el.closest('[hidden]')) return false;
    for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || (+s.opacity === 0 && s.animationName === 'none')) return false; }
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const inter = (a, b) => ({ w: Math.min(a.r, b.r) - Math.max(a.l, b.l), h: Math.min(a.b, b.b) - Math.max(a.t, b.t) });
  const hits = (a, b) => { const i = inter(a, b); return i.w > tol && i.h > tol; };
  const round = (b) => b && { l: Math.round(b.l), t: Math.round(b.t), r: Math.round(b.r), b: Math.round(b.b) };

  // ---------------------------------------------------------------- arena
  const c = window.__citadel?.app;
  const canvas = c?.canvas;
  let arena = null;
  if (c && canvas) {
    const cr = canvas.getBoundingClientRect(), cam = c.camera;
    const sx = cr.width / cam.viewW, sy = cr.height / cam.viewH;
    const p = cam.toScreen(0, 0, { x: 0, y: 0 });
    const cx = cr.left + p.x * sx, cy = cr.top + p.y * sy, s = cam.scale * sx;
    let range = 0;
    const snap = c.snapshot;
    if (snap && snap.instances?.buffer?.byteLength) {
      for (let i = 0; i < snap.instanceCount; i++) {
        const o = i * 12, a = snap.instances;
        // the primary range ring (snapshot-tower.ts writeTowerBase): a Ring at the origin, colour (0.45, 0.85, 1)
        if (a[o] === 0 && a[o + 1] === 0 && Math.abs(a[o + 5] - 0.45) < 0.01 && Math.abs(a[o + 6] - 0.85) < 0.01 && a[o + 7] === 1) { range = a[o + 2]; break; }
      }
    }
    const R = cam.arenaRadius * s;
    // the tower's hold zone (app/active-tap.ts holdOnTower: TOWER_HOLD_PX 34, or the tower radius 26 + 10)
    const tr = Math.max(34, 26 * cam.scale + 10) * sx;
    arena = { cx, cy, R, range: range * s, hold: tr, tower: { l: cx - tr, t: cy - tr, r: cx + tr, b: cy + tr } };
  }

  // ---------------------------------------------------------------- overlays and targets
  const onBattle = !document.body.className.match(/\btab-(upgrades|build|prestige|more)\b/) || document.body.classList.contains('shell-desktop');
  const overlays = [];
  const addO = (name, el, extra = {}) => { if (shown(el)) overlays.push({ name, el, box: box(el), ...extra }); };
  addO('coach', document.querySelector('.toast-layer .coach-banner'));
  document.querySelectorAll('.toast-layer .toast').forEach((el, i) => addO(`toast${i}`, el));
  const ring = document.querySelector('.hint-ring');
  if (ring && !ring.hidden) addO('ring', ring);
  const label = document.querySelector('.hint-label');
  if (label && !label.hidden && !label.classList.contains('faded')) addO('label', label);
  addO('boon-offer', document.querySelector('.boon-offer'));
  addO('death', document.querySelector('.death-card'));
  addO('boss-bar', document.querySelector('.boss-bar'));
  addO('arm-hint', document.querySelector('.arm-hint'));
  document.querySelectorAll('.salvage-floater').forEach((el, i) => addO(`floater${i}`, el));
  const modals = [...document.querySelectorAll('.modal-card')].filter(shown).map((el) => ({ name: `modal:${el.className}`, box: round(box(el)) }));

  const targets = [];
  const addT = (name, el) => { if (shown(el)) targets.push({ name, el, box: box(el) }); };
  addT('upgrade', document.querySelector('.starter .st-btn'));
  document.querySelectorAll('.starter .st-item').forEach((el, i) => addT(`starter-item${i}`, el));
  document.querySelectorAll('.ability-row .btn.ability').forEach((el, i) => addT(`ability${i}`, el));
  addT('overcharge', document.querySelector('.oc-btn'));
  addT('quick-buy', document.querySelector('.abilities .btn.quick-buy'));
  if (!document.body.classList.contains('no-tabbar') || document.body.classList.contains('shell-desktop')) addT('tabbar', document.querySelector('.tabbar'));
  addT('topbar', document.querySelector('.topbar'));
  addT('boss-bar', document.querySelector('.boss-bar'));
  addT('coach-ok', document.querySelector('.coach-banner .coach-ok'));
  addT('coach-act', document.querySelector('.coach-banner .coach-act'));
  addT('boon-take', document.querySelector('.boon-offer .bo-take'));
  document.querySelectorAll('.arena-strip > :is(button, .battle-controls)').forEach((el) => { if (el.matches('.battle-controls')) el.querySelectorAll(':scope > *').forEach((b, i) => addT(`control${i}`, b)); else addT(el.className.includes('boon-chip') ? 'boon-chip' : 'boon-row', el); });
  const rt = ring && !ring.hidden ? ring.dataset.hintTarget : '';
  const ringEl = window.__citadel?.game?.ui?.['hints']?.pointer?.targetEl ?? null;
  if (ringEl && shown(ringEl)) targets.push({ name: `ring-target:${rt || ringEl.className}`, el: ringEl, box: box(ringEl) });

  const findings = [];
  const add = (kind, a, b, detail) => findings.push({ kind, a, b, detail });
  const related = (x, y) => !!(x.el && y.el && (x.el === y.el || x.el.contains(y.el) || y.el.contains(x.el)));

  if (onBattle) {
    // cover: overlay over a protected target (never the overlay's own controls, never the ring around its own target)
    for (const o of overlays) for (const t of targets) {
      if (related(o, t)) continue;
      if (o.name === 'ring' && (t.name.startsWith('ring-target') || (ringEl && t.el && t.el.contains(ringEl)))) continue;
      if (o.name === 'boss-bar' && t.name === 'boss-bar') continue;
      // the ring is drawn around its target: it may touch a neighbour by its halo, but the ring box itself must not
      // sit on another control
      if (hits(o.box, t.box)) { const i = inter(o.box, t.box); add('cover', o.name, t.name, `${Math.round(i.w)}×${Math.round(i.h)} px`); }
    }
    // pair: two overlays overlapping (the ring + its label are one hint)
    for (let i = 0; i < overlays.length; i++) for (let j = i + 1; j < overlays.length; j++) {
      const a = overlays[i], b = overlays[j];
      if (related(a, b)) continue;
      if ((a.name === 'ring' && b.name === 'label') || (a.name.startsWith('floater') || b.name.startsWith('floater'))) continue;
      // the ring around a control inside another overlay (the coach banner's "Turn on") wraps it on purpose
      const ringIn = (x, y) => x.name === 'ring' && ringEl && y.el.contains(ringEl);
      if (ringIn(a, b) || ringIn(b, a)) continue;
      if (a.name.startsWith('toast') && b.name.startsWith('toast')) continue;
      if (hits(a.box, b.box)) { const x = inter(a.box, b.box); add('pair', a.name, b.name, `${Math.round(x.w)}×${Math.round(x.h)} px`); }
    }
    // clip: outside the safe viewport, or under the tab bar / top bar
    const tb = targets.find((t) => t.name === 'tabbar'), top = targets.find((t) => t.name === 'topbar');
    for (const o of overlays) {
      if (o.name.startsWith('floater')) continue;
      const b = o.box;
      if (b.l < safe.left - 1 || b.t < safe.top - 1 || b.r > vw - safe.right + 1 || b.b > vh - safe.bottom + 1) add('clip', o.name, 'safe-area', JSON.stringify(round(b)));
      if (tb && hits(b, tb.box) && o.name !== 'ring' && o.name !== 'label') { /* reported as cover */ }
      if (top && o.name !== 'ring' && o.name !== 'label' && b.t < top.box.b - tol && b.b > top.box.t) { /* reported as cover */ }
    }
  }

  // arena: centre, share of the circle, share of the range disc, share of the rim, dead taps
  const arenaStats = {};
  if (arena && onBattle) {
    const { cx, cy, R } = arena;
    const inArena = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
    const onScreen = (x, y) => x >= 0 && y >= 0 && x < vw && y < vh;
    const step = 6;
    let total = 0, totalRange = 0;
    const cov = new Map(), covRange = new Map(), dead = new Map();
    const ownerOf = (el) => overlays.find((o) => o.el === el || o.el.contains(el)) ?? null;
    for (let y = Math.max(0, cy - R); y < Math.min(vh, cy + R); y += step) for (let x = Math.max(0, cx - R); x < Math.min(vw, cx + R); x += step) {
      if (!inArena(x, y)) continue;
      total++;
      const inRange = arena.range > 0 && (x - cx) ** 2 + (y - cy) ** 2 <= arena.range ** 2;
      if (inRange) totalRange++;
      for (const o of overlays) {
        if (o.name.startsWith('floater')) continue;
        const b = o.box;
        if (x >= b.l && x < b.r && y >= b.t && y < b.b) { cov.set(o.name, (cov.get(o.name) ?? 0) + 1); if (inRange) covRange.set(o.name, (covRange.get(o.name) ?? 0) + 1); }
      }
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === canvas) continue;
      if (hit.closest('button, a, input, select, textarea, [role="button"], .modal-layer')) continue;
      const o = ownerOf(hit);
      const k = o ? o.name : (hit.closest('.battle-layer, .toast-layer, .hint-layer') ? `other:${hit.className || hit.tagName}` : null);
      if (k) dead.set(k, (dead.get(k) ?? 0) + step * step);
    }
    for (const o of overlays) {
      if (o.name.startsWith('floater')) continue;
      // the hold circle against the overlay's box (nearest point of the box to the centre)
      const nx = Math.max(o.box.l, Math.min(cx, o.box.r)), ny = Math.max(o.box.t, Math.min(cy, o.box.b));
      if (Math.hypot(nx - cx, ny - cy) < arena.hold - 1 && o.name !== 'ring') add('centre', o.name, 'tower', JSON.stringify(round(o.box)));
      const share = total ? (cov.get(o.name) ?? 0) / total : 0;
      const rshare = totalRange ? (covRange.get(o.name) ?? 0) / totalRange : 0;
      arenaStats[o.name] = { arena: +share.toFixed(3), range: +rshare.toFixed(3) };
      if (share > arenaMax && o.name !== 'ring') add('arena', o.name, 'arena', `${(share * 100).toFixed(1)}% of the arena`);
      if (rshare > rangeMax && o.name !== 'ring') add('range', o.name, 'range', `${(rshare * 100).toFixed(1)}% of the range disc`);
    }
    // the spawn rim: the on-screen part of the arena circle
    let rimN = 0; const rimCov = new Map();
    for (let k = 0; k < 360; k++) {
      const a = (k / 360) * Math.PI * 2, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      if (!onScreen(x, y)) continue;
      rimN++;
      for (const o of overlays) { if (o.name.startsWith('floater')) continue; const b = o.box; if (x >= b.l && x < b.r && y >= b.t && y < b.b) rimCov.set(o.name, (rimCov.get(o.name) ?? 0) + 1); }
    }
    for (const [n, v] of rimCov) { const f = v / Math.max(1, rimN); (arenaStats[n] ??= {}).rim = +f.toFixed(3); if (f > rimMax && n !== 'ring') add('rim', n, 'spawn-rim', `${(f * 100).toFixed(1)}% of the rim`); }
    // the death card is a scrollable card (wheel / drag scroll it): its surface may take taps; it stays above the tower
    for (const [n, v] of dead) { (arenaStats[n] ??= {}).dead = v; if (v > deadMax && n !== 'death') add('deadtap', n, 'arena', `${v} px² take taps without being a control`); }
  }

  return {
    vw, vh, safe, onBattle, body: document.body.className,
    arena: arena && { cx: Math.round(arena.cx), cy: Math.round(arena.cy), R: Math.round(arena.R), range: Math.round(arena.range), hold: Math.round(arena.hold), tower: round(arena.tower) },
    overlays: overlays.map((o) => ({ name: o.name, box: round(o.box) })),
    targets: targets.map((t) => ({ name: t.name, box: round(t.box) })),
    modals, arenaStats, findings,
  };
}
