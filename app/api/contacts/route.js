import { route } from '../../../lib/api';
import { listContacts, createContact } from '../../../lib/contacts';

export const dynamic = 'force-dynamic';

const csvCell = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const opts = { search: sp.get('search') || '', tag: sp.get('tag') || '', consent: sp.get('consent') || '',
                 limit: sp.get('limit') || 100, offset: sp.get('offset') || 0 };
  if (sp.get('format') === 'csv') {
    const { contacts } = await listContacts({ ...opts, limit: 5000 });
    const lines = [['first_name', 'last_name', 'email', 'company', 'tags', 'consent'].join(',')];
    for (const c of contacts) lines.push([c.first_name, c.last_name, c.email, c.company, c.tags.join(';'), c.consent].map(csvCell).join(','));
    return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contacts.csv"' } });
  }
  return listContacts(opts);
});

export const POST = route(async (req) => ({ contact: await createContact(await req.json()) }));
