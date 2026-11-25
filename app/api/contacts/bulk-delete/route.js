import { route } from '../../../../lib/api';
import { removeContacts } from '../../../../lib/contacts';

export const POST = route(async (req) => {
  const { ids } = await req.json();
  if (!Array.isArray(ids) || !ids.length) throw new Error('Nothing selected');
  return { removed: await removeContacts(ids) };
});
