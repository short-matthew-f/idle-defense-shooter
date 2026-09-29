/**
 * `npm run sim:accept [-- --quick] [--seeds 1,2,3] [--hours 4] [--jobs N] [--out sim-out]`
 *
 * Runs every §19 acceptance test, prints the table, writes sim-out/accept[-quick].{json,md},
 * sim-out/difficulty.{json,md} and one JSON per run under sim-out/accept/, and exits non-zero when
 * any test fails (skipped tests do not fail the gate).
 */
import { parseArgs, list, num } from './args';
import { runAcceptance } from './acceptance';
import { acceptMarkdown, summaryMarkdown, writeJson, writeText, OUT_DIR } from './report';
import { difficultyMarkdown } from './difficulty';
import { join } from 'node:path';

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const mode = a.quick ? 'quick' : 'full';
  const seeds = list(a.seeds).map(Number);
  const out = typeof a.out === 'string' ? a.out : OUT_DIR;
  const t0 = performance.now();
  const rep = await runAcceptance({ mode, seeds: seeds.length ? seeds : undefined, hours: a.hours ? num(a.hours, 4) : undefined, parallel: a.jobs ? num(a.jobs, 1) : undefined,
    log: (s) => console.error(s) });
  const d = rep.data;
  const suffix = mode === 'quick' ? '-quick' : '';
  const md = [`# Acceptance (${mode})`, '', `seeds ${d.seeds.join(', ')} · ${d.hours} sim-h per climb · ${Math.round((performance.now() - t0) / 1000)} s wall`, '', acceptMarkdown(rep.rows), '',
    summaryMarkdown('Runs', Object.values(d.runs))].join('\n');
  writeText(`accept${suffix}.md`, md, out);
  writeJson(`accept${suffix}`, { rows: rep.rows, seeds: d.seeds, hours: d.hours, wallSeconds: d.wallSeconds, chain: d.chain, offline: d.offline }, out);
  for (const [k, r] of Object.entries(d.runs)) writeJson(k, r, join(out, `accept${suffix}`));
  if (d.chain) writeJson('chain', d.chain, join(out, `accept${suffix}`));
  if (d.difficulty) { writeJson(`difficulty${suffix}`, d.difficulty, out); writeText(`difficulty${suffix}.md`, difficultyMarkdown(d.difficulty), out); }
  console.log(acceptMarkdown(rep.rows));
  const failed = rep.rows.filter((r) => !r.pass && !r.skipped);
  const skipped = rep.rows.filter((r) => r.skipped);
  console.log(`\n${rep.rows.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped · ${Math.round((performance.now() - t0) / 1000)} s`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(2); });
