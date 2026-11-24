import { route } from '../../../lib/api';
import { listMailboxes, mailboxSummary, createMailbox, PRESETS } from '../../../lib/mailboxes';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const filters = Object.fromEntries(['connection', 'group', 'state', 'search'].map((k) => [k, sp.get(k) || undefined]));
  const [mailboxes, summary] = await Promise.all([listMailboxes(filters), mailboxSummary()]);
  return { mailboxes, summary, providers: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })) };
});

export const POST = route(async (req) => {
  const body = await req.json();
  return { mailbox: await createMailbox(body, { verify: body.verify !== false }) };
});
