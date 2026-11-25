import { NextResponse } from 'next/server';
import { tick } from '../../../../lib/jobs';

// Called by Vercel Cron ("Authorization: Bearer $CRON_SECRET") or an external pinger such as
// cron-job.org every minute: /api/cron/process-queue?key=<CRON_SECRET>
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get('key');
  if (!secret || (req.headers.get('authorization') !== `Bearer ${secret}` && key !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await tick({ budgetMs: 50000, replyEveryMin: 5 }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
