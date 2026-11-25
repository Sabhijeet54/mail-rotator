import { route } from '../../../lib/api';
import { query, one } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 14));
  const [totals, daily, campaigns, mailboxes, categories] = await Promise.all([
    one(`SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
                count(*) FILTER (WHERE status='failed')::int AS failed,
                count(*) FILTER (WHERE status='queued')::int AS queued,
                (SELECT count(*)::int FROM campaign_recipients WHERE replied_at > now() - make_interval(days => $1)) AS replied,
                (SELECT count(*)::int FROM campaign_recipients WHERE status='bounced' AND created_at > now() - make_interval(days => $1)) AS bounced,
                (SELECT count(*)::int FROM campaign_recipients WHERE status='unsubscribed' AND created_at > now() - make_interval(days => $1)) AS unsubscribed
         FROM outbound_messages WHERE kind <> 'reply' AND created_at > now() - make_interval(days => $1)`, [days]),
    query(`SELECT d::date AS day,
                  (SELECT count(*)::int FROM outbound_messages o WHERE o.status='sent' AND o.kind <> 'reply' AND o.sent_at::date = d::date) AS sent,
                  (SELECT count(*)::int FROM outbound_messages o WHERE o.status='failed' AND o.created_at::date = d::date) AS failed,
                  (SELECT count(*)::int FROM inbox_messages i WHERE i.received_at::date = d::date) AS replies
           FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day') d ORDER BY d`, [days]),
    query(`SELECT c.id, c.name, c.status, c.created_at,
                  count(r.*)::int AS recipients,
                  count(*) FILTER (WHERE r.status IN ('completed','replied','unsubscribed') OR r.current_step > 0)::int AS delivered,
                  count(*) FILTER (WHERE r.replied_at IS NOT NULL)::int AS replied,
                  count(*) FILTER (WHERE r.status IN ('failed','bounced'))::int AS failed,
                  (SELECT count(*)::int FROM outbound_messages o WHERE o.campaign_id=c.id AND o.status='sent') AS sent
           FROM campaigns c LEFT JOIN campaign_recipients r ON r.campaign_id = c.id
           WHERE c.created_at > now() - make_interval(days => $1)
           GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`, [days]),
    query(`SELECT m.id, m.email,
                  count(o.*) FILTER (WHERE o.status='sent')::int AS sent,
                  count(o.*) FILTER (WHERE o.status='failed')::int AS failed,
                  (SELECT count(*)::int FROM inbox_messages i WHERE i.mailbox_id=m.id AND i.received_at > now() - make_interval(days => $1)) AS replies
           FROM mailboxes m LEFT JOIN outbound_messages o ON o.mailbox_id = m.id AND o.kind <> 'reply'
                AND o.created_at > now() - make_interval(days => $1)
           GROUP BY m.id ORDER BY sent DESC`, [days]),
    query(`SELECT category, count(*)::int AS n FROM inbox_messages WHERE received_at > now() - make_interval(days => $1)
           GROUP BY category ORDER BY n DESC`, [days]),
  ]);
  return { days, totals, daily, campaigns, mailboxes, categories };
});
