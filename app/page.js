import Link from 'next/link';
import { one, query } from '../lib/db';
import { PageHeader, StatCard } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const [mb, out, logs, x] = await Promise.all([
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE connection='connected' AND NOT paused)::int AS connected,
                count(*) FILTER (WHERE connection<>'connected')::int AS attention
         FROM mailboxes`),
    one(`SELECT count(*) FILTER (WHERE status='sent' AND sent_at::date = CURRENT_DATE)::int AS sent_today,
                count(*) FILTER (WHERE status='queued')::int AS queued,
                count(*) FILTER (WHERE status='failed' AND created_at > now() - interval '1 day')::int AS failed_24h
         FROM outbound_messages`),
    query(`SELECT id, level, message, created_at FROM activity_logs ORDER BY id DESC LIMIT 12`),
    one(`SELECT (SELECT count(*)::int FROM inbox_messages WHERE received_at > now() - interval '7 days') AS replies_7d,
                (SELECT count(*)::int FROM inbox_messages WHERE NOT is_read) AS unread,
                (SELECT count(*)::int FROM campaigns WHERE status = 'scheduled') AS scheduled,
                (SELECT count(*)::int FROM campaigns WHERE status = 'running') AS running,
                (SELECT count(*)::int FROM contacts) AS contacts`),
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
        <StatCard label="Replies (7d)" value={x.replies_7d} tone="ok" />
        <StatCard label="Unread replies" value={x.unread} tone={x.unread ? 'warn' : ''} />
        <StatCard label="Running / scheduled" value={`${x.running} / ${x.scheduled}`} />
        <StatCard label="Contacts" value={x.contacts} />
      </div>
      <div className="panel">
        <h2>Quick start</h2>
        <div className="mini-list">
          <div><span>1. Add and test your sending mailboxes</span><Link href="/mailboxes">Mailbox Accounts →</Link></div>
          <div><span>2. Upload people (first name, last name, email) from CSV / Excel</span><Link href="/contacts">Contacts →</Link></div>
          <div><span>3. Upload 50–150 subject lines so they rotate</span><Link href="/templates">Templates →</Link></div>
          <div><span>4. Write the message, pick people, send now or schedule</span><Link href="/campaigns">Campaigns →</Link></div>
          <div><span>5. Read, label, rate and answer replies</span><Link href="/inbox">Unified Inbox{x.unread ? ` (${x.unread} unread)` : ''} →</Link></div>
        </div>
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
