import { NextResponse } from 'next/server';
import { processQueue, recordJobRun } from '../../../../lib/queue';

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET".
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await recordJobRun('process-queue', () => processQueue({ budgetMs: 50000 }));
  return NextResponse.json(result);
}
