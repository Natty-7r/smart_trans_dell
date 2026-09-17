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
  'priority', 'task_type', 'site_name', 'region', 'schedule_id',
  'estimated_cost_usd', 'last_actual_cost_usd', 'total_saved_usd'
]);

function parseMoney(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw Object.assign(new Error(`${field} must be a non-negative number`), { status: 400 });
  }
  return Math.round(n * 100) / 100;
}

function resolveEngineer(db, data) {
  const engId = data.assigned_engineer_id || null;
  if (!engId) {
    return { assigned_engineer_id: null, assigned_engineer_name: data.assigned_engineer_name || null };
  }
  const eng = db.prepare('SELECT engineer_id, full_name FROM field_engineers WHERE engineer_id = ?').get(engId);
  if (!eng) throw Object.assign(new Error('assigned_engineer_id does not exist'), { status: 400 });
  return { assigned_engineer_id: eng.engineer_id, assigned_engineer_name: eng.full_name };
}

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
    const engineer = resolveEngineer(db, data);
    const estimated = parseMoney(data.estimated_cost_usd, 'estimated_cost_usd');

    db.prepare(`
      INSERT INTO maintenance_schedules
        (schedule_id, site_id, site_name, region, title, task_type, frequency, interval_days,
         last_completed_date, next_due_date, assigned_engineer_id, assigned_engineer_name,
         priority, status, description, created_by, estimated_cost_usd)
      VALUES
        (@schedule_id, @site_id, @site_name, @region, @title, @task_type, @frequency, @interval_days,
         @last_completed_date, @next_due_date, @assigned_engineer_id, @assigned_engineer_name,
         @priority, @status, @description, @created_by, @estimated_cost_usd)
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
      assigned_engineer_id: engineer.assigned_engineer_id,
      assigned_engineer_name: engineer.assigned_engineer_name,
      priority: data.priority || 'medium',
      status: data.status || 'active',
      description: data.description || null,
      created_by: data.created_by || null,
      estimated_cost_usd: estimated
    });

    return this.findById(scheduleId);
  },

  update(id, data) {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) throw Object.assign(new Error('Maintenance schedule not found'), { status: 404 });

    const fields = [];
    const params = { schedule_id: id };
    const patch = { ...data };
    if (data.assigned_engineer_id !== undefined) {
      Object.assign(patch, resolveEngineer(db, data));
    }
    if (data.estimated_cost_usd !== undefined) {
      patch.estimated_cost_usd = parseMoney(data.estimated_cost_usd, 'estimated_cost_usd');
    }

    const editable = [
      'title', 'task_type', 'frequency', 'interval_days', 'next_due_date',
      'last_completed_date', 'assigned_engineer_id', 'assigned_engineer_name',
      'priority', 'status', 'description', 'estimated_cost_usd'
    ];
    for (const f of editable) {
      if (patch[f] !== undefined) { fields.push(`${f} = @${f}`); params[f] = patch[f]; }
    }
    if (fields.length) {
      db.prepare(`UPDATE maintenance_schedules SET ${fields.join(', ')} WHERE schedule_id = @schedule_id`).run(params);
    }
    return this.findById(id);
  },

  complete(id, extra = {}) {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) throw Object.assign(new Error('Maintenance schedule not found'), { status: 404 });

    const actual = parseMoney(extra.actual_cost_usd, 'actual_cost_usd');
    if (actual == null) {
      throw Object.assign(new Error('actual_cost_usd is required to complete maintenance'), { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const intervalDays = parseInt(existing.interval_days) || 90;
    const next = new Date(Date.now() + intervalDays * 86400000).toISOString().slice(0, 10);
    const estimated = Number(existing.estimated_cost_usd) || 0;
    const savedThis = Math.round((estimated - actual) * 100) / 100;

    let engineer = {
      assigned_engineer_id: existing.assigned_engineer_id,
      assigned_engineer_name: existing.assigned_engineer_name
    };
    if (extra.assigned_engineer_id) {
      engineer = resolveEngineer(db, extra);
    }

    const recordId = `MR-${crypto.randomBytes(5).toString('hex')}`;
    const findings = extra.notes || extra.findings ||
      `Completed scheduled visit. Estimated $${estimated.toLocaleString()} vs actual $${actual.toLocaleString()} (${savedThis >= 0 ? 'saved' : 'over'} $${Math.abs(savedThis).toLocaleString()}).`;

    db.transaction(() => {
      db.prepare(`
        UPDATE maintenance_schedules
        SET last_completed_date = @today,
            next_due_date = @next,
            status = 'active',
            assigned_engineer_id = COALESCE(@assigned_engineer_id, assigned_engineer_id),
            assigned_engineer_name = COALESCE(@assigned_engineer_name, assigned_engineer_name),
            last_actual_cost_usd = @actual,
            total_estimated_cost_usd = COALESCE(total_estimated_cost_usd, 0) + @estimated,
            total_actual_cost_usd = COALESCE(total_actual_cost_usd, 0) + @actual,
            total_saved_usd = COALESCE(total_saved_usd, 0) + @saved
        WHERE schedule_id = @schedule_id
      `).run({
        today, next, schedule_id: id,
        assigned_engineer_id: engineer.assigned_engineer_id,
        assigned_engineer_name: engineer.assigned_engineer_name,
        actual, estimated, saved: savedThis
      });

      db.prepare(`
        INSERT INTO maintenance_records
          (record_id, site_id, site_name, region, engineer_id, engineer_name, classification,
           maintenance_date, cost_usd, estimated_cost_usd, primary_task, duration_hours, status,
           findings, next_scheduled_date, iso55000_compliant, schedule_id, work_order_id)
        VALUES
          (@record_id, @site_id, @site_name, @region, @engineer_id, @engineer_name, 'planned',
           @maintenance_date, @cost_usd, @estimated_cost_usd, @primary_task, @duration_hours, 'completed',
           @findings, @next_scheduled_date, 1, @schedule_id, @work_order_id)
      `).run({
        record_id: recordId,
        site_id: existing.site_id,
        site_name: existing.site_name,
        region: existing.region,
        engineer_id: engineer.assigned_engineer_id,
        engineer_name: engineer.assigned_engineer_name,
        maintenance_date: today,
        cost_usd: actual,
        estimated_cost_usd: estimated,
        primary_task: existing.title || 'Scheduled preventive maintenance',
        duration_hours: extra.duration_hours != null ? Number(extra.duration_hours) : null,
        findings,
        next_scheduled_date: next,
        schedule_id: id,
        work_order_id: extra.work_order_id || `WO-${id}-${today}`
      });
    })();

    const updated = this.findById(id);
    updated.completion = {
      record_id: recordId,
      estimated_cost_usd: estimated,
      actual_cost_usd: actual,
      saved_usd: savedThis
    };
    return updated;
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
             status, task_type, assigned_engineer_id, assigned_engineer_name,
             estimated_cost_usd, last_actual_cost_usd, total_saved_usd
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
        SUM(CASE WHEN status = 'active' AND next_due_date IS NOT NULL AND next_due_date >= @today AND next_due_date <= @soon THEN 1 ELSE 0 END) as dueSoon,
        SUM(CASE WHEN status = 'active' THEN COALESCE(estimated_cost_usd, 0) ELSE 0 END) as openEstimatedUsd,
        SUM(COALESCE(total_actual_cost_usd, 0)) as actualSpendUsd,
        SUM(COALESCE(total_estimated_cost_usd, 0)) as completedEstimatedUsd,
        SUM(COALESCE(total_saved_usd, 0)) as savedUsd
      FROM maintenance_schedules
      ${where}
    `).get({ ...params, today, soon });

    return {
      total: row.total || 0,
      active: row.active || 0,
      overdue: row.overdue || 0,
      dueSoon: row.dueSoon || 0,
      openEstimatedUsd: Math.round(row.openEstimatedUsd || 0),
      actualSpendUsd: Math.round(row.actualSpendUsd || 0),
      completedEstimatedUsd: Math.round(row.completedEstimatedUsd || 0),
      savedUsd: Math.round(row.savedUsd || 0)
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
