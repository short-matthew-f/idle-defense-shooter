/**
 * Minimal process pool: N children (`node --import tsx sim-cli/job-worker.ts`) each run one job at
 * a time. Results come back in submission order. `jobs <= 1` (or a failed fork) runs in-process.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runJob, type Job } from './jobs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function defaultJobs(): number { return Math.max(1, Math.min(8, cpus().length)); }

export async function runJobs<T = unknown>(jobs: Job[], parallel = defaultJobs(), onDone?: (i: number, res: T, done: number) => void): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  if (parallel <= 1 || jobs.length <= 1) {
    for (let i = 0; i < jobs.length; i++) {
      out[i] = runJob(jobs[i]) as T;
      onDone?.(i, out[i], i + 1);
      await new Promise<void>((r) => setImmediate(r));   // let the host (e.g. a Vitest worker's RPC) breathe between jobs
    }
    return out;
  }
  const n = Math.min(parallel, jobs.length);
  let next = 0, done = 0;
  const children: ChildProcess[] = [];
  await new Promise<void>((resolve, reject) => {
    let failed = false;
    const give = (c: ChildProcess): void => {
      if (next >= jobs.length) { c.kill(); return; }
      const id = next++;
      c.send({ id, job: jobs[id] });
    };
    for (let k = 0; k < n; k++) {
      const c = fork(join(HERE, 'job-worker.ts'), [], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      children.push(c);
      c.on('message', (m: { ready?: boolean; id?: number; ok?: boolean; res?: unknown; err?: string }) => {
        if (m.ready) { give(c); return; }
        if (!m.ok) { failed = true; for (const x of children) x.kill(); reject(new Error(`job ${m.id} failed: ${m.err}`)); return; }
        out[m.id!] = m.res as T;
        done++;
        onDone?.(m.id!, out[m.id!], done);
        if (done === jobs.length) { for (const x of children) x.kill(); resolve(); }
        else give(c);
      });
      c.on('error', (e) => { if (!failed) { failed = true; for (const x of children) x.kill(); reject(e); } });
      c.on('exit', (code) => { if (!failed && done < jobs.length && code !== 0 && code !== null) { failed = true; for (const x of children) x.kill(); reject(new Error(`worker exited ${code}`)); } });
    }
  });
  return out;
}
