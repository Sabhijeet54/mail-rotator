import { route } from '../../../../lib/api';
import { query, one } from '../../../../lib/db';
import { requireAdmin, hashPassword, ADMIN_EMAIL } from '../../../../lib/auth';
import { parseWindow, COLS } from './window';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  await requireAdmin(req);
  return { users: await query(`SELECT ${COLS} FROM app_users ORDER BY created_at DESC`) };
});

// Create a licence account: { name, email, password, validFrom, validUntil }
export const POST = route(async (req) => {
  await requireAdmin(req);
  const b = await req.json();
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email.');
  if (email === ADMIN_EMAIL) throw new Error('That email is the admin account.');
  if (String(b.password || '').length < 6) throw new Error('Password must be at least 6 characters.');
  const { from, until } = parseWindow(b);
  if (await one('SELECT 1 FROM app_users WHERE lower(email) = $1', [email])) throw new Error('An account with this email already exists.');
  const user = await one(
    `INSERT INTO app_users (email, name, password_hash, valid_from, valid_until)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
    [email, String(b.name || '').trim(), hashPassword(b.password), from, until]);
  return { user };
});
