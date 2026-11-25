// Placeholders: {{name}}  {{first_name}}  {{last_name}}  {{email}}  {{company}}  — or with fallback  {{first_name|there}}
// Single braces work too for the known keys: {name} {first_name} {last_name} {email} {company}
// Any extra column from an uploaded file works as {{column_name}}.
export function renderTemplate(text, vars = {}) {
  const val = (key, fallback) => {
    const v = vars[key] ?? vars[String(key).toLowerCase()];
    return v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : (fallback ?? '').trim();
  };
  return String(text || '')
    .replace(/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g, (_, key, fallback) => val(key, fallback))
    .replace(/\{\s*(name|first_name|last_name|email|company)\s*(?:\|([^{}]*))?\}/gi, (_, key, fallback) => val(key.toLowerCase(), fallback));
}

// "rahul sharma" / "RAHUL SHARMA" -> "Rahul Sharma"; mixed case like "McDonald" is left alone.
export function titleCase(s) {
  let v = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (v === v.toLowerCase() || v === v.toUpperCase()) {
    v = v.toLowerCase().replace(/(^|[\s-])(\S)/g, (_, sp, ch) => sp + ch.toUpperCase());
  }
  return v;
}

// Builds the personalization variables for one recipient.
// Accepts {email, name} (pasted list) or {email, first_name, last_name, company, fields} (file / contacts).
export function recipientVars(p) {
  const email = String(p.email || '').trim();
  let first = titleCase(p.first_name);
  let last = titleCase(p.last_name);
  let full = titleCase(p.name);
  if (!first && !last && full) {
    const [f = '', ...rest] = full.split(' ');
    first = f;
    last = rest.join(' ');
  }
  if (!full) full = [first, last].filter(Boolean).join(' ');
  const extra = {};
  for (const [k, v] of Object.entries(p.fields || {})) {
    if (v != null && String(v).trim() !== '') extra[k] = String(v);
  }
  return { ...extra, email, name: full, first_name: first, last_name: last, company: String(p.company || '').trim() };
}

// "Subject A\nSubject B" -> ['Subject A', 'Subject B'] (blank lines and duplicates ignored).
export function splitSubjects(text) {
  const seen = new Set();
  return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => {
    if (!s || seen.has(s.toLowerCase())) return false;
    seen.add(s.toLowerCase());
    return true;
  });
}

// Subject rotation. Each mailbox walks the (shuffled) subject list from its own starting point, so
//  - one mailbox never sends the same subject twice in a row (as long as there are 2+ subjects), and
//  - different mailboxes sending at the same moment use different subjects.
export function makeSubjectRotator(subjects, mailboxCount) {
  const list = [...subjects];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const m = Math.max(1, mailboxCount);
  const step = Math.max(1, Math.floor(list.length / m));
  const ptr = new Map();
  return (mailboxIndex) => {
    const key = mailboxIndex ?? -1;
    if (!ptr.has(key)) ptr.set(key, ((key < 0 ? m : key) * step) % list.length);
    const i = ptr.get(key);
    ptr.set(key, (i + 1) % list.length);
    return list[i];
  };
}
