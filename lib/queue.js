// Database-backed send queue (works on serverless / Vercel):
// - enqueueSend() writes one outbound_messages row per recipient, staggered by the gap.
// - processQueue() starts scheduled campaigns, queues due follow-ups and sends whatever is due
//   within a time budget. It is called by the background sender in lib/worker.js (started with the
//   server), and optionally by cron (/api/cron/process-queue).
import { query, one, tx } from './db';
import { getTransport } from './mailboxes';
import { extractRecipients } from './extract';
import { renderTemplate, recipientVars, splitSubjects, splitBodies, makeSubjectRotator } from './render';
import { contactsForSend, importContacts } from './contacts';
import { getSettings } from './settings';
import { logActivity } from './log';

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const capLeft = (m) => (m.daily_cap ? m.daily_cap - m.sent_today : Infinity);

async function sendableMailboxes(ids) {
  return query(
    `SELECT m.id, m.email, m.daily_cap,
            CASE WHEN m.sent_today_date = CURRENT_DATE THEN m.sent_today ELSE 0 END AS sent_today
     FROM mailboxes m
     WHERE m.connection = 'connected' AND NOT m.paused ${ids?.length ? 'AND m.id = ANY($1)' : ''}
     ORDER BY m.created_at`,
    ids?.length ? [ids] : []
  );
}

export function withFooter(body, format, settings) {
  if (!settings?.footerEnabled || !settings.footerText?.trim()) return body;
  const t = settings.footerText.trim();
  if (format === 'html') {
    const safe = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `${body}<p style="color:#888;font-size:12px;margin-top:24px">${safe}</p>`;
  }
  return `${body}\n\n--\n${t}`;
}

// Recipients come from one of three places:
//   source 'paste'    -> recipientsText: "Rahul Sharma, rahul@x.com" lines
//   source 'file'     -> recipients: [{email, first_name, last_name, company, fields}] parsed from CSV / Excel
//   source 'contacts' -> contactTag ('' = all contacts) or contactIds
async function resolvePeople(p) {
  if (p.source === 'contacts') {
    const rows = await contactsForSend({ tag: p.contactTag || null, ids: p.contactIds });
    return rows.map((c) => ({ ...c, contact_id: c.id }));
  }
  if (p.source === 'file' || Array.isArray(p.recipients)) {
    const seen = new Set();
    return (p.recipients || []).filter((r) => {
      const e = String(r.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || seen.has(e)) return false;
      seen.add(e);
      return true;
    });
  }
  return extractRecipients(p.recipientsText);
}

