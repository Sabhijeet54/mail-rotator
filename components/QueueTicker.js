'use client';

import { useEffect } from 'react';

// While any page of the app is open, nudge the server every 20 s so scheduled sends start on time,
// queued mail goes out and replies are checked (every 5 min). For sending with the browser closed,
// set up a cron (see Scheduled Jobs).
export default function QueueTicker() {
  useEffect(() => {
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try { await fetch('/api/queue/tick', { method: 'POST' }); } catch {}
      busy = false;
    };
    const first = setTimeout(run, 3000);
    const t = setInterval(run, 20000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  return null;
}
