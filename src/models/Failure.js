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
  if (filters.region) {
    conditions.push('region = @region');
    params.region = filters.region;
  }
  if (filters.resolution_status) {
    conditions.push('resolution_status = @resolution_status');
    params.resolution_status = filters.resolution_status;
  }
  if (filters.severity) {
    conditions.push('severity = @severity');
    params.severity = filters.severity;
  }
  if (filters.search) {
    conditions.push('(failure_id LIKE @search OR site_name LIKE @search OR failure_type LIKE @search OR component LIKE @search OR root_cause LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

const SORTABLE = new Set([
  'created_at', 'occurred_at', 'detected_at', 'severity', 'resolution_status',
  'downtime_hours', 'cost_usd', 'site_name', 'region', 'failure_id'
]);

const Failure = {
  findAll(filters = {}) {
    const db = getDb();
    const limit = Math.min(parseInt(filters.limit) || 50, 500);
    const offset = parseInt(filters.offset) || 0;
    const orderBy = SORTABLE.has(filters.orderBy) ? filters.orderBy : 'created_at';
    const orderDir = filters.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const { where, params } = buildWhereClause(filters);

    const rows = db.prepare(`
      SELECT * FROM failures
      ${where}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    const total = db.prepare(`SELECT COUNT(*) as c FROM failures ${where}`).get(params).c;

    return { data: rows, total, limit, offset };
  },

  findById(failureId) {
    return getDb().prepare('SELECT * FROM failures WHERE failure_id = ?').get(failureId) || null;
  },

  create(data) {
    const db = getDb();
    if (!data.site_id) throw Object.assign(new Error('site_id is required'), { status: 400 });
    if (!data.failure_type) throw Object.assign(new Error('failure_type is required'), { status: 400 });

    const site = db.prepare('SELECT site_id, name AS site_name, region FROM transformer_sites WHERE site_id = ?').get(data.site_id);
    if (!site) throw Object.assign(new Error('site_id does not exist'), { status: 400 });

    const failureId = data.failure_id || `FAIL-${crypto.randomBytes(5).toString('hex')}`;

    db.prepare(`
      INSERT INTO failures
        (failure_id, site_id, site_name, region, schedule_id, fault_id, failure_type, component,
         severity, occurred_at, detected_at, root_cause, resolution, resolution_status,
         downtime_hours, cost_usd, parts_replaced, confirmed_by)
      VALUES
        (@failure_id, @site_id, @site_name, @region, @schedule_id, @fault_id, @failure_type, @component,
         @severity, @occurred_at, @detected_at, @root_cause, @resolution, @resolution_status,
         @downtime_hours, @cost_usd, @parts_replaced, @confirmed_by)
    `).run({
      failure_id: failureId,
      site_id: site.site_id,
      site_name: site.site_name || null,
      region: site.region || null,
      schedule_id: data.schedule_id || null,
      fault_id: data.fault_id || null,
      failure_type: data.failure_type,
      component: data.component || null,
      severity: data.severity || 'high',
      occurred_at: data.occurred_at || null,
      detected_at: data.detected_at || null,
      root_cause: data.root_cause || null,
      resolution: data.resolution || null,
      resolution_status: data.resolution_status || 'open',
      downtime_hours: data.downtime_hours != null ? data.downtime_hours : 0,
      cost_usd: data.cost_usd != null ? data.cost_usd : 0,
      parts_replaced: data.parts_replaced || null,
      confirmed_by: data.confirmed_by || null
    });

    // Link the originating fault event to this failure record.
    if (data.fault_id) {
      db.prepare('UPDATE fault_events SET failure_id = ? WHERE fault_id = ?').run(failureId, data.fault_id);
    }

    return this.findById(failureId);
  },

  update(id, data) {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) throw Object.assign(new Error('Failure not found'), { status: 404 });

    const fields = [];
    const params = { failure_id: id };
    const editable = [
      'root_cause', 'resolution', 'resolution_status', 'downtime_hours',
      'cost_usd', 'parts_replaced', 'component'
    ];
    for (const f of editable) {
      if (data[f] !== undefined) { fields.push(`${f} = @${f}`); params[f] = data[f]; }
    }
    if (fields.length) {
      db.prepare(`UPDATE failures SET ${fields.join(', ')} WHERE failure_id = @failure_id`).run(params);
    }
    return this.findById(id);
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

    const row = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN resolution_status = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN resolution_status = 'resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(downtime_hours) as totalDowntimeHours,
        SUM(cost_usd) as totalCostUsd
      FROM failures
      ${where}
    `).get(params);

    return {
      total: row.total || 0,
      open: row.open || 0,
      resolved: row.resolved || 0,
      totalDowntimeHours: row.totalDowntimeHours || 0,
      totalCostUsd: row.totalCostUsd || 0
    };
  }
};

module.exports = Failure;
