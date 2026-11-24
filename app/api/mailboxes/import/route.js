import { route } from '../../../../lib/api';
import { importMailboxes } from '../../../../lib/mailboxes';

export const POST = route(async (req) => {
  const { text, defaults } = await req.json();
  return importMailboxes(text, defaults);
});
