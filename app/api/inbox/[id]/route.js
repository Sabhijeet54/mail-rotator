import { route, notFound } from '../../../../lib/api';
import { getInboxMessage, updateInboxMessage } from '../../../../lib/inbox';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req, { params }) => {
  const m = await getInboxMessage(params.id);
  if (!m) throw notFound('Message not found');
  return { message: m };
});

export const PATCH = route(async (req, { params }) => ({ message: await updateInboxMessage(params.id, await req.json()) }));
