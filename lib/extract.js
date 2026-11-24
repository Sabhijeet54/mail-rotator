const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Pulls all email addresses out of any pasted text and removes duplicates.
function extractEmails(text) {
  return extractRecipients(text).map((r) => r.email);
}

// Like extractEmails, but also picks up a name written on the same line, e.g.
//   Rahul Sharma, rahul@x.com      Rahul Sharma <rahul@x.com>      rahul@x.com  Rahul
//   Rahul Sharma<TAB>rahul@x.com   (pasted from Excel / Google Sheets)
// A line with several emails gets no name (we can't tell whose it is).
function extractRecipients(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const emails = line.match(EMAIL_RE) || [];
    let name = '';
    if (emails.length === 1) {
      name = line
        .replace(EMAIL_RE, ' ')
        .replace(/[<>"'()\[\];:|]/g, ' ')
        .replace(/[,\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      // Ignore junk like "email" / "name" header words or stray numbers.
      if (!/[a-zA-Zऀ-ॿ]/.test(name) || /^(name|email|e-mail|mail)( (name|email|e-mail|mail))?$/i.test(name)) name = '';
    }
    for (const raw of emails) {
      const email = raw.trim();
      const low = email.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      out.push({ email, name });
    }
  }
  return out;
}

module.exports = { extractEmails, extractRecipients };
