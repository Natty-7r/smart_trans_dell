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
  if (filters.fault_type) {
    conditions.push('fault_type = @fault_type');
    params.fault_type = filters.fault_type;
  }
  if (filters.era) {
    conditions.push('era = @era');
    params.era = filters.era;
  }
  if (filters.region) {
    conditions.push('region = @region');
    params.region = filters.region;
  }
  if (filters.transformer_rating) {
    conditions.push('transformer_rating = @transformer_rating');
    params.transformer_rating = filters.transformer_rating;
  }
  if (filters.root_cause_confirmed !== undefined) {
    conditions.push('root_cause_confirmed = @root_cause_confirmed');
    params.root_cause_confirmed = filters.root_cause_confirmed ? 1 : 0;
  }
  if (filters.eca_reportable !== undefined) {
    conditions.push('eca_reportable = @eca_reportable');
    params.eca_reportable = filters.eca_reportable ? 1 : 0;
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
    conditions.push('(fault_id LIKE @search OR site_name LIKE @search OR description LIKE @search OR work_order_id LIKE @search OR detection_method LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

const SORTABLE = new Set([
  'timestamp', 'severity', 'financial_impact_usd', 'downtime_hours',
  'detection_delay_hours', 'resolution_time_hours', 'subscribers_affected',
  'fault_id', 'site_name', 'region'
]);

const FaultEvent = {
  findAll(filters = {}) {
    const db = getDb();
    const limit = Math.min(parseInt(filters.limit) || 50, 500);
    const offset = parseInt(filters.offset) || 0;
    const orderBy = SORTABLE.has(filters.orderBy) ? filters.orderBy : 'timestamp';
    const orderDir = filters.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const { where, params } = buildWhereClause(filters);

    const rows = db.prepare(`
      SELECT * FROM fault_events
      ${where}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    const total = db.prepare(`SELECT COUNT(*) as c FROM fault_events ${where}`).get(params).c;

    return { data: rows, total, limit, offset };
  },

  findById(faultId) {
    return getDb().prepare('SELECT * FROM fault_events WHERE fault_id = ?').get(faultId) || null;
  },

  findBySiteId(siteId) {
    return getDb().prepare(`
      SELECT * FROM fault_events WHERE site_id = ? ORDER BY timestamp DESC
    `).all(siteId);
  },

  count(filters = {}) {
    const { where, params } = buildWhereClause(filters);
    return getDb().prepare(`SELECT COUNT(*) as c FROM fault_events ${where}`).get(params).c;
  },

  getStats() {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_faults,
        SUM(financial_impact_usd) as total_financial_impact,
        AVG(financial_impact_usd) as avg_financial_impact,
        AVG(detection_delay_hours) as avg_detection_delay,
        AVG(resolution_time_hours) as avg_resolution_time,
        AVG(downtime_hours) as avg_downtime,
        SUM(downtime_hours) as total_downtime,
        SUM(subscribers_affected) as total_subscribers_affected,
        SUM(CASE WHEN root_cause_confirmed = 1 THEN 1 ELSE 0 END) as confirmed_root_causes
      FROM fault_events
    `).get();

    const bySeverity = db.prepare(`
      SELECT severity, COUNT(*) as count,
             SUM(financial_impact_usd) as total_impact,
             AVG(downtime_hours) as avg_downtime
      FROM fault_events
      GROUP BY severity
      ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END
    `).all();

    const byType = db.prepare(`
      SELECT fault_type, COUNT(*) as count,
             AVG(financial_impact_usd) as avg_impact,
             AVG(detection_delay_hours) as avg_delay
      FROM fault_events
      GROUP BY fault_type
      ORDER BY count DESC
    `).all();

    const byEra = db.prepare(`
      SELECT era,
             COUNT(*) as count,
             AVG(detection_delay_hours) as avg_detection_delay,
             AVG(resolution_time_hours) as avg_resolution_time,
             AVG(downtime_hours) as avg_downtime,
             SUM(financial_impact_usd) as total_impact
      FROM fault_events
      GROUP BY era
    `).all();

    const byRegion = db.prepare(`
      SELECT region, COUNT(*) as count, SUM(financial_impact_usd) as total_impact
      FROM fault_events
      GROUP BY region
      ORDER BY count DESC
    `).all();

    const byRating = db.prepare(`
      SELECT transformer_rating, COUNT(*) as count,
             AVG(financial_impact_usd) as avg_impact
      FROM fault_events
      GROUP BY transformer_rating
    `).all();

    return { totals, bySeverity, byType, byEra, byRegion, byRating };
  },

  getTimeSeries(interval = 'month') {
    const fmt = interval === 'day' ? '%Y-%m-%d' : interval === 'week' ? '%Y-%W' : '%Y-%m';

    return getDb().prepare(`
      SELECT strftime('${fmt}', timestamp) as period,
             COUNT(*) as fault_count,
             SUM(financial_impact_usd) as total_impact,
             AVG(downtime_hours) as avg_downtime,
             SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) as critical_count
      FROM fault_events
      GROUP BY period
      ORDER BY period ASC
    `).all();
  },

  getPreVsPostPrism() {
    return getDb().prepare(`
      SELECT
        era,
        COUNT(*) as fault_count,
        AVG(detection_delay_hours) as avg_detection_delay,
        AVG(downtime_hours) as avg_downtime,
        SUM(financial_impact_usd) as total_impact,
        AVG(financial_impact_usd) as avg_impact,
        AVG(resolution_time_hours) as avg_resolution,
        SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) as critical_count,
        SUM(CASE WHEN root_cause_confirmed = 0 THEN 1 ELSE 0 END) as unknown_count
      FROM fault_events
      GROUP BY era
    `).all();
  },

  getTopN(field, n = 10) {
    const allowed = ['financial_impact_usd', 'downtime_hours', 'detection_delay_hours', 'subscribers_affected'];
    const col = allowed.includes(field) ? field : 'financial_impact_usd';
    return getDb().prepare(`SELECT * FROM fault_events ORDER BY ${col} DESC LIMIT ?`).all(n);
  },

  getFinancialImpactByMonth() {
    return getDb().prepare(`
      SELECT strftime('%Y-%m', timestamp) as month,
             SUM(financial_impact_usd) as total_impact,
             COUNT(*) as fault_count
      FROM fault_events
      GROUP BY month
      ORDER BY month ASC
    `).all();
  }
};

module.exports = FaultEvent;
