const { getDb } = require('../database');

function buildWhereClause(filters) {
  const conditions = [];
  const params = {};

  if (filters.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters.region) {
    conditions.push('region = @region');
    params.region = filters.region;
  }
  if (filters.on_call !== undefined) {
    conditions.push('on_call = @on_call');
    params.on_call = filters.on_call ? 1 : 0;
  }
  if (filters.prism_trained !== undefined) {
    conditions.push('prism_trained = @prism_trained');
    params.prism_trained = filters.prism_trained ? 1 : 0;
  }
  if (filters.gender) {
    conditions.push('gender = @gender');
    params.gender = filters.gender;
  }
  if (filters.certification_level) {
    conditions.push('certification_level LIKE @cert');
    params.cert = `%${filters.certification_level}%`;
  }
  if (filters.search) {
    conditions.push('(full_name LIKE @search OR email LIKE @search OR specialization LIKE @search OR home_base LIKE @search OR certification_level LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

const SORTABLE = new Set([
  'full_name', 'total_resolutions', 'avg_response_time_minutes',
  'customer_satisfaction_score', 'years_experience', 'active_assignments',
  'hire_date', 'region', 'status', 'engineer_id'
]);

const FieldEngineer = {
  findAll(filters = {}) {
    const db = getDb();
    const limit = Math.min(parseInt(filters.limit) || 50, 200);
    const offset = parseInt(filters.offset) || 0;
    const orderBy = SORTABLE.has(filters.orderBy) ? filters.orderBy : 'full_name';
    const orderDir = filters.orderDir === 'DESC' ? 'DESC' : 'ASC';

    const { where, params } = buildWhereClause(filters);

    const rows = db.prepare(`
      SELECT * FROM field_engineers
      ${where}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    const total = db.prepare(`SELECT COUNT(*) as c FROM field_engineers ${where}`).get(params).c;

    const parsed = rows.map(parseEngineer);

    return { data: parsed, total, limit, offset };
  },

  findById(engineerId) {
    const row = getDb().prepare('SELECT * FROM field_engineers WHERE engineer_id = ?').get(engineerId);
    return row ? parseEngineer(row) : null;
  },

  findByRegion(region) {
    return getDb().prepare(`
      SELECT * FROM field_engineers WHERE region = ? ORDER BY total_resolutions DESC
    `).all(region).map(parseEngineer);
  },

  findOnCall() {
    return getDb().prepare(`
      SELECT * FROM field_engineers WHERE on_call = 1 ORDER BY status, total_resolutions DESC
    `).all().map(parseEngineer);
  },

  count(filters = {}) {
    const { where, params } = buildWhereClause(filters);
    return getDb().prepare(`SELECT COUNT(*) as c FROM field_engineers ${where}`).get(params).c;
  },

  getStats() {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_engineers,
        SUM(total_resolutions) as total_resolutions,
        AVG(total_resolutions) as avg_resolutions,
        AVG(avg_response_time_minutes) as avg_response_time,
        AVG(customer_satisfaction_score) as avg_satisfaction,
        AVG(years_experience) as avg_experience,
        SUM(CASE WHEN on_call = 1 THEN 1 ELSE 0 END) as on_call_count,
        SUM(CASE WHEN prism_trained = 1 THEN 1 ELSE 0 END) as prism_trained_count,
        SUM(active_assignments) as total_active_assignments
      FROM field_engineers
    `).get();

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM field_engineers
      GROUP BY status
    `).all();

    const byRegion = db.prepare(`
      SELECT region, COUNT(*) as count,
             AVG(total_resolutions) as avg_resolutions,
             SUM(CASE WHEN on_call = 1 THEN 1 ELSE 0 END) as on_call_count
      FROM field_engineers
      GROUP BY region
      ORDER BY count DESC
    `).all();

    const bySpecialization = db.prepare(`
      SELECT specialization, COUNT(*) as count
      FROM field_engineers
      GROUP BY specialization
      ORDER BY count DESC
    `).all();

    const topPerformers = db.prepare(`
      SELECT * FROM field_engineers
      ORDER BY total_resolutions DESC
      LIMIT 10
    `).all().map(parseEngineer);

    return { totals, byStatus, byRegion, bySpecialization, topPerformers };
  },

  getTopN(field, n = 10) {
    const allowed = ['total_resolutions', 'customer_satisfaction_score', 'years_experience'];
    const col = allowed.includes(field) ? field : 'total_resolutions';
    return getDb().prepare(`SELECT * FROM field_engineers ORDER BY ${col} DESC LIMIT ?`).all(n).map(parseEngineer);
  },

  updateStatus(engineerId, status) {
    return getDb().prepare(`
      UPDATE field_engineers SET status = ? WHERE engineer_id = ?
    `).run(status, engineerId);
  }
};

function parseEngineer(row) {
  return {
    ...row,
    certifications: (() => { try { return JSON.parse(row.certifications || '[]'); } catch { return []; } })(),
    languages: (() => { try { return JSON.parse(row.languages || '[]'); } catch { return []; } })(),
    on_call: row.on_call === 1,
    prism_trained: row.prism_trained === 1
  };
}

module.exports = FieldEngineer;
