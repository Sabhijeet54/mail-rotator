import { route } from '../../../../lib/api';
import { importContacts } from '../../../../lib/contacts';

export const maxDuration = 60;

export const POST = route(async (req) => {
  const { rows, tags } = await req.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error('No rows to import');
  return importContacts(rows.slice(0, 20000), { tags });
});
