const express = require('express');
const router = express.Router();
const MaintenanceRecord = require('../models/MaintenanceRecord');
const FaultEvent = require('../models/FaultEvent');

// GET /api/maintenance — list with pagination, search, filter, sort
router.get('/', (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      site_id: req.query.site_id || '',
      engineer_id: req.query.engineer_id || '',
      classification: req.query.classification || '',
      status: req.query.status || '',
      region: req.query.region || '',
      from: req.query.from || '',
      to: req.query.to || '',
      cost_min: req.query.cost_min !== undefined ? parseFloat(req.query.cost_min) : undefined,
      cost_max: req.query.cost_max !== undefined ? parseFloat(req.query.cost_max) : undefined,
      iso55000_compliant: req.query.iso55000_compliant !== undefined
        ? req.query.iso55000_compliant === 'true' || req.query.iso55000_compliant === '1'
        : undefined,
      eca_audit_trail: req.query.eca_audit_trail !== undefined
        ? req.query.eca_audit_trail === 'true' || req.query.eca_audit_trail === '1'
        : undefined,
      orderBy: req.query.sortBy || req.query.orderBy || 'maintenance_date',
      orderDir: (req.query.sortDir || req.query.orderDir || 'DESC').toUpperCase(),
      limit,
      offset
    };

    Object.keys(filters).forEach(k => {
      if (filters[k] === '' || filters[k] === undefined) delete filters[k];
    });

    const result = MaintenanceRecord.findAll(req.scope(filters));
    const pages = Math.ceil(result.total / limit);

    res.json({ data: result.data, total: result.total, page, pages, limit });
  } catch (err) { next(err); }
});

// GET /api/maintenance/stats
router.get('/stats', (req, res, next) => {
  try {
    const stats = MaintenanceRecord.getStats();
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /api/maintenance/timeseries
router.get('/timeseries', (req, res, next) => {
  try {
    const interval = req.query.interval || 'month';
    const data = MaintenanceRecord.getTimeSeries(interval);
    res.json({ data, interval });
  } catch (err) { next(err); }
});

// GET /api/maintenance/upcoming
router.get('/upcoming', (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = MaintenanceRecord.getUpcoming(days);
    res.json({ data, total: data.length, days });
  } catch (err) { next(err); }
});

// GET /api/maintenance/export — CSV
router.get('/export', (req, res, next) => {
  try {
    const filters = {
      classification: req.query.classification || '',
      status: req.query.status || '',
      region: req.query.region || '',
      from: req.query.from || '',
      to: req.query.to || '',
      limit: 5000,
      offset: 0
    };
    Object.keys(filters).forEach(k => { if (filters[k] === '') delete filters[k]; });

    const { data } = MaintenanceRecord.findAll(req.scope(filters));
    const cols = [
      'record_id','site_id','site_name','region','engineer_id','engineer_name','classification',
      'maintenance_date','cost_usd','primary_task','parts_replaced','duration_hours','status',
      'access_notes','iso55000_compliant','work_order_id','findings','next_scheduled_date',
      'approved_by','eca_audit_trail'
    ];

    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csv = [cols.join(','), ...data.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="maintenance_records.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/maintenance/:id — single record with related
router.get('/:id', (req, res, next) => {
  try {
    const record = MaintenanceRecord.findById(req.params.id);
    if (!record) { const e = new Error('Maintenance record not found'); e.status = 404; return next(e); }

    const siteFaults = FaultEvent.findBySiteId(record.site_id).slice(0, 5);
    const siteHistory = MaintenanceRecord.findBySiteId(record.site_id)
      .filter(r => r.record_id !== record.record_id).slice(0, 5);

    const days_since = Math.floor((Date.now() - new Date(record.maintenance_date).getTime()) / 86400000);
    const cost_category = record.cost_usd < 500 ? 'Low' : record.cost_usd < 2000 ? 'Medium' : 'High';

    res.json({
      ...record,
      days_since,
      cost_category,
      related: {
        siteFaults,
        siteHistory
      }
    });
  } catch (err) { next(err); }
});

// GET /api/maintenance/:id/events — all records for same site
router.get('/:id/events', (req, res, next) => {
  try {
    const record = MaintenanceRecord.findById(req.params.id);
    if (!record) { const e = new Error('Maintenance record not found'); e.status = 404; return next(e); }

    const data = MaintenanceRecord.findBySiteId(record.site_id);
    res.json({ data, total: data.length });
  } catch (err) { next(err); }
});

module.exports = router;
