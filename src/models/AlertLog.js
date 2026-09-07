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
  if (filters.severity) {
    conditions.push('severity = @severity');
    params.severity = filters.severity;
  }
  if (filters.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters.alert_type) {
    conditions.push('alert_type = @alert_type');
    params.alert_type = filters.alert_type;
  }
  if (filters.region) {
    conditions.push('region = @region');
    params.region = filters.region;
  }
  if (filters.assigned_engineer_id) {
    conditions.push('assigned_engineer_id = @assigned_engineer_id');
    params.assigned_engineer_id = filters.assigned_engineer_id;
  }
  if (filters.model_triggered) {
    conditions.push('model_triggered = @model_triggered');
    params.model_triggered = filters.model_triggered;
  }
  if (filters.is_false_positive !== undefined) {
    conditions.push('is_false_positive = @is_false_positive');
    params.is_false_positive = filters.is_false_positive ? 1 : 0;
  }
  if (filters.from) {
    conditions.push('timestamp >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push('timestamp <= @to');
    params.to = filters.to;
  }
  if (filters.search) {
    conditions.push('(alert_id LIKE @search OR site_name LIKE @search OR alert_message LIKE @search OR assigned_engineer_name LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

const SORTABLE = new Set([
  'timestamp', 'severity', 'ai_confidence', 'dispatch_latency_seconds',
  'resolution_time_minutes', 'status', 'site_name', 'region', 'alert_id',
  'prediction_lead_hours', 'alert_type'
]);

const AlertLog = {
  findAll(filters = {}) {
    const db = getDb();
    const limit = Math.min(parseInt(filters.limit) || 50, 500);
    const offset = parseInt(filters.offset) || 0;
    const orderBy = SORTABLE.has(filters.orderBy) ? filters.orderBy : 'timestamp';
    const orderDir = filters.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const { where, params } = buildWhereClause(filters);

    const rows = db.prepare(`
      SELECT * FROM alert_logs
      ${where}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    const total = db.prepare(`SELECT COUNT(*) as c FROM alert_logs ${where}`).get(params).c;

    const parsed = rows.map(row => ({
      ...row,
      notification_channels: (() => {
        try { return JSON.parse(row.notification_channels || '[]'); } catch { return []; }
      })()
    }));

    return { data: parsed, total, limit, offset };
  },

  findById(alertId) {
    const row = getDb().prepare('SELECT * FROM alert_logs WHERE alert_id = ?').get(alertId);
    if (!row) return null;
    return {
      ...row,
      notification_channels: (() => {
        try { return JSON.parse(row.notification_channels || '[]'); } catch { return []; }
      })()
    };
  },

  findBySiteId(siteId) {
    return getDb().prepare(`
      SELECT * FROM alert_logs WHERE site_id = ? ORDER BY timestamp DESC
    `).all(siteId);
  },

  findByEngineerId(engineerId) {
    return getDb().prepare(`
      SELECT * FROM alert_logs WHERE assigned_engineer_id = ? ORDER BY timestamp DESC
    `).all(engineerId);
  },

  count(filters = {}) {
    const { where, params } = buildWhereClause(filters);
    return getDb().prepare(`SELECT COUNT(*) as c FROM alert_logs ${where}`).get(params).c;
  },

  getStats() {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_alerts,
        SUM(CASE WHEN status != 'resolved' THEN 1 ELSE 0 END) as active_alerts,
        SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END) as acknowledged_alerts,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_alerts,
        SUM(CASE WHEN is_false_positive = 1 THEN 1 ELSE 0 END) as false_positives,
        AVG(ai_confidence) as avg_ai_confidence,
        AVG(dispatch_latency_seconds) as avg_dispatch_latency,
        AVG(prediction_lead_hours) as avg_prediction_lead,
        AVG(resolution_time_minutes) as avg_resolution_time,
        MAX(dispatch_latency_seconds) as max_dispatch_latency
      FROM alert_logs
    `).get();

    const bySeverity = db.prepare(`
      SELECT severity, COUNT(*) as count,
             AVG(ai_confidence) as avg_confidence,
             AVG(dispatch_latency_seconds) as avg_latency
      FROM alert_logs
      GROUP BY severity
      ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END
    `).all();

    const byType = db.prepare(`
      SELECT alert_type, COUNT(*) as count,
             AVG(ai_confidence) as avg_confidence,
             SUM(CASE WHEN is_false_positive = 1 THEN 1 ELSE 0 END) as false_positives
      FROM alert_logs
      GROUP BY alert_type
      ORDER BY count DESC
    `).all();

    const byModel = db.prepare(`
      SELECT model_triggered, COUNT(*) as count,
             AVG(ai_confidence) as avg_confidence
      FROM alert_logs
      GROUP BY model_triggered
      ORDER BY count DESC
    `).all();

    const byRegion = db.prepare(`
      SELECT region, COUNT(*) as count,
             SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) as critical_count
      FROM alert_logs
      GROUP BY region
      ORDER BY count DESC
    `).all();

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM alert_logs
      GROUP BY status
    `).all();

    return { totals, bySeverity, byType, byModel, byRegion, byStatus };
  },

  getTimeSeries(interval = 'day') {
    const fmt = interval === 'hour' ? '%Y-%m-%dT%H:00'
      : interval === 'week' ? '%Y-%W'
      : interval === 'month' ? '%Y-%m'
      : '%Y-%m-%d';

    return getDb().prepare(`
      SELECT strftime('${fmt}', timestamp) as period,
             COUNT(*) as alert_count,
             SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) as critical_count,
             SUM(CASE WHEN severity = 'High' THEN 1 ELSE 0 END) as high_count,
             SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
             AVG(dispatch_latency_seconds) as avg_latency
      FROM alert_logs
      GROUP BY period
      ORDER BY period ASC
    `).all();
  },

  getRecentActive(limit = 20) {
    const rows = getDb().prepare(`
      SELECT * FROM alert_logs
      WHERE status != 'resolved'
      ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
               timestamp DESC
      LIMIT ?
    `).all(limit);

    return rows.map(row => ({
      ...row,
      notification_channels: (() => {
        try { return JSON.parse(row.notification_channels || '[]'); } catch { return []; }
      })()
    }));
  },

  acknowledge(alertId, acknowledgedBy) {
    return getDb().prepare(`
      UPDATE alert_logs
      SET status = 'acknowledged',
          acknowledged_at = datetime('now'),
          acknowledged_by = ?
      WHERE alert_id = ? AND status != 'resolved'
    `).run(acknowledgedBy, alertId);
  },

  resolve(alertId) {
    return getDb().prepare(`
      UPDATE alert_logs
      SET status = 'resolved',
          resolved_at = datetime('now'),
          resolution_time_minutes = ROUND((julianday('now') - julianday(timestamp)) * 24 * 60)
      WHERE alert_id = ? AND status != 'resolved'
    `).run(alertId);
  },

  getTopN(field, n = 10) {
    const allowed = ['ai_confidence', 'dispatch_latency_seconds', 'prediction_lead_hours'];
    const col = allowed.includes(field) ? field : 'ai_confidence';
    return getDb().prepare(`SELECT * FROM alert_logs ORDER BY ${col} DESC LIMIT ?`).all(n);
  },

  getDispatchLatencyDistribution() {
    return getDb().prepare(`
      SELECT
        CASE
          WHEN dispatch_latency_seconds <= 10 THEN '0-10s'
          WHEN dispatch_latency_seconds <= 20 THEN '11-20s'
          WHEN dispatch_latency_seconds <= 30 THEN '21-30s'
          ELSE '>30s'
        END as band,
        COUNT(*) as count
      FROM alert_logs
      GROUP BY band
    `).all();
  }
};

module.exports = AlertLog;