export async function enqueueSend(p) {
  let people = await resolvePeople(p);
  if (!people.length) throw new Error('No valid recipient emails found.');
  const mailboxes = await sendableMailboxes(p.mailboxIds);
  if (!mailboxes.length) throw new Error('No connected, active mailbox selected. Add or test a mailbox first.');

  const settings = await getSettings();
  const delayMin = Math.max(0, Number(p.delayMin) || 0);
  const delayMax = Math.max(delayMin, Number(p.delayMax) || delayMin);
  const format = p.format === 'text' ? 'text' : 'html';
  const subjects = splitSubjects(p.subject);
  if (!subjects.length) throw new Error('Subject is empty.');
  if (!String(p.body || '').trim()) throw new Error('Message is empty.');

  let startAt = Date.now();
  let status = 'running';
  if (p.scheduledAt) {
    const t = new Date(p.scheduledAt).getTime();
    if (!Number.isFinite(t)) throw new Error('Invalid schedule time.');
    if (t > Date.now() + 30000) { startAt = t; status = 'scheduled'; }
  }

  // Save uploaded / pasted people into Contacts so they can be reused (optional).
  if (p.saveToContacts && p.source !== 'contacts') {
    await importContacts(people.map((r) => (r.first_name || r.last_name ? r : { ...r, ...splitName(r.name) })),
                         { tags: p.contactTagForSave ? [p.contactTagForSave] : [] });
  }

  const emails = people.map((r) => String(r.email).trim());
  const suppressed = new Set(
    (await query(`SELECT email FROM suppressions WHERE email = ANY($1)`, [emails.map((e) => e.toLowerCase())])).map((r) => r.email)
  );
  // Optionally skip people who were already emailed in another campaign.
  let used = new Set();
  if (p.excludeUsed) {
    used = new Set((await query(`SELECT DISTINCT lower(email) AS e FROM campaign_recipients WHERE lower(email) = ANY($1)
                                 AND status NOT IN ('suppressed')`, [emails.map((e) => e.toLowerCase())])).map((r) => r.e));
  }
  people = people.filter((r) => !used.has(String(r.email).trim().toLowerCase()));
  if (!people.length) throw new Error('Everyone in this list was already emailed in another campaign.');

  const bodies = splitBodies(p.body).map((v) => withFooter(v, format, settings));
  if (!bodies.length) throw new Error('Message is empty.');
  // Same number of subjects and message versions (e.g. uploaded as subject/body pairs): keep each pair together.
  // Otherwise subjects and messages rotate independently.
  const paired = bodies.length > 1 && bodies.length === subjects.length;
  const nextSubjectIdx = makeSubjectRotator(subjects.map((_, i) => i), mailboxes.length);
  const nextBodyIdx = makeSubjectRotator(bodies.map((_, i) => i), mailboxes.length);

  return tx(async (q) => {
    const [c] = await q(
      `INSERT INTO campaigns (name, kind, status, subject, body, format, delay_min_sec, delay_max_sec, scheduled_at,
                              started_at, exclude_used, stop_on_reply, subject_list_id, recipient_filter)
       VALUES ($1,'quick',$2,$3,$4,$5,$6,$7,$8, CASE WHEN $2='running' THEN now() END, $9, $10, $11, $12) RETURNING id`,
      [String(p.name || '').trim() || `Send ${new Date(startAt).toISOString().slice(0, 16).replace('T', ' ')}`,
       status, subjects.join('\n'), p.body || '', format, delayMin, delayMax,
       status === 'scheduled' ? new Date(startAt) : null, !!p.excludeUsed, settings.stopOnReply,
       p.subjectListId || null, { source: p.source || 'paste', tag: p.contactTag || null }]
    );
    for (const m of mailboxes) await q(`INSERT INTO campaign_mailboxes VALUES ($1,$2)`, [c.id, m.id]);
    for (const a of p.attachments || []) {
      const data = Buffer.from(String(a.content).split(',').pop(), 'base64');
      await q(`INSERT INTO campaign_attachments (campaign_id, filename, content_type, size_bytes, data)
               VALUES ($1,$2,$3,$4,$5)`, [c.id, a.filename, a.type || null, data.length, data]);
    }

    // Round-robin: recipient i -> next mailbox that still has room today.
    // Recipients beyond everyone's cap stay queued without a mailbox and go out once caps reset.
    const left = mailboxes.map(capLeft);
    let ptr = 0;
    let at = startAt;
    let skipped = 0;
    let queued = 0;
    for (const person of people) {
      const email = String(person.email).trim();
      if (suppressed.has(email.toLowerCase())) {
        await q(`INSERT INTO campaign_recipients (campaign_id, email, status) VALUES ($1,$2,'suppressed')
                 ON CONFLICT DO NOTHING`, [c.id, email]);
        skipped++;
        continue;
      }
      let idx = null;
      for (let k = 0; k < mailboxes.length; k++) {
        const i = ptr++ % mailboxes.length;
        if (left[i] > 0) { left[i]--; idx = i; break; }
      }
      const mb = idx == null ? null : mailboxes[idx];
      const vars = recipientVars(person);
      const [r] = await q(
        `INSERT INTO campaign_recipients (campaign_id, contact_id, email, vars, mailbox_id, status)
         VALUES ($1,$2,$3,$4,$5,'active') ON CONFLICT DO NOTHING RETURNING id`,
        [c.id, person.contact_id || null, email, vars, mb?.id || null]);
      if (!r) continue;
      const si = nextSubjectIdx(idx);
      const subject = subjects[si];
      const body = bodies[paired ? si : nextBodyIdx(idx)];
      await q(
        `INSERT INTO outbound_messages (campaign_id, recipient_id, mailbox_id, to_email, subject, body, format, scheduled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8 / 1000.0))`,
        [c.id, r.id, mb?.id || null, email,
         renderTemplate(subject, vars).replace(/\s+/g, ' ').trim(), renderTemplate(body, vars), format, at]
      );
      queued++;
      at += rand(delayMin, delayMax) * 1000;
    }
    await q(`UPDATE campaigns SET total_recipients = $2 WHERE id = $1`, [c.id, queued]);
    const when = status === 'scheduled' ? `Scheduled for ${new Date(startAt).toISOString()}` : 'Starting';
    await q(`INSERT INTO activity_logs (level, action, entity_type, entity_id, message)
             VALUES ('info',$1,'campaign',$2,$3)`,
            [status === 'scheduled' ? 'campaign.scheduled' : 'campaign.started', c.id,
             `${when}: ${queued} recipients across ${mailboxes.length} mailbox(es), ${subjects.length} subject(s) in rotation` +
             (bodies.length > 1 ? `, ${bodies.length} message versions${paired ? ' (paired with subjects)' : ''}` : '') +
             (skipped ? `, ${skipped} suppressed` : '')]);
    return { campaignId: c.id, status, scheduledAt: status === 'scheduled' ? new Date(startAt) : null,
             total: queued, suppressed: skipped, mailboxes: mailboxes.length, subjects: subjects.length };
  });
}

