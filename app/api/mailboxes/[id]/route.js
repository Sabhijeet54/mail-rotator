import { route, notFound } from '../../../../lib/api';
import { getMailboxDetail, updateMailbox, removeMailbox } from '../../../../lib/mailboxes';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req, { params }) => {
  const d = await getMailboxDetail(params.id);
  if (!d) throw notFound('Mailbox not found');
  return d;
});

export const PATCH = route(async (req, { params }) => ({ mailbox: await updateMailbox(params.id, await req.json()) }));

export const DELETE = route(async (_req, { params }) => {
  if (!(await removeMailbox(params.id))) throw notFound('Mailbox not found');
  return { ok: true };
});
