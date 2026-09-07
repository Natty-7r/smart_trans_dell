const { getDb } = require('../database');

const SORTABLE = new Set([
  'scheduled_at', 'due_date', 'health_score', 'status', 'priority', 'region', 'site_name'
]);

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

  if (filters.site_id) { conditions.push('site_id = @site_id'); params.site_id = filters.site_id; }
  if (filters.status)  { conditions.push('status = @status');   params.status = filters.status; }
  if (filters.region)  { conditions.push('region = @region');   params.region = filters.region; }
  if (filters.search) {
    conditions.push('(inspection_id LIKE @search OR site_name LIKE @search OR site_id LIKE @search OR scheduled_by LIKE @search OR notes LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

module.exports = {
  findAll(filters = {}) {
    const db = getDb();
    const { where, params } = buildWhereClause(filters);

    const orderBy = SORTABLE.has(filters.orderBy) ? filters.orderBy : 'scheduled_at';
    const orderDir = filters.orderDir === 'ASC' ? 'ASC' : 'DESC';
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const total = db.prepare(`SELECT COUNT(*) as c FROM inspection_logs ${where}`).get(params).c;
    const data = db.prepare(
      `SELECT inspection_id, site_id, site_name, region, health_score, risk_tier, priority,
              status, scheduled_by, scheduled_at, due_date, notes
       FROM inspection_logs ${where}
       ORDER BY ${orderBy} ${orderDir}
       LIMIT @limit OFFSET @offset`
    ).all({ ...params, limit, offset });

    return { data, total };
  },

  findById(inspectionId) {
    return getDb().prepare('SELECT * FROM inspection_logs WHERE inspection_id = ?').get(inspectionId);
  },

  create(payload) {
    const db = getDb();
    // Sequential, human-readable id: INS-00001, INS-00002, ...
    const nextNum = (db.prepare('SELECT COUNT(*) as c FROM inspection_logs').get().c) + 1;
    const inspection_id = 'INS-' + String(nextNum).padStart(5, '0');

    db.prepare(`
      INSERT INTO inspection_logs
        (inspection_id, site_id, site_name, region, health_score, risk_tier, priority,
         status, scheduled_by, due_date, notes)
      VALUES
        (@inspection_id, @site_id, @site_name, @region, @health_score, @risk_tier, @priority,
         @status, @scheduled_by, @due_date, @notes)
    `).run({
      inspection_id,
      site_id: payload.site_id,
      site_name: payload.site_name || null,
      region: payload.region || null,
      health_score: payload.health_score != null ? payload.health_score : null,
      risk_tier: payload.risk_tier || null,
      priority: payload.priority || 'Routine',
      status: payload.status || 'scheduled',
      scheduled_by: payload.scheduled_by || 'NOC Operator',
      due_date: payload.due_date || null,
      notes: payload.notes || null
    });

    return this.findById(inspection_id);
  }
};
