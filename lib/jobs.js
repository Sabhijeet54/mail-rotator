import { query, one } from './db';
import { processQueue, enqueueFollowups, recordJobRun } from './queue';
import { checkReplies } from './inbox';

// Each background job. Run by cron, by the in-app ticker, or by "Run now" on Scheduled Jobs.
const JOBS = {
  'process-queue': (budget) => processQueue({ budgetMs: budget }),
  'start-scheduled': async () => {
    const rows = await query(`UPDATE campaigns SET status='running', started_at=now()
                              WHERE status='scheduled' AND scheduled_at <= now() RETURNING id`);
    return { started: rows.length };
  },
  'send-followups': async () => ({ queued: await enqueueFollowups() }),
  'check-replies': (budget) => checkReplies({ budgetMs: budget }),
  'reset-daily-caps': async () => {
    const r = await query(`UPDATE mailboxes SET sent_today = 0, sent_today_date = CURRENT_DATE
                           WHERE sent_today_date <> CURRENT_DATE RETURNING id`);
    return { reset: r.length };
  },
};
export const JOB_NAMES = Object.keys(JOBS);

export async function runJob(name, budgetMs = 20000) {
  if (!JOBS[name]) throw new Error(`Unknown job ${name}`);
  return recordJobRun(name, () => JOBS[name](budgetMs));
}

async function enabled(name) {
  const j = await one(`SELECT enabled FROM scheduled_jobs WHERE name = $1`, [name]);
  return j ? j.enabled : true;
}

async function dueAfter(name, minutes) {
  const j = await one(`SELECT enabled, last_run_at FROM scheduled_jobs WHERE name = $1`, [name]);
  if (j && !j.enabled) return false;
  return !j?.last_run_at || Date.now() - new Date(j.last_run_at).getTime() > minutes * 60000;
}

// One "tick": send what's due; every few minutes also check replies and reset caps.
export async function tick({ budgetMs = 20000, replyEveryMin = 5 } = {}) {
  const out = {};
  const started = Date.now();
  if (await enabled('process-queue')) out.queue = await runJob('process-queue', Math.round(budgetMs * 0.6));
  if (await dueAfter('reset-daily-caps', 60)) out.caps = await runJob('reset-daily-caps');
  if (await dueAfter('check-replies', replyEveryMin)) {
    const left = Math.max(8000, budgetMs - (Date.now() - started));
    out.replies = await runJob('check-replies', left).catch((e) => ({ error: e.message }));
  }
  return out;
}
