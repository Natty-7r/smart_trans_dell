'use strict';

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyPassword, createSession, destroySession, hashPassword, purgeExpiredSessions } = require('../auth');
const { requireAuth, bearer, getAllowedSiteIds } = require('../middleware/auth');
const { getDb } = require('../database');

// Permissions surfaced to the UI so it can hide/disable disallowed actions.
// (Server-side enforcement is independent — see middleware/auth.js.)
function permissionsFor(role) {
  return {
    manageUsers: role === 'admin',
    manageSites: role === 'admin',
    systemConfig: role === 'admin',
    manageSchedules: role === 'admin' || role === 'regional_manager',
    createEscalation: true,
    resolveEscalation: role === 'admin' || role === 'regional_manager',
    recordMaintenance: role === 'admin' || role === 'regional_manager' || role === 'field_technician',
    uploadDocuments: role === 'admin' || role === 'regional_manager',
    viewAllSites: role === 'admin',
    executiveDashboard: role === 'admin' || role === 'regional_manager'
  };
}

// POST /api/auth/login
router.post('/login', (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: { message: 'username and password are required', status: 400, timestamp: new Date().toISOString() } });
    }
    const user = User.findByUsername(username);
    if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: { message: 'Invalid credentials', status: 401, timestamp: new Date().toISOString() } });
    }
    purgeExpiredSessions();
    const { token, expiresAt } = createSession(user.user_id);
    User.recordLogin(user.user_id);
    const safe = User.findById(user.user_id);
    res.json({ token, expiresAt, user: { ...safe, permissions: permissionsFor(safe.role) } });
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  destroySession(bearer(req));
  res.json({ ok: true });
});

// GET /api/auth/me — current identity + permissions + allocated sites
router.get('/me', requireAuth, (req, res) => {
  const safe = User.findById(req.user.user_id);
  res.json({
    user: { ...safe, permissions: permissionsFor(safe.role) },
    allowedSiteIds: getAllowedSiteIds(req.user)  // null = all (admin)
  });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res, next) => {
  try {
    const { current, next: nextPw } = req.body || {};
    const row = getDb().prepare('SELECT password_hash FROM users WHERE user_id = ?').get(req.user.user_id);
    if (!row || !verifyPassword(current || '', row.password_hash)) {
      return res.status(400).json({ error: { message: 'Current password is incorrect', status: 400, timestamp: new Date().toISOString() } });
    }
    getDb().prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE user_id = ?")
      .run(hashPassword(nextPw), req.user.user_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.permissionsFor = permissionsFor;
