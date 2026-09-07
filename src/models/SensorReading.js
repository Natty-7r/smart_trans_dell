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
  if (filters.is_anomaly !== undefined) {
    conditions.push('is_anomaly = @is_anomaly');
    params.is_anomaly = filters.is_anomaly ? 1 : 0;
  }
  if (filters.inference_model) {
    conditions.push('inference_model = @inference_model');
    params.inference_model = filters.inference_model;
  }
  if (filters.edge_node) {
    conditions.push('edge_node = @edge_node');
    params.edge_node = filters.edge_node;
  }
  if (filters.from) {
    conditions.push('timestamp >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push('timestamp <= @to');
    params.to = filters.to;
  }
  if (filters.anomaly_score_min !== undefined) {
    conditions.push('anomaly_score >= @anomaly_score_min');
    params.anomaly_score_min = filters.anomaly_score_min;
  }
  if (filters.search) {
    conditions.push('(reading_id LIKE @search OR edge_node LIKE @search OR inference_model LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

const SORTABLE = new Set([
  'timestamp', 'anomaly_score', 'winding_temperature_c', 'oil_temperature_c',
  'load_factor_pct', 'vibration_rms_mms', 'moisture_in_oil_ppm', 'signal_quality_pct',
  'primary_voltage_v', 'secondary_voltage_v', 'reading_id'
]);

const SensorReading = {
  findAll(filters = {}) {
    const db = getDb();
    const limit = Math.min(parseInt(filters.limit) || 50, 1000);
    const offset = parseInt(filters.offset) || 0;
    const orderBy = SORTABLE.has(filters.orderBy) ? filters.orderBy : 'timestamp';
    const orderDir = filters.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const { where, params } = buildWhereClause(filters);

    const rows = db.prepare(`
      SELECT * FROM sensor_readings
      ${where}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    const total = db.prepare(`SELECT COUNT(*) as c FROM sensor_readings ${where}`).get(params).c;

    return { data: rows, total, limit, offset };
  },

  findById(readingId) {
    return getDb().prepare('SELECT * FROM sensor_readings WHERE reading_id = ?').get(readingId) || null;
  },

  findBySiteId(siteId, limit = 100) {
    return getDb().prepare(`
      SELECT * FROM sensor_readings
      WHERE site_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(siteId, limit);
  },

  getLatestBySite(siteId) {
    return getDb().prepare(`
      SELECT * FROM sensor_readings
      WHERE site_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(siteId) || null;
  },

  count(filters = {}) {
    const { where, params } = buildWhereClause(filters);
    return getDb().prepare(`SELECT COUNT(*) as c FROM sensor_readings ${where}`).get(params).c;
  },

  getStats() {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_readings,
        SUM(is_anomaly) as total_anomalies,
        AVG(anomaly_score) as avg_anomaly_score,
        AVG(winding_temperature_c) as avg_winding_temp,
        AVG(load_factor_pct) as avg_load_factor,
        AVG(signal_quality_pct) as avg_signal_quality,
        MAX(winding_temperature_c) as max_winding_temp,
        AVG(vibration_rms_mms) as avg_vibration,
        AVG(inference_latency_ms) as avg_inference_latency
      FROM sensor_readings
    `).get();

    const byModel = db.prepare(`
      SELECT inference_model, COUNT(*) as count, SUM(is_anomaly) as anomalies
      FROM sensor_readings
      GROUP BY inference_model
    `).all();

    const anomalyBySite = db.prepare(`
      SELECT site_id, COUNT(*) as anomaly_count, AVG(anomaly_score) as avg_score
      FROM sensor_readings
      WHERE is_anomaly = 1
      GROUP BY site_id
      ORDER BY anomaly_count DESC
      LIMIT 10
    `).all();

    const byEdgeNode = db.prepare(`
      SELECT edge_node, COUNT(*) as count, AVG(inference_latency_ms) as avg_latency
      FROM sensor_readings
      GROUP BY edge_node
      ORDER BY count DESC
    `).all();

    return { totals, byModel, anomalyBySite, byEdgeNode };
  },

  getTimeSeries(siteId, field = 'winding_temperature_c', hours = 24) {
    const allowed = new Set([
      'winding_temperature_c', 'oil_temperature_c', 'load_factor_pct',
      'anomaly_score', 'vibration_rms_mms', 'moisture_in_oil_ppm',
      'primary_voltage_v', 'secondary_voltage_v', 'phase_a_current_a',
      'neutral_current_a', 'oil_level_pct', 'ambient_temperature_c'
    ]);
    const col = allowed.has(field) ? field : 'winding_temperature_c';

    return getDb().prepare(`
      SELECT timestamp, ${col} as value, is_anomaly, anomaly_score
      FROM sensor_readings
      WHERE site_id = ?
        AND timestamp >= datetime('now', '-${parseInt(hours)} hours')
      ORDER BY timestamp ASC
    `).all(siteId);
  },

  getFleetTimeSeries(field = 'winding_temperature_c', interval = 'hour') {
    const allowed = new Set([
      'winding_temperature_c', 'oil_temperature_c', 'load_factor_pct',
      'anomaly_score', 'vibration_rms_mms', 'moisture_in_oil_ppm'
    ]);
    const col = allowed.has(field) ? field : 'winding_temperature_c';

    const fmt = interval === 'day' ? '%Y-%m-%d' : interval === 'week' ? '%Y-%W' : '%Y-%m-%dT%H:00';

    return getDb().prepare(`
      SELECT strftime('${fmt}', timestamp) as period,
             AVG(${col}) as avg_value,
             MAX(${col}) as max_value,
             SUM(is_anomaly) as anomaly_count,
             COUNT(*) as reading_count
      FROM sensor_readings
      GROUP BY period
      ORDER BY period ASC
    `).all();
  },

  getAnomalyTimeline(days = 30) {
    return getDb().prepare(`
      SELECT strftime('%Y-%m-%d', timestamp) as date,
             COUNT(*) as anomaly_count,
             AVG(anomaly_score) as avg_score
      FROM sensor_readings
      WHERE is_anomaly = 1
        AND timestamp >= datetime('now', '-${parseInt(days)} days')
      GROUP BY date
      ORDER BY date ASC
    `).all();
  },

  getTopN(field, n = 10) {
    const allowed = ['anomaly_score', 'winding_temperature_c', 'vibration_rms_mms', 'moisture_in_oil_ppm'];
    const col = allowed.includes(field) ? field : 'anomaly_score';
    return getDb().prepare(`
      SELECT * FROM sensor_readings ORDER BY ${col} DESC LIMIT ?
    `).all(n);
  }
};

module.exports = SensorReading;
