import { NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// Used by middleware.js (and the sidebar) to check who is logged in.
export async function GET(req) {
  try {
    return NextResponse.json(await getSession(req.cookies.get(SESSION_COOKIE)?.value));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ status: 'none', error: 'Session check failed' }, { status: 500 });
  }
}
