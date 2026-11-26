'use client';

// Reads CSV / TSV / TXT / XLSX files in the browser and turns them into rows.
// Excel (.xlsx) is read with read-excel-file; old .xls must be saved as .xlsx or .csv first.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseCSV(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = [',', '\t', ';'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
}

export async function readTable(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) throw new Error('Old .xls format: open it in Excel and "Save as" .xlsx or .csv, then upload again.');
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file');
    const rows = await readXlsxFile(file);
    return rows.map((r) => r.map((c) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim())))
               .filter((r) => r.some(Boolean));
  }
  return parseCSV(await file.text());
}

const KEYS = {
  first_name: /^(first[\s_-]*name|firstname|first|fname|given[\s_-]*name|name[\s_-]*first)$/i,
  last_name: /^(last[\s_-]*name|lastname|last|lname|surname|family[\s_-]*name|second[\s_-]*name|name[\s_-]*last)$/i,
  name: /^(name|full[\s_-]*name|fullname|contact[\s_-]*name|person)$/i,
  email: /^(e-?mail|e-?mail[\s_-]*(id|address)|mail|mail[\s_-]*id|email[\s_-]*id)$/i,
  company: /^(company|company[\s_-]*name|organi[sz]ation|org|employer|business)$/i,
  tags: /^(tags?|labels?|group|list)$/i,
};
const slug = (h) => String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// rows (array of arrays) -> { people: [{email, first_name, last_name, company, tags, fields}], columns, skipped }
export function rowsToPeople(rows) {
  if (!rows.length) return { people: [], columns: [], skipped: 0 };
  const header = rows[0];
  const hasHeader = !header.some((c) => EMAIL_RE.test(c));
  let map = {};
  const extra = [];
  if (hasHeader) {
    header.forEach((h, i) => {
      const key = Object.keys(KEYS).find((k) => KEYS[k].test(String(h).trim()) && map[k] == null);
      if (key) map[key] = i;
      else if (String(h).trim()) extra.push([slug(h), i]);
    });
  }
  const body = hasHeader ? rows.slice(1) : rows;
  if (map.email == null) {
    // No header we recognise: find the column that holds emails.
    const counts = {};
    body.slice(0, 50).forEach((r) => r.forEach((c, i) => { if (EMAIL_RE.test(c)) counts[i] = (counts[i] || 0) + 1; }));
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!best) return { people: [], columns: [], skipped: body.length };
    const ei = Number(best[0]);
    if (!hasHeader) {
      // Guess: columns before the email are names: [first, last] or [full name].
      const before = [...Array(ei).keys()];
      map = { email: ei };
      if (before.length >= 2) { map.first_name = before[0]; map.last_name = before[1]; }
      else if (before.length === 1) map.name = before[0];
      if (body[0]?.length > ei + 1) map.company = ei + 1;
    } else map.email = ei;
  }
  const people = [];
  let skipped = 0;
  for (const r of body) {
    const email = String(r[map.email] || '').trim();
    if (!EMAIL_RE.test(email)) { skipped++; continue; }
    let first = map.first_name != null ? r[map.first_name] || '' : '';
    let last = map.last_name != null ? r[map.last_name] || '' : '';
    if (!first && !last && map.name != null) {
      const parts = String(r[map.name] || '').trim().split(/\s+/);
      first = parts.shift() || '';
      last = parts.join(' ');
    }
    const fields = {};
    for (const [k, i] of extra) if (r[i]) fields[k] = r[i];
    people.push({
      email, first_name: first, last_name: last,
      company: map.company != null ? r[map.company] || '' : '',
      tags: map.tags != null ? r[map.tags] || '' : '',
      fields,
    });
  }
  const columns = Object.entries(map).map(([k, i]) => `${k} ← "${hasHeader ? header[i] : `column ${i + 1}`}"`);
  for (const [k, i] of extra) columns.push(`{{${k}}} ← "${header[i]}"`);
  return { people, columns, skipped };
}

// rows -> list of subjects (column named "subject", else the first column). Header row skipped.
export function rowsToSubjects(rows) {
  if (!rows.length) return [];
  let col = 0;
  let start = 0;
  const hi = rows[0].findIndex((h) => /^subjects?(\s*lines?)?$/i.test(h));
  if (hi >= 0) { col = hi; start = 1; }
  const seen = new Set();
  return rows.slice(start).map((r) => String(r[col] || '').trim().replace(/^\d+[.)]\s+/, '').replace(/^["']|["']$/g, ''))
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob(['﻿' + text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const CONTACTS_SAMPLE = 'first_name,last_name,email,company\nRahul,Sharma,rahul.sharma@example.com,Acme Pvt Ltd\nPriya,Verma,priya.verma@example.com,Globex\n';
export const SUBJECTS_SAMPLE = 'subject\nQuick question, {first_name}\n{first_name}, are you hiring for this role?\nApplication for the open position at {company|your company}\nHi {first_name} - a short note\n';

// rows -> { subjects, bodies } from a sheet with a "subject" column and a "body" / "message" / "html" column.
// Rows stay in order so subject N and body N can be sent together.
export function rowsToMessages(rows) {
  if (!rows.length) return { subjects: [], bodies: [] };
  const h = rows[0].map((x) => String(x).trim());
  const si = h.findIndex((x) => /^subjects?(\s*lines?)?$/i.test(x));
  const bi = h.findIndex((x) => /^(body|bodies|message|messages|html|content|text|email[\s_-]*body|mail[\s_-]*body)$/i.test(x));
  if (bi < 0) throw new Error('No "body" column found. Use columns named subject and body (download the Sample).');
  const subjects = [];
  const bodies = [];
  for (const r of rows.slice(1)) {
    const b = String(r[bi] || '').trim();
    if (!b) continue;
    bodies.push(b);
    if (si >= 0) subjects.push(String(r[si] || '').trim());
  }
  return { subjects: subjects.filter(Boolean), bodies };
}

export const MESSAGES_SAMPLE = 'subject,body\n'
  + '"Quick question, {first_name}","Hi {first_name|there},\n\nI came across {company|your company} and wanted to ask a quick question.\n\nThanks"\n'
  + '"{first_name}, a short note","<p>Hello {first_name|there},</p><p>Sharing a short note about {company|your company}.</p><p>Regards</p>"\n';
