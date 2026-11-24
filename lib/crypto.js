import crypto from 'crypto';

// SMTP passwords are stored encrypted (AES-256-GCM) with ENCRYPTION_KEY.
// Changing ENCRYPTION_KEY later makes existing stored passwords unreadable.
// TESTING FALLBACK: without ENCRYPTION_KEY a fixed built-in key is used (not secret, since it's in the code).
// Set ENCRYPTION_KEY before real use; mailboxes saved under the fallback must then be re-added.
const FALLBACK_KEY = 'mail-rotator-insecure-testing-key';
function key() {
  const k = process.env.ENCRYPTION_KEY || FALLBACK_KEY;
  return crypto.createHash('sha256').update(k).digest();
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
