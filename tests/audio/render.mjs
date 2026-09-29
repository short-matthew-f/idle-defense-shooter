#!/usr/bin/env node
// Offline audio render harness (`npm run audio:check`). Nobody can listen in CI, so this measures.
// Bundles tests/audio/harness-entry.ts with esbuild, runs it in headless Chromium (Playwright) and
// renders, with OfflineAudioContext through the real engine at maximum levels:
//   every SFX, a reference tone (440 Hz sine, −12 dBFS peak), 60 s of music per Sector at low /
//   medium / high intensity, a boss-and-low-HP render, and a 10 s director load test (500 events/s).
// Asserts: nothing silent, peak ≤ 0.98 after the limiter, no NaN, each SFX's loudest 50 ms within a
// band relative to the reference, music loudness rise low → high within 6 dB of the intended rise,
// Sectors within 6 dB of each other, the four elements and the ten abilities spectrally / temporally
// distinct, and the load test within the voice cap and under 1 ms p95 per frame.
// Writes WAVs and stats.json to AUDIO_OUT (default: <os tmp>/citadel-audio). Exit code 1 on failure.
//
// Environment: PLAYWRIGHT_DIR, CHROMIUM (as tests/e2e/e2e.mjs), AUDIO_OUT, AUDIO_SECONDS (music length, default 60).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.AUDIO_OUT ?? join(tmpdir(), 'citadel-audio');
const SECONDS = Number(process.env.AUDIO_SECONDS ?? 60);
mkdirSync(OUT, { recursive: true });
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, ROOT, (() => { try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return null; } })(), '/opt/node22/lib/node_modules'].filter(Boolean);
  for (const d of dirs) { try { return createRequire(join(d, 'noop.js'))('playwright'); } catch { /* next */ } }
  throw new Error('playwright not found: install it (npm i -g playwright) or set PLAYWRIGHT_DIR');
}

// ---------------------------------------------------------------- bundle
const esbuild = require('esbuild');
const bundle = await esbuild.build({
  entryPoints: [join(ROOT, 'tests/audio/harness-entry.ts')], bundle: true, write: false, format: 'iife', target: 'es2022',
  tsconfig: join(ROOT, 'tsconfig.json'), logLevel: 'error',
});
const code = bundle.outputFiles[0].text;

// ---------------------------------------------------------------- browser
const { chromium } = loadPlaywright();
const CHROMIUM = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: code });

const fail = [];
const check = (name, ok, detail) => { if (!ok) fail.push(name); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail === undefined ? '' : JSON.stringify(detail)); };
const save = (name, b64) => writeFileSync(join(OUT, name), Buffer.from(b64, 'base64'));
const r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000;

