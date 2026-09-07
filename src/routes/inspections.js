const express = require('express');
const router = express.Router();
const Inspection = require('../models/Inspection');
const TransformerSite = require('../models/TransformerSite');

// GET /api/inspections — list with pagination, search, filter, sort
router.get('/', (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      site_id: req.query.site_id || '',
      status: req.query.status || '',
      region: req.query.region || '',
      orderBy: req.query.sortBy || req.query.orderBy || 'scheduled_at',
      orderDir: (req.query.sortDir || req.query.orderDir || 'DESC').toUpperCase(),
      limit,
      offset
    };
    Object.keys(filters).forEach(k => { if (filters[k] === '') delete filters[k]; });

    const result = Inspection.findAll(req.scope(filters));
    const pages = Math.ceil(result.total / limit) || 1;
    res.json({ data: result.data, total: result.total, page, pages, limit });
  } catch (err) { next(err); }
});

// POST /api/inspections — log a scheduled inspection
router.post('/', (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.site_id) { const e = new Error('site_id is required'); e.status = 400; return next(e); }

    // Enrich from the live site record where possible
    const site = TransformerSite.findById(body.site_id) || {};

    // Priority + due date derived from health score unless supplied
    const health = body.health_score != null ? body.health_score : site.health_score;
    const priority = body.priority || (health != null && health < 40 ? 'Urgent'
      : health != null && health < 60 ? 'High' : 'Routine');
    const leadDays = priority === 'Urgent' ? 1 : priority === 'High' ? 3 : 7;
    const due = new Date(Date.now() + leadDays * 86400000).toISOString().slice(0, 10);

    const record = Inspection.create({
      site_id: body.site_id,
      site_name: body.site_name || site.name,
      region: body.region || site.region,
      health_score: health,
      risk_tier: body.risk_tier || null,
      priority,
      scheduled_by: body.scheduled_by || 'NOC Operator',
      due_date: body.due_date || due,
      notes: body.notes || `Inspection scheduled from Data Explorer for ${body.site_name || site.name || body.site_id}.`
    });

    res.status(201).json(record);
  } catch (err) { next(err); }
});

// GET /api/inspections/export — CSV audit export
router.get('/export', (req, res, next) => {
  try {
    const { data } = Inspection.findAll({ limit: 5000, offset: 0 });
    const cols = ['inspection_id','site_id','site_name','region','health_score','risk_tier',
      'priority','status','scheduled_by','scheduled_at','due_date','notes'];
    const esc = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...data.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="inspection_logs.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/inspections/:id — single record
router.get('/:id', (req, res, next) => {
  try {
    const record = Inspection.findById(req.params.id);
    if (!record) { const e = new Error('Inspection not found'); e.status = 404; return next(e); }
    res.json(record);
  } catch (err) { next(err); }
});

module.exports = router;
