import nodemailer from 'nodemailer';
import { query, one } from './db';
import { encrypt, decrypt } from './crypto';
import { logActivity } from './log';

// SMTP (+ IMAP, used later by Unified Inbox) settings for common providers.
export const PRESETS = {
  gmail:   { label: 'Gmail',               host: 'smtp.gmail.com',      port: 465, imap: 'imap.gmail.com' },
  outlook: { label: 'Outlook / Office365', host: 'smtp.office365.com',  port: 587, imap: 'outlook.office365.com' },
  icloud:  { label: 'iCloud',              host: 'smtp.mail.me.com',    port: 587, imap: 'imap.mail.me.com' },
  yahoo:   { label: 'Yahoo',               host: 'smtp.mail.yahoo.com', port: 465, imap: 'imap.mail.yahoo.com' },
  zoho:    { label: 'Zoho',                host: 'smtp.zoho.com',       port: 465, imap: 'imap.zoho.com' },
  custom:  { label: 'Custom SMTP' },
};

// Sent-today resets automatically when the stored date is not today.
const SENT_TODAY = `CASE WHEN m.sent_today_date = CURRENT_DATE THEN m.sent_today ELSE 0 END`;

const PUBLIC_COLS = `
  m.id, m.email, m.from_name, m.provider, m.smtp_host, m.smtp_port, m.smtp_user, m.group_name,
  m.connection, m.paused, m.daily_cap, ${SENT_TODAY} AS sent_today, m.last_error, m.last_sync_at,
  m.created_at, m.imap_host, m.imap_port,
  (SELECT count(*)::int FROM outbound_messages o WHERE o.mailbox_id = m.id AND o.status = 'queued') AS queued,
  (SELECT count(*)::int FROM inbox_messages i WHERE i.mailbox_id = m.id) AS replies`;

function normalize(data) {
  const provider = PRESETS[data.provider] ? data.provider : 'custom';
  const p = PRESETS[provider];
  const email = String(data.email || '').trim();
  // App passwords are shown as 'xxxx xxxx xxxx xxxx'; the real one has no spaces.
  const password = String(data.password || '').replace(/\s+/g, '');
  const host = String(data.host || p.host || '').trim();
  const port = Number(data.port) || p.port || 587;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Invalid email: "${email}"`);
  if (!password) throw new Error(`Password missing for ${email}`);
  if (!host) throw new Error(`SMTP host missing for ${email}`);
  return {
    provider,
    email,
    password,
    smtp_user: String(data.username || '').trim() || email,
    host,
    port,
    secure: port === 465,
    imap_host: p.imap || null,
    from_name: String(data.fromName || '').trim(),
    group_name: String(data.group || '').trim() || 'Default',
    daily_cap: data.dailyCap === '' || data.dailyCap == null ? 500 : Math.max(0, Number(data.dailyCap) || 0),
  };
}

function transportFor({ host, port, secure, user, pass }) {
  return nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

// Used by the sender. Caches per mailbox until its row changes.
const transportCache = new Map();
export function getTransport(row) {
  const key = row.id + ':' + new Date(row.updated_at).getTime();
  const hit = transportCache.get(row.id);
  if (hit && hit.key === key) return hit.t;
  const t = transportFor({
    host: row.smtp_host, port: row.smtp_port, secure: row.smtp_secure,
    user: row.smtp_user, pass: decrypt(row.smtp_pass_enc),
  });
  transportCache.set(row.id, { key, t });
  return t;
}

export async function listMailboxes({ connection, group, state, search } = {}) {
  const where = [];
  const params = [];
  if (connection) { params.push(connection); where.push(`m.connection = $${params.length}`); }
  if (group) { params.push(group); where.push(`m.group_name = $${params.length}`); }
  if (state === 'paused') where.push('m.paused');
  if (state === 'active') where.push('NOT m.paused');
  if (search) { params.push('%' + search + '%'); where.push(`(m.email ILIKE $${params.length} OR m.from_name ILIKE $${params.length})`); }
  return query(
    `SELECT ${PUBLIC_COLS} FROM mailboxes m
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY m.created_at DESC`,
    params
  );
}

export async function mailboxSummary() {
  const r = await one(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE connection = 'connected' AND NOT paused)::int AS connected,
           count(*) FILTER (WHERE connection <> 'connected')::int AS need_attention,
           count(*) FILTER (WHERE paused)::int AS paused
    FROM mailboxes`);
  const groups = await query(`SELECT DISTINCT group_name FROM mailboxes ORDER BY 1`);
  return { ...r, groups: groups.map((g) => g.group_name) };
}

