import { route } from '../../../lib/api';
import { query } from '../../../lib/db';
import { runJob } from '../../../lib/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route(async () => ({
  jobs: await query(`SELECT * FROM scheduled_jobs ORDER BY name`),
  scheduled: await query(`SELECT id, name, scheduled_at, total_recipients FROM campaigns WHERE status = 'scheduled' ORDER BY scheduled_at`),
  upcoming: await query(`SELECT count(*)::int AS n, min(o.scheduled_at) AS next_at FROM outbound_messages o
                         JOIN campaigns c ON c.id = o.campaign_id WHERE o.status = 'queued' AND c.status IN ('running','scheduled')`),
  followupsWaiting: await query(`SELECT count(*)::int AS n FROM campaign_recipients r
                                 JOIN sequence_steps s ON s.campaign_id = r.campaign_id AND s.step_number = r.current_step + 1
                                 WHERE r.status IN ('active','completed') AND r.replied_at IS NULL`),
  cronConfigured: !!process.env.CRON_SECRET,
}));

export const POST = route(async (req) => {
  const { name, enabled } = await req.json();
  if (enabled !== undefined) {
    await query(`UPDATE scheduled_jobs SET enabled = $2 WHERE name = $1`, [name, !!enabled]);
    return { ok: true };
  }
  return { result: await runJob(name, 45000) };
});
