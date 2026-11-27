import { NextResponse } from 'next/server';
import { directTransport, relaySecretOk } from '../../../lib/smtp';

// SMTP relay for deployments whose host blocks SMTP ports (Render free plan).
// Enabled only when SMTP_RELAY_SECRET is set here; callers must send it in x-relay-secret.
// Uses no database, so the relay deployment needs only SMTP_RELAY_SECRET.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  if (!process.env.SMTP_RELAY_SECRET) return NextResponse.json({ error: 'SMTP relay is not enabled' }, { status: 404 });
  if (!relaySecretOk(req.headers.get('x-relay-secret'))) return NextResponse.json({ error: 'Bad relay secret' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  const { action, smtp, mail } = body || {};
  if (!smtp?.host || !smtp?.port || !smtp?.user || !smtp?.pass) {
    return NextResponse.json({ error: 'SMTP settings missing' }, { status: 400 });
  }

  const t = directTransport({
    host: String(smtp.host), port: Number(smtp.port), secure: !!smtp.secure,
    user: String(smtp.user), pass: String(smtp.pass),
  });
  try {
    if (action === 'verify') {
      await t.verify();
      return NextResponse.json({ ok: true });
    }
    if (action === 'send') {
      if (!mail || typeof mail !== 'object') return NextResponse.json({ error: 'Mail missing' }, { status: 400 });
      const info = await t.sendMail(mail);
      return NextResponse.json({ ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    // SMTP errors (bad password, bounce, timeout) go back as-is so the caller logs the real reason.
    return NextResponse.json({ error: e.message || 'SMTP error' }, { status: 502 });
  } finally {
    t.close();
  }
}
