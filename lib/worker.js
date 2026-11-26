import { tick } from './jobs';

// Background sender. Runs inside the Node server (started from instrumentation.js), so mail goes out
// on schedule whether or not anyone has the app open in a browser.
// Each round sends whatever is due (up to ~25 s of work), then waits a few seconds and goes again.
// On Render's free plan the server sleeps after ~15 min without visits; sending resumes when it wakes.

const IDLE_MS = 5000;
const BUDGET_MS = 25000;

export function startWorker() {
  const g = globalThis;
  if (g.__mrWorker) return; // already running (hot reload, double import)
  g.__mrWorker = true;
  console.log('[worker] background sender started');

  const loop = async () => {
    try {
      const out = await tick({ budgetMs: BUDGET_MS });
      const q = out.queue || {};
      if (q.sent || q.failed || q.started) console.log('[worker]', JSON.stringify(q));
    } catch (e) {
      console.error('[worker] tick failed:', e.message);
    }
    setTimeout(loop, IDLE_MS);
  };
  setTimeout(loop, 3000);
}
