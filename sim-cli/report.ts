/** JSON + Markdown reports for runs (sim-out/<name>.json, sim-out/<name>.md). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AcceptRow, RunResult } from './types';
import { checkpointMinutes, counterRate, damageByLinkage, damageBySystem, median, pct, recommendation, round, spendVsEffect } from './metrics';

export const OUT_DIR = 'sim-out';

export function ensureOut(dir = OUT_DIR): string { mkdirSync(dir, { recursive: true }); return dir; }

export function writeJson(name: string, data: unknown, dir = OUT_DIR): string {
  ensureOut(dir);
  const p = join(dir, `${name}.json`);
  writeFileSync(p, JSON.stringify(data, null, 1));
  return p;
}
export function writeText(name: string, text: string, dir = OUT_DIR): string {
  ensureOut(dir);
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
}

export function table(head: string[], rows: (string | number)[][]): string {
  const out = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows) out.push(`| ${r.map((c) => (typeof c === 'number' ? String(round(c, 2)) : c)).join(' | ')} |`);
  return out.join('\n');
}

function topShares(m: Record<string, number>, n = 8): string {
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${pct(v)}`).join(', ') || '—';
}

export function runMarkdown(r: RunResult): string {
  const rec = recommendation(r);
  const cpm = checkpointMinutes([r]);
  const lines: string[] = [];
  lines.push(`# ${r.name}`, '');
  lines.push(`agent **${r.agent}** · policy **${r.policy}** · seed ${r.seed} · frame ${r.frame} · stop: ${r.stopReason}`, '');
  lines.push(table(['deepest', 'checkpoint', 'attempts', 'sim h', 'wall s', 'ticks/s', 'purchases', 'median min/checkpoint'], [[
    r.deepestCleared, r.checkpoint, r.attempts, round(r.simSeconds / 3600, 2), round(r.wallSeconds, 1), Math.round(r.ticksPerSecond), r.build.purchases, round(median(cpm), 1)]]), '');
  lines.push(`Build: hardpoints ${r.build.hardpoints.join(', ') || '—'}; attunements ${r.build.attunements.join(', ') || '—'}; doctrines ${Object.entries(r.build.doctrines).map(([t, d]) => `${t}.${d}`).join(', ') || '—'}; anomalies ${r.build.anomalies.join(', ') || '—'}`, '');
  lines.push('## Checkpoints', '');
  lines.push(table(['checkpoint', 'attempts', 'boss fights', 'minutes', 'at (min)'], r.checkpoints.map((c) => [c.checkpoint, c.attempts, c.bossFights, round(c.minutes, 1), round(c.at / 60, 1)])), '');
  lines.push('## Echo rate', '');
  lines.push(`Recommendation: wave ${rec.wave} at ${round(rec.seconds / 60, 1)} min (${rec.source}); true peak: ${r.echoPeak ? `wave ${r.echoPeak.wave}, ${round(r.echoPeak.rate, 1)} Echoes/h at ${round(r.echoPeak.seconds / 60, 1)} min` : '—'}; Forecast present: ${r.forecastPresent}`, '');
  const samples = r.echoCurve.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 16)) === 0 || i === a.length - 1);
  lines.push(table(['min', 'deepest', 'echoes', 'rate/h', 'forecast rate', 'recommended'], samples.map((s) => [round(s.seconds / 60, 1), s.deepest, s.echoes, round(s.rate, 1), s.forecastRate !== undefined ? round(s.forecastRate, 1) : '—', s.recommended === undefined ? '—' : String(s.recommended)])), '');
  lines.push('## Damage share', '');
  lines.push(`By system: ${topShares(damageBySystem(r))}`, '');
  lines.push(`Linkages / Infusions / Fusions: ${topShares(damageByLinkage(r), 12)}`, '');
  lines.push('## Spend vs effectiveness', '');
  lines.push(table(['tree', 'spend share', 'damage share'], spendVsEffect(r).map((x) => [x.system, pct(x.spendShare), pct(x.damageShare)])), '');
  lines.push('## Active play', '');
  lines.push(`casts ${r.casts}, tells ${r.tells}, counters ${r.counters} (success ${pct(counterRate(r))}), designations ${r.designations}; rejected commands: ${Object.entries(r.noops).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}`, '');
  if (r.notes.length) lines.push('## Notes', '', ...r.notes.map((n) => `- ${n}`), '');
  lines.push('## Waves', '');
  lines.push(table(['wave', 'formation', 'tries to clear', 'deaths', 'min to clear', 'fight s', 'scrap earned', 'scrap spent', 'tower dmg'],
    r.waves.map((w) => [w.wave, w.formation ?? (w.boss ? 'boss' : '—'), w.attemptsToClear, w.deaths, w.secondsToClear === null ? '—' : round(w.secondsToClear / 60, 1),
      w.clearFightSeconds === null ? '—' : round(w.clearFightSeconds, 1), Math.round(w.scrapEarned), Math.round(w.scrapSpent), Math.round(w.towerDamage)])), '');
  return lines.join('\n');
}

export function writeRun(r: RunResult, dir = OUT_DIR): { json: string; md: string } {
  return { json: writeJson(r.name, r, dir), md: writeText(`${r.name}.md`, runMarkdown(r), dir) };
}

export function summaryMarkdown(title: string, runs: RunResult[]): string {
  const rows = runs.map((r) => {
    const rec = recommendation(r);
    const top = Object.entries(damageBySystem(r)).sort((a, b) => b[1] - a[1])[0];
    return [r.name, r.deepestCleared, r.checkpoint, r.attempts, r.stopReason, r.wallWave ?? '—', round(median(checkpointMinutes([r])), 1),
      Number.isFinite(rec.wave) ? `${rec.wave} (${rec.source})` : '—', top ? `${top[0]} ${pct(top[1])}` : '—', round(r.simSeconds / 3600, 2), Math.round(r.ticksPerSecond)];
  });
  return [`# ${title}`, '', table(['run', 'deepest', 'checkpoint', 'attempts', 'stop', 'wall wave', 'median min/cp', 'recommend', 'top damage', 'sim h', 'ticks/s'], rows), ''].join('\n');
}

export function acceptMarkdown(rows: AcceptRow[]): string {
  return table(['Test', 'Result', 'Value', 'Target', 'Notes'], rows.map((r) => [r.name, r.skipped ? `SKIPPED (${r.skipped})` : r.pass ? 'PASS' : 'FAIL', r.value, r.target, r.notes.replace(/\|/g, '/')]));
}
