import crypto from 'crypto';
import nodemailer from 'nodemailer';

// SMTP connections, either direct or through a relay.
//
// Render's free plan blocks outbound ports 25/465/587, so Gmail SMTP times out there.
// With SMTP_RELAY_URL set, this server sends each SMTP job over HTTPS to another deployment
// of this same app (e.g. on Vercel), whose /api/smtp-relay route does the SMTP login and send.
// Both sides must share SMTP_RELAY_SECRET.

const TIMEOUTS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 };

export function directTransport({ host, port, secure, user, pass }) {
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass }, ...TIMEOUTS });
}

function relayUrl() {
  const u = String(process.env.SMTP_RELAY_URL || '').trim().replace(/\/+$/, '');
  if (!u) return null;
  return u.endsWith('/api/smtp-relay') ? u : u + '/api/smtp-relay';
}

// Buffers can't go through JSON; send attachment contents as base64.
function serializeMail(mail) {
  if (!mail.attachments?.length) return mail;
  return {
    ...mail,
    attachments: mail.attachments.map((a) => Buffer.isBuffer(a.content)
      ? { ...a, content: a.content.toString('base64'), encoding: 'base64' }
      : a),
  };
}

async function callRelay(url, payload) {
  const secret = process.env.SMTP_RELAY_SECRET;
  if (!secret) throw new Error('SMTP_RELAY_SECRET is not set on this server');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-secret': secret },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(55000),
    });
  } catch (e) {
    throw new Error(`SMTP relay unreachable (${url}): ${e.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `SMTP relay error ${res.status}`);
  return data;
}

// Same shape as a nodemailer transport for the parts the app uses: verify() and sendMail().
export function transportFor(cfg) {
  const url = relayUrl();
  if (!url) return directTransport(cfg);
  return {
    verify: () => callRelay(url, { action: 'verify', smtp: cfg }).then(() => true),
    sendMail: (mail) => callRelay(url, { action: 'send', smtp: cfg, mail: serializeMail(mail) }),
  };
}

export function relaySecretOk(given) {
  const secret = process.env.SMTP_RELAY_SECRET;
  if (!secret || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
