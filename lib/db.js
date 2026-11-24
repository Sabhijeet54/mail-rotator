import { Pool } from 'pg';

// One pool per server instance. On Vercel each function instance reuses it across requests.
function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const local = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({
    connectionString: url,
    ssl: local ? false : { rejectUnauthorized: false },
    max: local ? 10 : 3, // serverless: keep it small, use the provider's pooled URL
  });
}

const g = globalThis;
function pool() {
  if (!g.__mrPool) g.__mrPool = makePool();
  return g.__mrPool;
}

export async function query(text, params) {
  const res = await pool().query(text, params);
  return res.rows;
}

export async function one(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

export async function tx(fn) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const q = async (t, p) => (await client.query(t, p)).rows;
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
