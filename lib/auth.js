import crypto from 'crypto';
import { query, one } from './db';

// The one admin account. Fixed here on purpose: it is not in the database, has no edit screen,
// and nobody can change it from the app. To change it, edit these two lines and redeploy.
// Only a one-way scrypt hash of the password is kept, never the password itself.
export const ADMIN_EMAIL = 'sabhijeet548@gmail.com';
const ADMIN_PASSWORD_HASH = 'scrypt$cecd74eaaab74bb20513b3f189d74b3b$124c30dc13eedc1cc734b00469e7831554905e315fb2345ed790f227b6f6727b8b47825247ea1567996fe104d6d5f8f248b91592da13e2717e7d903c6e448680';

export const SESSION_COOKIE = 'mr_session';
const SESSION_DAYS = 7;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

export function checkPassword(password, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(password), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

// A user can log in only between valid_from and valid_until.
export function isActive(u) {
  const now = Date.now();
  return !u.disabled && new Date(u.valid_from).getTime() <= now && new Date(u.valid_until).getTime() > now;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function newSession(userId, role) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3);
  await query('INSERT INTO app_sessions (token_hash, user_id, role, expires_at) VALUES ($1,$2,$3,$4)',
    [sha(token), userId, role, expires]);
  return { token, expires };
}

// Returns { token, expires, role } on success, { expired: true } for a user whose access ended,
// or null for a wrong email / password.
export async function login(email, password) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !password) return null;
  if (e === ADMIN_EMAIL) {
    if (!checkPassword(password, ADMIN_PASSWORD_HASH)) return null;
    return { ...(await newSession(null, 'admin')), role: 'admin' };
  }
  const u = await one('SELECT * FROM app_users WHERE lower(email) = $1', [e]);
  if (!u || !checkPassword(password, u.password_hash)) return null;
  if (!isActive(u)) return { expired: true };
  await query('UPDATE app_users SET last_login_at = now() WHERE id = $1', [u.id]);
  return { ...(await newSession(u.id, 'user')), role: 'user' };
}

// Looks up a session cookie. status: 'ok' | 'expired' | 'none'.
export async function getSession(token) {
  if (!token) return { status: 'none' };
  const s = await one(
    `SELECT s.role, s.expires_at, u.email, u.name, u.valid_from, u.valid_until, u.disabled
       FROM app_sessions s LEFT JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1`, [sha(token)]);
  if (!s || new Date(s.expires_at) <= new Date()) return { status: 'none' };
  if (s.role === 'admin') return { status: 'ok', role: 'admin', email: ADMIN_EMAIL };
  if (!s.email) return { status: 'none' }; // user was deleted
  if (!isActive(s)) return { status: 'expired' };
  return { status: 'ok', role: 'user', email: s.email, name: s.name, validUntil: s.valid_until };
}

export async function logout(token) {
  if (token) await query('DELETE FROM app_sessions WHERE token_hash = $1', [sha(token)]);
}

export function cookieOptions(expires) {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires };
}

// For admin API routes: throws 403 unless the request carries an admin session.
export async function requireAdmin(req) {
  const s = await getSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (s.status !== 'ok' || s.role !== 'admin') throw Object.assign(new Error('Admin only'), { status: 403 });
  return s;
}
