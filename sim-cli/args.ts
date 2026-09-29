/** Tiny argv parser: --flag, --key value, --key=value. */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const k = a.slice(2);
    const nx = argv[i + 1];
    if (nx !== undefined && !nx.startsWith('--')) { out[k] = nx; i++; } else out[k] = true;
  }
  return out;
}
export function num(v: string | boolean | undefined, d: number): number { return typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d; }
export function list(v: string | boolean | undefined): string[] { return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []; }
