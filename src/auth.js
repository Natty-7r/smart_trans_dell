'use strict';

/**
 * auth.js — authentication primitives for the platform.
 *
 * Zero external dependencies: password hashing uses Node's built-in
 * crypto.scrypt (memory-hard KDF), sessions are opaque 256-bit random tokens
 * persisted in the `sessions` table. Kept deliberately small and swappable so a
 * production deployment can drop in an IdP / OIDC provider behind the same
 * verifyToken()/login() surface.
 */

const crypto = require('crypto');
const { getDb } = require('./database');

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

// ─────────────────────────────────────────────────────────────
// Password hashing (scrypt) — format: scrypt$<saltHex>$<hashHex>
// ─────────────────────────────────────────────────────────────
function hashPassword(password) {
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 });
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    if (!stored || typeof stored !== 'string') return false;
    const [scheme, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password || '', salt, expected.length);
    return crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Sessions (opaque bearer tokens)
// ─────────────────────────────────────────────────────────────
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  getDb().prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(token, userId, new Date(now).toISOString(), expiresAt);
  return { token, expiresAt };
}

/** Resolve a bearer token to a live, non-expired user row (or null). */
function verifyToken(token) {
  if (!token) return null;
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = db.prepare(`
    SELECT user_id, username, email, full_name, role, region, status, created_at
    FROM users WHERE user_id = ?
  `).get(session.user_id);
  if (!user || user.status !== 'active') return null;
  return user;
}

function destroySession(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function destroyAllUserSessions(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Best-effort purge of expired sessions (called opportunistically). */
function purgeExpiredSessions() {
  try {
    getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  } catch (_) {}
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  verifyToken,
  destroySession,
  destroyAllUserSessions,
  purgeExpiredSessions,
  SESSION_TTL_MS
};
