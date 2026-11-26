import { route, notFound } from '../../../../../lib/api';
import { query, one } from '../../../../../lib/db';
import { requireAdmin, hashPassword } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

const COLS = 'id, email, name, valid_until, disabled, last_login_at, created_at';

// Body (any of):
//   { addDays: n }      extend from today or from the current end date, whichever is later
//   { setDays: n }      access ends n days from now
//   { revoke: true }    end access now
//   { disabled: bool }  block / unblock without changing the date
//   { password, name }
export const PATCH = route(async (req, { params }) => {
  await requireAdmin(req);
  const b = await req.json();
  const u = await one('SELECT id FROM app_users WHERE id = $1', [params.id]);
  if (!u) throw notFound('User not found');

  const days = (v) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > 3650) throw new Error('Days must be 1 to 3650.');
    return n;
  };
  if (b.addDays != null)
    await query(`UPDATE app_users SET valid_until = GREATEST(valid_until, now()) + make_interval(days => $2), disabled = false WHERE id = $1`, [u.id, days(b.addDays)]);
  if (b.setDays != null)
    await query(`UPDATE app_users SET valid_until = now() + make_interval(days => $2), disabled = false WHERE id = $1`, [u.id, days(b.setDays)]);
  if (b.revoke) await query('UPDATE app_users SET valid_until = now() WHERE id = $1', [u.id]);
  if (typeof b.disabled === 'boolean') await query('UPDATE app_users SET disabled = $2 WHERE id = $1', [u.id, b.disabled]);
  if (b.password != null) {
    if (String(b.password).length < 6) throw new Error('Password must be at least 6 characters.');
    await query('UPDATE app_users SET password_hash = $2 WHERE id = $1', [u.id, hashPassword(String(b.password))]);
    await query('DELETE FROM app_sessions WHERE user_id = $1', [u.id]); // log them out everywhere
  }
  if (b.name != null) await query('UPDATE app_users SET name = $2 WHERE id = $1', [u.id, String(b.name).trim()]);
  await query('UPDATE app_users SET updated_at = now() WHERE id = $1', [u.id]);
  return { user: await one(`SELECT ${COLS} FROM app_users WHERE id = $1`, [u.id]) };
});

export const DELETE = route(async (req, { params }) => {
  await requireAdmin(req);
  await query('DELETE FROM app_users WHERE id = $1', [params.id]);
  return { ok: true };
});
