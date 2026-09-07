'use strict';

const crypto = require('crypto');
const { getDb } = require('../database');

function buildWhereClause(filters) {
  const conditions = [];
  const params = {};

  // Site-scoping (RBAC): restrict to an allowed set of sites when provided.
  if (Array.isArray(filters.siteIds)) {
    if (filters.siteIds.length === 0) {
      conditions.push('1 = 0');
    } else {
      const ph = filters.siteIds.map((_, i) => `@__sid${i}`).join(',');
      conditions.push(`site_id IN (${ph})`);
      filters.siteIds.forEach((s, i) => { params[`__sid${i}`] = s; });
    }
  }

  if (filters.site_id) {
    conditions.push('site_id = @site_id');
    params.site_id = filters.site_id;
  }
  if (filters.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters.region) {
    conditions.push('region = @region');
    params.region = filters.region;
  }
  if (filters.task_type) {
    conditions.push('task_type = @task_type');
    params.task_type = filters.task_type;
  }
  if (filters.priority) {
    conditions.push('priority = @priority');
    params.priority = filters.priority;
  }
  if (filters.due_before) {
    conditions.push('next_due_date <= @due_before');
    params.due_before = filters.due_before;
  }
  if (filters.search) {
    conditions.push('(schedule_id LIKE @search OR site_name LIKE @search OR title LIKE @search OR assigned_engineer_name LIKE @search OR description LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

const SORTABLE = new Set([
  'next_due_date', 'last_completed_date', 'created_at', 'title', 'status',
  'priority', 'task_type', 'site_name', 'region', 'schedule_id'
]);

const MaintenanceSchedule = {
  findAll(filters = {}) {
    const db = getDb();
    const limit = Math.min(parseInt(filters.limit) || 50, 500);
    const offset = parseInt(filters.offset) || 0;
    const orderBy = SORTABLE.has(filters.orderBy) ? filters.orderBy : 'next_due_date';
    const orderDir = filters.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const { where, params } = buildWhereClause(filters);

    const rows = db.prepare(`
      SELECT * FROM maintenance_schedules
      ${where}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    const total = db.prepare(`SELECT COUNT(*) as c FROM maintenance_schedules ${where}`).get(params).c;

    return { data: rows, total, limit, offset };
  },

  findById(scheduleId) {
    return getDb().prepare('SELECT * FROM maintenance_schedules WHERE schedule_id = ?').get(scheduleId) || null;
  },

  create(data) {
    const db = getDb();
    if (!data.site_id) throw Object.assign(new Error('site_id is required'), { status: 400 });
    if (!data.title) throw Object.assign(new Error('title is required'), { status: 400 });

    const site = db.prepare('SELECT site_id, name AS site_name, region FROM transformer_sites WHERE site_id = ?').get(data.site_id);
    if (!site) throw Object.assign(new Error('site_id does not exist'), { status: 400 });

    const scheduleId = data.schedule_id || `SCH-${crypto.randomBytes(5).toString('hex')}`;
    const intervalDays = data.interval_days != null ? parseInt(data.interval_days) : 90;

    db.prepare(`
      INSERT INTO maintenance_schedules
        (schedule_id, site_id, site_name, region, title, task_type, frequency, interval_days,
         last_completed_date, next_due_date, assigned_engineer_id, assigned_engineer_name,
         priority, status, description, created_by)
      VALUES
        (@schedule_id, @site_id, @site_name, @region, @title, @task_type, @frequency, @interval_days,
         @last_completed_date, @next_due_date, @assigned_engineer_id, @assigned_engineer_name,
         @priority, @status, @description, @created_by)
    `).run({
      schedule_id: scheduleId,
      site_id: site.site_id,
      site_name: site.site_name || null,
      region: site.region || null,
      title: data.title,
      task_type: data.task_type || 'preventive',
      frequency: data.frequency || null,
      interval_days: intervalDays,
      last_completed_date: data.last_completed_date || null,
      next_due_date: data.next_due_date || null,
      assigned_engineer_id: data.assigned_engineer_id || null,
      assigned_engineer_name: data.assigned_engineer_name || null,
      priority: data.priority || 'medium',
      status: data.status || 'active',
      description: data.description || null,
      created_by: data.created_by || null
    });

    return this.findById(scheduleId);
  },

  update(id, data) {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) throw Object.assign(new Error('Maintenance schedule not found'), { status: 404 });

    const fields = [];
    const params = { schedule_id: id };
    const editable = [
      'title', 'task_type', 'frequency', 'interval_days', 'next_due_date',
      'last_completed_date', 'assigned_engineer_id', 'assigned_engineer_name',
      'priority', 'status', 'description'
    ];
    for (const f of editable) {
      if (data[f] !== undefined) { fields.push(`${f} = @${f}`); params[f] = data[f]; }
    }
    if (fields.length) {
      db.prepare(`UPDATE maintenance_schedules SET ${fields.join(', ')} WHERE schedule_id = @schedule_id`).run(params);
    }
    return this.findById(id);
  },

  complete(id) {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) throw Object.assign(new Error('Maintenance schedule not found'), { status: 404 });

    const today = new Date().toISOString().slice(0, 10);
    const intervalDays = parseInt(existing.interval_days) || 90;
    const next = new Date(Date.now() + intervalDays * 86400000).toISOString().slice(0, 10);

    db.prepare(`
      UPDATE maintenance_schedules
      SET last_completed_date = @today, next_due_date = @next, status = 'active'
      WHERE schedule_id = @schedule_id
    `).run({ today, next, schedule_id: id });

    return this.findById(id);
  },

  calendar({ from, to, siteIds } = {}) {
    const db = getDb();
    const conditions = ['next_due_date IS NOT NULL', 'next_due_date >= @from', 'next_due_date <= @to'];
    const params = { from, to };

    if (Array.isArray(siteIds)) {
      if (siteIds.length === 0) {
        conditions.push('1 = 0');
      } else {
        const ph = siteIds.map((_, i) => `@__sid${i}`).join(',');
        conditions.push(`site_id IN (${ph})`);
        siteIds.forEach((s, i) => { params[`__sid${i}`] = s; });
      }
    }

    return db.prepare(`
      SELECT schedule_id, site_id, site_name, region, title, next_due_date, priority,
             status, task_type, assigned_engineer_name
      FROM maintenance_schedules
      WHERE ${conditions.join(' AND ')}
      ORDER BY next_due_date ASC
    `).all(params);
  },

  getStats({ siteIds } = {}) {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (Array.isArray(siteIds)) {
      if (siteIds.length === 0) {
        conditions.push('1 = 0');
      } else {
        const ph = siteIds.map((_, i) => `@__sid${i}`).join(',');
        conditions.push(`site_id IN (${ph})`);
        siteIds.forEach((s, i) => { params[`__sid${i}`] = s; });
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const row = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'active' AND next_due_date IS NOT NULL AND next_due_date < @today THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN status = 'active' AND next_due_date IS NOT NULL AND next_due_date >= @today AND next_due_date <= @soon THEN 1 ELSE 0 END) as dueSoon
      FROM maintenance_schedules
      ${where}
    `).get({ ...params, today, soon });

    return {
      total: row.total || 0,
      active: row.active || 0,
      overdue: row.overdue || 0,
      dueSoon: row.dueSoon || 0
    };
  },

  upcoming(days = 30, siteIds) {
    const db = getDb();
    const conditions = [
      "status = 'active'",
      'next_due_date IS NOT NULL',
      'next_due_date >= @today',
      'next_due_date <= @limit'
    ];
    const today = new Date().toISOString().slice(0, 10);
    const limitDate = new Date(Date.now() + parseInt(days) * 86400000).toISOString().slice(0, 10);
    const params = { today, limit: limitDate };

    if (Array.isArray(siteIds)) {
      if (siteIds.length === 0) {
        conditions.push('1 = 0');
      } else {
        const ph = siteIds.map((_, i) => `@__sid${i}`).join(',');
        conditions.push(`site_id IN (${ph})`);
        siteIds.forEach((s, i) => { params[`__sid${i}`] = s; });
      }
    }

    return db.prepare(`
      SELECT * FROM maintenance_schedules
      WHERE ${conditions.join(' AND ')}
      ORDER BY next_due_date ASC
    `).all(params);
  }
};

module.exports = MaintenanceSchedule;
