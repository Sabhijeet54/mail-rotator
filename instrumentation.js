// Next.js calls register() once when the server starts. We use it to start the background sender.
// Set BACKGROUND_WORKER=off to disable (e.g. on a serverless host).
// The import must stay inside this NEXT_RUNTIME check so it is left out of the Edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.BACKGROUND_WORKER === 'off') return;
    if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
      console.warn('[worker] DATABASE_URL not set, background sender not started');
      return;
    }
    const { startWorker } = await import('./lib/worker');
    startWorker();
  }
}
