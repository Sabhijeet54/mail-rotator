import { route } from '../../../../lib/api';
import { query, one } from '../../../../lib/db';
import { requireAdmin, hashPassword, ADMIN_EMAIL } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

const COLS = 'id, email, name, valid_until, disabled, last_login_at, created_at';

export const GET = route(async (req) => {
  await requireAdmin(req);
  return { users: await query(`SELECT ${COLS} FROM app_users ORDER BY created_at DESC`) };
});

export const POST = route(async (req) => {
  await requireAdmin(req);
  const b = await req.json();
  const email = String(b.email || '').trim().toLowerCase();
  const days = Number(b.days);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email.');
  if (email === ADMIN_EMAIL) throw new Error('That email is the admin account.');
  if (String(b.password || '').length < 6) throw new Error('Password must be at least 6 characters.');
  if (!Number.isFinite(days) || days < 1 || days > 3650) throw new Error('Validity must be 1 to 3650 days.');
  if (await one('SELECT 1 FROM app_users WHERE lower(email) = $1', [email])) throw new Error('A login with this email already exists.');
  const user = await one(
    `INSERT INTO app_users (email, name, password_hash, valid_until)
     VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING ${COLS}`,
    [email, String(b.name || '').trim(), hashPassword(b.password), Math.round(days)]);
  return { user };
});