export async function getMailbox(id) {
  return one(`SELECT ${PUBLIC_COLS} FROM mailboxes m WHERE m.id = $1`, [id]);
}

export async function getMailboxDetail(id) {
  const mailbox = await getMailbox(id);
  if (!mailbox) return null;
  const [checks, stats, logs] = await Promise.all([
    query(`SELECT ok, latency_ms, error, checked_at FROM mailbox_health_checks
           WHERE mailbox_id = $1 ORDER BY checked_at DESC LIMIT 10`, [id]),
    one(`SELECT count(*) FILTER (WHERE status='sent')::int   AS sent_7d,
                count(*) FILTER (WHERE status='failed')::int AS failed_7d
         FROM outbound_messages WHERE mailbox_id = $1 AND created_at > now() - interval '7 days'`, [id]),
    query(`SELECT level, message, created_at FROM activity_logs
           WHERE entity_type='mailbox' AND entity_id=$1 ORDER BY id DESC LIMIT 15`, [id]),
  ]);
  return { mailbox, checks, stats, logs };
}

async function insertMailbox(n, connection, lastError) {
  return one(
    `INSERT INTO mailboxes (email, from_name, provider, smtp_host, smtp_port, smtp_secure, smtp_user,
                            smtp_pass_enc, imap_host, imap_port, group_name, daily_cap, connection,
                            last_error, last_sync_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, CASE WHEN $13='untested' THEN NULL ELSE now() END)
     RETURNING id`,
    [n.email, n.from_name, n.provider, n.host, n.port, n.secure, n.smtp_user, encrypt(n.password),
     n.imap_host, n.imap_host ? 993 : null, n.group_name, n.daily_cap, connection, lastError]
  );
}

async function emailExists(email) {
  return !!(await one(`SELECT 1 FROM mailboxes WHERE lower(email) = lower($1)`, [email]));
}

// Add one mailbox. By default it is saved only after a real SMTP login works.
export async function createMailbox(data, { verify = true } = {}) {
  const n = normalize(data);
  if (await emailExists(n.email)) throw new Error(`${n.email} is already added`);
  let connection = 'untested';
  if (verify) {
    await transportFor({ host: n.host, port: n.port, secure: n.secure, user: n.smtp_user, pass: n.password }).verify();
    connection = 'connected';
  }
  const row = await insertMailbox(n, connection, null);
  await logActivity({ level: 'success', action: 'mailbox.added', entityType: 'mailbox', entityId: row.id,
                      message: `Mailbox ${n.email} added (${connection})` });
  return getMailbox(row.id);
}

// Bulk import. Rows are saved as "untested"; run Test connection afterwards.
// Accepts CSV/TSV lines: email, password, from_name, daily_cap, group, provider, host, port
export async function importMailboxes(text, defaults = {}) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const added = [];
  const errors = [];
  for (const [i, line] of lines.entries()) {
    const c = line.split(/[,\t;]/).map((s) => s.trim());
    if (i === 0 && /email/i.test(c[0])) continue; // header row
    try {
      const n = normalize({
        email: c[0], password: c[1], fromName: c[2], dailyCap: c[3] || defaults.dailyCap,
        group: c[4] || defaults.group, provider: c[5] || defaults.provider, host: c[6], port: c[7],
      });
      if (await emailExists(n.email)) throw new Error(`${n.email} already exists`);
      const row = await insertMailbox(n, 'untested', null);
      added.push(row.id);
    } catch (e) {
      errors.push({ line: i + 1, error: e.message });
    }
  }
  await logActivity({ action: 'mailbox.imported', entityType: 'mailbox',
                      message: `Imported ${added.length} mailbox(es), ${errors.length} error(s)` });
  return { added: added.length, ids: added, errors };
}

