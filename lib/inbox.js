// Unified Inbox: pulls replies to your campaigns from every connected mailbox over IMAP,
// matches them to the campaign + recipient, auto-labels them, and lets you reply from the app.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { query, one } from './db';
import { decrypt } from './crypto';
import { getTransport } from './mailboxes';
import { getSettings } from './settings';
import { logActivity } from './log';
import { htmlToText, fromHeader } from './queue';

export const CATEGORIES = ['none', 'interested', 'meeting', 'not_interested', 'unsubscribe', 'ooo'];

// Only the new part of a reply (drops "On Mon, X wrote:" and quoted lines).
export function stripQuoted(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    if (/^\s*On .{5,200}wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^\s*From:\s.+@/i.test(l)) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

export function classify(text, headers = {}) {
  const t = stripQuoted(text).toLowerCase();
  if (headers.autoSubmitted || /out of (the )?office|on (annual |sick |maternity |paternity )?leave|vacation|automatic reply|auto-?reply|away (until|from)|limited access to (my )?email/.test(t)) return 'ooo';
  if (/unsubscribe|remove me|take me off|stop (emailing|sending|contacting)|do not (email|contact)|don'?t (email|contact)/.test(t)) return 'unsubscribe';
  if (/not interested|no thanks|no, thanks|not a (good )?fit|not looking|(position|role) (has been |is )?(filled|closed)|no longer (hiring|available)|we('ll| will) pass/.test(t)) return 'not_interested';
  if (/calendly\.com|schedule a (call|meeting|time)|book a (call|meeting|slot)|set up a (call|meeting)|let'?s (talk|meet|connect|schedule|chat)|(free|available) (on|at|for|tomorrow|this|next)|interview|zoom|google meet|teams (call|meeting)/.test(t)) return 'meeting';
  if (/interested|sounds (good|great)|tell me more|send (me )?(more|details|your (resume|cv))|please (share|send)|share (your )?(resume|cv|details)|would love to|happy to|keen to|great fit/.test(t)) return 'interested';
  return 'none';
}

function imapHostFor(mb) {
  if (mb.imap_host) return mb.imap_host;
  return String(mb.smtp_host || '').replace(/^smtp\./i, 'imap.');
}

async function fetchMailbox(mb, settings, budgetUntil) {
  // People this mailbox has emailed, and the Message-IDs it sent (to match In-Reply-To).
  const sent = await query(
    `SELECT DISTINCT ON (lower(o.to_email)) lower(o.to_email) AS email, o.campaign_id, o.recipient_id, o.id AS outbound_id
     FROM outbound_messages o WHERE o.mailbox_id = $1 AND o.status = 'sent'
     ORDER BY lower(o.to_email), (o.campaign_id IS NULL), o.sent_at DESC`, [mb.id]);
  if (!sent.length) return { mailbox: mb.email, checked: 0, saved: 0 };
  const byEmail = new Map(sent.map((s) => [s.email, s]));

  const client = new ImapFlow({
    host: imapHostFor(mb), port: mb.imap_port || 993, secure: true,
    auth: { user: mb.smtp_user, pass: decrypt(mb.smtp_pass_enc) },
    logger: false, socketTimeout: 30000, greetingTimeout: 10000,
  });
  client.on('error', () => {});
  let saved = 0;
  let checked = 0;
  let maxUid = Number(mb.imap_last_uid) || 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const firstSent = await one(`SELECT min(sent_at) AS at FROM outbound_messages WHERE mailbox_id=$1 AND status='sent'`, [mb.id]);
      const since = new Date(Math.max(new Date(firstSent.at).getTime() - 86400000, Date.now() - 30 * 86400000));
      const range = maxUid ? { uid: `${maxUid + 1}:*` } : { since };
      const candidates = [];
      for await (const m of client.fetch(range, { uid: true, envelope: true }, { uid: true })) {
        if (m.uid <= (Number(mb.imap_last_uid) || 0)) continue;
        maxUid = Math.max(maxUid, m.uid);
        checked++;
        const from = m.envelope?.from?.[0]?.address?.toLowerCase() || '';
        const daemon = /mailer-daemon|postmaster/.test(from);
        if (byEmail.has(from) || daemon) candidates.push({ uid: m.uid, from, daemon, env: m.envelope });
      }
      for (const c of candidates) {
        if (Date.now() > budgetUntil) break;
        const msg = await client.fetchOne(String(c.uid), { source: true }, { uid: true });
        if (!msg?.source) continue;
        const parsed = await simpleParser(msg.source);
        const text = parsed.text || htmlToText(parsed.html || '');
        if (c.daemon) {
          // Bounce: find which of our recipients it's about.
          const hit = [...byEmail.keys()].find((e) => text.toLowerCase().includes(e));
          if (hit) await markBounce(byEmail.get(hit), hit);
          continue;
        }
        const match = byEmail.get(c.from);
        const auto = /auto-replied|auto-generated/i.test(String(parsed.headers.get('auto-submitted') || '')) ||
                     !!parsed.headers.get('x-autoreply') || !!parsed.headers.get('x-autorespond');
        const category = classify(text, { autoSubmitted: auto });
        const row = await one(
          `INSERT INTO inbox_messages (mailbox_id, campaign_id, recipient_id, outbound_id, message_id, in_reply_to,
                                       from_email, from_name, subject, snippet, body, category, received_at, uid)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (mailbox_id, message_id) DO NOTHING RETURNING id`,
          [mb.id, match.campaign_id, match.recipient_id, match.outbound_id,
           parsed.messageId || `uid-${c.uid}@${mb.id}`, parsed.inReplyTo || null,
           c.from, parsed.from?.value?.[0]?.name || '', parsed.subject || '(no subject)',
           stripQuoted(text).slice(0, 200).replace(/\s+/g, ' '), text.slice(0, 50000), category,
           parsed.date || new Date(), c.uid]);
        if (!row) continue;
        saved++;
        await onReply(match, c.from, category, settings);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  await query(`UPDATE mailboxes SET imap_last_uid = $2, imap_error = NULL WHERE id = $1`, [mb.id, maxUid || null]);
  return { mailbox: mb.email, checked, saved };
}

async function onReply(match, email, category, settings) {
  const unsub = category === 'unsubscribe';
  if (match.recipient_id) {
    await query(`UPDATE campaign_recipients SET status = $2, replied_at = COALESCE(replied_at, now()) WHERE id = $1`,
                [match.recipient_id, unsub ? 'unsubscribed' : 'replied']);
    const c = await one(`SELECT stop_on_reply FROM campaigns WHERE id = $1`, [match.campaign_id]);
    if (c?.stop_on_reply || unsub) {
      await query(`UPDATE outbound_messages SET status='cancelled', error='Recipient replied'
                   WHERE recipient_id = $1 AND status = 'queued'`, [match.recipient_id]);
    }
  }
  await query(`INSERT INTO email_events (outbound_id, campaign_id, type, meta) VALUES ($1,$2,'reply',$3)`,
              [match.outbound_id, match.campaign_id, { category }]);
  if (unsub && settings.autoSuppressUnsubscribe) {
    await query(`INSERT INTO suppressions (email, reason, source) VALUES ($1,'unsubscribe','reply') ON CONFLICT DO NOTHING`, [email]);
    await query(`UPDATE contacts SET consent='opted_out', updated_at=now() WHERE lower(email)=$1`, [email]);
  }
  await logActivity({ level: 'success', action: 'reply.received', entityType: 'campaign', entityId: match.campaign_id,
                      message: `Reply from ${email}${category !== 'none' ? ` (${category.replace('_', ' ')})` : ''}` });
}

async function markBounce(match, email) {
  await query(`UPDATE campaign_recipients SET status='bounced' WHERE id=$1`, [match.recipient_id]);
  await query(`INSERT INTO suppressions (email, reason, source) VALUES ($1,'bounce','imap') ON CONFLICT DO NOTHING`, [email]);
  await query(`INSERT INTO email_events (outbound_id, campaign_id, type) VALUES ($1,$2,'bounce')`, [match.outbound_id, match.campaign_id]);
  await logActivity({ level: 'warn', action: 'message.bounced', entityType: 'campaign', entityId: match.campaign_id,
                      message: `Bounced: ${email} (added to Suppression List)` });
}

// Checks every connected mailbox (3 at a time) within the time budget.
export async function checkReplies({ budgetMs = 45000, mailboxId } = {}) {
  const until = Date.now() + budgetMs;
  const settings = await getSettings();
  const mbs = await query(`SELECT * FROM mailboxes WHERE connection='connected' ${mailboxId ? 'AND id=$1' : ''}
                           ORDER BY last_sync_at NULLS FIRST`, mailboxId ? [mailboxId] : []);
  const results = [];
  for (let i = 0; i < mbs.length && Date.now() < until; i += 3) {
    results.push(...(await Promise.all(mbs.slice(i, i + 3).map(async (mb) => {
      try {
        return await fetchMailbox(mb, settings, until);
      } catch (e) {
        const msg = e.responseText || e.message;
        await query(`UPDATE mailboxes SET imap_error = $2 WHERE id = $1`, [mb.id, msg]);
        await logActivity({ level: 'error', action: 'inbox.error', entityType: 'mailbox', entityId: mb.id,
                            message: `${mb.email}: could not check replies (IMAP): ${msg}` });
        return { mailbox: mb.email, error: msg };
      }
    }))));
  }
  const saved = results.reduce((a, r) => a + (r.saved || 0), 0);
  return { mailboxes: results.length, newReplies: saved, results };
}

const TABS = {
  all: '',
  unread: 'AND NOT i.is_read',
  starred: 'AND i.starred',
  interested: `AND i.category = 'interested'`,
  meeting: `AND i.category = 'meeting'`,
  not_interested: `AND i.category = 'not_interested'`,
  unsubscribe: `AND i.category = 'unsubscribe'`,
  ooo: `AND i.category = 'ooo'`,
};

export async function listInbox({ tab = 'all', search, mailboxId, limit = 100 } = {}) {
  const p = [];
  let w = TABS[tab] ?? '';
  if (search) { p.push('%' + search + '%'); w += ` AND (i.from_email ILIKE $${p.length} OR i.from_name ILIKE $${p.length} OR i.subject ILIKE $${p.length} OR i.body ILIKE $${p.length})`; }
  if (mailboxId) { p.push(mailboxId); w += ` AND i.mailbox_id = $${p.length}`; }
  const [messages, counts] = await Promise.all([
    query(`SELECT i.id, i.from_email, i.from_name, i.subject, i.snippet, i.category, i.is_read, i.starred, i.rating,
                  i.received_at, i.replied_by_me_at, m.email AS mailbox_email, c.name AS campaign_name,
                  r.vars->>'first_name' AS first_name, r.vars->>'last_name' AS last_name
           FROM inbox_messages i JOIN mailboxes m ON m.id = i.mailbox_id
           LEFT JOIN campaigns c ON c.id = i.campaign_id LEFT JOIN campaign_recipients r ON r.id = i.recipient_id
           WHERE true ${w} ORDER BY i.received_at DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`, p),
    one(`SELECT count(*)::int AS all, count(*) FILTER (WHERE NOT is_read)::int AS unread,
                count(*) FILTER (WHERE starred)::int AS starred,
                count(*) FILTER (WHERE category='interested')::int AS interested,
                count(*) FILTER (WHERE category='meeting')::int AS meeting,
                count(*) FILTER (WHERE category='not_interested')::int AS not_interested,
                count(*) FILTER (WHERE category='unsubscribe')::int AS unsubscribe,
                count(*) FILTER (WHERE category='ooo')::int AS ooo
         FROM inbox_messages`),
  ]);
  const job = await one(`SELECT last_run_at, last_status, last_result FROM scheduled_jobs WHERE name='check-replies'`);
  return { messages, counts, lastCheck: job };
}

export async function getInboxMessage(id) {
  const m = await one(
    `SELECT i.*, m.email AS mailbox_email, c.name AS campaign_name, r.vars, r.status AS recipient_status,
            o.subject AS sent_subject, o.body AS sent_body, o.sent_at AS sent_at, o.format AS sent_format
     FROM inbox_messages i JOIN mailboxes m ON m.id = i.mailbox_id
     LEFT JOIN campaigns c ON c.id = i.campaign_id LEFT JOIN campaign_recipients r ON r.id = i.recipient_id
     LEFT JOIN outbound_messages o ON o.id = i.outbound_id
     WHERE i.id = $1`, [id]);
  if (!m) return null;
  if (!m.is_read) await query(`UPDATE inbox_messages SET is_read = true WHERE id = $1`, [id]);
  const thread = await query(
    `SELECT 'in' AS dir, i.subject, i.body, i.received_at AS at FROM inbox_messages i
       WHERE i.mailbox_id = $1 AND lower(i.from_email) = lower($2)
     UNION ALL
     SELECT 'out', o.subject, o.body, o.sent_at FROM outbound_messages o
       WHERE o.mailbox_id = $1 AND lower(o.to_email) = lower($2) AND o.status = 'sent'
     ORDER BY at`, [m.mailbox_id, m.from_email]);
  return { ...m, is_read: true, thread };
}

export async function updateInboxMessage(id, patch) {
  const sets = [];
  const p = [id];
  const add = (col, v) => { p.push(v); sets.push(`${col} = $${p.length}`); };
  if (patch.category !== undefined && CATEGORIES.includes(patch.category)) add('category', patch.category);
  if (patch.rating !== undefined) add('rating', patch.rating ? Math.min(5, Math.max(1, Number(patch.rating))) : null);
  if (patch.is_read !== undefined) add('is_read', !!patch.is_read);
  if (patch.starred !== undefined) add('starred', !!patch.starred);
  if (!sets.length) return one(`SELECT * FROM inbox_messages WHERE id=$1`, [id]);
  const row = await one(`UPDATE inbox_messages SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, p);
  if (patch.category === 'unsubscribe' && row) {
    await query(`INSERT INTO suppressions (email, reason, source) VALUES (lower($1),'unsubscribe','inbox') ON CONFLICT DO NOTHING`, [row.from_email]);
    await query(`UPDATE contacts SET consent='opted_out' WHERE lower(email)=lower($1)`, [row.from_email]);
  }
  return row;
}

// Reply from the app, in the same thread, from the mailbox that received the reply.
export async function replyToMessage(id, { body, format = 'text' }) {
  if (!String(body || '').trim()) throw new Error('Reply is empty');
  const m = await one(`SELECT * FROM inbox_messages WHERE id = $1`, [id]);
  if (!m) throw new Error('Message not found');
  const mb = await one(`SELECT * FROM mailboxes WHERE id = $1`, [m.mailbox_id]);
  const subject = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
  const refs = [m.in_reply_to, m.message_id].filter((x) => x && !x.startsWith('uid-'));
  const info = await getTransport(mb).sendMail({
    from: fromHeader(mb),
    to: m.from_name ? { name: m.from_name, address: m.from_email } : m.from_email,
    subject,
    ...(m.message_id && !m.message_id.startsWith('uid-') ? { inReplyTo: m.message_id, references: refs } : {}),
    ...(format === 'html' ? { html: body, text: htmlToText(body) } : { text: body }),
  });
  // Stored without campaign so it doesn't count in campaign stats; the thread view matches by mailbox + address.
  await query(`INSERT INTO outbound_messages (mailbox_id, to_email, subject, body, format, status, sent_at, message_id,
                                              in_reply_to, kind)
               VALUES ($1,$2,$3,$4,$5,'sent',now(),$6,$7,'reply')`,
              [mb.id, m.from_email, subject, body, format, info.messageId || null, m.message_id]);
  await query(`UPDATE inbox_messages SET replied_by_me_at = now(), is_read = true WHERE id = $1`, [id]);
  await query(`UPDATE mailboxes SET sent_today = CASE WHEN sent_today_date = CURRENT_DATE THEN sent_today + 1 ELSE 1 END,
               sent_today_date = CURRENT_DATE WHERE id = $1`, [mb.id]);
  await logActivity({ level: 'success', action: 'reply.sent', entityType: 'mailbox', entityId: mb.id,
                      message: `Replied to ${m.from_email} from ${mb.email}` });
  return { ok: true };
}
