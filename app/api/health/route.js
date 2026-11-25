import { route } from '../../../lib/api';
import { query } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  mailboxes: await query(`
    SELECT m.id, m.email, m.provider, m.connection, m.paused, m.daily_cap, m.last_error, m.imap_error, m.last_sync_at,
           CASE WHEN m.sent_today_date = CURRENT_DATE THEN m.sent_today ELSE 0 END AS sent_today,
           (SELECT count(*)::int FROM outbound_messages o WHERE o.mailbox_id=m.id AND o.status='sent' AND o.sent_at > now() - interval '7 days') AS sent_7d,
           (SELECT count(*)::int FROM outbound_messages o WHERE o.mailbox_id=m.id AND o.status='failed' AND o.created_at > now() - interval '7 days') AS failed_7d,
           (SELECT count(*)::int FROM email_events e JOIN outbound_messages o ON o.id = e.outbound_id
              WHERE o.mailbox_id=m.id AND e.type='bounce' AND e.created_at > now() - interval '30 days') AS bounces_30d,
           (SELECT count(*)::int FROM inbox_messages i WHERE i.mailbox_id=m.id AND i.received_at > now() - interval '30 days') AS replies_30d,
           (SELECT count(*)::int FROM outbound_messages o WHERE o.mailbox_id=m.id AND o.status='sent' AND o.sent_at > now() - interval '30 days') AS sent_30d,
           (SELECT json_agg(x ORDER BY x.checked_at DESC) FROM (SELECT ok, latency_ms, error, checked_at FROM mailbox_health_checks h
              WHERE h.mailbox_id = m.id ORDER BY checked_at DESC LIMIT 10) x) AS checks
    FROM mailboxes m ORDER BY m.email`),
}));
