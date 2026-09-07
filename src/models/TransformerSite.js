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

  if (filters.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters.region) {
    conditions.push('region = @region');
    params.region = filters.region;
  }
  if (filters.transformer_rating) {
    conditions.push('transformer_rating = @transformer_rating');
    params.transformer_rating = filters.transformer_rating;
  }
  if (filters.anomaly_type) {
    conditions.push('anomaly_type = @anomaly_type');
    params.anomaly_type = filters.anomaly_type;
  }
  if (filters.ai_monitoring_enabled !== undefined) {
    conditions.push('ai_monitoring_enabled = @ai_monitoring_enabled');
    params.ai_monitoring_enabled = filters.ai_monitoring_enabled ? 1 : 0;
  }
  if (filters.health_min !== undefined) {
    conditions.push('health_score >= @health_min');
    params.health_min = filters.health_min;
  }
  if (filters.health_max !== undefined) {
    conditions.push('health_score <= @health_max');
    params.health_max = filters.health_max;
  }
  if (filters.search) {
    conditions.push('(name LIKE @search OR area LIKE @search OR address LIKE @search OR serial_number LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

const TransformerSite = {
  findAll(filters = {}) {
    const db = getDb();
    const limit = Math.min(parseInt(filters.limit) || 50, 500);
    const offset = parseInt(filters.offset) || 0;
    const orderBy = ['name', 'health_score', 'status', 'region', 'transformer_rating', 'subscribers_at_risk', 'last_alert_timestamp'].includes(filters.orderBy)
      ? filters.orderBy : 'health_score';
    const orderDir = filters.orderDir === 'DESC' ? 'DESC' : 'ASC';

    const { where, params } = buildWhereClause(filters);

    const rows = db.prepare(`
      SELECT * FROM transformer_sites
      ${where}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    const total = db.prepare(`SELECT COUNT(*) as c FROM transformer_sites ${where}`).get(params).c;

    return { data: rows, total, limit, offset };
  },

  findById(siteId) {
    return getDb().prepare('SELECT * FROM transformer_sites WHERE site_id = ?').get(siteId) || null;
  },

  findByRegion(region) {
    return getDb().prepare('SELECT * FROM transformer_sites WHERE region = ? ORDER BY health_score ASC').all(region);
  },

  count(filters = {}) {
    const { where, params } = buildWhereClause(filters);
    return getDb().prepare(`SELECT COUNT(*) as c FROM transformer_sites ${where}`).get(params).c;
  },

  getStats() {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_sites,
        SUM(subscribers_at_risk) as total_subscribers_at_risk,
        AVG(health_score) as avg_health_score,
        SUM(annual_energy_kwh) as total_energy_kwh,
        SUM(replacement_cost_usd) as total_replacement_value
      FROM transformer_sites
    `).get();

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM transformer_sites
      GROUP BY status
      ORDER BY count DESC
    `).all();

    const byRegion = db.prepare(`
      SELECT region, COUNT(*) as count, AVG(health_score) as avg_health
      FROM transformer_sites
      GROUP BY region
      ORDER BY count DESC
    `).all();

    const byRating = db.prepare(`
      SELECT transformer_rating, COUNT(*) as count, AVG(health_score) as avg_health
      FROM transformer_sites
      GROUP BY transformer_rating
    `).all();

    const critical = db.prepare(`
      SELECT * FROM transformer_sites
      WHERE status IN ('critical', 'warning')
      ORDER BY health_score ASC
      LIMIT 10
    `).all();

    const recentAlerts = db.prepare(`
      SELECT * FROM transformer_sites
      WHERE last_alert_timestamp IS NOT NULL
      ORDER BY last_alert_timestamp DESC
      LIMIT 5
    `).all();

    return { totals, byStatus, byRegion, byRating, critical, recentAlerts };
  },

  getHealthDistribution() {
    const db = getDb();
    return db.prepare(`
      SELECT
        CASE
          WHEN health_score >= 80 THEN 'Healthy (80-100)'
          WHEN health_score >= 60 THEN 'Warning (60-79)'
          WHEN health_score >= 40 THEN 'At Risk (40-59)'
          ELSE 'Critical (<40)'
        END as band,
        COUNT(*) as count
      FROM transformer_sites
      GROUP BY band
      ORDER BY MIN(health_score) DESC
    `).all();
  },

  getGeoData() {
    return getDb().prepare(`
      SELECT site_id, name, latitude, longitude, status, health_score,
             region, transformer_rating, subscribers_at_risk, anomaly_type,
             ai_monitoring_enabled, last_alert_timestamp
      FROM transformer_sites
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `).all();
  },

  getTopAtRisk(n = 10) {
    return getDb().prepare(`
      SELECT * FROM transformer_sites
      ORDER BY health_score ASC
      LIMIT ?
    `).all(n);
  },

  getTopN(field, n = 10) {
    const allowed = ['subscribers_at_risk', 'health_score', 'annual_energy_kwh', 'replacement_cost_usd'];
    const col = allowed.includes(field) ? field : 'subscribers_at_risk';
    return getDb().prepare(`SELECT * FROM transformer_sites ORDER BY ${col} DESC LIMIT ?`).all(n);
  },

  // ── E2: site management (admin) ──
  create(data) {
    const db = getDb();
    if (!data.name || !data.region) throw Object.assign(new Error('name and region are required'), { status: 400 });
    const siteId = data.site_id || `TF-${Math.floor(1000 + Math.random() * 9000)}`;
    if (db.prepare('SELECT 1 FROM transformer_sites WHERE site_id = ?').get(siteId)) {
      throw Object.assign(new Error('site_id already exists'), { status: 409 });
    }
    const cols = ['site_id','name','region','area','latitude','longitude','address','transformer_rating',
      'site_type','connectivity','manufacturer','serial_number','installation_date','status','health_score',
      'subscribers_at_risk','replacement_cost_usd','annual_energy_kwh','notes'];
    const row = { site_id: siteId };
    for (const c of cols) if (c !== 'site_id') row[c] = data[c] !== undefined ? data[c] : null;
    if (row.status == null) row.status = 'healthy';
    if (row.health_score == null) row.health_score = 100;
    db.prepare(`INSERT INTO transformer_sites (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);
    return TransformerSite.findById(siteId);
  },

  update(siteId, data) {
    const db = getDb();
    if (!db.prepare('SELECT 1 FROM transformer_sites WHERE site_id = ?').get(siteId)) {
      throw Object.assign(new Error('Site not found'), { status: 404 });
    }
    const editable = ['name','region','area','latitude','longitude','address','transformer_rating','site_type',
      'connectivity','manufacturer','serial_number','installation_date','status','health_score',
      'subscribers_at_risk','replacement_cost_usd','annual_energy_kwh','ai_monitoring_enabled','notes'];
    const sets = [];
    const params = { site_id: siteId };
    for (const c of editable) if (data[c] !== undefined) { sets.push(`${c} = @${c}`); params[c] = data[c]; }
    if (sets.length) db.prepare(`UPDATE transformer_sites SET ${sets.join(', ')} WHERE site_id = @site_id`).run(params);
    return TransformerSite.findById(siteId);
  },

  remove(siteId) {
    return getDb().prepare('DELETE FROM transformer_sites WHERE site_id = ?').run(siteId).changes > 0;
  }
};

module.exports = TransformerSite;