function splitName(name) {
  const v = recipientVars({ email: '', name });
  return { first_name: v.first_name, last_name: v.last_name };
}

// Scheduled campaigns whose time has come start running.
async function startScheduled() {
  const rows = await query(`UPDATE campaigns SET status='running', started_at=now()
                            WHERE status='scheduled' AND scheduled_at <= now() RETURNING id, name`);
  for (const r of rows) {
    await logActivity({ action: 'campaign.started', entityType: 'campaign', entityId: r.id, message: `Scheduled send "${r.name}" started` });
  }
  return rows.length;
}

// Queue the next follow-up step for people who got the previous step `delay_days` ago and haven't replied.
export async function enqueueFollowups() {
  const due = await query(
    `SELECT r.id AS recipient_id, r.campaign_id, r.email, r.vars, s.step_number, s.subject AS step_subject, s.body AS step_body,
            last.mailbox_id, last.message_id, last.subject AS last_subject, c.format
     FROM campaign_recipients r
     JOIN campaigns c ON c.id = r.campaign_id AND c.status IN ('running','completed')
     JOIN sequence_steps s ON s.campaign_id = r.campaign_id AND s.step_number = r.current_step + 1
     JOIN LATERAL (SELECT * FROM outbound_messages o WHERE o.recipient_id = r.id AND o.status = 'sent'
                   ORDER BY o.step_number DESC LIMIT 1) last ON last.step_number = r.current_step
     WHERE r.status IN ('active','completed') AND r.replied_at IS NULL
       AND last.sent_at + make_interval(days => s.delay_days) <= now()
       AND NOT EXISTS (SELECT 1 FROM suppressions x WHERE x.email = lower(r.email))
     LIMIT 300`);
  if (!due.length) return 0;
  const settings = await getSettings();
  const touched = new Set();
  let at = Date.now();
  for (const d of due) {
    const vars = d.vars || {};
    const subject = d.step_subject?.trim()
      ? renderTemplate(d.step_subject, vars)
      : (/^re:/i.test(d.last_subject) ? d.last_subject : `Re: ${d.last_subject}`);
    await query(
      `INSERT INTO outbound_messages (campaign_id, recipient_id, mailbox_id, step_number, to_email, subject, body, format,
                                      scheduled_at, in_reply_to, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, to_timestamp($9 / 1000.0), $10, 'followup')`,
      [d.campaign_id, d.recipient_id, d.mailbox_id, d.step_number, d.email, subject.replace(/\s+/g, ' ').trim(),
       renderTemplate(withFooter(d.step_body, d.format, settings), vars), d.format, at, d.message_id]
    );
    await query(`UPDATE campaign_recipients SET current_step = $2, status = 'active' WHERE id = $1`, [d.recipient_id, d.step_number]);
    touched.add(d.campaign_id);
    at += rand(20, 60) * 1000;
  }
  for (const id of touched) {
    await query(`UPDATE campaigns SET status='running', completed_at=NULL WHERE id=$1 AND status='completed'`, [id]);
  }
  await logActivity({ action: 'followups.queued', message: `Queued ${due.length} follow-up(s) in ${touched.size} campaign(s)` });
  return due.length;
}

