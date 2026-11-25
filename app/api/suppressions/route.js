import { route } from '../../../lib/api';
import { query } from '../../../lib/db';
import { extractEmails } from '../../../lib/extract';
import { logActivity } from '../../../lib/log';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const search = sp.get('search') || '';
  const reason = sp.get('reason') || '';
  const p = [];
  const w = [];
  if (search) { p.push('%' + search + '%'); w.push(`email ILIKE $${p.length}`); }
  if (reason) { p.push(reason); w.push(`reason = $${p.length}`); }
  const rows = await query(`SELECT * FROM suppressions ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
                            ORDER BY created_at DESC LIMIT 2000`, p);
  if (sp.get('format') === 'csv') {
    return new Response(['email,reason,source,added', ...rows.map((r) => [r.email, r.reason, r.source || '', new Date(r.created_at).toISOString()].join(','))].join('\n'),
      { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="suppressions.csv"' } });
  }
  const counts = await query(`SELECT reason, count(*)::int AS n FROM suppressions GROUP BY reason`);
  return { suppressions: rows, counts };
});

export const POST = route(async (req) => {
  const { text, reason = 'manual' } = await req.json();
  const emails = extractEmails(text).map((e) => e.toLowerCase());
  if (!emails.length) throw new Error('No emails found');
  const r = await query(`INSERT INTO suppressions (email, reason, source) SELECT unnest($1::text[]), $2, 'manual'
                         ON CONFLICT DO NOTHING RETURNING email`, [emails, reason]);
  await query(`UPDATE outbound_messages SET status='cancelled', error='Suppressed'
               WHERE status='queued' AND lower(to_email) = ANY($1)`, [emails]);
  await logActivity({ level: 'warn', action: 'suppression.added', message: `Added ${r.length} address(es) to the Suppression List` });
  return { added: r.length, total: emails.length };
});

export const DELETE = route(async (req) => {
  const { emails } = await req.json();
  const r = await query(`DELETE FROM suppressions WHERE email = ANY($1) RETURNING email`, [(emails || []).map((e) => String(e).toLowerCase())]);
  return { removed: r.length };
});
