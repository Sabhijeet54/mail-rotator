import { NextResponse } from 'next/server';

// Login gate. Everyone must sign in at /login. The fixed admin (lib/auth.js) only gets /admin,
// where they create, time-limit and delete user (licence) accounts. Users get all the mail
// features but not /admin. Outside a user's validity window they are sent to /access-expired.
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
  // Ask the same server over its internal port. Calling the public URL from inside the host
  // (e.g. Render behind its proxy) does not work reliably.
  // On Vercel there is no such port, so the public URL is used.
  const opts = { headers: { cookie: `${COOKIE}=${token}` }, cache: 'no-store' };
  const internal = process.env.PORT && !process.env.VERCEL ? `http://127.0.0.1:${process.env.PORT}` : null;
  let res;
  if (internal) res = await fetch(`${internal}/api/auth/session`, opts).catch(() => null);
  if (!res) res = await fetch(`${req.nextUrl.origin}/api/auth/session`, opts);
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
  try { s = await check(req, token); } catch (e) { console.error('[auth] session check failed:', e?.message); s = { status: 'none' }; }
  if (s.status === 'expired') return deny(403, '/access-expired', 'Your access has expired.');
  if (s.status !== 'ok') {
    const res = deny(401, '/login', 'Please log in.');
    res.cookies.delete(COOKIE);
    return res;
  }
  const adminArea = pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/');
  // The admin only manages licence accounts; the mail features belong to the users.
  if (adminArea && s.role !== 'admin') return deny(403, '/', 'Admin only.');
  if (!adminArea && s.role === 'admin') return deny(403, '/admin', 'The admin account only has the Admin Panel.');
  return NextResponse.next();
}

export const config = {
  // Cron and SMTP relay endpoints have their own secret checks.
  matcher: ['/((?!api/cron|api/smtp-relay|_next/static|_next/image|favicon.ico).*)'],
};