// Claim the next due message (safe if two ticks run at the same time).
async function claimNext() {
  return one(
    `UPDATE outbound_messages o SET status = 'sending', attempts = attempts + 1, locked_at = now()
     WHERE o.id = (
       SELECT o2.id FROM outbound_messages o2 JOIN campaigns c ON c.id = o2.campaign_id
       WHERE o2.status = 'queued' AND o2.scheduled_at <= now() AND c.status = 'running'
       ORDER BY o2.scheduled_at LIMIT 1 FOR UPDATE OF o2 SKIP LOCKED)
     RETURNING o.*`
  );
}

// Pick the assigned mailbox if it can still send, otherwise another mailbox of the same campaign.
// Follow-ups stay on their original mailbox (same thread), so they wait instead of switching.
async function pickMailbox(msg) {
  const rows = await query(
    `SELECT m.*, CASE WHEN m.sent_today_date = CURRENT_DATE THEN m.sent_today ELSE 0 END AS sent_today_eff
     FROM mailboxes m JOIN campaign_mailboxes cm ON cm.mailbox_id = m.id
     WHERE cm.campaign_id = $1 AND m.connection = 'connected' AND NOT m.paused
       AND (m.daily_cap = 0 OR CASE WHEN m.sent_today_date = CURRENT_DATE THEN m.sent_today ELSE 0 END < m.daily_cap)
       ${msg.step_number > 0 && msg.mailbox_id ? 'AND m.id = $2' : ''}
     ORDER BY (m.id = $2) DESC, sent_today_eff ASC LIMIT 1`,
    [msg.campaign_id, msg.mailbox_id]
  );
  return rows[0] || null;
}

async function finishCampaignIfDone(campaignId) {
  const left = await one(`SELECT count(*)::int AS n FROM outbound_messages
                          WHERE campaign_id = $1 AND status IN ('queued','sending')`, [campaignId]);
  if (left.n > 0) return;
  const c = await one(`UPDATE campaigns SET status = 'completed', completed_at = now()
                       WHERE id = $1 AND status = 'running' RETURNING id`, [campaignId]);
  if (c) {
    const s = await one(`SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
                                count(*) FILTER (WHERE status='failed')::int AS failed
                         FROM outbound_messages WHERE campaign_id = $1`, [campaignId]);
    await logActivity({ action: 'campaign.completed', entityType: 'campaign', entityId: campaignId,
                        message: `Done. Sent: ${s.sent}, Failed: ${s.failed}.` });
  }
}