// Real SMTP login test. Records a health check and updates connection status.
export async function testMailbox(id) {
  const row = await one(`SELECT * FROM mailboxes WHERE id = $1`, [id]);
  if (!row) throw new Error('Mailbox not found');
  const started = Date.now();
  let ok = true;
  let error = null;
  try {
    await transportFor({
      host: row.smtp_host, port: row.smtp_port, secure: row.smtp_secure,
      user: row.smtp_user, pass: decrypt(row.smtp_pass_enc),
    }).verify();
  } catch (e) {
    ok = false;
    error = e.message;
  }
  const latency = Date.now() - started;
  await query(`INSERT INTO mailbox_health_checks (mailbox_id, ok, latency_ms, error) VALUES ($1,$2,$3,$4)`,
              [id, ok, latency, error]);
  await query(`UPDATE mailboxes SET connection = $2, last_error = $3, last_sync_at = now(), updated_at = now()
               WHERE id = $1`, [id, ok ? 'connected' : 'error', error]);
  await logActivity({ level: ok ? 'success' : 'error', action: 'mailbox.tested', entityType: 'mailbox', entityId: id,
                      message: ok ? `${row.email}: connection OK (${latency} ms)` : `${row.email}: ${error}` });
  return { id, email: row.email, ok, error, latency_ms: latency };
}

// Tests several mailboxes, 5 at a time.
export async function testMailboxes(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += 5) {
    results.push(...(await Promise.all(ids.slice(i, i + 5).map((id) =>
      testMailbox(id).catch((e) => ({ id, ok: false, error: e.message }))))));
  }
  return results;
}

export async function updateMailbox(id, patch) {
  const sets = [];
  const params = [id];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.fromName !== undefined) add('from_name', String(patch.fromName).trim());
  if (patch.group !== undefined) add('group_name', String(patch.group).trim() || 'Default');
  if (patch.dailyCap !== undefined) add('daily_cap', Math.max(0, Number(patch.dailyCap) || 0));
  if (patch.paused !== undefined) add('paused', !!patch.paused);
  if (patch.host) add('smtp_host', String(patch.host).trim());
  if (patch.port) { add('smtp_port', Number(patch.port)); add('smtp_secure', Number(patch.port) === 465); }
  if (patch.password) {
    add('smtp_pass_enc', encrypt(String(patch.password).replace(/\s+/g, '')));
    sets.push(`connection = 'untested'`);
  }
  if (!sets.length) return getMailbox(id);
  sets.push('updated_at = now()');
  await query(`UPDATE mailboxes SET ${sets.join(', ')} WHERE id = $1`, params);
  if (patch.paused !== undefined) {
    const m = await getMailbox(id);
    await logActivity({ level: 'warn', action: patch.paused ? 'mailbox.paused' : 'mailbox.resumed',
                        entityType: 'mailbox', entityId: id,
                        message: `${m?.email} ${patch.paused ? 'paused' : 'resumed'}` });
  }
  return getMailbox(id);
}

export async function removeMailbox(id) {
  const row = await one(`DELETE FROM mailboxes WHERE id = $1 RETURNING email`, [id]);
  transportCache.delete(id);
  if (row) await logActivity({ level: 'warn', action: 'mailbox.removed', entityType: 'mailbox', entityId: id,
                               message: `Mailbox ${row.email} removed` });
  return !!row;
}
