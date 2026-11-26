import { NextResponse } from 'next/server';
import { login, SESSION_COOKIE, cookieOptions } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const { email, password } = await req.json().catch(() => ({}));
  const r = await login(email, password);
  if (!r) return NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 });
  if (r.expired) return NextResponse.json({ expired: true, redirect: '/access-expired' }, { status: 403 });
  const res = NextResponse.json({ ok: true, role: r.role, redirect: r.role === 'admin' ? '/admin' : '/' });
  res.cookies.set(SESSION_COOKIE, r.token, cookieOptions(r.expires));
  return res;
}