// Plain-text twin of an HTML body. A sloppy text part (tags glued together, no line breaks)
// is itself a spam signal, so keep paragraphs and links readable.
export function htmlToText(html) {
  return String(html)
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => `${t} (${href})`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function fromHeader(mb) {
  return mb.from_name ? `"${mb.from_name.replace(/"/g, '')}" <${mb.email}>` : mb.email;
}

async function sendOne(msg) {
  const mb = await pickMailbox(msg);
  if (!mb) {
    // Everyone is capped/paused: try again in 1 hour (caps reset at midnight).
    await query(`UPDATE outbound_messages SET status='queued',
                 mailbox_id = CASE WHEN step_number > 0 THEN mailbox_id END,
                 scheduled_at = now() + interval '1 hour' WHERE id = $1`, [msg.id]);
    await logActivity({ level: 'warn', action: 'message.deferred', entityType: 'campaign', entityId: msg.campaign_id,
                        message: `No mailbox with capacity for ${msg.to_email}; retrying in 1 hour` });
    return 'deferred';
  }
  // A reply arrived after this was queued: don't send (stop on reply).
  if (msg.recipient_id) {
    const r = await one(`SELECT r.status, r.vars, c.stop_on_reply, c.send_as_bcc FROM campaign_recipients r
                         JOIN campaigns c ON c.id = r.campaign_id WHERE r.id = $1`, [msg.recipient_id]);
    if (r && (r.status === 'unsubscribed' || (r.status === 'replied' && r.stop_on_reply))) {
      await query(`UPDATE outbound_messages SET status='cancelled', error='Recipient replied' WHERE id=$1`, [msg.id]);
      return 'skipped';
    }
    msg.to_name = r?.vars?.name || '';
    msg.bcc = r?.send_as_bcc;
  }
  const attachments = msg.step_number > 0 ? [] :
    await query(`SELECT filename, content_type, data FROM campaign_attachments WHERE campaign_id = $1`, [msg.campaign_id]);
  const toAddr = msg.to_name ? { name: msg.to_name, address: msg.to_email } : msg.to_email;
  try {
    const info = await getTransport(mb).sendMail({
      from: fromHeader(mb),
      ...(msg.bcc ? { to: mb.email, bcc: msg.to_email } : { to: toAddr }),
      subject: msg.subject,
      ...(msg.in_reply_to ? { inReplyTo: msg.in_reply_to, references: [msg.in_reply_to] } : {}),
      ...(msg.format === 'text' ? { text: msg.body } : { html: msg.body, text: htmlToText(msg.body) }),
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.data, contentType: a.content_type || undefined })),
    });
    await query(`UPDATE outbound_messages SET status='sent', sent_at=now(), mailbox_id=$2, message_id=$3, error=NULL
                 WHERE id=$1`, [msg.id, mb.id, info.messageId || null]);
    await query(`UPDATE mailboxes SET
                   sent_today = CASE WHEN sent_today_date = CURRENT_DATE THEN sent_today + 1 ELSE 1 END,
                   sent_today_date = CURRENT_DATE WHERE id = $1`, [mb.id]);
    await query(`UPDATE campaign_recipients SET mailbox_id=$2, status='completed' WHERE id=$1 AND status='active'`,
                [msg.recipient_id, mb.id]);
    await query(`INSERT INTO email_events (outbound_id, campaign_id, type) VALUES ($1,$2,'sent')`, [msg.id, msg.campaign_id]);
    await logActivity({ level: 'success', action: 'message.sent', entityType: 'campaign', entityId: msg.campaign_id,
                        message: `${mb.email}  →  ${msg.to_email}${msg.step_number ? `  (follow-up ${msg.step_number})` : ''}  “${msg.subject}”` });
    return 'sent';
  } catch (e) {
    const bounce = /5\d\d|does not exist|user unknown|no such user|mailbox unavailable/i.test(e.message);
    await query(`UPDATE outbound_messages SET status='failed', mailbox_id=$2, error=$3 WHERE id=$1`,
                [msg.id, mb.id, e.message]);
    await query(`UPDATE campaign_recipients SET status=$2 WHERE id=$1`, [msg.recipient_id, bounce ? 'bounced' : 'failed']);
    await logActivity({ level: 'error', action: 'message.failed', entityType: 'campaign', entityId: msg.campaign_id,
                        message: `${mb.email}  →  ${msg.to_email}  FAILED: ${e.message}` });
    return 'failed';
  }
}

// Sends due messages until the time budget runs out. Returns counts.
export async function processQueue({ budgetMs = 20000 } = {}) {
  const until = Date.now() + budgetMs;
  // Recover messages stuck in "sending" (e.g. a function timed out mid-send).
  await query(`UPDATE outbound_messages SET status='queued'
               WHERE status='sending' AND attempts < 3 AND locked_at < now() - interval '5 minutes'`);
  const started = await startScheduled();
  const followups = await enqueueFollowups();
  const out = { started, followups, sent: 0, failed: 0, deferred: 0, skipped: 0 };
  const touched = new Set();
  while (Date.now() < until) {
    const msg = await claimNext();
    if (!msg) break;
    touched.add(msg.campaign_id);
    out[await sendOne(msg)]++;
  }
  for (const id of touched) await finishCampaignIfDone(id);
  const next = await one(`SELECT min(at) AS at FROM (
                            SELECT min(o.scheduled_at) AS at FROM outbound_messages o JOIN campaigns c ON c.id=o.campaign_id
                            WHERE o.status='queued' AND c.status='running'
                            UNION ALL SELECT min(scheduled_at) FROM campaigns WHERE status='scheduled') x`);
  return { ...out, nextDueAt: next?.at || null };
}

