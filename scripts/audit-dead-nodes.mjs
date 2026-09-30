#!/usr/bin/env node
// Dead-node audit (docs/reviews/EFFECT-AUDIT.md): for every purchasable or drafted content item and every
// `effects[].stat` key in src/sim/data, find whether any sim code outside src/sim/data reads it. An item whose
// id, flag and effect keys have no consumer is DEAD: the player can pay for it (Scrap, Cores, Echoes, Stars) or
// draft it and nothing happens. tests/audit/dead-nodes.test.ts fails on any dead entry not in ALLOWLIST.
//
//   npm run audit:nodes [-- --all]     (= npx tsx scripts/audit-dead-nodes.mjs; --all also prints live entries)
//
// Consumers: string literals and template-literal patterns (`ability.${id}.cost_mul`, `infuse.${s}.${e}`) in
// src/sim/**/*.ts except src/sim/data and the generic index/price/record code (content, ids, shop, codex,
// bulk, forecast, serialize, snapshot*), which name every id without giving it an effect. Comments are ignored.
// Frame flags (the flag literal, or the rule coded against the frame id / `freeMount`), Trial rules (`trialHas(.., 'rule')`, `trialActive(w, 'id')`, `w.trial === 'id'`) and Trial
// rewards (`trials.<id>`, TRIAL_FRAMES) have their own patterns. A key that only a node's own id names while the
// same node writes a consumed canonical key (bastion.fortress.hp → bastion.max_hp) is an ALIAS, not dead.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Dead entries that are accepted, with the reason. Keep this list short and justified; the test fails when an
 * entry here becomes live again (stale) so the list cannot rot.
 */
export const ALLOWLIST = {
  // effect keys whose only purpose is a UI/meta read outside the sim tick (checked by hand in EFFECT-AUDIT.md)
};

/** Files that list every id generically (indexes, prices, save records, render snapshots): not consumers. */
const GENERIC = new Set([
  'src/sim/core/content.ts', 'src/sim/core/ids.ts', 'src/sim/economy/codex.ts',
  'src/sim/economy/bulk.ts', 'src/sim/economy/forecast.ts', 'src/sim/save/serialize.ts', 'src/sim/index.ts',
  'src/sim/core/snapshot.ts', 'src/sim/core/snapshot-art.ts', 'src/sim/core/snapshot-fx.ts', 'src/sim/core/snapshot-tower.ts',
]);

/** Flags implemented by FrameDef.freeMount rather than by the flag string. */
const FREE_MOUNT_FLAGS = new Set(['drones_free', 'laser_free']);
/** Files that only register frame ids (unlock tables), not frame rules. */
const FRAME_REGISTRY = ['src/sim/economy/prestige.ts', 'src/sim/economy/ascension.ts', 'src/sim/core/snapshot'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).split(sep).join('/');

