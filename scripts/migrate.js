// Applies db/schema.sql. Runs automatically before `next build` (so every Vercel deploy migrates).
// Skips quietly when DATABASE_URL is missing, so a build without a DB still works.
const fs = require('fs');
const path = require('path');
const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');

loadEnvConfig(process.cwd());

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[migrate] DATABASE_URL not set — skipping.');
    return;
  }
  const local = /localhost|127\.0\.0\.1/.test(url);
  const client = new Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  await client.connect();
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await client.query(sql);
  await client.end();
  console.log('[migrate] schema applied.');
})().catch((e) => {
  console.error('[migrate] failed:', e.message);
  process.exit(1);
});
