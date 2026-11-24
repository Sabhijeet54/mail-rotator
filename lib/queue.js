// Database-backed send queue. Replaces the old socket.io loop so it works on serverless (Vercel):
// - enqueueQuickSend() writes one outbound_messages row per recipient, staggered by the gap.
// - processQueue() sends whatever is due within a time budget. It is called by the browser
//   (/api/queue/tick) while a send is open, and by Vercel Cron (/api/cron/process-queue).
import { query, one, tx } from './db';
import { getTransport } from './mailboxes';
import { extractEmails } from './extract';
import { renderTemplate } from './render';
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

export async function enqueueQuickSend(p) {
  const recipients = extractEmails(p.recipientsText);
  if (!recipients.length) throw new Error('No valid recipient emails found.');
  const mailboxes = await sendableMailboxes(p.mailboxIds);
  if (!mailboxes.length) throw new Error('No connected, active mailbox selected. Add or test a mailbox first.');

  const delayMin = Math.max(0, Number(p.delayMin) || 0);
  const delayMax = Math.max(delayMin, Number(p.delayMax) || delayMin);
  const format = p.format === 'text' ? 'text' : 'html';

  const suppressed = new Set(
    (await query(`SELECT email FROM suppressions WHERE email = ANY($1)`, [recipients.map((r) => r.toLowerCase())]))
      .map((r) => r.email)
  );

  return tx(async (q) => {
    const [c] = await q(
      `INSERT INTO campaigns (name, kind, status, subject, body, format, delay_min_sec, delay_max_sec, started_at)
       VALUES ($1,'quick','running',$2,$3,$4,$5,$6, now()) RETURNING id`,
      [p.name || `Quick send ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
       p.subject || '', p.body || '', format, delayMin, delayMax]
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
    let at = Date.now();
    let skipped = 0;
    for (const email of recipients) {
      if (suppressed.has(email.toLowerCase())) {
        await q(`INSERT INTO campaign_recipients (campaign_id, email, status) VALUES ($1,$2,'suppressed')
                 ON CONFLICT DO NOTHING`, [c.id, email]);
        skipped++;
        continue;
      }
      let mb = null;
      for (let k = 0; k < mailboxes.length; k++) {
        const idx = ptr++ % mailboxes.length;
        if (left[idx] > 0) { left[idx]--; mb = mailboxes[idx]; break; }
      }
      const [r] = await q(
        `INSERT INTO campaign_recipients (campaign_id, email, mailbox_id, status) VALUES ($1,$2,$3,'active')
         ON CONFLICT DO NOTHING RETURNING id`, [c.id, email, mb?.id || null]);
      if (!r) continue;
      await q(
        `INSERT INTO outbound_messages (campaign_id, recipient_id, mailbox_id, to_email, subject, body, format, scheduled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8 / 1000.0))`,
        [c.id, r.id, mb?.id || null, email,
         renderTemplate(p.subject, { email }), renderTemplate(p.body, { email }), format, at]
      );
      at += rand(delayMin, delayMax) * 1000;
    }
    await q(`INSERT INTO activity_logs (level, action, entity_type, entity_id, message)
             VALUES ('info','campaign.started','campaign',$1,$2)`,
            [c.id, `Starting: ${recipients.length - skipped} recipients across ${mailboxes.length} mailbox(es)` +
                    (skipped ? `, ${skipped} suppressed` : '')]);
    return { campaignId: c.id, total: recipients.length - skipped, suppressed: skipped, mailboxes: mailboxes.length };
  });
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
async function pickMailbox(msg) {
  const rows = await query(
    `SELECT m.*, CASE WHEN m.sent_today_date = CURRENT_DATE THEN m.sent_today ELSE 0 END AS sent_today_eff
     FROM mailboxes m JOIN campaign_mailboxes cm ON cm.mailbox_id = m.id
     WHERE cm.campaign_id = $1 AND m.connection = 'connected' AND NOT m.paused
       AND (m.daily_cap = 0 OR CASE WHEN m.sent_today_date = CURRENT_DATE THEN m.sent_today ELSE 0 END < m.daily_cap)
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

async function sendOne(msg) {
  const mb = await pickMailbox(msg);
  if (!mb) {
    // Everyone is capped/paused: try again in 1 hour (caps reset at midnight).
    await query(`UPDATE outbound_messages SET status='queued', mailbox_id=NULL,
                 scheduled_at = now() + interval '1 hour' WHERE id = $1`, [msg.id]);
    await logActivity({ level: 'warn', action: 'message.deferred', entityType: 'campaign', entityId: msg.campaign_id,
                        message: `No mailbox with capacity for ${msg.to_email}; retrying in 1 hour` });
    return 'deferred';
  }
  const [campaign, attachments] = await Promise.all([
    one(`SELECT send_as_bcc FROM campaigns WHERE id = $1`, [msg.campaign_id]),
    query(`SELECT filename, content_type, data FROM campaign_attachments WHERE campaign_id = $1`, [msg.campaign_id]),
  ]);
  const from = mb.from_name ? `"${mb.from_name.replace(/"/g, '')}" <${mb.email}>` : mb.email;
  try {
    const info = await getTransport(mb).sendMail({
      from,
      ...(campaign?.send_as_bcc ? { to: mb.email, bcc: msg.to_email } : { to: msg.to_email }),
      subject: msg.subject,
      ...(msg.format === 'text' ? { text: msg.body } : { html: msg.body, text: msg.body.replace(/<[^>]+>/g, '') }),
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
                        message: `${mb.email}  →  ${msg.to_email}` });
    return 'sent';
  } catch (e) {
    await query(`UPDATE outbound_messages SET status='failed', mailbox_id=$2, error=$3 WHERE id=$1`,
                [msg.id, mb.id, e.message]);
    await query(`UPDATE campaign_recipients SET status='failed' WHERE id=$1`, [msg.recipient_id]);
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
  const out = { sent: 0, failed: 0, deferred: 0 };
  const touched = new Set();
  while (Date.now() < until) {
    const msg = await claimNext();
    if (!msg) break;
    touched.add(msg.campaign_id);
    out[await sendOne(msg)]++;
  }
  for (const id of touched) await finishCampaignIfDone(id);
  const next = await one(`SELECT min(o.scheduled_at) AS at FROM outbound_messages o JOIN campaigns c ON c.id=o.campaign_id
                          WHERE o.status='queued' AND c.status='running'`);
  return { ...out, nextDueAt: next?.at || null };
}

export async function campaignProgress(id, afterLogId = 0) {
  const c = await one(`SELECT id, name, status FROM campaigns WHERE id = $1`, [id]);
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

export async function stopCampaign(id) {
  await query(`UPDATE campaigns SET status='stopped', completed_at=now() WHERE id=$1 AND status IN ('running','paused')`, [id]);
  const r = await query(`UPDATE outbound_messages SET status='cancelled' WHERE campaign_id=$1 AND status='queued' RETURNING id`, [id]);
  await logActivity({ level: 'warn', action: 'campaign.stopped', entityType: 'campaign', entityId: id,
                      message: `Stopped by user. ${r.length} queued message(s) cancelled.` });
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
