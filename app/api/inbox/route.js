import { route } from '../../../lib/api';
import { listInbox } from '../../../lib/inbox';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  return listInbox({ tab: sp.get('tab') || 'all', search: sp.get('search') || '', mailboxId: sp.get('mailbox') || '' });
});
