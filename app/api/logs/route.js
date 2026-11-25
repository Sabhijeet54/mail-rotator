import { route } from '../../../lib/api';
import { query } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const p = [];
  const w = [];
  if (sp.get('level')) { p.push(sp.get('level')); w.push(`level = $${p.length}`); }
  if (sp.get('search')) { p.push('%' + sp.get('search') + '%'); w.push(`(message ILIKE $${p.length} OR action ILIKE $${p.length})`); }
  if (sp.get('before')) { p.push(Number(sp.get('before'))); w.push(`id < $${p.length}`); }
  const logs = await query(`SELECT * FROM activity_logs ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT 100`, p);
  return { logs };
});
