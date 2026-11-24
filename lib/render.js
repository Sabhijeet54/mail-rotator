// Placeholders: {{name}}  {{first_name}}  {{email}}  — or with fallback  {{first_name|there}}
// Single braces work too for the known keys: {name} {first_name} {last_name} {email}
export function renderTemplate(text, vars = {}) {
  const val = (key, fallback) => {
    const v = vars[key];
    return v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : (fallback ?? '').trim();
  };
  return String(text || '')
    .replace(/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g, (_, key, fallback) => val(key, fallback))
    .replace(/\{\s*(name|first_name|last_name|email)\s*(?:\|([^{}]*))?\}/gi, (_, key, fallback) => val(key.toLowerCase(), fallback));
}

// Builds the personalization variables for one recipient.
export function recipientVars({ email, name }) {
  let full = String(name || '').trim().replace(/\s+/g, ' ');
  // "rahul sharma" / "RAHUL SHARMA" -> "Rahul Sharma"; mixed case like "McDonald" is left alone.
  if (full === full.toLowerCase() || full === full.toUpperCase()) {
    full = full.toLowerCase().replace(/(^|\s)(\S)/g, (_, sp, ch) => sp + ch.toUpperCase());
  }
  const [first = '', ...rest] = full ? full.split(' ') : [];
  return { email, name: full, first_name: first, last_name: rest.join(' ') };
}

// "Subject A\nSubject B" -> ['Subject A', 'Subject B'] (blank lines ignored).
export function splitSubjects(text) {
  return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
