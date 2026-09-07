'use strict';

const crypto = require('crypto');
const { getDb } = require('../database');

const ESC_STATUSES = ['open', 'in_progress', 'resolved'];

function id(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

const Group = {
  listForUser(user) {
    const db = getDb();
    let rows;
    if (user && user.role === 'admin') {
      rows = db.prepare('SELECT * FROM collab_groups ORDER BY created_at DESC').all();
    } else {
      rows = db.prepare(`
        SELECT g.* FROM collab_groups g
        JOIN group_members m ON m.group_id = g.group_id
        WHERE m.user_id = ?
        ORDER BY g.created_at DESC
      `).all(user.user_id);
    }
    const memberCount = db.prepare('SELECT COUNT(*) c FROM group_members WHERE group_id = ?');
    const messageCount = db.prepare('SELECT COUNT(*) c FROM group_messages WHERE group_id = ?');
    const openEsc = db.prepare("SELECT COUNT(*) c FROM escalations WHERE group_id = ? AND status != 'resolved'");
    return rows.map(g => ({
      ...g,
      member_count: memberCount.get(g.group_id).c,
      message_count: messageCount.get(g.group_id).c,
      open_escalations: openEsc.get(g.group_id).c
    }));
  },

  findById(groupId) {
    const db = getDb();
    const g = db.prepare('SELECT * FROM collab_groups WHERE group_id = ?').get(groupId);
    if (!g) return null;
    g.members = db.prepare(`
      SELECT m.user_id, m.role_in_group, m.joined_at, u.full_name, u.role
      FROM group_members m
      LEFT JOIN users u ON u.user_id = m.user_id
      WHERE m.group_id = ?
      ORDER BY m.joined_at ASC
    `).all(groupId);
    g.member_count = g.members.length;
    g.message_count = db.prepare('SELECT COUNT(*) c FROM group_messages WHERE group_id = ?').get(groupId).c;
    g.open_escalations = db.prepare("SELECT COUNT(*) c FROM escalations WHERE group_id = ? AND status != 'resolved'").get(groupId).c;
    return g;
  },

  isMember(groupId, userId) {
    const row = getDb().prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    return !!row;
  },

  create({ name, description, scope_type, scope_value, created_by }) {
    const db = getDb();
    if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
    const type = scope_type || 'region';
    if (!['region', 'site'].includes(type)) {
      throw Object.assign(new Error("scope_type must be 'region' or 'site'"), { status: 400 });
    }
    if (!scope_value) throw Object.assign(new Error('scope_value is required'), { status: 400 });
    const groupId = id('GRP');
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO collab_groups (group_id, name, description, scope_type, scope_value, created_by)
        VALUES (@group_id,@name,@description,@scope_type,@scope_value,@created_by)
      `).run({
        group_id: groupId, name, description: description || null,
        scope_type: type, scope_value, created_by: created_by || null
      });
      const addMember = db.prepare(`
        INSERT OR IGNORE INTO group_members (group_id, user_id, role_in_group) VALUES (?,?,?)
      `);
      if (created_by) addMember.run(groupId, created_by, 'owner');
      if (type === 'region') {
        const users = db.prepare(`
          SELECT DISTINCT u.user_id FROM users u
          WHERE u.region = @region
             OR u.user_id IN (
               SELECT us.user_id FROM user_sites us
               JOIN transformer_sites s ON s.site_id = us.site_id
               WHERE s.region = @region
             )
        `).all({ region: scope_value });
        for (const u of users) {
          if (u.user_id === created_by) continue;
          addMember.run(groupId, u.user_id, 'member');
        }
      }
    });
    tx();
    return Group.findById(groupId);
  },

  addMember(groupId, userId, roleInGroup = 'member') {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO group_members (group_id, user_id, role_in_group) VALUES (?,?,?)
    `).run(groupId, userId, roleInGroup);
    return Group.findById(groupId);
  },

  removeMember(groupId, userId) {
    getDb().prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
    return Group.findById(groupId);
  },

  listMessages(groupId, { parentId } = {}) {
    const db = getDb();
    if (parentId) {
      return db.prepare(`
        SELECT * FROM group_messages WHERE group_id = ? AND parent_id = ? ORDER BY created_at ASC
      `).all(groupId, parentId);
    }
    return db.prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at ASC').all(groupId);
  },

  addMessage({ groupId, parentId, userId, authorName, body }) {
    const db = getDb();
    if (!body) throw Object.assign(new Error('body is required'), { status: 400 });
    const messageId = id('MSG');
    db.prepare(`
      INSERT INTO group_messages (message_id, group_id, parent_id, user_id, author_name, body)
      VALUES (@message_id,@group_id,@parent_id,@user_id,@author_name,@body)
    `).run({
      message_id: messageId, group_id: groupId, parent_id: parentId || null,
      user_id: userId, author_name: authorName || null, body
    });
    return db.prepare('SELECT * FROM group_messages WHERE message_id = ?').get(messageId);
  },

  listFiles(groupId) {
    return getDb().prepare('SELECT * FROM group_files WHERE group_id = ? ORDER BY created_at DESC').all(groupId);
  },

  addFile({ groupId, userId, uploaderName, filename, originalName, mimeType, sizeBytes, path, description }) {
    const db = getDb();
    const fileId = id('FILE');
    db.prepare(`
      INSERT INTO group_files (file_id, group_id, user_id, uploader_name, filename, original_name, mime_type, size_bytes, path, description)
      VALUES (@file_id,@group_id,@user_id,@uploader_name,@filename,@original_name,@mime_type,@size_bytes,@path,@description)
    `).run({
      file_id: fileId, group_id: groupId, user_id: userId || null, uploader_name: uploaderName || null,
      filename, original_name: originalName || null, mime_type: mimeType || null,
      size_bytes: sizeBytes || null, path, description: description || null
    });
    return db.prepare('SELECT * FROM group_files WHERE file_id = ?').get(fileId);
  },

  getFile(fileId) {
    return getDb().prepare('SELECT * FROM group_files WHERE file_id = ?').get(fileId) || null;
  },

  listEscalations({ status, groupId, siteId, allowedSiteIds } = {}) {
    const db = getDb();
    const conditions = [];
    const params = {};
    if (status) { conditions.push('status = @status'); params.status = status; }
    if (groupId) { conditions.push('group_id = @group_id'); params.group_id = groupId; }
    if (siteId) { conditions.push('site_id = @site_id'); params.site_id = siteId; }
    if (Array.isArray(allowedSiteIds)) {
      if (allowedSiteIds.length) {
        const placeholders = allowedSiteIds.map((_, i) => `@site_${i}`);
        allowedSiteIds.forEach((sid, i) => { params[`site_${i}`] = sid; });
        conditions.push(`(site_id IS NULL OR site_id IN (${placeholders.join(', ')}))`);
      } else {
        conditions.push('site_id IS NULL');
      }
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    return db.prepare(`SELECT * FROM escalations ${where} ORDER BY created_at DESC`).all(params);
  },

  createEscalation(data) {
    const db = getDb();
    if (!data.title) throw Object.assign(new Error('title is required'), { status: 400 });
    if (data.priority && !['low', 'medium', 'high', 'critical'].includes(data.priority)) {
      throw Object.assign(new Error('invalid priority'), { status: 400 });
    }
    const escalationId = id('ESC');
    db.prepare(`
      INSERT INTO escalations (escalation_id, group_id, site_id, alert_id, fault_id, title, description, priority, status, raised_by, raised_by_name, assigned_to_role, assigned_to_user)
      VALUES (@escalation_id,@group_id,@site_id,@alert_id,@fault_id,@title,@description,@priority,'open',@raised_by,@raised_by_name,@assigned_to_role,@assigned_to_user)
    `).run({
      escalation_id: escalationId,
      group_id: data.group_id || null,
      site_id: data.site_id || null,
      alert_id: data.alert_id || null,
      fault_id: data.fault_id || null,
      title: data.title,
      description: data.description || null,
      priority: data.priority || 'medium',
      raised_by: data.raisedBy || null,
      raised_by_name: data.raisedByName || null,
      assigned_to_role: data.assigned_to_role || null,
      assigned_to_user: data.assigned_to_user || null
    });
    return Group.getEscalation(escalationId);
  },

  updateEscalation(escalationId, data) {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM escalations WHERE escalation_id = ?').get(escalationId);
    if (!existing) throw Object.assign(new Error('Escalation not found'), { status: 404 });
    const fields = [];
    const params = { escalation_id: escalationId };
    if (data.status !== undefined) {
      if (!ESC_STATUSES.includes(data.status)) {
        throw Object.assign(new Error(`status must be one of ${ESC_STATUSES.join(', ')}`), { status: 400 });
      }
      fields.push('status = @status'); params.status = data.status;
      if (data.status === 'resolved') fields.push("resolved_at = datetime('now')");
    }
    for (const f of ['resolution_notes', 'assigned_to_user', 'assigned_to_role']) {
      if (data[f] !== undefined) { fields.push(`${f} = @${f}`); params[f] = data[f]; }
    }
    fields.push("updated_at = datetime('now')");
    db.prepare(`UPDATE escalations SET ${fields.join(', ')} WHERE escalation_id = @escalation_id`).run(params);
    return Group.getEscalation(escalationId);
  },

  getEscalation(escalationId) {
    return getDb().prepare('SELECT * FROM escalations WHERE escalation_id = ?').get(escalationId) || null;
  },

  getStats() {
    const db = getDb();
    return {
      totalGroups: db.prepare('SELECT COUNT(*) c FROM collab_groups').get().c,
      totalMessages: db.prepare('SELECT COUNT(*) c FROM group_messages').get().c,
      openEscalations: db.prepare("SELECT COUNT(*) c FROM escalations WHERE status != 'resolved'").get().c
    };
  }
};

module.exports = Group;