const results = { reference: null, sfx: {}, music: {}, load: null, thresholds: {} };
try {
  // ------------------------------------------------------------ SFX
  const { ids, groups } = await page.evaluate(() => ({ ids: CitadelAudio.SFX_IDS, groups: CitadelAudio.SFX_GROUPS }));
  const ref = await page.evaluate(() => CitadelAudio.renderReference());
  save('reference.wav', ref.wav);
  results.reference = ref.stats;
  const SFX_BAND = [-38, 0];   // dB relative to the reference's loudest 50 ms: never jarringly louder, never inaudible
  results.thresholds.sfxBandDb = SFX_BAND;
  const params = { explosion: { size: 1 }, boss_tell: { dur: 1.5 }, purchase_bulk: { n: 8, size: 2 }, kill: { level: 1 }, tower_hit: { level: 1 } };
  for (const id of ids) {
    const r = await page.evaluate(([i, p]) => CitadelAudio.renderSfx(i, p), [id, params[id] ?? {}]);
    save(`sfx-${id}.wav`, r.wav);
    const rel = r.stats.winRmsDb - ref.stats.winRmsDb;
    results.sfx[id] = { ...r.stats, relDb: rel };
  }
  // small explosion too (size scaling)
  const small = await page.evaluate(() => CitadelAudio.renderSfx('explosion', { size: 0.1 }));
  results.sfx['explosion(size 0.1)'] = { ...small.stats, relDb: small.stats.winRmsDb - ref.stats.winRmsDb };

  const sfxRows = Object.entries(results.sfx);
  const silent = sfxRows.filter(([, s]) => s.peak < 1e-3).map(([k]) => k);
  const clipped = sfxRows.filter(([, s]) => s.peak > 0.98).map(([k, s]) => `${k} ${r3(s.peak)}`);
  const nans = sfxRows.filter(([, s]) => s.nan > 0).map(([k]) => k);
  const outOfBand = sfxRows.filter(([, s]) => !Number.isFinite(s.relDb) || s.relDb < SFX_BAND[0] || s.relDb > SFX_BAND[1]).map(([k, s]) => `${k} ${r1(s.relDb)} dB`);
  check('SFX: none silent', silent.length === 0, silent);
  check('SFX: peak ≤ 0.98 after the limiter (all levels at max)', clipped.length === 0, clipped.length ? clipped : { maxPeak: r3(Math.max(...sfxRows.map(([, s]) => s.peak))) });
  check('SFX: no NaN', nans.length === 0, nans);
  check(`SFX: loudest 50 ms within [${SFX_BAND}] dB of the reference tone`, outOfBand.length === 0, outOfBand.length ? outOfBand : {
    loudest: sfxRows.reduce((a, b) => (b[1].relDb > a[1].relDb ? b : a))[0], max: r1(Math.max(...sfxRows.map(([, s]) => s.relDb))), min: r1(Math.min(...sfxRows.map(([, s]) => s.relDb))),
  });
  check('SFX: explosions scale with size', results.sfx.explosion.winRmsDb > results.sfx['explosion(size 0.1)'].winRmsDb + 3, { big: r1(results.sfx.explosion.winRmsDb), small: r1(results.sfx['explosion(size 0.1)'].winRmsDb) });

  // distinctness: log-centroid, envelope and band-shape distance between every pair in a group
  const feat = (s) => ({ lc: Math.log2(Math.max(20, s.centroid)), la: Math.log2(0.005 + s.attack), ld: Math.log2(0.01 + s.decay + s.active), bands: s.bands });
  const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb || 1); };
  const dist = (a, b) => { const A = feat(a), B = feat(b); return Math.abs(A.lc - B.lc) + 0.35 * Math.abs(A.la - B.la) + 0.35 * Math.abs(A.ld - B.ld) + 3 * (1 - cos(A.bands, B.bands)); };
  const MIN_DIST = 0.35;
  results.thresholds.minDistinctness = MIN_DIST;
  const distinct = (name, list) => {
    let min = Infinity, pair = '';
    const table = {};
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = dist(results.sfx[list[i]], results.sfx[list[j]]);
      table[`${list[i]}~${list[j]}`] = r3(d);
      if (d < min) { min = d; pair = `${list[i]}~${list[j]}`; }
    }
    results[`distinct_${name}`] = table;
    check(`SFX: ${name} are distinct (min pair distance ≥ ${MIN_DIST})`, min >= MIN_DIST, { closest: pair, distance: r3(min), centroids: Object.fromEntries(list.map((k) => [k, Math.round(results.sfx[k].centroid)])) });
  };
  distinct('elements', ['el_fire', 'el_lightning', 'el_poison', 'el_frost']);
  distinct('abilities', groups.abilities);

  // ------------------------------------------------------------ music
  const LEVELS = { low: 0.12, medium: 0.5, high: 0.92 };
  const INTENDED_RISE = 6;   // dB from wave-1 ambience to a full wave: layers add up, the glue compressor holds it
  results.thresholds.music = { intendedRiseDb: INTENDED_RISE, toleranceDb: 6, sectorSpreadDb: 6 };
  const names = ['outskirts', 'hive', 'bastion_line', 'fold', 'court'];
  for (let si = 0; si < 5; si++) {
    for (const [lvl, i] of Object.entries(LEVELS)) {
      const t0 = Date.now();
      const r = await page.evaluate(([s, x, sec]) => CitadelAudio.renderMusic(s, x, sec), [si, i, SECONDS]);
      save(`music-${si}-${names[si]}-${lvl}.wav`, r.wav);
      const load = r.renderMs / (SECONDS * 1000);
      results.music[`${names[si]}/${lvl}`] = { ...r.stats, notes: r.notes, scheduleMs: r.scheduleMs, renderMs: r.renderMs, audioThreadLoad: load, wallMs: Date.now() - t0 };
      console.log(`  music ${names[si]} ${lvl}: rms ${r1(r.stats.rmsDb)} dBFS, peak ${r3(r.stats.peak)}, centroid ${Math.round(r.stats.centroid)} Hz, ${r.notes} notes; schedule ${Math.round(r.scheduleMs)} ms, render ${Math.round(r.renderMs)} ms (${Math.round(load * 100)}% of real time)`);
    }
  }
  const boss = await page.evaluate(([sec]) => CitadelAudio.renderMusic(4, 0.95, sec, { bossPhase: 2, tension: 0.9 }), [Math.min(30, SECONDS)]);
  save('music-4-court-boss-phase3-lowhp.wav', boss.wav);
  results.music['court/boss+tension'] = { ...boss.stats, notes: boss.notes };

  const mrows = Object.entries(results.music);
  check('music: none silent (rms > −45 dBFS)', mrows.every(([, s]) => s.rmsDb > -45), Object.fromEntries(mrows.map(([k, s]) => [k, r1(s.rmsDb)])));
  check('music: peak ≤ 0.98, no NaN', mrows.every(([, s]) => s.peak <= 0.98 && s.nan === 0), { maxPeak: r3(Math.max(...mrows.map(([, s]) => s.peak))) });
  const rises = names.map((n) => results.music[`${n}/high`].rmsDb - results.music[`${n}/low`].rmsDb);
  check(`music: loudness rise low → high within ${INTENDED_RISE} ± 6 dB`, rises.every((d) => Math.abs(d - INTENDED_RISE) <= 6), Object.fromEntries(names.map((n, i) => [n, r1(rises[i])])));
  for (const lvl of Object.keys(LEVELS)) {
    const v = names.map((n) => results.music[`${n}/${lvl}`].rmsDb);
    check(`music: Sectors within 6 dB of each other at ${lvl} intensity`, Math.max(...v) - Math.min(...v) <= 6, { spread: r1(Math.max(...v) - Math.min(...v)) });
  }
  check('music: no harsh highs (centroid under 2.5 kHz)', mrows.every(([, s]) => s.centroid < 2500), Object.fromEntries(mrows.map(([k, s]) => [k, Math.round(s.centroid)])));

  // ------------------------------------------------------------ load
  const load = await page.evaluate(() => CitadelAudio.loadTest(10, 500, 2000));
  save('load-test-10s.wav', load.wav);
  results.load = { ...load, wav: undefined };
  check('load: voice cap (24) holds under 500 events/s', load.voicesPeak <= 24, { peak: load.voicesPeak, plays: load.plays, dropped: load.dropped, stolen: load.stolen, notes: load.notes });
  check('load: main-thread cost p95 < 1 ms per frame', load.p95 < 1, { p50: r3(load.p95 && load.p50), p95: r3(load.p95), max: r3(load.max) });
  check('load: output does not clip, no NaN', load.stats.peak <= 0.98 && load.stats.nan === 0, { peak: r3(load.stats.peak), rmsDb: r1(load.stats.rmsDb) });
  check('harness: no page errors', pageErrors.length === 0, pageErrors.slice(0, 5));
} catch (e) {
  check('harness ran', false, String(e && e.stack || e));
} finally {
  await browser.close();
}
writeFileSync(join(OUT, 'stats.json'), JSON.stringify(results, (k, v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v), 2));
console.log(`\nwrote ${OUT}/stats.json and WAVs`);
console.log('SUMMARY', JSON.stringify({ fail }));
process.exit(fail.length ? 1 : 0);
