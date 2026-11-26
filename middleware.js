import { NextResponse } from 'next/server';

// Login gate. Everyone must sign in at /login. The fixed admin (lib/auth.js) can open /admin
// to create user logins with a validity period. When a user's validity ends (or the admin
// revokes it) they are sent to /access-expired.
//
// Middleware runs on the Edge runtime and can't use pg, so it asks /api/auth/session
// and caches the answer for a few seconds per cookie.

const COOKIE = 'mr_session';
const PUBLIC = ['/login', '/access-expired', '/api/auth/'];
const cache = new Map(); // token -> { at, data }
const TTL_MS = 15000;

async function check(req, token) {
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const res = await fetch(new URL('/api/auth/session', req.url), { headers: { cookie: `${COOKIE}=${token}` } });
  const data = await res.json().catch(() => ({ status: 'none' }));
  if (res.ok) {
    if (cache.size > 500) cache.clear();
    cache.set(token, { at: Date.now(), data });
  }
  return data;
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  const isApi = pathname.startsWith('/api/');
  const deny = (status, to, message) => isApi
    ? NextResponse.json({ error: message, redirect: to }, { status })
    : NextResponse.redirect(new URL(to, req.url));

  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return deny(401, '/login', 'Please log in.');

  let s;
  try { s = await check(req, token); } catch { s = { status: 'none' }; }
  if (s.status === 'expired') return deny(403, '/access-expired', 'Your access has expired.');
  if (s.status !== 'ok') {
    const res = deny(401, '/login', 'Please log in.');
    res.cookies.delete(COOKIE);
    return res;
  }
  if ((pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) && s.role !== 'admin')
    return deny(403, '/', 'Admin only.');
  return NextResponse.next();
}

export const config = {
  // Cron endpoint has its own CRON_SECRET check.
  matcher: ['/((?!api/cron|_next/static|_next/image|favicon.ico).*)'],
};
