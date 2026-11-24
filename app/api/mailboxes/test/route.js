import { route } from '../../../../lib/api';
import { testMailboxes } from '../../../../lib/mailboxes';

export const maxDuration = 60;

export const POST = route(async (req) => {
  const { ids } = await req.json();
  if (!Array.isArray(ids) || !ids.length) throw new Error('No mailboxes selected');
  return { results: await testMailboxes(ids.slice(0, 50)) };
});
