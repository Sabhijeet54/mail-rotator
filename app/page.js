import Link from 'next/link';
import { one, query } from '../lib/db';
import { PageHeader, StatCard } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const [mb, out, logs] = await Promise.all([
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE connection='connected' AND NOT paused)::int AS connected,
                count(*) FILTER (WHERE connection<>'connected')::int AS attention
         FROM mailboxes`),
    one(`SELECT count(*) FILTER (WHERE status='sent' AND sent_at::date = CURRENT_DATE)::int AS sent_today,
                count(*) FILTER (WHERE status='queued')::int AS queued,
                count(*) FILTER (WHERE status='failed' AND created_at > now() - interval '1 day')::int AS failed_24h
         FROM outbound_messages`),
    query(`SELECT id, level, message, created_at FROM activity_logs ORDER BY id DESC LIMIT 12`),
  ]);

  return (
    <>
      <PageHeader title="Dashboard" sub="Overview of your sending setup." />
      <div className="stats">
        <StatCard label="Mailboxes" value={mb.total} />
        <StatCard label="Connected" value={mb.connected} tone="ok" />
        <StatCard label="Need attention" value={mb.attention} tone="warn" />
        <StatCard label="Sent today" value={out.sent_today} />
        <StatCard label="Queued" value={out.queued} />
        <StatCard label="Failed (24h)" value={out.failed_24h} tone={out.failed_24h ? 'warn' : ''} />
      </div>
      <div className="panel">
        <h2>Recent activity</h2>
        <div className="mini-list">
          {logs.length === 0 && (
            <div className="muted">Nothing yet — start by <Link href="/mailboxes">adding a mailbox</Link>.</div>
          )}
          {logs.map((l) => (
            <div key={l.id}>
              <span className={'l-' + l.level}>{l.message}</span>
              <span className="muted">{new Date(l.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
