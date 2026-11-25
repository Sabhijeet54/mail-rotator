import { query, one } from './db';
import { logActivity } from './log';
import { titleCase } from './render';

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONSENT = ['opted_in', 'unknown', 'opted_out'];

function cleanTags(t) {
  const arr = Array.isArray(t) ? t : String(t || '').split(/[,;|]/);
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

function where({ search, tag, consent }) {
  const w = [];
  const p = [];
  if (search) {
    p.push('%' + search + '%');
    w.push(`(c.email ILIKE $${p.length} OR c.first_name ILIKE $${p.length} OR c.last_name ILIKE $${p.length} OR c.company ILIKE $${p.length})`);
  }
  if (tag) { p.push(tag); w.push(`$${p.length} = ANY(c.tags)`); }
  if (consent) { p.push(consent); w.push(`c.consent = $${p.length}`); }
  return { sql: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}

export async function listContacts({ search, tag, consent, limit = 100, offset = 0 } = {}) {
  const { sql, params } = where({ search, tag, consent });
  const [rows, total, tags] = await Promise.all([
    query(`SELECT c.*,
                  (SELECT count(*)::int FROM campaign_recipients r WHERE lower(r.email) = lower(c.email)) AS campaigns,
                  (SELECT max(r.replied_at) FROM campaign_recipients r WHERE lower(r.email) = lower(c.email)) AS replied_at,
                  EXISTS (SELECT 1 FROM suppressions s WHERE s.email = lower(c.email)) AS suppressed
           FROM contacts c ${sql} ORDER BY c.created_at DESC
           LIMIT ${Math.min(Number(limit) || 100, 5000)} OFFSET ${Math.max(0, Number(offset) || 0)}`, params),
    one(`SELECT count(*)::int AS n FROM contacts c ${sql}`, params),
    query(`SELECT t AS tag, count(*)::int AS n FROM contacts, unnest(tags) t GROUP BY t ORDER BY t`),
  ]);
  return { contacts: rows, total: total.n, tags };
}

// Contacts used as campaign recipients (opted-out and suppressed are left out).
export async function contactsForSend({ tag, ids } = {}) {
  const p = [];
  const w = [`c.consent <> 'opted_out'`, `NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = lower(c.email))`];
  if (tag) { p.push(tag); w.push(`$${p.length} = ANY(c.tags)`); }
  if (ids?.length) { p.push(ids); w.push(`c.id = ANY($${p.length})`); }
  return query(`SELECT c.id, c.email, c.first_name, c.last_name, c.company, c.fields FROM contacts c
                WHERE ${w.join(' AND ')} ORDER BY c.created_at`, p);
}

function normalize(d) {
  const email = String(d.email || '').trim();
  if (!EMAIL_OK.test(email)) throw new Error(`Invalid email: "${email}"`);
  return {
    email,
    first_name: titleCase(d.first_name ?? d.firstName ?? ''),
    last_name: titleCase(d.last_name ?? d.lastName ?? ''),
    company: String(d.company || '').trim(),
    tags: cleanTags(d.tags),
    consent: CONSENT.includes(d.consent) ? d.consent : 'unknown',
    fields: d.fields && typeof d.fields === 'object' ? d.fields : {},
  };
}

export async function createContact(d) {
  const n = normalize(d);
  const exists = await one(`SELECT id FROM contacts WHERE lower(email) = lower($1)`, [n.email]);
  if (exists) throw new Error(`${n.email} is already in Contacts`);
  return one(`INSERT INTO contacts (email, first_name, last_name, company, tags, consent, fields)
              VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
             [n.email, n.first_name, n.last_name, n.company, n.tags, n.consent, n.fields]);
}

export async function updateContact(id, d) {
  const n = normalize(d);
  const row = await one(`UPDATE contacts SET email=$2, first_name=$3, last_name=$4, company=$5, tags=$6, consent=$7,
                                fields=$8, updated_at=now() WHERE id=$1 RETURNING *`,
                        [id, n.email, n.first_name, n.last_name, n.company, n.tags, n.consent, n.fields]);
  if (n.consent === 'opted_out') {
    await query(`INSERT INTO suppressions (email, reason, source) VALUES (lower($1),'unsubscribe','contacts')
                 ON CONFLICT DO NOTHING`, [n.email]);
  }
  return row;
}

export async function removeContacts(ids) {
  const r = await query(`DELETE FROM contacts WHERE id = ANY($1) RETURNING id`, [ids]);
  return r.length;
}

// Upsert many rows: [{email, first_name, last_name, company, tags, fields}].
// Existing contacts get blank name/company filled in and the new tags added; nothing else is overwritten.
export async function importContacts(rows, { tags = [] } = {}) {
  const extraTags = cleanTags(tags);
  let added = 0;
  let updated = 0;
  const errors = [];
  const seen = new Set();
  const valid = [];
  for (const [i, raw] of (rows || []).entries()) {
    try {
      const n = normalize({ ...raw, tags: [...cleanTags(raw.tags), ...extraTags] });
      if (seen.has(n.email.toLowerCase())) continue;
      seen.add(n.email.toLowerCase());
      valid.push(n);
    } catch (e) {
      errors.push({ row: i + 2, error: e.message });
    }
  }
  for (let i = 0; i < valid.length; i += 500) {
    const chunk = valid.slice(i, i + 500);
    const res = await query(
      `INSERT INTO contacts (email, first_name, last_name, company, tags, fields)
       SELECT x->>'email', x->>'first_name', x->>'last_name', x->>'company',
              ARRAY(SELECT jsonb_array_elements_text(x->'tags')), COALESCE(x->'fields', '{}'::jsonb)
       FROM jsonb_array_elements($1::jsonb) x
       ON CONFLICT (lower(email)) DO UPDATE SET
         first_name = CASE WHEN contacts.first_name = '' THEN EXCLUDED.first_name ELSE contacts.first_name END,
         last_name  = CASE WHEN contacts.last_name  = '' THEN EXCLUDED.last_name  ELSE contacts.last_name  END,
         company    = CASE WHEN contacts.company    = '' THEN EXCLUDED.company    ELSE contacts.company    END,
         tags       = ARRAY(SELECT DISTINCT unnest(contacts.tags || EXCLUDED.tags)),
         fields     = EXCLUDED.fields || contacts.fields,
         updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [JSON.stringify(chunk)]
    );
    for (const r of res) r.inserted ? added++ : updated++;
  }
  await logActivity({ level: 'success', action: 'contacts.imported', entityType: 'contact',
                      message: `Contacts import: ${added} new, ${updated} updated, ${errors.length} skipped` });
  return { added, updated, errors };
}
