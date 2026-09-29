#!/usr/bin/env node
// Architecture lint (no dependencies): gates the ARCHITECTURE.md non-negotiable rules that a grep can
// check. `npm run lint` (part of `npm run check`, run in CI). Exit code 1 on any error.
//
//   determinism  src/sim (except src/sim/math): no Math.random / transcendental Math.* / Date /
//                performance / crypto / timers / `**` / comparator-less .sort()          [rule 1]
//   causality    enemy HP is only written by core/world-impl.ts (World.damage / healEnemy / kill);
//                tower HP only by world-impl, systems/tower.ts and run/machine.ts          [rule 2]
//   boundaries   src/sim and src/worker never import ui/render/app code; src/sim never touches DOM
//                globals; systems/*.ts never import another system module              [rules 4, 8]
//   size         warn for files over 700 lines in src/sim, src/worker, sim-cli
//
// A line may opt out of one rule with a trailing comment `lint-allow <rule>: <reason>`.
// Usage: node scripts/lint.mjs [--verbose]   (--verbose also lists warnings: enemy shield writes)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');
const errors = [], warnings = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).split(sep).join('/');

/** Replace comments and string/template literal contents with spaces (keeps line/column positions). */
function stripCode(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') { out += '  '; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += q; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {   // keep template expressions as code
          let depth = 0;
          while (i < n) { const ch = src[i]; if (ch === '{') depth++; if (ch === '}') { depth--; if (depth === 0) { out += ch; i++; break; } } out += ch; i++; }
          continue;
        }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

function check(file, rule, rx, message, { level = 'error', allow = () => false } = {}) {
  const raw = readFileSync(file, 'utf8').split('\n');
  const code = stripCode(raw.join('\n')).split('\n');
  for (let k = 0; k < code.length; k++) {
    if (!rx.test(code[k])) continue;
    if (raw[k].includes(`lint-allow ${rule}`) || allow(rel(file), raw[k])) continue;
    (level === 'error' ? errors : warnings).push(`${rel(file)}:${k + 1}  [${rule}] ${message}\n      ${raw[k].trim().slice(0, 160)}`);
  }
}

const simFiles = walk(join(ROOT, 'src', 'sim'));
const workerFiles = walk(join(ROOT, 'src', 'worker'));

// --- determinism ---------------------------------------------------------------
const MATH = /\bMath\.(random|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|hypot|cbrt|fround)\s*\(/;
const WALL = /\b(Date\s*[.(]|new\s+Date\b|performance\s*\.|crypto\s*\.|setTimeout\s*\(|setInterval\s*\()/;
for (const f of simFiles) {
  if (rel(f).startsWith('src/sim/math/')) continue;
  check(f, 'determinism', MATH, 'engine-dependent Math function: use src/sim/math (sin, cos, atan2, exp, log, pow, growth)');
  check(f, 'determinism', WALL, 'wall clock / timers / crypto inside the sim');
  check(f, 'determinism', /\*\*/, '`**` operator: use ipow/growth/pow from src/sim/math');
  check(f, 'determinism', /\.sort\(\s*\)/, 'Array.sort without a total comparator');
}

// --- causality -----------------------------------------------------------------
const ENEMY_HP_WRITE = /(?<!this)\.hp\[[^\]]+\]\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
const ENEMY_SHIELD_WRITE = /(?<!this)\.shield\[[^\]]+\]\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
const TOWER_HP_WRITE = /\b(?:t|tower|w\.tower|world\.tower)\.hp\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
const TOWER_HP_OWNERS = new Set(['src/sim/core/world-impl.ts', 'src/sim/systems/tower.ts', 'src/sim/run/machine.ts']);
for (const f of simFiles) {
  if (rel(f) === 'src/sim/core/world-impl.ts') continue;
  check(f, 'causality', ENEMY_HP_WRITE, 'enemy HP written outside World: use World.damage / healEnemy / killEnemy');
  check(f, 'causality', TOWER_HP_WRITE, 'tower HP written outside World: use World.damageTower / healTower', { allow: (r) => TOWER_HP_OWNERS.has(r) });
  check(f, 'causality', ENEMY_SHIELD_WRITE, 'enemy shield written outside World (no event; see CODE-HEALTH.md)', { level: 'warning' });
}

// --- boundaries ----------------------------------------------------------------
const UI_IMPORT = /\bfrom\s+['"](?:@(?:ui|render|app)\/|(?:\.\.\/)+(?:ui|render|app)\/)/;
const DOM = /(?<![.\w$])(?:(?:document|window|localStorage|sessionStorage|indexedDB|navigator)\s*\.|(?:requestAnimationFrame|getComputedStyle)\s*\()/;
for (const f of [...simFiles, ...workerFiles]) {
  const raw = readFileSync(f, 'utf8').split('\n');
  raw.forEach((line, k) => { if (UI_IMPORT.test(line)) errors.push(`${rel(f)}:${k + 1}  [boundaries] sim/worker code imports ui/render/app\n      ${line.trim()}`); });
}
for (const f of simFiles) check(f, 'boundaries', DOM, 'DOM global inside the sim');
const SYSTEM_LIBS = new Set(['index', 'elements-shared', 'hardpoints/common']);
for (const f of simFiles.filter((p) => /src\/sim\/systems\/[^/]+\.ts$/.test(rel(p)) && !rel(p).endsWith('/index.ts'))) {
  const raw = readFileSync(f, 'utf8').split('\n');
  raw.forEach((line, k) => {
    const m = /^import\b.*from\s+['"]\.\/([\w/-]+)['"]/.exec(line);
    if (m && !SYSTEM_LIBS.has(m[1]) && !line.includes('lint-allow boundaries')) errors.push(`${rel(f)}:${k + 1}  [boundaries] a system imports another system (use hooks / events / World)\n      ${line.trim()}`);
  });
}

// --- size ----------------------------------------------------------------------
for (const f of [...simFiles, ...workerFiles, ...walk(join(ROOT, 'sim-cli'))]) {
  const n = readFileSync(f, 'utf8').split('\n').length;
  if (n > 700) warnings.push(`${rel(f)}  [size] ${n} lines (guideline: split past 600–700)`);
}

const shownWarnings = verbose ? warnings : warnings.filter((w) => !w.includes('[causality]'));
const hidden = warnings.length - shownWarnings.length;
for (const w of shownWarnings) console.log(`warning  ${w}`);
if (hidden) console.log(`(${hidden} enemy-shield write warning${hidden === 1 ? '' : 's'}; --verbose lists them)`);
for (const e of errors) console.error(`error    ${e}`);
console.log(`lint: ${errors.length} error(s), ${warnings.length} warning(s) in ${simFiles.length + workerFiles.length} sim/worker files`);
process.exit(errors.length ? 1 : 0);
