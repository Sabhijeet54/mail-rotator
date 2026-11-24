import { NextResponse } from 'next/server';

// Simple password gate (HTTP Basic Auth) so a public Vercel URL can't be used by strangers
// to send mail from your mailboxes. Set APP_USER and APP_PASSWORD in Vercel env vars.
// TESTING MODE: if those vars are not set the site is open to anyone. Set them before real use.
export function middleware(req) {
  const user = process.env.APP_USER;
  const pass = process.env.APP_PASSWORD;
  if (!user || !pass) return NextResponse.next();
  const header = req.headers.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, ...rest] = atob(encoded).split(':');
    if (u === user && rest.join(':') === pass) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Mail Rotator"' },
  });
}

export const config = {
  // Cron endpoint has its own CRON_SECRET check.
  matcher: ['/((?!api/cron|_next/static|_next/image|favicon.ico).*)'],
};