/** Remove // and /* comments, keep strings intact (so literals survive and commented-out code does not). */
function stripComments(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += q; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; } out += src[i]; i++; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Literals and template patterns per consumer file. */
function corpus() {
  const files = walk(join(ROOT, 'src', 'sim')).filter((f) => !rel(f).startsWith('src/sim/data/') && !GENERIC.has(rel(f)));
  const lits = new Map();      // literal → [file:line]
  const templates = [];        // { rx, where }
  const texts = [];            // { file, lines } (comment-stripped) for pattern checks
  for (const f of files) {
    const code = stripComments(readFileSync(f, 'utf8'));
    const lines = code.split('\n');
    // core/stats.ts's CORE_DEFAULTS table names keys to give them a base, not to read them: blank it out
    if (rel(f) === 'src/sim/core/stats.ts') {
      const a = lines.findIndex((l) => l.includes('export const CORE_DEFAULTS'));
      if (a >= 0) for (let k = a; k < lines.length; k++) { const end = lines[k].includes('};'); lines[k] = ''; if (end) break; }
    }
    texts.push({ file: rel(f), lines });
    lines.forEach((line, k) => {
      const where = `${rel(f)}:${k + 1}`;
      for (const m of line.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
        const s = m[1] ?? m[2];
        if (!s) continue;
        if (/\bfx\(\s*$/.test(line.slice(0, m.index))) continue;   // an effect WRITTEN outside data (metaEffects), not a read
        if (!lits.has(s)) lits.set(s, []);
        lits.get(s).push(where);
      }
      for (const m of line.matchAll(/`([^`]*)`/g)) {
        const t = m[1];
        if (!t.includes('${')) { if (!lits.has(t)) lits.set(t, []); lits.get(t).push(where); continue; }
        const prefix = t.slice(0, t.indexOf('${'));
        if (!prefix.includes('.')) continue;            // `${a}.${b}` would match anything
        const rx = new RegExp('^' + t.split(/\$\{[^}]*\}/).map(esc).join('[A-Za-z0-9_+]+') + '$');
        templates.push({ rx, where, t });
      }
    });
  }
  return { lits, templates, texts };
}

function consumersOf(key, c) {
  // `key@final` is folded into `key` by the resolver (core/stats.ts): it is read wherever `key` is
  if (key.endsWith('@final')) return consumersOf(key.slice(0, -6), c).map((w) => `@final → ${w}`);
  const out = [...(c.lits.get(key) ?? [])];
  for (const t of c.templates) if (t.rx.test(key)) out.push(`${t.where} (\`${t.t}\`)`);
  return out;
}
function grepWhere(rx, c) {
  const out = [];
  for (const { file, lines } of c.texts) lines.forEach((l, k) => { if (rx.test(l)) out.push(`${file}:${k + 1}`); });
  return out;
}

/**
 * Scan. Returns one entry per content item and per effect key:
 * { kind, id, status: 'live' | 'alias' | 'dead', consumers: string[], note? }.
 */
export async function scanDeadNodes() {
  const data = await import(pathToFileURL(join(ROOT, 'src/sim/data/index.ts')).href);
  const c = corpus();
  const entries = [];
  const keyStatus = new Map();   // effect key → consumers
  const keyOf = (k) => { if (!keyStatus.has(k)) keyStatus.set(k, consumersOf(k, c)); return keyStatus.get(k); };

  /** A node-like item: live when its id or any effect key is consumed. */
  const item = (kind, id, effects, extra = []) => {
    const own = consumersOf(id, c);
    const fx = effects.map((e) => ({ stat: e.stat, cons: keyOf(e.stat) }));
    const cons = [...own, ...extra, ...fx.filter((f) => f.cons.length).map((f) => `effect ${f.stat} → ${f.cons[0]}`)];
    entries.push({ kind, id, status: cons.length ? 'live' : 'dead', consumers: cons });
  };

  const nodes = [];
  for (const t of data.TREES) {
    for (const n of t.shared) nodes.push([n.ability ? 'ability-node' : 'tree-node', n]);
    for (const d of t.doctrines) for (const n of d.nodes) nodes.push([n.id === d.capstone ? 'capstone' : 'doctrine-node', n]);
    nodes.push(['exotic', t.exotic]);
  }
  for (const f of data.FUSIONS) nodes.push(['fusion', f.node]);
  for (const f of data.TRIADS) nodes.push(['triad', f.node]);
  for (const l of data.WEAPON_LINKAGES) nodes.push(['linkage', l.node]);
  for (const l of data.CHASSIS_LINKAGES) nodes.push(['linkage', l.node]);
  for (const i of data.INFUSIONS) nodes.push(['infusion', i.node]);
  for (const p of data.PRESTIGE_NODES) nodes.push(['prestige', p]);
  for (const s of data.STAR_NODES) nodes.push(['star', s]);
  const seen = new Set();
  for (const [kind, n] of nodes) { if (seen.has(n.id)) continue; seen.add(n.id); item(kind, n.id, n.effects); }

  for (const a of data.ANOMALIES) item('anomaly', a.id, a.effects);
  for (const b of data.BOONS) item('boon', b.id, b.effects, b.flag ? consumersOf(b.flag, c).map((w) => `flag ${b.flag} → ${w}`) : []);
  for (const f of data.FRAMES) {
    if (f.id === 'standard') continue;
    for (const flag of f.flags) {
      let cons = consumersOf(flag, c);
      if (!cons.length && FREE_MOUNT_FLAGS.has(flag)) cons = grepWhere(/freeMount/, c).map((w) => `freeMount → ${w}`);
      if (!cons.length) cons = consumersOf(f.id, c).filter((w) => !FRAME_REGISTRY.some((r) => w.startsWith(r))).map((w) => `frame id '${f.id}' → ${w}`);
      item('frame-flag', `${f.id}:${flag}`, [], cons);
    }
    if (f.freeMount) item('frame-mount', `${f.id}:freeMount=${f.freeMount}`, [], grepWhere(/freeMount/, c));
    if (f.effects.length) item('frame-effects', `${f.id}:effects`, f.effects);
  }
  // Trials: constraint (rules) and reward
  const prestigeSrc = stripComments(readFileSync(join(ROOT, 'src/sim/economy/prestige.ts'), 'utf8'));
  const rulesBlock = prestigeSrc.match(/TRIAL_RULES[^=]*=\s*\{([\s\S]*?)\};/)?.[1] ?? '';
  const rulesFor = (id) => (rulesBlock.match(new RegExp(`\\b${id}:\\s*\\[([^\\]]*)\\]`))?.[1] ?? '').match(/'[^']+'/g)?.map((s) => s.slice(1, -1)) ?? [];
  const framesBlock = prestigeSrc.match(/TRIAL_FRAMES[^=]*=\s*\{([^}]*)\}/)?.[1] ?? '';
  for (const t of data.TRIALS) {
    const ruleCons = [];
    for (const r of rulesFor(t.id)) ruleCons.push(...grepWhere(new RegExp(`trialHas\\([^)]*'${esc(r)}'`), c).map((w) => `rule ${r} → ${w}`));
    ruleCons.push(...grepWhere(new RegExp(`trialActive\\([^)]*'${t.id}'|\\.trial === '${t.id}'`), c).map((w) => `trial ${t.id} → ${w}`));
    entries.push({ kind: 'trial-constraint', id: t.id, status: ruleCons.length ? 'live' : 'dead', consumers: ruleCons });
    const rewCons = grepWhere(new RegExp(`trials\\.${t.id}\\b|\\bt\\.${t.id}\\b`), c);
    if (new RegExp(`\\b${t.id}:`).test(framesBlock)) rewCons.push('src/sim/economy/prestige.ts (TRIAL_FRAMES)');
    entries.push({ kind: 'trial-reward', id: t.id, status: rewCons.length ? 'live' : 'dead', consumers: rewCons });
  }

  // Trial reward / constraint stat effects (economy/prestige.ts metaEffects): their keys must be read too
  const metaBlock = prestigeSrc.slice(prestigeSrc.indexOf('export function metaEffects'));
  const metaOwner = { id: 'metaEffects (Trial rewards)', effects: [] };
  for (const m of metaBlock.slice(0, metaBlock.indexOf('\n}\n')).matchAll(/fx\('([^']+)'/g)) metaOwner.effects.push({ stat: m[1] });

  // Effect keys: live if read; alias if only the node's own id key and a sibling effect is read.
  const allEffects = [];
  for (const [, n] of nodes) for (const e of n.effects) allEffects.push([n, e.stat]);
  for (const a of data.ANOMALIES) for (const e of a.effects) allEffects.push([a, e.stat]);
  for (const b of data.BOONS) for (const e of b.effects) allEffects.push([b, e.stat]);
  for (const f of data.FRAMES) for (const e of f.effects) allEffects.push([f, e.stat]);
  for (const e of metaOwner.effects) allEffects.push([metaOwner, e.stat]);
  const done = new Set();
  for (const [owner, k] of allEffects) {
    if (done.has(k)) continue; done.add(k);
    const cons = keyOf(k);
    if (cons.length) { entries.push({ kind: 'effect-key', id: k, status: 'live', consumers: cons }); continue; }
    const siblings = (owner.effects ?? []).filter((e) => e.stat !== k && keyOf(e.stat).length);
    if (k === owner.id && siblings.length) entries.push({ kind: 'effect-key', id: k, status: 'alias', consumers: siblings.map((e) => `alias of ${e.stat}`) });
    else entries.push({ kind: 'effect-key', id: k, status: 'dead', consumers: [], note: `written by ${owner.id}` });
  }

  // Tunable constants (base-stats keys that no effect writes): informational — a desc number the code hardcodes
  const written = new Set(allEffects.map(([, k]) => k));
  const tunables = [];
  for (const k of Object.keys(data.BASE_STATS)) {
    if (written.has(k) || seen.has(k)) continue;
    const cons = keyOf(k);
    if (!cons.length) tunables.push(k);
  }
  return { entries, unreadTunables: tunables };
}

export function deadEntries(entries) {
  return entries.filter((e) => e.status === 'dead');
}

async function main() {
  const all = process.argv.includes('--all');
  const { entries, unreadTunables } = await scanDeadNodes();
  const dead = deadEntries(entries);
  const byKind = {};
  for (const e of entries) { byKind[e.kind] ??= { live: 0, alias: 0, dead: 0 }; byKind[e.kind][e.status]++; }
  console.log('kind                 live  alias  dead');
  for (const [k, v] of Object.entries(byKind)) console.log(`${k.padEnd(20)} ${String(v.live).padStart(4)} ${String(v.alias).padStart(6)} ${String(v.dead).padStart(5)}`);
  console.log(`\nDEAD (${dead.length}):`);
  for (const e of dead) console.log(`  ${e.kind.padEnd(18)} ${e.id}${e.note ? `  (${e.note})` : ''}${ALLOWLIST[e.id] ? `  [allowlisted: ${ALLOWLIST[e.id]}]` : ''}`);
  console.log(`\nALIASES:`);
  for (const e of entries.filter((x) => x.status === 'alias')) console.log(`  ${e.id} → ${e.consumers.join(', ')}`);
  console.log(`\nUnread base-stat tunables (${unreadTunables.length}; informational):`);
  for (const k of unreadTunables) console.log(`  ${k}`);
  if (all) for (const e of entries.filter((x) => x.status === 'live')) console.log(`  live ${e.kind} ${e.id} ← ${e.consumers.slice(0, 3).join('; ')}`);
  const bad = dead.filter((e) => !ALLOWLIST[e.id]);
  process.exitCode = bad.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(2); });