export async function campaignProgress(id, afterLogId = 0) {
  const c = await one(`SELECT id, name, status, scheduled_at FROM campaigns WHERE id = $1`, [id]);
  if (!c) return null;
  const counts = await one(
    `SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
            count(*) FILTER (WHERE status='failed')::int AS failed,
            count(*) FILTER (WHERE status IN ('queued','sending'))::int AS pending,
            count(*)::int AS total
     FROM outbound_messages WHERE campaign_id = $1`, [id]);
  const logs = await query(
    `SELECT id, level, message, created_at FROM activity_logs
     WHERE entity_type='campaign' AND entity_id=$1 AND id > $2 ORDER BY id LIMIT 200`, [id, afterLogId]);
  return { campaign: c, ...counts, logs };
}

export async function listCampaigns({ limit = 50 } = {}) {
  return query(
    `SELECT c.id, c.name, c.status, c.subject, c.scheduled_at, c.started_at, c.completed_at, c.created_at, c.total_recipients,
            (SELECT count(*)::int FROM outbound_messages o WHERE o.campaign_id=c.id AND o.status='sent') AS sent,
            (SELECT count(*)::int FROM outbound_messages o WHERE o.campaign_id=c.id AND o.status='failed') AS failed,
            (SELECT count(*)::int FROM outbound_messages o WHERE o.campaign_id=c.id AND o.status IN ('queued','sending')) AS pending,
            (SELECT count(*)::int FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.replied_at IS NOT NULL) AS replied,
            (SELECT count(*)::int FROM sequence_steps s WHERE s.campaign_id=c.id) AS steps,
            (SELECT string_agg(m.email, ', ') FROM campaign_mailboxes cm JOIN mailboxes m ON m.id=cm.mailbox_id
              WHERE cm.campaign_id=c.id) AS mailboxes
     FROM campaigns c ORDER BY c.created_at DESC LIMIT $1`, [limit]);
}

export async function stopCampaign(id) {
  await query(`UPDATE campaigns SET status='stopped', completed_at=now() WHERE id=$1 AND status IN ('running','paused','scheduled')`, [id]);
  const r = await query(`UPDATE outbound_messages SET status='cancelled' WHERE campaign_id=$1 AND status='queued' RETURNING id`, [id]);
  await logActivity({ level: 'warn', action: 'campaign.stopped', entityType: 'campaign', entityId: id,
                      message: `Stopped by user. ${r.length} queued message(s) cancelled.` });
}

export async function setCampaignPaused(id, paused) {
  if (paused) {
    await query(`UPDATE campaigns SET status='paused' WHERE id=$1 AND status='running'`, [id]);
  } else {
    // Resume: messages that were due while paused go out from now on, spaced as before.
    await query(`UPDATE campaigns SET status='running' WHERE id=$1 AND status='paused'`, [id]);
  }
  await logActivity({ level: 'warn', action: paused ? 'campaign.paused' : 'campaign.resumed', entityType: 'campaign',
                      entityId: id, message: paused ? 'Paused by user' : 'Resumed by user' });
}

export async function recordJobRun(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    await query(`UPDATE scheduled_jobs SET last_run_at=now(), last_status='ok', last_result=$2, last_duration_ms=$3
                 WHERE name=$1`, [name, result, Date.now() - started]);
    return result;
  } catch (e) {
    await query(`UPDATE scheduled_jobs SET last_run_at=now(), last_status='error', last_result=$2, last_duration_ms=$3
                 WHERE name=$1`, [name, { error: e.message }, Date.now() - started]);
    throw e;
  }
}
