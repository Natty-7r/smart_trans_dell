'use strict';

const crypto = require('crypto');
const { getDb } = require('../database');
const { hashPassword } = require('../auth');

const PUBLIC_COLS = 'user_id, username, email, full_name, role, region, engineer_id, phone, status, last_login, created_at, updated_at';
const ROLES = ['admin', 'regional_manager', 'field_technician'];

const User = {
  findAll(filters = {}) {
    const db = getDb();
    const conditions = [];
    const params = {};
    if (filters.role) { conditions.push('role = @role'); params.role = filters.role; }
    if (filters.region) { conditions.push('region = @region'); params.region = filters.region; }
    if (filters.status) { conditions.push('status = @status'); params.status = filters.status; }
    if (filters.search) {
      conditions.push('(username LIKE @s OR full_name LIKE @s OR email LIKE @s)');
      params.s = `%${filters.search}%`;
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = db.prepare(`SELECT ${PUBLIC_COLS} FROM users ${where} ORDER BY role, full_name`).all(params);
    // attach site allocations
    const sitesStmt = db.prepare('SELECT site_id FROM user_sites WHERE user_id = ?');
    return rows.map(u => ({ ...u, site_ids: sitesStmt.all(u.user_id).map(r => r.site_id) }));
  },

  findById(userId) {
    const db = getDb();
    const u = db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE user_id = ?`).get(userId);
    if (!u) return null;
    u.site_ids = db.prepare('SELECT site_id FROM user_sites WHERE user_id = ?').all(userId).map(r => r.site_id);
    return u;
  },

  findByUsername(username) {
    return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
  },

  create(data) {
    const db = getDb();
    if (!data.username || !data.password) {
      throw Object.assign(new Error('username and password are required'), { status: 400 });
    }
    if (!ROLES.includes(data.role)) {
      throw Object.assign(new Error(`role must be one of ${ROLES.join(', ')}`), { status: 400 });
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(data.username)) {
      throw Object.assign(new Error('username already exists'), { status: 409 });
    }
    const userId = data.user_id || `USR-${crypto.randomBytes(5).toString('hex')}`;
    db.prepare(`
      INSERT INTO users (user_id, username, email, full_name, password_hash, role, region, engineer_id, phone, status, created_by)
      VALUES (@user_id,@username,@email,@full_name,@password_hash,@role,@region,@engineer_id,@phone,'active',@created_by)
    `).run({
      user_id: userId, username: data.username, email: data.email || null, full_name: data.full_name || data.username,
      password_hash: hashPassword(data.password), role: data.role, region: data.region || null,
      engineer_id: data.engineer_id || null, phone: data.phone || null, created_by: data.created_by || null
    });
    if (Array.isArray(data.site_ids)) User.setSites(userId, data.site_ids, data.created_by);
    return User.findById(userId);
  },

  update(userId, data) {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!existing) throw Object.assign(new Error('User not found'), { status: 404 });
    const fields = [];
    const params = { user_id: userId };
    for (const f of ['email', 'full_name', 'region', 'phone']) {
      if (data[f] !== undefined) { fields.push(`${f} = @${f}`); params[f] = data[f]; }
    }
    if (data.role !== undefined) {
      if (!ROLES.includes(data.role)) throw Object.assign(new Error('invalid role'), { status: 400 });
      fields.push('role = @role'); params.role = data.role;
    }
    if (data.status !== undefined) {
      if (!['active', 'inactive'].includes(data.status)) throw Object.assign(new Error('invalid status'), { status: 400 });
      fields.push('status = @status'); params.status = data.status;
    }
    if (data.password) { fields.push('password_hash = @password_hash'); params.password_hash = hashPassword(data.password); }
    fields.push("updated_at = datetime('now')");
    if (fields.length) db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE user_id = @user_id`).run(params);
    if (Array.isArray(data.site_ids)) User.setSites(userId, data.site_ids, data.updated_by);
    return User.findById(userId);
  },

  deactivate(userId) {
    const db = getDb();
    db.prepare("UPDATE users SET status = 'inactive', updated_at = datetime('now') WHERE user_id = ?").run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); // revoke tokens
    return User.findById(userId);
  },

  setSites(userId, siteIds, byUser) {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM user_sites WHERE user_id = ?').run(userId);
      const ins = db.prepare('INSERT OR IGNORE INTO user_sites (user_id, site_id, allocated_by) VALUES (?,?,?)');
      for (const sid of siteIds) ins.run(userId, sid, byUser || null);
    });
    tx();
  },

  recordLogin(userId) {
    getDb().prepare("UPDATE users SET last_login = datetime('now') WHERE user_id = ?").run(userId);
  },

  getStats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) c FROM users').get().c,
      byRole: db.prepare('SELECT role, COUNT(*) count FROM users GROUP BY role').all(),
      active: db.prepare("SELECT COUNT(*) c FROM users WHERE status = 'active'").get().c
    };
  }
};

module.exports = User;
module.exports.ROLES = ROLES;
