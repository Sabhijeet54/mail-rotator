import { route, notFound } from '../../../../../lib/api';
import { one, query } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/auth';
import { parseWindow, COLS } from '../window';

export const dynamic = 'force-dynamic';

// Set the account's timer: { validFrom, validUntil }
export const PATCH = route(async (req, { params }) => {
  await requireAdmin(req);
  const { from, until } = parseWindow(await req.json());
  const user = await one(
    `UPDATE app_users SET valid_from = $2, valid_until = $3, disabled = false, updated_at = now()
     WHERE id = $1 RETURNING ${COLS}`, [params.id, from, until]);
  if (!user) throw notFound('Account not found');
  return { user };
});

export const DELETE = route(async (req, { params }) => {
  await requireAdmin(req);
  await query('DELETE FROM app_users WHERE id = $1', [params.id]);
  return { ok: true };
});
