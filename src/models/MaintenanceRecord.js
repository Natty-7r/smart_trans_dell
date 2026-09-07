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
  if (filters.engineer_id) {
    conditions.push('engineer_id = @engineer_id');
    params.engineer_id = filters.engineer_id;
  }
  if (filters.classification) {
    conditions.push('classification = @classification');
    params.classification = filters.classification;
  }
  if (filters.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters.region) {
    conditions.push('region = @region');
    params.region = filters.region;
  }
  if (filters.iso55000_compliant !== undefined) {
    conditions.push('iso55000_compliant = @iso55000_compliant');
    params.iso55000_compliant = filters.iso55000_compliant ? 1 : 0;
  }
  if (filters.eca_audit_trail !== undefined) {
    conditions.push('eca_audit_trail = @eca_audit_trail');
    params.eca_audit_trail = filters.eca_audit_trail ? 1 : 0;
  }
  if (filters.from) {
    conditions.push('maintenance_date >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push('maintenance_date <= @to');
    params.to = filters.to;
  }
  if (filters.cost_min !== undefined) {
    conditions.push('cost_usd >= @cost_min');
    params.cost_min = filters.cost_min;
  }
  if (filters.cost_max !== undefined) {
    conditions.push('cost_usd <= @cost_max');
    params.cost_max = filters.cost_max;
  }
  if (filters.search) {
    conditions.push('(record_id LIKE @search OR site_name LIKE @search OR engineer_name LIKE @search OR primary_task LIKE @search OR work_order_id LIKE @search OR findings LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

const SORTABLE = new Set([
  'maintenance_date', 'cost_usd', 'duration_hours', 'classification',
  'status', 'site_name', 'engineer_name', 'region', 'record_id'
]);

const MaintenanceRecord = {
  findAll(filters = {}) {
    const db = getDb();
    const limit = Math.min(parseInt(filters.limit) || 50, 500);
    const offset = parseInt(filters.offset) || 0;
    const orderBy = SORTABLE.has(filters.orderBy) ? filters.orderBy : 'maintenance_date';
    const orderDir = filters.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const { where, params } = buildWhereClause(filters);

    const rows = db.prepare(`
      SELECT * FROM maintenance_records
      ${where}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    const total = db.prepare(`SELECT COUNT(*) as c FROM maintenance_records ${where}`).get(params).c;

    return { data: rows, total, limit, offset };
  },

  findById(recordId) {
    return getDb().prepare('SELECT * FROM maintenance_records WHERE record_id = ?').get(recordId) || null;
  },

  findBySiteId(siteId) {
    return getDb().prepare(`
      SELECT * FROM maintenance_records WHERE site_id = ? ORDER BY maintenance_date DESC
    `).all(siteId);
  },

  findByEngineerId(engineerId) {
    return getDb().prepare(`
      SELECT * FROM maintenance_records WHERE engineer_id = ? ORDER BY maintenance_date DESC
    `).all(engineerId);
  },

  count(filters = {}) {
    const { where, params } = buildWhereClause(filters);
    return getDb().prepare(`SELECT COUNT(*) as c FROM maintenance_records ${where}`).get(params).c;
  },

  getStats() {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_records,
        SUM(cost_usd) as total_cost,
        AVG(cost_usd) as avg_cost,
        AVG(duration_hours) as avg_duration,
        SUM(CASE WHEN classification = 'emergency' THEN 1 ELSE 0 END) as emergency_count,
        SUM(CASE WHEN classification = 'planned' THEN 1 ELSE 0 END) as planned_count,
        SUM(CASE WHEN iso55000_compliant = 1 THEN 1 ELSE 0 END) as iso_compliant_count,
        SUM(CASE WHEN eca_audit_trail = 1 THEN 1 ELSE 0 END) as eca_trail_count,
        SUM(CASE WHEN classification = 'emergency' THEN cost_usd ELSE 0 END) as emergency_cost,
        SUM(CASE WHEN classification = 'planned' THEN cost_usd ELSE 0 END) as planned_cost
      FROM maintenance_records
    `).get();

    const byClassification = db.prepare(`
      SELECT classification, COUNT(*) as count,
             SUM(cost_usd) as total_cost, AVG(cost_usd) as avg_cost,
             AVG(duration_hours) as avg_duration
      FROM maintenance_records
      GROUP BY classification
    `).all();

    const byRegion = db.prepare(`
      SELECT region, COUNT(*) as count, SUM(cost_usd) as total_cost
      FROM maintenance_records
      GROUP BY region
      ORDER BY total_cost DESC
    `).all();

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM maintenance_records
      GROUP BY status
    `).all();

    const topEngineers = db.prepare(`
      SELECT engineer_name, engineer_id, COUNT(*) as job_count,
             SUM(cost_usd) as total_cost, AVG(duration_hours) as avg_duration
      FROM maintenance_records
      GROUP BY engineer_id
      ORDER BY job_count DESC
      LIMIT 10
    `).all();

    return { totals, byClassification, byRegion, byStatus, topEngineers };
  },

  getTimeSeries(interval = 'month') {
    const fmt = interval === 'day' ? '%Y-%m-%d' : interval === 'week' ? '%Y-%W' : '%Y-%m';

    return getDb().prepare(`
      SELECT strftime('${fmt}', maintenance_date) as period,
             COUNT(*) as record_count,
             SUM(cost_usd) as total_cost,
             SUM(CASE WHEN classification = 'emergency' THEN 1 ELSE 0 END) as emergency_count,
             SUM(CASE WHEN classification = 'planned' THEN 1 ELSE 0 END) as planned_count
      FROM maintenance_records
      GROUP BY period
      ORDER BY period ASC
    `).all();
  },

  getUpcoming(days = 30) {
    return getDb().prepare(`
      SELECT * FROM maintenance_records
      WHERE next_scheduled_date IS NOT NULL
        AND next_scheduled_date >= date('now')
        AND next_scheduled_date <= date('now', '+${parseInt(days)} days')
        AND status != 'completed'
      ORDER BY next_scheduled_date ASC
    `).all();
  },

  getTopN(field, n = 10) {
    const allowed = ['cost_usd', 'duration_hours'];
    const col = allowed.includes(field) ? field : 'cost_usd';
    return getDb().prepare(`SELECT * FROM maintenance_records ORDER BY ${col} DESC LIMIT ?`).all(n);
  }
};

module.exports = MaintenanceRecord;
