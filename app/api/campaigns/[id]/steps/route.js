import { route, notFound } from '../../../../../lib/api';
import { query, one, tx } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req, { params }) => {
  const campaign = await one(`SELECT id, name, status, subject, format FROM campaigns WHERE id = $1`, [params.id]);
  if (!campaign) throw notFound('Campaign not found');
  const steps = await query(
    `SELECT s.*, (SELECT count(*)::int FROM outbound_messages o WHERE o.campaign_id = s.campaign_id
                    AND o.step_number = s.step_number AND o.status = 'sent') AS sent
     FROM sequence_steps s WHERE s.campaign_id = $1 ORDER BY step_number`, [params.id]);
  return { campaign, steps };
});

// Replaces all steps: [{delay_days, subject, body}] in order.
export const PUT = route(async (req, { params }) => {
  const { steps } = await req.json();
  if (!Array.isArray(steps)) throw new Error('steps must be a list');
  steps.forEach((s, i) => {
    if (!String(s.body || '').trim()) throw new Error(`Follow-up ${i + 1} has no message`);
  });
  await tx(async (q) => {
    await q(`DELETE FROM sequence_steps WHERE campaign_id = $1`, [params.id]);
    for (const [i, s] of steps.entries()) {
      await q(`INSERT INTO sequence_steps (campaign_id, step_number, delay_days, subject, body) VALUES ($1,$2,$3,$4,$5)`,
              [params.id, i + 1, Math.max(0, Number(s.delay_days) || 0), s.subject || '', s.body]);
    }
  });
  return { ok: true };
});
