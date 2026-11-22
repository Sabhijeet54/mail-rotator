// Pulls all email addresses out of any pasted text and removes duplicates.
function extractEmails(text) {
  if (!text) return [];
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const found = text.match(re) || [];
  const seen = new Set();
  const out = [];
  for (const raw of found) {
    const low = raw.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      out.push(raw.trim());
    }
  }
  return out;
}

module.exports = { extractEmails };
