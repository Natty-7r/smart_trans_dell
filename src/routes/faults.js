const express = require('express');
const router = express.Router();
const FaultEvent = require('../models/FaultEvent');
const AlertLog = require('../models/AlertLog');

// GET /api/faults — list with pagination, search, filter, sort
router.get('/', (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      site_id: req.query.site_id || '',
      severity: req.query.severity || '',
      fault_type: req.query.fault_type || '',
      era: req.query.era || '',
      region: req.query.region || '',
      transformer_rating: req.query.transformer_rating || '',
      from: req.query.from || '',
      to: req.query.to || '',
      root_cause_confirmed: req.query.root_cause_confirmed !== undefined
        ? req.query.root_cause_confirmed === 'true' || req.query.root_cause_confirmed === '1'
        : undefined,
      eca_reportable: req.query.eca_reportable !== undefined
        ? req.query.eca_reportable === 'true' || req.query.eca_reportable === '1'
        : undefined,
      orderBy: req.query.sortBy || req.query.orderBy || 'timestamp',
      orderDir: (req.query.sortDir || req.query.orderDir || 'DESC').toUpperCase(),
      limit,
      offset
    };

    Object.keys(filters).forEach(k => {
      if (filters[k] === '' || filters[k] === undefined) delete filters[k];
    });

    const result = FaultEvent.findAll(req.scope(filters));
    const pages = Math.ceil(result.total / limit);

    res.json({ data: result.data, total: result.total, page, pages, limit });
  } catch (err) { next(err); }
});

// GET /api/faults/stats
router.get('/stats', (req, res, next) => {
  try {
    const stats = FaultEvent.getStats();
    const prismComparison = FaultEvent.getPreVsPostPrism();
    const financialByMonth = FaultEvent.getFinancialImpactByMonth();
    res.json({ ...stats, prismComparison, financialByMonth });
  } catch (err) { next(err); }
});

// GET /api/faults/timeseries
router.get('/timeseries', (req, res, next) => {
  try {
    const interval = req.query.interval || 'month';
    const data = FaultEvent.getTimeSeries(interval);
    res.json({ data, interval });
  } catch (err) { next(err); }
});

// GET /api/faults/export — CSV
router.get('/export', (req, res, next) => {
  try {
    const filters = {
      severity: req.query.severity || '',
      fault_type: req.query.fault_type || '',
      region: req.query.region || '',
      era: req.query.era || '',
      from: req.query.from || '',
      to: req.query.to || '',
      limit: 5000,
      offset: 0
    };
    Object.keys(filters).forEach(k => { if (filters[k] === '') delete filters[k]; });

    const { data } = FaultEvent.findAll(req.scope(filters));
    const cols = [
      'fault_id','site_id','site_name','region','fault_type','severity','timestamp',
      'detection_method','detection_delay_hours','resolution_time_hours','downtime_hours',
      'transformer_rating','financial_impact_usd','subscribers_affected','description',
      'root_cause_confirmed','era','parts_replaced','work_order_id','eca_reportable',
      'iec60076_severity_code','resolved_at'
    ];

    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csv = [cols.join(','), ...data.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="fault_events.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/faults/:id — single fault with related
router.get('/:id', (req, res, next) => {
  try {
    const fault = FaultEvent.findById(req.params.id);
    if (!fault) { const e = new Error('Fault event not found'); e.status = 404; return next(e); }

    const siteAlerts = AlertLog.findBySiteId(fault.site_id).slice(0, 10);
    const siteFaults = FaultEvent.findBySiteId(fault.site_id).filter(f => f.fault_id !== fault.fault_id).slice(0, 5);

    const days_since = Math.floor((Date.now() - new Date(fault.timestamp).getTime()) / 86400000);
    const detection_efficiency = fault.detection_delay_hours < 1 ? 'Excellent (AI-detected)'
      : fault.detection_delay_hours < 12 ? 'Good' : fault.detection_delay_hours < 48 ? 'Delayed' : 'Critical delay (>48h)';

    res.json({
      ...fault,
      days_since,
      detection_efficiency,
      related: {
        siteAlerts,
        siteFaults
      }
    });
  } catch (err) { next(err); }
});

// GET /api/faults/:id/events — other faults at same site
router.get('/:id/events', (req, res, next) => {
  try {
    const fault = FaultEvent.findById(req.params.id);
    if (!fault) { const e = new Error('Fault event not found'); e.status = 404; return next(e); }

    const data = FaultEvent.findBySiteId(fault.site_id);
    res.json({ data, total: data.length });
  } catch (err) { next(err); }
});

module.exports = router;
