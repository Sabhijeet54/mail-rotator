import { notFound } from 'next/navigation';
import { PageHeader } from '../../components/ui';

// Placeholder pages for modules that are planned but not built yet.
// The database tables for all of them already exist (db/schema.sql).
const MODULES = {
  contacts: ['Contacts', ['Contact list: name, email, company, tags, consent', 'CSV import / export', 'Add / edit in a side drawer']],
  sequences: ['Sequences', ['Follow-up steps with delay in days', 'Auto-stop when the recipient replies']],
  inbox: ['Unified Inbox', ['Replies from all connected mailboxes in one place', 'Tabs: All / Unread / Interested / Meetings / Unsubscribes', '"Check for replies" + match to campaign']],
  templates: ['Templates', ['Reusable subject + body templates', 'Insert into campaigns']],
  jobs: ['Scheduled Jobs', ['process-queue, send-followups, check-replies, reset-daily-caps', 'Last run, status and duration']],
  analytics: ['Analytics', ['Sent / open / reply stats per campaign and mailbox']],
  suppression: ['Suppression List', ['Addresses that must never be emailed', 'Already enforced: Quick send skips any address in the suppressions table']],
  health: ['Account Health', ['Per-mailbox connection checks, failure rate, cap usage']],
  settings: ['Settings', ['Default caps, gaps, tracking, unsubscribe footer']],
  logs: ['Activity Logs', ['Everything the app did and when (activity_logs table)']],
};

export default function ModulePage({ params }) {
  const m = MODULES[params.module];
  if (!m) notFound();
  const [title, items] = m;
  return (
    <>
      <PageHeader title={title} sub="Coming next" />
      <div className="panel placeholder">
        <h2>Planned</h2>
        <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
      </div>
    </>
  );
}
