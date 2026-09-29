/** Child-process entry for sim-cli/pool.ts (started with `node --import tsx`). */
import { runJob, type Job } from './jobs';

process.on('message', (msg: { id: number; job: Job }) => {
  let reply: { id: number; ok: boolean; res?: unknown; err?: string };
  try { reply = { id: msg.id, ok: true, res: runJob(msg.job) }; }
  catch (e) { reply = { id: msg.id, ok: false, err: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) }; }
  process.send!(reply);
});
process.send!({ ready: true });
