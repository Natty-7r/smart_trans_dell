const express = require('express');
const router = express.Router();
const AlertLog = require('../models/AlertLog');

// GET /api/alerts — list with pagination, search, filter, sort
router.get('/', (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      site_id: req.query.site_id || '',
      severity: req.query.severity || '',
      status: req.query.status || '',
      alert_type: req.query.alert_type || '',
      region: req.query.region || '',
      assigned_engineer_id: req.query.assigned_engineer_id || '',
      model_triggered: req.query.model_triggered || '',
      from: req.query.from || '',
      to: req.query.to || '',
      is_false_positive: req.query.is_false_positive !== undefined
        ? req.query.is_false_positive === 'true' || req.query.is_false_positive === '1'
        : undefined,
      orderBy: req.query.sortBy || req.query.orderBy || 'timestamp',
      orderDir: (req.query.sortDir || req.query.orderDir || 'DESC').toUpperCase(),
      limit,
      offset
    };

    Object.keys(filters).forEach(k => {
      if (filters[k] === '' || filters[k] === undefined) delete filters[k];
    });

    const result = AlertLog.findAll(req.scope(filters));
    const pages = Math.ceil(result.total / limit);

    res.json({ data: result.data, total: result.total, page, pages, limit });
  } catch (err) { next(err); }
});

// GET /api/alerts/active — active + acknowledged alerts sorted by severity
router.get('/active', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const data = AlertLog.getRecentActive(limit);
    res.json({ data, total: data.length });
  } catch (err) { next(err); }
});

// GET /api/alerts/stats
router.get('/stats', (req, res, next) => {
  try {
    const stats = AlertLog.getStats();
    const dispatchDist = AlertLog.getDispatchLatencyDistribution();
    res.json({ ...stats, dispatchLatencyDistribution: dispatchDist });
  } catch (err) { next(err); }
});

// GET /api/alerts/timeseries
router.get('/timeseries', (req, res, next) => {
  try {
    const interval = req.query.interval || 'day';
    const data = AlertLog.getTimeSeries(interval);
    res.json({ data, interval });
  } catch (err) { next(err); }
});

// GET /api/alerts/export — CSV
router.get('/export', (req, res, next) => {
  try {
    const filters = {
      severity: req.query.severity || '',
      status: req.query.status || '',
      region: req.query.region || '',
      from: req.query.from || '',
      to: req.query.to || '',
      limit: 5000,
      offset: 0
    };
    Object.keys(filters).forEach(k => { if (filters[k] === '') delete filters[k]; });

    const { data } = AlertLog.findAll(req.scope(filters));
    const cols = [
      'alert_id','site_id','site_name','region','assigned_engineer_name','severity','alert_type',
      'timestamp','acknowledged_at','resolved_at','alert_message','ai_confidence',
      'dispatch_latency_seconds','prediction_lead_hours','status','resolution_time_minutes',
      'model_triggered','is_false_positive','acknowledged_by','escalation_reason'
    ];

    const escape = v => {
      if (v == null) return '';
      const s = Array.isArray(v) ? v.join(';') : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csv = [cols.join(','), ...data.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="alert_logs.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/alerts/:id — single alert with related
router.get('/:id', (req, res, next) => {
  try {
    const alert = AlertLog.findById(req.params.id);
    if (!alert) { const e = new Error('Alert not found'); e.status = 404; return next(e); }

    const age_minutes = Math.floor((Date.now() - new Date(alert.timestamp).getTime()) / 60000);
    const sla_breached = !alert.acknowledged_at && age_minutes > 30;

    res.json({ ...alert, age_minutes, sla_breached });
  } catch (err) { next(err); }
});

// GET /api/alerts/:id/events — history for this alert's site
router.get('/:id/events', (req, res, next) => {
  try {
    const alert = AlertLog.findById(req.params.id);
    if (!alert) { const e = new Error('Alert not found'); e.status = 404; return next(e); }

    const siteAlerts = AlertLog.findBySiteId(alert.site_id);
    res.json({ data: siteAlerts, total: siteAlerts.length });
  } catch (err) { next(err); }
});

// POST /api/alerts/:id/acknowledge
router.post('/:id/acknowledge', (req, res, next) => {
  try {
    const by = (req.body && req.body.acknowledged_by) || 'NOC Operator';
    const result = AlertLog.acknowledge(req.params.id, by);
    if (result.changes === 0) {
      const e = new Error('Alert not found or already acknowledged'); e.status = 404; return next(e);
    }
    const updated = AlertLog.findById(req.params.id);
    res.json({ success: true, alert: updated });
  } catch (err) { next(err); }
});

// POST /api/alerts/:id/resolve
router.post('/:id/resolve', (req, res, next) => {
  try {
    const result = AlertLog.resolve(req.params.id);
    if (result.changes === 0) {
      const e = new Error('Alert not found or already resolved'); e.status = 404; return next(e);
    }
    const updated = AlertLog.findById(req.params.id);
    res.json({ success: true, alert: updated });
  } catch (err) { next(err); }
});

module.exports = router;
